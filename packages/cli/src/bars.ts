import type { Bars } from '@funnest/script';

/**
 * Bars from exchanges' public APIs (no keys, nothing in between): what the CLI and the MCP tools
 * run scripts on. Symbols are Funnest's (BINANCEF:BTCUSDT, UPBIT:KRW-BTC…); the value traded
 * (turnover) comes along where the exchange gives it, as in the app.
 */

export const RESOLUTIONS = ['1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const MARKETS = ['BINANCEF', 'BINANCE', 'UPBIT', 'BYBIT', 'OKX'] as const;

export interface FetchedBars extends Bars {
  symbol: string;
  resolution: Resolution;
}

type Row = [time: number, open: number, high: number, low: number, close: number, volume: number, turnover: number];

const BINANCE_INTERVAL: Record<Resolution, string> = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', '1D': '1d', '1W': '1w' };
const UPBIT_PATH: Record<Resolution, string> = { '1': 'minutes/1', '3': 'minutes/3', '5': 'minutes/5', '15': 'minutes/15', '30': 'minutes/30', '60': 'minutes/60', '120': 'minutes/60', '240': 'minutes/240', '1D': 'days', '1W': 'weeks' };
const BYBIT_INTERVAL: Record<Resolution, string> = { '1': '1', '3': '3', '5': '5', '15': '15', '30': '30', '60': '60', '120': '120', '240': '240', '1D': 'D', '1W': 'W' };
const OKX_BAR: Record<Resolution, string> = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1H', '120': '2H', '240': '4H', '1D': '1Dutc', '1W': '1Wutc' };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET as JSON; "too many requests" (429) and passing server errors are retried a few times, slower each time. */
async function json<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'funnest-script' } });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const after = Number(res.headers.get('retry-after'));
      await pause(Number.isFinite(after) && after > 0 ? after * 1000 : 400 * 2 ** attempt);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
}

export function isResolution(v: string): v is Resolution {
  return (RESOLUTIONS as readonly string[]).includes(v);
}

/** The latest `count` bars (up to 1,000), oldest first. */
export async function fetchBars(symbol: string, resolution: Resolution = '60', count = 500): Promise<FetchedBars> {
  const at = symbol.indexOf(':');
  const market = symbol.slice(0, at), code = symbol.slice(at + 1);
  if (at < 1 || !code) throw new Error(`Symbol like BINANCEF:BTCUSDT or UPBIT:KRW-BTC, got "${symbol}".`);
  const want = Math.max(10, Math.min(1000, Math.round(count)));
  let rows: Row[];
  switch (market) {
    case 'BINANCEF':
    case 'BINANCE': {
      const base = market === 'BINANCEF' ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
      const raw = await json<[number, string, string, string, string, string, number, string][]>(`${base}/klines?symbol=${encodeURIComponent(code)}&interval=${BINANCE_INTERVAL[resolution]}&limit=${want}`);
      rows = raw.map((k) => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5], +k[7]]);
      break;
    }
    case 'UPBIT': {
      type C = { candle_date_time_utc: string; opening_price: number; high_price: number; low_price: number; trade_price: number; candle_acc_trade_volume: number; candle_acc_trade_price: number };
      const out: C[] = [];
      let to = '';
      while (out.length < want) {
        const page = await json<C[]>(`https://api.upbit.com/v1/candles/${UPBIT_PATH[resolution]}?market=${encodeURIComponent(code)}&count=${Math.min(200, want - out.length)}${to ? `&to=${to}` : ''}`);
        if (!page.length) break;
        out.push(...page);
        to = `${page[page.length - 1]!.candle_date_time_utc}Z`;
        if (page.length < 200) break;
        await pause(150); // Upbit: a few requests a second per address
      }
      rows = out.reverse().map((c) => [Date.parse(`${c.candle_date_time_utc}Z`), c.opening_price, c.high_price, c.low_price, c.trade_price, c.candle_acc_trade_volume, c.candle_acc_trade_price]);
      break;
    }
    case 'BYBIT': {
      const r = await json<{ result: { list: string[][] } }>(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(code)}&interval=${BYBIT_INTERVAL[resolution]}&limit=${want}`);
      rows = r.result.list.map((k) => [+k[0]!, +k[1]!, +k[2]!, +k[3]!, +k[4]!, +k[5]!, +k[6]!] as Row).reverse();
      break;
    }
    case 'OKX': {
      const out: string[][] = [];
      let after = '';
      while (out.length < want) {
        const r = await json<{ data: string[][] }>(`https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(code)}&bar=${OKX_BAR[resolution]}&limit=100${after ? `&after=${after}` : ''}`);
        if (!r.data.length) break;
        out.push(...r.data);
        after = r.data[r.data.length - 1]![0]!;
        if (r.data.length < 100) break;
        await pause(120); // OKX history: 20 requests per 2 s
      }
      // OKX swap sizes: volCcy (coins) and volCcyQuote (USDT).
      rows = out.slice(0, want).reverse().map((k) => [+k[0]!, +k[1]!, +k[2]!, +k[3]!, +k[4]!, +k[6]!, +k[7]!]);
      break;
    }
    default:
      throw new Error(`Exchange "${market}" isn't supported here (yet): ${MARKETS.join(', ')}.`);
  }
  if (!rows.length) throw new Error(`No bars for ${symbol}.`);
  const col = (k: number) => Float64Array.from(rows, (r) => r[k]!);
  return { symbol, resolution, time: col(0), open: col(1), high: col(2), low: col(3), close: col(4), volume: col(5), turnover: col(6) };
}
