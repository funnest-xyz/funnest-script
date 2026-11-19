import { levelFor, type Levels, type Strategy } from './strategy';

/**
 * The rules a strategy trades by, a bar at a time: the backtest (backtest.ts) runs them over
 * history, and the app's paper auto-trading runs them live — so both act the same way.
 *
 * - At a bar's open, the bar before's signals: an exit (or an entry the other way, when
 *   `reverse`) closes the position, then an entry opens one. Long and short both on: neither.
 * - While a position is open: the stop or the trailing stop (the tighter one) and the target.
 *   A price-series level uses the bar before's value (what was known). The trailing stop trails
 *   the best price up to the bar before.
 */

/** What these rules need to know of a position. */
export interface Held {
  dir: 1 | -1;
  /** Entry price. */
  price: number;
  /** Best price since the entry, up to the bar before (the trailing stop's anchor). */
  best: number;
}

export type OpenClose = 'signal' | 'reverse';
export type GuardReason = 'stop' | 'trail';

const sig = (a: Uint8Array | null, i: number) => !!a && a[i] === 1;

/** At a bar's open, on bar k's signals (the bar that just closed): what to close and what to open. */
export function atOpen(s: Strategy, k: number, held: 1 | -1 | null): { close: OpenClose | null; open: 1 | -1 | null } {
  let close: OpenClose | null = null;
  if (held) {
    const exit = held > 0 ? sig(s.longExit, k) : sig(s.shortExit, k);
    const other = held > 0 ? sig(s.shortEntry, k) : sig(s.longEntry, k);
    if (exit) close = 'signal';
    else if (other && s.reverse) close = 'reverse';
  }
  let open: 1 | -1 | null = null;
  if (!held || close) {
    const long = sig(s.longEntry, k) && !sig(s.longExit, k);
    const short = sig(s.shortEntry, k) && !sig(s.shortExit, k);
    if (long !== short) open = long ? 1 : -1;
  }
  return { close, open };
}

const levelOf = (ls: Levels | null, held: Held, i: number, away: 1 | -1): number => {
  // A stop / target per side: the one for this position's way.
  const l = levelFor(ls, held.dir);
  if (!l) return Number.NaN;
  if ('percent' in l) return held.price * (1 + away * held.dir * (l.percent / 100));
  const v = i > 0 ? l.price[i - 1]! : Number.NaN;
  return Number.isFinite(v) ? v : Number.NaN;
};

export interface Guards {
  /** The stop or the trailing stop, whichever is tighter (NaN: none). */
  guard: number;
  guardReason: GuardReason;
  /** The target (NaN: none). */
  take: number;
}

/** The levels for a position during bar i (bar i-1 is the last one known). */
export function guardsAt(s: Strategy, held: Held, i: number): Guards {
  const d = held.dir;
  const stop = levelOf(s.stop, held, i, -1);
  const trail = s.trail ? held.best * (1 - d * (s.trail / 100)) : Number.NaN;
  let guard = Number.NaN, guardReason: GuardReason = 'stop';
  for (const [lv, why] of [[stop, 'stop'], [trail, 'trail']] as const)
    if (Number.isFinite(lv) && (Number.isNaN(guard) || (d > 0 ? lv > guard : lv < guard))) (guard = lv), (guardReason = why);
  return { guard, guardReason, take: levelOf(s.take, held, i, 1) };
}

/** `price` at or past `level`: against the position (adverse) or in its favor. */
export const beyond = (dir: 1 | -1, price: number, level: number, adverse: boolean) =>
  Number.isFinite(level) && (adverse ? (dir > 0 ? price <= level : price >= level) : dir > 0 ? price >= level : price <= level);

/** A live price against a position's levels: what closes it now, or null. The stop wins a tie. */
export function hitAt(held: Held, g: Guards, price: number): GuardReason | 'take' | null {
  if (beyond(held.dir, price, g.guard, true)) return g.guardReason;
  if (beyond(held.dir, price, g.take, false)) return 'take';
  return null;
}

/** After a bar closes with the position still open: its best price, for the trailing stop. */
export const nextBest = (held: Held, high: number, low: number) => (held.dir > 0 ? Math.max(held.best, high) : Math.min(held.best, low));
