import { describe, expect, it } from 'vitest';
import { createLib } from '../src/lib';
import { execute, transferables, type RunResult } from '../src/runtime';
import type { Bars } from '../src/lib';

// Drawing: plot styles and per-bar colors, fills, hlines, bgcolor, barcolor, plotshape, label,
// line, box, table, color helpers, and the inputs that go with them.
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
const head = "//@version=2\nindicator({ name: 'X', overlay: true })\n";
const run = (body: string, inputs = {}) => execute(head + body, bars, inputs, { locale: 'en' });
const ok = (r: RunResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.error} (line ${r.line})`);
  return r;
};
const failed = (r: RunResult) => {
  if (r.ok) throw new Error('expected an error');
  return r;
};
const colorsAt = (bc: { palette: string[]; index: Uint8Array } | null, i: number) => (bc && bc.index[i] !== 255 ? bc.palette[bc.index[i]!] : null);

describe('plot', () => {
  it('styles, line styles and a color per bar from a function', () => {
    const r = ok(run("const m = ta.sma(close, 5)\nplot('m', m, { style: 'step', lineStyle: 'dashed', color: (i) => (m[i] > m[i - 1] ? color.green : i % 2 ? null : color.red) })\n"));
    const p = r.plots[0]!;
    expect([p.kind, p.lineStyle, p.color]).toEqual(['step', 'dashed', null]);
    const rising = Array.from({ length: N }, (_, i) => i > 5 && closes.slice(i - 4, i + 1).reduce((a, b) => a + b) > closes.slice(i - 5, i).reduce((a, b) => a + b));
    const i = rising.findIndex(Boolean);
    expect(colorsAt(p.colors, i)).toBe('#12B886');
    expect(p.colors!.palette.length).toBeLessThanOrEqual(2);
  });
  it('a color function must give colors', () => {
    expect(failed(run("plot('c', close, { color: (i) => 'reddish' })\n")).error).toMatch(/bar 0 isn't a color/);
    expect(failed(run("plot('c', close, { style: 'dots' })\n")).error).toMatch(/line, step, area/);
  });
  it('offset shifts a plot; a sliced series is refused', () => {
    expect(ok(run("plot('lead', ta.sma(close, 5), { offset: 26 })\n")).plots[0]!.offset).toBe(26);
    expect(failed(run("plot('x', close.slice(-20))\n")).error).toMatch(/length 20 differs/);
  });
});

describe('fill and hline', () => {
  it('several fills by plot name, with a per-bar color', () => {
    const r = ok(
      run("const b = ta.bb(close, 20, 2)\nplot('Up', b.upper)\nplot('Mid', b.mid)\nplot('Low', b.lower)\nfill('Up', 'Mid', { color: color.blue, downColor: '#ff000033' })\nfill('Mid', 'Low', { color: (i) => (close[i] > b.mid[i] ? color.alpha(color.green, 0.2) : null) })\n"),
    );
    expect(r.fills[0]).toEqual({ upper: 'Up', lower: 'Mid', color: '#3182F6', downColor: '#ff000033', colors: null });
    expect(r.fills[1]!.colors!.palette).toEqual(['#12B88633']);
  });
  it('fill needs the plots first, two different ones', () => {
    const e = failed(run("fill('Up', 'Low')\n"));
    expect([e.code, e.line]).toEqual(['BAD_ARG', 3]);
    expect(failed(run("plot('A', close)\nfill('A', 'A')\n")).code).toBe('BAD_ARG');
  });
  it('hline with a name, color and style', () => {
    expect(ok(run("hline(70, { label: 'High', color: color.red, style: 'dotted', width: 2 })\n")).hlines[0]).toEqual({ value: 70, label: 'High', color: '#F04452', style: 'dotted', width: 2 });
  });
});

describe('bgcolor and barcolor', () => {
  it('bgcolor: a condition and a color, or a color per bar', () => {
    const r = ok(run("bgcolor(gt(close, ta.ema(close, 50)), { color: color.green })\nbgcolor((i) => (i % 10 === 0 ? color.alpha(color.up, 0.1) : null))\n"));
    expect(r.backgrounds[0]!.colors.palette).toEqual(['#12B886']);
    expect(colorsAt(r.backgrounds[1]!.colors, 10)).toBe('up/0.1');
    expect(colorsAt(r.backgrounds[1]!.colors, 11)).toBeNull();
  });
  it('barcolor: later calls win where they color', () => {
    const r = ok(run("barcolor((i) => (i < 60 ? color.yellow : null))\nbarcolor((i) => (i % 2 === 0 ? color.purple : null))\n"));
    expect([0, 1, 61, 62].map((i) => colorsAt(r.barColors, i))).toEqual(['#7048E8', '#FCC419', null, '#7048E8']);
  });
});

describe('plotshape', () => {
  it('marks bars, with defaults by shape', () => {
    const r = ok(run("const x = ta.crossover(close, ta.sma(close, 10))\nplotshape(x, { shape: 'triangleup', text: 'buy', size: 'tiny' })\nplotshape(ta.crossunder(close, ta.sma(close, 10)), { shape: 'arrowdown', location: 'top' })\n"));
    expect(r.shapes[0]).toMatchObject({ shape: 'triangleup', location: 'below', color: 'up', text: 'buy', size: 'tiny', price: null });
    expect(r.shapes[1]).toMatchObject({ shape: 'arrowdown', location: 'top', color: 'down' });
    expect(failed(run("plotshape(gt(close, open), { location: 'price' })\n")).code).toBe('BAD_ARG');
    expect(failed(run('plotshape(close > open)\n')).code).toBe('SERIES_ARITHMETIC');
  });
});

describe('label, line, box, table', () => {
  it('label: -1 is the latest bar, past the end is the space on the right; the latest 500 stay', () => {
    const r = ok(run("label(-1, 'now')\nlabel(bar.count + 3, 'right', { style: 'text', align: 'right', price: 100 })\nlabel(5000, 'nowhere')\n"));
    expect(r.labels.map((l) => [l.bar, l.text, l.location, l.style])).toEqual([
      [N - 1, 'now', 'above', 'box'],
      [N + 3, 'right', 'price', 'text'],
    ]);
    const many = ok(run("for (let k = 0; k < 700; k++) label(k % 100, String(k))\n"));
    expect(many.labels.length).toBe(500);
    expect(many.labels[0]!.text).toBe('200');
  });
  it('line and box with styles and extension', () => {
    const r = ok(run("line(-10, 100, -1, 105, { color: color.orange, style: 'dotted', extend: 'right', width: 2 })\nbox(-30, 98, -1, 104, { color: color.red, bg: color.alpha(color.red, 0.15), extend: 'right', text: 'zone' })\n"));
    expect(r.lines[0]).toEqual({ x1: N - 10, y1: 100, x2: N - 1, y2: 105, color: '#FF9F0A', width: 2, style: 'dotted', extend: 'right' });
    expect(r.boxes[0]).toMatchObject({ left: N - 30, right: N - 1, top: 104, bottom: 98, bg: '#F0445226', text: 'zone', extend: 'right' });
    expect(failed(run('line(0, NaN, 1, 2)\n')).error).toMatch(/y1 must be a number/);
  });
  it('table: rows of cells (strings, numbers or styled cells)', () => {
    const r = ok(run("table({ position: 'bottom-left', rows: [['MA', 'value'], [{ text: 'EMA 20', color: color.green }, 101.5], [null]] })\n"));
    expect(r.tables[0]!.position).toBe('bottom-left');
    expect(r.tables[0]!.rows.map((row) => row.map((c) => c.text))).toEqual([['MA', 'value'], ['EMA 20', '101.5'], ['']]);
    expect(r.tables[0]!.rows[1]![0]!.color).toBe('#12B886');
    expect(failed(run("table({ position: 'nowhere', rows: [] })\n")).code).toBe('BAD_ARG');
  });
  it("the script's own names may shadow the built-in ones", () => {
    const r = ok(run("const line = map((i) => close[i])\nconst box = 1, label = 'x', table = [], fill = 2\nplot('line', line)\n"));
    expect(r.plots[0]!.name).toBe('line');
  });
  it('the drawing buffers are handed over without copying', () => {
    const r = run("plot('c', close, { color: (i) => color.red })\nbgcolor(gt(close, open))\nbarcolor(gt(close, open))\nplotshape(gt(close, open), { location: 'price', price: low })\n");
    expect(transferables(r)).toHaveLength(6);
  });
});

describe('color helpers and inputs', () => {
  it('color.alpha, color.new (Pine transparency), color.rgb', () => {
    const r = ok(run("log(color.alpha(color.red, 0.5), color.new(color.blue, 80), color.rgb(255, 0, 128), color.alpha(color.up, 0.25), color.new('#123456'))\n"));
    expect(r.logs[0]).toBe('#F0445280 #3182F633 #FF0080FF up/0.25 #123456FF');
  });
  it('input.color, groups, rows and notes; select returns numbers from a number list', () => {
    const r = ok(run("const c = input.color('Line color', color.orange, { group: 'Style', inline: 'a', tooltip: 'The line' })\nconst k = input.select('MA', [1, 2, 3], 2, { group: 'Style' })\nlog(c, k, typeof k)\n", { 'Line color': '#000000', MA: 2 }));
    expect(r.logs[0]).toBe('#000000 3 number');
    expect(r.inputs[0]).toEqual({ label: 'Line color', kind: 'color', default: '#FF9F0A', group: 'Style', inline: 'a', tooltip: 'The line' });
    expect(ok(run("log(input.color('c', color.red))\n", { c: 'not a color' })).logs[0]).toBe('#F04452');
  });
});

describe('more moving averages', () => {
  const lib = createLib(bars);
  it('linreg of a straight line is the line; offset reads back', () => {
    const z = new Float64Array(30);
    const line = Float64Array.from({ length: 30 }, (_, i) => 2 * i + 1);
    const { ta } = createLib({ open: z, high: z, low: z, close: line, volume: z, time: z });
    expect(ta.linreg(line, 10)[20]).toBeCloseTo(41);
    expect(ta.linreg(line, 10, 3)[20]).toBeCloseTo(35);
  });
  it('alma, dema, tema follow their definitions', () => {
    const c = bars.close;
    const a = lib.ta.alma(c, 9, 0.85, 6);
    const m = 0.85 * 8, s = 9 / 6;
    const w = Array.from({ length: 9 }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * s * s)));
    const want = w.reduce((sum, wk, k) => sum + wk * c[50 - 8 + k]!, 0) / w.reduce((x, y) => x + y, 0);
    expect(a[50]).toBeCloseTo(want, 10);
    const e1 = lib.ta.ema(c, 10), e2 = lib.ta.ema(e1, 10);
    expect(lib.ta.dema(c, 10)[80]).toBeCloseTo(2 * e1[80]! - e2[80]!, 10);
    expect(Number.isFinite(lib.ta.tema(c, 10)[80]!)).toBe(true);
  });
});

describe('showcase: 이평선 묶음 + 지지 · 저항', () => {
  it('runs cleanly and draws everything it should', async () => {
    const { SHOWCASE } = await import('../src/generated/llms');
    const example = SHOWCASE.find((s) => s.file === 'ma-bundle-sr.js')!;
    // 600 bars of a wave, so turns, crosses and both orders all appear.
    const n = 600;
    const c = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 20) * 15 + Math.sin(i / 5) * 3 + i * 0.02);
    const long: Bars = {
      open: Float64Array.from(c, (v, i) => (i ? c[i - 1]! : v)),
      high: Float64Array.from(c, (v, i) => Math.max(v, i ? c[i - 1]! : v) + 0.5 + (i % 7) * 0.1),
      low: Float64Array.from(c, (v, i) => Math.min(v, i ? c[i - 1]! : v) - 0.5 - (i % 5) * 0.1),
      close: Float64Array.from(c),
      volume: Float64Array.from(c, (_, i) => 1000 + ((i * 37) % 900)),
      time: Float64Array.from(c, (_, i) => Date.UTC(2026, 0, 1) + i * 3_600_000),
    };
    const r = execute(example.code, long, {}, { locale: 'ko' });
    if (!r.ok) throw new Error(`${r.code} line ${r.line}: ${r.error}`);
    expect(r.plots.map((p) => p.name)).toEqual(['EMA 5', 'EMA 10', 'EMA 20', 'EMA 60', 'EMA 120', 'EMA 240']);
    expect(r.fills.length).toBe(1);
    expect(r.tables.length).toBe(1);
    expect(r.shapes.some((s) => s.text === 'GC')).toBe(true);
    expect(r.boxes.length).toBeGreaterThan(0);
    expect(r.boxes.length).toBeLessThanOrEqual(6);
    // Every kind computes; other lengths are taken from the text.
    for (const [index, kind] of [[1, 'SMA'], [2, 'WMA'], [3, 'HMA']] as const) {
      const k = execute(example.code, long, { 종류: index, '기간 (쉼표로, 최대 8개)': '7, 21, 50, x, 21' }, { locale: 'ko' });
      if (!k.ok) throw new Error(k.error);
      expect(k.plots.map((p) => p.name)).toEqual([`${kind} 7`, `${kind} 21`, `${kind} 50`]);
      for (const p of k.plots) expect(Number.isFinite(p.values[n - 1]!), p.name).toBe(true);
    }
  });
});
