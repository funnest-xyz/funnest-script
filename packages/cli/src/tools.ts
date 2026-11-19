import { type Bars, EXAMPLES, GROUPS, type InputValues, isV2, LLMS_TEXT, type Locale, type RunResult, type SpecItem } from '@funnest/script';
import { fetchBars, type FetchedBars, type Resolution } from './bars';
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

export async function runScript(code: string, o: RunOptions = {}): Promise<{ symbol: string; resolution: Resolution; result: RunSummary | Failure; unavailable?: string[] }> {
  const bars = await fetchBars(o.symbol ?? 'BINANCEF:BTCUSDT', o.resolution ?? '60', o.count ?? 500);
  const { result, unavailable } = await runWithRequests(code, bars, o);
  return { symbol: bars.symbol, resolution: bars.resolution, result: summarize(result, bars), ...(unavailable.length ? { unavailable } : {}) };
}

export async function backtestScript(
  code: string,
  o: RunOptions & { feePct?: number; slippagePct?: number } = {},
): Promise<{ symbol: string; resolution: Resolution; result: RunSummary | Failure; backtest: BacktestSummary | null; unavailable?: string[] }> {
  const bars = await fetchBars(o.symbol ?? 'BINANCEF:BTCUSDT', o.resolution ?? '60', o.count ?? 1000);
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
