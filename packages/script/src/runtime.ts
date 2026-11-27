import { createLib, type Bars } from './lib';
import { colorApi, createDrawing, DRAW_LIMITS, isColor, type BackgroundOut, type BarColorsOut, type BoxOut, type FillOut, type HlineOut, type LabelOut, type LineOut, type PlotOut, type ShapeOut, type TableOut } from './draw';
import { Cond, ScriptError, Series, isSeries, type ErrorCode, type Locale, type Text } from './series';
import { STRATEGY_LIMITS, entryCount, strategyBuffers, type Level, type Levels, type Step, type Steps, type Strategy } from './strategy';
import { REQUEST_TIMEFRAMES, SYMBOL_PATTERN, createRequests, spacingOf, type RequestData, type RequestSpec } from './request';
import { PERIODS, isTimeZone, minuteOfDay, parseSession, partOf, type Part, type Period } from './time';

export { DATA_NAMES, DATA_SOURCES, REQUEST_TIMEFRAMES, alignBars, barsKey, dataKey, spacingOf, type DataName, type RequestData, type RequestedBars, type RequestSpec, type RequestTimeframe } from './request';

export { SHAPES, type MarkLocation, type Shape } from './draw';
export type { BackgroundOut, BarColorsOut, BoxOut, CellOut, FillOut, HlineOut, LabelOut, LineOut, PlotOut, ShapeOut, TableOut } from './draw';

/**
 * Runs a Funnest Script v2 on some bars: the same code in the app (a sandboxed Worker), in tests
 * and in the CLI / MCP tools. A script is synchronous JavaScript with these names in scope (see
 * spec.ts for the full list); it must start with `//@version=2` and call `indicator({…})` first.
 */

export const VERSION_LINE = /^\s*\/\/\s*@version\s*=\s*2\b/;
export const isV2 = (code: string) => VERSION_LINE.test(code);

/** The name the script's code runs under: stack frames from it give the user's line. */
const SOURCE_NAME = 'funnest-script.js';
const SOURCE_FRAME = /funnest-script\.js:(\d+):(\d+)/;

export const LIMITS = { ...DRAW_LIMITS, inputs: 300, logs: 50, alerts: 10, screens: 10 } as const;

/** An alert(): rings when its condition is true on a bar that just closed (the app's runner). */
export interface AlertOut {
  /** As written: may hold {name}, {symbol}, {close}, {time} (filled in when it rings). */
  message: string;
  /** 1 on the bars where it would ring. */
  when: Uint8Array;
}
/** A screen(): a column of the screener, the value on the last bar. */
export interface ScreenOut {
  name: string;
  value: number;
}

/** Inputs by label: numbers (bool 0/1, select and source: the option's index). */
export type InputValues = Record<string, number | string>;

interface InputMeta {
  /** Section it's shown under. */
  group?: string;
  /** Inputs with the same key share one row. */
  inline?: string;
  /** A note shown with it (ⓘ). */
  tooltip?: string;
}
export type InputSpec = InputMeta &
  (
    | { label: string; kind: 'number' | 'int'; default: number; min?: number; max?: number; step?: number }
    | { label: string; kind: 'bool'; default: number }
    | { label: string; kind: 'select' | 'source'; default: number; options: string[] }
    /** A color ('#RRGGBB(AA)' or 'up' / 'down'); its value in InputValues is the color itself. */
    | { label: string; kind: 'color'; default: string }
    | { label: string; kind: 'text'; default: string }
    /** An interval from `options` ('60', '1D'…); its value in InputValues is the interval itself. */
    | { label: string; kind: 'timeframe'; default: string; options: string[] }
    /** A market ('BINANCEF:BTCUSDT'); its value is the symbol. */
    | { label: string; kind: 'symbol'; default: string }
    /** A moment (UTC ms); its value is the number. */
    | { label: string; kind: 'time'; default: number }
  );

/** A script's strategy (see strategy.ts). */
export type Signals = Strategy;
export interface Warning {
  code: 'EMPTY_PLOT' | 'OVERLAY_SCALE' | 'NO_SIGNALS' | 'DUPLICATE_PLOT';
  message: string;
}
export interface Meta {
  name: string;
  overlay: boolean;
  precision: number | null;
  range: [number, number] | null;
  /** The interval the script is written for ('60' = 1 hour), or null when any interval suits it. */
  timeframe: string | null;
}

export type RunResult =
  | {
      ok: true;
      version: 2;
      meta: Meta;
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
      alerts: AlertOut[];
      screens: ScreenOut[];
      inputs: InputSpec[];
      strategy: Signals | null;
      logs: string[];
      warnings: Warning[];
      /** Data the script asked for (request.bars / request.data), and which of it this run lacked. */
      requests: RequestSpec[];
    }
  | {
      ok: false;
      version: 2;
      code: ErrorCode;
      error: string;
      hint: string | null;
      line: number | null;
      column: number | null;
      /** The line of code it happened on. */
      snippet: string | null;
      /** Data asked for before it failed (a first pass may fail on the NaN it got: fetch, then run again). */
      requests: RequestSpec[];
    };

/** A compiled script and how to find its lines in an error's stack. */
export interface Compiled {
  fn: (...args: unknown[]) => unknown;
  /** Matches the script's frames in a stack: (line)(column). */
  frame: RegExp;
  /** Lines before the script's first line in what was compiled. */
  offset: number;
}
/** Compiles `body` as a function of `names` (a host may do it so its engine reports lines). */
export type Compile = (names: string[], body: string) => Compiled;

export interface RunOptions {
  locale?: Locale;
  /**
   * How to compile the script. Default: `new Function` with a sourceURL, which V8 and Firefox
   * report lines for; Safari doesn't, so the sandbox Worker loads the code as a script instead.
   */
  compile?: Compile;
  /** Data fetched for this script's requests (a second pass). */
  requests?: RequestData;
  /** The chart's bar length in ms (else the usual gap between its bars). */
  spacing?: number;
  /** The market the bars are of (`syminfo`); what's left out reads as unknown. */
  symbol?: SymbolContext;
  /** The chart's interval ('60', '1D'…; else worked out from the bars' spacing). */
  timeframe?: string;
  /** The latest bar has closed (`bar.confirmed`); false (the default) while it is still forming. */
  confirmed?: boolean;
}

/** What a host knows of the market (all optional). */
export interface SymbolContext {
  /** 'BINANCEF:BTCUSDT', 'UPBIT:KRW-BTC', 'KRX:005930'. */
  symbol?: string;
  /** As people read it: 'BTCUSDT 무기한', '삼성전자'. */
  name?: string;
  market?: 'spot' | 'perp' | 'stock' | 'index' | 'other';
  /** Quote currency: 'USDT', 'KRW', 'USD'. */
  currency?: string;
  /** Base asset of a crypto pair ('BTC'). */
  base?: string;
  /** The price step at the latest price (NaN: unknown). */
  tick?: number;
  /** Where its day starts: 'UTC' for crypto, 'Asia/Seoul' for Korean stocks, 'America/New_York' for US stocks. */
  timezone?: string;
}

