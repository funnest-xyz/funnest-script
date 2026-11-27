/**
 * Bar times in a time zone: the local clock of each bar (hour, weekday, month…) and where a new
 * day / week / month / year starts. Scripts can't read the clock, so this is about the bars' own
 * times only, and it's the same everywhere for the same bars and zone (deterministic).
 *
 * A zone's offset changes rarely (daylight saving, twice a year at most), so it's read with Intl
 * once a week of bar time and, where two readings differ, the change is found by halving down to
 * the minute — a few hundred Intl calls for 20 years of bars instead of one per bar.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Zone names a script may give: a name Intl knows ('Asia/Seoul', 'UTC', 'America/New_York'). */
const ZONE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,39}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The formatter for a zone, or null when the zone isn't one Intl knows. */
function formatter(tz: string): Intl.DateTimeFormat | null {
  const have = formatters.get(tz);
  if (have) return have;
  if (!ZONE.test(tz)) return null;
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    if (formatters.size > 32) formatters.clear();
    formatters.set(tz, f);
    return f;
  } catch {
    return null;
  }
}

export const isTimeZone = (tz: unknown): tz is string => typeof tz === 'string' && (tz === 'UTC' || formatter(tz) !== null);

/** Local time − UTC at `t`, in ms (whole minutes). */
function offsetAt(f: Intl.DateTimeFormat, t: number): number {
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(t)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour === 24 ? 0 : p.hour!, p.minute!);
  return local - Math.floor(t / MINUTE) * MINUTE;
}

/** Each bar's offset from UTC in `tz` (ms). UTC and fixed zones cost one or two Intl calls. */
export function offsets(time: ArrayLike<number>, tz: string): Float64Array {
  const n = time.length;
  const out = new Float64Array(n);
  if (tz === 'UTC' || tz === 'Etc/UTC' || !n) return out;
  const f = formatter(tz);
  if (!f) return out;
  // Bars out of order or without a usable time (never from a normal feed): one reading per bar, 0 where there's no time.
  let ordered = true;
  for (let i = 0; i < n && ordered; i++) ordered = Number.isFinite(time[i]!) && Math.abs(time[i]!) <= 8.64e15 && (i === 0 || time[i]! >= time[i - 1]!);
  if (!ordered) {
    const seen = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const t = time[i]!;
      if (!Number.isFinite(t) || Math.abs(t) > 8.64e15) continue;
      const hour = Math.floor(t / HOUR);
      let o = seen.get(hour);
      if (o === undefined) {
        o = offsetAt(f, t);
        if (seen.size < 100_000) seen.set(hour, o);
      }
      out[i] = o;
    }
    return out;
  }
  const memo = new Map<number, number>();
  const at = (t: number) => {
    let v = memo.get(t);
    if (v === undefined) memo.set(t, (v = offsetAt(f, t)));
    return v;
  };
  // The offset is piecewise constant: walk in weekly steps; between two readings that differ,
  // halve to the minute it changes at.
  let i = 0;
  let t0 = time[0]!;
  let o0 = at(t0);
  while (i < n) {
    const t1 = Math.min(t0 + WEEK, time[n - 1]!);
    const o1 = at(t1);
    let change = Infinity;
    if (o1 !== o0) {
      let lo = t0, hi = t1;
      while (hi - lo > MINUTE) {
        const mid = lo + Math.max(MINUTE, Math.floor((hi - lo) / 2 / MINUTE) * MINUTE);
        if (mid >= hi) break;
        if (at(mid) === o0) lo = mid;
        else hi = mid;
      }
      change = hi;
    }
    while (i < n && time[i]! <= t1) {
      out[i] = time[i]! >= change ? o1 : o0;
      i++;
    }
    if (t1 >= time[n - 1]!) break;
    t0 = t1;
    o0 = o1;
  }
  for (; i < n; i++) out[i] = at(time[i]!);
  return out;
}

export type Period = 'D' | 'W' | 'M' | 'Y';
export const PERIODS: readonly Period[] = ['D', 'W', 'M', 'Y'];

/** A number that is the same for bars of the same day / week (Monday start) / month / year, local to the zone. */
export function periodKeys(time: ArrayLike<number>, off: ArrayLike<number>, period: Period): Float64Array {
  const n = time.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const local = time[i]! + off[i]!;
    const day = Math.floor(local / DAY);
    if (period === 'D') out[i] = day;
    // 1970-01-01 was a Thursday: +3 makes weeks start on Monday.
    else if (period === 'W') out[i] = Math.floor((day + 3) / 7);
    else {
      const d = new Date(local);
      out[i] = period === 'M' ? d.getUTCFullYear() * 12 + d.getUTCMonth() : d.getUTCFullYear();
    }
  }
  return out;
}

export type Part = 'hour' | 'minute' | 'dayofweek' | 'day' | 'month' | 'year';

/** One part of each bar's local time: hour 0–23, minute, weekday 0 (Sunday)–6, day of the month, month 1–12, year. */
export function partOf(time: ArrayLike<number>, off: ArrayLike<number>, part: Part): Float64Array {
  const n = time.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = time[i]!;
    if (!Number.isFinite(t)) {
      out[i] = Number.NaN;
      continue;
    }
    const local = t + off[i]!;
    if (part === 'hour') out[i] = Math.floor((((local % DAY) + DAY) % DAY) / HOUR);
    else if (part === 'minute') out[i] = Math.floor((((local % HOUR) + HOUR) % HOUR) / MINUTE);
    else if (part === 'dayofweek') out[i] = (((Math.floor(local / DAY) + 4) % 7) + 7) % 7;
    else {
      const d = new Date(local);
      out[i] = part === 'day' ? d.getUTCDate() : part === 'month' ? d.getUTCMonth() + 1 : d.getUTCFullYear();
    }
  }
  return out;
}

/** Minutes after local midnight, per bar. */
export function minuteOfDay(time: ArrayLike<number>, off: ArrayLike<number>): Float64Array {
  const n = time.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const local = time[i]! + off[i]!;
    out[i] = Math.floor((((local % DAY) + DAY) % DAY) / MINUTE);
  }
  return out;
}

/** 'HHMM-HHMM' → [start, end) in minutes after midnight (end before start: the session runs past midnight); null when malformed. */
export function parseSession(spec: string): [number, number] | null {
  const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(spec.trim());
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number) as [number, number, number, number];
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const a = h1 * 60 + m1, b = h2 * 60 + m2;
  if (a > 1440 || b > 1440 || a === b) return null;
  return [a, b];
}
