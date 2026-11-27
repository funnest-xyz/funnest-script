/**
 * What a script asks the backtest to trade: when to go long or short and leave, where the stop /
 * target / trailing stop are, how much of the account a trade uses, and the costs. Older scripts'
 * `{ entry, exit, side }` (v1 and early v2) are read into the same shape by `normalizeStrategy`.
 */

/** A level for a stop or a target: a distance in % from the entry, or a price per bar (read from the bar before). */
export type Level = { percent: number } | { price: Float64Array };
/** A stop or target for each side (`stopLoss: { long, short }`); a side left out has none. */
export interface Sided {
  long: Level | null;
  short: Level | null;
}
/** One level for both sides, or one per side. */
export type Levels = Level | Sided;

/** The level that applies to a position this way (1 long, −1 short). */
export function levelFor(l: Levels | null | undefined, dir: 1 | -1): Level | null {
  if (!l) return null;
  if ('percent' in l || 'price' in l) return l;
  return dir > 0 ? l.long : l.short;
}

/** A partial target: close `part` (0–1] of the position as it was at its largest, at `level`; `part` 1 on the last one = the rest. */
export interface Step {
  level: Level;
  part: number;
}
/** Targets in order, for both sides or { long, short } each its own. */
export type Steps = Step[] | { long: Step[] | null; short: Step[] | null };

export function stepsFor(s: Steps | null | undefined, dir: 1 | -1): Step[] | null {
  if (!s) return null;
  if (Array.isArray(s)) return s;
  return dir > 0 ? s.long : s.short;
}

/** Most of each a strategy may ask for. */
export const STRATEGY_LIMITS = { steps: 5, pyramiding: 20, leverage: 100, exitAfter: 5000, entryBars: 500 } as const;

export interface Strategy {
  longEntry: Uint8Array | null;
  longExit: Uint8Array | null;
  shortEntry: Uint8Array | null;
  shortExit: Uint8Array | null;
  stop: Levels | null;
  take: Levels | null;
  /** Trailing stop: this % back from the best price since the entry. */
  trail: number | null;
  /** Share of the account a trade uses (0–1]. */
  size: number;
  /** Starting account, for amounts (returns are the same whatever it is). */
  capital: number;
  /** Per fill, as fractions; null = the backtest's own (the viewer's settings). */
  fee: number | null;
  slippage: number | null;
  /** An entry the other way closes the position and opens the new one. */
  reverse: boolean;
  // Later additions: optional, so strategies made before (or by hand) still work.
  /** Partial targets (takeProfit: [{ at, close }]); `take` is null when these are set. */
  steps?: Steps | null;
  /** From the bar after the first target fills, the stop is at the entry price. */
  breakEven?: boolean;
  /** Close at the open this many bars after the first entry. */
  exitAfter?: number | null;
  /** Enter at this price (the signal bar's value) instead of the next open: a limit order below the signal bar's close for a long (above for a short), a stop order on the other side. */
  entryPrice?: Levels | null;
  /** Bars an entry order waits before it's dropped (1: the next bar only). */
  entryBars?: number;
  /** Most entries one way at a time (1: no adding). */
  pyramiding?: number;
  /** Futures leverage (1: none); a position is liquidated when its margin is gone. */
  leverage?: number;
  /** Money per entry (in capital's units; the paper account's currency when auto-trading) instead of `size`. */
  amount?: number | null;
  /** Quantity per entry (coins, shares) instead of `size`. */
  qty?: number | null;
}

/** The old shape: one direction. */
export interface LegacySignals {
  entry: Uint8Array;
  exit: Uint8Array;
  side: 'long' | 'short';
}

export const isLegacy = (s: Strategy | LegacySignals): s is LegacySignals => 'entry' in s && !('longEntry' in s);

export function normalizeStrategy(s: Strategy | LegacySignals): Strategy {
  if (!isLegacy(s)) return s;
  const long = s.side !== 'short';
  return {
    longEntry: long ? s.entry : null,
    longExit: long ? s.exit : null,
    shortEntry: long ? null : s.entry,
    shortExit: long ? null : s.exit,
    stop: null,
    take: null,
    trail: null,
    size: 1,
    capital: 10_000,
    fee: null,
    slippage: null,
    reverse: true,
  };
}

/** Which way a strategy trades. */
export function sideOf(s: Strategy | LegacySignals): 'long' | 'short' | 'both' {
  const n = normalizeStrategy(s);
  return n.longEntry && n.shortEntry ? 'both' : n.shortEntry ? 'short' : 'long';
}

/** Bars with an entry signal (either way). */
export function entryCount(s: Strategy | LegacySignals): number {
  const n = normalizeStrategy(s);
  let k = 0;
  for (const a of [n.longEntry, n.shortEntry]) if (a) for (const v of a) k += v;
  return k;
}

/** The arrays a strategy holds (to hand over without copying). */
export function strategyBuffers(s: Strategy): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [s.longEntry, s.longExit, s.shortEntry, s.shortExit]) if (a) out.push(a.buffer as ArrayBuffer);
  for (const ls of [s.stop, s.take, s.entryPrice ?? null]) for (const l of ls && !('percent' in ls) && !('price' in ls) ? [ls.long, ls.short] : [ls]) if (l && 'price' in l) out.push(l.price.buffer as ArrayBuffer);
  for (const dir of [1, -1] as const) for (const step of stepsFor(s.steps, dir) ?? []) if ('price' in step.level) out.push(step.level.price.buffer as ArrayBuffer);
  // The same series on both sides is one buffer: hand it over once.
  return [...new Set(out)];
}
