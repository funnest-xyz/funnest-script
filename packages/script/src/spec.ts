/**
 * The one description of Funnest Script v2: every name a script can use, with its TypeScript
 * signature, what it does (Korean and English) and an example. scripts/build-docs.mjs turns it into
 * llms.txt (for AI assistants), funnest-script.d.ts and reference.json; the app's editor shows it.
 * A name here that the runtime lacks (or the other way round) fails test/spec.test.ts.
 */

export interface SpecItem {
  /** As written in code: `ta.ema`, `plot`, `close`. */
  name: string;
  /** TypeScript declaration (without `declare`). */
  ts: string;
  ko: string;
  en: string;
  example?: string;
}
export interface SpecGroup {
  id: string;
  ko: string;
  en: string;
  items: SpecItem[];
}

export const RULES: { ko: string; en: string }[] = [
  { ko: '첫 줄은 //@version=2, 그다음 indicator({ name, overlay })를 한 번 불러요.', en: 'Line 1 is //@version=2, then call indicator({ name, overlay }) once.' },
  { ko: '시리즈는 봉마다 값이 하나씩 있는 배열이에요. 0번이 가장 오래된 봉, 마지막이 지금 봉이에요.', en: 'A Series is an array with one value per bar: index 0 is the oldest bar, the last index the current one.' },
  { ko: '시리즈끼리 + - * / > < 를 쓰면 오류예요. sub, add, mul, div, gt, lt 같은 함수나 map(i => …)를 쓰세요.', en: 'Never use + - * / > < on whole series: use sub, add, mul, div, gt, lt… or map(i => …).' },
  { ko: '조건(crossover, gt 등의 결과)도 시리즈예요. if (조건) 처럼 쓰지 말고 strategy·plotshape·map 안에서 쓰세요.', en: 'Conditions (from crossover, gt, …) are series too: never write if (cond); pass them to strategy, or read cond[i] inside map.' },
  { ko: 'map(i => …)은 오래된 봉부터 차례로 불려요. 바깥 변수로 봉 사이의 상태를 들고 갈 수 있어요.', en: 'map(i => …) runs oldest bar first; variables outside it carry state from bar to bar.' },
  { ko: '값이 없는 봉은 NaN이에요(기간보다 앞쪽 봉 등). nz()로 0으로 바꿀 수 있어요.', en: 'Bars without a value are NaN (e.g. before a period has filled); nz() turns them into 0.' },
  { ko: '현재 시각(Date.now, new Date()), 난수(Math.random), 네트워크는 쓸 수 없어요. 봉 시각은 time[i]예요.', en: 'No clock (Date.now, new Date()), no randomness (Math.random), no network. A bar’s time is time[i] (ms, UTC).' },
  { ko: '다음 봉 데이터를 미리 보는 계산(i + 1)은 하지 마세요. 실제로는 알 수 없는 값이에요.', en: 'Never look ahead (i + 1): that value isn’t known on the bar.' },
  { ko: '다른 시간봉 · 종목 · 시장 데이터는 request.bars · request.data로 받아요. 처음 받는 동안은 NaN이에요.', en: 'Other timeframes, symbols and market data come from request.bars / request.data; they are NaN until they arrive.' },
  { ko: '코드만 쓰세요. import, export, async/await는 없어요.', en: 'Plain code only: no import, export or async/await.' },
];

export const MISTAKES: { wrong: string; right: string; ko: string; en: string }[] = [
  { wrong: 'const body = close - open', right: 'const body = sub(close, open)', ko: '시리즈끼리 바로 계산', en: 'arithmetic on whole series' },
  { wrong: 'if (ta.crossover(fast, slow)) …', right: 'strategy({ long: ta.crossover(fast, slow), longExit: ta.crossunder(fast, slow) })', ko: '조건을 if에 넣기', en: 'a condition inside if' },
  { wrong: 'const up = close > open', right: 'const up = gt(close, open)', ko: '시리즈 비교', en: 'comparing whole series' },
  { wrong: 'close[close.length]', right: 'last(close)  // or close[close.length - 1]', ko: '마지막 봉 인덱스', en: 'the last bar’s index' },
  { wrong: "plot('RSI', ta.rsi(close, 14))  // with overlay: true", right: "indicator({ name: 'RSI', overlay: false, range: [0, 100] })", ko: '0~100 지표를 캔들 위에 그리기', en: 'drawing a 0–100 oscillator over the candles' },
];

const N = 'number';
const S = 'Series';
const SRC = 'Source';

