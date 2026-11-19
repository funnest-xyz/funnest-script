import { describe, expect, it } from 'vitest';
import { backtest, type BacktestBar } from '../src/backtest';
import { execute } from '../src/runtime';
import type { Strategy } from '../src/strategy';
import type { Bars } from '../src/lib';

// The fill rules, each on hand-made bars where the right answer is known. No fees unless asked.
const bar = (open: number, high: number, low: number, close: number, i: number): BacktestBar => ({ time: i * 60_000, open, high, low, close });
const bars = (rows: [number, number, number, number][]) => rows.map((r, i) => bar(...r, i));
const on = (n: number, ...at: number[]) => Uint8Array.from({ length: n }, (_, i) => (at.includes(i) ? 1 : 0));
const strat = (n: number, s: Partial<Strategy>): Strategy => ({ longEntry: null, longExit: null, shortEntry: null, shortExit: null, stop: null, take: null, trail: null, size: 1, capital: 10_000, fee: 0, slippage: 0, reverse: true, ...s });
const flat = (n: number, p = 100) => Array.from({ length: n }, () => [p, p + 1, p - 1, p] as [number, number, number, number]);

describe('backtest fills', () => {
  it('a signal fills at the next open; the exit signal too', () => {
    const b = bars([[100, 101, 99, 100], [100, 101, 99, 100], [102, 103, 101, 102], [104, 105, 103, 104], [106, 107, 105, 106], [110, 111, 109, 110]]);
    const r = backtest(b, strat(6, { longEntry: on(6, 1), longExit: on(6, 3) }));
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ side: 'long', entryPrice: 102, exitPrice: 106, reason: 'signal', bars: 2 });
    expect(r.totalReturn).toBeCloseTo(106 / 102 - 1, 10);
  });

  it('the old { entry, exit, side } still works', () => {
    const b = bars([[100, 101, 99, 100], [100, 101, 99, 100], [102, 103, 101, 102], [104, 105, 103, 104], [106, 107, 105, 106]]);
    const r = backtest(b, { entry: on(5, 1), exit: on(5, 3), side: 'short' }, { fee: 0, slippage: 0 });
    expect(r.trades[0]).toMatchObject({ side: 'short', entryPrice: 102, exitPrice: 106 });
    expect(r.trades[0]!.ret).toBeCloseTo(-(106 / 102 - 1), 10);
  });

  it('a stop inside a bar fills at the stop; opening beyond it fills at the open (a gap)', () => {
    const inside = bars([...flat(2), [100, 101, 97, 99], [99, 100, 98, 99]]);
    const r = backtest(inside, strat(4, { longEntry: on(4, 0), stop: { percent: 2 } }));
    expect(r.trades[0]).toMatchObject({ entryPrice: 100, exitPrice: 98, reason: 'stop' });
    const gap = bars([...flat(2), [95, 96, 94, 95], [95, 96, 94, 95]]);
    expect(backtest(gap, strat(4, { longEntry: on(4, 0), stop: { percent: 2 } })).trades[0]).toMatchObject({ exitPrice: 95, reason: 'stop' });
  });

  it('a bar reaching both the stop and the target takes the stop', () => {
    const b = bars([...flat(2), [100, 106, 97, 100]]);
    const r = backtest(b, strat(3, { longEntry: on(3, 0), stop: { percent: 2 }, take: { percent: 5 } }));
    expect(r.trades[0]).toMatchObject({ exitPrice: 98, reason: 'stop' });
  });

  it('a target fills at the target; the entry bar counts', () => {
    const b = bars([[100, 101, 99, 100], [100, 104, 99.5, 103], [103, 104, 102, 103]]);
    const r = backtest(b, strat(3, { longEntry: on(3, 0), take: { percent: 3 } }));
    expect(r.trades[0]).toMatchObject({ entryPrice: 100, exitPrice: 103, reason: 'take', bars: 0 });
  });

  it('a trailing stop follows the best price (up to the bar before)', () => {
    // Enter 100; highs 110, 120; then a bar dips to 107 → trail 10% under 120 = 108.
    const b = bars([[100, 101, 99, 100], [100, 110, 99.5, 109], [109, 120, 108.5, 119], [119, 119, 107, 108]]);
    const r = backtest(b, strat(4, { longEntry: on(4, 0), trail: 10 }));
    expect(r.trades[0]).toMatchObject({ exitPrice: 108, reason: 'trail' });
  });

  it('a short: the stop is above, the target below', () => {
    const b = bars([...flat(2), [100, 101, 96, 97]]);
    const r = backtest(b, strat(3, { shortEntry: on(3, 0), stop: { percent: 2 }, take: { percent: 3 } }));
    expect(r.trades[0]).toMatchObject({ side: 'short', exitPrice: 97, reason: 'take' });
    expect(r.trades[0]!.ret).toBeCloseTo(0.03, 10);
  });

  it('a price-series stop reads the bar before', () => {
    const b = bars([...flat(3), [100, 101, 95, 96]]);
    const stop = Float64Array.from([90, 90, 99, 80]); // 99 known at bar 2's close → applies on bar 3
    const r = backtest(b, strat(4, { longEntry: on(4, 0), stop: { price: stop } }));
    expect(r.trades[0]).toMatchObject({ exitPrice: 99, reason: 'stop' });
  });

  it('an entry the other way turns the position (reverse), unless reverse is off', () => {
    const b = bars([[100, 101, 99, 100], [100, 101, 99, 100], [102, 103, 101, 102], [104, 105, 103, 104], [98, 99, 97, 98]]);
    const s = { longEntry: on(5, 0), shortEntry: on(5, 2) };
    const r = backtest(b, strat(5, s));
    expect(r.trades.map((t) => [t.side, t.entryPrice, t.exitPrice, t.reason])).toEqual([
      ['long', 100, 104, 'reverse'],
      ['short', 104, 98, 'end'],
    ]);
    expect(r.long.trades).toBe(1);
    expect(r.short.trades).toBe(1);
    const off = backtest(b, strat(5, { ...s, reverse: false }));
    expect(off.trades.map((t) => [t.side, t.reason])).toEqual([['long', 'end']]);
  });

  it('size uses part of the account; fees and slippage come off every fill', () => {
    const b = bars([[100, 101, 99, 100], [100, 111, 99, 110], [110, 111, 109, 110]]);
    const half = backtest(b, strat(3, { longEntry: on(3, 0), longExit: on(3, 1), size: 0.5 }));
    expect(half.totalReturn).toBeCloseTo(0.05, 10); // +10% on half
    expect(half.finalEquity).toBeCloseTo(10_500, 6);
    expect(half.trades[0]!.pnl).toBeCloseTo(500, 6);
    const costly = backtest(b, strat(3, { longEntry: on(3, 0), longExit: on(3, 1), fee: 0.001, slippage: 0.001 }));
    const want = (0.999 * (110 * 0.999)) / (100 * 1.001) * 0.999 - 1;
    expect(costly.totalReturn).toBeCloseTo(want, 10);
  });

  it('stats: win rate, payoff, losing streak, reasons', () => {
    const b = bars([
      [100, 101, 99, 100],
      [100, 101, 99, 100], // enter long
      [100, 101, 97, 98], // stop 2% → 98 (loss)
      [100, 101, 99, 100], // enter
      [100, 101, 96, 97], // stop (loss)
      [100, 101, 99, 100], // enter
      [100, 106, 99.5, 105], // take 5% (win)
    ]);
    const r = backtest(b, strat(7, { longEntry: on(7, 0, 2, 4), stop: { percent: 2 }, take: { percent: 5 } }));
    expect(r.trades.map((t) => t.reason)).toEqual(['stop', 'stop', 'take']);
    expect(r.maxLosingStreak).toBe(2);
    expect(r.winRate).toBeCloseTo(1 / 3, 10);
    expect(r.payoff).toBeCloseTo(0.05 / 0.02, 10);
    expect(r.reasons).toEqual({ stop: 2, take: 1 });
  });
});