/** syminfo as scripts see it. */
export interface SymInfo {
  symbol: string;
  ticker: string;
  exchange: string;
  name: string;
  market: 'spot' | 'perp' | 'stock' | 'index' | 'other' | 'unknown';
  currency: string;
  base: string;
  tick: number;
  timezone: string;
}

const MARKETS = ['spot', 'perp', 'stock', 'index', 'other'] as const;
/** Plain short text from a host (shown to scripts; never markup). */
const plain = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

/** syminfo from what the host said: unknowns are '' / NaN, the zone UTC. */
export function symInfoOf(c: SymbolContext | undefined): SymInfo {
  const symbol = plain(c?.symbol, 60);
  const colon = symbol.indexOf(':');
  const tick = Number(c?.tick);
  const timezone = plain(c?.timezone, 40);
  return {
    symbol,
    ticker: colon >= 0 ? symbol.slice(colon + 1) : symbol,
    exchange: colon >= 0 ? symbol.slice(0, colon) : '',
    name: plain(c?.name, 60),
    market: (MARKETS as readonly unknown[]).includes(c?.market) ? c!.market! : 'unknown',
    currency: plain(c?.currency, 12),
    base: plain(c?.base, 20),
    tick: Number.isFinite(tick) && tick > 0 ? tick : Number.NaN,
    timezone: timezone && isTimeZone(timezone) ? timezone : 'UTC',
  };
}

const MINUTES: Record<string, number> = { '1D': 1440, '1W': 10_080, '1M': 43_200 };
/** The chart's interval as scripts see it (`timeframe`), from the host's word or the bars' spacing. */
export function timeframeOf(given: string | undefined, spacing: number) {
  let period = given === 'D' ? '1D' : given === 'W' ? '1W' : given === 'M' ? '1M' : (given ?? '');
  if (!/^(\d{1,5}|1D|1W|1M)$/.test(period)) {
    const min = Math.max(1, Math.round(spacing / 60_000));
    period = min >= 28 * 1440 ? '1M' : min >= 7 * 1440 ? '1W' : min >= 1440 ? '1D' : String(min);
  }
  const minutes = MINUTES[period] ?? Number(period);
  return {
    period,
    minutes,
    seconds: minutes * 60,
    isIntraday: minutes < 1440,
    isDaily: period === '1D',
    isWeekly: period === '1W',
    isMonthly: period === '1M',
  };
}

const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'] as const;
const say = (t: Text, locale: Locale) => t[locale] ?? t.en;
const err = (code: ErrorCode, ko: string, en: string, hintKo?: string, hintEn?: string) =>
  new ScriptError(code, { ko, en }, hintKo ? { ko: hintKo, en: hintEn ?? hintKo } : undefined);

