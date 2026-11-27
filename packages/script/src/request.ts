import { createLib, type LibContext } from './lib';
import { isSeries, Series, type ScriptError } from './series';

/**
 * Data a script asks for beyond its chart's bars: another timeframe or symbol (`request.bars`)
 * and market data (`request.data`: funding, open interest…). Scripts can't fetch, so a run goes
 * in two passes: the first records what's asked for (and gets NaN), the host fetches it, the
 * second runs with it. The host passes what it fetched as `RequestData`; lining it up with the
 * chart's bars happens here, the same way everywhere.
 *
 * No look-ahead: a chart bar sees a requested bar only once that bar has closed — by the chart
 * bar's own close. A daily bar shows up on intraday bars after the day ends, never during it.
 */

export const REQUEST_TIMEFRAMES = ['1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'] as const;
export type RequestTimeframe = (typeof REQUEST_TIMEFRAMES)[number];

/** Market data by name: what it is and in what unit (as the chart's own indicators show it). */
export const DATA_SOURCES = {
  funding: { ko: '펀딩비 (%, 바이낸스 선물)', en: 'Funding rate (%, Binance futures)' },
  openInterest: { ko: '미결제약정 금액 (백만 달러, 바이낸스 선물)', en: 'Open interest ($ millions, Binance futures)' },
  longShortRatio: { ko: '롱/숏 계정 비율 (바이낸스 선물 전체 계정)', en: 'Long/short account ratio (Binance futures, all accounts)' },
  topLongShortRatio: { ko: '롱/숏 비율 (바이낸스 선물 상위 트레이더)', en: 'Long/short ratio (Binance futures top traders)' },
  kimchiPremium: { ko: '김치 프리미엄 (%, 달러 환율 기준)', en: 'Kimchi premium (%, against the dollar rate)' },
  cvd: { ko: 'CVD (누적 체결 강도)', en: 'CVD (cumulative volume delta)' },
  fearGreed: { ko: '공포 · 탐욕 지수 (0~100, 하루 단위)', en: 'Fear & greed index (0–100, daily)' },
  coinbasePremium: { ko: '코인베이스 프리미엄 (%)', en: 'Coinbase premium (%)' },
  dvol: { ko: 'DVOL (비트코인 · 이더리움 내재 변동성)', en: 'DVOL (BTC / ETH implied volatility)' },
  stablecoins: { ko: '스테이블코인 시가총액 (십억 달러)', en: 'Stablecoin market cap (billions of dollars)' },
} as const;
export type DataName = keyof typeof DATA_SOURCES;
export const DATA_NAMES = Object.keys(DATA_SOURCES) as DataName[];

export const REQUEST_LIMITS = { bars: 4, data: 8 } as const;

/** Bars the host fetched for a request: oldest first, and how long one bar lasts. */
export interface RequestedBars {
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  resolutionMs: number;
}
/** What the host fetched, by request key: bars, or a market-data series already lined up with the chart's bars. */
export interface RequestData {
  bars?: Record<string, RequestedBars | null>;
  data?: Record<string, Float64Array | null>;
}
export interface RequestSpec {
  key: string;
  kind: 'bars' | 'data';
  /** null: the chart's own. */
  symbol: string | null;
  timeframe: RequestTimeframe | null;
  name: DataName | null;
  /** Not in the data given to this run (a first pass, or the host couldn't get it). */
  missing: boolean;
}

/** A market as scripts name one: 'BINANCEF:BTCUSDT', 'UPBIT:KRW-BTC', 'KRX:005930'. */
export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9_]{0,19}:[A-Za-z0-9._\-/]{1,40}$/;
const SYMBOL = SYMBOL_PATTERN;
export const barsKey = (symbol: string | null, tf: RequestTimeframe | null) => `bars|${symbol ?? ''}|${tf ?? ''}`;
export const dataKey = (name: DataName, symbol: string | null) => `data|${name}|${symbol ?? ''}`;