export const GROUPS: SpecGroup[] = [
  {
    id: 'declare',
    ko: '선언',
    en: 'Declaration',
    items: [
      {
        name: 'indicator',
        ts: 'function indicator(o: { name: string; overlay: boolean; precision?: number; range?: [number, number]; timeframe?: string }): void',
        ko: "지표 이름과 그릴 곳(overlay: true면 캔들 위, false면 아래 칸). 코드 맨 앞에서 한 번만. range는 아래 칸 세로 범위 고정. timeframe은 이 스크립트가 맞춰진 주기('60' = 1시간)로, 앱이 그 주기를 먼저 고르고 표준 백테스트도 그 주기로 돌려요. 다른 주기에서도 돌지만 사고파는 횟수와 결과가 달라져요",
        en: "Name and place: overlay true draws on the candles, false in its own pane. Call once, first. range fixes the pane’s scale. timeframe is the interval the script is tuned for ('60' = 1 hour): apps pick it first and run the standard backtest on it. Other intervals still run, but trade more or less often and differently.",
        example: "indicator({ name: 'RSI', overlay: false, range: [0, 100] })",
      },
    ],
  },
  {
    id: 'data',
    ko: '데이터',
    en: 'Data',
    items: [
      { name: 'open', ts: `const open: ${S}`, ko: '시가', en: 'Open price per bar' },
      { name: 'high', ts: `const high: ${S}`, ko: '고가', en: 'High price per bar' },
      { name: 'low', ts: `const low: ${S}`, ko: '저가', en: 'Low price per bar' },
      { name: 'close', ts: `const close: ${S}`, ko: '종가 (지금 봉은 현재가)', en: 'Close per bar (the current bar: the latest price)' },
      { name: 'volume', ts: `const volume: ${S}`, ko: '거래량', en: 'Volume per bar' },
      { name: 'time', ts: `const time: ${S}`, ko: '봉 시작 시각 (UTC 밀리초)', en: 'Bar open time (UTC milliseconds)' },
      { name: 'hl2', ts: `const hl2: ${S}`, ko: '(고가 + 저가) / 2', en: '(high + low) / 2' },
      { name: 'hlc3', ts: `const hlc3: ${S}`, ko: '(고가 + 저가 + 종가) / 3', en: '(high + low + close) / 3' },
      { name: 'ohlc4', ts: `const ohlc4: ${S}`, ko: '(시가 + 고가 + 저가 + 종가) / 4', en: '(open + high + low + close) / 4' },
      { name: 'hlcc4', ts: `const hlcc4: ${S}`, ko: '(고가 + 저가 + 종가 × 2) / 4', en: '(high + low + 2 × close) / 4' },
      { name: 'turnover', ts: `const turnover: ${S}`, ko: '거래대금 (주는 거래소만, 없으면 NaN)', en: 'Value traded per bar (where the exchange gives it, else NaN)' },
      {
        name: 'request.bars',
        ts: `bars(o: { symbol?: string; timeframe?: Timeframe }): { open: ${S}; high: ${S}; low: ${S}; close: ${S}; volume: ${S}; time: ${S}; compute<T extends ${S} | Record<string, ${S}>>(fn: (b: RequestedBars) => T): T }`,
        ko: "다른 시간봉(timeframe)이나 다른 종목(symbol)의 봉, 이 차트의 봉에 맞춰서. 차트 봉이 끝날 때까지 끝난 봉의 값만 써요(미래 안 봄): 1시간봉 차트에서 일봉은 그날이 끝난 뒤에 바뀌어요. 그 봉 위에서 계산하려면 compute: d.compute((b) => b.ta.ema(b.close, 20))는 일봉 20 EMA. 최대 4가지",
        en: 'Bars of another timeframe or symbol, lined up with this chart’s bars. A bar is seen only once it has closed by the chart bar’s close (no look-ahead): on an hourly chart, the daily value changes after the day ends. To calculate on those bars use compute: d.compute((b) => b.ta.ema(b.close, 20)) is the daily 20 EMA. Up to 4',
        example: "const d = request.bars({ timeframe: '1D' })",
      },
      {
        name: 'request.data',
        ts: `data(name: DataName, o?: { symbol?: string }): ${S}`,
        ko: "시장 데이터를 이 차트의 봉에 맞춰서: funding(펀딩비 %), openInterest(미결제약정 백만 달러), longShortRatio · topLongShortRatio(롱/숏 비율), kimchiPremium(김프 %), cvd, fearGreed(공포·탐욕 0~100), coinbasePremium(%), dvol, stablecoins(십억 달러). 대부분 바이낸스 선물 종목 기준. 최대 8가지",
        en: 'Market data lined up with this chart’s bars: funding (%), openInterest ($M), longShortRatio / topLongShortRatio, kimchiPremium (%), cvd, fearGreed (0–100), coinbasePremium (%), dvol, stablecoins ($B). Mostly for Binance futures symbols. Up to 8',
        example: "const f = request.data('funding')",
      },
    ],
  },
  {
    id: 'market',
    ko: '종목 · 주기 · 시간',
    en: 'Market · interval · time',
    items: [
      { name: 'bar', ts: `const bar: { count: number; index: ${S}; last: number; confirmed: boolean }`, ko: '봉 정보. count 봉 수, index 봉 번호(0부터, 시리즈), last 마지막 봉 번호, confirmed 마지막 봉이 끝났는지(진행 중이면 false)', en: 'The bars: count, index (0, 1, 2… as a series), last (the latest index), confirmed (the latest bar has closed; false while it is forming)', example: 'map((i) => (i === bar.last && !bar.confirmed ? NaN : close[i]))' },
      { name: 'syminfo', ts: "const syminfo: { symbol: string; ticker: string; exchange: string; name: string; market: 'spot' | 'perp' | 'stock' | 'index' | 'other' | 'unknown'; currency: string; base: string; tick: number; timezone: string }", ko: "종목 정보. symbol 'BINANCEF:BTCUSDT', ticker 'BTCUSDT', exchange 'BINANCEF', market 현물·선물(perp)·주식, currency 'USDT'·'KRW', tick 지금 가격의 호가 단위(모르면 NaN), timezone 거래소 시간대(코인 'UTC', 국내주식 'Asia/Seoul'). 모르면 빈 글자", en: "The market: symbol 'BINANCEF:BTCUSDT', ticker 'BTCUSDT', exchange 'BINANCEF', market (spot, perp, stock…), currency 'USDT' / 'KRW', tick (the price step at the latest price; NaN when unknown), timezone (the market's: 'UTC' for crypto, 'Asia/Seoul' for Korean stocks). Unknown text is ''", example: "const step = Number.isNaN(syminfo.tick) ? 0.01 : syminfo.tick" },
      { name: 'timeframe', ts: 'const timeframe: { period: string; minutes: number; seconds: number; isIntraday: boolean; isDaily: boolean; isWeekly: boolean; isMonthly: boolean }', ko: "차트 주기. period '60'·'1D'·'1W', minutes 한 봉의 분, isIntraday 일봉보다 짧은지", en: "The chart's interval: period ('60', '1D', '1W'…), minutes per bar, isIntraday (shorter than a day)…", example: 'const len = timeframe.isIntraday ? 50 : 20' },
      { name: 'date.hour', ts: `hour(tz?: string): ${S}`, ko: '봉 시작의 시 (0~23). 시간대 기본은 거래소 시간대(syminfo.timezone), 한국 시간은 date.hour(\'Asia/Seoul\')', en: "The hour (0–23) each bar opens at, in the market's zone (syminfo.timezone) unless one is given, e.g. date.hour('Asia/Seoul')", example: "date.hour('Asia/Seoul')" },
      { name: 'date.minute', ts: `minute(tz?: string): ${S}`, ko: '봉 시작의 분 (0~59)', en: 'The minute (0–59) each bar opens at' },
      { name: 'date.dayofweek', ts: `dayofweek(tz?: string): ${S}`, ko: '요일: 0 일요일 ~ 6 토요일 (자바스크립트와 같음, 파인과 다름)', en: 'Weekday: 0 Sunday … 6 Saturday (as in JavaScript, not Pine)' },
      { name: 'date.day', ts: `day(tz?: string): ${S}`, ko: '날짜 (1~31)', en: 'Day of the month (1–31)' },
      { name: 'date.month', ts: `month(tz?: string): ${S}`, ko: '월 (1~12)', en: 'Month (1–12)' },
      { name: 'date.year', ts: `year(tz?: string): ${S}`, ko: '연도', en: 'Year' },
      { name: 'date.isNew', ts: 'isNew(period?: Period, tz?: string): Cond', ko: "새 하루('D', 기본) · 주('W', 월요일 시작) · 달('M') · 해('Y')의 첫 봉에서 참", en: "True on the first bar of each day ('D', default), week ('W', from Monday), month ('M') or year ('Y')", example: "bgcolor(date.isNew('W'), { color: color.alpha(color.gray, 0.15) })" },
      { name: 'date.session', ts: 'session(spec: string, tz?: string): Cond', ko: "봉 시작이 'HHMM-HHMM' 시간 안이면 참 (끝이 더 이르면 자정을 넘김: '2200-0200')", en: "True on bars opening inside 'HHMM-HHMM' (an earlier end runs past midnight: '2200-0200')", example: "date.session('0900-1530', 'Asia/Seoul')" },
    ],
  },
  {
    id: 'input',
    ko: '입력값',
    en: 'Inputs',
    items: [
      { name: 'input.int', ts: 'int(label: string, def: number, o?: { min?: number; max?: number } & InputOptions): number', ko: '사용자가 바꿀 수 있는 정수 (기간 등)', en: 'A whole number the user can change (a period…)', example: "const len = input.int('Length', 14, { min: 2, max: 200 })" },
      { name: 'input.number', ts: 'number(label: string, def: number, o?: { min?: number; max?: number; step?: number } & InputOptions): number', ko: '사용자가 바꿀 수 있는 숫자', en: 'A number the user can change', example: "const mult = input.number('Multiplier', 2, { step: 0.1 })" },
      { name: 'input.bool', ts: 'bool(label: string, def: boolean, o?: InputOptions): boolean', ko: '켜고 끄는 값', en: 'An on/off switch', example: "const show = input.bool('Show signals', true)" },
      { name: 'input.select', ts: 'select<T extends string | number>(label: string, options: T[], def: T, o?: InputOptions): T', ko: '목록에서 고르기 (글자나 숫자 목록)', en: 'A choice from a list (of strings or numbers)', example: "const kind = input.select('Type', ['EMA', 'SMA'], 'EMA')" },
      { name: 'input.source', ts: "source(label: string, def?: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'hlcc4', o?: InputOptions): Series", ko: '기준 가격 고르기 (종가·시가…)', en: 'Which price to use (close, open…)', example: "const src = input.source('Source', 'close')" },
      { name: 'input.text', ts: 'text(label: string, def?: string, o?: InputOptions): string', ko: "사용자가 적는 글자 (예: 선 번호 목록 '1,3,6'). 200자까지", en: "Text the user types (e.g. a list like '1,3,6'); up to 200 characters", example: "const list = input.text('Lines', '1,3,6')" },
      { name: 'input.color', ts: 'color(label: string, def: Color, o?: InputOptions): Color', ko: '사용자가 고르는 색', en: 'A color the user picks', example: "const c = input.color('Line color', color.orange, { group: 'Style' })" },
      { name: 'input.timeframe', ts: 'timeframe(label: string, def?: Timeframe, o?: InputOptions): Timeframe', ko: "사용자가 고르는 주기 (request.bars에 넘겨요). 기본 '1D'", en: "An interval the user picks (for request.bars); default '1D'", example: "const tf = input.timeframe('Higher timeframe', '240')" },
      { name: 'input.symbol', ts: 'symbol(label: string, def: string, o?: InputOptions): string', ko: "사용자가 고르는 종목 ('BINANCEF:ETHUSDT'처럼 거래소:종목). request.bars · request.data에 넘겨요", en: "A market the user picks ('BINANCEF:ETHUSDT', exchange:symbol), for request.bars / request.data", example: "const other = input.symbol('Compare with', 'BINANCEF:ETHUSDT')" },
      { name: 'input.time', ts: 'time(label: string, def: number | string, o?: InputOptions): number', ko: "사용자가 고르는 시각 (UTC 밀리초). 기본값은 숫자나 '2026-01-01T00:00:00Z' 같은 날짜. 앵커 VWAP 시작점 등", en: "A moment the user picks (UTC ms); the default is a number or a date like '2026-01-01T00:00:00Z'. For an anchored VWAP's start, …", example: "const from = input.time('Anchor', '2026-01-01T00:00:00Z')" },
    ],
  },
  {
    id: 'ma',
    ko: '이동평균',
    en: 'Moving averages',
    items: [
      { name: 'ta.sma', ts: `sma(src: ${SRC}, length: ${N}): ${S}`, ko: '단순 이동평균', en: 'Simple moving average', example: 'ta.sma(close, 20)' },
      { name: 'ta.ema', ts: `ema(src: ${SRC}, length: ${N}): ${S}`, ko: '지수 이동평균 (처음 값은 SMA로 시작)', en: 'Exponential moving average (seeded with the SMA)', example: 'ta.ema(close, 20)' },
      { name: 'ta.rma', ts: `rma(src: ${SRC}, length: ${N}): ${S}`, ko: '와일더 이동평균 (RSI·ATR에 쓰여요)', en: 'Wilder’s moving average (used by RSI, ATR)' },
      { name: 'ta.wma', ts: `wma(src: ${SRC}, length: ${N}): ${S}`, ko: '가중 이동평균', en: 'Weighted moving average' },
      { name: 'ta.vwma', ts: `vwma(src: ${SRC}, length: ${N}): ${S}`, ko: '거래량 가중 이동평균', en: 'Volume-weighted moving average' },
      { name: 'ta.hma', ts: `hma(src: ${SRC}, length: ${N}): ${S}`, ko: '헐 이동평균', en: 'Hull moving average' },
      { name: 'ta.dema', ts: `dema(src: ${SRC}, length: ${N}): ${S}`, ko: '이중 지수 이동평균 (2·EMA − EMA(EMA))', en: 'Double EMA (2·EMA − EMA of the EMA)' },
      { name: 'ta.tema', ts: `tema(src: ${SRC}, length: ${N}): ${S}`, ko: '삼중 지수 이동평균', en: 'Triple EMA' },
      { name: 'ta.linreg', ts: `linreg(src: ${SRC}, length: ${N}, offset?: ${N}): ${S}`, ko: '선형회귀(최소제곱) 선의 값 = LSMA. offset만큼 뒤의 값', en: 'Least-squares regression value (LSMA); offset reads that many bars back', example: 'ta.linreg(close, 25, 0)' },
      { name: 'ta.alma', ts: `alma(src: ${SRC}, length: ${N}, offset?: ${N}, sigma?: ${N}): ${S}`, ko: '아르노 르구 이동평균 (기본 offset 0.85, sigma 6)', en: 'Arnaud Legoux moving average (default offset 0.85, sigma 6)', example: 'ta.alma(close, 9, 0.85, 6)' },
      { name: 'ta.swma', ts: `swma(src: ${SRC}): ${S}`, ko: '최근 4봉 대칭 가중 평균 (1/6, 2/6, 2/6, 1/6)', en: 'Symmetrically weighted average of the last 4 values (1/6, 2/6, 2/6, 1/6)' },
      { name: 'ta.vwap', ts: `vwap(src?: ${SRC}, anchor?: Period | Bool): ${S}`, ko: "거래량 가중 평균가. anchor마다 새로 시작: 'D'(하루, 기본) · 'W'(주) · 'M'(달) · 'Y'(해)는 거래소 시간대 기준(코인 UTC, 국내주식 한국 시간), 조건을 주면 그 조건이 참인 봉부터. src 기본 hlc3", en: "Volume-weighted average price, starting over at each anchor: 'D' (day, default), 'W', 'M', 'Y' in the market's time zone (crypto UTC, Korean stocks Seoul), or a condition (from the bars where it is true). src defaults to hlc3", example: "ta.vwap(hlc3, 'D')" },
      { name: 'ta.vwapbands', ts: `vwapbands(src?: ${SRC}, anchor?: Period | Bool, mult?: ${N}): { vwap: ${S}; upper: ${S}; lower: ${S} }`, ko: 'VWAP와 위아래 밴드 (거래량 가중 표준편차 × mult, 기본 1)', en: 'VWAP with bands at ± mult × the volume-weighted standard deviation (default 1)', example: "const v = ta.vwapbands(hlc3, 'W', 2)" },
    ],
  },
  {
    id: 'osc',
    ko: '오실레이터',
    en: 'Oscillators',
    items: [
      { name: 'ta.rsi', ts: `rsi(src: ${SRC}, length?: ${N}): ${S}`, ko: '상대강도지수 (0~100, 기본 14)', en: 'Relative strength index (0–100, default 14)', example: 'ta.rsi(close, 14)' },
      { name: 'ta.stoch', ts: `stoch(length?: ${N}, smoothK?: ${N}, smoothD?: ${N}): { k: ${S}; d: ${S} }`, ko: '스토캐스틱 %K·%D (기본 14, 3, 3)', en: 'Stochastic %K and %D (default 14, 3, 3)', example: 'const s = ta.stoch(14, 3, 3)' },
      { name: 'ta.macd', ts: `macd(src: ${SRC}, fast?: ${N}, slow?: ${N}, signal?: ${N}): { macd: ${S}; signal: ${S}; hist: ${S} }`, ko: 'MACD (기본 12, 26, 9)', en: 'MACD (default 12, 26, 9)', example: 'const m = ta.macd(close, 12, 26, 9)' },
      { name: 'ta.cci', ts: `cci(src: ${SRC}, length?: ${N}): ${S}`, ko: '상품채널지수 (기본 20)', en: 'Commodity channel index (default 20)' },
      { name: 'ta.mfi', ts: `mfi(length?: ${N}): ${S}`, ko: '자금흐름지수 (0~100, hlc3와 거래량)', en: 'Money flow index (0–100, from hlc3 and volume)' },
      { name: 'ta.roc', ts: `roc(src: ${SRC}, length: ${N}): ${S}`, ko: 'length봉 전 대비 변화율 (%)', en: 'Rate of change vs length bars ago (%)' },
      { name: 'ta.mom', ts: `mom(src: ${SRC}, length?: ${N}): ${S}`, ko: 'length봉 전 대비 변화량', en: 'Momentum: change vs length bars ago' },
      { name: 'ta.wpr', ts: `wpr(length?: ${N}): ${S}`, ko: '윌리엄스 %R (−100~0, 기본 14)', en: 'Williams %R (−100 to 0, default 14)', example: 'ta.wpr(14)' },
      { name: 'ta.cmo', ts: `cmo(src: ${SRC}, length?: ${N}): ${S}`, ko: '샹드 모멘텀 오실레이터 (−100~100, 기본 9)', en: 'Chande momentum oscillator (−100 to 100, default 9)' },
      { name: 'ta.tsi', ts: `tsi(src: ${SRC}, short?: ${N}, long?: ${N}): ${S}`, ko: 'TSI (−1~1, 파인과 같음. 화면용은 × 100). 기본 13, 25', en: 'True strength index, −1 to 1 as in Pine (× 100 for the usual display); default 13, 25' },
      { name: 'ta.cog', ts: `cog(src: ${SRC}, length?: ${N}): ${S}`, ko: '무게중심 오실레이터 (기본 10)', en: 'Center of gravity (default 10)' },
      { name: 'ta.rci', ts: `rci(src: ${SRC}, length?: ${N}): ${S}`, ko: '순위 상관 지수 RCI (−100~100, 기본 9). 100이면 봉마다 앞 봉보다 높음', en: 'Rank correlation index (−100 to 100, default 9); 100 = each value higher than the one before' },
    ],
  },
  {
    id: 'vol',
    ko: '변동성 · 추세',
    en: 'Volatility · trend',
    items: [
      { name: 'ta.atr', ts: `atr(length?: ${N}): ${S}`, ko: '평균 실제 범위 (기본 14)', en: 'Average true range (default 14)', example: 'ta.atr(14)' },
      { name: 'ta.tr', ts: `tr(): ${S}`, ko: '실제 범위', en: 'True range' },
      { name: 'ta.bb', ts: `bb(src: ${SRC}, length?: ${N}, mult?: ${N}): { upper: ${S}; mid: ${S}; lower: ${S}; width: ${S} }`, ko: '볼린저 밴드 (기본 20, 2). width = (위 − 아래) / 중간', en: 'Bollinger Bands (default 20, 2); width = (upper − lower) / mid', example: 'const band = ta.bb(close, 20, 2)' },
      { name: 'ta.stdev', ts: `stdev(src: ${SRC}, length: ${N}): ${S}`, ko: '표준편차', en: 'Standard deviation' },
      { name: 'ta.bbw', ts: `bbw(src: ${SRC}, length?: ${N}, mult?: ${N}): ${S}`, ko: '볼린저 밴드 폭 (위 − 아래) / 중간', en: 'Bollinger band width: (upper − lower) / mid' },
      { name: 'ta.kc', ts: `kc(src: ${SRC}, length?: ${N}, mult?: ${N}, useTrueRange?: boolean): { upper: ${S}; mid: ${S}; lower: ${S} }`, ko: '켈트너 채널: EMA ± mult × 실제 범위의 EMA (기본 20, 2). useTrueRange false면 고가 − 저가', en: 'Keltner channels: EMA ± mult × the EMA of the true range (default 20, 2); useTrueRange false uses high − low', example: 'const k = ta.kc(close, 20, 2)' },
      { name: 'ta.kcw', ts: `kcw(src: ${SRC}, length?: ${N}, mult?: ${N}, useTrueRange?: boolean): ${S}`, ko: '켈트너 채널 폭 (위 − 아래) / 중간', en: 'Keltner channel width: (upper − lower) / mid' },
      { name: 'ta.sar', ts: `sar(start?: ${N}, inc?: ${N}, max?: ${N}): ${S}`, ko: '파라볼릭 SAR (기본 0.02, 0.02, 0.2). 가격 아래면 상승 추세', en: 'Parabolic SAR (default 0.02, 0.02, 0.2); below the price = uptrend', example: "plot('SAR', ta.sar(0.02, 0.02, 0.2), { style: 'cross' })" },
      { name: 'ta.ichimoku', ts: `ichimoku(conversion?: ${N}, base?: ${N}, spanB?: ${N}): { conversion: ${S}; base: ${S}; spanA: ${S}; spanB: ${S} }`, ko: '일목균형표 전환선 · 기준선 · 선행스팬 A · B (기본 9, 26, 52). 밀리지 않은 값: 선행스팬은 plot의 offset: 25(기준 − 1), 후행스팬은 close를 offset: -25로', en: 'Ichimoku conversion, base, span A and B (default 9, 26, 52), not shifted: plot the spans with offset: 25 (base − 1) and the lagging line as close with offset: -25', example: 'const ich = ta.ichimoku(9, 26, 52)' },
      { name: 'ta.pivots', ts: `pivots(type?: 'traditional' | 'fibonacci' | 'woodie' | 'classic' | 'camarilla', anchor?: Period | Bool): { p: ${S}; r1: ${S}; r2: ${S}; r3: ${S}; s1: ${S}; s2: ${S}; s3: ${S} }`, ko: "피벗 포인트: 앞 기간(anchor, 기본 'D')의 고가 · 저가 · 종가로 이번 기간 내내 같은 값. 첫 기간은 NaN", en: "Pivot points from the previous period's (anchor, default 'D') high, low and close, the same all through the current period; NaN in the first one", example: "const pv = ta.pivots('traditional', 'D')" },
      { name: 'ta.dmi', ts: `dmi(length?: ${N}, adxSmoothing?: ${N}): { plus: ${S}; minus: ${S}; adx: ${S} }`, ko: '방향성 지수 +DI, −DI, ADX', en: 'Directional movement: +DI, −DI and ADX' },
      { name: 'ta.adx', ts: `adx(length?: ${N}, smoothing?: ${N}): ${S}`, ko: 'ADX (추세 강도)', en: 'ADX (trend strength)' },
      { name: 'ta.supertrend', ts: `supertrend(factor?: ${N}, atrLength?: ${N}): { line: ${S}; dir: ${S} }`, ko: '슈퍼트렌드 (기본 3, 10). dir: 1 상승, −1 하락', en: 'SuperTrend (default 3, 10); dir 1 = up, −1 = down', example: 'const st = ta.supertrend(3, 10)' },
    ],
  },
  {
    id: 'range',
    ko: '범위 · 거래량',
    en: 'Ranges · volume',
    items: [
      { name: 'ta.highest', ts: `highest(src: ${SRC}, length: ${N}): ${S}`, ko: '최근 length봉 최고값', en: 'Highest value of the last length bars', example: 'ta.highest(high, 20)' },
      { name: 'ta.lowest', ts: `lowest(src: ${SRC}, length: ${N}): ${S}`, ko: '최근 length봉 최저값', en: 'Lowest value of the last length bars' },
      { name: 'ta.highestbars', ts: `highestbars(src: ${SRC}, length: ${N}): ${S}`, ko: '최근 length봉 중 최고값이 몇 봉 전인지 (0 = 이 봉, 같으면 최근 것). 파인과 달리 양수', en: 'How many bars back the highest of the last length values is (0 = this bar, the latest on a tie); positive, unlike Pine' },
      { name: 'ta.lowestbars', ts: `lowestbars(src: ${SRC}, length: ${N}): ${S}`, ko: '최근 length봉 중 최저값이 몇 봉 전인지 (양수)', en: 'How many bars back the lowest of the last length values is (positive)' },
      { name: 'ta.max', ts: `max(src: ${SRC}): ${S}`, ko: '처음부터 지금까지의 최고값', en: 'Highest value so far (all bars up to this one)' },
      { name: 'ta.min', ts: `min(src: ${SRC}): ${S}`, ko: '처음부터 지금까지의 최저값', en: 'Lowest value so far' },
      { name: 'ta.change', ts: `change(src: ${SRC}, length?: ${N}): ${S}`, ko: 'length봉 전 대비 변화 (기본 1)', en: 'Change vs length bars ago (default 1)' },
      { name: 'ta.cum', ts: `cum(src: ${SRC}): ${S}`, ko: '누적 합 (NaN은 0으로)', en: 'Running total (NaN counts as 0)' },
      { name: 'ta.obv', ts: `obv(): ${S}`, ko: '온밸런스 볼륨', en: 'On-balance volume' },
      { name: 'ta.accdist', ts: `accdist(): ${S}`, ko: '매집 · 분산 (A/D)', en: 'Accumulation / distribution' },
      { name: 'ta.pvt', ts: `pvt(): ${S}`, ko: '가격 거래량 추세 (PVT)', en: 'Price-volume trend' },
      { name: 'ta.nvi', ts: `nvi(): ${S}`, ko: '음의 거래량 지수 (거래량이 준 봉에서만 움직임, 1에서 시작)', en: 'Negative volume index (moves only on bars where volume fell; starts at 1)' },
      { name: 'ta.pvi', ts: `pvi(): ${S}`, ko: '양의 거래량 지수 (거래량이 는 봉에서만 움직임, 1에서 시작)', en: 'Positive volume index (moves only on bars where volume rose; starts at 1)' },
      { name: 'ta.wad', ts: `wad(): ${S}`, ko: '윌리엄스 매집 · 분산', en: 'Williams accumulation / distribution' },
      { name: 'ta.wvad', ts: `wvad(): ${S}`, ko: '윌리엄스 변동 매집 · 분산 (봉마다)', en: 'Williams variable accumulation / distribution (per bar)' },
      { name: 'ta.iii', ts: `iii(): ${S}`, ko: '일중 강도 지수 (봉마다)', en: 'Intraday intensity index (per bar)' },
    ],
  },
  {
    id: 'stats',
    ko: '통계',
    en: 'Statistics',
    items: [
      { name: 'ta.median', ts: `median(src: ${SRC}, length: ${N}): ${S}`, ko: '최근 length봉 중앙값', en: 'Median of the last length values' },
      { name: 'ta.mode', ts: `mode(src: ${SRC}, length: ${N}): ${S}`, ko: '최근 length봉 최빈값 (같으면 작은 값)', en: 'Most frequent of the last length values (the smallest on a tie)' },
      { name: 'ta.percentile', ts: `percentile(src: ${SRC}, length: ${N}, percent: ${N}): ${S}`, ko: '최근 length봉에서 percent(0~100) 위치의 값 (사이 값은 보간)', en: 'The value at percent (0–100) of the last length values, interpolated', example: 'ta.percentile(close, 100, 90)' },
      { name: 'ta.percentrank', ts: `percentrank(src: ${SRC}, length: ${N}): ${S}`, ko: '앞의 length봉 중 지금 값 이하인 비율 (%)', en: '% of the previous length values at or below this one' },
      { name: 'ta.range', ts: `range(src: ${SRC}, length: ${N}): ${S}`, ko: '최근 length봉 최고 − 최저', en: 'Highest − lowest of the last length values' },
      { name: 'ta.dev', ts: `dev(src: ${SRC}, length: ${N}): ${S}`, ko: '평균 절대 편차', en: 'Mean absolute deviation' },
      { name: 'ta.variance', ts: `variance(src: ${SRC}, length: ${N}): ${S}`, ko: '분산 (stdev의 제곱)', en: 'Variance (stdev squared)' },
      { name: 'ta.correlation', ts: `correlation(a: ${SRC}, b: ${SRC}, length: ${N}): ${S}`, ko: '최근 length봉의 상관계수 (−1~1)', en: 'Correlation of a and b over the last length bars (−1 to 1)', example: 'ta.correlation(close, volume, 50)' },
    ],
  },
  {
    id: 'cond',
    ko: '조건',
    en: 'Conditions',
    items: [
      { name: 'ta.crossover', ts: `crossover(a: ${SRC}, b: ${SRC}): Cond`, ko: 'a가 b를 위로 뚫은 봉에서 참', en: 'True on the bar where a crosses above b', example: 'ta.crossover(fast, slow)' },
      { name: 'ta.crossunder', ts: `crossunder(a: ${SRC}, b: ${SRC}): Cond`, ko: 'a가 b를 아래로 뚫은 봉에서 참', en: 'True on the bar where a crosses below b' },
      { name: 'ta.cross', ts: `cross(a: ${SRC}, b: ${SRC}): Cond`, ko: '어느 쪽이든 교차한 봉', en: 'True on a cross either way' },
      { name: 'ta.rising', ts: `rising(src: ${SRC}, length: ${N}): Cond`, ko: '앞의 length봉 모두보다 높을 때', en: 'Higher than each of the previous length values' },
      { name: 'ta.falling', ts: `falling(src: ${SRC}, length: ${N}): Cond`, ko: '앞의 length봉 모두보다 낮을 때', en: 'Lower than each of the previous length values' },
      { name: 'ta.pivothigh', ts: `pivothigh(src: ${SRC}, left: ${N}, right: ${N}): ${S}`, ko: '고점(양옆보다 높음). right봉 뒤 확인되는 봉에 값, 나머지는 NaN', en: 'Pivot high (above both sides): its value on the bar right bars later that confirms it, else NaN' },
      { name: 'ta.pivotlow', ts: `pivotlow(src: ${SRC}, left: ${N}, right: ${N}): ${S}`, ko: '저점. pivothigh와 같은 방식', en: 'Pivot low, like pivothigh' },
      { name: 'ta.barssince', ts: `barssince(cond: Bool): ${S}`, ko: '조건이 마지막으로 참이었던 뒤 지난 봉 수', en: 'Bars since the condition was last true' },
      { name: 'ta.valuewhen', ts: `valuewhen(cond: Bool, src: ${SRC}, occurrence?: ${N}): ${S}`, ko: '조건이 참이던 봉의 src 값 (0 = 가장 최근)', en: 'src on the bar where cond was true (0 = most recent)' },
    ],
  },
  {
    id: 'calc',
    ko: '계산 (시리즈끼리)',
    en: 'Series math',
    items: [
      { name: 'add', ts: `function add(a: ${SRC}, b: ${SRC}): ${S}`, ko: 'a + b (봉마다)', en: 'a + b per bar' },
      { name: 'sub', ts: `function sub(a: ${SRC}, b: ${SRC}): ${S}`, ko: 'a − b (봉마다)', en: 'a − b per bar', example: 'sub(close, open)' },
      { name: 'mul', ts: `function mul(a: ${SRC}, b: ${SRC}): ${S}`, ko: 'a × b (봉마다)', en: 'a × b per bar' },
      { name: 'div', ts: `function div(a: ${SRC}, b: ${SRC}): ${S}`, ko: 'a ÷ b (0으로 나누면 NaN)', en: 'a ÷ b per bar (÷0 gives NaN)' },
      { name: 'abs', ts: `function abs(a: ${SRC}): ${S}`, ko: '절댓값', en: 'Absolute value' },
      { name: 'max', ts: `function max(a: ${SRC}, b: ${SRC}): ${S}`, ko: '봉마다 큰 값', en: 'Larger value per bar' },
      { name: 'min', ts: `function min(a: ${SRC}, b: ${SRC}): ${S}`, ko: '봉마다 작은 값', en: 'Smaller value per bar' },
      { name: 'avg', ts: `function avg(...xs: ${SRC}[]): ${S}`, ko: '봉마다 평균', en: 'Average per bar' },
      { name: 'gt', ts: `function gt(a: ${SRC}, b: ${SRC}): Cond`, ko: 'a > b', en: 'a > b', example: 'gt(close, ta.sma(close, 200))' },
      { name: 'lt', ts: `function lt(a: ${SRC}, b: ${SRC}): Cond`, ko: 'a < b', en: 'a < b' },
      { name: 'gte', ts: `function gte(a: ${SRC}, b: ${SRC}): Cond`, ko: 'a ≥ b', en: 'a ≥ b' },
      { name: 'lte', ts: `function lte(a: ${SRC}, b: ${SRC}): Cond`, ko: 'a ≤ b', en: 'a ≤ b' },
      { name: 'eq', ts: `function eq(a: ${SRC}, b: ${SRC}): Cond`, ko: 'a = b', en: 'a = b' },
      { name: 'and', ts: 'function and(a: Bool, b: Bool): Cond', ko: '둘 다 참', en: 'Both true' },
      { name: 'or', ts: 'function or(a: Bool, b: Bool): Cond', ko: '하나라도 참', en: 'Either true' },
      { name: 'not', ts: 'function not(a: Bool): Cond', ko: '반대', en: 'Negation' },
      { name: 'prev', ts: `function prev(src: ${SRC}, bars?: ${N}): ${S}`, ko: 'bars봉 전 값 (기본 1)', en: 'The value bars bars ago (default 1)' },
      { name: 'last', ts: `function last(src: ${SRC}): number`, ko: '마지막(지금) 봉 값', en: 'The latest bar’s value', example: 'last(close)' },
      { name: 'nz', ts: `function nz(src: ${SRC}, value?: ${N}): ${S}`, ko: 'NaN을 value(기본 0)로', en: 'NaN replaced by value (default 0)' },
      { name: 'fixnan', ts: `function fixnan(src: ${SRC}): ${S}`, ko: 'NaN을 바로 앞 값으로', en: 'NaN replaced by the previous value' },
      { name: 'map', ts: 'function map(fn: (i: number) => number | boolean): Series', ko: '봉 하나씩 계산 (오래된 봉부터). 바깥 변수로 상태 유지', en: 'Compute bar by bar, oldest first; outer variables keep state', example: 'map(i => (high[i] - low[i]) / close[i] * 100)' },
    ],
  },
  {
    id: 'draw',
    ko: '그리기',
    en: 'Drawing',
    items: [
      {
        name: 'plot',
        ts: `function plot(name: string, values: ${SRC}, o?: { color?: Color | PerBarColor; width?: number; style?: PlotStyle; lineStyle?: LineStyle; offset?: number }): void`,
        ko: '선 그리기. 최대 40개. style: line·step(계단)·area(영역)·circles(점)·cross·histogram(0 기준 막대, 기본 상승·하락색)·columns(막대). color에 함수를 주면 봉마다 색: i => up[i] ? color.green : color.red. offset: 몇 봉 오른쪽(음수는 왼쪽)으로 밀기',
        en: 'Draw a series; up to 40. style: line, step, area, circles, cross, histogram (bars from 0, rising / falling colors by default), columns. A function as color colors each bar: i => up[i] ? color.green : color.red. offset shifts it right by bars (negative: left)',
        example: "plot('EMA', fast, { color: (i) => (fast[i] > fast[i - 1] ? color.green : color.red), width: 2 })",
      },
      {
        name: 'hline',
        ts: 'function hline(value: number, o?: { label?: string; color?: Color; style?: LineStyle; width?: number }): void',
        ko: '가로 기준선 (이름·색·모양). 최대 20개',
        en: 'Horizontal reference line (name, color, style); up to 20',
        example: "hline(70, { label: 'Overbought', color: color.red })",
      },
      {
        name: 'fill',
        ts: 'function fill(upper: string, lower: string, o?: { color?: Color | PerBarColor; downColor?: Color }): void',
        ko: '두 plot 사이 칠하기 (plot 이름으로, plot 다음에). 최대 10개. 투명도가 없는 색은 옅게 칠해요. downColor: 아래 선이 위로 올라간 구간의 색. color에 함수를 주면 봉마다 색(null이면 안 칠함)',
        en: 'Shade between two plots, by name, after them; up to 10. A color without alpha is shaded lightly. downColor: where the lower one is on top. A function as color colors each bar (null: not shaded)',
        example: "plot('Upper', bb.upper)\nplot('Lower', bb.lower)\nfill('Upper', 'Lower', { color: color.alpha(color.blue, 0.1) })",
      },
      {
        name: 'bgcolor',
        ts: 'function bgcolor(when: Bool | PerBarColor, o?: { color?: Color }): void',
        ko: '배경 칠하기 (조건 + 색, 또는 봉마다 색을 주는 함수). 최대 10개. 투명도가 없는 색은 옅게',
        en: 'Shade the background (a condition and a color, or a function giving each bar a color); up to 10. Colors without alpha are shaded lightly',
        example: 'bgcolor(gt(close, ta.ema(close, 200)), { color: color.green })',
      },
      {
        name: 'barcolor',
        ts: 'function barcolor(when: Bool | PerBarColor, o?: { color?: Color }): void',
        ko: '캔들 색 바꾸기 (캔들 위 지표). 조건 + 색, 또는 봉마다 색을 주는 함수',
        en: 'Recolor candles (indicators over the candles): a condition and a color, or a function giving each bar a color',
        example: 'barcolor(ta.crossover(close, ta.sma(close, 20)), { color: color.yellow })',
      },
      {
        name: 'plotshape',
        ts: `function plotshape(when: Bool, o?: { shape?: Shape; location?: Place; price?: ${SRC}; color?: Color; textColor?: Color; text?: string; size?: Size }): void`,
        ko: '조건이 참인 봉마다 모양 표시. 최대 20개. 위쪽 모양은 봉 아래, 아래쪽 모양은 봉 위가 기본',
        en: 'A shape on every bar where the condition is true; up to 20. Up shapes sit under the bar, others over it',
        example: "plotshape(ta.crossover(fast, slow), { shape: 'triangleup', text: 'Buy' })",
      },
      {
        name: 'label',
        ts: "function label(bar: number, text: string, o?: { location?: Place; price?: number; color?: Color; textColor?: Color; style?: 'box' | 'text'; align?: 'left' | 'center' | 'right'; size?: Size }): void",
        ko: "글자 표시. bar는 봉 번호(-1 = 마지막 봉, bar.count + 3 = 마지막 봉 오른쪽 빈 칸). price를 주면 그 가격에. style 'text'는 배경 없이, align 'right'는 점 오른쪽으로. 가장 최근 500개",
        en: "Text on the chart. bar: the index (-1 = the latest, bar.count + 3 = the empty space on the right). With price, at that price. style 'text' has no box; align 'right' starts at the point. The latest 500 stay",
        example: "label(-1, 'RSI ' + last(rsi).toFixed(1))",
      },
      {
        name: 'line',
        ts: 'function line(x1: number, y1: number, x2: number, y2: number, o?: { color?: Color; width?: number; style?: LineStyle; extend?: Extend }): void',
        ko: "두 점(봉 번호, 가격)을 잇는 선. extend: 'right'·'left'·'both'로 끝까지. 가장 최근 500개",
        en: "A line between two points (bar index, price). extend 'right', 'left' or 'both' runs it to the edge. The latest 500 stay",
        example: "line(-50, last(high), -1, last(high), { color: color.orange, style: 'dashed', extend: 'right' })",
      },
      {
        name: 'box',
        ts: 'function box(left: number, top: number, right: number, bottom: number, o?: { color?: Color; bg?: Color; width?: number; style?: LineStyle; extend?: Extend; text?: string; textColor?: Color }): void',
        ko: "사각형 (봉 번호, 가격). color는 테두리, bg는 안쪽(투명도 없으면 옅게). extend 'right'면 오른쪽 끝까지. 가장 최근 500개",
        en: "A rectangle (bar indices, prices). color: the border, bg: the inside (lightly, without alpha). extend 'right' runs it to the edge. The latest 500 stay",
        example: "box(-30, last(high), -1, last(low), { color: color.red, bg: color.alpha(color.red, 0.15), extend: 'right', text: 'Range' })",
      },
      {
        name: 'table',
        ts: "function table(o: { position?: Position; rows: (string | number | null | { text: string; color?: Color; bg?: Color; align?: 'left' | 'center' | 'right' })[][]; bg?: Color; textColor?: Color; border?: Color; size?: Size }): void",
        ko: '차트 구석에 표(대시보드). rows는 줄 목록, 줄은 칸 목록. 최대 4개, 60줄 × 10칸',
        en: 'A table in a corner of the chart (a dashboard). rows: a list of rows, each a list of cells. Up to 4, 60 rows × 10 cells',
        example: "table({ position: 'top-right', rows: [['RSI', last(rsi).toFixed(1)], ['EMA', last(fast).toFixed(2)]] })",
      },
      {
        name: 'color',
        ts: 'const color: { up: Color; down: Color; red: Color; blue: Color; green: Color; orange: Color; yellow: Color; purple: Color; pink: Color; teal: Color; gray: Color; white: Color; black: Color; alpha(c: Color, opacity: number): Color; "new"(c: Color, transparency?: number): Color; rgb(r: number, g: number, b: number, opacity?: number): Color }',
        ko: "색. color.up / color.down은 보는 사람의 상승·하락 색. '#RRGGBB'·'#RRGGBBAA'도 돼요. color.alpha(c, 0.2)는 불투명도 0(안 보임)~1, color.new(c, 80)은 파인처럼 투명도 0~100",
        en: "Colors; color.up / color.down follow the viewer’s rising / falling colors. '#RRGGBB' and '#RRGGBBAA' work too. color.alpha(c, 0.2) sets opacity 0 (invisible)–1; color.new(c, 80) is Pine’s transparency 0–100",
        example: 'color.alpha(color.green, 0.2)',
      },
    ],
  },
  {
    id: 'strategy',
    ko: '전략 · 알림 · 디버그',
    en: 'Strategy · alerts · debug',
    items: [
      {
        name: 'strategy',
        ts: 'function strategy(o: { long?: Bool; longExit?: Bool; short?: Bool; shortExit?: Bool; stopLoss?: number | Series | { long?: number | Series; short?: number | Series }; takeProfit?: number | Series | Target[] | { long?: number | Series | Target[]; short?: number | Series | Target[] }; trailingStop?: number; breakEven?: boolean; exitAfter?: number; entryPrice?: Series | { long?: Series; short?: Series }; entryBars?: number; pyramiding?: number; leverage?: number; size?: number; amount?: number; qty?: number; capital?: number; fee?: number; slippage?: number; reverse?: boolean }): void',
        ko: '백테스트 전략 (한 번만). 신호는 다음 봉 시가에 체결. long·short: 진입 조건, longExit·shortExit: 청산 조건(없으면 손절·익절·반대 신호로만). stopLoss·takeProfit: 진입가에서 %(숫자) 또는 봉마다 가격(시리즈, 전 봉 값을 씀). 롱·숏이 다르면 { long, short }로 따로, 빠진 쪽은 없음. takeProfit을 목록으로 주면 나눠 익절: [{ at: 2, close: 50 }, { at: 5 }]는 +2%에 절반, +5%에 나머지(close는 포지션의 %, 마지막 것을 비우면 나머지 전부). breakEven: true면 첫 목표 다음 봉부터 손절이 진입가. trailingStop: 최고(숏은 최저)가에서 % 되돌림. exitAfter: 진입 N봉 뒤 시가에 청산. entryPrice: 신호 봉의 이 가격에 주문(롱은 종가보다 아래면 지정가, 위면 돌파 주문)을 내고 entryBars봉(기본 1) 기다림. pyramiding: 같은 방향 최대 진입 횟수(기본 1, 평균 단가로 합침, size를 100보다 작게). leverage: 선물 레버리지(기본 1, 증거금을 다 잃으면 강제 청산, 수수료는 레버리지 곱한 금액에). size: 한 번에 쓰는 자산 %(기본 100), 대신 amount(진입마다 금액, capital 단위) 또는 qty(진입마다 수량). capital: 시작 금액(기본 10000). fee·slippage: 체결마다 %(없으면 화면 설정). 같은 봉에 손절·익절이 다 닿으면 손절. reverse: 반대 신호에 뒤집기(기본 true). 예전 { entry, exit, side }도 돼요',
        en: 'The backtest strategy (once). Signals fill at the next bar’s open. long / short: entry conditions; longExit / shortExit: exits (without them, only stops, targets and the other side’s entry close). stopLoss / takeProfit: % from the entry (a number) or a price per bar (a series; the bar before’s value is used); per side with { long, short } (a side left out has none). A list as takeProfit takes profit in parts: [{ at: 2, close: 50 }, { at: 5 }] is half at +2%, the rest at +5% (close is a % of the position; left out on the last one: the rest). breakEven: true moves the stop to the entry price from the bar after the first target. trailingStop: % back from the best price. exitAfter: close at the open N bars after the entry. entryPrice: an order at this price of the signal bar (for a long, below the close a limit, above it a breakout stop), waiting entryBars bars (default 1). pyramiding: most entries one way (default 1; one position at the average price; keep size under 100). leverage: futures leverage (default 1; liquidated when the margin is gone; fees on the leveraged value). size: % of the account per entry (default 100), or amount (money per entry, in capital’s units) or qty (quantity per entry). capital: starting money (default 10000). fee / slippage: % per fill (default: the viewer’s settings). A bar touching both stop and target takes the stop. reverse: an entry the other way turns the position (default true). The old { entry, exit, side } still works',
        example: 'strategy({ long: ta.crossover(fast, slow), short: ta.crossunder(fast, slow), stopLoss: 2, takeProfit: [{ at: 2, close: 50 }, { at: 5 }], breakEven: true })',
      },
      {
        name: 'alert',
        ts: 'function alert(when: Bool, message?: string): void',
        ko: "알림 (10개까지). 조건이 방금 끝난 봉에서 참이면 울려요(진행 중인 봉은 끝날 때 판단). 사용자가 '알림 받기'를 켠 종목·주기에서, 터미널이 열려 있는 동안. message에 {name} {symbol} {close} {time}을 넣을 수 있어요",
        en: "An alert (up to 10). Rings when the condition is true on a bar that just closed (a forming bar is judged when it closes), for the market and timeframe the user turned 'Get alerts' on for, while the terminal is open. message may hold {name} {symbol} {close} {time}",
        example: "alert(ta.crossover(fast, slow), '{symbol} golden cross at {close}')",
      },
      {
        name: 'screen',
        ts: 'function screen(name: string, value: Series | Cond | number): void',
        ko: '스크리너 칸 (10개까지): 마지막 봉의 값. 스크리너가 이 스크립트를 여러 종목에 돌려 이 값으로 거르고 정렬해요',
        en: 'A screener column (up to 10): the value on the last bar. The screener runs the script on many markets and sorts and filters by it',
        example: "screen('RSI', ta.rsi(close, 14))",
      },
      { name: 'log', ts: 'function log(...values: unknown[]): void', ko: '값 확인용 출력 (최대 50줄)', en: 'Print values for checking (up to 50 lines)' },
    ],
  },
];

/** Types the declarations use. */
export const TYPES = `/** One number per bar, oldest first (NaN = no value). Use sub/add/gt… or map, never + - > on it. */
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
type Target = { at: number | Series; close?: number };`;

/** Every name in scope, from the spec (test/spec.test.ts checks the runtime has exactly these). */
export const SPEC_NAMES = GROUPS.flatMap((g) => g.items.map((i) => i.name));
