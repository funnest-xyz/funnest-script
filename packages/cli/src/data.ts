import { type Bars, type RequestData, type RequestedBars, type RequestSpec, spacingOf } from '@funnest/script';
import { fetchBars, isResolution, type Resolution } from './bars';

/**
 * What the CLI and the MCP tools fetch for a script's requests: other timeframes and symbols
 * from the exchanges (the markets fetchBars knows), and Binance futures data (funding, open
 * interest, long/short ratios) for BINANCEF symbols. The rest of request.data exists in the app
 * only; here it stays NaN and the run says so.
 */

const MS: Record<string, number> = { '1D': 86_400_000, '1W': 7 * 86_400_000, '1M': 30 * 86_400_000 };
export const timeframeMs = (tf: string) => MS[tf] ?? Number(tf) * 60_000;

const FAPI = 'https://fapi.binance.com';
const PERIODS: [string, number][] = [['5m', 5], ['15m', 15], ['30m', 30], ['1h', 60], ['2h', 120], ['4h', 240], ['6h', 360], ['12h', 720], ['1d', 1440]];

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'funnest-script' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

/** Points (time, value) on the bars: the latest point before each bar's close. */
function onBars(time: Float64Array, spacing: number, points: [number, number][]): Float64Array {
  const out = new Float64Array(time.length).fill(Number.NaN);
  let j = -1;
  for (let i = 0; i < time.length; i++) {
    const end = time[i]! + spacing;
    while (j + 1 < points.length && points[j + 1]![0] < end) j++;
    if (j >= 0) out[i] = points[j]![1];
  }
  return out;
}

async function binanceData(name: string, code: string, bars: Bars): Promise<Float64Array | null> {
  const spacing = spacingOf(bars.time);
  const minutes = spacing / 60_000;
  let period = PERIODS[0]!;
  for (const p of PERIODS) if (p[1] <= minutes) period = p;
  const stat = async (endpoint: string, field: string, scale = 1) => {
    const rows = await json<Record<string, string | number>[]>(`${FAPI}/futures/data/${endpoint}?symbol=${encodeURIComponent(code)}&period=${period[0]}&limit=500`);
    return onBars(bars.time, spacing, rows.map((r) => [Number(r.timestamp), Number(r[field]) * scale] as [number, number]).sort((a, b) => a[0] - b[0]));
  };
  switch (name) {
    case 'funding': {
      const rows = await json<{ fundingTime: number; fundingRate: string }[]>(`${FAPI}/fapi/v1/fundingRate?symbol=${encodeURIComponent(code)}&limit=1000`);
      return onBars(bars.time, spacing, rows.map((r) => [r.fundingTime, Number(r.fundingRate) * 100] as [number, number]).sort((a, b) => a[0] - b[0]));
    }
    case 'openInterest':
      return stat('openInterestHist', 'sumOpenInterestValue', 1e-6);
    case 'longShortRatio':
      return stat('globalLongShortAccountRatio', 'longShortRatio');
    case 'topLongShortRatio':
      return stat('topLongShortPositionRatio', 'longShortRatio');
    default:
      return null;
  }
}

/**
 * Requested bars from before the chart's first bar too, so `.compute()` has history to warm up
 * on (a daily 20 EMA on a 12-day hourly chart needs earlier days).
 */
const WARMUP = 200;

/** Fetches what the specs ask for; what can't be fetched is left out (it stays NaN). */
export async function fulfil(specs: RequestSpec[], ctx: { symbol: string; resolution: Resolution; bars: Bars }): Promise<{ data: RequestData; unavailable: string[] }> {
  const data: RequestData = { bars: {}, data: {} };
  const unavailable: string[] = [];
  const n = ctx.bars.time.length;
  const span = n ? ctx.bars.time[n - 1]! - ctx.bars.time[0]! + spacingOf(ctx.bars.time) : 0;
  for (const s of specs) {
    const symbol = s.symbol ?? ctx.symbol;
    try {
      if (s.kind === 'bars') {
        const tf = s.timeframe ?? ctx.resolution;
        if (!isResolution(tf)) throw new Error(`timeframe ${tf} isn't available here`);
        const ms = timeframeMs(tf);
        const got = await fetchBars(symbol, tf, Math.min(1000, Math.ceil(span / ms) + WARMUP));
        const bars: RequestedBars = { time: got.time, open: got.open, high: got.high, low: got.low, close: got.close, volume: got.volume, resolutionMs: ms };
        data.bars![s.key] = bars;
      } else {
        const at = symbol.indexOf(':');
        const series = symbol.slice(0, at) === 'BINANCEF' ? await binanceData(s.name!, symbol.slice(at + 1), ctx.bars) : null;
        if (!series) throw new Error(`${s.name} for ${symbol} is in the app only`);
        data.data![s.key] = series;
      }
    } catch (e) {
      unavailable.push(`${s.key}: ${(e as Error).message}`);
    }
  }
  return { data, unavailable };
}
