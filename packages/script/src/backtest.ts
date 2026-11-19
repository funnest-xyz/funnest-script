import { atOpen, beyond, guardsAt, nextBest } from './live';
import { normalizeStrategy, type LegacySignals, type Strategy } from './strategy';

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
 * - A signal on bar i (known at its close) is acted on at bar i+1's open: no peeking.
 * - One position at a time. An exit signal, or an entry the other way (when `reverse`), closes it
 *   at the open; a new entry opens there too.
 * - Stops, targets and trailing stops are checked inside every bar the position is open (its
 *   entry bar too) against the bar's low / high. Opening beyond the level fills at the open (a
 *   gap). If one bar reaches both the stop and the target, the stop is taken — we can't know
 *   which came first, so the worse one.
 * - A price-series stop / target uses the value of the bar before (what was known).
 * - A trade uses `size` of the account; fee and slippage on every fill. An open position at the
 *   end is valued at the last close.
 */

export interface BacktestOptions {
  /** Per fill, as a fraction (0.0005 = 0.05%). A strategy's own fee wins. */
  fee: number;
  /** Extra price slippage per fill, as a fraction. */
  slippage: number;
}
export const DEFAULT_BACKTEST: BacktestOptions = { fee: 0.0005, slippage: 0.0005 };

export type ExitReason = 'signal' | 'reverse' | 'stop' | 'take' | 'trail' | 'end';

export interface Trade {
  side: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  /** Return on the money the trade used, after fees (0.05 = +5%). */
  ret: number;
  /** Profit or loss in the account's money (capital units). */
  pnl: number;
  bars: number;
  reason: ExitReason;
  /** Still open at the last bar (valued at its close). */
  open: boolean;
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
  capital: number;
  /** Final account value in capital units. */
  finalEquity: number;
  fee: number;
  slippage: number;
  from: number;
  to: number;
}

interface Position {
  dir: 1 | -1;
  i: number;
  price: number;
  /** Money in the trade before the entry fee (fraction of the account). */
  used: number;
  /** Money in the trade after the entry fee. */
  invested: number;
  /** Best price since the entry (for the trailing stop), up to the bar before. */
  best: number;
}

export function backtest(bars: readonly BacktestBar[], strategy: Strategy | LegacySignals, o: BacktestOptions = DEFAULT_BACKTEST): BacktestResult {
  const s = normalizeStrategy(strategy);
  const fee = s.fee ?? o.fee;
  const slip = s.slippage ?? o.slippage;
  const n = bars.length;
  const equity = new Float64Array(n).fill(1);
  const trades: Trade[] = [];
  let cash = 1;
  let pos: Position | null = null;
  let inBars = 0;

  const value = (price: number) => (pos ? cash + Math.max(0, pos.invested * (1 + pos.dir * (price / pos.price - 1))) : cash);
  const open = (i: number, dir: 1 | -1) => {
    const price = bars[i]!.open * (1 + dir * slip);
    const used = cash * s.size;
    cash -= used;
    pos = { dir, i, price, used, invested: used * (1 - fee), best: price };
  };
  const close = (i: number, rawPrice: number, reason: ExitReason, slipped = true) => {
    const p = pos!;
    const price = slipped ? rawPrice * (1 - p.dir * slip) : rawPrice;
    const gross = Math.max(0, p.invested * (1 + p.dir * (price / p.price - 1)));
    const net = gross * (1 - fee);
    cash += net;
    trades.push({
      side: p.dir > 0 ? 'long' : 'short',
      entryTime: bars[p.i]!.time,
      entryPrice: p.price,
      exitTime: bars[i]!.time,
      exitPrice: price,
      ret: p.used > 0 ? net / p.used - 1 : 0,
      pnl: (net - p.used) * s.capital,
      bars: i - p.i,
      reason,
      open: reason === 'end',
    });
    pos = null;
  };
  for (let i = 0; i < n; i++) {
    const bar = bars[i]!;
    // At the open, on the previous bar's signals: exits and turns first, then entries.
    if (i > 0) {
      const act = atOpen(s, i - 1, pos ? (pos as Position).dir : null);
      if (act.close) close(i, bar.open, act.close);
      if (act.open) open(i, act.open);
    }
    // Inside the bar: stop / trailing stop / target.
    if (pos) {
      const p: Position = pos;
      const d = p.dir;
      const { guard, guardReason, take } = guardsAt(s, p, i);
      const entryBar = p.i === i;
      if (!entryBar && beyond(d, bar.open, guard, true)) close(i, bar.open, guardReason);
      else if (!entryBar && beyond(d, bar.open, take, false)) close(i, bar.open, 'take');
      else if (beyond(d, d > 0 ? bar.low : bar.high, guard, true)) close(i, guard, guardReason);
      else if (beyond(d, d > 0 ? bar.high : bar.low, take, false)) close(i, take, 'take');
      else p.best = nextBest(p, bar.high, bar.low);
    }
    if (pos) inBars++;
    equity[i] = value(bar.close);
  }
  if (pos && n) close(n - 1, bars[n - 1]!.close, 'end', false);
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
  const grossWin = wins.reduce((a, b) => a + b, 0), grossLoss = -losses.reduce((a, b) => a + b, 0);
  const sideStats = (side: 'long' | 'short') => {
    const ts = trades.filter((t) => t.side === side);
    return { trades: ts.length, ret: ts.reduce((a, t) => a * (1 + t.ret), 1) - 1 };
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
    capital: s.capital,
    finalEquity: cash * s.capital,
    fee,
    slippage: slip,
    from: n ? bars[0]!.time : 0,
    to: n ? bars[n - 1]!.time : 0,
  };
}
