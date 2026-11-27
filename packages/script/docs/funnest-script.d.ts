// Funnest Script v2 — declarations for editors and AI tools. Generated from src/spec.ts.

/** One number per bar, oldest first (NaN = no value). Use sub/add/gt… or map, never + - > on it. */
interface Series extends Float64Array {}
/** True (1) / false (0) per bar. */
interface Cond extends Uint8Array {}
type Source = Series | Cond | number;
/** Where a condition is expected: a Cond, or a Series (non-zero = true). */
type Bool = Cond | Series;
type Color = string;
/** A color for each bar from its index (null: none there). */
type PerBarColor = (i: number) => Color | null | undefined;
type PlotStyle = 'line' | 'step' | 'area' | 'circles' | 'cross' | 'histogram' | 'columns';
type LineStyle = 'solid' | 'dotted' | 'dashed';
type Extend = 'none' | 'left' | 'right' | 'both';
type Size = 'tiny' | 'small' | 'normal' | 'large';
type Position = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'middle-center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
type Shape = 'triangleup' | 'triangledown' | 'arrowup' | 'arrowdown' | 'circle' | 'square' | 'diamond' | 'cross' | 'xcross' | 'flag';
/** Where a mark sits: over the bar's high, under its low, at a given price, or at the pane's top / bottom edge. */
type Place = 'above' | 'below' | 'price' | 'top' | 'bottom';
/** A period in the market's time zone: a day, a week (from Monday), a month, a year. */
type Period = 'D' | 'W' | 'M' | 'Y';
/** A bar length: minutes, or 1D / 1W / 1M. */
type Timeframe = '1' | '3' | '5' | '15' | '30' | '60' | '120' | '240' | '1D' | '1W' | '1M';
/** What compute's function gets: the requested bars (open, high, low, close, volume, time, bar.count) and ta / calc working on them. */
type RequestedBars = { open: Series; high: Series; low: Series; close: Series; volume: Series; time: Series; bar: { count: number }; ta: typeof ta; add: typeof add; sub: typeof sub; mul: typeof mul; div: typeof div; max: typeof max; min: typeof min; abs: typeof abs; avg: typeof avg; gt: typeof gt; lt: typeof lt; gte: typeof gte; lte: typeof lte; eq: typeof eq; and: typeof and; or: typeof or; not: typeof not; prev: typeof prev; last: typeof last; nz: typeof nz; fixnan: typeof fixnan; map: typeof map };
type DataName = 'funding' | 'openInterest' | 'longShortRatio' | 'topLongShortRatio' | 'kimchiPremium' | 'cvd' | 'fearGreed' | 'coinbasePremium' | 'dvol' | 'stablecoins';
/** Where an input is shown: a section (group), a shared row (inline), a note (tooltip). */
type InputOptions = { group?: string; inline?: string; tooltip?: string };
/** A partial target: at a % from the entry (or a price series), close this % of the position (left out on the last one: the rest). */
type Target = { at: number | Series; close?: number };

/** Name and place: overlay true draws on the candles, false in its own pane. Call once, first. range fixes the pane’s scale. timeframe is the interval the script is tuned for ('60' = 1 hour): apps pick it first and run the standard backtest on it. Other intervals still run, but trade more or less often and differently. */
declare function indicator(o: { name: string; overlay: boolean; precision?: number; range?: [number, number]; timeframe?: string }): void;

/** Open price per bar */
declare const open: Series;

/** High price per bar */
declare const high: Series;

/** Low price per bar */
declare const low: Series;

/** Close per bar (the current bar: the latest price) */
declare const close: Series;

/** Volume per bar */
declare const volume: Series;

/** Bar open time (UTC milliseconds) */
declare const time: Series;

/** (high + low) / 2 */
declare const hl2: Series;

/** (high + low + close) / 3 */
declare const hlc3: Series;

/** (open + high + low + close) / 4 */
declare const ohlc4: Series;

/** (high + low + 2 × close) / 4 */
declare const hlcc4: Series;

/** Value traded per bar (where the exchange gives it, else NaN) */
declare const turnover: Series;

