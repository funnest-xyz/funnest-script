import { describe, expect, it } from 'vitest';
import { runIsolated } from '../src/isolate';
import { checkScript, declaredTimeframe, findExamples, getFunction, listFunctions, sampleBars } from '../src/tools';

const head = "//@version=2\nindicator({ name: 'x', overlay: true })\n";

describe('CLI / MCP tools (no network)', () => {
  it('check: a good script passes types and a sample run', () => {
    const r = checkScript(`${head}plot('EMA', ta.ema(close, 20))\n`);
    expect(r.ok).toBe(true);
    expect(r.types).toEqual([]);
    expect(r.run.ok && r.run.plots[0]!.name).toBe('EMA');
  });

  it('check: types catch a misspelled function, a missing argument and series arithmetic before running', () => {
    const r = checkScript(`${head}const a = ta.emaa(close, 10)\nconst b = ta.sma(close)\nconst c = close - open\n`);
    expect(r.ok).toBe(false);
    const lines = (r.types ?? []).map((p) => p.line);
    expect(lines).toEqual(expect.arrayContaining([3, 4, 5]));
    expect(r.types!.find((p) => p.line === 3)!.message).toMatch(/Did you mean 'ema'/);
    expect(r.types!.find((p) => p.line === 3)!.message).not.toMatch(/sma\(src/); // the namespace isn't spelled out
  });

  it('runs isolated: no process / require, and a loop that never ends is stopped', () => {
    const bars = sampleBars();
    const r = runIsolated(`${head}log(typeof process, typeof require, typeof globalThis.process)\n`, bars);
    expect(r.ok && r.logs[0]).toBe('undefined undefined undefined');
    const stuck = runIsolated(`${head}while (true) {}\n`, bars, {}, 'en', 300);
    expect(!stuck.ok && stuck.code).toBe('TIMEOUT');
    // The context survives a timeout: the next run works.
    expect(runIsolated(`${head}plot('c', close)\n`, bars).ok).toBe(true);
  });

  it('docs lookups', () => {
    expect(getFunction('rsi')?.name).toBe('ta.rsi');
    expect(getFunction('ta.ema(close, 20)')?.name).toBe('ta.ema');
    expect(getFunction('nope')).toBeNull();
    expect(findExamples('macd').map((e) => e.file)).toEqual(['04-macd.js']);
    expect(findExamples().length).toBe(14);
    expect(listFunctions('ko').length).toBeGreaterThan(5);
  });
});

describe('type check is about the language, not JavaScript style', () => {
  it('a helper function without types is fine', () => {
    const r = checkScript(`${head}const mid = (len) => avg(ta.highest(high, len), ta.lowest(low, len))\nplot('m', mid(9))\n`);
    expect(r.types).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('run / backtest use the script’s own timeframe when none is given', () => {
  it('reads indicator({ timeframe }) without running the script; comments and unknown intervals don’t count', () => {
    expect(declaredTimeframe(`//@version=2\nindicator({ name: 'A', overlay: true, timeframe: '240' })\nplot('c', close)`)).toBe('240');
    expect(declaredTimeframe(`//@version=2\n// indicator({ name: 'B', overlay: true, timeframe: '5' })\nindicator({ name: 'B', overlay: true })`)).toBeNull();
    expect(declaredTimeframe(`//@version=2\nindicator({ name: 'C', overlay: true, timeframe: '1M' })`)).toBeNull(); // not fetchable here
    expect(declaredTimeframe(`//@version=2\nindicator({ name: 'D', overlay: false })\nconst d = request.bars({ timeframe: '1D' })`)).toBeNull();
  });
  it('check says what it’s made for', () => {
    const r = checkScript(`//@version=2\nindicator({ name: 'E', overlay: true, timeframe: '60' })\nplot('c', close)`);
    expect(r.run.ok && r.run.timeframe).toBe('60');
  });
});
