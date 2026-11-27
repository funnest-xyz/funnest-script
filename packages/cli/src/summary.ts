import { backtest, type BacktestOptions, type BacktestResult, type Bars, type Level, type PlotOut, type RunResult, sideOf } from '@funnest/script';

/**
 * What a run produced, as numbers an AI can read instead of a chart: each line's last value,
 * range and how much of it is empty; how often the strategy fires; the warnings and logs.
 */

export interface PlotSummary {
  name: string;
  style: PlotOut['kind'];
  /** Drawn this many bars to the right (negative: left); `last` is the value before the shift. */
  offset: number;
  last: number | null;
  min: number | null;
  max: number | null;
  /** Share of bars without a value (0–1). */
  empty: number;
  /** First bar with a value. */
  firstValue: number | null;
}

export interface RunSummary {
  ok: true;
  name: string;
  overlay: boolean;
  /** The interval it says it's written for (indicator({ timeframe })), or null. */
  timeframe: string | null;
  bars: { count: number; from: string; to: string; lastClose: number };
  inputs: { label: string; kind: string; default: number | string; options?: string[] }[];
  plots: PlotSummary[];
  hlines: number[];
  /** What it draws besides lines: the fill, shapes (bars marked, the latest), backgrounds, labels. */
  drawings: {
    fills: string[];
    shapes: { shape: string; text: string | null; bars: number; lastBarsAgo: number | null }[];
    backgrounds: { bars: number }[];
    /** Candles recolored by barcolor. */
    barColors: number;
    labels: { barsAgo: number; text: string }[];
    lines: number;
    boxes: { top: number; bottom: number; text: string | null }[];
    tables: { position: string; rows: string[][] }[];
  };
  strategy: { side: string; entries: number; exits: number; lastEntryBarsAgo: number | null; stopLoss: string | null; takeProfit: string | null; trailingStopPct: number | null; sizePct: number } | null;
  /** alert(): how often each would have rung on these bars, and how many bars ago it last did. */
  alerts: { message: string; bars: number; lastBarsAgo: number | null }[];
  /** screen(): the screener columns (the last bar's value). */
  screens: { name: string; value: number | null }[];
  warnings: string[];
  logs: string[];
  /** Data asked for with request.bars / request.data; missing: it couldn't be fetched (NaN in the run). */
  requests: { request: string; missing: boolean }[];
}

export type Failure = Extract<RunResult, { ok: false }>;

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const num = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(6)) : null);

const count = (when: Uint8Array) => when.reduce((s, v) => s + v, 0);
const colored = (index: Uint8Array) => index.reduce((s, v) => s + (v === 255 ? 0 : 1), 0);
const lastAgo = (when: Uint8Array, n: number) => {
  const i = when.lastIndexOf(1);
  return i < 0 ? null : n - 1 - i;
};

export function summarize(r: RunResult, bars: Bars): RunSummary | Failure {
  if (!r.ok) return r;
  const n = bars.close.length;
  const plots = r.plots.map((p): PlotSummary => {
    let min = Infinity, max = -Infinity, empty = 0, first: number | null = null;
    Array.from(p.values).forEach((v, i) => {
      if (!Number.isFinite(v)) return void empty++;
      if (first === null) first = i;
      min = Math.min(min, v);
      max = Math.max(max, v);
    });
    return { name: p.name, style: p.kind, offset: p.offset, last: num(p.values[n - 1]!), min: num(min), max: num(max), empty: n ? Number((empty / n).toFixed(3)) : 1, firstValue: first };
  });
  let strategy: RunSummary['strategy'] = null;
  if (r.strategy) {
    const st = r.strategy;
    const count = (a: Uint8Array | null) => (a ? a.reduce((x, v) => x + v, 0) : 0);
    const lastOf = (a: Uint8Array | null) => (a ? a.lastIndexOf(1) : -1);
    const lastEntry = Math.max(lastOf(st.longEntry), lastOf(st.shortEntry));
    const one = (l: Level | null) => (!l ? 'none' : 'percent' in l ? `${l.percent}%` : 'price per bar');
    const level = (l: typeof st.stop) => (!l ? null : 'percent' in l || 'price' in l ? one(l) : `long ${one(l.long)} / short ${one(l.short)}`);
    strategy = {
      side: sideOf(st),
      entries: count(st.longEntry) + count(st.shortEntry),
      exits: count(st.longExit) + count(st.shortExit),
      lastEntryBarsAgo: lastEntry < 0 ? null : n - 1 - lastEntry,
      stopLoss: level(st.stop),
      takeProfit: level(st.take),
      trailingStopPct: st.trail,
      sizePct: Math.round(st.size * 100),
    };
  }
  return {
    ok: true,
    name: r.meta.name,
    overlay: r.meta.overlay,
    timeframe: r.meta.timeframe ?? null,
    bars: { count: n, from: n ? iso(bars.time[0]!) : '', to: n ? iso(bars.time[n - 1]!) : '', lastClose: n ? bars.close[n - 1]! : Number.NaN },
    inputs: r.inputs.map((i) => ({ label: i.label, kind: i.kind, default: i.default, ...('options' in i ? { options: i.options } : {}) })),
    plots,
    hlines: r.hlines.map((h) => h.value),
    drawings: {
      fills: r.fills.map((x) => `${x.upper} ~ ${x.lower}`),
      shapes: r.shapes.map((x) => ({ shape: x.shape, text: x.text, bars: count(x.when), lastBarsAgo: lastAgo(x.when, n) })),
      backgrounds: r.backgrounds.map((b) => ({ bars: colored(b.colors.index) })),
      barColors: r.barColors ? colored(r.barColors.index) : 0,
      labels: r.labels.slice(-10).map((l) => ({ barsAgo: n - 1 - l.bar, text: l.text })),
      lines: r.lines.length,
      boxes: r.boxes.slice(-10).map((b) => ({ top: num(b.top)!, bottom: num(b.bottom)!, text: b.text })),
      tables: r.tables.map((t) => ({ position: t.position, rows: t.rows.slice(0, 20).map((row) => row.map((c) => c.text)) })),
    },
    strategy,
    alerts: r.alerts.map((a) => ({ message: a.message, bars: count(a.when), lastBarsAgo: lastAgo(a.when, n) })),
    screens: r.screens.map((x) => ({ name: x.name, value: num(x.value) })),
    warnings: r.warnings.map((w) => `${w.code}: ${w.message}`),
    logs: r.logs,
    requests: r.requests.map((x) => ({ request: x.key, missing: x.missing })),
  };
}

