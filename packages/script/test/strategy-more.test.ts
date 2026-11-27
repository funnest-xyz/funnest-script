import { describe, expect, it } from 'vitest';
import { backtest, type BacktestBar } from '../src/backtest';
import type { Bars } from '../src/lib';
import { atOpen, guardsAt, hitAt, nextBest, nextOrder, orderHit, type EntryOrder, type Held } from '../src/live';
import { execute } from '../src/runtime';
import type { Strategy } from '../src/strategy';

// Hand-made bars where the right answer is known; no fees or slippage unless asked.
const bars = (rows: [number, number, number, number][]): BacktestBar[] => rows.map(([open, high, low, close], i) => ({ time: i * 3_600_000, open, high, low, close }));
const on = (n: number, ...at: number[]) => Uint8Array.from({ length: n }, (_, i) => (at.includes(i) ? 1 : 0));
const strat = (s: Partial<Strategy>): Strategy => ({ longEntry: null, longExit: null, shortEntry: null, shortExit: null, stop: null, take: null, trail: null, size: 1, capital: 10_000, fee: 0, slippage: 0, reverse: true, ...s });
const flat = (n: number, p = 100): [number, number, number, number][] => Array.from({ length: n }, () => [p, p + 0.5, p - 0.5, p]);

describe('partial targets and break-even', () => {
  it('half at +2%, the rest at +5%: two exits, each its share', () => {
    const b = bars([[100, 100.5, 99.5, 100], [100, 101, 99.5, 100.5], [100.5, 102.5, 100, 102], [102, 103, 101, 102.5], [102.5, 106, 102, 105]]);
    const r = backtest(b, strat({ longEntry: on(5, 0), steps: [{ level: { percent: 2 }, part: 0.5 }, { level: { percent: 5 }, part: 1 }] }));
    expect(r.trades.map((t) => [t.reason, t.exitPrice, t.part])).toEqual([['take', 102, 0.5], ['take', 105, 0.5]]);
    expect(r.totalReturn).toBeCloseTo(0.5 * 0.02 + 0.5 * 0.05, 10);
  });

  it('break-even: after the first target the stop is the entry price — from the next bar', () => {
    // Bar 2 reaches +2% and dips under the entry in the same bar (not stopped); bar 3 falls under it (stopped at 100).
    const b = bars([[100, 100.5, 99.5, 100], [100, 100.5, 99.8, 100], [100, 102.5, 99.6, 101], [101, 101.5, 99, 99.5]]);
    const s = strat({ longEntry: on(4, 0), stop: { percent: 3 }, steps: [{ level: { percent: 2 }, part: 0.5 }, { level: { percent: 5 }, part: 1 }], breakEven: true });
    const r = backtest(b, s);
    expect(r.trades.map((t) => [t.reason, t.exitPrice, t.part, t.exitTime / 3_600_000])).toEqual([['take', 102, 0.5, 2], ['stop', 100, 0.5, 3]]);
    // Without break-even the original 3% stop (97) isn't reached.
    expect(backtest(b, { ...s, breakEven: false }).trades.map((t) => t.reason)).toEqual(['take', 'end']);
  });

  it('several targets in one bar, in order', () => {
    const b = bars([[100, 100.5, 99.5, 100], [100, 110, 99.5, 109]]);
    const r = backtest(b, strat({ longEntry: on(2, 0), steps: [{ level: { percent: 2 }, part: 0.3 }, { level: { percent: 4 }, part: 0.3 }, { level: { percent: 6 }, part: 1 }] }));
    expect(r.trades.map((t) => t.exitPrice)).toEqual([102, 104, 106]);
    expect(r.trades.map((t) => +t.part.toFixed(6))).toEqual([0.3, 0.3, 0.4]);
  });
});

