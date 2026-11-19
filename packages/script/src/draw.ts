import { isSeries, Series, type ScriptError } from './series';

/**
 * What a script draws: plot (with a style and a color per bar), hline, fill, bgcolor, barcolor,
 * plotshape, label, line, box, table, and the `color` helpers. Everything is checked here and
 * comes out as plain data (typed arrays where it's per bar) for the chart.
 *
 * Colors are strings: '#RRGGBB', '#RRGGBBAA', or 'up' / 'down' (the viewer's rising / falling
 * colors) optionally with an opacity, 'up/0.2'. Wherever a color can change per bar, a function
 * of the bar index gives it: `color: i => rising[i] ? color.green : color.red`.
 */

export const DRAW_LIMITS = {
  plots: 40,
  hlines: 20,
  fills: 10,
  shapes: 20,
  backgrounds: 10,
  labels: 500,
  lines: 500,
  boxes: 500,
  tables: 4,
  tableRows: 60,
  tableCols: 10,
  /** Text on a label, shape or table cell. */
  text: 80,
  name: 40,
  /** How far past the last bar a label, line or box may reach. */
  future: 500,
} as const;

export const PLOT_STYLES = ['line', 'step', 'area', 'circles', 'cross', 'histogram', 'columns'] as const;
export type PlotStyle = (typeof PLOT_STYLES)[number];
export const LINE_STYLES = ['solid', 'dotted', 'dashed'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];
export const SHAPES = ['triangleup', 'triangledown', 'arrowup', 'arrowdown', 'circle', 'square', 'diamond', 'cross', 'xcross', 'flag'] as const;
export type Shape = (typeof SHAPES)[number];
export const LOCATIONS = ['above', 'below', 'price', 'top', 'bottom'] as const;
export type MarkLocation = (typeof LOCATIONS)[number];
export const SIZES = ['tiny', 'small', 'normal', 'large'] as const;
export type Size = (typeof SIZES)[number];
export const EXTENDS = ['none', 'left', 'right', 'both'] as const;
export type Extend = (typeof EXTENDS)[number];
export const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
export type Position = (typeof POSITIONS)[number];

/** A color per bar: `index[i]` picks from `palette`, 255 = none (the default). */
export interface BarColorsOut {
  palette: string[];
  index: Uint8Array;
}
export interface PlotOut {
  name: string;
  values: Float64Array;
  /** The color (automatic when null); `colors` overrides it bar by bar. */
  color: string | null;
  colors: BarColorsOut | null;
  kind: PlotStyle;
  width: number;
  lineStyle: LineStyle;
  /** Drawn this many bars to the right (negative: left). */
  offset: number;
}
export interface HlineOut {
  value: number;
  label: string | null;
  color: string | null;
  style: LineStyle;
  width: number;
}
/** Shaded area between two plots (by name). */
export interface FillOut {
  upper: string;
  lower: string;
  color: string | null;
  /** Where `lower` is above `upper` (a cloud turning). */
  downColor: string | null;
  /** A color per bar instead (255: not shaded there). */
  colors: BarColorsOut | null;
}
export interface ShapeOut {
  when: Uint8Array;
  shape: Shape;
  location: MarkLocation;
  /** With location 'price': where, per bar. */
  price: Float64Array | null;
  color: string | null;
  textColor: string | null;
  text: string | null;
  size: Size;
}
export interface BackgroundOut {
  colors: BarColorsOut;
}
export interface LabelOut {
  bar: number;
  text: string;
  location: MarkLocation;
  price: number | null;
  color: string | null;
  textColor: string | null;
  style: 'box' | 'text';
  align: 'left' | 'center' | 'right';
  size: Size;
}
export interface LineOut {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string | null;
  width: number;
  style: LineStyle;
  extend: Extend;
}
export interface BoxOut {
  left: number;
  top: number;
  right: number;
  bottom: number;
  color: string | null;
  bg: string | null;
  width: number;
  style: LineStyle;
  extend: Extend;
  text: string | null;
  textColor: string | null;
}
export interface CellOut {
  text: string;
  color: string | null;
  bg: string | null;
  align: 'left' | 'center' | 'right' | null;
}
export interface TableOut {
  position: Position;
  rows: CellOut[][];
  bg: string | null;
  textColor: string | null;
  border: string | null;
  size: Size;
}

