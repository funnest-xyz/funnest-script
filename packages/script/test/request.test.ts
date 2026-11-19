import { describe, expect, it } from 'vitest';
import { alignBars, barsKey, dataKey, type RequestedBars } from '../src/request';
import { execute } from '../src/runtime';
import type { Bars } from '../src/lib';

const H = 3_600_000, D = 24 * H;
const day0 = Date.UTC(2026, 0, 5);
// 72 hourly bars over three days; close = the hour of the run.
const hourly: Bars = {
  time: Float64Array.from({ length: 72 }, (_, i) => day0 + i * H),
  open: Float64Array.from({ length: 72 }, (_, i) => 100 + i),
  high: Float64Array.from({ length: 72 }, (_, i) => 101 + i),
  low: Float64Array.from({ length: 72 }, (_, i) => 99 + i),
  close: Float64Array.from({ length: 72 }, (_, i) => 100 + i),
  volume: Float64Array.from({ length: 72 }, () => 1),
};
const daily: RequestedBars = {
  time: Float64Array.from([day0 - D, day0, day0 + D, day0 + 2 * D]),
  open: Float64Array.from([90, 100, 124, 148]),
  high: Float64Array.from([99, 124, 148, 172]),
  low: Float64Array.from([89, 99, 123, 147]),
  close: Float64Array.from([99, 123, 147, 171]),
  volume: Float64Array.from([1, 2, 3, 4]),
  resolutionMs: D,
};

describe('lining requested bars up with the chart', () => {
  it('a daily bar shows on hourly bars only after its day has closed', () => {
    const a = alignBars(hourly.time, H, daily);
    // Day 0's hours see the day before (closed at day0); its last hour (closing at day0 + D) sees day 0.
    expect(a.close[0]).toBe(99);
    expect(a.close[22]).toBe(99);
    expect(a.close[23]).toBe(123);
    expect(a.close[24]).toBe(123);
    expect(a.close[47]).toBe(147);
    expect(a.time[47]).toBe(day0 + D);
  });

  it('nothing before the first requested bar has closed', () => {
    const late = { ...daily, time: daily.time.map((t) => t + 10 * D) };
    expect(Number.isNaN(alignBars(hourly.time, H, late).close[71]!)).toBe(true);
  });

  it('a requested bar closes when the next one opens, if that is sooner (months, gaps)', () => {
    const months: RequestedBars = { ...daily, time: Float64Array.from([day0 - 40 * D, day0 - 12 * H, day0 + 1 * D, day0 + 60 * D]), resolutionMs: 31 * D };
    // The second "month" started 12 h before day0 and the third opens at day0 + 1 day: the second closes then.
    const a = alignBars(hourly.time, H, months);
    expect(a.close[22]).toBe(99);
    expect(a.close[23]).toBe(123);
  });
});

describe('request.bars / request.data in a script (two passes)', () => {
  const code = "//@version=2\nindicator({ name: 'R', overlay: true })\nconst d = request.bars({ timeframe: '1D' })\nconst f = request.data('funding')\nplot('Daily close', d.close)\nplot('Funding', f)\nlog(last(d.close), last(f))\n";

  it('the first pass records what is asked and gets NaN; the second gets the data', () => {
    const first = execute(code, hourly);
    if (!first.ok) throw new Error(first.error);
    expect(first.requests.map((r) => [r.key, r.missing])).toEqual([
      [barsKey(null, '1D'), true],
      [dataKey('funding', null), true],
    ]);
    expect(first.logs[0]).toBe('NaN NaN');
    const funding = Float64Array.from({ length: 72 }, (_, i) => i / 100);
    const second = execute(code, hourly, {}, { requests: { bars: { [barsKey(null, '1D')]: daily }, data: { [dataKey('funding', null)]: funding } } });
    if (!second.ok) throw new Error(second.error);
    expect(second.requests.every((r) => !r.missing)).toBe(true);
    expect(second.logs[0]).toBe('171 0.71');
  });

  it('a first pass that fails on NaN still reports its requests', () => {
    const r = execute("//@version=2\nindicator({ name: 'R', overlay: true })\nconst d = request.bars({ symbol: 'UPBIT:KRW-BTC' })\nif (Number.isNaN(last(d.close))) throw new Error('no data yet')\n", hourly);
    expect(r.ok).toBe(false);
    expect(r.requests[0]).toMatchObject({ kind: 'bars', symbol: 'UPBIT:KRW-BTC', timeframe: null, missing: true });
  });

  it('mistakes are explained', () => {
    const bad = (body: string) => {
      const r = execute(`//@version=2\nindicator({ name: 'R', overlay: true })\n${body}\n`, hourly, {}, { locale: 'en' });
      if (r.ok) throw new Error('expected an error');
      return r.error;
    };
    expect(bad("request.bars({ timeframe: '2D' })")).toMatch(/timeframe must be one of/);
    expect(bad('request.bars({})')).toMatch(/needs a symbol or a timeframe/);
    expect(bad("request.bars({ symbol: 'btc' })")).toMatch(/BINANCEF:BTCUSDT/);
    expect(bad("request.data('volume')")).toMatch(/funding, openInterest/);
    expect(bad("for (const t of ['1', '5', '15', '60', '240']) request.bars({ timeframe: t })")).toMatch(/At most 4/);
  });
});

describe('compute on the requested bars', () => {
  it('works out an indicator on the daily bars, then lines it up (no look-ahead)', () => {
    const code = "//@version=2\nindicator({ name: 'C', overlay: true })\nconst d = request.bars({ timeframe: '1D' })\nconst sma2 = d.compute((b) => b.ta.sma(b.close, 2))\nconst both = d.compute((b) => ({ hi: b.ta.highest(b.high, 2), mid: b.map((i) => (b.high[i] + b.low[i]) / 2) }))\nlog(sma2[0], sma2[23], sma2[47], both.hi[47], both.mid[47])\n";
    const r = execute(code, hourly, {}, { requests: { bars: { [barsKey(null, '1D')]: daily } } });
    if (!r.ok) throw new Error(r.error);
    // Daily closes 99, 123, 147, 171: SMA(2) on days is NaN, 111, 135, 159; hour 23 sees day 0 (111), hour 47 day 1 (135).
    expect(r.logs[0]).toBe('NaN 111 135 148 135.5');
  });

  it('without the data yet it gives NaN and does not call the function', () => {
    const r = execute("//@version=2\nindicator({ name: 'C', overlay: true })\nconst e = request.bars({ timeframe: '1D' }).compute(() => { throw new Error('not yet') })\nlog(e[71])\n", hourly);
    if (!r.ok) throw new Error(r.error);
    expect(r.logs[0]).toBe('NaN');
  });

  it('the function must give series over the requested bars', () => {
    const r = execute("//@version=2\nindicator({ name: 'C', overlay: true })\nrequest.bars({ timeframe: '1D' }).compute((b) => 5)\n", hourly, {}, { locale: 'en', requests: { bars: { [barsKey(null, '1D')]: daily } } });
    expect(!r.ok && r.error).toMatch(/must return a series over the requested bars/);
  });
});
