import { describe, expect, it } from 'vitest';
import { backtest, execute, levelFor, transferables, type Strategy } from '../src/index';
import type { Bars } from '../src/lib';

/** stopLoss / takeProfit per side ({ long, short }): each position uses its own side's level. */

const bars = (rows: [number, number, number, number][]): Bars => ({
  open: Float64Array.from(rows, (r) => r[0]),
  high: Float64Array.from(rows, (r) => r[1]),
  low: Float64Array.from(rows, (r) => r[2]),
  close: Float64Array.from(rows, (r) => r[3]),
  volume: new Float64Array(rows.length).fill(1),
  time: Float64Array.from(rows, (_, i) => i * 3_600_000),
});
const list = (b: Bars) => Array.from(b.close, (_, i) => ({ time: b.time[i]!, open: b.open[i]!, high: b.high[i]!, low: b.low[i]!, close: b.close[i]! }));
const run = (code: string, b: Bars) => {
  const r = execute(`//@version=2\nindicator({ name: 'x', overlay: true })\n${code}`, b, {}, { locale: 'en' });
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('per-side stops and targets', () => {
  it('reads { long, short }: a % on one side, a price series on the other, a side left out', () => {
    const b = bars(Array.from({ length: 10 }, () => [100, 101, 99, 100] as [number, number, number, number]));
    const r = run(`strategy({ long: gt(close, 0), short: lt(close, 0), stopLoss: { long: 2, short: add(high, 1) }, takeProfit: { short: 3 } })`, b);
    const s = r.strategy!;
    expect(levelFor(s.stop, 1)).toEqual({ percent: 2 });
    expect('price' in levelFor(s.stop, -1)!).toBe(true);
    expect(levelFor(s.take, 1)).toBeNull();
    expect(levelFor(s.take, -1)).toEqual({ percent: 3 });
    // One number still means both sides, as before.
    const both = run(`strategy({ long: gt(close, 0), stopLoss: 2 })`, b).strategy!;
    expect([levelFor(both.stop, 1), levelFor(both.stop, -1)]).toEqual([{ percent: 2 }, { percent: 2 }]);
  });

  it('says how to write it when the object is off', () => {
    const b = bars([[1, 1, 1, 1], [1, 1, 1, 1]]);
    const r = execute(`//@version=2\nindicator({ name: 'x', overlay: true })\nstrategy({ long: gt(close, 0), stopLoss: { buy: 2 } })`, b, {}, { locale: 'en' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\{ long, short \}/);
  });

  it('a two-way strategy: the long is stopped below, the short above — the same series used to sit on one side', () => {
    // Long from bar 1 at 100; bar 2 dips to 96 (long stop 97 hit). Short from bar 4 at 100; bar 5 spikes to 104 (short stop 103 hit).
    const b = bars([
      [100, 100, 100, 100],
      [100, 101, 99, 100],
      [99, 100, 96, 98],
      [100, 100, 100, 100],
      [100, 101, 99, 100],
      [101, 104, 100, 102],
      [100, 100, 100, 100],
    ]);
    const code = `const longOn = map((i) => i === 0)
const shortOn = map((i) => i === 3)
strategy({ long: longOn, short: shortOn, reverse: false, stopLoss: { long: sub(close, 3), short: add(close, 3) }, fee: 0, slippage: 0 })`;
    const t = backtest(list(b), run(code, b).strategy!).trades;
    expect(t.map((x) => [x.side, x.reason, x.exitPrice])).toEqual([
      ['long', 'stop', 97],
      ['short', 'stop', 103],
    ]);
    // The old way (one series for both): the short's stop sat below the price and closed it at once.
    const old = `const longOn = map((i) => i === 0)
const shortOn = map((i) => i === 3)
strategy({ long: longOn, short: shortOn, reverse: false, stopLoss: sub(close, 3), fee: 0, slippage: 0 })`;
    const o = backtest(list(b), run(old, b).strategy!).trades;
    expect(o[1]).toMatchObject({ side: 'short', reason: 'stop', bars: 0 });
  });

  it('the same series on both sides is handed over once (a Worker would refuse it twice)', () => {
    const b = bars(Array.from({ length: 5 }, () => [100, 101, 99, 100] as [number, number, number, number]));
    const r = execute(`//@version=2\nindicator({ name: 'x', overlay: true })\nconst s = sub(low, 1)\nstrategy({ long: gt(close, 0), stopLoss: { long: s, short: s } })`, b);
    expect(r.ok).toBe(true);
    const bufs = transferables(r);
    expect(new Set(bufs).size).toBe(bufs.length);
  });

  it('a backtest Strategy written by hand with one level still works', () => {
    const b = bars([[100, 100, 100, 100], [100, 100, 97, 98], [98, 98, 98, 98]]);
    const s: Strategy = { longEntry: Uint8Array.from([1, 0, 0]), longExit: null, shortEntry: null, shortExit: null, stop: { percent: 2 }, take: null, trail: null, size: 1, capital: 10_000, fee: 0, slippage: 0, reverse: true };
    expect(backtest(list(b), s).trades[0]).toMatchObject({ reason: 'stop', exitPrice: 98 });
  });
});
