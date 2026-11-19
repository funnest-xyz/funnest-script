import { describe, expect, it } from 'vitest';
import { createLib, type Bars } from '../src/lib';
import { Series } from '../src/series';

/** Bars from closes (high/low ±1, volume 100). */
function barsOf(closes: number[], extra: Partial<Record<'high' | 'low' | 'volume', number[]>> = {}): Bars {
  const f = (xs: number[]) => Float64Array.from(xs);
  return {
    open: f(closes),
    high: f(extra.high ?? closes.map((c) => c + 1)),
    low: f(extra.low ?? closes.map((c) => c - 1)),
    close: f(closes),
    volume: f(extra.volume ?? closes.map(() => 100)),
    time: f(closes.map((_, i) => i * 60_000)),
  };
}
const round = (s: ArrayLike<number>, d = 2) => Array.from(s, (v) => (Number.isNaN(v) ? null : Number(v.toFixed(d))));

// StockCharts' RSI worked example (14 periods, Wilder smoothing).
const RSI_CLOSES = [
  44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439,
  46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314,
];
const RSI_EXPECTED = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77];

describe('indicators', () => {
  it('RSI matches the standard (Wilder) worked example', () => {
    const { ta } = createLib(barsOf(RSI_CLOSES));
    const r = ta.rsi(Float64Array.from(RSI_CLOSES) as Series, 14);
    expect(round(r).slice(0, 14).every((v) => v === null)).toBe(true);
    expect(round(r).slice(14)).toEqual(RSI_EXPECTED);
  });

  it('SMA, EMA (seeded with the SMA), WMA, change, highest / lowest, cum', () => {
    const c = [1, 2, 3, 4, 5, 6];
    const { ta } = createLib(barsOf(c));
    const src = Float64Array.from(c) as Series;
    expect(round(ta.sma(src, 3))).toEqual([null, null, 2, 3, 4, 5]);
    // k = 0.5: seed (1+2+3)/3 = 2, then 4·0.5 + 2·0.5 = 3, 4, 5
    expect(round(ta.ema(src, 3))).toEqual([null, null, 2, 3, 4, 5]);
    expect(round(ta.wma(src, 3))).toEqual([null, null, 2.33, 3.33, 4.33, 5.33]);
    expect(round(ta.change(src, 2))).toEqual([null, null, 2, 2, 2, 2]);
    expect(round(ta.highest(src, 2))).toEqual([null, 2, 3, 4, 5, 6]);
    expect(round(ta.lowest(src, 2))).toEqual([null, 1, 2, 3, 4, 5]);
    expect(round(ta.cum(src))).toEqual([1, 3, 6, 10, 15, 21]);
  });

  it('MACD, Bollinger, ATR keep their shapes and known values', () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const { ta } = createLib(barsOf(c));
    const src = Float64Array.from(c) as Series;
    const m = ta.macd(src, 12, 26, 9);
    expect(Number.isNaN(m.macd[24]!)).toBe(true);
    expect(Number.isFinite(m.macd[25]!)).toBe(true);
    expect(m.hist[59]).toBeCloseTo(m.macd[59]! - m.signal[59]!, 10);
    const b = ta.bb(src, 20, 2);
    expect(b.upper[59]! - b.mid[59]!).toBeCloseTo(b.mid[59]! - b.lower[59]!, 10);
    // Every bar is 2 wide and closes at its open: the true range is 2 (or more after a gap).
    const atr = ta.atr(14);
    expect(atr[59]).toBeGreaterThanOrEqual(2);
  });

  it('crossover / crossunder / cross fire once, on the bar it happens', () => {
    const { ta } = createLib(barsOf([1, 1, 1, 1, 1]));
    const a = Float64Array.from([1, 2, 3, 2, 1]) as Series;
    const b = Float64Array.from([2, 2, 2, 2, 2]) as Series;
    expect(Array.from(ta.crossover(a, b))).toEqual([0, 0, 1, 0, 0]);
    expect(Array.from(ta.crossunder(a, b))).toEqual([0, 0, 0, 0, 1]);
    expect(Array.from(ta.cross(a, b))).toEqual([0, 0, 1, 0, 1]);
  });

  it('pivots appear on the bar that confirms them; barssince / valuewhen', () => {
    const c = [1, 3, 5, 3, 1, 2, 4, 2];
    const { ta } = createLib(barsOf(c));
    const src = Float64Array.from(c) as Series;
    // The 5 (bar 2) is a pivot high with 2 bars each side: known at bar 4.
    expect(round(ta.pivothigh(src, 2, 2))).toEqual([null, null, null, null, 5, null, null, null]);
    const up = ta.rising(src, 1);
    expect(Array.from(up)).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
    expect(round(ta.barssince(up))).toEqual([null, 0, 0, 1, 2, 0, 0, 1]);
    expect(round(ta.valuewhen(up, src, 0))).toEqual([null, 3, 5, 5, 5, 2, 4, 4]);
    expect(round(ta.valuewhen(up, src, 1))).toEqual([null, null, 3, 3, 3, 5, 2, 2]);
  });

  it('SuperTrend flips with the trend; DMI / ADX stay within 0–100', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i * 2);
    const down = Array.from({ length: 40 }, (_, i) => 178 - i * 3);
    const c = [...up, ...down];
    const { ta } = createLib(barsOf(c));
    const st = ta.supertrend(3, 10);
    expect(st.dir[35]).toBe(1);
    expect(st.dir[79]).toBe(-1);
    expect(st.line[35]!).toBeLessThan(c[35]!);
    expect(st.line[79]!).toBeGreaterThan(c[79]!);
    const d = ta.dmi(14, 14);
    for (const s of [d.plus, d.minus, d.adx]) for (const v of s) if (!Number.isNaN(v)) expect(v >= 0 && v <= 100).toBe(true);
    expect(d.plus[35]!).toBeGreaterThan(d.minus[35]!);
    expect(d.minus[79]!).toBeGreaterThan(d.plus[79]!);
  });

  it('helpers work element by element and take numbers too', () => {
    const { calc } = createLib(barsOf([1, 2, 3]));
    const a = Float64Array.from([1, 2, 3]) as Series;
    expect(round(calc.sub(a, 1))).toEqual([0, 1, 2]);
    expect(round(calc.div(a, 0))).toEqual([null, null, null]);
    expect(Array.from(calc.gt(a, 2))).toEqual([0, 0, 1]);
    expect(Array.from(calc.and(calc.gt(a, 1), calc.lt(a, 3)))).toEqual([0, 1, 0]);
    expect(round(calc.prev(a, 1))).toEqual([null, 1, 2]);
    expect(calc.last(a)).toBe(3);
    expect(round(calc.nz(calc.prev(a, 1), 0))).toEqual([0, 1, 2]);
  });

  it('bad arguments say what was expected', () => {
    const { ta } = createLib(barsOf([1, 2, 3]));
    expect(() => ta.sma(Float64Array.from([1, 2, 3]) as Series, 0)).toThrow(/length/);
    expect(() => ta.ema('close' as unknown as Series, 3)).toThrow(/series or a number/);
  });
});

describe('highest / lowest in one pass', () => {
  it('match comparing the whole window, NaN included', async () => {
    const { createLib } = await import('../src/lib');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const close = Float64Array.from({ length: 400 }, (_, i) => (i % 37 === 5 || i < 3 ? Number.NaN : Math.round(rnd() * 50)));
    const z = new Float64Array(400);
    const { ta } = createLib({ open: z, high: z, low: z, close, volume: z, time: z });
    for (const p of [1, 2, 5, 14, 50]) {
      const hi = ta.highest(close, p), lo = ta.lowest(close, p);
      for (let i = 0; i < 400; i++) {
        let h = Number.NaN, l = Number.NaN;
        if (i >= p - 1) {
          h = -Infinity; l = Infinity;
          for (let j = 0; j < p; j++) (h = Math.max(h, close[i - j]!)), (l = Math.min(l, close[i - j]!));
        }
        expect([hi[i], lo[i]]).toEqual([h, l]);
      }
    }
  });
});
