import { Cond, ScriptError, Series, empty, isSeries, type Text } from './series';

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

export function createLib(bars: Bars) {
  const n = bars.close.length;

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
  function extreme(src: Src, length: number, fn: string, higher: boolean): Series {
    const s = S(src, fn), p = P(length, fn), o = out();
    const q = new Int32Array(n);
    let head = 0, tail = 0, lastNaN = -1;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      if (Number.isNaN(v)) lastNaN = i;
      else {
        while (tail > head && (higher ? s[q[tail - 1]!]! <= v : s[q[tail - 1]!]! >= v)) tail--;
        q[tail++] = i;
      }
      while (tail > head && q[head]! <= i - p) head++;
      if (i >= p - 1 && lastNaN <= i - p && tail > head) o[i] = s[q[head]!]!;
    }
    return o;
  }
  const highest = (src: Src, length: number) => extreme(src, length, 'ta.highest', true);
  const lowest = (src: Src, length: number) => extreme(src, length, 'ta.lowest', false);
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
    sma, ema, rma, wma, vwma, hma, dema, tema, linreg, alma,
    highest, lowest, change, roc, mom: change, cum, stdev,
    rsi, stoch, macd, cci, mfi,
    atr, tr: () => trueRange(false), bb, dmi, adx: (length = 14, smoothing = 14) => dmi(length, smoothing).adx, supertrend,
    obv,
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

  return { ta, calc, n };
}
