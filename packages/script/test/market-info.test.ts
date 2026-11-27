import { describe, expect, it } from 'vitest';
import type { Bars } from '../src/lib';
import { execute, type RunOptions } from '../src/runtime';

/** Hourly bars from 2026-01-05 00:00 UTC (a Monday). */
function hourly(n: number): Bars {
  const close = Float64Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 5) * 3);
  return {
    open: close.map((c, i) => (i ? close[i - 1]! : c)),
    high: close.map((c) => c + 1),
    low: close.map((c) => c - 1),
    close,
    volume: close.map(() => 10),
    time: Float64Array.from({ length: n }, (_, i) => Date.UTC(2026, 0, 5) + i * 3_600_000),
  };
}
const bars = hourly(72);
const head = "//@version=2\nindicator({ name: 't', overlay: false })\n";
const run = (body: string, options: RunOptions = {}, inputs = {}) => {
  const r = execute(head + body, bars, inputs, options);
  if (!r.ok) throw new Error(`${r.code}: ${r.error}`);
  return r;
};

describe('syminfo, timeframe, bar', () => {
  it('syminfo from the host; unknown fields are empty / NaN / UTC', () => {
    const r = run('log(JSON.stringify(syminfo))', { symbol: { symbol: 'BINANCEF:BTCUSDT', name: 'BTC 무기한', market: 'perp', currency: 'USDT', base: 'BTC', tick: 0.1, timezone: 'UTC' } });
    expect(JSON.parse(r.logs[0]!)).toEqual({ symbol: 'BINANCEF:BTCUSDT', ticker: 'BTCUSDT', exchange: 'BINANCEF', name: 'BTC 무기한', market: 'perp', currency: 'USDT', base: 'BTC', tick: 0.1, timezone: 'UTC' });
    const none = run('log(syminfo.market, syminfo.ticker === "", Number.isNaN(syminfo.tick), syminfo.timezone)');
    expect(none.logs[0]).toBe('unknown true true UTC');
    // A bad zone or market from a host is dropped, not trusted.
    const odd = run('log(syminfo.timezone, syminfo.market)', { symbol: { timezone: 'Nowhere/Land', market: 'moon' as 'spot' } });
    expect(odd.logs[0]).toBe('UTC unknown');
  });

  it('syminfo cannot be changed by the script', () => {
    const r = execute(`${head}syminfo.tick = 5\n`, bars);
    expect(r.ok).toBe(false);
  });

  it('timeframe: from the host, or from the bars', () => {
    expect(run('log(timeframe.period, timeframe.minutes, timeframe.isIntraday)').logs[0]).toBe('60 60 true');
    expect(run('log(timeframe.period, timeframe.isDaily, timeframe.isIntraday)', { timeframe: 'D' }).logs[0]).toBe('1D true false');
    expect(run('log(timeframe.period, timeframe.seconds)', { timeframe: '240' }).logs[0]).toBe('240 14400');
  });

  it('bar: count, index, last, confirmed', () => {
    const r = run('log(bar.count, bar.last, bar.index[0], bar.index[bar.last], bar.confirmed)');
    expect(r.logs[0]).toBe('72 71 0 71 false');
    expect(run('log(bar.confirmed)', { confirmed: true }).logs[0]).toBe('true');
  });
});

describe('date', () => {
  it('hours and weekdays in the market zone, or the one given', () => {
    const r = run("log(date.hour()[0], date.hour('Asia/Seoul')[0], date.dayofweek()[0], date.dayofweek()[24], date.month()[0], date.year()[0], date.day()[0])");
    expect(r.logs[0]).toBe('0 9 1 2 1 2026 5');
    // The zone from syminfo is the default.
    expect(run('log(date.hour()[0])', { symbol: { timezone: 'Asia/Seoul' } }).logs[0]).toBe('9');
  });

  it('isNew: the first bar of each day in the zone; session windows (past midnight too)', () => {
    const r = run("const d = date.isNew('D'), s = date.isNew('D', 'Asia/Seoul')\nlog(JSON.stringify([0, 15, 24, 39].map((i) => [d[i], s[i]])))");
    expect(JSON.parse(r.logs[0]!)).toEqual([[1, 1], [0, 1], [1, 0], [0, 1]]);
    const t = run("const a = date.session('0900-1530', 'Asia/Seoul'), b = date.session('2200-0200')\nlog(a[0], a[6], a[7], b[21], b[22], b[1], b[2])");
    // 00:00 UTC = 09:00 Seoul (in), 06:00 UTC = 15:00 (in), 07:00 UTC = 16:00 (out); 22:00 and 01:00 UTC in, 02:00 out.
    expect(t.logs[0]).toBe('1 1 0 0 1 1 0');
  });

  it('says how to write a session, a period and a zone', () => {
    for (const [code, want] of [
      ["date.session('9-15')", /0900-1530/],
      ["date.isNew('Q')", /'D'/],
      ["date.hour('Seoul time')", /Asia\/Seoul|unknown time zone/],
    ] as const) {
      const r = execute(`${head}${code}\n`, bars, {}, { locale: 'en' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(`${r.error} ${r.hint}`).toMatch(want);
    }
  });

  it('if (date.isNew(…)) is caught like the other conditions', () => {
    const r = execute(`${head}if (date.isNew('D')) log('x')\n`, bars);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONDITION_IN_IF');
  });
});

describe('inputs: timeframe, symbol, time', () => {
  it('defaults, chosen values, and values that are not allowed', () => {
    const code = "const tf = input.timeframe('TF', '240')\nconst s = input.symbol('Other', 'BINANCEF:ETHUSDT')\nconst t = input.time('From', '2026-01-02T00:00:00Z')\nlog(tf, s, t)";
    const r = run(code);
    expect(r.logs[0]).toBe(`240 BINANCEF:ETHUSDT ${Date.UTC(2026, 0, 2)}`);
    expect(r.inputs.map((i) => i.kind)).toEqual(['timeframe', 'symbol', 'time']);
    expect(run(code, {}, { TF: '1D', Other: 'UPBIT:KRW-BTC', From: 5 }).logs[0]).toBe('1D UPBIT:KRW-BTC 5');
    // A value that isn't one of the choices (or not a market) falls back to the default.
    expect(run(code, {}, { TF: '7', Other: 'not a symbol', From: 'x' }).logs[0]).toBe(`240 BINANCEF:ETHUSDT ${Date.UTC(2026, 0, 2)}`);
  });

  it('bad defaults say what to write', () => {
    for (const code of ["input.timeframe('a', '7')", "input.symbol('a', 'BTC')", "input.time('a', 'soon')"]) {
      const r = execute(`${head}${code}\n`, bars);
      expect(r.ok, code).toBe(false);
      if (!r.ok) expect(r.code).toBe('BAD_ARG');
    }
  });

  it('an anchored VWAP from an input time (the anchor as a condition)', () => {
    const r = run("const from = input.time('From', '2026-01-06T00:00:00Z')\nconst v = ta.vwap(close, map((i) => time[i] >= from && (i === 0 || time[i - 1] < from)))\nlog(Number.isNaN(v[0]) ? 'none' : 'some', v[24] === close[24])");
    // Before the anchor it runs from the first bar (no anchor yet); at the anchor it starts over.
    expect(r.logs[0]).toBe('some true');
  });
});

describe('no clock by other names', () => {
  it('performance.now and crypto are off', () => {
    for (const code of ['performance.now()', 'crypto.getRandomValues(new Uint8Array(4))']) {
      const r = execute(`${head}${code}\n`, bars);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('FORBIDDEN');
    }
  });
});