/** The bars: count, index (0, 1, 2… as a series), last (the latest index), confirmed (the latest bar has closed; false while it is forming) */
declare const bar: { count: number; index: Series; last: number; confirmed: boolean };

/** The market: symbol 'BINANCEF:BTCUSDT', ticker 'BTCUSDT', exchange 'BINANCEF', market (spot, perp, stock…), currency 'USDT' / 'KRW', tick (the price step at the latest price; NaN when unknown), timezone (the market's: 'UTC' for crypto, 'Asia/Seoul' for Korean stocks). Unknown text is '' */
declare const syminfo: { symbol: string; ticker: string; exchange: string; name: string; market: 'spot' | 'perp' | 'stock' | 'index' | 'other' | 'unknown'; currency: string; base: string; tick: number; timezone: string };

/** The chart's interval: period ('60', '1D', '1W'…), minutes per bar, isIntraday (shorter than a day)… */
declare const timeframe: { period: string; minutes: number; seconds: number; isIntraday: boolean; isDaily: boolean; isWeekly: boolean; isMonthly: boolean };

/** a + b per bar */
declare function add(a: Source, b: Source): Series;

/** a − b per bar */
declare function sub(a: Source, b: Source): Series;

/** a × b per bar */
declare function mul(a: Source, b: Source): Series;

/** a ÷ b per bar (÷0 gives NaN) */
declare function div(a: Source, b: Source): Series;

/** Absolute value */
declare function abs(a: Source): Series;

/** Larger value per bar */
declare function max(a: Source, b: Source): Series;

/** Smaller value per bar */
declare function min(a: Source, b: Source): Series;

/** Average per bar */
declare function avg(...xs: Source[]): Series;

/** a > b */
declare function gt(a: Source, b: Source): Cond;

/** a < b */
declare function lt(a: Source, b: Source): Cond;

/** a ≥ b */
declare function gte(a: Source, b: Source): Cond;

/** a ≤ b */
declare function lte(a: Source, b: Source): Cond;

/** a = b */
declare function eq(a: Source, b: Source): Cond;

/** Both true */
declare function and(a: Bool, b: Bool): Cond;

/** Either true */
declare function or(a: Bool, b: Bool): Cond;

/** Negation */
declare function not(a: Bool): Cond;

/** The value bars bars ago (default 1) */
declare function prev(src: Source, bars?: number): Series;

/** The latest bar’s value */
declare function last(src: Source): number;

/** NaN replaced by value (default 0) */
declare function nz(src: Source, value?: number): Series;

/** NaN replaced by the previous value */
declare function fixnan(src: Source): Series;

/** Compute bar by bar, oldest first; outer variables keep state */
declare function map(fn: (i: number) => number | boolean): Series;

/** Draw a series; up to 40. style: line, step, area, circles, cross, histogram (bars from 0, rising / falling colors by default), columns. A function as color colors each bar: i => up[i] ? color.green : color.red. offset shifts it right by bars (negative: left) */
declare function plot(name: string, values: Source, o?: { color?: Color | PerBarColor; width?: number; style?: PlotStyle; lineStyle?: LineStyle; offset?: number }): void;

/** Horizontal reference line (name, color, style); up to 20 */
declare function hline(value: number, o?: { label?: string; color?: Color; style?: LineStyle; width?: number }): void;

/** Shade between two plots, by name, after them; up to 10. A color without alpha is shaded lightly. downColor: where the lower one is on top. A function as color colors each bar (null: not shaded) */
declare function fill(upper: string, lower: string, o?: { color?: Color | PerBarColor; downColor?: Color }): void;

/** Shade the background (a condition and a color, or a function giving each bar a color); up to 10. Colors without alpha are shaded lightly */
declare function bgcolor(when: Bool | PerBarColor, o?: { color?: Color }): void;

/** Recolor candles (indicators over the candles): a condition and a color, or a function giving each bar a color */
declare function barcolor(when: Bool | PerBarColor, o?: { color?: Color }): void;