describe('time exit, entry orders, pyramiding', () => {
  it('exitAfter: closes at the open N bars after the entry', () => {
    const r = backtest(bars(flat(8)), strat({ longEntry: on(8, 0), exitAfter: 3 }));
    expect(r.trades[0]).toMatchObject({ reason: 'time', entryTime: 1 * 3_600_000, exitTime: 4 * 3_600_000 });
  });

  it('a limit below the close fills when the price dips to it; a stop above fills on the breakout (or at a gap open)', () => {
    const b = bars([[100, 100.5, 99.5, 100], [100, 100.5, 97, 98.5], [98.5, 99, 98, 98.5]]);
    const price = (v: number) => ({ price: new Float64Array(3).fill(v) });
    const limit = backtest(b, strat({ longEntry: on(3, 0), entryPrice: price(98) }));
    expect(limit.trades[0]).toMatchObject({ entryPrice: 98, entryTime: 3_600_000 });
    // Not reached within entryBars: no trade.
    expect(backtest(b, strat({ longEntry: on(3, 0), entryPrice: price(96) })).trades).toHaveLength(0);
    const up = bars([[100, 100.5, 99.5, 100], [100, 104, 99.5, 103.5], [106, 107, 105, 106]]);
    expect(backtest(up, strat({ longEntry: on(3, 0), entryPrice: price(103) })).trades[0]).toMatchObject({ entryPrice: 103 });
    const gap = bars([[100, 100.5, 99.5, 100], [105, 106, 104.5, 105.5], [105, 106, 104, 105]]);
    expect(backtest(gap, strat({ longEntry: on(3, 0), entryPrice: price(103) })).trades[0]).toMatchObject({ entryPrice: 105 });
  });

  it('an order waits entryBars bars, then is dropped; an exit signal drops it too', () => {
    const b = bars([[100, 100.5, 99.5, 100], [100, 100.5, 99.5, 100], [100, 100.5, 99.5, 100], [100, 100.5, 97, 98]]);
    const price = { price: new Float64Array(4).fill(98) };
    expect(backtest(b, strat({ longEntry: on(4, 0), entryPrice: price, entryBars: 3 })).trades).toHaveLength(1);
    expect(backtest(b, strat({ longEntry: on(4, 0), entryPrice: price, entryBars: 2 })).trades).toHaveLength(0);
    expect(backtest(b, strat({ longEntry: on(4, 0), longExit: on(4, 1), entryPrice: price, entryBars: 3 })).trades).toHaveLength(0);
  });

  it('pyramiding: a second entry the same way adds at the average price; the exit closes both', () => {
    const b = bars([[100, 100.5, 99.5, 100], [100, 100.5, 99.5, 100], [110, 110.5, 109.5, 110], [110, 120.5, 109.5, 120], [120, 120.5, 119.5, 120]]);
    const r = backtest(b, strat({ longEntry: on(5, 0, 1), longExit: on(5, 3), size: 0.5, pyramiding: 2 }));
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0]!;
    expect(t.entries).toBe(2);
    // Half the account at 100, half of the rest at 110: units-weighted average.
    const u1 = 0.5 / 100, u2 = 0.25 / 110;
    expect(t.entryPrice).toBeCloseTo((u1 * 100 + u2 * 110) / (u1 + u2), 10);
    expect(r.totalReturn).toBeCloseTo(u1 * 20 + u2 * 10, 10);
    // Without pyramiding the second signal is ignored.
    expect(backtest(b, strat({ longEntry: on(5, 0, 1), longExit: on(5, 3), size: 0.5 })).trades[0]!.entries).toBe(1);
  });
});

