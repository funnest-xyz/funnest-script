import { levelFor, stepsFor, type Levels, type Strategy } from './strategy';

/**
 * The rules a strategy trades by, a bar at a time: the backtest (backtest.ts) runs them over
 * history, and the app's paper auto-trading runs them live — so both act the same way.
 *
 * - At a bar's open, the bar before's signals: an exit (or an entry the other way, when
 *   `reverse`, or the time limit `exitAfter`) closes the position, then an entry opens one —
 *   at once, or as an order at `entryPrice` that waits up to `entryBars` bars. Long and short
 *   both on: neither. With `pyramiding`, an entry the same way adds to the position.
 * - While a position is open: the stop, the trailing stop or the liquidation price (the tightest)
 *   and the next target. A price-series level uses the bar before's value (what was known). The
 *   trailing stop trails the best price up to the bar before. Targets may close part of the
 *   position (`steps`); with `breakEven`, the stop sits at the entry price from the bar after the
 *   first one.
 */

/** What these rules need to know of a position. */
export interface Held {
  dir: 1 | -1;
  /** Entry price (the average, after adding). */
  price: number;
  /** Best price since the entry, up to the bar before (the trailing stop's anchor). */
  best: number;
  /** Partial targets taken so far. */
  steps?: number;
  /** The break-even stop is on (a target filled in an earlier bar). */
  armed?: boolean;
  /** Entries in it so far (pyramiding). */
  entries?: number;
  /** Bars from the first entry's bar to the bar opening now. */
  age?: number;
}

export type OpenClose = 'signal' | 'reverse' | 'time';
export type GuardReason = 'stop' | 'trail' | 'liquidation';

/** An entry waiting for its price: a limit order (a better price than the signal bar's close) or a stop order (a worse one: a breakout). */
export interface EntryOrder {
  dir: 1 | -1;
  price: number;
  kind: 'limit' | 'stop';
  /** Adds to a position held the same way. */
  add: boolean;
  /** Bars it may still fill in, counting the one opening now. */
  bars: number;
}

/** A liquidated position keeps this much of its notional as margin (as exchanges ask). */
const MAINTENANCE = 0.005;

const sig = (a: Uint8Array | null, i: number) => !!a && a[i] === 1;

/** The settings with their defaults (older strategies don't have them). */
export function settings(s: Strategy) {
  return {
    pyramiding: Math.max(1, Math.floor(s.pyramiding ?? 1)),
    leverage: Math.max(1, s.leverage ?? 1),
    exitAfter: s.exitAfter && s.exitAfter > 0 ? Math.floor(s.exitAfter) : null,
    entryBars: Math.max(1, Math.floor(s.entryBars ?? 1)),
    breakEven: s.breakEven === true,
  };
}

/** An entry order for this side on bar k's signal, or null to enter at the open. */
function orderFor(s: Strategy, k: number, dir: 1 | -1, signalClose: number, add: boolean, bars: number): EntryOrder | null {
  const l = levelFor(s.entryPrice ?? null, dir);
  if (!l || !('price' in l)) return null;
  const price = l.price[k]!;
  if (!Number.isFinite(price) || !(price > 0)) return null;
  // A long below the close waits for a dip (limit); above it, for a breakout (stop). Shorts the other way.
  const better = dir > 0 ? price < signalClose : price > signalClose;
  return { dir, price, kind: better ? 'limit' : 'stop', add, bars };
}

export interface AtOpen {
  close: OpenClose | null;
  /** Enter now, at the open (1 long, −1 short); `add`: into the position held the same way. */
  open: 1 | -1 | null;
  add: boolean;
  /** Or place this entry order (it replaces any waiting one). */
  order: EntryOrder | null;
}

/**
 * At a bar's open, on bar k's signals (the bar that just closed): what to close, what to open.
 * `signalClose` is bar k's close (an entry price is a limit or a stop against it).
 */
export function atOpen(s: Strategy, k: number, held: 1 | -1 | Held | null, signalClose = Number.NaN): AtOpen {
  const h: Held | null = held === null ? null : typeof held === 'number' ? { dir: held, price: Number.NaN, best: Number.NaN } : held;
  const o = settings(s);
  let close: OpenClose | null = null;
  if (h) {
    const exit = h.dir > 0 ? sig(s.longExit, k) : sig(s.shortExit, k);
    const other = h.dir > 0 ? sig(s.shortEntry, k) : sig(s.longEntry, k);
    if (exit) close = 'signal';
    else if (other && s.reverse) close = 'reverse';
    else if (o.exitAfter !== null && (h.age ?? 0) >= o.exitAfter) close = 'time';
  }
  let open: 1 | -1 | null = null;
  let add = false;
  const long = sig(s.longEntry, k) && !sig(s.longExit, k);
  const short = sig(s.shortEntry, k) && !sig(s.shortExit, k);
  const want: 1 | -1 | null = long !== short ? (long ? 1 : -1) : null;
  if (want !== null) {
    if (!h || close) open = want;
    else if (want === h.dir && (h.entries ?? 1) < o.pyramiding) (open = want), (add = true);
  }
  const order = open !== null ? orderFor(s, k, open, signalClose, add, o.entryBars) : null;
  return order ? { close, open: null, add: false, order } : { close, open, add, order: null };
}