/** Bar spacing of the chart (the median gap), as the closing time of a bar is its open + this. */
export function spacingOf(time: ArrayLike<number>): number {
  const gaps: number[] = [];
  for (let i = Math.max(1, time.length - 50); i < time.length; i++) gaps.push(time[i]! - time[i - 1]!);
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 60_000;
}

/**
 * The requested bars on the chart's bars: chart bar i gets the latest requested bar that had
 * closed by bar i's close (a requested bar closes at its open + its length, or when the next one
 * opens if that's sooner — months and gaps).
 */
export function alignBars(chartTime: ArrayLike<number>, chartSpacing: number, src: RequestedBars): Record<'open' | 'high' | 'low' | 'close' | 'volume' | 'time', Series> {
  const idx = alignIndex(chartTime, chartSpacing, src);
  const pick = (values: ArrayLike<number>) => Series.from(idx, (j) => (j < 0 ? Number.NaN : values[j]!)) as Series;
  return { open: pick(src.open), high: pick(src.high), low: pick(src.low), close: pick(src.close), volume: pick(src.volume), time: pick(src.time) };
}

/** For each chart bar, the requested bar it sees (-1: none closed yet). */
export function alignIndex(chartTime: ArrayLike<number>, chartSpacing: number, src: RequestedBars): Int32Array {
  const n = chartTime.length, m = src.time.length;
  const out = new Int32Array(n).fill(-1);
  const closeOf = (j: number) => Math.min(src.time[j]! + src.resolutionMs, j + 1 < m ? src.time[j + 1]! : Infinity);
  let j = -1;
  for (let i = 0; i < n; i++) {
    const at = chartTime[i]! + chartSpacing;
    while (j + 1 < m && closeOf(j + 1) <= at) j++;
    out[i] = j;
  }
  return out;
}

/** What `compute` hands its function: the requested bars and the calculators, bound to them. */
export type RequestedLib = ReturnType<typeof createLib>['calc'] & { ta: ReturnType<typeof createLib>['ta'] } & Record<'open' | 'high' | 'low' | 'close' | 'volume' | 'time', Series> & { bar: { count: number } };

type Err = (code: 'BAD_ARG' | 'LIMIT', ko: string, en: string, hintKo?: string, hintEn?: string) => ScriptError;