describe('strategy() in a script', () => {
  const N = 200;
  const c = Array.from({ length: N }, (_, i) => 100 + Math.sin(i / 10) * 10);
  const data: Bars = {
    open: Float64Array.from(c, (v, i) => (i ? c[i - 1]! : v)),
    high: Float64Array.from(c, (v) => v + 1),
    low: Float64Array.from(c, (v) => v - 1),
    close: Float64Array.from(c),
    volume: Float64Array.from(c, () => 1),
    time: Float64Array.from(c, (_, i) => i * 3_600_000),
  };
  const head = "//@version=2\nindicator({ name: 'S', overlay: true })\nconst f = ta.ema(close, 5), s = ta.ema(close, 20)\n";
  const run = (body: string) => execute(head + body, data, {}, { locale: 'en' });

  it('long and short with stop, target, trail, size and costs', () => {
    const r = run('strategy({ long: ta.crossover(f, s), short: ta.crossunder(f, s), stopLoss: 2, takeProfit: sub(high, 0), trailingStop: 3, size: 50, capital: 1000, fee: 0.1, slippage: 0.02, reverse: false })\n');
    if (!r.ok) throw new Error(r.error);
    const st = r.strategy!;
    expect(st.longEntry && st.shortEntry).toBeTruthy();
    expect(st.longExit).toBeNull();
    expect(st.stop).toEqual({ percent: 2 });
    expect(st.take && 'price' in st.take).toBe(true);
    expect([st.trail, st.size, st.capital, st.fee, st.slippage, st.reverse]).toEqual([3, 0.5, 1000, 0.001, 0.0002, false]);
    const bt = backtest(Array.from({ length: N }, (_, i) => ({ time: data.time[i]!, open: data.open[i]!, high: data.high[i]!, low: data.low[i]!, close: data.close[i]! })), st);
    expect(bt.trades.length).toBeGreaterThan(0);
    expect(bt.capital).toBe(1000);
  });

  it('the old form maps onto the new one', () => {
    const r = run("strategy({ entry: ta.crossover(f, s), exit: ta.crossunder(f, s), side: 'short' })\n");
    if (!r.ok) throw new Error(r.error);
    expect(r.strategy!.shortEntry && r.strategy!.shortExit).toBeTruthy();
    expect(r.strategy!.longEntry).toBeNull();
  });

  it('mistakes are explained', () => {
    const bad = (body: string) => {
      const r = run(body);
      if (r.ok) throw new Error('expected an error');
      return r.error;
    };
    expect(bad('strategy({ long: ta.crossover(f, s), stoploss: 2 })\n')).toMatch(/unknown option stoploss/);
    expect(bad('strategy({ longExit: ta.crossunder(f, s) })\n')).toMatch(/needs an entry/);
    expect(bad('strategy({ long: ta.crossover(f, s), stopLoss: 150 })\n')).toMatch(/percent above 0 and below 100/);
    expect(bad('strategy({ entry: ta.crossover(f, s), long: ta.crossover(f, s) })\n')).toMatch(/not both/);
    expect(bad('strategy({ entry: ta.crossover(f, s) })\n')).toMatch(/needs exit/);
  });
});
