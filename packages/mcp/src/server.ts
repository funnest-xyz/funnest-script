/**
 * funnest-script-mcp — a stdio MCP server so AI tools (Claude Code, Cursor, …) write Funnest
 * Script v2 by themselves: read the docs, check a draft, run it on real bars, read the result,
 * fix, backtest. Runs on the user's machine; market data comes from the exchanges' public APIs
 * (fixed hosts only — the server never fetches an address it's given).
 *
 *   claude mcp add funnest-script -- npx -y @funnest/script-mcp
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Locale } from '@funnest/script';
import { backtestScript, checkScript, docs, findExamples, getFunction, listFunctions, MARKETS, type Resolution, RESOLUTIONS, runScript } from '@funnest/script-cli';

const server = new McpServer({ name: 'funnest-script', version: '0.1.1' });

const DEFAULT_LOCALE: Locale = /^ko/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'ko' : 'en';
const locale = z.enum(['ko', 'en']).optional().describe("Message language (default: the machine's)");
// The app takes scripts up to 60,000 characters (the long ports of Pine indicators need it).
const code = z.string().max(60_000).describe('The whole Funnest Script v2 source, starting with //@version=2');
const market = {
  symbol: z
    .string()
    .regex(/^[A-Z]+:[A-Za-z0-9._-]+$/)
    .optional()
    .describe(`Funnest symbol on ${MARKETS.join(', ')}: e.g. BINANCEF:BTCUSDT (Binance perp), UPBIT:KRW-BTC, BYBIT:ETHUSDT, OKX:BTC-USDT-SWAP. Default BINANCEF:BTCUSDT`),
  timeframe: z.enum(RESOLUTIONS as unknown as [string, ...string[]]).optional().describe("Bar size: minutes (1 … 240) or 1D / 1W. Default: the script's own timeframe (indicator({ timeframe })), else 60"),
  bars: z.number().int().min(10).max(1000).optional().describe('How many latest bars (default 500, backtest 1000)'),
  inputs: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe("Input values by label (bool 1/0, select/source by option index, color as '#RRGGBB')"),
  locale,
};
const text = (value: unknown) => ({ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });

server.registerTool(
  'get_docs',
  {
    title: 'Funnest Script docs',
    description:
      'The whole Funnest Script v2 language (rules, every function with its signature, common mistakes, examples). Read this first, then write a script, then check_script / run_script it.',
    inputSchema: { section: z.string().optional().describe('Only the part whose heading contains this (e.g. "Rules", "Common mistakes", "Examples")') },
  },
  async ({ section }) => {
    const all = docs();
    if (!section) return { content: [text(all)] };
    const parts = all.split(/\n(?=## )/).filter((p) => p.split('\n')[0]!.toLowerCase().includes(section.toLowerCase()));
    return { content: [text(parts.length ? parts.join('\n') : all)] };
  },
);

server.registerTool(
  'list_functions',
  { title: 'List functions', description: 'Every name a script can use, grouped, with one line each.', inputSchema: { locale } },
  async ({ locale: l = DEFAULT_LOCALE }) => ({ content: [text(listFunctions(l))] }),
);

server.registerTool(
  'get_function',
  { title: 'Get function', description: 'One function: TypeScript signature, what it does, an example (e.g. "rsi", "ta.supertrend", "map").', inputSchema: { name: z.string() } },
  async ({ name }) => {
    const f = getFunction(name);
    return { content: [text(f ?? { error: `No function "${name}". Use list_functions.` })], isError: !f };
  },
);

server.registerTool(
  'get_examples',
  { title: 'Get examples', description: 'Example scripts whose name or code contain every word of the query (all of them with none): EMA cross, RSI, Bollinger, MACD, SuperTrend, volume spike, Donchian, stochastic, streak, ATR stop, Ichimoku, signals and drawing, stops and targets, another timeframe.', inputSchema: { query: z.string().optional() } },
  async ({ query }) => ({ content: [text(findExamples(query ?? ''))] }),
);

server.registerTool(
  'check_script',
  {
    title: 'Check script',
    description:
      'Type-check a script against the language declarations and test-run it on sample bars (no network). Returns type problems with lines ("Did you mean ema?"), or the run error with its code, line and a hint to apply, or a summary of what it draws. Fix and check again until ok is true.',
    inputSchema: { code, locale },
  },
  async ({ code: c, locale: l = DEFAULT_LOCALE }) => {
    const r = checkScript(c, l);
    return { content: [text(r)], isError: !r.ok };
  },
);

server.registerTool(
  'run_script',
  {
    title: 'Run script',
    description:
      "Run a script on real bars from the exchange and summarize the result as numbers (each line's last value, range and empty share; strategy entries; warnings; log output) — the way to see the chart without seeing it.",
    inputSchema: { code, ...market },
  },
  async ({ code: c, symbol, timeframe, bars, inputs, locale: l = DEFAULT_LOCALE }) => {
    const r = await runScript(c, { symbol, resolution: timeframe as Resolution | undefined, count: bars, inputs, locale: l });
    return { content: [text(r)], isError: !r.result.ok };
  },
);

server.registerTool(
  'backtest_script',
  {
    title: 'Backtest script',
    description:
      "Run a strategy script (strategy({ long, longExit, short, shortExit, stopLoss, takeProfit, trailingStop, size })) on real bars and backtest it: signals fill at the next bar's open, one position at a time, stops and targets inside the bar, fee and slippage per fill. Returns return vs buy & hold, win rate, max drawdown, profit factor and the latest trades.",
    inputSchema: {
      code,
      ...market,
      fee_pct: z.number().min(0).max(1).optional().describe('Fee per fill in % (default 0.05)'),
      slippage_pct: z.number().min(0).max(1).optional().describe('Slippage per fill in % (default 0.05)'),
    },
  },
  async ({ code: c, symbol, timeframe, bars, inputs, locale: l = DEFAULT_LOCALE, fee_pct, slippage_pct }) => {
    const r = await backtestScript(c, { symbol, resolution: timeframe as Resolution | undefined, count: bars, inputs, locale: l, feePct: fee_pct, slippagePct: slippage_pct });
    return { content: [text(r)], isError: !r.result.ok || !r.backtest };
  },
);

await server.connect(new StdioServerTransport());