export function createRequests(n: number, time: ArrayLike<number>, given: RequestData | undefined, err: Err, spacing?: number, libContext: LibContext = {}) {
  const specs: RequestSpec[] = [];
  const chartSpacing = spacing ?? spacingOf(time);
  const nan = () => new Series(n).fill(Number.NaN);
  const symbolOf = (v: unknown, fn: string): string | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !SYMBOL.test(v))
      throw err('BAD_ARG', `${fn}의 symbol은 'BINANCEF:BTCUSDT', 'UPBIT:KRW-BTC'처럼 써요.`, `${fn}: symbol looks like 'BINANCEF:BTCUSDT' or 'UPBIT:KRW-BTC'.`);
    return v;
  };
  const note = (spec: Omit<RequestSpec, 'missing'>, has: boolean) => {
    if (!specs.some((s) => s.key === spec.key)) specs.push({ ...spec, missing: !has });
  };

  function bars(o: { symbol?: unknown; timeframe?: unknown } = {}) {
    const symbol = symbolOf(o?.symbol, 'request.bars');
    const tf = o?.timeframe === undefined ? null : (o.timeframe as RequestTimeframe);
    if (tf !== null && !(REQUEST_TIMEFRAMES as readonly unknown[]).includes(tf))
      throw err('BAD_ARG', `request.bars의 timeframe은 ${REQUEST_TIMEFRAMES.join(', ')} 중 하나예요. (받은 값: ${String(o?.timeframe)})`, `request.bars: timeframe must be one of ${REQUEST_TIMEFRAMES.join(', ')} (got ${String(o?.timeframe)}).`, "request.bars({ timeframe: '1D' })");
    if (symbol === null && tf === null) throw err('BAD_ARG', 'request.bars에는 symbol이나 timeframe이 필요해요. 차트 봉은 close · high 등으로 바로 쓰세요.', 'request.bars needs a symbol or a timeframe; the chart’s own bars are close, high…', "request.bars({ timeframe: '1D' })");
    const key = barsKey(symbol, tf);
    if (!specs.some((s) => s.key === key) && specs.filter((s) => s.kind === 'bars').length >= REQUEST_LIMITS.bars)
      throw err('LIMIT', `request.bars는 서로 다른 ${REQUEST_LIMITS.bars}가지까지예요.`, `At most ${REQUEST_LIMITS.bars} different request.bars.`);
    const src = given?.bars?.[key];
    note({ key, kind: 'bars', symbol, timeframe: tf, name: null }, !!src);
    /**
     * `compute(b => …)`: work out something on the requested bars themselves (a daily EMA on the
     * daily bars), then line the result up with the chart like the bars.
     */
    const compute = (fn: unknown) => {
      if (typeof fn !== 'function')
        throw err('BAD_ARG', 'compute에는 함수가 필요해요. 예: d.compute((b) => b.ta.ema(b.close, 20))', 'compute needs a function, e.g. d.compute((b) => b.ta.ema(b.close, 20)).');
      if (!src) return nan();
      const lib = createLib({ open: src.open, high: src.high, low: src.low, close: src.close, volume: src.volume, time: src.time }, libContext);
      const own = (a: Float64Array) => Series.from(a) as Series;
      const b: RequestedLib = { ...lib.calc, ta: lib.ta, open: own(src.open), high: own(src.high), low: own(src.low), close: own(src.close), volume: own(src.volume), time: own(src.time), bar: { count: lib.n } };
      const result = (fn as (b: RequestedLib) => unknown)(b);
      const idx = alignIndex(time, chartSpacing, src);
      const line = (v: unknown, what: string) => {
        if (!isSeries(v) || (v as ArrayLike<number>).length !== src.time.length)
          throw err('BAD_ARG', `compute의 함수는 요청한 봉 길이의 시리즈를 돌려줘야 해요${what}.`, `compute's function must return a series over the requested bars${what}.`, 'd.compute((b) => b.ta.ema(b.close, 20))');
        const values = v as ArrayLike<number>;
        return Series.from(idx, (j) => (j < 0 ? Number.NaN : Number(values[j]))) as Series;
      };
      if (isSeries(result)) return line(result, '');
      if (result && typeof result === 'object') return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, line(v, ` (${k})`)]));
      return line(result, '');
    };
    if (!src) return { open: nan(), high: nan(), low: nan(), close: nan(), volume: nan(), time: nan(), compute };
    return { ...alignBars(time, chartSpacing, src), compute };
  }

  function data(name: unknown, o: { symbol?: unknown } = {}) {
    if (!(DATA_NAMES as unknown[]).includes(name))
      throw err('BAD_ARG', `request.data의 이름은 ${DATA_NAMES.join(', ')} 중 하나예요. (받은 값: ${String(name)})`, `request.data: the name must be one of ${DATA_NAMES.join(', ')} (got ${String(name)}).`, "request.data('funding')");
    const symbol = symbolOf(o?.symbol, 'request.data');
    const key = dataKey(name as DataName, symbol);
    if (!specs.some((s) => s.key === key) && specs.filter((s) => s.kind === 'data').length >= REQUEST_LIMITS.data)
      throw err('LIMIT', `request.data는 서로 다른 ${REQUEST_LIMITS.data}가지까지예요.`, `At most ${REQUEST_LIMITS.data} different request.data.`);
    const src = given?.data?.[key];
    note({ key, kind: 'data', symbol, timeframe: null, name: name as DataName }, !!src);
    if (!src || src.length !== n) return nan();
    return Series.from(src) as Series;
  }

  return { api: { bars, data }, specs };
}
