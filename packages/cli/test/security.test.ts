import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runIsolated } from '../src/isolate';
import { checkScript, sampleBars } from '../src/tools';
import { typeCheck } from '../src/typecheck';

/**
 * A script is someone else's code (often an AI's, or copied): running or checking it must not
 * reach the machine — its processes, files, environment variables — nor hang it.
 */

const head = `//@version=2\nindicator({ name: 'x', overlay: true })\nplot('c', close)\n`;
const logsOf = (code: string) => {
  const r = runIsolated(head + code, sampleBars(50), {}, 'en');
  return r.ok ? r.logs : [`failed: ${r.error}`];
};

describe('a script cannot reach the machine it runs on', () => {
  it('no way out through the objects it can see (the classic vm escape)', () => {
    // Every way to a Function constructor gives the sandbox's own, where there is no `process`.
    const routes = [
      `globalThis.constructor.constructor('return process')()`,
      `this.constructor.constructor('return process')()`,
      `(function () {}).constructor('return process')()`,
      `Object.getPrototypeOf(globalThis).constructor.constructor('return process')()`,
      `(async () => {}).constructor('return process')`,
    ];
    for (const r of routes) expect(logsOf(`try { const p = ${r}; log(typeof p === 'object' && p && 'pid' in p ? 'ESCAPED' : 'no process') } catch (e) { log('blocked') }`)[0]).not.toBe('ESCAPED');
    expect(logsOf(`log(typeof process, typeof require, typeof globalThis.__job)`)[0]).toBe('undefined undefined undefined');
    // fetch is the runtime's own, which only says no.
    expect(logsOf(`try { fetch('https://example.com') } catch (e) { log(e.message.slice(0, 40)) }`)[0]).toMatch(/fetch/);
  });

  it('a loop that never ends inside a promise is stopped too (not only plain loops)', () => {
    const started = Date.now();
    const r = runIsolated(head + `Promise.resolve().then(() => { while (true) {} })`, sampleBars(50), {}, 'en', 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(8000);
  }, 30_000);

  it('a script that takes memory without end stops at its own limit, not the machine’s', () => {
    const started = Date.now();
    const r = runIsolated(head + `const keep = []\nwhile (true) keep.push(new Float64Array(1e6))`, sampleBars(20), {}, 'en', 10_000);
    expect(r.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it('typed arrays and buffers count against a limit (they live outside the heap limit)', () => {
    for (const code of [
      'new Float64Array(2 ** 30)', // 8 GB at once
      'new ArrayBuffer(8, { maxByteLength: 2 ** 33 })', // a buffer that may grow to 8 GB
      'const keep = []; for (let k = 0; k < 100; k++) keep.push(new Float64Array(2 ** 25))', // 256 MB a time, 25 GB in all
      'Float64Array.from({ length: 2 ** 29 })',
      'new Float64Array(10).map(() => 1).constructor === Float64Array ? new Float64Array(2 ** 30) : 0',
    ]) {
      const started = Date.now();
      const r = runIsolated(head + code, sampleBars(20), {}, 'en', 10_000);
      expect(r.ok, code).toBe(false);
      if (!r.ok) expect(r.error, code).toMatch(/too much memory/);
      expect(Date.now() - started, code).toBeLessThan(8000);
    }
    // Memory that can't be counted isn't there; ordinary scripts are unaffected.
    expect(logsOf(`log(typeof WebAssembly, typeof SharedArrayBuffer, typeof Atomics)`)[0]).toBe('undefined undefined undefined');
    expect(logsOf(`log(ta.sma(close, 5).map((v) => v * 2).slice(-1)[0] > 0, new Float64Array(new ArrayBuffer(16)).length)`)[0]).toBe('true 2');
  }, 120_000);

  it('no clock or dice through the global object either', () => {
    for (const code of [
      'globalThis.Math.random()',
      'new (new Date(0).constructor)()',
      'globalThis.Date.now()',
      'Date()',
      "new Intl.DateTimeFormat('en', { timeStyle: 'medium' }).format()",
      "new Intl.DateTimeFormat('en').formatToParts()",
      'globalThis.performance.now()',
      'globalThis.crypto.getRandomValues(new Uint8Array(4))',
    ])
      expect(logsOf(`try { const v = ${code}; log('GOT ' + String(v).slice(0, 20)) } catch (e) { log('blocked') }`)[0], code).toBe('blocked');
    // Dates of bar times still work.
    expect(logsOf(`log(new Date(time[0]).toISOString().slice(0, 4), new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric' }).format(time[0]), last(date.hour('Asia/Seoul')) >= 0)`)[0]).toBe('2026 2026 true');
  });

  it('results come back whole: typed arrays, NaN in a line, a condition per bar', () => {
    const r = runIsolated(head + `plot('half', map((i) => (i % 2 ? NaN : close[i])))\nalert(gt(close, open), 'up')\nscreen('nan', NaN)`, sampleBars(40), {}, 'en');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plots[1]!.values).toBeInstanceOf(Float64Array);
    expect(Number.isNaN(r.plots[1]!.values[1]!)).toBe(true);
    expect(r.alerts[0]!.when).toBeInstanceOf(Uint8Array);
    expect(Number.isNaN(r.screens[0]!.value)).toBe(true);
  });
});

describe('checking a script reads nothing else on disk', () => {
  it('a reference or an import to another file is not followed (its contents never show in a message)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-secret-'));
    const secret = join(dir, 'secret.d.ts').replace(/\\/g, '/');
    writeFileSync(secret, `declare const API_KEY: "sk-very-secret-123";\n`);
    const code = `/// <reference path="${secret}" />\n//@version=2\nindicator({ name: 'x', overlay: true })\nconst n: number = API_KEY\nplot('c', close)`;
    const problems = typeCheck(code) ?? [];
    expect(problems.map((p) => p.message).join(' ')).not.toContain('sk-very-secret');
    const imported = typeCheck(`import { API_KEY } from '${secret.replace(/\.d\.ts$/, '')}'\nconst n: number = API_KEY\n`) ?? [];
    expect(imported.map((p) => p.message).join(' ')).not.toContain('sk-very-secret');
    // The language's own names still check.
    expect(checkScript(`//@version=2\nindicator({ name: 'x', overlay: true })\nplot('e', ta.emaa(close, 5))`, 'en').types?.[0]?.message).toMatch(/ema/);
  });
});