/** A condition used where JavaScript wants true/false: always "true", the classic silent bug. */
const CONDITION_IN_IF = /\b(?:if|while)\s*\(\s*!?\s*(?:(?:ta\.)?(?:crossover|crossunder|cross|rising|falling|gt|lt|gte|lte|eq|and|or|not)|date\.(?:isNew|session))\s*\(/g;

/** The code with comments and strings blanked (same length and lines), so checks don't read them. */
export function codeOnly(code: string): string {
  let out = '';
  for (let i = 0; i < code.length; ) {
    const c = code[i]!, d = code[i + 1];
    let end = i + 1;
    if (c === '/' && d === '/') end = (code.indexOf('\n', i) + 1 || code.length + 1) - 1;
    else if (c === '/' && d === '*') end = (code.indexOf('*/', i + 2) + 1 || code.length - 1) + 1;
    else if (c === "'" || c === '"' || c === '`') {
      end = i + 1;
      while (end < code.length && code[end] !== c && (c === '`' || code[end] !== '\n')) end += code[end] === '\\' ? 2 : 1;
      end = Math.min(code.length, end + 1);
    } else {
      out += c;
      i++;
      continue;
    }
    out += code.slice(i, end).replace(/[^\n]/g, ' ');
    i = end;
  }
  return out;
}

/** Where a condition series is the whole test of an if / while (`if (gt(a, b))`), or -1. `if (gt(a, b)[i])` is fine. */
function conditionInIf(code: string): number {
  const src = codeOnly(code);
  for (const m of src.matchAll(CONDITION_IN_IF)) {
    let depth = 0, j = m.index! + m[0].length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    const after = src.slice(j + 1).trimStart()[0];
    if (after !== '[' && after !== '.') return m.index!;
  }
  return -1;
}

export function execute(code: string, bars: Bars, inputValues: InputValues = {}, options: RunOptions = {}): RunResult {
  const locale = options.locale ?? 'ko';
  const lines = code.split('\n');
  let compiled: Compiled | null = null;
  let requested: RequestSpec[] = [];
  const fail = (e: unknown): RunResult => {
    const se = e instanceof ScriptError ? e : null;
    const pos = positionOf(e, se ? null : code, compiled);
    const code_: ErrorCode = se ? se.code : e instanceof SyntaxError ? 'SYNTAX' : 'RUNTIME';
    const message = se ? say(se.text, locale) : String((e as Error)?.message ?? e);
    return {
      ok: false,
      version: 2,
      code: code_,
      error: message.slice(0, 400),
      hint: se?.hint ? say(se.hint, locale) : code_ === 'SYNTAX' ? say({ ko: '괄호·따옴표가 짝이 맞는지, 쉼표가 빠지지 않았는지 확인하세요.', en: 'Check that brackets and quotes are balanced and no comma is missing.' }, locale) : null,
      line: pos?.line ?? null,
      column: pos?.column ?? null,
      snippet: pos ? (lines[pos.line - 1]?.trim().slice(0, 200) ?? null) : null,
      requests: requested,
    };
  };

  if (!isV2(code)) return fail(err('MISSING_DECLARATION', '첫 줄에 //@version=2 가 필요해요.', 'The first line must be //@version=2.'));
  const condAt = conditionInIf(code);
  if (condAt >= 0) {
    const line = code.slice(0, condAt).split('\n').length;
    const e = err(
      'CONDITION_IN_IF',
      '조건 시리즈(crossover, gt 등)는 if 안에 바로 쓸 수 없어요. 항상 참이 돼요.',
      'A condition series (crossover, gt, …) can’t go straight into if: it is always true.',
      '봉마다 판단하려면 map(i => …) 안에서 cond[i]를 쓰고, 전략 신호라면 strategy({ entry: 조건 }) 처럼 그대로 넘기세요.',
      'To decide per bar, use cond[i] inside map(i => …); for strategy signals pass the condition itself, e.g. strategy({ entry: cond }).',
    );
    return { ...(fail(e) as Extract<RunResult, { ok: false }>), line, column: null, snippet: lines[line - 1]?.trim() ?? null };
  }

  const n = bars.close.length;
  const syminfo = Object.freeze(symInfoOf(options.symbol));
  const { ta, calc, clock } = createLib(bars, { timezone: syminfo.timezone });
  const spacing = options.spacing ?? spacingOf(bars.time);
  const timeframe = Object.freeze(timeframeOf(options.timeframe, spacing));
  const asSeries = (a: Float64Array) => Series.from(a) as Series;
  const open = asSeries(bars.open), high = asSeries(bars.high), low = asSeries(bars.low), close = asSeries(bars.close);
  const volume = asSeries(bars.volume), time = asSeries(bars.time);
  const hl2 = calc.map((i) => (high[i]! + low[i]!) / 2);
  const hlc3 = calc.map((i) => (high[i]! + low[i]! + close[i]!) / 3);
  const ohlc4 = calc.map((i) => (open[i]! + high[i]! + low[i]! + close[i]!) / 4);
  const hlcc4 = calc.map((i) => (high[i]! + low[i]! + close[i]! * 2) / 4);
  const turnover = bars.turnover && bars.turnover.length === n ? asSeries(bars.turnover) : new Series(n).fill(Number.NaN);
  const sources: Record<(typeof SOURCES)[number], Series> = { close, open, high, low, hl2, hlc3, ohlc4, hlcc4 };

  let meta: Meta | null = null;
  const inputs: InputSpec[] = [];
  const logs: string[] = [];
  const alerts: AlertOut[] = [];
  const screens: ScreenOut[] = [];
  let strategy: Signals | null = null;

  const declared = (fn: string) => {
    if (!meta)
      throw err(
        'MISSING_DECLARATION',
        `${fn}보다 먼저 indicator({ name, overlay })를 불러야 해요.`,
        `Call indicator({ name, overlay }) before ${fn}.`,
        "둘째 줄에 indicator({ name: '이름', overlay: true }) 를 넣으세요.",
        "Put indicator({ name: 'My indicator', overlay: true }) on the second line.",
      );
  };
  const text = (v: unknown, fn: string, arg: string, max: number = LIMITS.name) => {
    if (typeof v !== 'string' || !v.trim()) throw err('BAD_ARG', `${fn}의 ${arg}에는 글자가 필요해요.`, `${fn}: ${arg} must be a non-empty string.`);
    return v.trim().slice(0, max);
  };


  // ── declaration ──────────────────────────────────────────────────
  function indicator(o: unknown) {
    if (meta) throw err('DECLARATION_TWICE', 'indicator()는 한 번만 부를 수 있어요.', 'indicator() can only be called once.');
    if (!o || typeof o !== 'object') throw err('BAD_ARG', "indicator에는 { name, overlay }가 필요해요. 예: indicator({ name: 'EMA', overlay: true })", "indicator needs { name, overlay }, e.g. indicator({ name: 'EMA', overlay: true }).");
    const x = o as Record<string, unknown>;
    if (typeof x.overlay !== 'boolean')
      throw err('BAD_ARG', 'indicator의 overlay에는 true(캔들 위) 또는 false(아래 칸)가 필요해요.', 'indicator: overlay must be true (on the candles) or false (own pane below).');
    const range = Array.isArray(x.range) && x.range.length === 2 && x.range.every((v) => Number.isFinite(v)) && x.range[1] > x.range[0] ? ([x.range[0], x.range[1]] as [number, number]) : null;
    if (x.range !== undefined && !range) throw err('BAD_ARG', 'indicator의 range는 [최소, 최대] 숫자 두 개여야 해요. 예: [0, 100]', 'indicator: range must be [min, max], e.g. [0, 100].');
    const precision = x.precision === undefined ? null : Number(x.precision);
    if (precision !== null && !(Number.isInteger(precision) && precision >= 0 && precision <= 10)) throw err('BAD_ARG', 'indicator의 precision은 0~10 사이 정수여야 해요.', 'indicator: precision must be a whole number 0–10.');
    const timeframe = x.timeframe === undefined ? null : String(x.timeframe);
    if (timeframe !== null && !(REQUEST_TIMEFRAMES as readonly string[]).includes(timeframe))
      throw err('BAD_ARG', `indicator의 timeframe은 ${REQUEST_TIMEFRAMES.map((t) => `'${t}'`).join(', ')} 중 하나여야 해요. 예: '60' (1시간)`, `indicator: timeframe must be one of ${REQUEST_TIMEFRAMES.map((t) => `'${t}'`).join(', ')}, e.g. '60' (1 hour).`);
    meta = { name: text(x.name, 'indicator', 'name'), overlay: x.overlay, precision, range, timeframe };
  }

  // ── inputs ───────────────────────────────────────────────────────
  const add = (spec: InputSpec) => {
    declared('input');
    if (inputs.some((x) => x.label === spec.label)) throw err('BAD_ARG', `입력값 이름 '${spec.label}'이(가) 두 번 나와요. 이름은 서로 달라야 해요.`, `Input '${spec.label}' is declared twice; labels must be unique.`);
    if (inputs.length >= LIMITS.inputs) throw err('LIMIT', `입력값은 ${LIMITS.inputs}개까지예요.`, `At most ${LIMITS.inputs} inputs.`);
    inputs.push(spec);
  };
  const given = (label: string): number | undefined => {
    const v = Object.prototype.hasOwnProperty.call(inputValues, label) ? Number(inputValues[label]) : Number.NaN;
    return Number.isFinite(v) ? v : undefined;
  };
  /** Where an input is shown: its section (group), its row (inputs with the same inline key), a note (tooltip). */
  const metaOf = (o: unknown, fn: string): { group?: string; inline?: string; tooltip?: string } => {
    const x = (o ?? {}) as Record<string, unknown>;
    const opt = (k: 'group' | 'inline' | 'tooltip', max: number) => (x[k] === undefined ? undefined : text(x[k], fn, k, max));
    const meta = { group: opt('group', 60), inline: opt('inline', 30), tooltip: opt('tooltip', 1000) };
    return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
  };
  type InputOptions = { min?: number; max?: number; step?: number; group?: string; inline?: string; tooltip?: string };
  function number(label: unknown, def: unknown, o: InputOptions = {}, kind: 'number' | 'int' = 'number'): number {
    const l = text(label, `input.${kind}`, 'label');
    const d = Number(def);
    if (!Number.isFinite(d)) throw err('BAD_ARG', `input.${kind}의 기본값에는 숫자가 필요해요.`, `input.${kind}: the default must be a number.`);
    const min = Number.isFinite(o?.min) ? Number(o.min) : undefined, max = Number.isFinite(o?.max) ? Number(o.max) : undefined;
    const step = kind === 'int' ? 1 : Number.isFinite(o?.step) ? Number(o.step) : undefined;
    add({ label: l, kind, default: kind === 'int' ? Math.round(d) : d, min, max, step, ...metaOf(o, `input.${kind}`) });
    let v = given(l) ?? d;
    if (kind === 'int') v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }
  const input = Object.assign((label: unknown, def: unknown, o?: InputOptions) => number(label, def, o), {
    number: (label: unknown, def: unknown, o?: InputOptions) => number(label, def, o),
    int: (label: unknown, def: unknown, o?: InputOptions) => number(label, def, o, 'int'),
    bool: (label: unknown, def: unknown, o?: InputOptions) => {
      const l = text(label, 'input.bool', 'label');
      if (typeof def !== 'boolean') throw err('BAD_ARG', 'input.bool의 기본값에는 true 또는 false가 필요해요.', 'input.bool: the default must be true or false.');
      add({ label: l, kind: 'bool', default: def ? 1 : 0, ...metaOf(o, 'input.bool') });
      const v = given(l);
      return v === undefined ? def : v !== 0;
    },
    select: (label: unknown, options: unknown, def: unknown, o?: InputOptions) => {
      const l = text(label, 'input.select', 'label');
      if (!Array.isArray(options) || !options.length || options.length > 40 || !options.every((x) => (typeof x === 'string' && x.trim()) || typeof x === 'number'))
        throw err('BAD_ARG', "input.select의 options에는 글자(또는 숫자) 목록이 필요해요. 예: ['EMA', 'SMA']", "input.select: options must be a list of strings (or numbers), e.g. ['EMA', 'SMA'].");
      const numeric = options.every((x) => typeof x === 'number');
      const opts = (options as (string | number)[]).map((x) => String(x).trim().slice(0, 40));
      const d = opts.indexOf(String(def));
      if (d < 0) throw err('BAD_ARG', `input.select의 기본값 '${String(def)}'이(가) options에 없어요.`, `input.select: default '${String(def)}' is not one of the options.`);
      add({ label: l, kind: 'select', default: d, options: opts, ...metaOf(o, 'input.select') });
      const v = given(l);
      const k = v !== undefined && v >= 0 && v < opts.length ? Math.round(v) : d;
      // A list of numbers gives the number back (input.select('선 A', [1, 2, 3], 1) → 1).
      return numeric ? (options as number[])[k]! : opts[k]!;
    },
    source: (label: unknown, def: unknown = 'close', o?: InputOptions) => {
      const l = text(label, 'input.source', 'label');
      const d = SOURCES.indexOf(def as (typeof SOURCES)[number]);
      if (d < 0) throw err('BAD_ARG', `input.source의 기본값은 ${SOURCES.join(', ')} 중 하나여야 해요.`, `input.source: the default must be one of ${SOURCES.join(', ')}.`);
      add({ label: l, kind: 'source', default: d, options: [...SOURCES], ...metaOf(o, 'input.source') });
      const v = given(l);
      return sources[SOURCES[v !== undefined && v >= 0 && v < SOURCES.length ? Math.round(v) : d]!];
    },
    /** Free text (a list like '1,3,6,8'); up to 200 characters. */
    text: (label: unknown, def: unknown = '', o?: InputOptions) => {
      const l = text(label, 'input.text', 'label');
      if (typeof def !== 'string') throw err('BAD_ARG', 'input.text의 기본값에는 글자가 필요해요.', 'input.text: the default must be a string.');
      add({ label: l, kind: 'text', default: def.slice(0, 200), ...metaOf(o, 'input.text') });
      const v = Object.prototype.hasOwnProperty.call(inputValues, l) ? inputValues[l] : undefined;
      return typeof v === 'string' ? v.slice(0, 200) : def.slice(0, 200);
    },
    color: (label: unknown, def: unknown, o?: InputOptions) => {
      const l = text(label, 'input.color', 'label');
      if (!isColor(def)) throw err('BAD_ARG', "input.color의 기본값에는 color.red 같은 색이나 '#RRGGBB'가 필요해요.", "input.color: the default must be a color like color.red or '#RRGGBB'.");
      add({ label: l, kind: 'color', default: def, ...metaOf(o, 'input.color') });
      const v = Object.prototype.hasOwnProperty.call(inputValues, l) ? inputValues[l] : undefined;
      return isColor(v) ? v : def;
    },
    /** An interval for request.bars ('60', '240', '1D'…). */
    timeframe: (label: unknown, def: unknown = '1D', o?: InputOptions) => {
      const l = text(label, 'input.timeframe', 'label');
      const list = REQUEST_TIMEFRAMES as readonly string[];
      if (typeof def !== 'string' || !list.includes(def)) throw err('BAD_ARG', `input.timeframe의 기본값은 ${list.map((t) => `'${t}'`).join(', ')} 중 하나예요.`, `input.timeframe: the default is one of ${list.map((t) => `'${t}'`).join(', ')}.`, "input.timeframe('Higher timeframe', '240')");
      add({ label: l, kind: 'timeframe', default: def, options: [...list], ...metaOf(o, 'input.timeframe') });
      const v = Object.prototype.hasOwnProperty.call(inputValues, l) ? inputValues[l] : undefined;
      return typeof v === 'string' && list.includes(v) ? v : def;
    },
    /** A market for request.bars / request.data ('BINANCEF:ETHUSDT'). */
    symbol: (label: unknown, def: unknown, o?: InputOptions) => {
      const l = text(label, 'input.symbol', 'label');
      if (typeof def !== 'string' || !SYMBOL_PATTERN.test(def)) throw err('BAD_ARG', "input.symbol의 기본값은 'BINANCEF:BTCUSDT', 'UPBIT:KRW-BTC'처럼 거래소:종목이에요.", "input.symbol: the default is exchange:symbol, e.g. 'BINANCEF:BTCUSDT' or 'UPBIT:KRW-BTC'.", "input.symbol('Compare with', 'BINANCEF:ETHUSDT')");
      add({ label: l, kind: 'symbol', default: def, ...metaOf(o, 'input.symbol') });
      const v = Object.prototype.hasOwnProperty.call(inputValues, l) ? inputValues[l] : undefined;
      return typeof v === 'string' && SYMBOL_PATTERN.test(v) ? v : def;
    },
    /** A moment the user picks (an anchor): UTC ms. The default may be a number or a date like '2026-01-01T00:00:00Z'. */
    time: (label: unknown, def: unknown, o?: InputOptions) => {
      const l = text(label, 'input.time', 'label');
      const d = typeof def === 'number' ? def : typeof def === 'string' ? Date.parse(def) : Number.NaN;
      if (!Number.isFinite(d) || Math.abs(d) > 8.64e15) throw err('BAD_ARG', "input.time의 기본값에는 시각(밀리초)이나 '2026-01-01T00:00:00Z' 같은 날짜가 필요해요.", "input.time: the default must be a time in ms or a date like '2026-01-01T00:00:00Z'.", "input.time('Anchor', '2026-01-01T00:00:00Z')");
      add({ label: l, kind: 'time', default: d, ...metaOf(o, 'input.time') });
      const v = given(l);
      return v !== undefined && Math.abs(v) <= 8.64e15 ? v : d;
    },
  });

  // ── drawing ──────────────────────────────────────────────────────
  /** A series made for these bars: one value per bar (not a slice of one). */
  function sameLength<T extends ArrayLike<number>>(v: T, what: string): T {
    if (v.length !== n)
      throw err(
        'BAD_ARG',
        `${what}의 길이(${v.length})가 봉 수(${n})와 달라요.`,
        `${what}: length ${v.length} differs from the number of bars (${n}).`,
        'slice로 자른 시리즈 말고 봉마다 값이 있는 시리즈를 넘기세요. 일부 봉만 쓰려면 map(i => …)에서 나머지를 NaN으로 두세요.',
        'Pass a series with a value for every bar, not a slice; to use some bars only, return NaN for the others in map(i => …).',
      );
    return v;
  }
  /** A condition per bar (1 / 0) from a Cond or a Series (non-zero = true). */
  function condOf(v: unknown, what: string, example: string): Uint8Array {
    if (v instanceof Uint8Array || isSeries(v)) return Uint8Array.from(sameLength(v as ArrayLike<number>, what), (b) => (b && !Number.isNaN(b) ? 1 : 0));
    throw err('BAD_ARG', `${what}에는 조건(crossover, gt 등의 결과)이 필요해요.`, `${what} must be a condition (from crossover, gt, …).`, example);
  }
  const drawing = createDrawing({ n, err, declared, text, sameLength, condOf });
  const requests = createRequests(n, bars.time, options.requests, err, options.spacing, { timezone: syminfo.timezone });

  // ── bars, dates (in the market's zone unless one is given) ───────
  const bar = Object.freeze({ count: n, index: calc.map((i) => i), last: n - 1, confirmed: options.confirmed === true });
  const datePart = (part: Part) => (tz?: unknown) => Series.from(partOf(bars.time, clock.offsetsIn(tz, `date.${part}`), part)) as Series;
  const date = Object.freeze({
    hour: datePart('hour'),
    minute: datePart('minute'),
    dayofweek: datePart('dayofweek'),
    day: datePart('day'),
    month: datePart('month'),
    year: datePart('year'),
    /** True on the first bar of each day / week / month / year. */
    isNew: (period: unknown = 'D', tz?: unknown) => {
      if (!(PERIODS as readonly unknown[]).includes(period)) throw err('BAD_ARG', "date.isNew의 period는 'D' · 'W' · 'M' · 'Y'예요.", "date.isNew: period is 'D', 'W', 'M' or 'Y'.", "date.isNew('D')");
      return Cond.from(clock.startsOf(period as Period, 'date.isNew', tz)) as Cond;
    },
    /** True on bars that open inside the session 'HHMM-HHMM' (local time; past midnight when the end is earlier). */
    session: (spec: unknown, tz?: unknown) => {
      const range = typeof spec === 'string' ? parseSession(spec) : null;
      if (!range) throw err('BAD_ARG', "date.session은 '0900-1530'처럼 시작-끝(시분 네 자리씩)이에요.", "date.session: write it as start-end, four digits each, e.g. '0900-1530'.", "date.session('0900-1530', 'Asia/Seoul')");
      const [a, b] = range;
      const mins = minuteOfDay(bars.time, clock.offsetsIn(tz, 'date.session'));
      return Cond.from(mins, (m) => (a < b ? m >= a && m < b : m >= a || m < b) ? 1 : 0) as Cond;
    },
  });
  requested = requests.specs;

  // ── strategy (signals for the backtest) ──────────────────────────
  function strategyFn(s: unknown) {
    declared('strategy');
    if (strategy)
      throw err(
        'DECLARATION_TWICE',
        'strategy()는 한 번만 부를 수 있어요. 앞의 신호가 사라져요.',
        'strategy() can only be called once; the earlier signals would be lost.',
        '조건 여러 개는 and(a, b), or(a, b)로 묶어 한 번에 넘기세요.',
        'Combine conditions with and(a, b) / or(a, b) and pass them once.',
      );
    const x = (s ?? {}) as Record<string, unknown>;
    const EXAMPLE = 'strategy({ long: ta.crossover(fast, slow), longExit: ta.crossunder(fast, slow), stopLoss: 2, takeProfit: 4 })';
    const cond = (v: unknown, arg: string) => (v === undefined || v === null ? null : condOf(v, `strategy ${arg}`, EXAMPLE));
    const known = new Set(['entry', 'exit', 'side', 'long', 'longExit', 'short', 'shortExit', 'stopLoss', 'takeProfit', 'trailingStop', 'breakEven', 'exitAfter', 'entryPrice', 'entryBars', 'pyramiding', 'leverage', 'size', 'amount', 'qty', 'capital', 'fee', 'slippage', 'reverse']);
    const unknown = Object.keys(x).filter((k) => !known.has(k));
    if (unknown.length)
      throw err('BAD_ARG', `strategy에 모르는 이름이 있어요: ${unknown.join(', ')}.`, `strategy: unknown option ${unknown.join(', ')}.`, `쓸 수 있는 것: ${[...known].join(', ')}`, `Options: ${[...known].join(', ')}`);
    const legacy = x.entry !== undefined || x.exit !== undefined || x.side !== undefined;
    if (legacy && (x.long !== undefined || x.short !== undefined))
      throw err('BAD_ARG', 'strategy에서 entry/exit/side와 long/short를 함께 쓸 수 없어요.', "strategy: use either entry / exit / side or long / short, not both.", EXAMPLE);
    if (x.side !== undefined && x.side !== 'long' && x.side !== 'short') throw err('BAD_ARG', "strategy의 side는 'long' 또는 'short'예요.", "strategy: side must be 'long' or 'short'.");
    const short = x.side === 'short';
    const longEntry = legacy ? (short ? null : cond(x.entry, 'entry')) : cond(x.long, 'long');
    const longExit = legacy ? (short ? null : cond(x.exit, 'exit')) : cond(x.longExit, 'longExit');
    const shortEntry = legacy ? (short ? cond(x.entry, 'entry') : null) : cond(x.short, 'short');
    const shortExit = legacy ? (short ? cond(x.exit, 'exit') : null) : cond(x.shortExit, 'shortExit');
    if (!longEntry && !shortEntry) throw err('BAD_ARG', 'strategy에는 진입 조건(long 또는 short)이 필요해요.', 'strategy needs an entry condition (long or short).', EXAMPLE);
    if (legacy && x.exit === undefined) throw err('BAD_ARG', 'strategy의 entry에는 exit도 필요해요.', 'strategy: entry needs exit too.', EXAMPLE);
    /** A stop / target: a % from the entry, or a price per bar — for both sides, or { long, short } each its own. */
    const level = (v: unknown, arg: string): Levels | null => {
      if (v !== null && typeof v === 'object' && !isSeries(v) && !(v instanceof Uint8Array)) {
        const o = v as Record<string, unknown>;
        const extra = Object.keys(o).filter((k) => k !== 'long' && k !== 'short');
        if (extra.length || (o.long === undefined && o.short === undefined))
          throw err('BAD_ARG', `strategy의 ${arg}에 쪽별로 주려면 { long, short }로 써요.`, `strategy: for one ${arg} per side write { long, short }.`, `${arg}: { long: sub(close, mul(atr, 2)), short: add(close, mul(atr, 2)) }`);
        return { long: one(o.long, `${arg}.long`), short: one(o.short, `${arg}.short`) };
      }
      return one(v, arg);
    };
    const one = (v: unknown, arg: string): Level | null => {
      if (v === undefined || v === null) return null;
      if (typeof v === 'number') {
        if (!(v > 0 && v < 100)) throw err('BAD_ARG', `strategy의 ${arg}는 0보다 크고 100보다 작은 %예요. (받은 값: ${v})`, `strategy: ${arg} is a percent above 0 and below 100 (got ${v}).`);
        return { percent: v };
      }
      if (isSeries(v)) return { price: Float64Array.from(sameLength(v as ArrayLike<number>, `strategy ${arg}`)) };
      throw err('BAD_ARG', `strategy의 ${arg}에는 %(숫자), 봉마다 가격(시리즈), 또는 { long, short }가 필요해요.`, `strategy: ${arg} must be a percent (number), a price per bar (series) or { long, short }.`, 'stopLoss: 2  // 2%\nstopLoss: sub(low, ta.atr(14))  // a price per bar\nstopLoss: { long: sub(close, mul(atr, 2)), short: add(close, mul(atr, 2)) }  // each side its own');
    };
    const pct = (v: unknown, arg: string, fallback: number | null, max = 100): number | null => {
      if (v === undefined || v === null) return fallback;
      const p = Number(v);
      if (!(Number.isFinite(p) && p >= 0 && p <= max)) throw err('BAD_ARG', `strategy의 ${arg}는 0~${max} 사이 %예요.`, `strategy: ${arg} is a percent from 0 to ${max}.`);
      return p;
    };
    const trail = pct(x.trailingStop, 'trailingStop', null, 99);
    const size = pct(x.size, 'size', 100)!;
    if (size <= 0) throw err('BAD_ARG', 'strategy의 size는 0보다 큰 %(자산 중 한 번에 쓰는 몫)예요.', 'strategy: size is a percent of the account above 0.');
    const capital = x.capital === undefined ? 10_000 : Number(x.capital);
    if (!(Number.isFinite(capital) && capital > 0)) throw err('BAD_ARG', 'strategy의 capital은 0보다 큰 금액이에요.', 'strategy: capital must be an amount above 0.');
    const fee = pct(x.fee, 'fee', null, 10), slippage = pct(x.slippage, 'slippage', null, 10);
    if (x.reverse !== undefined && typeof x.reverse !== 'boolean') throw err('BAD_ARG', 'strategy의 reverse는 true 또는 false예요.', 'strategy: reverse must be true or false.');
    if (x.breakEven !== undefined && typeof x.breakEven !== 'boolean') throw err('BAD_ARG', 'strategy의 breakEven은 true 또는 false예요.', 'strategy: breakEven must be true or false.');
    /** A whole number in [min, max] (or the fallback when left out). */
    const whole = (v: unknown, arg: string, min: number, max: number, fallback: number | null): number | null => {
      if (v === undefined || v === null) return fallback;
      const k = Number(v);
      if (!(Number.isInteger(k) && k >= min && k <= max)) throw err('BAD_ARG', `strategy의 ${arg}는 ${min}~${max} 사이 정수예요. (받은 값: ${String(v)})`, `strategy: ${arg} is a whole number from ${min} to ${max} (got ${String(v)}).`);
      return k;
    };
    const STEPS_EXAMPLE = 'takeProfit: [{ at: 2, close: 50 }, { at: 5 }]  // half at +2%, the rest at +5%';
    /** takeProfit as targets in order: [{ at: % or price series, close: % of the position }]; the last without close takes the rest. */
    const stepList = (v: unknown, arg: string): Step[] => {
      if (!Array.isArray(v) || !v.length || v.length > STRATEGY_LIMITS.steps)
        throw err('BAD_ARG', `strategy의 ${arg}에는 목표를 1~${STRATEGY_LIMITS.steps}개 넣어요.`, `strategy: ${arg} takes 1–${STRATEGY_LIMITS.steps} targets.`, STEPS_EXAMPLE);
      let total = 0;
      const out = v.map((t, k) => {
        const o = (t ?? {}) as Record<string, unknown>;
        if (typeof t !== 'object' || Array.isArray(t) || isSeries(t) || Object.keys(o).some((key) => key !== 'at' && key !== 'close'))
          throw err('BAD_ARG', `strategy의 ${arg}[${k}]는 { at, close }예요.`, `strategy: ${arg}[${k}] is { at, close }.`, STEPS_EXAMPLE);
        const lv = one(o.at, `${arg}[${k}].at`);
        if (!lv) throw err('BAD_ARG', `strategy의 ${arg}[${k}].at이 필요해요 (진입가에서 % 또는 가격 시리즈).`, `strategy: ${arg}[${k}].at is needed (a % from the entry or a price series).`, STEPS_EXAMPLE);
        const last = k === v.length - 1;
        const part = o.close === undefined ? (last ? 100 - total : Number.NaN) : Number(o.close);
        if (!(part > 0 && part <= 100) || total + part > 100 + 1e-9)
          throw err('BAD_ARG', `strategy의 ${arg}[${k}].close는 포지션의 %예요 (합 100 이하, 마지막 것만 빼면 나머지 전부).`, `strategy: ${arg}[${k}].close is a % of the position (adding up to 100 at most; leave it out on the last one for the rest).`, STEPS_EXAMPLE);
        total += part;
        return { level: lv, part: last && o.close === undefined ? 1 : part / 100 };
      });
      return out;
    };
    /** takeProfit: one level (or { long, short }) → `take`; a list (or { long: list, short: list }) → `steps`. */
    const targets = (v: unknown): { take: Levels | null; steps: Steps | null } => {
      if (Array.isArray(v)) return { take: null, steps: stepList(v, 'takeProfit') };
      if (v && typeof v === 'object' && !isSeries(v) && (Array.isArray((v as { long?: unknown }).long) || Array.isArray((v as { short?: unknown }).short))) {
        const o = v as Record<string, unknown>;
        const extra = Object.keys(o).filter((k) => k !== 'long' && k !== 'short');
        if (extra.length) throw err('BAD_ARG', 'strategy의 takeProfit에 쪽별로 주려면 { long, short }로 써요.', 'strategy: for targets per side write { long, short }.', STEPS_EXAMPLE);
        const side = (w: unknown, arg: string) => (w === undefined || w === null ? null : Array.isArray(w) ? stepList(w, arg) : [{ level: one(w, arg)!, part: 1 }].filter((s) => s.level));
        return { take: null, steps: { long: side(o.long, 'takeProfit.long'), short: side(o.short, 'takeProfit.short') } };
      }
      return { take: level(v, 'takeProfit'), steps: null };
    };
    const { take, steps } = targets(x.takeProfit);
    if (x.breakEven === true && !steps) throw err('BAD_ARG', 'strategy의 breakEven은 takeProfit을 목표 여러 개로 줄 때 써요 (첫 목표 뒤 손절을 진입가로).', 'strategy: breakEven works with takeProfit as a list of targets (the stop moves to the entry after the first).', STEPS_EXAMPLE);
    /** entryPrice: a price series (or { long, short }) — the signal bar's value is the order's price. */
    const entryPrice = (() => {
      const v = x.entryPrice;
      if (v === undefined || v === null) return null;
      const priceOnly = (w: unknown, arg: string): Level | null => {
        if (w === undefined || w === null) return null;
        if (!isSeries(w)) throw err('BAD_ARG', `strategy의 ${arg}에는 봉마다 가격(시리즈)이 필요해요.`, `strategy: ${arg} must be a price per bar (a series).`, 'entryPrice: ta.lowest(low, 5)  // a limit below for longs');
        return { price: Float64Array.from(sameLength(w as ArrayLike<number>, `strategy ${arg}`)) };
      };
      if (typeof v === 'object' && !isSeries(v)) {
        const o = v as Record<string, unknown>;
        if (Object.keys(o).some((k) => k !== 'long' && k !== 'short')) throw err('BAD_ARG', 'strategy의 entryPrice에 쪽별로 주려면 { long, short }로 써요.', 'strategy: for an entry price per side write { long, short }.');
        return { long: priceOnly(o.long, 'entryPrice.long'), short: priceOnly(o.short, 'entryPrice.short') };
      }
      return priceOnly(v, 'entryPrice');
    })();
    const leverage = x.leverage === undefined ? 1 : Number(x.leverage);
    if (!(Number.isFinite(leverage) && leverage >= 1 && leverage <= STRATEGY_LIMITS.leverage)) throw err('BAD_ARG', `strategy의 leverage는 1~${STRATEGY_LIMITS.leverage}예요.`, `strategy: leverage runs from 1 to ${STRATEGY_LIMITS.leverage}.`);
    const money = (v: unknown, arg: string) => {
      if (v === undefined || v === null) return null;
      const m = Number(v);
      if (!(Number.isFinite(m) && m > 0)) throw err('BAD_ARG', `strategy의 ${arg}는 0보다 큰 숫자예요.`, `strategy: ${arg} must be a number above 0.`);
      return m;
    };
    const amount = money(x.amount, 'amount'), qty = money(x.qty, 'qty');
    if ([x.size, amount, qty].filter((v) => v !== undefined && v !== null).length > 1) throw err('BAD_ARG', 'strategy의 size · amount · qty는 하나만 써요.', 'strategy: use one of size, amount and qty.');
    strategy = {
      longEntry,
      longExit,
      shortEntry,
      shortExit,
      stop: level(x.stopLoss, 'stopLoss'),
      take,
      trail: trail || null,
      size: size / 100,
      capital,
      fee: fee === null ? null : fee / 100,
      slippage: slippage === null ? null : slippage / 100,
      reverse: x.reverse !== false,
      steps,
      breakEven: x.breakEven === true,
      exitAfter: whole(x.exitAfter, 'exitAfter', 1, STRATEGY_LIMITS.exitAfter, null),
      entryPrice,
      entryBars: whole(x.entryBars, 'entryBars', 1, STRATEGY_LIMITS.entryBars, 1)!,
      pyramiding: whole(x.pyramiding, 'pyramiding', 1, STRATEGY_LIMITS.pyramiding, 1)!,
      leverage,
      amount,
      qty,
    };
  }

  // ── alerts and the screener ──────────────────────────────────────
  function alert(c: unknown, message?: unknown) {
    declared('alert');
    if (alerts.length >= LIMITS.alerts) throw err('LIMIT', `alert는 ${LIMITS.alerts}개까지예요.`, `At most ${LIMITS.alerts} alerts.`);
    const when = condOf(c, 'alert', "alert(ta.crossover(fast, slow), '{name}: 골든크로스 {close}')");
    const m = message === undefined ? '{name}' : text(message, 'alert', 'message', 200);
    alerts.push({ message: m, when });
  }
  function screen(name: unknown, v: unknown) {
    declared('screen');
    const l = text(name, 'screen', 'name', 40);
    if (screens.some((x) => x.name === l)) throw err('BAD_ARG', `screen 이름 '${l}'이(가) 두 번 나와요.`, `screen '${l}' is used twice.`);
    if (screens.length >= LIMITS.screens) throw err('LIMIT', `screen은 ${LIMITS.screens}개까지예요.`, `At most ${LIMITS.screens} screen columns.`);
    let value: number;
    if (typeof v === 'number' || typeof v === 'boolean') value = Number(v);
    else if (isSeries(v) || v instanceof Uint8Array) {
      const a = sameLength(v as ArrayLike<number>, `screen '${l}'`);
      value = a.length ? Number(a[a.length - 1]) : Number.NaN;
    } else throw err('BAD_ARG', 'screen의 값에는 시리즈나 숫자가 필요해요.', 'screen: the value must be a series or a number.', "screen('RSI', ta.rsi(close, 14))");
    screens.push({ name: l, value: Number.isFinite(value) ? value : Number.NaN });
  }

  function log(...vs: unknown[]) {
    if (logs.length < LIMITS.logs) logs.push(vs.map((v) => (typeof v === 'object' && v !== null && !isSeries(v) ? JSON.stringify(v) : String(v))).join(' ').slice(0, 1000));
  }

  // ── no clock, no dice, no network ────────────────────────────────
  const forbidden = (what: string) => () => {
    throw err(
      'FORBIDDEN',
      `스크립트에서는 ${what}을(를) 쓸 수 없어요.`,
      `Scripts can’t use ${what}.`,
      '같은 차트면 항상 같은 결과가 나와야 해서 현재 시각·난수·네트워크는 막혀 있어요. 봉 시각은 time[i]를 쓰세요.',
      'The same chart must always give the same result, so the clock, randomness and the network are off. Use time[i] for a bar’s time.',
    );
  };
  const SafeDate = function (this: unknown, ...args: unknown[]) {
    if (!args.length) forbidden('new Date() (현재 시각)')();
    return new (Date as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  Object.assign(SafeDate, { now: forbidden('Date.now()'), UTC: Date.UTC, parse: Date.parse });
  const SafeMath = Object.create(Math, { random: { value: forbidden('Math.random()') } }) as Math;

  const color = colorApi(err);
  const scope: Record<string, unknown> = {
    open, high, low, close, volume, time, hl2, hlc3, ohlc4, hlcc4, turnover,
    bar, syminfo, timeframe, date,
    ta, ...calc, series: calc.map,
    input, indicator, ...drawing.api, color, strategy: strategyFn, log, alert, screen, request: requests.api,
    Date: SafeDate, Math: SafeMath,
    setTimeout: forbidden('setTimeout'), setInterval: forbidden('setInterval'), fetch: forbidden('fetch'),
    XMLHttpRequest: forbidden('XMLHttpRequest'), WebSocket: forbidden('WebSocket'), importScripts: forbidden('importScripts'),
    // A clock and dice by other names.
    performance: Object.freeze({ now: forbidden('performance.now()') }), crypto: Object.freeze({ getRandomValues: forbidden('crypto'), randomUUID: forbidden('crypto') }),
  };

  try {
    const names = Object.keys(scope);
    // The script runs in a block of its own: its names (`const line = …`) may shadow the built-in ones.
    const body = `"use strict";{\n${code}\n}`;
    // Always compiled here first: a syntax error is found the same way everywhere (syntaxLine).
    compiled = { fn: new Function(...names, `${body}\n//# sourceURL=${SOURCE_NAME}`) as Compiled['fn'], frame: SOURCE_FRAME, offset: 3 };
    if (options.compile)
      try {
        compiled = options.compile(names, body);
      } catch {
        // keep new Function's
      }
    compiled.fn(...names.map((k) => scope[k]));
    if (!meta) throw err('MISSING_DECLARATION', "indicator({ name, overlay })가 없어요.", 'indicator({ name, overlay }) is missing.', "둘째 줄에 indicator({ name: '이름', overlay: true }) 를 넣으세요.", "Put indicator({ name: 'My indicator', overlay: true }) on the second line.");
  } catch (e) {
    return fail(e);
  }
  const m = meta as Meta;
  const drawn = drawing.done();
  return { ok: true, version: 2, meta: m, ...drawn, alerts, screens, inputs, strategy, logs, warnings: warningsOf(m, drawn.plots, strategy, close, locale), requests: requests.specs };
}

/** Where in the script an error happened (the user's code frame in the stack). */
function positionOf(e: unknown, code: string | null, compiled: Compiled | null): { line: number; column: number } | null {
  if (e instanceof SyntaxError && code !== null) {
    const line = syntaxLine(code);
    return line ? { line, column: 0 } : null;
  }
  const stack = String((e as Error)?.stack ?? '');
  // `new Function` puts two header lines ("function anonymous(…" / ") {") and our "use strict" before line 1.
  const m = (compiled?.frame ?? SOURCE_FRAME).exec(stack);
  if (m) {
    const line = Number(m[1]) - (compiled?.offset ?? 3);
    if (line >= 1) return { line, column: Number(m[2]) };
  }
  return null;
}

/**
 * Engines don't say where a syntax error is in code given to `new Function`: compile the first k
 * lines for k = 1, 2, … — the first prefix that fails for a reason other than "not finished yet"
 * ends on the faulty line.
 */
function syntaxLine(code: string): number | null {
  const lines = code.split('\n');
  for (let k = 1; k <= lines.length; k++) {
    try {
      new Function(`"use strict";\n${lines.slice(0, k).join('\n')}`); // strict, as the run is
    } catch (e) {
      if (/end of input|unterminated|unexpected end|missing \} /i.test(String((e as Error).message))) continue;
      return k;
    }
  }
  return null;
}

function warningsOf(meta: Meta, plots: PlotOut[], strategy: Signals | null, close: Series, locale: Locale): Warning[] {
  const out: Warning[] = [];
  const w = (code: Warning['code'], ko: string, en: string) => out.push({ code, message: locale === 'ko' ? ko : en });
  const seen = new Set<string>();
  let lo = Infinity, hi = -Infinity;
  for (const v of close) if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  for (const p of plots) {
    if (seen.has(p.name)) w('DUPLICATE_PLOT', `plot 이름 '${p.name}'이(가) 두 번 나와요.`, `Plot name '${p.name}' is used twice.`);
    seen.add(p.name);
    let pl = Infinity, ph = -Infinity, any = false;
    for (const v of p.values) if (Number.isFinite(v)) (any = true), (pl = Math.min(pl, v)), (ph = Math.max(ph, v));
    if (!any) w('EMPTY_PLOT', `'${p.name}'에 값이 하나도 없어요. 기간이 봉 수보다 길거나 계산에서 NaN이 나왔을 수 있어요.`, `'${p.name}' has no values: the period may be longer than the bars, or the math gives NaN.`);
    else if (meta.overlay && Number.isFinite(lo) && (ph < lo * 0.5 || pl > hi * 2))
      w('OVERLAY_SCALE', `'${p.name}' 값(${round(pl)}~${round(ph)})이 가격(${round(lo)}~${round(hi)})과 크게 달라요. 아래 칸에 그리려면 overlay: false로 하세요.`, `'${p.name}' (${round(pl)}–${round(ph)}) is far from the price (${round(lo)}–${round(hi)}). For its own pane use overlay: false.`);
  }
  if (strategy) {
    const entries = entryCount(strategy);
    if (entries === 0) w('NO_SIGNALS', '전략의 entry 신호가 한 번도 없어요.', 'The strategy’s entry condition is never true.');
    else if (entries > close.length * 0.5) w('NO_SIGNALS', '전략의 entry 신호가 봉의 절반 넘게 켜져 있어요. 교차(crossover)처럼 한 번만 켜지는 조건인지 확인하세요.', 'The entry condition is true on more than half the bars; check it fires once (like crossover).');
  }
  return out;
}

const round = (v: number) => Number(v.toPrecision(4));

/** Buffers to hand back without copying (Worker postMessage). */
export function transferables(r: RunResult): ArrayBuffer[] {
  if (!r.ok) return [];
  const out = r.plots.map((p) => p.values.buffer as ArrayBuffer);
  if (r.strategy) out.push(...strategyBuffers(r.strategy));
  for (const p of r.plots) if (p.colors) out.push(p.colors.index.buffer as ArrayBuffer);
  for (const f of r.fills) if (f.colors) out.push(f.colors.index.buffer as ArrayBuffer);
  if (r.barColors) out.push(r.barColors.index.buffer as ArrayBuffer);
  for (const s of r.shapes) {
    out.push(s.when.buffer as ArrayBuffer);
    if (s.price) out.push(s.price.buffer as ArrayBuffer);
  }
  for (const b of r.backgrounds) out.push(b.colors.index.buffer as ArrayBuffer);
  for (const a of r.alerts) out.push(a.when.buffer as ArrayBuffer);
  return out;
}

export { Cond, Series };
