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
