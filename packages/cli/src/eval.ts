/**
 * funnest-script-eval — how well an AI writes Funnest Script from our docs alone. Each task is a
 * request a user might type; the AI gets the same prompt as the app's "AI로 만들기" (llms.txt + the
 * request), its code is checked like `funnest-script check`, and a failed check goes back to it with
 * the problems (up to --tries times), the way an AI agent with the MCP tools would loop. Counts
 * first-try and eventual successes and which error codes come up: what to improve in the docs.
 *
 * The AI is any command that reads the prompt on stdin and prints the answer (default: Claude Code
 * headless, on the user's own plan — no API key, nothing billed per call here).
 *
 *   node dist/eval.mjs [--cmd "claude -p --model haiku"] [--only ema-cross,rsi-levels] [--tries 3] [--jobs 3]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMS_TEXT } from '@funnest/script';
import type { CheckResult } from './tools';
import { checkScript } from './tools';

interface Expect {
  overlay?: boolean;
  /** At least this many plots / hlines / inputs / log lines. */
  plots?: number;
  hlines?: number;
  inputs?: number;
  logs?: number;
  /** A strategy, on this side ('both': long and short). */
  strategy?: 'long' | 'short' | 'both' | 'any';
  /** strategy() options the code must set (stopLoss, takeProfit, trailingStop, size, fee…). */
  risk?: string[];
  /** At least one histogram plot. */
  histogram?: boolean;
  /** Names the code must call: each entry is one name or alternatives "adx|dmi". */
  uses?: string[];
  /** Drawing: a fill, at least this many plotshape / bgcolor / label, a shifted plot, marks with text (shapes or labels). */
  fill?: boolean;
  shapes?: number;
  backgrounds?: number;
  labels?: number;
  offset?: boolean;
  marksWithText?: number;
  /** At least this many things drawn: plots, plotshapes and labels together ("mark the pivots" may be either). */
  drawn?: number;
  /** At least this many lines / boxes / tables; any barcolor; a plot colored bar by bar. */
  lines?: number;
  boxes?: number;
  tables?: number;
  barColors?: boolean;
  perBarColor?: boolean;
  /** At least this many alert() / screen() columns. */
  alerts?: number;
  screens?: number;
  /** stopLoss given per side ({ long, short }). */
  sidedStop?: boolean;
}
interface Task {
  id: string;
  ask: string;
  expect: Expect;
}
interface Attempt {
  code: string;
  ok: boolean;
  /** Error codes (run) or "TYPE" (type check) or "NO_CODE" (nothing to run in the answer). */
  problems: string[];
  ms: number;
}
interface Outcome {
  id: string;
  attempts: Attempt[];
  /** The check passed on the last attempt. */
  ran: boolean;
  /** …and the script does what was asked (overlay, plots, strategy side…). */
  passed: boolean;
  unmet: string[];
}

/** Run from the repository root (`pnpm eval`): eval/tasks.json in, eval/results/ out. */
const root = process.cwd();
const DEFAULT_CMD = 'claude -p --model haiku --safe-mode --tools "" --no-session-persistence';

function flags(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    cmd: get('cmd') ?? DEFAULT_CMD,
    only: get('only')?.split(',').map((s) => s.trim()).filter(Boolean),
    tries: Math.max(1, Number(get('tries') ?? 3)),
    jobs: Math.max(1, Number(get('jobs') ?? 3)),
    timeoutMs: Math.max(10, Number(get('timeout') ?? 240)) * 1000,
    tasks: get('tasks') ?? join(root, 'eval', 'tasks.json'),
    out: get('out') ?? join(root, 'eval', 'results'),
  };
}

