// One script run, in a process of its own (isolate.ts starts it): Node's permission model allows
// it to read only this file — no other files, no child processes, no threads, no addons — and it
// gets no environment variables. Inside, the runtime and the script run in a vm context that holds
// nothing from this process: the job comes in as text and the result goes out as text, so there is
// no object to climb out through (`x.constructor.constructor('return process')`). Promise
// callbacks count toward the time limit too.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const { runtime, job, timeoutMs } = JSON.parse(readFileSync(0, 'utf8'));

// A global with no prototype from this side, and no timers, process or require on it.
const ctx = createContext(Object.create(null), { codeGeneration: { strings: true, wasm: false }, microtaskMode: 'afterEvaluate' });
const started = Date.now();
runInContext(runtime, ctx, { filename: 'funnest-script-runtime.js', timeout: timeoutMs });
const left = Math.max(1, timeoutMs - (Date.now() - started));

// Built and parsed inside: typed arrays travel as tagged lists ({ __f64 } / { __u8 }), NaN and ±∞ by name.
const program = `(() => {
  const j = JSON.parse(${JSON.stringify(JSON.stringify(job))});
  const num = (x) => (x === 'NaN' ? NaN : x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : x);
  const revive = (v) => {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v.__f64)) return Float64Array.from(v.__f64, num);
    if (Array.isArray(v)) return v.map(revive);
    const o = {};
    for (const k of Object.keys(v)) o[k] = revive(v[k]);
    return o;
  };
  const b = revive(j.bars);
  const r = __funnestScript.execute(j.code, b, j.inputs, { locale: j.locale, requests: j.requests ? revive(j.requests) : undefined });
  const tag = (x) => (Number.isFinite(x) ? x : x !== x ? 'NaN' : x > 0 ? 'Inf' : '-Inf');
  return JSON.stringify(r, (k, v) =>
    v instanceof Float64Array ? { __f64: Array.from(v, tag) } : v instanceof Uint8Array ? { __u8: Array.from(v) } : typeof v === 'number' && !Number.isFinite(v) ? { __num: tag(v) } : v,
  );
})()`;
process.stdout.write(String(runInContext(program, ctx, { filename: 'funnest-script-job.js', timeout: left })));
