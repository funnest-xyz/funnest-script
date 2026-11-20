import { describe, expect, it } from 'vitest';
import { execute, type RunResult } from '../src/runtime';
import { entryCount, sideOf } from '../src/strategy';
import type { Bars } from '../src/lib';

const N = 120;
const closes = Array.from({ length: N }, (_, i) => 100 + Math.sin(i / 8) * 10 + i * 0.1);
const bars: Bars = {
  open: Float64Array.from(closes, (c) => c - 0.5),
  high: Float64Array.from(closes, (c) => c + 1),
  low: Float64Array.from(closes, (c) => c - 1),
  close: Float64Array.from(closes),
  volume: Float64Array.from(closes, () => 1000),
  time: Float64Array.from(closes, (_, i) => Date.UTC(2026, 0, 1) + i * 3_600_000),
};
const run = (code: string, inputs = {}) => execute(code, bars, inputs);
const ok = (r: RunResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.error} (line ${r.line})`);
  return r;
};
const failed = (r: RunResult) => {
  if (r.ok) throw new Error('expected an error');
  return r;
};

describe('Funnest Script v2', () => {
  it('a typical indicator: declaration, inputs, plots, hlines', () => {
    const r = ok(
      run(`//@version=2
indicator({ name: 'RSI', overlay: false, range: [0, 100] })
const len = input.int('기간', 14, { min: 2, max: 100 })
const r = ta.rsi(close, len)
plot('RSI', r, { color: color.purple, width: 2 })
hline(70, { label: '과매수' })
hline(30)
`),
    );
    expect(r.meta).toEqual({ name: 'RSI', overlay: false, precision: null, range: [0, 100], timeframe: null });
    expect(r.inputs).toEqual([{ label: '기간', kind: 'int', default: 14, min: 2, max: 100, step: 1 }]);
    expect(r.plots[0]).toMatchObject({ name: 'RSI', color: '#7048E8', kind: 'line', width: 2 });
    expect(r.plots[0]!.values).toHaveLength(N);
    expect(r.hlines).toEqual([
      { value: 70, label: '과매수', color: null, style: 'dashed', width: 1 },
      { value: 30, label: null, color: null, style: 'dashed', width: 1 },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('timeframe: the interval the script is written for, checked against the known ones', () => {
    const r = ok(run(`//@version=2
indicator({ name: 'T', overlay: true, timeframe: '60' })
plot('c', close)
`));
    expect(r.meta.timeframe).toBe('60');
    const bad = run(`//@version=2
indicator({ name: 'T', overlay: true, timeframe: '1h' })
plot('c', close)
`);
    expect(failed(bad).code).toBe('BAD_ARG');
  });

  it('input kinds: values come in by label as numbers (bool 0/1, select / source by index)', () => {
    const code = `//@version=2
indicator({ name: 'MA', overlay: true })
const kind = input.select('종류', ['EMA', 'SMA'], 'EMA')
const src = input.source('기준', 'close')
const show = input.bool('표시', true)
const len = input.number('기간', 20, { min: 5 })
log(kind, show, len)
if (show) plot('MA', kind === 'EMA' ? ta.ema(src, len) : ta.sma(src, len))
`;
    const a = ok(run(code));
    expect(a.logs).toEqual(['EMA true 20']);
    expect(a.inputs.map((i) => i.kind)).toEqual(['select', 'source', 'bool', 'number']);
    const b = ok(run(code, { 종류: 1, 기준: 4, 표시: 1, 기간: 2 }));
    expect(b.logs).toEqual(['SMA true 5']); // clamped to min
    expect(ok(run(code, { 표시: 0 })).plots).toHaveLength(0);
  });

  it('series arithmetic is refused with the fix, on the right line', () => {
    const r = failed(
      run(`//@version=2
