import { describe, expect, it } from 'vitest';
import { atOpen, backtest, execute, guardsAt, hitAt, nextBest, type Held, type Strategy } from '../src/index';
import type { Bars } from '../src/lib';

/** Phase 5: alert() and screen(), and the live rules (paper auto-trading) acting as the backtest does. */

function makeBars(n: number, seed = 7): Bars {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n);
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p * (1 + (rnd() - 0.5) * 0.01);
    const c = o * (1 + (rnd() - 0.5) * 0.04);
    open[i] = o;
    close[i] = c;
    high[i] = Math.max(o, c) * (1 + rnd() * 0.015);
    low[i] = Math.min(o, c) * (1 - rnd() * 0.015);
    p = c;
  }
  return { open, high, low, close, volume: new Float64Array(n).fill(1), time: Float64Array.from({ length: n }, (_, i) => i * 3_600_000) };
}
const rows = (b: Bars) => Array.from(b.close, (_, i) => ({ time: b.time[i]!, open: b.open[i]!, high: b.high[i]!, low: b.low[i]!, close: b.close[i]! }));

describe('alert and screen', () => {
  it('alert: the bars it rings on, with its message', () => {
    const bars = makeBars(200);
    const r = execute(`//@version=2
indicator({ name: 'x', overlay: true })
const f = ta.ema(close, 5), s = ta.ema(close, 20)
alert(ta.crossover(f, s), '{symbol} up at {close}')
alert(ta.crossunder(f, s))`, bars);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.alerts).toHaveLength(2);
    expect(r.alerts[0]!.message).toBe('{symbol} up at {close}');
    expect(r.alerts[1]!.message).toBe('{name}');
    expect(r.alerts[0]!.when.length).toBe(200);
    expect(r.alerts[0]!.when.reduce((a, v) => a + v, 0)).toBeGreaterThan(0);
  });

  it('screen: the last bar’s value; a condition is 0 / 1', () => {
    const bars = makeBars(100);
    const r = execute(`//@version=2
indicator({ name: 'x', overlay: false })
screen('RSI', ta.rsi(close, 14))
screen('Up', gt(close, open))
screen('Fixed', 3)`, bars);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.screens.map((s) => s.name)).toEqual(['RSI', 'Up', 'Fixed']);
    expect(r.screens[0]!.value).toBeGreaterThan(0);
    expect(r.screens[1]!.value).toBe(bars.close[99]! > bars.open[99]! ? 1 : 0);
    expect(r.screens[2]!.value).toBe(3);
  });

  it('says what is wrong: a non-condition alert, a twice-used screen name', () => {
    const bars = makeBars(50);
    const a = execute(`//@version=2
indicator({ name: 'x', overlay: true })
alert(true)`, bars);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.line).toBe(3);
    const b = execute(`//@version=2
indicator({ name: 'x', overlay: true })
screen('A', close)
screen('A', open)`, bars, {}, { locale: 'en' });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toMatch(/twice/);
  });
});

/**
 * The live rules fed one price at a time — the bar's open, then the side against the position,
 * then the other (what the backtest assumes when a bar reaches both) — decide the same trades as
 * the backtest: the same bars in and out, for the same reasons.
 */
function liveTrades(bars: Bars, s: Strategy) {
  const n = bars.close.length;
  const out: { side: string; entryTime: number; exitTime: number; reason: string }[] = [];
  let held: (Held & { at: number }) | null = null;
  const close = (i: number, reason: string) => {
    out.push({ side: held!.dir > 0 ? 'long' : 'short', entryTime: bars.time[held!.at]!, exitTime: bars.time[i]!, reason });
    held = null;
  };
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // The bar before closed: its best price, then its signals at this open.
      if (held) held.best = nextBest(held, bars.high[i - 1]!, bars.low[i - 1]!);
      const act = atOpen(s, i - 1, held ? held.dir : null);
      if (act.close) close(i, act.close);
      if (act.open) held = { dir: act.open, price: bars.open[i]!, best: bars.open[i]!, at: i };
    }
    if (!held) continue;
    const h: Held & { at: number } = held;
    const g = guardsAt(s, h, i);
    const ticks = h.dir > 0 ? [bars.open[i]!, bars.low[i]!, bars.high[i]!] : [bars.open[i]!, bars.high[i]!, bars.low[i]!];
    for (const price of ticks) {
      const hit = hitAt(h, g, price);
      if (hit) {
        close(i, hit);
        break;
      }
    }
  }
  return out;
}

describe('live rules = backtest rules', () => {
  const cases: [string, string][] = [
    ['cross, both ways, % stop / target / trail', `strategy({ long: ta.crossover(f, s), short: ta.crossunder(f, s), stopLoss: 1.5, takeProfit: 3, trailingStop: 2, slippage: 0, fee: 0 })`],
    ['long only with exits', `strategy({ long: ta.crossover(f, s), longExit: ta.crossunder(close, f), slippage: 0, fee: 0 })`],
    ['price-series stop', `strategy({ long: ta.crossover(f, s), longExit: ta.crossunder(f, s), stopLoss: sub(low, ta.atr(14)), slippage: 0, fee: 0 })`],
    ['per-side price stops (long below, short above) and a short-only target', `strategy({ long: ta.crossover(f, s), short: ta.crossunder(f, s), stopLoss: { long: sub(low, ta.atr(14)), short: add(high, ta.atr(14)) }, takeProfit: { short: 2 }, slippage: 0, fee: 0 })`],
    ['no reverse', `strategy({ long: ta.crossover(f, s), short: ta.crossunder(f, s), reverse: false, takeProfit: 2, slippage: 0, fee: 0 })`],
  ];
  for (const [name, line] of cases)
    it(name, () => {
      const bars = makeBars(600, name.length * 31);
      const r = execute(`//@version=2
indicator({ name: 'x', overlay: true })
const f = ta.ema(close, 8), s = ta.ema(close, 21)
${line}`, bars);
      expect(r.ok).toBe(true);
      if (!r.ok || !r.strategy) return;
      const bt = backtest(rows(bars), r.strategy, { fee: 0, slippage: 0 })
        .trades.filter((t) => !t.open)
        .map((t) => ({ side: t.side, entryTime: t.entryTime, exitTime: t.exitTime, reason: t.reason }));
      expect(bt.length).toBeGreaterThan(3);
      expect(liveTrades(bars, r.strategy)).toEqual(bt);
    });
});
