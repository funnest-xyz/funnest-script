import { describe, expect, it } from 'vitest';
import { createLib, type Bars } from '../src/lib';
import type { ScriptError } from '../src/series';
import { offsets, partOf, periodKeys } from '../src/time';

/** Deterministic bars: a random walk with ties and a NaN-free close (hourly from 2026-01-01 UTC). */
function walk(n: number, seed = 11, step = 3_600_000, start = Date.UTC(2026, 0, 1)): Bars {
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const close: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= 1 + rnd() * 0.04;
    // Round to 0.5 so equal values (ties) happen.
    close.push(Math.round(p * 2) / 2);
  }
  const f = (xs: number[]) => Float64Array.from(xs);
  return {
    open: f(close.map((c, i) => (i ? close[i - 1]! : c))),
    high: f(close.map((c, i) => Math.max(c, i ? close[i - 1]! : c) + 0.5)),
    low: f(close.map((c, i) => Math.min(c, i ? close[i - 1]! : c) - 0.5)),
    close: f(close),
    volume: f(close.map((_, i) => 100 + ((i * 37) % 50))),
    time: f(close.map((_, i) => start + i * step)),
  };
}

/** The window ending at i, oldest first (null while it isn't full or holds a NaN). */
const windowAt = (s: ArrayLike<number>, i: number, p: number) => {
  if (i < p - 1) return null;
  const w = Array.from({ length: p }, (_, k) => s[i - p + 1 + k]!);
  return w.some(Number.isNaN) ? null : w;
};
const near = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(b[i]!)) expect(a[i], `bar ${i}`).toBeNaN();
    else expect(a[i], `bar ${i}`).toBeCloseTo(b[i]!, 9);
  }
};

describe('window statistics match a plain sort of each window', () => {
  const bars = walk(400);
  // A gap in the middle: windows holding it have no value.
  const src = Float64Array.from(bars.close, (v, i) => (i === 150 ? Number.NaN : v));
  const { ta } = createLib(bars);
  const each = (p: number, f: (w: number[]) => number) => Float64Array.from(src, (_, i) => {
    const w = windowAt(src, i, p);
    return w ? f(w) : Number.NaN;
  });
  const sorted = (w: number[]) => [...w].sort((a, b) => a - b);
  const pct = (w: number[], q: number) => {
    const s = sorted(w), pos = (q / 100) * (s.length - 1), lo = Math.floor(pos), hi = Math.min(s.length - 1, lo + 1);
    return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
  };

  for (const p of [1, 2, 5, 20, 64]) {
    it(`median, percentile, mode (length ${p})`, () => {
      near(ta.median(src, p), each(p, (w) => pct(w, 50)));
      near(ta.percentile(src, p, 90), each(p, (w) => pct(w, 90)));
      near(ta.percentile(src, p, 0), each(p, (w) => Math.min(...w)));
      near(
        ta.mode(src, p),
        each(p, (w) => {
          const count = new Map<number, number>();
          for (const v of w) count.set(v, (count.get(v) ?? 0) + 1);
          let best = Number.NaN, n = 0;
          for (const [v, c] of [...count].sort((a, b) => a[0] - b[0])) if (c > n) (best = v), (n = c);
          return best;
        }),
      );
    });
  }

  it('percentrank: % of the previous length values at or below this one', () => {
    const p = 10;
    const want = Float64Array.from(src, (v, i) => {
      if (Number.isNaN(v)) return Number.NaN;
      const w = windowAt(src, i - 1, p);
      return w ? (100 * w.filter((x) => x <= v).length) / p : Number.NaN;
    });
    near(ta.percentrank(src, p), want);
  });

  it('range, dev, variance, highestbars / lowestbars', () => {
    const p = 14;
    near(ta.range(src, p), each(p, (w) => Math.max(...w) - Math.min(...w)));
    const mean = (w: number[]) => w.reduce((a, b) => a + b, 0) / w.length;
    near(ta.dev(src, p), each(p, (w) => mean(w.map((x) => Math.abs(x - mean(w))))));
    near(ta.variance(src, p), each(p, (w) => mean(w.map((x) => (x - mean(w)) ** 2))));
    // Bars back to the extreme; the most recent one when equal.
    near(ta.highestbars(src, p), each(p, (w) => w.length - 1 - w.lastIndexOf(Math.max(...w))));
    near(ta.lowestbars(src, p), each(p, (w) => w.length - 1 - w.lastIndexOf(Math.min(...w))));
  });

  it('rci: Spearman rank correlation with time (ties share their rank) × 100', () => {
    const p = 9;
    const rank = (w: number[]) => {
      // Highest value = 1; ties get the average of their ranks.
      const order = w.map((v, k) => [v, k] as const).sort((a, b) => b[0] - a[0]);
      const r = new Array<number>(w.length);
      for (let a = 0; a < order.length; ) {
        let b = a;
        while (b < order.length && order[b]![0] === order[a]![0]) b++;
        for (let k = a; k < b; k++) r[order[k]![1]] = (a + 1 + b) / 2;
        a = b;
      }
      return r;
    };
    near(
      ta.rci(src, p),
      each(p, (w) => {
        const pr = rank(w);
        // Newest = time rank 1.
        const d2 = w.reduce((sum, _, k) => sum + (w.length - k - pr[k]!) ** 2, 0);
        return (1 - (6 * d2) / (p * (p * p - 1))) * 100;
      }),
    );
  });

  it('correlation: 1 with itself, −1 with its mirror', () => {
    const c = ta.correlation(bars.close, bars.close, 20), m = ta.correlation(bars.close, Float64Array.from(bars.close, (v) => -v), 20);
    for (let i = 19; i < 400; i++) {
      if (Number.isNaN(c[i]!)) continue;
      expect(c[i]).toBeCloseTo(1, 9);
      expect(m[i]).toBeCloseTo(-1, 9);
    }
  });
});

