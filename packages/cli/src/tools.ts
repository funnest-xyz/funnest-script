import { deflateRawSync } from 'node:zlib';
import { type Bars, EXAMPLES, GROUPS, type InputValues, isV2, LLMS_TEXT, type Locale, type RunResult, type SpecItem } from '@funnest/script';
import { fetchBars, type FetchedBars, type Resolution, isResolution } from './bars';
import { fulfil } from './data';
import { runIsolated } from './isolate';
import { backtestSummary, summarize, type BacktestSummary, type Failure, type RunSummary } from './summary';
import { typeCheck, type TypeProblem } from './typecheck';

/**
 * What the CLI and the MCP server do, in one place: check a script, run it on real bars, backtest
 * it, and look things up in the docs. Every answer is plain data (JSON-friendly).
 */

/** 300 hourly bars of a deterministic random walk: for checks without the network. */
export function sampleBars(n = 300): Bars {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const close: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) close.push((p *= 1 + rnd() * 0.03 + Math.sin(i / 30) * 0.005));
  const wick = Array.from({ length: n * 2 }, () => (rnd() + 0.5) * 0.006);
  const f = (xs: number[]) => Float64Array.from(xs);
  return {
    open: f(close.map((c, i) => (i ? close[i - 1]! : c))),
    // Wicks of their own length, as real bars have (equal neighbouring highs would hide every pivot).
    high: f(close.map((c, i) => Math.max(c, i ? close[i - 1]! : c) * (1.001 + wick[i]!))),
    low: f(close.map((c, i) => Math.min(c, i ? close[i - 1]! : c) * (0.999 - wick[n + i]!))),
    close: f(close),
    volume: f(close.map((_, i) => 1000 + ((i * 37) % 500))),
    time: f(close.map((_, i) => Date.UTC(2026, 0, 1) + i * 3_600_000)),
  };
}

export interface CheckResult {
  ok: boolean;
  /** TypeScript against funnest-script.d.ts (null: TypeScript isn't installed). */
  types: TypeProblem[] | null;
  /** A run on sample bars (catches what types can't: the declaration, limits, NaN…). */
  run: RunSummary | Failure;
}

export function checkScript(code: string, locale: Locale = 'ko'): CheckResult {
  const types = isV2(code) ? typeCheck(code) : null;
  const bars = sampleBars();
  const run = summarize(runIsolated(code, bars, {}, locale), bars);
  return { ok: run.ok && !types?.length, types, run };
}

export interface RunOptions {
  symbol?: string;
  resolution?: Resolution;
  count?: number;
  inputs?: InputValues;
  locale?: Locale;
}

/**
 * Runs on fetched bars in two passes when the script asks for more data (request.bars /
 * request.data): the first finds out what, it's fetched, the second runs with it.
 */
async function runWithRequests(code: string, bars: FetchedBars, o: RunOptions): Promise<{ result: RunResult; unavailable: string[] }> {
  const first = runIsolated(code, bars, o.inputs, o.locale);
  const missing = first.requests.filter((r) => r.missing);
  if (!missing.length) return { result: first, unavailable: [] };
  const { data, unavailable } = await fulfil(missing, { symbol: bars.symbol, resolution: bars.resolution, bars });
  return { result: runIsolated(code, bars, o.inputs, o.locale, undefined, data), unavailable };
}

/**
 * The interval a script says it's written for (indicator({ timeframe: '60' })), read from the code
 * without running it (comments don't count): run and backtest use it when none is given, as the
 * app does. null when it names none or one this tool can't fetch.
 */
export function declaredTimeframe(code: string): Resolution | null {
  const bare = code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');
  const decl = /\bindicator\s*\(\s*\{([^{}]*)\}/.exec(bare)?.[1] ?? '';
  const tf = /\btimeframe\s*:\s*(['"`])([^'"`]*)\1/.exec(decl)?.[2];
  return tf && isResolution(tf) ? tf : null;
}

export async function runScript(code: string, o: RunOptions = {}): Promise<{ symbol: string; resolution: Resolution; result: RunSummary | Failure; unavailable?: string[] }> {
  const bars = await fetchBars(o.symbol ?? 'BINANCEF:BTCUSDT', o.resolution ?? declaredTimeframe(code) ?? '60', o.count ?? 500);
  const { result, unavailable } = await runWithRequests(code, bars, o);
  return { symbol: bars.symbol, resolution: bars.resolution, result: summarize(result, bars), ...(unavailable.length ? { unavailable } : {}) };
}

export async function backtestScript(
  code: string,
  o: RunOptions & { feePct?: number; slippagePct?: number } = {},
): Promise<{ symbol: string; resolution: Resolution; result: RunSummary | Failure; backtest: BacktestSummary | null; unavailable?: string[] }> {
  const bars = await fetchBars(o.symbol ?? 'BINANCEF:BTCUSDT', o.resolution ?? declaredTimeframe(code) ?? '60', o.count ?? 1000);
  const { result: r, unavailable } = await runWithRequests(code, bars, o);
  const fee = (o.feePct ?? 0.05) / 100, slippage = (o.slippagePct ?? 0.05) / 100;
  return { symbol: bars.symbol, resolution: bars.resolution, result: summarize(r, bars), backtest: backtestSummary(r, bars, { fee, slippage }), ...(unavailable.length ? { unavailable } : {}) };
}

// ── docs ──────────────────────────────────────────────────────────

export const docs = () => LLMS_TEXT;

export function listFunctions(locale: Locale = 'en'): { group: string; names: { name: string; summary: string }[] }[] {
  return GROUPS.map((g) => ({ group: locale === 'ko' ? g.ko : g.en, names: g.items.map((i) => ({ name: i.name, summary: locale === 'ko' ? i.ko : i.en })) }));
}

export function getFunction(name: string): (SpecItem & { group: string }) | null {
  const key = name.trim().replace(/\(.*$/, '');
  for (const g of GROUPS) {
    const item = g.items.find((i) => i.name === key || i.name.endsWith(`.${key}`));
    if (item) return { ...item, group: g.en };
  }
  return null;
}

/** Examples whose name or code mention every word of the query (all of them for none). */
export function findExamples(query = ''): { file: string; code: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return EXAMPLES.filter((e) => words.every((w) => `${e.file}\n${e.code}`.toLowerCase().includes(w)));
}

/** Where Funnest's terminal is: the script goes after #script= (never sent to a server). */
export const FUNNEST_TRADE_URL = 'https://funnest.xyz/trade/';

/**
 * A link that opens the script in Funnest's editor (지표 만들기), in a new tab, unsaved: the code
 * deflated and base64url'd after #script= — the part of an address browsers keep to themselves,
 * so nothing is uploaded or stored anywhere. Up to 60,000 characters (the app's limit).
 */
export function openLink(code: string): string {
  if (!code.trim()) throw new Error('The script is empty.');
  if (code.length > 60_000) throw new Error('Scripts are up to 60,000 characters.');
  return `${FUNNEST_TRADE_URL}#script=${deflateRawSync(Buffer.from(code, 'utf8'), { level: 9 }).toString('base64url')}`;
}