/** A shape on every bar where the condition is true; up to 20. Up shapes sit under the bar, others over it */
declare function plotshape(when: Bool, o?: { shape?: Shape; location?: Place; price?: Source; color?: Color; textColor?: Color; text?: string; size?: Size }): void;

/** Text on the chart. bar: the index (-1 = the latest, bar.count + 3 = the empty space on the right). With price, at that price. style 'text' has no box; align 'right' starts at the point. The latest 500 stay */
declare function label(bar: number, text: string, o?: { location?: Place; price?: number; color?: Color; textColor?: Color; style?: 'box' | 'text'; align?: 'left' | 'center' | 'right'; size?: Size }): void;

/** A line between two points (bar index, price). extend 'right', 'left' or 'both' runs it to the edge. The latest 500 stay */
declare function line(x1: number, y1: number, x2: number, y2: number, o?: { color?: Color; width?: number; style?: LineStyle; extend?: Extend }): void;

/** A rectangle (bar indices, prices). color: the border, bg: the inside (lightly, without alpha). extend 'right' runs it to the edge. The latest 500 stay */
declare function box(left: number, top: number, right: number, bottom: number, o?: { color?: Color; bg?: Color; width?: number; style?: LineStyle; extend?: Extend; text?: string; textColor?: Color }): void;

/** A table in a corner of the chart (a dashboard). rows: a list of rows, each a list of cells. Up to 4, 60 rows × 10 cells */
declare function table(o: { position?: Position; rows: (string | number | null | { text: string; color?: Color; bg?: Color; align?: 'left' | 'center' | 'right' })[][]; bg?: Color; textColor?: Color; border?: Color; size?: Size }): void;

/** Colors; color.up / color.down follow the viewer’s rising / falling colors. '#RRGGBB' and '#RRGGBBAA' work too. color.alpha(c, 0.2) sets opacity 0 (invisible)–1; color.new(c, 80) is Pine’s transparency 0–100 */
declare const color: { up: Color; down: Color; red: Color; blue: Color; green: Color; orange: Color; yellow: Color; purple: Color; pink: Color; teal: Color; gray: Color; white: Color; black: Color; alpha(c: Color, opacity: number): Color; "new"(c: Color, transparency?: number): Color; rgb(r: number, g: number, b: number, opacity?: number): Color };

/** The backtest strategy (once). Signals fill at the next bar’s open. long / short: entry conditions; longExit / shortExit: exits (without them, only stops, targets and the other side’s entry close). stopLoss / takeProfit: % from the entry (a number) or a price per bar (a series; the bar before’s value is used); per side with { long, short } (a side left out has none). A list as takeProfit takes profit in parts: [{ at: 2, close: 50 }, { at: 5 }] is half at +2%, the rest at +5% (close is a % of the position; left out on the last one: the rest). breakEven: true moves the stop to the entry price from the bar after the first target. trailingStop: % back from the best price. exitAfter: close at the open N bars after the entry. entryPrice: an order at this price of the signal bar (for a long, below the close a limit, above it a breakout stop), waiting entryBars bars (default 1). pyramiding: most entries one way (default 1; one position at the average price; keep size under 100). leverage: futures leverage (default 1; liquidated when the margin is gone; fees on the leveraged value). size: % of the account per entry (default 100), or amount (money per entry, in capital’s units) or qty (quantity per entry). capital: starting money (default 10000). fee / slippage: % per fill (default: the viewer’s settings). A bar touching both stop and target takes the stop. reverse: an entry the other way turns the position (default true). The old { entry, exit, side } still works */
declare function strategy(o: { long?: Bool; longExit?: Bool; short?: Bool; shortExit?: Bool; stopLoss?: number | Series | { long?: number | Series; short?: number | Series }; takeProfit?: number | Series | Target[] | { long?: number | Series | Target[]; short?: number | Series | Target[] }; trailingStop?: number; breakEven?: boolean; exitAfter?: number; entryPrice?: Series | { long?: Series; short?: Series }; entryBars?: number; pyramiding?: number; leverage?: number; size?: number; amount?: number; qty?: number; capital?: number; fee?: number; slippage?: number; reverse?: boolean }): void;