indicator({ name: 'Body', overlay: false })
const body = close - open
plot('Body', body)
`),
    );
    expect(r.code).toBe('SERIES_ARITHMETIC');
    expect(r.line).toBe(3);
    expect(r.snippet).toBe('const body = close - open');
    expect(r.hint).toMatch(/sub\(close, open\)/);
  });

  it('comparing whole series is refused too; the helpers do it', () => {
    expect(failed(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nconst up = close > open\n`)).code).toBe('SERIES_ARITHMETIC');
    const r = ok(run(`//@version=2\nindicator({ name: 'Body', overlay: false })\nplot('Body', sub(close, open), { style: 'histogram', color: color.up })\n`));
    expect(r.plots[0]!.values[0]).toBeCloseTo(0.5);
    expect(r.plots[0]!.color).toBe('up');
  });

  it('a condition used in if is caught before running', () => {
    const r = failed(
      run(`//@version=2
indicator({ name: 'X', overlay: true })
const f = ta.ema(close, 5), s = ta.ema(close, 20)
if (ta.crossover(f, s)) log('buy')
`),
    );
    expect(r.code).toBe('CONDITION_IN_IF');
    expect(r.line).toBe(4);
    // `!cond` and the condition among others are caught too.
    expect(failed(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nwhile (!gt(close, open)) {}\n`)).line).toBe(3);
  });

  it('reading one bar of a condition in if is fine, and comments / strings are not code', () => {
    const r = ok(
      run(`//@version=2
indicator({ name: 'X', overlay: true })
// if (ta.crossover(a, b)) would be wrong
const f = ta.ema(close, 5), s = ta.ema(close, 20)
const note = 'if (gt(a, b)) is wrong'
const x = ta.crossover(f, s)
let n = 0
map(i => { if (ta.crossover(f, s)[i]) n++; if (gt(close, open)[i] && x[i]) n++; return 0 })
log(n >= 0, note.length > 0)
`),
    );
    expect(r.logs).toEqual(['true true']);
  });

  it('strategy is declared once', () => {
    const r = failed(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nconst c = ta.crossover(close, open)\nstrategy({ entry: c, exit: c })\nstrategy({ entry: c, exit: c })\n`));
    expect(r.code).toBe('DECLARATION_TWICE');
    expect(r.line).toBe(5);
  });

  it('a syntax error that only strict mode rejects still has its line', () => {
    const r = failed(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nconst a = 1\nconst b = 010\n`));
    expect(r.code).toBe('SYNTAX');
    expect(r.line).toBe(4);
  });

  it('the declaration comes first, once; the version line is required', () => {
    expect(failed(run(`//@version=2\nplot('x', close)\nindicator({ name: 'X', overlay: true })\n`)).code).toBe('MISSING_DECLARATION');
    expect(failed(run(`//@version=2\nconst x = 1\n`)).code).toBe('MISSING_DECLARATION');
    expect(failed(run(`indicator({ name: 'X', overlay: true })\n`)).code).toBe('MISSING_DECLARATION');
    expect(failed(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nindicator({ name: 'Y', overlay: true })\n`)).code).toBe('DECLARATION_TWICE');
    expect(failed(run(`//@version=2\nindicator({ name: 'X' })\n`)).error).toMatch(/overlay/);
  });

  it('no clock, no randomness, no network', () => {
    for (const bad of ['Date.now()', 'new Date()', 'Math.random()', 'fetch("https://example.com")', 'setTimeout(() => 1, 1)']) {
      const r = failed(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nconst x = ${bad}\n`));
      expect(r.code, bad).toBe('FORBIDDEN');
      expect(r.line, bad).toBe(3);
    }
    // A bar's own time is fine, and Math still works.
    expect(ok(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nlog(new Date(time[0]).getUTCDay(), Math.max(1, 2))\n`)).logs).toEqual(['4 2']);
  });

  it('map carries state from bar to bar (oldest first)', () => {
    const r = ok(
      run(`//@version=2
indicator({ name: 'Streak', overlay: false })
let streak = 0
plot('Streak', map(i => (streak = close[i] > open[i] ? streak + 1 : 0)))
`),
    );
    expect(r.plots[0]!.values[N - 1]).toBe(N);
  });

  it('strategy signals for the backtest, with warnings when they never (or always) fire', () => {
    const r = ok(
      run(`//@version=2
indicator({ name: 'Cross', overlay: true })
const f = ta.ema(close, 5), s = ta.ema(close, 20)
plot('Fast', f)
plot('Slow', s)
strategy({ entry: ta.crossover(f, s), exit: ta.crossunder(f, s) })
`),
    );
    expect(sideOf(r.strategy!)).toBe('long');
    expect(entryCount(r.strategy!)).toBeGreaterThan(0);
    const never = ok(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nstrategy({ entry: gt(close, 1e9), exit: lt(close, 0) })\n`));
    expect(never.warnings.map((w) => w.code)).toEqual(['NO_SIGNALS']);
  });

  it('warnings: an empty plot, a pane-sized line on the price scale', () => {
    const r = ok(
      run(`//@version=2
indicator({ name: 'X', overlay: true })
plot('Long', ta.sma(close, 500))
plot('Volume', volume)
`),
    );
    expect(r.warnings.map((w) => w.code)).toEqual(['EMPTY_PLOT', 'OVERLAY_SCALE']);
  });

  it('syntax errors and plain runtime errors come back as results, never throws', () => {
    const unclosed = failed(run(`//@version=2\nindicator({ name: 'X', overlay: true }\nplot('a', close)\n`));
    // The ) is missing on line 2: that's the line reported.
    expect([unclosed.code, unclosed.line]).toEqual(['SYNTAX', 2]);
    const comma = failed(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nconst a = ta.ema(close 20)\nplot('a', a)\n`));
    expect([comma.code, comma.line, comma.snippet]).toEqual(['SYNTAX', 3, 'const a = ta.ema(close 20)']);
    const r = failed(run(`//@version=2\nindicator({ name: 'X', overlay: true })\nconst a = undefined\nlog(a.b)\n`));
    expect(r.code).toBe('RUNTIME');
    expect(r.line).toBe(4);
  });

  it('English messages on request', () => {
    const r = execute(`//@version=2\nindicator({ name: 'X', overlay: false })\nplot('x', close - open)\n`, bars, {}, { locale: 'en' });
    expect(failed(r).error).toMatch(/Series/);
  });
});
