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
export function levelFor(l: Levels | null, dir: 1 | -1): Level | null {
  if (!l) return null;
  if ('percent' in l || 'price' in l) return l;
  return dir > 0 ? l.long : l.short;
}

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
  for (const ls of [s.stop, s.take]) for (const l of ls && !('percent' in ls) && !('price' in ls) ? [ls.long, ls.short] : [ls]) if (l && 'price' in l) out.push(l.price.buffer as ArrayBuffer);
  // The same series on both sides is one buffer: hand it over once.
  return [...new Set(out)];
}