export interface Drawn {
  plots: PlotOut[];
  hlines: HlineOut[];
  fills: FillOut[];
  barColors: BarColorsOut | null;
  shapes: ShapeOut[];
  backgrounds: BackgroundOut[];
  labels: LabelOut[];
  lines: LineOut[];
  boxes: BoxOut[];
  tables: TableOut[];
}

export const NAMED_COLORS: Record<string, string> = {
  up: 'up',
  down: 'down',
  red: '#F04452',
  blue: '#3182F6',
  green: '#12B886',
  orange: '#FF9F0A',
  yellow: '#FCC419',
  purple: '#7048E8',
  pink: '#F06595',
  teal: '#20C997',
  gray: '#868E96',
  white: '#F1F3F5',
  black: '#191F28',
};

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const TOKEN = /^(up|down)(\/(0(\.\d+)?|1(\.0+)?))?$/;
export const isColor = (v: unknown): v is string => typeof v === 'string' && (HEX.test(v) || TOKEN.test(v));

type Err = (code: 'BAD_ARG' | 'LIMIT', ko: string, en: string, hintKo?: string, hintEn?: string) => ScriptError;

/** The color helpers scripts get as `color`. */
export function colorApi(err: Err) {
  const check = (c: unknown, fn: string): string => {
    if (!isColor(c)) throw err('BAD_ARG', `${fn}에는 color.red 같은 색이나 '#RRGGBB'가 필요해요.`, `${fn} needs a color like color.red or '#RRGGBB'.`);
    return c;
  };
  /** The color at an opacity 0 (invisible) … 1 (solid). */
  const alpha = (c: unknown, opacity: unknown): string => {
    const base = check(c, 'color.alpha').replace(/\/.*$/, '');
    const o = Number(opacity);
    if (!(o >= 0 && o <= 1)) throw err('BAD_ARG', 'color.alpha의 투명도는 0(안 보임)~1(진하게)이에요.', 'color.alpha: opacity runs from 0 (invisible) to 1 (solid).');
    if (base === 'up' || base === 'down') return `${base}/${Number(o.toFixed(3))}`;
    return `${base.slice(0, 7)}${Math.round(o * 255).toString(16).padStart(2, '0').toUpperCase()}`;
  };
  return {
    ...NAMED_COLORS,
    alpha,
    /** Pine's color.new: transparency 0 (solid) … 100 (invisible). */
    new: (c: unknown, transparency: unknown = 0) => {
      const t = Number(transparency);
      if (!(t >= 0 && t <= 100)) throw err('BAD_ARG', 'color.new의 투명도는 0(진하게)~100(안 보임)이에요.', 'color.new: transparency runs from 0 (solid) to 100 (invisible).');
      return alpha(c, 1 - t / 100);
    },
    rgb: (r: unknown, g: unknown, b: unknown, opacity: unknown = 1) => {
      const ch = [r, g, b].map(Number);
      if (!ch.every((v) => v >= 0 && v <= 255)) throw err('BAD_ARG', 'color.rgb의 값은 0~255예요.', 'color.rgb: values run from 0 to 255.');
      return alpha(`#${ch.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`, opacity);
    },
  };
}

export interface DrawEnv {
  n: number;
  err: Err;
  declared(fn: string): void;
  /** A non-empty string, trimmed and cut to `max`. */
  text(v: unknown, fn: string, arg: string, max?: number): string;
  sameLength<T extends ArrayLike<number>>(v: T, what: string): T;
  condOf(v: unknown, what: string, example: string): Uint8Array;
}