describe('leverage and sizing', () => {
  it('leverage multiplies the move; a long at 5× is liquidated near −19.5%', () => {
    const up = bars([[100, 100.5, 99.5, 100], [100, 100.5, 99.5, 100], [100, 110.5, 99.5, 110], [110, 110.5, 109.5, 110]]);
    expect(backtest(up, strat({ longEntry: on(4, 0), longExit: on(4, 2), leverage: 2 })).totalReturn).toBeCloseTo(0.2, 10);
    const down = bars([[100, 100.5, 99.5, 100], [100, 100.5, 99.5, 100], [100, 100.5, 75, 76], [76, 77, 75, 76]]);
    const r = backtest(down, strat({ longEntry: on(4, 0), leverage: 5 }));
    expect(r.trades[0]).toMatchObject({ reason: 'liquidation' });
    expect(r.trades[0]!.exitPrice).toBeCloseTo(100 * (1 - (0.2 - 0.005)), 10);
    expect(r.totalReturn).toBeCloseTo(-0.975, 6); // the maintenance margin is all that's left
  });

  it('fees are on the traded value (leverage × margin)', () => {
    const b = bars([[100, 100.5, 99.5, 100], [100, 100.5, 99.5, 100], [100, 100.5, 99.5, 100]]);
    const r = backtest(b, strat({ longEntry: on(3, 0), longExit: on(3, 1), leverage: 3, fee: 0.001 }));
    // In: 0.3% of the margin; out: 0.1% of 3 × what's left.
    const margin = 1 - 3 * 0.001;
    expect(r.totalReturn).toBeCloseTo(margin - 3 * margin * 0.001 - 1, 10);
  });

  it('amount and qty: a fixed sum or a fixed quantity per entry', () => {
    const b = bars([[100, 100.5, 99.5, 100], [100, 100.5, 99.5, 100], [110, 110.5, 109.5, 110], [110, 110.5, 109.5, 110]]);
    expect(backtest(b, strat({ longEntry: on(4, 0), longExit: on(4, 1), amount: 1000 })).totalReturn).toBeCloseTo(0.01, 10);
    expect(backtest(b, strat({ longEntry: on(4, 0), longExit: on(4, 1), qty: 20 })).trades[0]!.pnl).toBeCloseTo(200, 6);
  });

  it('monthly returns compound to the total', () => {
    const n = 24 * 70;
    const rows = Array.from({ length: n }, (_, i): BacktestBar => {
      const p = 100 + 10 * Math.sin(i / 50);
      return { time: Date.UTC(2026, 0, 1) + i * 3_600_000, open: p, high: p + 1, low: p - 1, close: p };
    });
    const entries = Uint8Array.from({ length: n }, (_, i) => (i % 97 === 0 ? 1 : 0));
    const exits = Uint8Array.from({ length: n }, (_, i) => (i % 97 === 50 ? 1 : 0));
    const r = backtest(rows, strat({ longEntry: entries, longExit: exits }));
    expect(r.monthly.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(r.monthly.reduce((a, m) => a * (1 + m.ret), 1) - 1).toBeCloseTo(r.totalReturn, 10);
  });
});

describe('a script asks for them', () => {
  const b: Bars = (() => {
    const n = 300;
    const close = Float64Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 15) + i * 0.02);
    return { open: close.map((c, i) => (i ? close[i - 1]! : c)), high: close.map((c) => c + 1), low: close.map((c) => c - 1), close, volume: close.map(() => 1), time: Float64Array.from({ length: n }, (_, i) => i * 3_600_000) };
  })();
  const head = "//@version=2\nindicator({ name: 's', overlay: true })\nconst f = ta.ema(close, 5), s = ta.ema(close, 20)\n";
  const run = (line: string) => execute(head + line, b, {}, { locale: 'en' });

  it('reads every new option', () => {
    const r = run('strategy({ long: ta.crossover(f, s), stopLoss: 2, takeProfit: [{ at: 1, close: 40 }, { at: 3 }], breakEven: true, exitAfter: 20, entryPrice: { long: ta.lowest(low, 3) }, entryBars: 2, pyramiding: 3, leverage: 3, amount: 500 })');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.strategy!;
    expect(st.take).toBeNull();
    expect(st.steps).toEqual([{ level: { percent: 1 }, part: 0.4 }, { level: { percent: 3 }, part: 1 }]);
    expect([st.breakEven, st.exitAfter, st.entryBars, st.pyramiding, st.leverage, st.amount, st.qty]).toEqual([true, 20, 2, 3, 3, 500, null]);
    expect(st.entryPrice && 'long' in st.entryPrice && st.entryPrice.long && 'price' in st.entryPrice.long).toBe(true);
    // Targets per side: a list for longs, one level for shorts.
    const sided = run('strategy({ long: ta.crossover(f, s), short: ta.crossunder(f, s), takeProfit: { long: [{ at: 2, close: 50 }, { at: 4 }], short: 3 } })');
    expect(sided.ok && sided.strategy!.steps).toEqual({ long: [{ level: { percent: 2 }, part: 0.5 }, { level: { percent: 4 }, part: 1 }], short: [{ level: { percent: 3 }, part: 1 }] });
  });

  it('says what is wrong', () => {
    for (const [line, want] of [
      ['strategy({ long: ta.crossover(f, s), takeProfit: [{ at: 2, close: 70 }, { at: 4, close: 50 }] })', /adding up to 100/],
      ['strategy({ long: ta.crossover(f, s), takeProfit: [{ at: 2, close: 50 }, { price: 4 }] })', /\{ at, close \}/],
      ['strategy({ long: ta.crossover(f, s), takeProfit: 3, breakEven: true })', /list of targets/],
      ['strategy({ long: ta.crossover(f, s), size: 50, amount: 100 })', /one of size, amount and qty/],
      ['strategy({ long: ta.crossover(f, s), leverage: 0.5 })', /leverage/],
      ['strategy({ long: ta.crossover(f, s), pyramiding: 1.5 })', /whole number/],
      ['strategy({ long: ta.crossover(f, s), entryPrice: 100 })', /price per bar/],
    ] as const) {
      const r = run(line);
      expect(r.ok, line).toBe(false);
      if (!r.ok) expect(r.error, line).toMatch(want);
    }
  });
});

