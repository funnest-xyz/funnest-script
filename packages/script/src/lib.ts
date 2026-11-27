import { Cond, ScriptError, Series, empty, isSeries, type Text } from './series';
import { PERIODS, isTimeZone, offsets, periodKeys, type Period } from './time';

/**
 * The math every script gets: `ta.*` indicators and the series helpers (sub, gt, map…).
 * Formulas follow the usual definitions charting platforms use (Wilder smoothing for RSI / ATR /
 * ADX, EMA seeded with the SMA of its first values, population standard deviation), so values
 * match what traders compare them with.
 */

export interface Bars {
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  time: Float64Array;
  /** Value traded per bar (quote currency); NaN where the venue doesn't say. */
  turnover?: Float64Array;
}

/** Most bars a period may span. */
export const MAX_PERIOD = 5000;

type Src = Series | Cond | Float64Array | Uint8Array | number;

const NAN = Number.NaN;
const bad = (text: Text, hint?: Text) => new ScriptError('BAD_ARG', text, hint);

/** Where the bars come from: the market's time zone sets where a day (or week…) starts. */
export interface LibContext {
  /** Default zone for day / week / month boundaries ('UTC' for crypto, 'Asia/Seoul' for Korean stocks). */
  timezone?: string;
}

/** Different time zones one run may use (each is an array per bar). */
const MAX_ZONES = 4;