describe('indicators on known values', () => {
  it('Williams %R: 0 at the period high, −100 at its low', () => {
    const b = walk(3);
    b.high.set([10, 12, 11]);
    b.low.set([8, 9, 7]);
    b.close.set([9, 12, 7]);
    const { ta } = createLib(b);
    const w = ta.wpr(2);
    expect(w[1]).toBeCloseTo(0, 10); // close = highest high
    expect(w[2]).toBeCloseTo(-100, 10); // close = lowest low
  });

  it('CMO: +100 when every change is up, the balance otherwise', () => {
    const b = walk(6);
    b.close.set([1, 2, 3, 4, 3, 5]);
    const { ta } = createLib(b);
    const c = ta.cmo(b.close, 3);
    expect(c[3]).toBeCloseTo(100, 10);
    expect(c[4]).toBeCloseTo((100 * (2 - 1)) / 3, 10); // +1 +1 −1
    expect(c[5]).toBeCloseTo((100 * (3 - 1)) / 4, 10); // +1 −1 +2
  });

  it('TSI stays within −1…1; SWMA and COG by hand', () => {
    const b = walk(300);
    const { ta } = createLib(b);
    for (const v of ta.tsi(b.close, 13, 25)) if (!Number.isNaN(v)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    const x = Float64Array.from([1, 2, 3, 4, 5]);
    const small = createLib({ ...walk(5), close: x });
    expect(small.ta.swma(x)[3]).toBeCloseTo((1 + 4 + 6 + 4) / 6, 10);
    expect(small.ta.cog(x, 3)[4]).toBeCloseTo(-(5 * 1 + 4 * 2 + 3 * 3) / 12, 10);
  });

  it('Keltner: EMA ± mult × EMA of the true range; widths', () => {
    const b = walk(200);
    const { ta } = createLib(b);
    const k = ta.kc(b.close, 20, 2), e = ta.ema(b.close, 20), r = ta.ema(ta.tr(), 20);
    near(k.mid, e);
    near(k.upper, Float64Array.from(e, (v, i) => v + 2 * r[i]!));
    near(ta.kcw(b.close, 20, 2), Float64Array.from(e, (v, i) => (4 * r[i]!) / v));
    near(ta.bbw(b.close, 20, 2), ta.bb(b.close, 20, 2).width);
  });

  it('Parabolic SAR sits under the lows in an uptrend and flips above when it breaks', () => {
    const n = 40;
    const b = walk(n);
    for (let i = 0; i < n; i++) {
      // Up for 25 bars, then a sharp fall.
      const c = i < 25 ? 100 + i : 125 - (i - 24) * 3;
      b.close[i] = c;
      b.open[i] = i ? b.close[i - 1]! : c;
      b.high[i] = Math.max(c, b.open[i]!) + 0.5;
      b.low[i] = Math.min(c, b.open[i]!) - 0.5;
    }
    const { ta } = createLib(b);
    const s = ta.sar(0.02, 0.02, 0.2);
    expect(s[0]).toBeNaN();
    for (let i = 2; i < 25; i++) expect(s[i]!).toBeLessThanOrEqual(b.low[i]!);
    const flip = [...s].findIndex((v, i) => i >= 25 && v > b.high[i]!);
    expect(flip).toBeGreaterThan(24);
    for (let i = flip; i < n; i++) expect(s[i]!).toBeGreaterThanOrEqual(b.high[i]!);
  });

  it('volume lines: A/D, PVT, NVI / PVI, WAD by hand', () => {
    const b = walk(3);
    b.high.set([11, 12, 12]);
    b.low.set([9, 10, 9]);
    b.close.set([10, 12, 10]);
    b.open.set([10, 10, 12]);
    b.volume.set([100, 200, 150]);
    const { ta } = createLib(b);
    near(ta.accdist(), [0, 200, 200 + (-1 / 3) * 150]);
    near(ta.pvt(), [0, 0.2 * 200, 0.2 * 200 + (-2 / 12) * 150]);
    near(ta.pvi(), [1, 1.2, 1.2]);
    near(ta.nvi(), [1, 1, 1 * (1 - 2 / 12)]);
    near(ta.wad(), [0, 12 - 10, 2 + (10 - 12)]);
    near(ta.wvad(), [0, (2 / 2) * 200, (-2 / 3) * 150]);
    near(ta.max(b.close), [10, 12, 12]);
    near(ta.min(b.close), [10, 10, 10]);
  });

  it('ichimoku: midpoints of the period high / low; spanA between conversion and base', () => {
    const b = walk(120);
    const { ta } = createLib(b);
    const k = ta.ichimoku(9, 26, 52);
    const mid = (p: number) => {
      const h = ta.highest(b.high, p), l = ta.lowest(b.low, p);
      return Float64Array.from(h, (v, i) => (v + l[i]!) / 2);
    };
    near(k.conversion, mid(9));
    near(k.base, mid(26));
    near(k.spanB, mid(52));
    near(k.spanA, Float64Array.from(k.conversion, (v, i) => (v + k.base[i]!) / 2));
  });
});

describe('days, weeks and zones', () => {
  it('VWAP starts over each day — the day of the market’s zone', () => {
    const b = walk(72); // 3 days of hourly bars from 00:00 UTC
    const utc = createLib(b), seoul = createLib(b, { timezone: 'Asia/Seoul' });
    const v = utc.ta.vwap(b.close, 'D');
    // The first bar of each UTC day is its own close.
    for (const i of [0, 24, 48]) expect(v[i]).toBeCloseTo(b.close[i]!, 10);
    // Seoul's day starts at 15:00 UTC.
    const s = seoul.ta.vwap(b.close, 'D');
    for (const i of [15, 39, 63]) expect(s[i]).toBeCloseTo(b.close[i]!, 10);
    expect(Math.abs(s[24]! - b.close[24]!)).toBeGreaterThan(0);
    // Bands: ±0 × deviation is the line itself; a condition as the anchor.
    const bands = utc.ta.vwapbands(b.close, 'D', 0);
    near(bands.upper, bands.vwap);
    const every6 = Uint8Array.from(b.close, (_, i) => (i % 6 === 0 ? 1 : 0));
    const c = utc.ta.vwap(b.close, every6);
    for (let i = 0; i < 72; i += 6) expect(c[i]).toBeCloseTo(b.close[i]!, 10);
  });

  it('pivot points from the previous day', () => {
    const b = walk(48);
    const { ta } = createLib(b);
    const pv = ta.pivots('traditional', 'D');
    let h = -Infinity, l = Infinity;
    for (let i = 0; i < 24; i++) (h = Math.max(h, b.high[i]!)), (l = Math.min(l, b.low[i]!));
    const c = b.close[23]!, P = (h + l + c) / 3;
    expect(pv.p[23]).toBeNaN();
    for (const i of [24, 30, 47]) {
      expect(pv.p[i]).toBeCloseTo(P, 10);
      expect(pv.r1[i]).toBeCloseTo(2 * P - l, 10);
      expect(pv.s2[i]).toBeCloseTo(P - (h - l), 10);
    }
    const cam = ta.pivots('camarilla', 'D');
    expect(cam.r3[30]).toBeCloseTo(c + (1.1 * (h - l)) / 4, 10);
    expect(() => ta.pivots('nope' as 'classic')).toThrow(/type/);
  });

  it('daylight saving: New York moves from UTC−5 to UTC−4 on 2026-03-08 at 07:00 UTC', () => {
    const t0 = Date.UTC(2026, 2, 8, 0);
    const time = Float64Array.from({ length: 24 * 30 }, (_, i) => t0 - 20 * 86_400_000 + i * 3_600_000);
    const off = offsets(time, 'America/New_York');
    for (let i = 0; i < time.length; i++) expect(off[i], new Date(time[i]!).toISOString()).toBe(time[i]! < Date.UTC(2026, 2, 8, 7) ? -5 * 3_600_000 : -4 * 3_600_000);
    const hours = partOf(time, off, 'hour');
    const at = time.indexOf(Date.UTC(2026, 2, 8, 7));
    expect([hours[at - 1], hours[at]]).toEqual([1, 3]); // 01:00 EST, then 03:00 EDT
  });

  it('weeks start on Monday; weekday 0 is Sunday', () => {
    // 2026-01-04 is a Sunday, 2026-01-05 a Monday.
    const time = Float64Array.from([Date.UTC(2026, 0, 4, 12), Date.UTC(2026, 0, 5, 0), Date.UTC(2026, 0, 11, 23)]);
    const off = new Float64Array(3);
    const w = periodKeys(time, off, 'W');
    expect(w[0]).not.toBe(w[1]);
    expect(w[1]).toBe(w[2]);
    expect(Array.from(partOf(time, off, 'dayofweek'))).toEqual([0, 1, 0]);
  });

  it('an unknown zone says how to write one', () => {
    const { ta } = createLib(walk(10), { timezone: 'Asia/Seoul' });
    expect(() => ta.vwap(undefined, 'Q')).toThrow(/anchor/);
    const lib = createLib(walk(10));
    try {
      lib.clock.offsetsIn('Mars/Base', 'date.hour');
      expect.unreachable();
    } catch (e) {
      expect((e as ScriptError).text.en).toMatch(/unknown time zone/);
      expect((e as ScriptError).hint?.en).toMatch(/Asia\/Seoul/);
    }
  });
});

describe('long windows stay fast', () => {
  it('5,000 bars: median / percentile / rci over 2,000 bars in well under a second each', () => {
    const b = walk(5000);
    const { ta } = createLib(b);
    for (const f of [() => ta.median(b.close, 2000), () => ta.percentile(b.close, 2000, 25), () => ta.rci(b.close, 2000), () => ta.percentrank(b.close, 2000)]) {
      const t = performance.now();
      f();
      expect(performance.now() - t).toBeLessThan(800);
    }
  });
});