/**
 * The waiting entry order after bar k's signals: the new one, or the old one a bar older —
 * dropped when it has run out of bars, when the position it would add to is gone, when an entry
 * opened at once, or when its side's exit signal came.
 */
export function nextOrder(s: Strategy, k: number, waiting: EntryOrder | null, act: AtOpen, held: 1 | -1 | null): EntryOrder | null {
  if (act.order) return act.order;
  if (!waiting || act.open !== null) return null;
  const exit = waiting.dir > 0 ? sig(s.longExit, k) : sig(s.shortExit, k);
  const left = waiting.bars - 1;
  if (exit || left <= 0) return null;
  // An order to add needs the position; an order to open needs to be flat (or the position turned).
  if (waiting.add ? held !== waiting.dir : held !== null) return null;
  return { ...waiting, bars: left };
}

/** Where an entry order fills in a bar (open, high, low), or NaN: at the open when the bar opens past it. */
export function orderFill(o: EntryOrder, open: number, high: number, low: number): number {
  const down = (o.dir > 0) === (o.kind === 'limit'); // waits for the price to come down to it
  if (down) return open <= o.price ? open : low <= o.price ? o.price : Number.NaN;
  return open >= o.price ? open : high >= o.price ? o.price : Number.NaN;
}

/** A live price reaching an entry order. */
export const orderHit = (o: EntryOrder, price: number) => ((o.dir > 0) === (o.kind === 'limit') ? price <= o.price : price >= o.price);

const levelOf = (ls: Levels | null | undefined, held: Held, i: number, away: 1 | -1): number => {
  // A stop / target per side: the one for this position's way.
  const l = levelFor(ls, held.dir);
  if (!l) return Number.NaN;
  if ('percent' in l) return held.price * (1 + away * held.dir * (l.percent / 100));
  const v = i > 0 ? l.price[i - 1]! : Number.NaN;
  return Number.isFinite(v) ? v : Number.NaN;
};

export interface Guards {
  /** The stop, the trailing stop or the liquidation price, whichever is tightest (NaN: none). */
  guard: number;
  guardReason: GuardReason;
  /** The next target (NaN: none). */
  take: number;
  /** What it closes: a share of the position at its largest (1 with `takeRest`: all that's left). */
  takePart: number;
  takeRest: boolean;
}

/** The price where a position this way loses its margin at this leverage (NaN without leverage). */
export function liquidationPrice(dir: 1 | -1, price: number, leverage: number): number {
  if (!(leverage > 1)) return Number.NaN;
  return price * (1 - dir * (1 / leverage - MAINTENANCE));
}

/** The levels for a position during bar i (bar i-1 is the last one known). */
export function guardsAt(s: Strategy, held: Held, i: number): Guards {
  const d = held.dir;
  const o = settings(s);
  let stop = levelOf(s.stop, held, i, -1);
  if (o.breakEven && held.armed && Number.isFinite(held.price) && (Number.isNaN(stop) || (d > 0 ? held.price > stop : held.price < stop))) stop = held.price;
  const trail = s.trail ? held.best * (1 - d * (s.trail / 100)) : Number.NaN;
  const liq = liquidationPrice(d, held.price, o.leverage);
  let guard = Number.NaN, guardReason: GuardReason = 'stop';
  for (const [lv, why] of [[stop, 'stop'], [trail, 'trail'], [liq, 'liquidation']] as const)
    if (Number.isFinite(lv) && (Number.isNaN(guard) || (d > 0 ? lv > guard : lv < guard))) (guard = lv), (guardReason = why);
  const steps = stepsFor(s.steps, d);
  if (steps && steps.length) {
    const k = held.steps ?? 0;
    const step = steps[k];
    if (!step) return { guard, guardReason, take: Number.NaN, takePart: 0, takeRest: false };
    const last = k === steps.length - 1;
    return { guard, guardReason, take: levelOf(step.level, held, i, 1), takePart: step.part, takeRest: last && step.part >= 1 };
  }
  return { guard, guardReason, take: levelOf(s.take, held, i, 1), takePart: 1, takeRest: true };
}

/** `price` at or past `level`: against the position (adverse) or in its favor. */
export const beyond = (dir: 1 | -1, price: number, level: number, adverse: boolean) =>
  Number.isFinite(level) && (adverse ? (dir > 0 ? price <= level : price >= level) : dir > 0 ? price >= level : price <= level);

/** A live price against a position's levels: what closes it (or part of it) now, or null. The stop wins a tie. */
export function hitAt(held: Held, g: Guards, price: number): GuardReason | 'take' | null {
  if (beyond(held.dir, price, g.guard, true)) return g.guardReason;
  if (beyond(held.dir, price, g.take, false)) return 'take';
  return null;
}

/** After a bar closes with the position still open: its best price, for the trailing stop. */
export const nextBest = (held: Held, high: number, low: number) => (held.dir > 0 ? Math.max(held.best, high) : Math.min(held.best, low));