/** Runs the AI command with the prompt on stdin; its stdout is the answer. */
function ask(cmd: string, prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exit ${code}: ${(err || out).trim().slice(0, 300)}`));
    });
    child.stdin.end(prompt, 'utf8');
  });
}

/** The script in an answer: the fenced block that declares the version, else any block, else the whole text if it is code. */
export function extractCode(answer: string): string | null {
  const blocks = [...answer.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)].map((m) => m[1]!.trim());
  const code = blocks.find((b) => b.includes('//@version=2')) ?? blocks[0] ?? (answer.trim().startsWith('//@version') ? answer.trim() : null);
  return code ? `${code}\n` : null;
}

const fence = (code: string) => `\`\`\`js\n${code.trim()}\n\`\`\``;

function firstPrompt(task: Task): string {
  return [LLMS_TEXT, '---', '위 설명서대로 Funnest Script v2 코드를 써 줘. 설명 없이 코드 하나만 줘.', `만들고 싶은 것: ${task.ask}`].join('\n');
}

/** What `funnest-script check` would tell an AI, in the user's language. */
export function describeCheck(c: CheckResult): string {
  const lines: string[] = [];
  for (const p of c.types ?? []) lines.push(`- ${p.line}번째 줄: ${p.message}`);
  if (!c.run.ok) {
    const r = c.run;
    lines.push(`- 실행 오류${r.code ? ` [${r.code}]` : ''}${r.line ? ` (${r.line}번째 줄)` : ''}: ${r.error}`);
    if (r.snippet) lines.push(`  문제 줄: ${r.snippet}`);
    if (r.hint) lines.push(`  고치는 법: ${r.hint}`);
  }
  return lines.join('\n');
}

function retryPrompt(task: Task, code: string | null, problems: string): string {
  return [
    LLMS_TEXT,
    '---',
    `만들고 싶은 것: ${task.ask}`,
    '',
    code ? `이전에 쓴 코드:\n${fence(code)}` : '이전 답에 코드 블록이 없었어.',
    '',
    `검사 결과:\n${problems}`,
    '',
    '고친 전체 코드만 줘.',
  ].join('\n');
}

/** Whether a passing script does what the task asked. */
export function unmetExpectations(c: CheckResult, code: string, e: Expect): string[] {
  if (!c.run.ok) return ['run failed'];
  const r = c.run, out: string[] = [];
  if (e.overlay !== undefined && r.overlay !== e.overlay) out.push(`overlay ${r.overlay}, wanted ${e.overlay}`);
  if (e.plots && r.plots.length < e.plots) out.push(`${r.plots.length} plots, wanted ${e.plots}+`);
  if (e.hlines && r.hlines.length < e.hlines) out.push(`${r.hlines.length} hlines, wanted ${e.hlines}+`);
  if (e.inputs && r.inputs.length < e.inputs) out.push(`${r.inputs.length} inputs, wanted ${e.inputs}+`);
  if (e.logs && r.logs.length < e.logs) out.push(`${r.logs.length} logs, wanted ${e.logs}+`);
  if (e.histogram && !r.plots.some((p) => p.style === 'histogram')) out.push('no histogram plot');
  if (e.strategy === 'any' ? !r.strategy : e.strategy && r.strategy?.side !== e.strategy) out.push(`strategy ${r.strategy?.side ?? 'none'}, wanted ${e.strategy}`);
  const d = r.drawings;
  if (e.fill && !d.fills.length) out.push('no fill');
  if (e.shapes && d.shapes.length < e.shapes) out.push(`${d.shapes.length} plotshape, wanted ${e.shapes}+`);
  if (e.backgrounds && d.backgrounds.length < e.backgrounds) out.push(`${d.backgrounds.length} bgcolor, wanted ${e.backgrounds}+`);
  if (e.labels && !/\blabel\s*\(/.test(code)) out.push('no label');
  if (e.offset && !r.plots.some((p) => p.offset !== 0)) out.push('no shifted plot');
  if (e.marksWithText && d.shapes.filter((x) => x.text).length + new Set(d.labels.map((l) => l.text)).size < e.marksWithText) out.push('marks without text');
  if (e.drawn && r.plots.length + d.shapes.length + d.labels.length < e.drawn) out.push(`${r.plots.length + d.shapes.length + d.labels.length} things drawn, wanted ${e.drawn}+`);
  if (e.lines && d.lines < e.lines) out.push(`${d.lines} lines, wanted ${e.lines}+`);
  if (e.boxes && d.boxes.length < e.boxes) out.push(`${d.boxes.length} boxes, wanted ${e.boxes}+`);
  if (e.tables && d.tables.length < e.tables) out.push(`${d.tables.length} tables, wanted ${e.tables}+`);
  if (e.barColors && !d.barColors) out.push('no candle colors');
  if (e.perBarColor && !/color\s*:\s*\(?\s*i\s*\)?\s*=>/.test(code)) out.push('no per-bar plot color');
  if (e.sidedStop && !r.strategy?.stopLoss?.startsWith('long ')) out.push(`stopLoss ${r.strategy?.stopLoss ?? 'none'}, wanted one per side`);
  if (e.alerts && r.alerts.length < e.alerts) out.push(`${r.alerts.length} alerts, wanted ${e.alerts}+`);
  if (e.screens && r.screens.length < e.screens) out.push(`${r.screens.length} screen columns, wanted ${e.screens}+`);
  for (const opt of e.risk ?? []) if (!new RegExp(`\\b${opt}\\s*:`).test(code)) out.push(`strategy without ${opt}`);
  for (const names of e.uses ?? []) if (!new RegExp(`\\b(${names})\\b`).test(code)) out.push(`doesn't use ${names}`);
  return out;
}

async function runTask(task: Task, o: ReturnType<typeof flags>): Promise<Outcome> {
  const attempts: Attempt[] = [];
  let prompt = firstPrompt(task);
  for (let i = 0; i < o.tries; i++) {
    const t0 = Date.now();
    let answer: string;
    try {
      answer = await ask(o.cmd, prompt, o.timeoutMs);
    } catch (e) {
      attempts.push({ code: '', ok: false, problems: [`AI_ERROR: ${(e as Error).message}`], ms: Date.now() - t0 });
      break;
    }
    const code = extractCode(answer);
    if (!code) {
      attempts.push({ code: answer, ok: false, problems: ['NO_CODE'], ms: Date.now() - t0 });
      prompt = retryPrompt(task, null, '- 코드 블록(```js … ```)이 없어. 코드만 줘.');
      continue;
    }
    const c = checkScript(code, 'ko');
    const problems = [...(c.types?.length ? ['TYPE'] : []), ...(!c.run.ok ? [c.run.code ?? 'RUNTIME'] : [])];
    attempts.push({ code, ok: c.ok, problems, ms: Date.now() - t0 });
    if (c.ok) {
      const unmet = unmetExpectations(c, code, task.expect);
      return { id: task.id, attempts, ran: true, passed: !unmet.length, unmet };
    }
    prompt = retryPrompt(task, code, describeCheck(c));
  }
  return { id: task.id, attempts, ran: false, passed: false, unmet: [] };
}

/** Runs `fn` over `items`, `jobs` at a time, keeping their order. */
async function pool<T, R>(items: T[], jobs: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function main(argv: string[]): Promise<number> {
  const o = flags(argv);
  const all = JSON.parse(readFileSync(o.tasks, 'utf8')) as Task[];
  const tasks = o.only ? all.filter((t) => o.only!.includes(t.id)) : all;
  if (!tasks.length) {
    console.error(`No tasks${o.only ? ` named ${o.only.join(', ')}` : ''}.`);
    return 2;
  }
  console.log(`${tasks.length} tasks · up to ${o.tries} tries · ${o.jobs} at a time · ${o.cmd}\n`);
  const started = Date.now();
  const outcomes = await pool(tasks, o.jobs, async (t) => {
    const r = await runTask(t, o);
    const mark = r.passed ? 'PASS' : r.ran ? 'WRONG' : 'FAIL';
    const trail = r.attempts.map((a) => (a.ok ? 'ok' : a.problems.join('+'))).join(' → ');
    console.log(`${mark.padEnd(5)} ${t.id.padEnd(14)} ${trail}${r.unmet.length ? `  (${r.unmet.join('; ')})` : ''}`);
    return r;
  });

  const n = outcomes.length;
  const firstTry = outcomes.filter((r) => r.passed && r.attempts.length === 1).length;
  const passed = outcomes.filter((r) => r.passed).length;
  const ranFirst = outcomes.filter((r) => r.attempts[0]?.ok).length;
  const codes: Record<string, number> = {};
  for (const r of outcomes) for (const a of r.attempts) for (const p of a.problems) codes[p.split(':')[0]!] = (codes[p.split(':')[0]!] ?? 0) + 1;
  const pct = (k: number) => `${Math.round((k / n) * 100)}%`;
  const summary = {
    tasks: n,
    firstTryRuns: ranFirst,
    firstTryPasses: firstTry,
    passesWithinTries: passed,
    problems: codes,
    minutes: Number(((Date.now() - started) / 60000).toFixed(1)),
  };
  console.log(`\n첫 시도에 실행됨 ${ranFirst}/${n} (${pct(ranFirst)}) · 첫 시도에 요청대로 ${firstTry}/${n} (${pct(firstTry)}) · ${o.tries}번 안에 ${passed}/${n} (${pct(passed)})`);
  if (Object.keys(codes).length) console.log(`나온 문제: ${Object.entries(codes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  mkdirSync(o.out, { recursive: true });
  const file = join(o.out, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  writeFileSync(file, JSON.stringify({ cmd: o.cmd, tries: o.tries, summary, outcomes }, null, 2));
  console.log(`기록: ${file}`);
  return passed === n ? 0 : 1;
}
