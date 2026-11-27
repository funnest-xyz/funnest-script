import { atOpen, beyond, guardsAt, nextBest, nextOrder, orderFill, settings, type EntryOrder, type Held } from './live';
import { normalizeStrategy, type LegacySignals, type Strategy } from './strategy';
import { offsets, periodKeys } from './time';

/** What the backtest reads of a bar. */
export interface BacktestBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * A plain, honest backtest of a script's strategy on the bars it ran on. The rules are live.ts's,
 * which the app's paper auto-trading follows too.
 *
 * - A signal on bar i (known at its close) is acted on at bar i+1's open: no peeking. With an
 *   entry price, it becomes an order that fills inside a later bar when the price gets there
 *   (at the open when the bar opens past it).
 * - One position at a time (with `pyramiding`, several entries one way make one position at
 *   their average price). An exit signal, an entry the other way (when `reverse`) or the time
 *   limit closes it at the open; a new entry opens there too.
 * - Stops, targets, trailing stops and liquidation are checked inside every bar the position is
 *   open (its entry bar too) against the bar's low / high. Opening beyond the level fills at the
 *   open (a gap). If one bar reaches both the stop and a target, the stop is taken — we can't
 *   know which came first, so the worse one. Partial targets may fill one after another in a bar.
 * - A price-series stop / target uses the value of the bar before (what was known).
 * - A trade uses `size` of the account (or `amount`, or `qty`); fee and slippage on every fill,
 *   the fee on the traded value (leverage × margin). An open position at the end is valued at
 *   the last close.
 */

export interface BacktestOptions {
  /** Per fill, as a fraction (0.0005 = 0.05%). A strategy's own fee wins. */
  fee: number;
  /** Extra price slippage per fill, as a fraction. */
  slippage: number;
  /** Where months start for the monthly returns (the market's zone; default UTC). */
  timezone?: string;
}
export const DEFAULT_BACKTEST: BacktestOptions = { fee: 0.0005, slippage: 0.0005 };

export type ExitReason = 'signal' | 'reverse' | 'stop' | 'take' | 'trail' | 'time' | 'liquidation' | 'end';

export interface Trade {
  side: 'long' | 'short';
  /** The first entry's bar and the (average) entry price. */
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  /** Return on the money this exit's share of the trade used, after fees (0.05 = +5%). */
  ret: number;
  /** Profit or loss in the account's money (capital units). */
  pnl: number;
  bars: number;
  reason: ExitReason;
  /** Still open at the last bar (valued at its close). */
  open: boolean;
  /** Share of the position (at its largest) this exit closed: 1 for a whole trade, less for a partial target. */
  part: number;
  /** Entries in the position (more than 1 with pyramiding). */
  entries: number;
}

export interface BacktestResult {
  trades: Trade[];
  /** Account value at each bar's close, starting at 1. */
  equity: Float64Array;
  totalReturn: number;
  /** Holding from the first bar's open to the last close, for comparison. */
  buyHold: number;
  winRate: number | null;
  avgTrade: number | null;
  /** Average winning / losing trade (losing as a negative number). */
  avgWin: number | null;
  avgLoss: number | null;
  /** Average win ÷ average loss. */
  payoff: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  /** Largest fall from a peak of equity (0.2 = −20%). */
  maxDrawdown: number;
  /** Gross profit ÷ gross loss (null without losing trades). */
  profitFactor: number | null;
  maxLosingStreak: number;
  /** Share of bars spent in a position. */
  exposure: number;
  avgBars: number | null;
  long: { trades: number; ret: number };
  short: { trades: number; ret: number };
  /** Trades closed by each reason. */
  reasons: Partial<Record<ExitReason, number>>;
  /** Return of each calendar month (in the market's zone), oldest first: 'YYYY-MM'. */
  monthly: { month: string; ret: number }[];
  capital: number;
  /** Final account value in capital units. */
  finalEquity: number;
  fee: number;
  slippage: number;
  leverage: number;
  from: number;
  to: number;
}

interface Position {
  dir: 1 | -1;
  /** The first entry's bar. */
  i: number;
  /** Average entry price. */
  price: number;
  /** Size in units of the asset. */
  units: number;
  /** Margin left in it (account fraction, after the entry fees). */
  margin: number;
  /** Account money taken for it (before fees): what returns are measured on. */
  used: number;
  /** Units at its largest (partial targets are shares of this). */
  peak: number;
  best: number;
  steps: number;
  entries: number;
  /** The bar a partial target last filled in (break-even starts the bar after). */
  stepBar: number;
}