/**
 * The live rules fed one price at a time — the open, then the side against the position (or the
 * order), then the other — make the same trades as the backtest, with the new rules too.
 */
function liveTrades(b: Bars, s: Strategy) {
  const n = b.close.length;
  const out: { side: string; entryTime: number; exitTime: number; reason: string }[] = [];
  type Pos = Held & { at: number; stepBar: number };
  let held: Pos | null = null;
  let waiting: EntryOrder | null = null;
  const view = (h: Pos, i: number): Held => ({ ...h, armed: (h.steps ?? 0) > 0 && h.stepBar < i, age: i - h.at });
  const record = (i: number, reason: string) => out.push({ side: held!.dir > 0 ? 'long' : 'short', entryTime: b.time[held!.at]!, exitTime: b.time[i]!, reason });
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      if (held) held.best = nextBest(held, b.high[i - 1]!, b.low[i - 1]!);
      const act = atOpen(s, i - 1, held ? view(held, i) : null, b.close[i - 1]!);
      if (act.close && held) {
        record(i, act.close);
        held = null;
      }
      waiting = nextOrder(s, i - 1, waiting, act, held ? (held as Pos).dir : null);
      if (act.open) held = { dir: act.open, price: b.open[i]!, best: b.open[i]!, at: i, steps: 0, stepBar: -1, entries: 1 };
    }
    const dir = held?.dir ?? waiting?.dir ?? 1;
    const ticks = dir > 0 ? [b.open[i]!, b.low[i]!, b.high[i]!] : [b.open[i]!, b.high[i]!, b.low[i]!];
    let afterBreakout = false;
    for (let t = 0; t < 3; t++) {
      const price = ticks[t]!;
      let filledNow = false;
      if (waiting && orderHit(waiting, price)) {
        const fill = t === 0 ? price : waiting.price;
        held = { dir: waiting.dir, price: fill, best: fill, at: i, steps: 0, stepBar: -1, entries: 1 };
        afterBreakout = waiting.kind === 'stop' && t > 0;
        filledNow = t === 0;
        waiting = null;
      }
      if (!held || filledNow || (t === 0 && held.at === i)) continue;
      for (let k = 0; held && k <= 5; k++) {
        const h: Pos = held;
        const g = guardsAt(s, view(h, i), i);
        const hit = hitAt(h, g, price);
        if (!hit || (hit !== 'take' && afterBreakout)) break;
        if (hit !== 'take') {
          record(i, hit);
          held = null;
          break;
        }
        h.steps = (h.steps ?? 0) + 1;
        h.stepBar = i;
        record(i, 'take');
        if (g.takeRest) held = null;
      }
    }
  }
  return out;
}

