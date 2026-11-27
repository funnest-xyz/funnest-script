/** Funnest Script v2 — the indicator and strategy language. */
export { execute, isV2, transferables, LIMITS, SHAPES, VERSION_LINE, type Shape, type MarkLocation } from './runtime';
export { symInfoOf, timeframeOf } from './runtime';
export type { AlertOut, HlineOut, InputSpec, InputValues, Meta, PlotOut, RunOptions, RunResult, ScreenOut, Signals, SymbolContext, SymInfo, Warning } from './runtime';
export { atOpen, beyond, guardsAt, hitAt, liquidationPrice, nextBest, nextOrder, orderFill, orderHit, settings as strategySettings, type AtOpen, type EntryOrder, type GuardReason, type Guards, type Held, type OpenClose } from './live';
export { createLib, MAX_PERIOD, type Bars, type LibContext } from './lib';
export { isTimeZone, offsets, periodKeys } from './time';
export { backtest, DEFAULT_BACKTEST, type BacktestBar, type BacktestOptions, type BacktestResult, type ExitReason, type Trade } from './backtest';
export { entryCount, levelFor, normalizeStrategy, sideOf, stepsFor, STRATEGY_LIMITS, type LegacySignals, type Level, type Levels, type Sided, type Step, type Steps, type Strategy } from './strategy';
export { DATA_NAMES, DATA_SOURCES, REQUEST_TIMEFRAMES, SYMBOL_PATTERN, alignBars, barsKey, dataKey, spacingOf, type DataName, type RequestData, type RequestedBars, type RequestSpec, type RequestTimeframe } from './request';
export { Cond, ScriptError, Series, type ErrorCode, type Locale, type Text } from './series';
export { GROUPS, MISTAKES, RULES, SPEC_NAMES, TYPES, type SpecGroup, type SpecItem } from './spec';
export { DTS_TEXT, EXAMPLES, LLMS_TEXT, SHOWCASE } from './generated/llms';
/** Where the AI docs live. */
export const DOCS_URL = 'https://funnest.xyz/scripts/llms.txt';