/** An alert (up to 10). Rings when the condition is true on a bar that just closed (a forming bar is judged when it closes), for the market and timeframe the user turned 'Get alerts' on for, while the terminal is open. message may hold {name} {symbol} {close} {time} */
declare function alert(when: Bool, message?: string): void;

/** A screener column (up to 10): the value on the last bar. The screener runs the script on many markets and sorts and filters by it */
declare function screen(name: string, value: Series | Cond | number): void;

/** Print values for checking (up to 50 lines) */
declare function log(...values: unknown[]): void;

declare const request: {
  /** Bars of another timeframe or symbol, lined up with this chart’s bars. A bar is seen only once it has closed by the chart bar’s close (no look-ahead): on an hourly chart, the daily value changes after the day ends. To calculate on those bars use compute: d.compute((b) => b.ta.ema(b.close, 20)) is the daily 20 EMA. Up to 4 */
  bars(o: { symbol?: string; timeframe?: Timeframe }): { open: Series; high: Series; low: Series; close: Series; volume: Series; time: Series; compute<T extends Series | Record<string, Series>>(fn: (b: RequestedBars) => T): T };
  /** Market data lined up with this chart’s bars: funding (%), openInterest ($M), longShortRatio / topLongShortRatio, kimchiPremium (%), cvd, fearGreed (0–100), coinbasePremium (%), dvol, stablecoins ($B). Mostly for Binance futures symbols. Up to 8 */
  data(name: DataName, o?: { symbol?: string }): Series;
};

declare const date: {
  /** The hour (0–23) each bar opens at, in the market's zone (syminfo.timezone) unless one is given, e.g. date.hour('Asia/Seoul') */
  hour(tz?: string): Series;
  /** The minute (0–59) each bar opens at */
  minute(tz?: string): Series;
  /** Weekday: 0 Sunday … 6 Saturday (as in JavaScript, not Pine) */
  dayofweek(tz?: string): Series;
  /** Day of the month (1–31) */
  day(tz?: string): Series;
  /** Month (1–12) */
  month(tz?: string): Series;
  /** Year */
  year(tz?: string): Series;
  /** True on the first bar of each day ('D', default), week ('W', from Monday), month ('M') or year ('Y') */
  isNew(period?: Period, tz?: string): Cond;
  /** True on bars opening inside 'HHMM-HHMM' (an earlier end runs past midnight: '2200-0200') */
  session(spec: string, tz?: string): Cond;
};

declare const input: {
  /** A whole number the user can change (a period…) */
  int(label: string, def: number, o?: { min?: number; max?: number } & InputOptions): number;
  /** A number the user can change */
  number(label: string, def: number, o?: { min?: number; max?: number; step?: number } & InputOptions): number;
  /** An on/off switch */
  bool(label: string, def: boolean, o?: InputOptions): boolean;
  /** A choice from a list (of strings or numbers) */
  select<T extends string | number>(label: string, options: T[], def: T, o?: InputOptions): T;
  /** Which price to use (close, open…) */
  source(label: string, def?: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'hlcc4', o?: InputOptions): Series;
  /** Text the user types (e.g. a list like '1,3,6'); up to 200 characters */
  text(label: string, def?: string, o?: InputOptions): string;
  /** A color the user picks */
  color(label: string, def: Color, o?: InputOptions): Color;
  /** An interval the user picks (for request.bars); default '1D' */
  timeframe(label: string, def?: Timeframe, o?: InputOptions): Timeframe;
  /** A market the user picks ('BINANCEF:ETHUSDT', exchange:symbol), for request.bars / request.data */
  symbol(label: string, def: string, o?: InputOptions): string;
  /** A moment the user picks (UTC ms); the default is a number or a date like '2026-01-01T00:00:00Z'. For an anchored VWAP's start, … */
  time(label: string, def: number | string, o?: InputOptions): number;
};

