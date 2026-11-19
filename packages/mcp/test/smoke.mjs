// Live check (needs network): talks to the built server (dist/server.js) as an AI tool would: lists the tools, checks a
// broken draft, runs the fix on real bars and backtests an example. Build first: pnpm build
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/server.js')] }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  return { isError: !!r.isError, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
};

console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const docs = await call('get_docs', { section: 'Rules' });
console.log('get_docs Rules:', String(docs.body).split('\n').slice(0, 3).join(' / '));

const draft = "//@version=2\nindicator({ name: 'Trend', overlay: true })\nconst fast = ta.emaa(close, 10)\nconst up = close > fast\nplot('fast', fast)\n";
const bad = await call('check_script', { code: draft, locale: 'en' });
console.log('check broken → isError', bad.isError, '| types:', bad.body.types.map((p) => `L${p.line} ${p.message.slice(0, 60)}`));

const fixed = "//@version=2\nindicator({ name: 'Trend', overlay: true })\nconst fast = ta.ema(close, 10)\nconst slow = ta.ema(close, 30)\nplot('fast', fast)\nplot('slow', slow)\nstrategy({ long: ta.crossover(fast, slow), longExit: ta.crossunder(fast, slow) })\n";
const ok = await call('check_script', { code: fixed });
console.log('check fixed → ok', ok.body.ok);
const run = await call('run_script', { code: fixed, symbol: 'BINANCEF:ETHUSDT', timeframe: '240', bars: 300 });
console.log('run →', run.body.symbol, run.body.result.plots.map((p) => `${p.name} last ${p.last}`).join(', '), '| entries', run.body.result.strategy.entries);
const bt = await call('backtest_script', { code: fixed, symbol: 'UPBIT:KRW-BTC', timeframe: '1D', bars: 300 });
console.log('backtest →', bt.body.backtest.trades, 'trades,', bt.body.backtest.totalReturnPct, '% vs buy & hold', bt.body.backtest.buyHoldPct, '%');
console.log('get_function supertrend →', (await call('get_function', { name: 'supertrend' })).body.ts);
await client.close();
