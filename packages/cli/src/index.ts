/** Funnest Script tools for Node: check (types + a sample run), run and backtest on real exchange bars, docs and examples. */
export { backtestScript, checkScript, docs, findExamples, getFunction, listFunctions, runScript, sampleBars, type CheckResult } from './tools';
export { fetchBars, isResolution, MARKETS, RESOLUTIONS, type FetchedBars, type Resolution } from './bars';
export { fulfil } from './data';
export { runIsolated } from './isolate';
export { backtestSummary, summarize, type BacktestSummary, type Failure, type RunSummary } from './summary';
export { typeCheck, type TypeProblem } from './typecheck';
export { main } from './cli';