export function createDrawing(env: DrawEnv) {
  const { n, err, declared } = env;
  const out: Drawn = { plots: [], hlines: [], fills: [], barColors: null, shapes: [], backgrounds: [], labels: [], lines: [], boxes: [], tables: [] };

  const colorOf = (v: unknown, fn: string): string | null => {
    if (v === undefined || v === null) return null;
    if (isColor(v)) return v;
    throw err('BAD_ARG', `${fn}의 color에는 color.red 같은 색이나 '#RRGGBB'가 필요해요.`, `${fn}: color must be a named color like color.red or '#RRGGBB'.`);
  };
  /** A color per bar from `fn(i)` (null / undefined: none there). */
  const colorsOf = (fn: (i: number) => unknown, what: string): BarColorsOut => {
    const palette: string[] = [];
    const seen = new Map<string, number>();
    const index = new Uint8Array(n).fill(255);
    for (let i = 0; i < n; i++) {
      const c = fn(i);
      if (c === null || c === undefined || c === false || (typeof c === 'number' && Number.isNaN(c))) continue;
      if (!isColor(c)) throw err('BAD_ARG', `${what}: ${i}번째 봉의 색이 색이 아니에요 (${String(c)}).`, `${what}: the color for bar ${i} isn't a color (${String(c)}).`, 'i => up[i] ? color.green : color.red');
      let k = seen.get(c);
      if (k === undefined) {
        if (palette.length >= 254) throw err('LIMIT', `${what}: 서로 다른 색은 254가지까지예요.`, `${what}: at most 254 different colors.`);
        seen.set(c, (k = palette.length));
        palette.push(c);
      }
      index[i] = k;
    }
    return { palette, index };
  };
  /** A fixed color, or a function of the bar giving one. */
  const colorOrPerBar = (v: unknown, what: string): { color: string | null; colors: BarColorsOut | null } =>
    typeof v === 'function' ? { color: null, colors: colorsOf(v as (i: number) => unknown, what) } : { color: colorOf(v, what), colors: null };
  const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T, fn: string, arg: string): T => {
    if (v === undefined || v === null) return fallback;
    if ((list as readonly unknown[]).includes(v)) return v as T;
    throw err('BAD_ARG', `${fn}의 ${arg}는 ${list.join(', ')} 중 하나예요. (받은 값: ${String(v)})`, `${fn}: ${arg} must be one of ${list.join(', ')} (got ${String(v)}).`);
  };
  const widthOf = (v: unknown, fn: string, fallback = 1) => {
    const w = v === undefined ? fallback : Number(v);
    if (!(Number.isInteger(w) && w >= 0 && w <= 4)) throw err('BAD_ARG', `${fn}의 width는 0~4예요.`, `${fn}: width must be 0–4.`);
    return w;
  };
  const textOf = (v: unknown, fn: string): string | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' && typeof v !== 'number') throw err('BAD_ARG', `${fn}의 글자에는 문자열이 필요해요.`, `${fn}: text must be a string.`);
    return String(v).slice(0, DRAW_LIMITS.text);
  };
  /** A bar index: negative counts from the end (-1 = the latest), past the end is the space on the right. */
  const barOf = (v: unknown, fn: string, arg: string): number | null => {
    let b = Number(v);
    if (!Number.isFinite(b)) throw err('BAD_ARG', `${fn}의 ${arg}에는 봉 번호(숫자)가 필요해요. 마지막 봉은 -1.`, `${fn}: ${arg} must be a bar index; -1 is the latest bar.`);
    if (b < 0) b += n;
    return b < 0 || b > n - 1 + DRAW_LIMITS.future ? null : b;
  };
  const priceOf = (v: unknown, fn: string, arg: string): number => {
    const p = Number(v);
    if (!Number.isFinite(p)) throw err('BAD_ARG', `${fn}의 ${arg}에는 숫자(가격)가 필요해요. (받은 값: ${String(v)})`, `${fn}: ${arg} must be a number (a price); got ${String(v)}.`);
    return p;
  };
  /** Keeps the latest `max` (the oldest go first, as charting platforms do). */
  const keepLatest = <T>(list: T[], max: number) => {
    if (list.length > max * 2) list.splice(0, list.length - max);
  };

  function plot(name: unknown, values: unknown, o: { color?: unknown; width?: unknown; style?: unknown; lineStyle?: unknown; offset?: unknown } = {}) {
    declared('plot');
    const nm = env.text(name, 'plot', 'name');
    if (out.plots.length >= DRAW_LIMITS.plots) throw err('LIMIT', `plot은 ${DRAW_LIMITS.plots}개까지예요.`, `At most ${DRAW_LIMITS.plots} plots.`);
    let v: Float64Array;
    if (values instanceof Series) v = values;
    else if (isSeries(values)) v = Float64Array.from(values as ArrayLike<number>);
    else if (typeof values === 'number') v = new Float64Array(n).fill(values);
    else throw err('BAD_ARG', `plot('${nm}')의 값에는 시리즈나 숫자가 필요해요.`, `plot('${nm}'): values must be a series or a number.`, "예: plot('EMA', ta.ema(close, 20))", "e.g. plot('EMA', ta.ema(close, 20))");
    const kind = oneOf(o?.style, PLOT_STYLES, 'line', 'plot', 'style');
    const width = widthOf(o?.width, 'plot');
    const offset = o?.offset === undefined ? 0 : Number(o.offset);
    if (!(Number.isInteger(offset) && Math.abs(offset) <= 500)) throw err('BAD_ARG', 'plot의 offset은 -500~500 사이 정수(봉 수)예요.', 'plot: offset must be a whole number of bars from -500 to 500.');
    const { color, colors } = colorOrPerBar(o?.color, `plot('${nm}')`);
    out.plots.push({ name: nm, values: Float64Array.from(env.sameLength(v, `plot('${nm}')`)), color, colors, kind, width: Math.max(1, width), lineStyle: oneOf(o?.lineStyle, LINE_STYLES, 'solid', 'plot', 'lineStyle'), offset });
  }

  function hline(value: unknown, o: { label?: unknown; color?: unknown; style?: unknown; width?: unknown } = {}) {
    declared('hline');
    const v = Number(value);
    if (!Number.isFinite(v)) throw err('BAD_ARG', 'hline에는 숫자가 필요해요. 예: hline(70)', 'hline needs a number, e.g. hline(70).');
    if (out.hlines.length >= DRAW_LIMITS.hlines) throw err('LIMIT', `hline은 ${DRAW_LIMITS.hlines}개까지예요.`, `At most ${DRAW_LIMITS.hlines} hlines.`);
    out.hlines.push({ value: v, label: o?.label === undefined ? null : env.text(o.label, 'hline', 'label'), color: colorOf(o?.color, 'hline'), style: oneOf(o?.style, LINE_STYLES, 'dashed', 'hline', 'style'), width: Math.max(1, widthOf(o?.width, 'hline')) });
  }

  function fill(upper: unknown, lower: unknown, o: { color?: unknown; downColor?: unknown } = {}) {
    declared('fill');
    if (out.fills.length >= DRAW_LIMITS.fills) throw err('LIMIT', `fill은 ${DRAW_LIMITS.fills}개까지예요.`, `At most ${DRAW_LIMITS.fills} fills.`);
    const names = [env.text(upper, 'fill', 'upper'), env.text(lower, 'fill', 'lower')] as const;
    for (const nm of names)
      if (!out.plots.some((p) => p.name === nm))
        throw err(
          'BAD_ARG',
          `fill: '${nm}'이라는 plot이 없어요. fill은 plot의 이름으로, plot 다음에 써요.`,
          `fill: there is no plot named '${nm}'. fill takes plot names, after the plots.`,
          "plot('위', upper)\nplot('아래', lower)\nfill('위', '아래', { color: color.blue })",
          "plot('Upper', upper)\nplot('Lower', lower)\nfill('Upper', 'Lower', { color: color.blue })",
        );
    if (names[0] === names[1]) throw err('BAD_ARG', 'fill에는 서로 다른 plot 두 개가 필요해요.', 'fill needs two different plots.');
    const { color, colors } = colorOrPerBar(o?.color, 'fill');
    out.fills.push({ upper: names[0], lower: names[1], color, downColor: colorOf(o?.downColor, 'fill'), colors });
  }

  /** bgcolor / barcolor: a condition with a color, or a function of the bar giving a color (or null). */
  function perBar(when: unknown, o: { color?: unknown } | undefined, fn: string, fallback: string): BarColorsOut {
    if (typeof when === 'function') return colorsOf(when as (i: number) => unknown, fn);
    const on = env.condOf(when, fn, `${fn}(gt(close, ta.ema(close, 200)), { color: color.green })`);
    const c = colorOf(o?.color, fn) ?? fallback;
    return { palette: [c], index: Uint8Array.from(on, (b) => (b ? 0 : 255)) };
  }

  function bgcolor(when: unknown, o: { color?: unknown } = {}) {
    declared('bgcolor');
    if (out.backgrounds.length >= DRAW_LIMITS.backgrounds) throw err('LIMIT', `bgcolor는 ${DRAW_LIMITS.backgrounds}개까지예요.`, `At most ${DRAW_LIMITS.backgrounds} bgcolor calls.`);
    out.backgrounds.push({ colors: perBar(when, o, 'bgcolor', '#7048E8') });
  }

  function barcolor(when: unknown, o: { color?: unknown } = {}) {
    declared('barcolor');
    const next = perBar(when, o, 'barcolor', '#FCC419');
    if (!out.barColors) return void (out.barColors = next);
    // Later calls win where they color a bar.
    const prev = out.barColors;
    const palette = [...prev.palette];
    const map = next.palette.map((c) => {
      let k = palette.indexOf(c);
      if (k < 0) {
        if (palette.length >= 254) throw err('LIMIT', 'barcolor: 서로 다른 색은 254가지까지예요.', 'barcolor: at most 254 different colors.');
        k = palette.push(c) - 1;
      }
      return k;
    });
    out.barColors = { palette, index: Uint8Array.from(prev.index, (k, i) => (next.index[i] === 255 ? k : map[next.index[i]!]!)) };
  }

  function plotshape(when: unknown, o: { shape?: unknown; location?: unknown; price?: unknown; color?: unknown; textColor?: unknown; text?: unknown; size?: unknown } = {}) {
    declared('plotshape');
    if (out.shapes.length >= DRAW_LIMITS.shapes) throw err('LIMIT', `plotshape은 ${DRAW_LIMITS.shapes}개까지예요.`, `At most ${DRAW_LIMITS.shapes} plotshape calls.`);
    const whenBars = env.condOf(when, 'plotshape', "plotshape(ta.crossover(fast, slow), { shape: 'triangleup', color: color.up })");
    const shape = oneOf(o?.shape, SHAPES, 'circle', 'plotshape', 'shape');
    const up = shape === 'triangleup' || shape === 'arrowup', down = shape === 'triangledown' || shape === 'arrowdown';
    const location = oneOf(o?.location, LOCATIONS, up ? 'below' : 'above', 'plotshape', 'location');
    let price: Float64Array | null = null;
    if (location === 'price') {
      const p = o?.price;
      if (p === undefined) throw err('BAD_ARG', "plotshape: location 'price'에는 price가 필요해요.", "plotshape: location 'price' needs price.", "plotshape(cond, { location: 'price', price: low })");
      price = typeof p === 'number' ? new Float64Array(n).fill(p) : isSeries(p) ? Float64Array.from(env.sameLength(p as ArrayLike<number>, 'plotshape price')) : null;
      if (!price) throw err('BAD_ARG', 'plotshape의 price에는 시리즈나 숫자가 필요해요.', 'plotshape: price must be a series or a number.');
    }
    out.shapes.push({
      when: whenBars,
      shape,
      location,
      price,
      color: colorOf(o?.color, 'plotshape') ?? (up ? 'up' : down ? 'down' : null),
      textColor: colorOf(o?.textColor, 'plotshape'),
      text: textOf(o?.text, 'plotshape'),
      size: oneOf(o?.size, SIZES, 'normal', 'plotshape', 'size'),
    });
  }

  function label(bar: unknown, txt: unknown, o: { location?: unknown; price?: unknown; color?: unknown; textColor?: unknown; style?: unknown; align?: unknown; size?: unknown } = {}) {
    declared('label');
    const b = barOf(bar, 'label', 'bar');
    const t = textOf(txt, 'label');
    if (!t) throw err('BAD_ARG', 'label에는 글자가 필요해요.', 'label needs text.', "label(-1, '지금')", "label(-1, 'now')");
    if (b === null) return; // off the chart: nothing to show
    const location = oneOf(o?.location, LOCATIONS, o?.price !== undefined ? 'price' : 'above', 'label', 'location');
    const price = location === 'price' ? priceOf(o?.price, 'label', 'price') : null;
    out.labels.push({
      bar: b,
      text: t,
      location,
      price,
      color: colorOf(o?.color, 'label'),
      textColor: colorOf(o?.textColor, 'label'),
      style: oneOf(o?.style, ['box', 'text'] as const, 'box', 'label', 'style'),
      align: oneOf(o?.align, ['left', 'center', 'right'] as const, 'center', 'label', 'align'),
      size: oneOf(o?.size, SIZES, 'small', 'label', 'size'),
    });
    keepLatest(out.labels, DRAW_LIMITS.labels);
  }

  function line(x1: unknown, y1: unknown, x2: unknown, y2: unknown, o: { color?: unknown; width?: unknown; style?: unknown; extend?: unknown } = {}) {
    declared('line');
    const a = barOf(x1, 'line', 'x1'), b = barOf(x2, 'line', 'x2');
    const p1 = priceOf(y1, 'line', 'y1'), p2 = priceOf(y2, 'line', 'y2');
    if (a === null || b === null) return;
    out.lines.push({ x1: a, y1: p1, x2: b, y2: p2, color: colorOf(o?.color, 'line'), width: Math.max(1, widthOf(o?.width, 'line')), style: oneOf(o?.style, LINE_STYLES, 'solid', 'line', 'style'), extend: oneOf(o?.extend, EXTENDS, 'none', 'line', 'extend') });
    keepLatest(out.lines, DRAW_LIMITS.lines);
  }

  function box(left: unknown, top: unknown, right: unknown, bottom: unknown, o: { color?: unknown; bg?: unknown; width?: unknown; style?: unknown; extend?: unknown; text?: unknown; textColor?: unknown } = {}) {
    declared('box');
    const l = barOf(left, 'box', 'left'), r = barOf(right, 'box', 'right');
    const t = priceOf(top, 'box', 'top'), b = priceOf(bottom, 'box', 'bottom');
    if (l === null || r === null) return;
    out.boxes.push({
      left: Math.min(l, r),
      right: Math.max(l, r),
      top: Math.max(t, b),
      bottom: Math.min(t, b),
      color: colorOf(o?.color, 'box'),
      bg: colorOf(o?.bg, 'box'),
      width: widthOf(o?.width, 'box'),
      style: oneOf(o?.style, LINE_STYLES, 'solid', 'box', 'style'),
      extend: oneOf(o?.extend, EXTENDS, 'none', 'box', 'extend'),
      text: textOf(o?.text, 'box'),
      textColor: colorOf(o?.textColor, 'box'),
    });
    keepLatest(out.boxes, DRAW_LIMITS.boxes);
  }

  function table(o: { position?: unknown; rows?: unknown; bg?: unknown; textColor?: unknown; border?: unknown; size?: unknown }) {
    declared('table');
    if (out.tables.length >= DRAW_LIMITS.tables) throw err('LIMIT', `table은 ${DRAW_LIMITS.tables}개까지예요.`, `At most ${DRAW_LIMITS.tables} tables.`);
    const rows = o?.rows;
    if (!Array.isArray(rows) || !rows.every(Array.isArray))
      throw err('BAD_ARG', 'table의 rows에는 줄 목록(각 줄은 칸 목록)이 필요해요.', 'table: rows must be a list of rows, each a list of cells.', "table({ position: 'top-right', rows: [['RSI', last(rsi).toFixed(1)]] })");
    if (rows.length > DRAW_LIMITS.tableRows || rows.some((r) => r.length > DRAW_LIMITS.tableCols))
      throw err('LIMIT', `table은 ${DRAW_LIMITS.tableRows}줄 × ${DRAW_LIMITS.tableCols}칸까지예요.`, `A table holds up to ${DRAW_LIMITS.tableRows} rows × ${DRAW_LIMITS.tableCols} cells.`);
    const cell = (c: unknown): CellOut => {
      if (c === null || c === undefined) return { text: '', color: null, bg: null, align: null };
      if (typeof c === 'string' || typeof c === 'number') return { text: String(c).slice(0, DRAW_LIMITS.text), color: null, bg: null, align: null };
      const x = c as Record<string, unknown>;
      return { text: textOf(x.text, 'table') ?? '', color: colorOf(x.color, 'table'), bg: colorOf(x.bg, 'table'), align: x.align === undefined ? null : oneOf(x.align, ['left', 'center', 'right'] as const, 'left', 'table', 'align') };
    };
    out.tables.push({
      position: oneOf(o?.position, POSITIONS, 'top-right', 'table', 'position'),
      rows: (rows as unknown[][]).map((r) => r.map(cell)),
      bg: colorOf(o?.bg, 'table'),
      textColor: colorOf(o?.textColor, 'table'),
      border: colorOf(o?.border, 'table'),
      size: oneOf(o?.size, SIZES, 'small', 'table', 'size'),
    });
  }

  const done = (): Drawn => {
    for (const [list, max] of [[out.labels, DRAW_LIMITS.labels], [out.lines, DRAW_LIMITS.lines], [out.boxes, DRAW_LIMITS.boxes]] as const) if (list.length > max) list.splice(0, list.length - max);
    return out;
  };

  return { api: { plot, hline, fill, bgcolor, barcolor, plotshape, label, line, box, table }, colorOf, done };
}
