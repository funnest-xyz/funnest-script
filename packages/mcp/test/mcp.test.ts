import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The MCP server, spoken to over stdio the way an AI tool does (only the no-network tools). It
// runs from its source with the workspace packages' source too (no build needed).
const repo = join(__dirname, '..', '..', '..');
let client: Client;

beforeAll(async () => {
  client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['--conditions=funnest-source', '--import', 'tsx', join(__dirname, '..', 'src', 'server.ts')], cwd: repo, stderr: 'ignore' }),
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
});

const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { isError: !!r.isError, text: r.content[0]!.text };
};

describe('MCP server', { timeout: 30_000 }, () => {
  it('lists the tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(['get_docs', 'list_functions', 'get_function', 'get_examples', 'check_script', 'run_script', 'backtest_script', 'open_in_funnest']);
  });

  it('open_in_funnest: a link that carries the script after #script=', async () => {
    const r = await call('open_in_funnest', { code: "//@version=2\nindicator({ name: 'x', overlay: true })\nplot('c', close)\n" });
    expect(r.text).toMatch(/^https:\/\/funnest\.xyz\/trade\/#script=[A-Za-z0-9_-]+$/);
  });

  it('check_script: a typo is an error with its line, the fix passes', async () => {
    const head = "//@version=2\nindicator({ name: 'x', overlay: true })\n";
    const bad = await call('check_script', { code: `${head}plot('f', ta.emaa(close, 10))\n`, locale: 'en' });
    expect(bad.isError).toBe(true);
    const problem = JSON.parse(bad.text).types[0];
    expect(problem.line).toBe(3);
    expect(problem.message).toMatch(/Did you mean 'ema'/);
    const good = await call('check_script', { code: `${head}plot('f', ta.ema(close, 10))\n` });
    expect(good.isError).toBe(false);
    expect(JSON.parse(good.text).ok).toBe(true);
  });

  it('docs and lookups', async () => {
    expect((await call('get_docs', { section: 'Rules' })).text).toMatch(/^## Rules/);
    expect(JSON.parse((await call('get_function', { name: 'rsi' })).text).name).toBe('ta.rsi');
    expect((await call('get_function', { name: 'nope' })).isError).toBe(true);
    expect(JSON.parse((await call('get_examples', { query: 'macd' })).text)).toHaveLength(1);
  });

  it('rejects input outside the schema', async () => {
    const r = await call('run_script', { code: '//@version=2', symbol: 'https://evil.example/x' });
    expect(r.isError).toBe(true);
  });
});
