import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Bars } from '../src/lib';
import { execute, type RequestedBars } from '../src/runtime';
import { entryCount } from '../src/strategy';
import { GROUPS, SPEC_NAMES } from '../src/spec';

/** 500 hourly bars of a deterministic random walk (with trends both ways). */
function walk(n = 500): Bars {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const close: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= 1 + rnd() * 0.03 + Math.sin(i / 40) * 0.004;
    close.push(p);
  }
  const f = (xs: number[]) => Float64Array.from(xs);
  return {
    open: f(close.map((c, i) => (i ? close[i - 1]! : c))),
    high: f(close.map((c, i) => Math.max(c, i ? close[i - 1]! : c) * 1.004)),
    low: f(close.map((c, i) => Math.min(c, i ? close[i - 1]! : c) * 0.996)),
    close: f(close),
    volume: f(close.map((_, i) => 1000 + ((i * 37) % 500))),
    time: f(close.map((_, i) => Date.UTC(2026, 0, 1) + i * 3_600_000)),
  };
}
const bars = walk();
const head = "//@version=2\nindicator({ name: 'spec', overlay: false })\n";

describe('the spec is exactly what scripts get', () => {
  it('every documented name exists in a script', () => {
    const missing: string[] = [];
    for (const name of SPEC_NAMES) {
      const r = execute(`${head}log(typeof ${name})\n`, bars);
      if (!r.ok || r.logs[0] === 'undefined') missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it('ta.*, input.* and the series helpers have nothing undocumented', () => {
    const r = execute(`${head}log(JSON.stringify(Object.keys(ta)))\nlog(JSON.stringify(Object.keys(input)))\n`, bars);
    if (!r.ok) throw new Error(r.error);
    const documented = (prefix: string) => SPEC_NAMES.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)).sort();
    expect((JSON.parse(r.logs[0]!) as string[]).sort()).toEqual(documented('ta.'));
    expect((JSON.parse(r.logs[1]!) as string[]).sort()).toEqual(documented('input.'));
  });

  it('every spec example line runs in a script', () => {
    for (const g of GROUPS)
      for (const item of g.items) {
        if (!item.example || item.name === 'indicator') continue;
        const setup = 'const fast = ta.ema(close, 5), slow = ta.ema(close, 20), bb = ta.bb(close, 20, 2), rsi = ta.rsi(close, 14)\n';
        const line = /^(const|let|plot|hline|strategy|indicator|fill|plotshape|bgcolor|label)\b/.test(item.example) ? item.example : `log(typeof (${item.example}))`;
        const r = execute(`${head}${setup}${line}\n`, bars);
        expect(r.ok ? 'ok' : `${r.code} ${r.error}`, `${item.name}: ${item.example}`).toBe('ok');
      }
  });
});

describe('examples', () => {
  const dir = join(__dirname, '..', 'examples');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    it(`${file} runs cleanly`, () => {
      const code = readFileSync(join(dir, file), 'utf8');
      // Scripts that ask for data get some (the test's own bars as every timeframe, a small constant for market data).
      const first = execute(code, bars);
      const asked = first.requests.filter((q) => q.missing);
      const stand: RequestedBars = { time: bars.time, open: bars.open, high: bars.high, low: bars.low, close: bars.close, volume: bars.volume, resolutionMs: 3_600_000 };
      const r = asked.length
        ? execute(code, bars, {}, { requests: { bars: Object.fromEntries(asked.filter((q) => q.kind === 'bars').map((q) => [q.key, stand])), data: Object.fromEntries(asked.filter((q) => q.kind === 'data').map((q) => [q.key, new Float64Array(bars.close.length).fill(0.01)])) } })
        : first;
      if (!r.ok) throw new Error(`${r.code} line ${r.line}: ${r.error}`);
      expect(r.warnings, file).toEqual([]);
      expect(r.plots.length, file).toBeGreaterThan(0);
      for (const p of r.plots) expect(p.values.some(Number.isFinite), `${file} ${p.name}`).toBe(true);
      if (r.strategy) expect(entryCount(r.strategy), file).toBeGreaterThan(0);
    });
  }
});

describe('types', () => {
  // The declarations AI tools and the editor get, checked against every example (one file at a time).
  const tsc = join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc');
  const dts = join(__dirname, '..', 'docs', 'funnest-script.d.ts');
  const dir = join(__dirname, '..', 'examples');
  it('every example type-checks against funnest-script.d.ts', () => {
    const failures: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      try {
        execFileSync(process.execPath, [tsc, '--noEmit', '--allowJs', '--checkJs', '--strict', '--noImplicitAny', 'false', '--moduleDetection', 'force', '--lib', 'es2022', dts, join(dir, file)], { stdio: 'pipe' });
      } catch (e) {
        failures.push(String((e as { stdout?: Buffer }).stdout ?? e));
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