describe('live rules = backtest rules (new rules)', () => {
  const makeBars = (n: number, seed: number): Bars => {
    let x = seed;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
    const close: number[] = [];
    let p = 100;
    for (let i = 0; i < n; i++) close.push((p *= 1 + rnd() * 0.03 + Math.sin(i / 30) * 0.004));
    const f = (xs: number[]) => Float64Array.from(xs);
    return {
      open: f(close.map((c, i) => (i ? close[i - 1]! : c))),
      high: f(close.map((c, i) => Math.max(c, i ? close[i - 1]! : c) * (1 + Math.abs(rnd()) * 0.01))),
      low: f(close.map((c, i) => Math.min(c, i ? close[i - 1]! : c) * (1 - Math.abs(rnd()) * 0.01))),
      close: f(close),
      volume: f(close.map(() => 1)),
      time: f(close.map((_, i) => i * 3_600_000)),
    };
  };
  const rows = (b: Bars) => Array.from(b.close, (_, i) => ({ time: b.time[i]!, open: b.open[i]!, high: b.high[i]!, low: b.low[i]!, close: b.close[i]! }));
  const cases: [string, string][] = [
    ['partial targets with break-even', 'strategy({ long: ta.crossover(f, s), short: ta.crossunder(f, s), stopLoss: 2, takeProfit: [{ at: 1, close: 50 }, { at: 2.5, close: 25 }, { at: 4 }], breakEven: true })'],
    ['time exit with a trailing stop', 'strategy({ long: ta.crossover(f, s), exitAfter: 12, trailingStop: 2.5 })'],
    ['limit entries below the close', 'strategy({ long: ta.crossover(f, s), longExit: ta.crossunder(f, s), entryPrice: mul(close, 0.995), entryBars: 3, stopLoss: 2 })'],
    ['breakout entries above the high', 'strategy({ long: ta.crossover(f, s), short: ta.crossunder(f, s), entryPrice: { long: mul(high, 1.002), short: mul(low, 0.998) }, entryBars: 2, stopLoss: 1.5, takeProfit: 3 })'],
    ['leverage with liquidation', 'strategy({ long: ta.crossover(f, s), short: ta.crossunder(f, s), leverage: 25, takeProfit: 3 })'],
  ];
  for (const [name, line] of cases)
    it(name, () => {
      const b = makeBars(800, name.length * 17 + 3);
      const r = execute(`//@version=2\nindicator({ name: 'x', overlay: true })\nconst f = ta.ema(close, 8), s = ta.ema(close, 21)\n${line}`, b);
      expect(r.ok).toBe(true);
      if (!r.ok || !r.strategy) return;
      const bt = backtest(rows(b), r.strategy, { fee: 0, slippage: 0 })
        .trades.filter((t) => !t.open)
        .map((t) => ({ side: t.side, entryTime: t.entryTime, exitTime: t.exitTime, reason: t.reason }));
      expect(bt.length).toBeGreaterThan(3);
      expect(liveTrades(b, r.strategy)).toEqual(bt);
    });
});