declare const ta: {
  /** Simple moving average */
  sma(src: Source, length: number): Series;
  /** Exponential moving average (seeded with the SMA) */
  ema(src: Source, length: number): Series;
  /** Wilder’s moving average (used by RSI, ATR) */
  rma(src: Source, length: number): Series;
  /** Weighted moving average */
  wma(src: Source, length: number): Series;
  /** Volume-weighted moving average */
  vwma(src: Source, length: number): Series;
  /** Hull moving average */
  hma(src: Source, length: number): Series;
  /** Double EMA (2·EMA − EMA of the EMA) */
  dema(src: Source, length: number): Series;
  /** Triple EMA */
  tema(src: Source, length: number): Series;
  /** Least-squares regression value (LSMA); offset reads that many bars back */
  linreg(src: Source, length: number, offset?: number): Series;
  /** Arnaud Legoux moving average (default offset 0.85, sigma 6) */
  alma(src: Source, length: number, offset?: number, sigma?: number): Series;
  /** Symmetrically weighted average of the last 4 values (1/6, 2/6, 2/6, 1/6) */
  swma(src: Source): Series;
  /** Volume-weighted average price, starting over at each anchor: 'D' (day, default), 'W', 'M', 'Y' in the market's time zone (crypto UTC, Korean stocks Seoul), or a condition (from the bars where it is true). src defaults to hlc3 */
  vwap(src?: Source, anchor?: Period | Bool): Series;
  /** VWAP with bands at ± mult × the volume-weighted standard deviation (default 1) */
  vwapbands(src?: Source, anchor?: Period | Bool, mult?: number): { vwap: Series; upper: Series; lower: Series };
  /** Relative strength index (0–100, default 14) */
  rsi(src: Source, length?: number): Series;
  /** Stochastic %K and %D (default 14, 3, 3) */
  stoch(length?: number, smoothK?: number, smoothD?: number): { k: Series; d: Series };
  /** MACD (default 12, 26, 9) */
  macd(src: Source, fast?: number, slow?: number, signal?: number): { macd: Series; signal: Series; hist: Series };
  /** Commodity channel index (default 20) */
  cci(src: Source, length?: number): Series;
  /** Money flow index (0–100, from hlc3 and volume) */
  mfi(length?: number): Series;
  /** Rate of change vs length bars ago (%) */
  roc(src: Source, length: number): Series;
  /** Momentum: change vs length bars ago */
  mom(src: Source, length?: number): Series;
  /** Williams %R (−100 to 0, default 14) */
  wpr(length?: number): Series;
  /** Chande momentum oscillator (−100 to 100, default 9) */
  cmo(src: Source, length?: number): Series;
  /** True strength index, −1 to 1 as in Pine (× 100 for the usual display); default 13, 25 */
  tsi(src: Source, short?: number, long?: number): Series;
  /** Center of gravity (default 10) */
  cog(src: Source, length?: number): Series;
  /** Rank correlation index (−100 to 100, default 9); 100 = each value higher than the one before */
  rci(src: Source, length?: number): Series;
  /** Average true range (default 14) */
  atr(length?: number): Series;
  /** True range */
  tr(): Series;
  /** Bollinger Bands (default 20, 2); width = (upper − lower) / mid */
  bb(src: Source, length?: number, mult?: number): { upper: Series; mid: Series; lower: Series; width: Series };
  /** Standard deviation */
  stdev(src: Source, length: number): Series;
  /** Bollinger band width: (upper − lower) / mid */
  bbw(src: Source, length?: number, mult?: number): Series;
  /** Keltner channels: EMA ± mult × the EMA of the true range (default 20, 2); useTrueRange false uses high − low */
  kc(src: Source, length?: number, mult?: number, useTrueRange?: boolean): { upper: Series; mid: Series; lower: Series };
  /** Keltner channel width: (upper − lower) / mid */
  kcw(src: Source, length?: number, mult?: number, useTrueRange?: boolean): Series;
  /** Parabolic SAR (default 0.02, 0.02, 0.2); below the price = uptrend */
  sar(start?: number, inc?: number, max?: number): Series;
  /** Ichimoku conversion, base, span A and B (default 9, 26, 52), not shifted: plot the spans with offset: 25 (base − 1) and the lagging line as close with offset: -25 */
  ichimoku(conversion?: number, base?: number, spanB?: number): { conversion: Series; base: Series; spanA: Series; spanB: Series };
  /** Pivot points from the previous period's (anchor, default 'D') high, low and close, the same all through the current period; NaN in the first one */
  pivots(type?: 'traditional' | 'fibonacci' | 'woodie' | 'classic' | 'camarilla', anchor?: Period | Bool): { p: Series; r1: Series; r2: Series; r3: Series; s1: Series; s2: Series; s3: Series };
  /** Directional movement: +DI, −DI and ADX */
  dmi(length?: number, adxSmoothing?: number): { plus: Series; minus: Series; adx: Series };
  /** ADX (trend strength) */
  adx(length?: number, smoothing?: number): Series;
  /** SuperTrend (default 3, 10); dir 1 = up, −1 = down */
  supertrend(factor?: number, atrLength?: number): { line: Series; dir: Series };
  /** Highest value of the last length bars */
  highest(src: Source, length: number): Series;
  /** Lowest value of the last length bars */
  lowest(src: Source, length: number): Series;
  /** How many bars back the highest of the last length values is (0 = this bar, the latest on a tie); positive, unlike Pine */
  highestbars(src: Source, length: number): Series;
  /** How many bars back the lowest of the last length values is (positive) */
  lowestbars(src: Source, length: number): Series;
  /** Highest value so far (all bars up to this one) */
  max(src: Source): Series;
  /** Lowest value so far */
  min(src: Source): Series;
  /** Change vs length bars ago (default 1) */
  change(src: Source, length?: number): Series;
  /** Running total (NaN counts as 0) */
  cum(src: Source): Series;
  /** On-balance volume */
  obv(): Series;
  /** Accumulation / distribution */
  accdist(): Series;
  /** Price-volume trend */
  pvt(): Series;
  /** Negative volume index (moves only on bars where volume fell; starts at 1) */
  nvi(): Series;
  /** Positive volume index (moves only on bars where volume rose; starts at 1) */
  pvi(): Series;
  /** Williams accumulation / distribution */
  wad(): Series;
  /** Williams variable accumulation / distribution (per bar) */
  wvad(): Series;
  /** Intraday intensity index (per bar) */
  iii(): Series;
  /** Median of the last length values */
  median(src: Source, length: number): Series;
  /** Most frequent of the last length values (the smallest on a tie) */
  mode(src: Source, length: number): Series;
  /** The value at percent (0–100) of the last length values, interpolated */
  percentile(src: Source, length: number, percent: number): Series;
  /** % of the previous length values at or below this one */
  percentrank(src: Source, length: number): Series;
  /** Highest − lowest of the last length values */
  range(src: Source, length: number): Series;
  /** Mean absolute deviation */
  dev(src: Source, length: number): Series;
  /** Variance (stdev squared) */
  variance(src: Source, length: number): Series;
  /** Correlation of a and b over the last length bars (−1 to 1) */
  correlation(a: Source, b: Source, length: number): Series;
  /** True on the bar where a crosses above b */
  crossover(a: Source, b: Source): Cond;
  /** True on the bar where a crosses below b */
  crossunder(a: Source, b: Source): Cond;
  /** True on a cross either way */
  cross(a: Source, b: Source): Cond;
  /** Higher than each of the previous length values */
  rising(src: Source, length: number): Cond;
  /** Lower than each of the previous length values */
  falling(src: Source, length: number): Cond;
  /** Pivot high (above both sides): its value on the bar right bars later that confirms it, else NaN */
  pivothigh(src: Source, left: number, right: number): Series;
  /** Pivot low, like pivothigh */
  pivotlow(src: Source, left: number, right: number): Series;
  /** Bars since the condition was last true */
  barssince(cond: Bool): Series;
  /** src on the bar where cond was true (0 = most recent) */
  valuewhen(cond: Bool, src: Source, occurrence?: number): Series;
};
