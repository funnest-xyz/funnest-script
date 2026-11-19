import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeCheck, extractCode, unmetExpectations } from '../src/eval';
import { checkScript } from '../src/tools';

const head = "//@version=2\nindicator({ name: 'x', overlay: true })\n";

describe('AI eval', () => {
  it('finds the script in an answer', () => {
    expect(extractCode(`Here:\n\`\`\`js\n${head}plot('c', close)\n\`\`\`\nDone.`)).toBe(`${head}plot('c', close)\n`);
    expect(extractCode(`\`\`\`\nnpm i\n\`\`\`\n\`\`\`javascript\n${head}\`\`\``)).toBe(head);
    expect(extractCode(head)).toBe(head);
    expect(extractCode('Sorry, I cannot.')).toBeNull();
  });

  it('tells the AI what the check found, in Korean', () => {
    const text = describeCheck(checkScript(`${head}const d = close - open\n`, 'ko'));
    expect(text).toMatch(/3번째 줄/);
  });

  it('checks a passing script against what was asked', () => {
    const code = `${head}const f = ta.ema(close, 12)\nplot('f', f)\nstrategy({ entry: ta.crossover(close, f), exit: ta.crossunder(close, f), side: 'short' })\n`;
    const c = checkScript(code);
    expect(unmetExpectations(c, code, { overlay: true, plots: 1, uses: ['ema'] })).toEqual([]);
    expect(unmetExpectations(c, code, { overlay: false, plots: 2, strategy: 'long', histogram: true, uses: ['adx|dmi'] })).toEqual([
      'overlay true, wanted false',
      '1 plots, wanted 2+',
      'no histogram plot',
      'strategy short, wanted long',
      "doesn't use adx|dmi",
    ]);
  });

  it('every task has a unique id, a request and expectations', () => {
    const tasks = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'eval', 'tasks.json'), 'utf8')) as { id: string; ask: string; expect: object }[];
    expect(tasks.length).toBe(39);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    for (const t of tasks) expect(t.ask.length > 5 && Object.keys(t.expect).length > 0).toBe(true);
  });
});
