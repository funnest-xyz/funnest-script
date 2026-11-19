/**
 * Series: one number per bar, oldest bar first (index 0), as long as the chart. Arithmetic and
 * comparisons on a whole Series are refused loudly — `close - open` would silently be NaN in
 * JavaScript, the most common mistake (people and AI alike write it the way other chart languages
 * allow). The error says what to write instead.
 */

export type Locale = 'ko' | 'en';

export type ErrorCode =
  | 'SERIES_ARITHMETIC'
  | 'CONDITION_IN_IF'
  | 'MISSING_DECLARATION'
  | 'DECLARATION_TWICE'
  | 'BAD_ARG'
  | 'UNKNOWN_NAME'
  | 'FORBIDDEN'
  | 'LIMIT'
  | 'SYNTAX'
  | 'TIMEOUT'
  | 'RUNTIME';

/** A message in both languages; the runtime picks one. */
export interface Text {
  ko: string;
  en: string;
}

/** A mistake in a script, with how to fix it. */
export class ScriptError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly text: Text,
    readonly hint?: Text,
  ) {
    super(text.en);
  }
}

const ARITHMETIC: [Text, Text] = [
  {
    ko: '시리즈(봉마다 값이 있는 배열)끼리 바로 계산하거나 비교할 수 없어요.',
    en: 'Series (one value per bar) can’t be used directly in arithmetic or comparisons.',
  },
  {
    ko: 'sub(close, open), gt(close, open) 같은 계산 함수나 map(i => close[i] - open[i])를 쓰세요. 마지막 값만 필요하면 last(close)를 쓰세요.',
    en: 'Use sub(close, open), gt(close, open) or map(i => close[i] - open[i]). For the latest value only, use last(close).',
  },
];

function refuse(hint: string): string {
  // Template strings and log() turn a Series into text: allowed, short.
  if (hint === 'string') return '';
  throw new ScriptError('SERIES_ARITHMETIC', ARITHMETIC[0], ARITHMETIC[1]);
}

/** Numbers per bar (NaN = no value on that bar). */
export class Series extends Float64Array {
  [Symbol.toPrimitive](hint: string): string {
    return refuse(hint) || `[Series ${this.length}]`;
  }
}

/** True / false per bar, as 1 / 0. */
export class Cond extends Uint8Array {
  [Symbol.toPrimitive](hint: string): string {
    return refuse(hint) || `[Condition ${this.length}]`;
  }
}

export const isSeries = (v: unknown): v is Series | Cond | Float64Array | Uint8Array =>
  v instanceof Float64Array || v instanceof Uint8Array;

/** A Series of `n` NaNs. */
export const empty = (n: number) => new Series(n).fill(Number.NaN);
