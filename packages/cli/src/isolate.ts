import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Bars, InputValues, Locale, RequestData, RunResult, SymbolContext } from '@funnest/script';
import { SCRIPT_WORKER_SOURCE } from '@funnest/script/worker';

/**
 * Runs a script the way the app's sandbox does, in Node — away from the machine it runs on (a
 * script is often written by an AI, or copied from someone else):
 *
 * - in a separate Node process (sandbox-child.mjs) under Node's permission model: it can read only
 *   its own file — no other files, no child processes, no threads, no native addons — with no
 *   environment variables (no keys or tokens to find) and killed when time is up;
 * - inside it, in a vm context holding nothing from that process (only text goes in and out).
 *
 * Network access isn't blocked by Node's permission model; the runtime itself has no fetch, and
 * the process has nothing to send.
 */

export const TIMEOUT_MS = 3000;
/** A script that allocates without end stops here, not when the machine runs out. */
const HEAP_MB = 512;
/** Starting a process, beyond the script's own time. */
const START_MS = 3000;

/** The child script: next to this file (built: dist/sandbox-child.js; source: src/sandbox-child.mjs). */
function childPath(): string {
  for (const name of ['./sandbox-child.js', './sandbox-child.mjs']) {
    const p = fileURLToPath(new URL(name, import.meta.url));
    if (existsSync(p)) return p;
  }
  throw new Error('sandbox-child is missing next to isolate');
}

/** Node 22.13+ / 23.5+: --permission; older: the experimental flag; very old: none (process isolation and no env only). */
function permissionFlags(file: string): string[] {
  const flags = process.allowedNodeEnvironmentFlags;
  const flag = flags.has('--permission') ? '--permission' : flags.has('--experimental-permission') ? '--experimental-permission' : null;
  return flag ? [flag, `--allow-fs-read=${file}`] : [];
}

const f64 = (a: Float64Array | undefined) => (a ? { __f64: Array.from(a, (x) => (Number.isFinite(x) ? x : x !== x ? 'NaN' : x > 0 ? 'Inf' : '-Inf')) } : undefined);
const num = (x: unknown) => (x === 'NaN' ? Number.NaN : x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : x);
/** The child's result back as typed arrays and numbers. */
function revive(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.__f64)) return Float64Array.from(o.__f64 as unknown[], (x) => Number(num(x)));
  if (Array.isArray(o.__u8)) return Uint8Array.from(o.__u8 as number[]);
  if ('__num' in o && Object.keys(o).length === 1) return num(o.__num);
  if (Array.isArray(v)) return v.map(revive);
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
}

const failure = (locale: Locale, timeout: boolean, detail: string, timeoutMs: number): RunResult => ({
  ok: false,
  version: 2,
  code: timeout ? 'TIMEOUT' : 'RUNTIME',
  error: timeout
    ? locale === 'ko'
      ? `${Math.round(timeoutMs / 1000)}초 안에 끝나지 않아 멈췄어요. 반복문을 확인해 주세요.`
      : `Stopped: it didn't finish within ${Math.round(timeoutMs / 1000)} s. Check the loops.`
    : detail.slice(0, 400),
  hint: null,
  line: null,
  column: null,
  snippet: null,
  requests: [],
});

/** Where the bars come from (syminfo, timeframe, bar.confirmed). */
export interface RunWhere {
  symbol?: SymbolContext;
  timeframe?: string;
  confirmed?: boolean;
}

export function runIsolated(code: string, bars: Bars, inputs: InputValues = {}, locale: Locale = 'ko', timeoutMs = TIMEOUT_MS, requests?: RequestData, where?: RunWhere): RunResult {
  const file = childPath();
  // Requested data: its arrays tagged like the bars.
  const req = requests ? JSON.parse(JSON.stringify(requests, (_k, v) => (v instanceof Float64Array ? f64(v) : v))) : undefined;
  const job = {
    code,
    inputs: { ...inputs },
    locale,
    bars: { open: f64(bars.open), high: f64(bars.high), low: f64(bars.low), close: f64(bars.close), volume: f64(bars.volume), time: f64(bars.time), turnover: f64(bars.turnover) },
    requests: req,
    where: where ?? null,
  };
  const r = spawnSync(process.execPath, [...permissionFlags(file), `--max-old-space-size=${HEAP_MB}`, file], {
    input: JSON.stringify({ runtime: SCRIPT_WORKER_SOURCE, job, timeoutMs }),
    encoding: 'utf8',
    // Nothing from this environment: no keys, tokens or paths.
    env: {},
    timeout: timeoutMs + START_MS,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || /timed out/i.test(r.stderr ?? '');
  if (r.status !== 0 || !r.stdout) return failure(locale, timedOut, (r.stderr || String(r.error ?? 'the run failed')).split('\n').find((l) => l.trim()) ?? 'the run failed', timeoutMs);
  try {
    const result = revive(JSON.parse(r.stdout));
    // The script ran in there and could have changed what was written out: check it like any input.
    return wellFormed(result, bars.close.length) ? result : failure(locale, false, 'the run gave back a malformed result', timeoutMs);
  } catch {
    return failure(locale, false, 'the run gave back no result', timeoutMs);
  }
}

/**
 * A result as the runtime makes it: the script runs in the same realm as the code that writes the
 * result out, so it could replace JSON.stringify (or anything else) and hand back any shape. What
 * reads the result (summaries, the MCP server) relies on these types and lengths.
 */
export function wellFormed(v: unknown, n: number): v is RunResult {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o.version !== 2 || typeof o.ok !== 'boolean') return false;
  const str = (x: unknown) => typeof x === 'string';
  const num = (x: unknown) => typeof x === 'number';
  const list = (x: unknown, each: (y: Record<string, unknown>) => boolean, max = 10_000) =>
    Array.isArray(x) && x.length <= max && x.every((y) => y !== null && typeof y === 'object' && each(y as Record<string, unknown>));
  const series = (x: unknown) => x instanceof Float64Array && x.length === n;
  const bits = (x: unknown) => x === null || x === undefined || (x instanceof Uint8Array && x.length === n);
  const requests = list(o.requests, (q) => str(q.key) && (q.kind === 'bars' || q.kind === 'data'), 64);
  if (!o.ok) return str(o.code) && str(o.error) && (o.hint === null || str(o.hint)) && (o.line === null || num(o.line)) && requests;
  const meta = o.meta as Record<string, unknown> | null;
  if (!meta || typeof meta !== 'object' || !str(meta.name) || typeof meta.overlay !== 'boolean') return false;
  const strategy = o.strategy as Record<string, unknown> | null;
  const strategyOk =
    strategy === null ||
    (typeof strategy === 'object' && ['longEntry', 'longExit', 'shortEntry', 'shortExit'].every((k) => bits(strategy[k])) && num(strategy.size) && num(strategy.capital) && typeof strategy.reverse === 'boolean');
  return (
    requests &&
    strategyOk &&
    list(o.plots, (p) => str(p.name) && series(p.values), 100) &&
    ['hlines', 'fills', 'shapes', 'backgrounds', 'labels', 'lines', 'boxes', 'tables', 'inputs'].every((k) => list(o[k], () => true, 2_000)) &&
    list(o.alerts, (a) => str(a.message) && a.when instanceof Uint8Array && a.when.length === n, 50) &&
    list(o.screens, (c) => str(c.name) && num(c.value), 50) &&
    list(o.warnings, (w) => str(w.code) && str(w.message), 100) &&
    Array.isArray(o.logs) && o.logs.length <= 100 && o.logs.every(str)
  );
}