export interface BacktestSummary {
  trades: number;
  totalReturnPct: number;
  buyHoldPct: number;
  winRatePct: number | null;
  avgTradePct: number | null;
  maxDrawdownPct: number;
  profitFactor: number | null;
  exposurePct: number;
  avgWinPct: number | null;
  avgLossPct: number | null;
  payoff: number | null;
  maxLosingStreak: number;
  long: { trades: number; returnPct: number };
  short: { trades: number; returnPct: number };
  /** Trades closed by each reason: signal, reverse, stop, take, trail, time, liquidation, end. */
  exits: Record<string, number>;
  finalEquity: number;
  /** Leverage used (1: none). */
  leverage: number;
  /** The last 12 calendar months (UTC). */
  monthly: { month: string; returnPct: number }[];
  /** part: the share of the position this exit closed (under 100 for a partial target); entries: more than 1 with pyramiding. */
  recentTrades: { side: string; entry: string; exit: string; returnPct: number; reason: string; open: boolean; partPct: number; entries: number }[];
}

const pct = (v: number | null) => (v === null ? null : Number((v * 100).toFixed(2)));

export function backtestSummary(r: RunResult, bars: Bars, options?: BacktestOptions): BacktestSummary | null {
  if (!r.ok || !r.strategy) return null;
  const list = Array.from({ length: bars.close.length }, (_, i) => ({ time: bars.time[i]!, open: bars.open[i]!, high: bars.high[i]!, low: bars.low[i]!, close: bars.close[i]! }));
  let b: BacktestResult;
  try {
    b = backtest(list, r.strategy, options);
  } catch {
    // A strategy the checks let through but the backtest can't read: no backtest rather than a crash.
    return null;
  }
  return {
    trades: b.trades.length,
    totalReturnPct: pct(b.totalReturn)!,
    buyHoldPct: pct(b.buyHold)!,
    winRatePct: pct(b.winRate),
    avgTradePct: pct(b.avgTrade),
    maxDrawdownPct: pct(b.maxDrawdown)!,
    profitFactor: b.profitFactor === null ? null : Number(b.profitFactor.toFixed(2)),
    exposurePct: pct(b.exposure)!,
    avgWinPct: pct(b.avgWin),
    avgLossPct: pct(b.avgLoss),
    payoff: b.payoff === null ? null : Number(b.payoff.toFixed(2)),
    maxLosingStreak: b.maxLosingStreak,
    long: { trades: b.long.trades, returnPct: pct(b.long.ret)! },
    short: { trades: b.short.trades, returnPct: pct(b.short.ret)! },
    exits: b.reasons,
    finalEquity: Math.round(b.finalEquity * 100) / 100,
    leverage: b.leverage,
    monthly: b.monthly.slice(-12).map((m) => ({ month: m.month, returnPct: pct(m.ret)! })),
    recentTrades: b.trades.slice(-10).map((t) => ({ side: t.side, entry: iso(t.entryTime), exit: iso(t.exitTime), returnPct: pct(t.ret)!, reason: t.reason, open: t.open, partPct: pct(t.part)!, entries: t.entries })),
  };
}
