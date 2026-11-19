/**
 * The runtime as the sandbox Worker loads it: bundled into one string (scripts/build-worker.mjs →
 * src/generated/worker.ts) and set on the Worker's global for its message handler.
 *
 * In the Worker a script is loaded as a script of its own (a blob, through importScripts) rather
 * than with `new Function`: Safari reports no line for code made by `new Function`, so errors
 * there would have no "line 4". The Worker's own source hands importScripts over as
 * `__funnestLoad` before removing it from the global; it's taken here and removed too, so scripts
 * never see it. Elsewhere (Node, tests) there is none and `new Function` is used.
 */
import { execute, isV2, transferables, type Compile, type RunOptions } from './runtime';
import type { Bars } from './lib';

type Global = { __funnestScript?: unknown; __funnestLoad?: (url: string) => void; __funnestFn?: (...args: unknown[]) => unknown };
const g = globalThis as unknown as Global;
const load = typeof g.__funnestLoad === 'function' ? g.__funnestLoad : null;
try {
  delete g.__funnestLoad;
} catch {
  g.__funnestLoad = undefined;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compileAsScript: Compile | undefined =
  load && typeof Blob === 'function' && typeof URL?.createObjectURL === 'function'
    ? (names, body) => {
        // Line 1 is the function's head, so the script's line k is the blob's line k + 1 + 1 ("use strict").
        const url = URL.createObjectURL(new Blob([`self.__funnestFn = function (${names.join(', ')}) {\n${body}\n};\n`], { type: 'text/javascript' }));
        try {
          load(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const fn = g.__funnestFn;
        delete g.__funnestFn;
        if (typeof fn !== 'function') throw new Error('not loaded');
        return { fn, frame: new RegExp(`${escape(url)}:(\\d+):(\\d+)`), offset: 2 };
      }
    : undefined;

g.__funnestScript = {
  execute: (code: string, bars: Bars, inputs?: Record<string, number>, options: RunOptions = {}) => execute(code, bars, inputs, { ...options, compile: compileAsScript }),
  isV2,
  transferables,
};