export function backtest(bars: readonly BacktestBar[], strategy: Strategy | LegacySignals, o: BacktestOptions = DEFAULT_BACKTEST): BacktestResult {
  const s = normalizeStrategy(strategy);
  const opt = settings(s);
  const L = opt.leverage;
  const fee = s.fee ?? o.fee;
  const slip = s.slippage ?? o.slippage;
  const n = bars.length;
  const equity = new Float64Array(n).fill(1);
  const trades: Trade[] = [];
  let cash = 1;
  let pos: Position | null = null;
  let waiting: EntryOrder | null = null;
  let inBars = 0;

  const value = (price: number) => (pos ? cash + Math.max(0, pos.margin + pos.units * pos.dir * (price - pos.price)) : cash);
  /** Account money an entry takes at this price. */
  const sizing = (price: number) => {
    if (s.amount) return Math.min(cash, s.amount / s.capital);
    if (s.qty) return Math.min(cash, (s.qty * price) / L / s.capital);
    return cash * s.size;
  };
  const enter = (i: number, dir: 1 | -1, raw: number, slipped = true) => {
    const price = slipped ? raw * (1 + dir * slip) : raw;
    if (!(price > 0)) return;
    const used = sizing(price);
    if (!(used > 1e-12)) return;
    cash -= used;
    const margin = used - used * L * fee;
    const units = (margin * L) / price;
    if (pos && pos.dir === dir) {
      const p: Position = pos;
      p.price = (p.units * p.price + units * price) / (p.units + units);
      p.units += units;
      p.margin += margin;
      p.used += used;
      p.peak = Math.max(p.peak, p.units);
      p.entries++;
    } else pos = { dir, i, price, units, margin, used, peak: units, best: price, steps: 0, entries: 1, stepBar: -1 };
  };
  /** Closes `share` of the units held (1: all). */
  const exit = (i: number, raw: number, reason: ExitReason, share = 1, slipped = true) => {
    const p = pos!;
    const price = slipped ? raw * (1 - p.dir * slip) : raw;
    const all = share >= 1 - 1e-12;
    const u = all ? p.units : p.units * share;
    const m = all ? p.margin : p.margin * share;
    const usedPart = all ? p.used : p.used * share;
    const net = Math.max(0, m + u * p.dir * (price - p.price) - u * price * fee);
    cash += net;
    trades.push({
      side: p.dir > 0 ? 'long' : 'short',
      entryTime: bars[p.i]!.time,
      entryPrice: p.price,
      exitTime: bars[i]!.time,
      exitPrice: price,
      ret: usedPart > 0 ? net / usedPart - 1 : 0,
      pnl: (net - usedPart) * s.capital,
      bars: i - p.i,
      reason,
      open: reason === 'end',
      part: p.peak > 0 ? u / p.peak : 1,
      entries: p.entries,
    });
    if (all) pos = null;
    else {
      p.units -= u;
      p.margin -= m;
      p.used -= usedPart;
    }
  };
  const held = (p: Position, i: number): Held => ({ dir: p.dir, price: p.price, best: p.best, steps: p.steps, armed: p.steps > 0 && p.stepBar < i, entries: p.entries, age: i - p.i });
  /** A target filled: its share of the position (or the rest). */
  const takeAt = (i: number, price: number, part: number, rest: boolean) => {
    const p = pos!;
    const share = rest ? 1 : Math.min(1, (part * p.peak) / p.units);
    p.steps++;
    p.stepBar = i;
    exit(i, price, 'take', share);
  };

  for (let i = 0; i < n; i++) {
    const bar = bars[i]!;
    // At the open, on the previous bar's signals: exits and turns first, then entries (or orders).
    if (i > 0) {
      const act = atOpen(s, i - 1, pos ? held(pos, i) : null, bars[i - 1]!.close);
      if (act.close && pos) exit(i, bar.open, act.close);
      waiting = nextOrder(s, i - 1, waiting, act, pos ? (pos as Position).dir : null);
      if (act.open) enter(i, act.open, bar.open);
    }
    // An entry order reaching its price inside the bar (limit orders fill at their price, no slippage).
    // A bar is taken to go open → the side against the position → the other side: after a stop
    // order's fill (on the way to the favorable side) only targets can be reached in that bar.
    let afterBreakout = false;
    if (waiting) {
      const w: EntryOrder = waiting;
      const fill = orderFill(w, bar.open, bar.high, bar.low);
      if (Number.isFinite(fill)) {
        enter(i, w.dir, fill, w.kind === 'stop' || fill === bar.open);
        afterBreakout = w.kind === 'stop' && fill !== bar.open;
        waiting = null;
      }
    }
    // Inside the bar. At the open: a stop it opened past, then the targets it opened past.
    const guards = () => guardsAt(s, held(pos!, i), i);
    if (pos && (pos as Position).i !== i) {
      const d = (pos as Position).dir;
      const g = guards();
      if (beyond(d, bar.open, g.guard, true)) exit(i, bar.open, g.guardReason);
      for (let k = 0; pos && k <= 5; k++) {
        const t = guards();
        if (!beyond(d, bar.open, t.take, false)) break;
        takeAt(i, bar.open, t.takePart, t.takeRest);
      }
    }
    // Then the side against it (the stop, trailing stop or liquidation first: the worse case), then the targets.
    if (pos && !afterBreakout) {
      const p: Position = pos;
      const g = guards();
      if (beyond(p.dir, p.dir > 0 ? bar.low : bar.high, g.guard, true)) exit(i, g.guard, g.guardReason, 1, g.guardReason !== 'liquidation');
    }
    for (let k = 0; pos && k <= 5; k++) {
      const p: Position = pos;
      const t = guards();
      if (!beyond(p.dir, p.dir > 0 ? bar.high : bar.low, t.take, false)) break;
      takeAt(i, t.take, t.takePart, t.takeRest);
    }
    if (pos) (pos as Position).best = nextBest(pos as Position, bar.high, bar.low);
    if (pos) inBars++;
    equity[i] = value(bar.close);
  }
  if (pos && n) exit(n - 1, bars[n - 1]!.close, 'end', 1, false);
  if (n) equity[n - 1] = cash;

  let peak = 1, maxDrawdown = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? 1 - e / peak : 0);
  }
  const rets = trades.map((t) => t.ret);
  const wins = rets.filter((r) => r > 0), losses = rets.filter((r) => r < 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  let streak = 0, maxLosingStreak = 0;
  for (const r of rets) {
    streak = r < 0 ? streak + 1 : 0;
    maxLosingStreak = Math.max(maxLosingStreak, streak);
  }
  const avgWin = mean(wins), avgLoss = mean(losses);
  const grossWin = trades.reduce((a, t) => a + Math.max(0, t.pnl), 0), grossLoss = -trades.reduce((a, t) => a + Math.min(0, t.pnl), 0);
  const sideStats = (side: 'long' | 'short') => {
    const ts = trades.filter((t) => t.side === side);
    return { trades: ts.filter((t) => t.part >= 1 - 1e-9 || t.reason !== 'take').length, ret: ts.reduce((a, t) => a + t.pnl, 0) / s.capital };
  };
  const reasons: Partial<Record<ExitReason, number>> = {};
  for (const t of trades) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1;
  return {
    trades,
    equity,
    totalReturn: cash - 1,
    buyHold: n ? bars[n - 1]!.close / bars[0]!.open - 1 : 0,
    winRate: trades.length ? wins.length / trades.length : null,
    avgTrade: mean(rets),
    avgWin,
    avgLoss,
    payoff: avgWin !== null && avgLoss !== null && avgLoss !== 0 ? avgWin / -avgLoss : null,
    bestTrade: rets.length ? Math.max(...rets) : null,
    worstTrade: rets.length ? Math.min(...rets) : null,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    maxLosingStreak,
    exposure: n ? inBars / n : 0,
    avgBars: mean(trades.map((t) => t.bars)),
    long: sideStats('long'),
    short: sideStats('short'),
    reasons,
    monthly: monthlyReturns(bars, equity, o.timezone ?? 'UTC'),
    capital: s.capital,
    finalEquity: cash * s.capital,
    fee,
    slippage: slip,
    leverage: L,
    from: n ? bars[0]!.time : 0,
    to: n ? bars[n - 1]!.time : 0,
  };
}

/** Each month's change of the account value (from the month before's last close; the first from the start). */
function monthlyReturns(bars: readonly BacktestBar[], equity: Float64Array, tz: string): { month: string; ret: number }[] {
  const n = bars.length;
  if (!n) return [];
  const time = Float64Array.from(bars, (b) => b.time);
  const keys = periodKeys(time, offsets(time, tz), 'M');
  const out: { month: string; ret: number }[] = [];
  let start = 1;
  for (let i = 0; i < n; i++) {
    if (i === n - 1 || keys[i + 1] !== keys[i]) {
      const k = keys[i]!;
      out.push({ month: `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`, ret: start > 0 ? equity[i]! / start - 1 : 0 });
      start = equity[i]!;
    }
  }
  return out;
}