export function createLib(bars: Bars, ctx: LibContext = {}) {
  const n = bars.close.length;
  const defaultZone = ctx.timezone && isTimeZone(ctx.timezone) ? ctx.timezone : 'UTC';

  /** A source as a Series (a number becomes that number on every bar). */
  const S = (v: unknown, fn: string, arg = 'src'): Series => {
    if (v instanceof Series) return v;
    if (isSeries(v)) return Series.from(v as ArrayLike<number>) as Series;
    if (typeof v === 'number') return new Series(n).fill(v);
    if (typeof v === 'boolean') return new Series(n).fill(v ? 1 : 0);
    throw bad(
      { ko: `${fn}의 ${arg}에는 시리즈나 숫자가 필요해요.`, en: `${fn}: ${arg} must be a series or a number.` },
      { ko: `예: ${fn}(close, 14)`, en: `For example: ${fn}(close, 14)` },
    );
  };
  /** A period: a whole number of bars, 1..MAX_PERIOD. */
  const P = (v: unknown, fn: string, arg = 'length', min = 1): number => {
    const p = Number(v);
    if (!Number.isFinite(p) || Math.round(p) !== p || p < min || p > MAX_PERIOD)
      throw bad(
        { ko: `${fn}의 ${arg}에는 ${min}~${MAX_PERIOD} 사이의 정수가 필요해요. (받은 값: ${String(v)})`, en: `${fn}: ${arg} must be a whole number from ${min} to ${MAX_PERIOD} (got ${String(v)}).` },
      );
    return p;
  };
  const C = (v: unknown, fn: string, arg = 'cond'): Uint8Array => {
    if (v instanceof Uint8Array) return v;
    if (isSeries(v)) return Cond.from(v as ArrayLike<number>, (x) => (x && !Number.isNaN(x) ? 1 : 0));
    if (typeof v === 'boolean' || typeof v === 'number') return new Cond(n).fill(v ? 1 : 0);
    throw bad({ ko: `${fn}의 ${arg}에는 조건(crossover, gt 등의 결과)이 필요해요.`, en: `${fn}: ${arg} must be a condition (from crossover, gt, …).` });
  };
  const out = () => empty(n);
  const cond = () => new Cond(n);

  // ── moving averages ─────────────────────────────────────────────
  function sma(src: Src, length: number): Series {
    const s = S(src, 'ta.sma'), p = P(length, 'ta.sma'), o = out();
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      if (Number.isNaN(v)) { sum = 0; count = 0; continue; }
      sum += v; count++;
      if (count > p) { sum -= s[i - p]!; count = p; }
      if (count === p) o[i] = sum / p;
    }
    return o;
  }
  /** EMA and RMA: an SMA of the first `length` values, then the recursive average. */
  function recursive(src: Src, length: number, fn: string, alpha: (p: number) => number): Series {
    const s = S(src, fn), p = P(length, fn), o = out(), a = alpha(p);
    let prev = NAN, sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      if (Number.isNaN(v)) continue;
      if (Number.isNaN(prev)) {
        sum += v;
        if (++count === p) o[i] = prev = sum / p;
      } else o[i] = prev = a * v + (1 - a) * prev;
    }
    return o;
  }
  const ema = (src: Src, length: number) => recursive(src, length, 'ta.ema', (p) => 2 / (p + 1));
  const rma = (src: Src, length: number) => recursive(src, length, 'ta.rma', (p) => 1 / p);
  function wma(src: Src, length: number): Series {
    const s = S(src, 'ta.wma'), p = P(length, 'ta.wma'), o = out(), w = (p * (p + 1)) / 2;
    for (let i = p - 1; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < p; j++) sum += s[i - j]! * (p - j);
      o[i] = sum / w;
    }
    return o;
  }
  function vwma(src: Src, length: number): Series {
    const s = S(src, 'ta.vwma'), p = P(length, 'ta.vwma'), v = bars.volume;
    const pv = sma(map((i) => s[i]! * v[i]!), p), vol = sma(v as Series, p);
    return map((i) => pv[i]! / vol[i]!);
  }
  function hma(src: Src, length: number): Series {
    const p = P(length, 'ta.hma', 'length', 2);
    const half = wma(src, Math.floor(p / 2)), full = wma(src, p);
    return wma(map((i) => 2 * half[i]! - full[i]!), Math.max(1, Math.round(Math.sqrt(p))));
  }

  /** Double / triple EMA: less lag than one EMA of the same length. */
  function dema(src: Src, length: number): Series {
    const e1 = ema(src, length), e2 = ema(e1, length);
    return map((i) => 2 * e1[i]! - e2[i]!);
  }
  function tema(src: Src, length: number): Series {
    const e1 = ema(src, length), e2 = ema(e1, length), e3 = ema(e2, length);
    return map((i) => 3 * (e1[i]! - e2[i]!) + e3[i]!);
  }
  /**
   * Least-squares line through the last `length` values, read at `offset` bars back from the
   * newest end (0 = the fitted value on this bar), as charting platforms' linreg.
   */
  function linreg(src: Src, length: number, offset = 0): Series {
    const s = S(src, 'ta.linreg'), p = P(length, 'ta.linreg'), o = out(), off = Number(offset);
    if (!Number.isFinite(off)) throw bad({ ko: 'ta.linreg의 offset에는 숫자가 필요해요.', en: 'ta.linreg: offset must be a number.' });
    const sx = (p * (p - 1)) / 2, sxx = ((p - 1) * p * (2 * p - 1)) / 6, den = p * sxx - sx * sx;
    for (let i = p - 1; i < n; i++) {
      let sy = 0, sxy = 0, ok = true;
      for (let j = 0; j < p; j++) {
        const v = s[i - p + 1 + j]!;
        if (Number.isNaN(v)) { ok = false; break; }
        sy += v;
        sxy += j * v;
      }
      if (!ok) continue;
      const slope = den === 0 ? 0 : (p * sxy - sx * sy) / den;
      const intercept = (sy - slope * sx) / p;
      o[i] = intercept + slope * (p - 1 - off);
    }
    return o;
  }
  /** Arnaud Legoux moving average: Gaussian weights centred at `offset` (0…1) of the window, width length / sigma. */
  function alma(src: Src, length: number, offset = 0.85, sigma = 6): Series {
    const s = S(src, 'ta.alma'), p = P(length, 'ta.alma'), o = out();
    const off = Number(offset), sig = Number(sigma);
    if (!(off >= 0 && off <= 1)) throw bad({ ko: 'ta.alma의 offset은 0~1이에요.', en: 'ta.alma: offset runs from 0 to 1.' });
    if (!(sig > 0)) throw bad({ ko: 'ta.alma의 sigma는 0보다 커야 해요.', en: 'ta.alma: sigma must be above 0.' });
    const m = off * (p - 1), w = p / sig;
    const weights = Array.from({ length: p }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * w * w)));
    const norm = weights.reduce((a, b) => a + b, 0);
    for (let i = p - 1; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < p; k++) sum += weights[k]! * s[i - p + 1 + k]!;
      o[i] = sum / norm;
    }
    return o;
  }

  // ── ranges and changes ──────────────────────────────────────────
  /**
   * Highest / lowest of the last `length` values in one pass (a queue of candidates), NaN while
   * the window holds a NaN — the same as comparing the whole window every bar, without the cost.
   */
  function extreme(src: Src, length: number, fn: string, higher: boolean, ago = false): Series {
    const s = S(src, fn), p = P(length, fn), o = out();
    const q = new Int32Array(n);
    let head = 0, tail = 0, lastNaN = -1;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      if (Number.isNaN(v)) lastNaN = i;
      else {
        // `<=` drops an equal older value: among equal extremes the most recent one stays.
        while (tail > head && (higher ? s[q[tail - 1]!]! <= v : s[q[tail - 1]!]! >= v)) tail--;
        q[tail++] = i;
      }
      while (tail > head && q[head]! <= i - p) head++;
      if (i >= p - 1 && lastNaN <= i - p && tail > head) o[i] = ago ? i - q[head]! : s[q[head]!]!;
    }
    return o;
  }
  const highest = (src: Src, length: number) => extreme(src, length, 'ta.highest', true);
  const lowest = (src: Src, length: number) => extreme(src, length, 'ta.lowest', false);
  /** Bars back to the highest / lowest of the last `length` values (0 = this bar; the most recent one on a tie). */
  const highestbars = (src: Src, length: number) => extreme(src, length, 'ta.highestbars', true, true);
  const lowestbars = (src: Src, length: number) => extreme(src, length, 'ta.lowestbars', false, true);
  function change(src: Src, length = 1): Series {
    const s = S(src, 'ta.change'), p = P(length, 'ta.change'), o = out();
    for (let i = p; i < n; i++) o[i] = s[i]! - s[i - p]!;
    return o;
  }
  function roc(src: Src, length: number): Series {
    const s = S(src, 'ta.roc'), p = P(length, 'ta.roc'), o = out();
    for (let i = p; i < n; i++) o[i] = (100 * (s[i]! - s[i - p]!)) / s[i - p]!;
    return o;
  }
  /** Running total (NaN counts as 0). */
  function cum(src: Src): Series {
    const s = S(src, 'ta.cum'), o = out();
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      if (!Number.isNaN(v)) sum += v;
      o[i] = sum;
    }
    return o;
  }
  function stdev(src: Src, length: number): Series {
    const s = S(src, 'ta.stdev'), p = P(length, 'ta.stdev'), mean = sma(s, p), o = out();
    for (let i = p - 1; i < n; i++) {
      if (Number.isNaN(mean[i]!)) continue;
      let sum = 0;
      for (let j = 0; j < p; j++) sum += (s[i - j]! - mean[i]!) ** 2;
      o[i] = Math.sqrt(sum / p);
    }
    return o;
  }

  // ── oscillators ─────────────────────────────────────────────────
  function rsi(src: Src, length = 14): Series {
    const s = S(src, 'ta.rsi'), p = P(length, 'ta.rsi'), up = out(), down = out();
    for (let i = 1; i < n; i++) {
      const d = s[i]! - s[i - 1]!;
      up[i] = Math.max(d, 0);
      down[i] = Math.max(-d, 0);
    }
    const u = rma(up, p), d = rma(down, p);
    return map((i) => (Number.isNaN(u[i]!) || Number.isNaN(d[i]!) ? NAN : d[i] === 0 ? 100 : u[i] === 0 ? 0 : 100 - 100 / (1 + u[i]! / d[i]!)));
  }
  function stoch(length = 14, smoothK = 3, smoothD = 3): { k: Series; d: Series } {
    const p = P(length, 'ta.stoch'), hh = highest(bars.high as Series, p), ll = lowest(bars.low as Series, p);
    const raw = map((i) => (hh[i] === ll[i] ? NAN : (100 * (bars.close[i]! - ll[i]!)) / (hh[i]! - ll[i]!)));
    const k = sma(raw, P(smoothK, 'ta.stoch', 'smoothK'));
    return { k, d: sma(k, P(smoothD, 'ta.stoch', 'smoothD')) };
  }
  function macd(src: Src, fast = 12, slow = 26, signal = 9): { macd: Series; signal: Series; hist: Series } {
    const f = ema(src, P(fast, 'ta.macd', 'fast')), sl = ema(src, P(slow, 'ta.macd', 'slow'));
    const m = map((i) => f[i]! - sl[i]!), sig = ema(m, P(signal, 'ta.macd', 'signal'));
    return { macd: m, signal: sig, hist: map((i) => m[i]! - sig[i]!) };
  }
  function cci(src: Src, length = 20): Series {
    const s = S(src, 'ta.cci'), p = P(length, 'ta.cci'), mean = sma(s, p), o = out();
    for (let i = p - 1; i < n; i++) {
      let dev = 0;
      for (let j = 0; j < p; j++) dev += Math.abs(s[i - j]! - mean[i]!);
      dev /= p;
      o[i] = dev === 0 ? 0 : (s[i]! - mean[i]!) / (0.015 * dev);
    }
    return o;
  }
  function mfi(length = 14): Series {
    const p = P(length, 'ta.mfi'), src = map((i) => (bars.high[i]! + bars.low[i]! + bars.close[i]!) / 3), o = out();
    const pos = out(), neg = out();
    for (let i = 1; i < n; i++) {
      const flow = src[i]! * bars.volume[i]!;
      pos[i] = src[i]! > src[i - 1]! ? flow : 0;
      neg[i] = src[i]! < src[i - 1]! ? flow : 0;
    }
    for (let i = p; i < n; i++) {
      let up = 0, dn = 0;
      for (let j = 0; j < p; j++) {
        up += pos[i - j]!;
        dn += neg[i - j]!;
      }
      o[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
    }
    return o;
  }

  // ── volatility and trend ────────────────────────────────────────
  /** True range; the first bar (no previous close) is high − low, or NaN with `strict`. */
  function trueRange(strict: boolean): Series {
    const o = out(), h = bars.high, l = bars.low, c = bars.close;
    for (let i = 0; i < n; i++) {
      if (i === 0) o[i] = strict ? NAN : h[i]! - l[i]!;
      else o[i] = Math.max(h[i]! - l[i]!, Math.abs(h[i]! - c[i - 1]!), Math.abs(l[i]! - c[i - 1]!));
    }
    return o;
  }
  const atr = (length = 14) => rma(trueRange(false), P(length, 'ta.atr'));
  function bb(src: Src, length = 20, mult = 2): { upper: Series; mid: Series; lower: Series; width: Series } {
    const m = Number(mult);
    if (!Number.isFinite(m)) throw bad({ ko: 'ta.bb의 mult에는 숫자가 필요해요.', en: 'ta.bb: mult must be a number.' });
    const mid = sma(src, P(length, 'ta.bb')), sd = stdev(src, length);
    const upper = map((i) => mid[i]! + m * sd[i]!), lower = map((i) => mid[i]! - m * sd[i]!);
    return { upper, mid, lower, width: map((i) => (upper[i]! - lower[i]!) / mid[i]!) };
  }
  function dmi(length = 14, adxSmoothing = 14): { plus: Series; minus: Series; adx: Series } {
    const p = P(length, 'ta.dmi'), sm = P(adxSmoothing, 'ta.dmi', 'adxSmoothing');
    const plusDM = out(), minusDM = out();
    for (let i = 1; i < n; i++) {
      const up = bars.high[i]! - bars.high[i - 1]!, down = bars.low[i - 1]! - bars.low[i]!;
      plusDM[i] = up > down && up > 0 ? up : 0;
      minusDM[i] = down > up && down > 0 ? down : 0;
    }
    const tr = rma(trueRange(true), p), pr = rma(plusDM, p), mr = rma(minusDM, p);
    const plus = fixnan(map((i) => (100 * pr[i]!) / tr[i]!)), minus = fixnan(map((i) => (100 * mr[i]!) / tr[i]!));
    const dx = map((i) => {
      const sum = plus[i]! + minus[i]!;
      return Math.abs(plus[i]! - minus[i]!) / (sum === 0 ? 1 : sum);
    });
    const a = rma(dx, sm);
    return { plus, minus, adx: map((i) => 100 * a[i]!) };
  }
  /** SuperTrend on hl2 ± factor × ATR. dir: 1 = uptrend (line under price), -1 = downtrend. */
  function supertrend(factor = 3, atrLength = 10): { line: Series; dir: Series } {
    const f = Number(factor);
    if (!Number.isFinite(f) || f <= 0) throw bad({ ko: 'ta.supertrend의 factor에는 0보다 큰 숫자가 필요해요.', en: 'ta.supertrend: factor must be a number above 0.' });
    const a = atr(P(atrLength, 'ta.supertrend', 'atrLength')), line = out(), dir = out(), c = bars.close;
    let prevUpper = NAN, prevLower = NAN, prevLine = NAN;
    for (let i = 0; i < n; i++) {
      const mid = (bars.high[i]! + bars.low[i]!) / 2;
      let upper = mid + f * a[i]!, lower = mid - f * a[i]!;
      const pl = Number.isNaN(prevLower) ? 0 : prevLower, pu = Number.isNaN(prevUpper) ? 0 : prevUpper;
      if (i > 0) {
        lower = lower > pl || c[i - 1]! < pl ? lower : pl;
        upper = upper < pu || c[i - 1]! > pu ? upper : pu;
      }
      let d: number;
      if (i === 0 || Number.isNaN(a[i - 1]!)) d = -1;
      else if (prevLine === prevUpper) d = c[i]! > upper ? 1 : -1;
      else d = c[i]! < lower ? -1 : 1;
      const v = d === 1 ? lower : upper;
      if (!Number.isNaN(a[i]!)) {
        line[i] = v;
        dir[i] = d;
      }
      prevUpper = upper;
      prevLower = lower;
      prevLine = v;
    }
    return { line, dir };
  }

  // ── volume ──────────────────────────────────────────────────────
  function obv(): Series {
    const o = out();
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) sum += Math.sign(bars.close[i]! - bars.close[i - 1]!) * bars.volume[i]!;
      o[i] = sum;
    }
    return o;
  }

  // ── conditions ──────────────────────────────────────────────────
  function crossover(a: Src, b: Src): Cond {
    const x = S(a, 'ta.crossover', 'a'), y = S(b, 'ta.crossover', 'b'), o = cond();
    for (let i = 1; i < n; i++) o[i] = x[i]! > y[i]! && x[i - 1]! <= y[i - 1]! ? 1 : 0;
    return o;
  }
  function crossunder(a: Src, b: Src): Cond {
    const x = S(a, 'ta.crossunder', 'a'), y = S(b, 'ta.crossunder', 'b'), o = cond();
    for (let i = 1; i < n; i++) o[i] = x[i]! < y[i]! && x[i - 1]! >= y[i - 1]! ? 1 : 0;
    return o;
  }
  function cross(a: Src, b: Src): Cond {
    const u = crossover(a, b), d = crossunder(a, b);
    return Cond.from(u, (v, i) => (v || d[i] ? 1 : 0)) as Cond;
  }
  /** Higher than every one of the previous `length` values. */
  function rising(src: Src, length: number): Cond {
    const s = S(src, 'ta.rising'), p = P(length, 'ta.rising'), o = cond();
    for (let i = p; i < n; i++) {
      let up = true;
      for (let j = 1; j <= p && up; j++) up = s[i]! > s[i - j]!;
      o[i] = up ? 1 : 0;
    }
    return o;
  }
  function falling(src: Src, length: number): Cond {
    const s = S(src, 'ta.falling'), p = P(length, 'ta.falling'), o = cond();
    for (let i = p; i < n; i++) {
      let down = true;
      for (let j = 1; j <= p && down; j++) down = s[i]! < s[i - j]!;
      o[i] = down ? 1 : 0;
    }
    return o;
  }
  /** A pivot high, known `right` bars later: its value on the bar that confirms it, NaN elsewhere. */
  function pivot(src: Src, left: number, right: number, fn: string, higher: boolean): Series {
    const s = S(src, fn), l = P(left, fn, 'left'), r = P(right, fn, 'right'), o = out();
    for (let i = l + r; i < n; i++) {
      const c = i - r, v = s[c]!;
      if (Number.isNaN(v)) continue;
      let ok = true;
      for (let j = c - l; j <= c + r && ok; j++) if (j !== c) ok = higher ? v > s[j]! : v < s[j]!;
      if (ok) o[i] = v;
    }
    return o;
  }
  const pivothigh = (src: Src, left: number, right: number) => pivot(src, left, right, 'ta.pivothigh', true);
  const pivotlow = (src: Src, left: number, right: number) => pivot(src, left, right, 'ta.pivotlow', false);
  /** Bars since the condition was last true (0 on that bar); NaN before it ever was. */
  function barssince(c: unknown): Series {
    const x = C(c, 'ta.barssince'), o = out();
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (x[i]) last = i;
      if (last >= 0) o[i] = i - last;
    }
    return o;
  }
  /** `src` on the bar where the condition was true, the `occurrence`-th most recent time (0 = latest). */
  function valuewhen(c: unknown, src: Src, occurrence = 0): Series {
    const x = C(c, 'ta.valuewhen'), s = S(src, 'ta.valuewhen'), k = P(occurrence, 'ta.valuewhen', 'occurrence', 0), o = out();
    const hits: number[] = [];
    for (let i = 0; i < n; i++) {
      if (x[i]) hits.push(s[i]!);
      if (hits.length > k) o[i] = hits[hits.length - 1 - k]!;
    }
    return o;
  }

  // ── time: days, weeks, months in the market's zone ──────────────
  const zones = new Map<string, Float64Array>();
  /** Each bar's offset from UTC in `tz` (a zone Intl knows), worked out once per zone. */
  function offsetsIn(tz: unknown, fn: string): Float64Array {
    const zone = tz === undefined || tz === null ? defaultZone : tz;
    if (!isTimeZone(zone))
      throw bad(
        { ko: `${fn}: 시간대 '${String(zone).slice(0, 40)}'을(를) 몰라요.`, en: `${fn}: unknown time zone '${String(zone).slice(0, 40)}'.` },
        { ko: "'Asia/Seoul', 'UTC', 'America/New_York'처럼 써요.", en: "Write it like 'Asia/Seoul', 'UTC' or 'America/New_York'." },
      );
    const have = zones.get(zone);
    if (have) return have;
    if (zones.size >= MAX_ZONES) throw new ScriptError('LIMIT', { ko: `시간대는 한 스크립트에 ${MAX_ZONES}가지까지예요.`, en: `At most ${MAX_ZONES} time zones per script.` });
    const off = offsets(bars.time, zone);
    zones.set(zone, off);
    return off;
  }
  /** A period ('D' 'W' 'M' 'Y') or a condition, as "a new period starts here" per bar. */
  function startsOf(anchor: unknown, fn: string, tz?: unknown): Uint8Array {
    if (typeof anchor === 'string') {
      if (!(PERIODS as readonly string[]).includes(anchor))
        throw bad({ ko: `${fn}의 anchor는 'D'(하루) · 'W'(주) · 'M'(달) · 'Y'(해)이거나 조건이에요.`, en: `${fn}: anchor is 'D' (day), 'W' (week), 'M' (month), 'Y' (year) or a condition.` });
      const keys = periodKeys(bars.time, offsetsIn(tz, fn), anchor as Period), o = cond();
      for (let i = 0; i < n; i++) o[i] = i === 0 || keys[i] !== keys[i - 1] ? 1 : 0;
      return o;
    }
    const c = C(anchor, fn, 'anchor');
    if (c.length !== n) throw bad({ ko: `${fn}의 anchor 길이가 봉 수와 달라요.`, en: `${fn}: anchor's length differs from the number of bars.` });
    return c;
  }

  // ── more indicators ─────────────────────────────────────────────
  /** Volume-weighted average price since the start of each period (or since the anchor condition was last true). */
  function vwapOf(src: Src, anchor: unknown, fn: string, mult?: number) {
    const s = S(src, fn), starts = startsOf(anchor, fn), v = bars.volume;
    const mid = out(), upper = out(), lower = out();
    let pv = 0, vol = 0, pv2 = 0;
    for (let i = 0; i < n; i++) {
      if (starts[i]) pv = vol = pv2 = 0;
      const x = s[i]!, w = v[i]!;
      if (!Number.isNaN(x) && w > 0) {
        pv += x * w;
        pv2 += x * x * w;
        vol += w;
      }
      if (vol > 0) {
        const m = pv / vol;
        mid[i] = m;
        if (mult !== undefined) {
          const sd = Math.sqrt(Math.max(0, pv2 / vol - m * m));
          upper[i] = m + mult * sd;
          lower[i] = m - mult * sd;
        }
      }
    }
    return { mid, upper, lower };
  }
  const hlc3 = () => map((i) => (bars.high[i]! + bars.low[i]! + bars.close[i]!) / 3);
  const vwap = (src?: Src, anchor: unknown = 'D') => vwapOf(src ?? hlc3(), anchor, 'ta.vwap').mid;
  function vwapbands(src?: Src, anchor: unknown = 'D', mult = 1): { vwap: Series; upper: Series; lower: Series } {
    const m = Number(mult);
    if (!(Number.isFinite(m) && m >= 0)) throw bad({ ko: 'ta.vwapbands의 mult에는 0 이상의 숫자가 필요해요.', en: 'ta.vwapbands: mult must be a number of 0 or more.' });
    const r = vwapOf(src ?? hlc3(), anchor, 'ta.vwapbands', m);
    return { vwap: r.mid, upper: r.upper, lower: r.lower };
  }

  /** Parabolic SAR (Wilder), as the usual reference implementation: start, step and the cap of the acceleration factor. */
  function sar(start = 0.02, inc = 0.02, max = 0.2): Series {
    const a0 = Number(start), da = Number(inc), am = Number(max);
    if (!(a0 > 0 && da >= 0 && am >= a0 && am <= 1)) throw bad({ ko: 'ta.sar은 0 < start ≤ max ≤ 1, inc ≥ 0이에요. 예: ta.sar(0.02, 0.02, 0.2)', en: 'ta.sar: 0 < start ≤ max ≤ 1 and inc ≥ 0, e.g. ta.sar(0.02, 0.02, 0.2).' });
    const h = bars.high, l = bars.low, c = bars.close, o = out();
    let result = NAN, maxMin = NAN, acc = a0, below = false;
    for (let i = 1; i < n; i++) {
      let first = false;
      if (i === 1) {
        below = c[1]! > c[0]!;
        maxMin = below ? h[1]! : l[1]!;
        result = below ? l[0]! : h[0]!;
        first = true;
        acc = a0;
      }
      result += acc * (maxMin - result);
      if (below) {
        if (result > l[i]!) {
          first = true;
          below = false;
          result = Math.max(h[i]!, maxMin);
          maxMin = l[i]!;
          acc = a0;
        }
      } else if (result < h[i]!) {
        first = true;
        below = true;
        result = Math.min(l[i]!, maxMin);
        maxMin = h[i]!;
        acc = a0;
      }
      if (!first) {
        if (below && h[i]! > maxMin) (maxMin = h[i]!), (acc = Math.min(acc + da, am));
        else if (!below && l[i]! < maxMin) (maxMin = l[i]!), (acc = Math.min(acc + da, am));
      }
      if (below) {
        result = Math.min(result, l[i - 1]!);
        if (i > 1) result = Math.min(result, l[i - 2]!);
      } else {
        result = Math.max(result, h[i - 1]!);
        if (i > 1) result = Math.max(result, h[i - 2]!);
      }
      o[i] = result;
    }
    return o;
  }

  /** Keltner channels: EMA ± mult × EMA of the true range (or of high − low). */
  function kc(src: Src, length = 20, mult = 2, useTrueRange = true): { upper: Series; mid: Series; lower: Series } {
    const m = Number(mult);
    if (!Number.isFinite(m)) throw bad({ ko: 'ta.kc의 mult에는 숫자가 필요해요.', en: 'ta.kc: mult must be a number.' });
    const p = P(length, 'ta.kc'), mid = ema(src, p);
    const span = useTrueRange === false ? map((i) => bars.high[i]! - bars.low[i]!) : trueRange(false);
    const r = ema(span, p);
    return { upper: map((i) => mid[i]! + m * r[i]!), mid, lower: map((i) => mid[i]! - m * r[i]!) };
  }
  /** Keltner channel width: (upper − lower) / mid. */
  function kcw(src: Src, length = 20, mult = 2, useTrueRange = true): Series {
    const k = kc(src, length, mult, useTrueRange);
    return map((i) => (k.upper[i]! - k.lower[i]!) / k.mid[i]!);
  }
  /** Bollinger band width: (upper − lower) / mid. */
  const bbw = (src: Src, length = 20, mult = 2) => bb(src, length, mult).width;
  /** Williams %R: −100 (at the low of the period) … 0 (at its high). */
  function wpr(length = 14): Series {
    const p = P(length, 'ta.wpr'), hh = highest(bars.high as Series, p), ll = lowest(bars.low as Series, p);
    return map((i) => (hh[i] === ll[i] ? NAN : (100 * (bars.close[i]! - hh[i]!)) / (hh[i]! - ll[i]!)));
  }
  /** Chande momentum oscillator: 100 × (sum of gains − sum of losses) / (their total) over length. */
  function cmo(src: Src, length = 9): Series {
    const s = S(src, 'ta.cmo'), p = P(length, 'ta.cmo'), o = out();
    for (let i = p; i < n; i++) {
      let up = 0, down = 0;
      for (let j = 0; j < p; j++) {
        const d = s[i - j]! - s[i - j - 1]!;
        if (d >= 0) up += d;
        else down -= d;
      }
      o[i] = up + down === 0 ? 0 : (100 * (up - down)) / (up + down);
    }
    return o;
  }
  /** True strength index, −1…1: the change smoothed twice (EMA long, then short) over the absolute change smoothed the same way. */
  function tsi(src: Src, short = 13, long = 25): Series {
    const s = S(src, 'ta.tsi'), sp = P(short, 'ta.tsi', 'short'), lp = P(long, 'ta.tsi', 'long');
    const pc = change(s, 1), apc = map((i) => Math.abs(pc[i]!));
    const num = ema(ema(pc, lp), sp), den = ema(ema(apc, lp), sp);
    return map((i) => (den[i] === 0 ? 0 : num[i]! / den[i]!));
  }
  /** Center of gravity (Ehlers): −Σ src[k]·(k+1) / Σ src[k] over the last length values, k bars back. */
  function cog(src: Src, length = 10): Series {
    const s = S(src, 'ta.cog'), p = P(length, 'ta.cog'), o = out();
    for (let i = p - 1; i < n; i++) {
      let num = 0, sum = 0;
      for (let k = 0; k < p; k++) {
        num += s[i - k]! * (k + 1);
        sum += s[i - k]!;
      }
      o[i] = sum === 0 ? NAN : -num / sum;
    }
    return o;
  }
  /** Symmetrically weighted MA of the last 4 values (1/6, 2/6, 2/6, 1/6). */
  function swma(src: Src): Series {
    const s = S(src, 'ta.swma'), o = out();
    for (let i = 3; i < n; i++) o[i] = (s[i - 3]! + 2 * s[i - 2]! + 2 * s[i - 1]! + s[i]!) / 6;
    return o;
  }

  // ── statistics over a window ────────────────────────────────────
  /** First index in sorted w[0..len) with w[k] ≥ x (or > x with `after`). */
  const bound = (w: Float64Array, len: number, x: number, after: boolean) => {
    let lo = 0, hi = len;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (after ? w[mid]! <= x : w[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /**
   * The last `p` values kept sorted (a window holding a NaN starts over after it): each bar costs a
   * binary search and one memmove, so medians and percentiles stay fast for long windows.
   * `read` gets the sorted window (oldest value already out, this bar's value in) — or, with
   * `before`, the previous p values without this bar's.
   */
  function sortedWindow(s: Float64Array, p: number, read: (w: Float64Array, len: number, v: number) => number, before = false): Series {
    const o = out(), w = new Float64Array(p);
    let len = 0;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      if (Number.isNaN(v)) {
        len = 0;
        continue;
      }
      if (before && len === p) o[i] = read(w, len, v);
      if (len === p) {
        const k = bound(w, len, s[i - p]!, false);
        w.copyWithin(k, k + 1, len);
        len--;
      }
      const k = bound(w, len, v, true);
      w.copyWithin(k + 1, k, len);
      w[k] = v;
      len++;
      if (!before && len === p) o[i] = read(w, len, v);
    }
    return o;
  }
  const pctOf = (w: Float64Array, len: number, q: number) => {
    const pos = (q / 100) * (len - 1), lo = Math.floor(pos), hi = Math.min(len - 1, lo + 1);
    return w[lo]! + (w[hi]! - w[lo]!) * (pos - lo);
  };
  const median = (src: Src, length: number) => sortedWindow(S(src, 'ta.median'), P(length, 'ta.median'), (w, len) => pctOf(w, len, 50));
  /** The value at `percent` (0–100) of the last length values, interpolating between the two nearest. */
  function percentile(src: Src, length: number, percent: number): Series {
    const q = Number(percent);
    if (!(q >= 0 && q <= 100)) throw bad({ ko: 'ta.percentile의 percent는 0~100이에요.', en: 'ta.percentile: percent runs from 0 to 100.' });
    return sortedWindow(S(src, 'ta.percentile'), P(length, 'ta.percentile'), (w, len) => pctOf(w, len, q));
  }
  /** The most frequent of the last length values (the smallest on a tie). */
  const mode = (src: Src, length: number) =>
    sortedWindow(S(src, 'ta.mode'), P(length, 'ta.mode'), (w, len) => {
      let best = w[0]!, bestRun = 0;
      for (let k = 0; k < len; ) {
        let j = k;
        while (j < len && w[j] === w[k]) j++;
        if (j - k > bestRun) (bestRun = j - k), (best = w[k]!);
        k = j;
      }
      return best;
    });
  /** % of the previous length values that are at or below this one. */
  const percentrank = (src: Src, length: number) => {
    const p = P(length, 'ta.percentrank');
    return sortedWindow(S(src, 'ta.percentrank'), p, (w, len, v) => (100 * bound(w, len, v, true)) / p, true);
  };
  /** Highest − lowest of the last length values. */
  function range(src: Src, length: number): Series {
    const hi = extreme(src, length, 'ta.range', true), lo = extreme(src, length, 'ta.range', false);
    return map((i) => hi[i]! - lo[i]!);
  }
  /** Mean absolute deviation from the length-bar average. */
  function dev(src: Src, length: number): Series {
    const s = S(src, 'ta.dev'), p = P(length, 'ta.dev'), mean = sma(s, p), o = out();
    for (let i = p - 1; i < n; i++) {
      if (Number.isNaN(mean[i]!)) continue;
      let sum = 0;
      for (let j = 0; j < p; j++) sum += Math.abs(s[i - j]! - mean[i]!);
      o[i] = sum / p;
    }
    return o;
  }
  /** Variance (population, as stdev) of the last length values. */
  function variance(src: Src, length: number): Series {
    const sd = stdev(src, P(length, 'ta.variance'));
    return map((i) => sd[i]! * sd[i]!);
  }
  /** Pearson correlation of a and b over the last length bars (−1…1). */
  function correlation(a: Src, b: Src, length: number): Series {
    const x = S(a, 'ta.correlation', 'a'), y = S(b, 'ta.correlation', 'b'), p = P(length, 'ta.correlation', 'length', 2), o = out();
    const mx = sma(x, p), my = sma(y, p);
    for (let i = p - 1; i < n; i++) {
      if (Number.isNaN(mx[i]!) || Number.isNaN(my[i]!)) continue;
      let sxy = 0, sxx = 0, syy = 0;
      for (let j = 0; j < p; j++) {
        const dx = x[i - j]! - mx[i]!, dy = y[i - j]! - my[i]!;
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
      }
      o[i] = sxx === 0 || syy === 0 ? NAN : sxy / Math.sqrt(sxx * syy);
    }
    return o;
  }
  /**
   * Rank correlation index, −100…100: how closely the last length values are ranked like time
   * (100: each newer value higher). Ties share their average rank.
   */
  function rci(src: Src, length = 9): Series {
    const s = S(src, 'ta.rci'), p = P(length, 'ta.rci', 'length', 2), o = out();
    const wv = new Float64Array(p), wi = new Int32Array(p);
    let len = 0;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      if (Number.isNaN(v)) {
        len = 0;
        continue;
      }
      if (len === p) {
        let k = bound(wv, len, s[i - p]!, false);
        while (wi[k] !== i - p) k++;
        wv.copyWithin(k, k + 1, len);
        wi.copyWithin(k, k + 1, len);
        len--;
      }
      const k = bound(wv, len, v, true);
      wv.copyWithin(k + 1, k, len);
      wi.copyWithin(k + 1, k, len);
      wv[k] = v;
      wi[k] = i;
      len++;
      if (len < p) continue;
      let d2 = 0;
      for (let a = 0; a < len; ) {
        let b = a;
        while (b < len && wv[b] === wv[a]) b++;
        // Highest = rank 1: positions a…b−1 (ascending) share the average of ranks len−a … len−b+1.
        const priceRank = len - (a + b - 1) / 2;
        for (let k2 = a; k2 < b; k2++) {
          const timeRank = i - wi[k2]! + 1;
          d2 += (timeRank - priceRank) ** 2;
        }
        a = b;
      }
      o[i] = (1 - (6 * d2) / (p * (p * p - 1))) * 100;
    }
    return o;
  }

  // ── volume and money flow ───────────────────────────────────────
  const cumulative = (f: (i: number) => number) => {
    const o = out();
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = f(i);
      if (Number.isFinite(v)) sum += v;
      o[i] = sum;
    }
    return o;
  };
  const { open: O, high: H, low: L, close: CL, volume: V } = bars;
  /** Accumulation / distribution: the running total of the close's place in the bar's range × volume. */
  const accdist = () => cumulative((i) => (H[i] === L[i] ? 0 : ((CL[i]! - L[i]! - (H[i]! - CL[i]!)) / (H[i]! - L[i]!)) * V[i]!));
  /** Price-volume trend: the running total of the % change × volume. */
  const pvt = () => cumulative((i) => (i === 0 ? 0 : ((CL[i]! - CL[i - 1]!) / CL[i - 1]!) * V[i]!));
  /** Negative / positive volume index: moves with the price only on bars where the volume fell / rose. Starts at 1. */
  function volumeIndex(positive: boolean): Series {
    const o = out();
    let x = 1;
    for (let i = 0; i < n; i++) {
      if (i > 0 && (positive ? V[i]! > V[i - 1]! : V[i]! < V[i - 1]!) && CL[i - 1]! !== 0) x += ((CL[i]! - CL[i - 1]!) / CL[i - 1]!) * x;
      o[i] = x;
    }
    return o;
  }
  /** Williams accumulation / distribution. */
  const wad = () =>
    cumulative((i) => {
      if (i === 0) return 0;
      const pc = CL[i - 1]!, c = CL[i]!;
      return c > pc ? c - Math.min(L[i]!, pc) : c < pc ? c - Math.max(H[i]!, pc) : 0;
    });
  /** Williams variable accumulation / distribution, per bar: (close − open) / (high − low) × volume. */
  const wvad = () => map((i) => (H[i] === L[i] ? 0 : ((CL[i]! - O[i]!) / (H[i]! - L[i]!)) * V[i]!));
  /** Intraday intensity index, per bar: (2·close − high − low) / ((high − low) × volume). */
  const iii = () => map((i) => (H[i] === L[i] || !V[i] ? 0 : (2 * CL[i]! - H[i]! - L[i]!) / ((H[i]! - L[i]!) * V[i]!)));
  /** The highest / lowest value so far (all bars up to this one). */
  function allTime(src: Src, fn: string, higher: boolean): Series {
    const s = S(src, fn), o = out();
    let best = NAN;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      if (!Number.isNaN(v) && (Number.isNaN(best) || (higher ? v > best : v < best))) best = v;
      o[i] = best;
    }
    return o;
  }

  // ── levels ──────────────────────────────────────────────────────
  const PIVOT_TYPES = ['traditional', 'fibonacci', 'woodie', 'classic', 'camarilla'] as const;
  /**
   * Pivot point levels from the previous period's high, low and close (Woodie: this period's open
   * too), the same all through the current period; NaN in the first one.
   */
  function pivots(type: string = 'traditional', anchor: unknown = 'D'): Record<'p' | 'r1' | 'r2' | 'r3' | 's1' | 's2' | 's3', Series> {
    if (!(PIVOT_TYPES as readonly string[]).includes(type))
      throw bad({ ko: `ta.pivots의 type은 ${PIVOT_TYPES.join(', ')} 중 하나예요.`, en: `ta.pivots: type is one of ${PIVOT_TYPES.join(', ')}.` });
    const starts = startsOf(anchor, 'ta.pivots');
    const keys = ['p', 'r1', 'r2', 'r3', 's1', 's2', 's3'] as const;
    const res = Object.fromEntries(keys.map((k) => [k, out()])) as Record<(typeof keys)[number], Series>;
    let ph = NAN, pl = NAN, pc = NAN, h = NAN, l = NAN, lv: number[] | null = null;
    for (let i = 0; i < n; i++) {
      if (starts[i] && i > 0) {
        ph = h;
        pl = l;
        pc = CL[i - 1]!;
        h = l = NAN;
        const r = ph - pl;
        let P_ = (ph + pl + pc) / 3;
        if (type === 'woodie') P_ = (ph + pl + 2 * O[i]!) / 4;
        if (type === 'fibonacci') lv = [P_, P_ + 0.382 * r, P_ + 0.618 * r, P_ + r, P_ - 0.382 * r, P_ - 0.618 * r, P_ - r];
        else if (type === 'camarilla') lv = [P_, pc + (1.1 * r) / 12, pc + (1.1 * r) / 6, pc + (1.1 * r) / 4, pc - (1.1 * r) / 12, pc - (1.1 * r) / 6, pc - (1.1 * r) / 4];
        else if (type === 'woodie') lv = [P_, 2 * P_ - pl, P_ + r, ph + 2 * (P_ - pl), 2 * P_ - ph, P_ - r, pl - 2 * (ph - P_)];
        else if (type === 'classic') lv = [P_, 2 * P_ - pl, P_ + r, P_ + 2 * r, 2 * P_ - ph, P_ - r, P_ - 2 * r];
        else lv = [P_, 2 * P_ - pl, P_ + r, 2 * P_ + (ph - 2 * pl), 2 * P_ - ph, P_ - r, 2 * P_ - (2 * ph - pl)];
      }
      h = Number.isNaN(h) ? H[i]! : Math.max(h, H[i]!);
      l = Number.isNaN(l) ? L[i]! : Math.min(l, L[i]!);
      if (lv) keys.forEach((k, j) => (res[k][i] = lv![j]!));
    }
    return res;
  }
  /**
   * Ichimoku lines, not shifted: plot spanA / spanB with offset: base − 1 (25 by default) and the
   * lagging line as close with offset: −(base − 1).
   */
  function ichimoku(conversion = 9, base = 26, spanB = 52): { conversion: Series; base: Series; spanA: Series; spanB: Series } {
    const mid = (p: number, arg: string) => {
      const q = P(p, 'ta.ichimoku', arg), hh = highest(H as Series, q), ll = lowest(L as Series, q);
      return map((i) => (hh[i]! + ll[i]!) / 2);
    };
    const c = mid(conversion, 'conversion'), b = mid(base, 'base');
    return { conversion: c, base: b, spanA: map((i) => (c[i]! + b[i]!) / 2), spanB: mid(spanB, 'spanB') };
  }

  // ── series helpers ──────────────────────────────────────────────
  /** A Series built bar by bar, oldest first (outer variables carry state from bar to bar). */
  function map(fn: (i: number) => unknown): Series {
    if (typeof fn !== 'function') throw bad({ ko: 'map에는 함수가 필요해요. 예: map(i => close[i] - open[i])', en: 'map needs a function, e.g. map(i => close[i] - open[i]).' });
    const o = out();
    for (let i = 0; i < n; i++) {
      const v = fn(i);
      const num = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
      o[i] = Number.isFinite(num) ? num : NAN;
    }
    return o;
  }
  const zip = (fn: string, f: (x: number, y: number) => number) => (a: Src, b: Src) => {
    const x = S(a, fn, 'a'), y = S(b, fn, 'b');
    return map((i) => f(x[i]!, y[i]!));
  };
  const test = (fn: string, f: (x: number, y: number) => boolean) => (a: Src, b: Src): Cond => {
    const x = S(a, fn, 'a'), y = S(b, fn, 'b');
    return Cond.from(x, (v, i) => (f(v, y[i]!) ? 1 : 0)) as Cond;
  };
  function fixnan(src: Src): Series {
    const s = S(src, 'fixnan'), o = out();
    let last = NAN;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(s[i]!)) last = s[i]!;
      o[i] = last;
    }
    return o;
  }

  const ta = {
    sma, ema, rma, wma, vwma, hma, dema, tema, linreg, alma, swma, vwap, vwapbands,
    highest, lowest, highestbars, lowestbars, max: (src: Src) => allTime(src, 'ta.max', true), min: (src: Src) => allTime(src, 'ta.min', false),
    change, roc, mom: change, cum, stdev, variance, dev, range, median, mode, percentile, percentrank, correlation,
    rsi, stoch, macd, cci, mfi, wpr, cmo, tsi, cog, rci,
    atr, tr: () => trueRange(false), bb, bbw, kc, kcw, dmi, adx: (length = 14, smoothing = 14) => dmi(length, smoothing).adx, supertrend, sar, ichimoku, pivots,
    obv, accdist, pvt, nvi: () => volumeIndex(false), pvi: () => volumeIndex(true), wad, wvad, iii,
    crossover, crossunder, cross, rising, falling, pivothigh, pivotlow, barssince, valuewhen,
  };

  const calc = {
    add: zip('add', (x, y) => x + y),
    sub: zip('sub', (x, y) => x - y),
    mul: zip('mul', (x, y) => x * y),
    div: zip('div', (x, y) => (y === 0 ? NAN : x / y)),
    max: zip('max', Math.max),
    min: zip('min', Math.min),
    abs: (a: Src) => {
      const x = S(a, 'abs');
      return map((i) => Math.abs(x[i]!));
    },
    avg: (...xs: Src[]) => {
      if (!xs.length) throw bad({ ko: 'avg에는 값이 하나 이상 필요해요.', en: 'avg needs at least one value.' });
      const ss = xs.map((x, k) => S(x, 'avg', `#${k + 1}`));
      return map((i) => ss.reduce((sum, s) => sum + s[i]!, 0) / ss.length);
    },
    gt: test('gt', (x, y) => x > y),
    lt: test('lt', (x, y) => x < y),
    gte: test('gte', (x, y) => x >= y),
    lte: test('lte', (x, y) => x <= y),
    eq: test('eq', (x, y) => x === y),
    and: (a: unknown, b: unknown) => {
      const x = C(a, 'and', 'a'), y = C(b, 'and', 'b');
      return Cond.from(x, (v, i) => (v && y[i] ? 1 : 0)) as Cond;
    },
    or: (a: unknown, b: unknown) => {
      const x = C(a, 'or', 'a'), y = C(b, 'or', 'b');
      return Cond.from(x, (v, i) => (v || y[i] ? 1 : 0)) as Cond;
    },
    not: (a: unknown) => Cond.from(C(a, 'not', 'a'), (v) => (v ? 0 : 1)) as Cond,
    /** The value `bars` bars ago, per bar. */
    prev: (src: Src, back = 1) => {
      const s = S(src, 'prev'), p = P(back, 'prev', 'bars'), o = out();
      for (let i = p; i < n; i++) o[i] = s[i - p]!;
      return o;
    },
    /** The latest bar's value, as a number. */
    last: (src: Src) => {
      const s = S(src, 'last');
      return n ? s[n - 1]! : NAN;
    },
    /** NaN replaced by `value` (0 by default). */
    nz: (src: Src, value = 0) => {
      const s = S(src, 'nz');
      return map((i) => (Number.isNaN(s[i]!) ? value : s[i]!));
    },
    fixnan,
    map,
  };

  return { ta, calc, n, clock: { offsetsIn, startsOf, zone: defaultZone } };
}
