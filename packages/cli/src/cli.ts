import { readFileSync } from 'node:fs';
import { DTS_TEXT, type Locale } from '@funnest/script';
import { isResolution, MARKETS, RESOLUTIONS } from './bars';
import type { Failure, RunSummary } from './summary';
import { backtestScript, checkScript, docs, findExamples, getFunction, listFunctions, openLink, runScript } from './tools';

/**
 * funnest-script — check, run and backtest Funnest Script v2 files from a terminal (and from AI
 * coding tools, which read --json).
 */

const HELP = `funnest-script — Funnest Script v2 from the terminal

Usage:
  funnest-script check <file>                      type-check and test-run on sample bars (no network)
  funnest-script run <file> [options]              run on real bars from the exchange
  funnest-script backtest <file> [options]         run and backtest the strategy
  funnest-script docs [--dts]                      the language for AI assistants (llms.txt) or its types
  funnest-script fn <name>                         one function: signature, description, example
  funnest-script examples [query]                  example scripts
  funnest-script open <file>                       a link that opens the script in Funnest (지표 만들기)

Options:
  --symbol <SYM>     ${MARKETS.join(' | ')} symbols, e.g. BINANCEF:BTCUSDT, UPBIT:KRW-BTC (default BINANCEF:BTCUSDT)
  --tf <res>         ${RESOLUTIONS.join(' ')} (default: the script's timeframe, else 60)
  --bars <n>         how many bars, up to 1000 (default 500; backtest 1000)
  --input <k=v>      an input by its label (repeatable); bool 1/0, select/source by index
  --fee <pct>        backtest fee per fill in % (default 0.05)
  --slippage <pct>   backtest slippage per fill in % (default 0.05)
  --lang <ko|en>     message language (default: the system's)
  --json             machine-readable output
  <file> may be - to read the script from stdin.
`;

interface Args {
  cmd: string;
  rest: string[];
  flags: Record<string, string[]>;
}

function parse(argv: string[]): Args {
  const flags: Record<string, string[]> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const boolean = key === 'json' || key === 'dts' || key === 'help';
      (flags[key] ??= []).push(boolean ? 'true' : (argv[++i] ?? ''));
    } else rest.push(a);
  }
  return { cmd: rest.shift() ?? 'help', rest, flags };
}

const systemLocale = (): Locale => (/^ko/i.test(Intl.DateTimeFormat().resolvedOptions().locale) || /^ko/i.test(process.env.LANG ?? '') ? 'ko' : 'en');

function readCode(file: string | undefined): string {
  if (!file) throw new Error('A script file is required (or - for stdin).');
  return file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
}

function inputs(list: string[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  for (const kv of list) {
    const at = kv.lastIndexOf('=');
    const v = Number(kv.slice(at + 1));
    if (at < 1 || !Number.isFinite(v)) throw new Error(`--input wants label=number, got "${kv}".`);
    out[kv.slice(0, at)] = v;
  }
  return out;
}

function printFailure(f: Failure) {
  console.log(`✗ ${f.code}${f.line ? ` (line ${f.line})` : ''}: ${f.error}`);
  if (f.snippet) console.log(`  ${f.snippet}`);
  if (f.hint) console.log(`  → ${f.hint}`);
}

function printRun(r: RunSummary) {
  console.log(`✓ ${r.name} · ${r.overlay ? 'on the candles' : 'own pane'}${r.timeframe ? ` · made for ${r.timeframe}` : ''} · ${r.bars.count} bars ${r.bars.from} → ${r.bars.to} · last close ${r.bars.lastClose}`);
  for (const p of r.plots) console.log(`  plot ${p.name}${p.offset ? ` (offset ${p.offset})` : ''}: last ${p.last} · range ${p.min} … ${p.max} · empty ${Math.round(p.empty * 100)}%`);
  if (r.hlines.length) console.log(`  hlines ${r.hlines.join(', ')}`);
  const d = r.drawings;
  for (const x of d.fills) console.log(`  fill ${x}`);
  if (d.barColors) console.log(`  barcolor: ${d.barColors} bars`);
  if (d.lines) console.log(`  lines: ${d.lines}`);
  if (d.boxes.length) console.log(`  boxes: ${d.boxes.map((b) => `${b.bottom}…${b.top}${b.text ? ` "${b.text}"` : ''}`).join(', ')}`);
  for (const t of d.tables) console.log(`  table ${t.position}: ${t.rows.map((r) => r.join(' | ')).join(' / ')}`);
  for (const s of d.shapes) console.log(`  plotshape ${s.shape}${s.text ? ` "${s.text}"` : ''}: ${s.bars} bars${s.lastBarsAgo !== null ? ` (latest ${s.lastBarsAgo} bars ago)` : ''}`);
  for (const b of d.backgrounds) console.log(`  bgcolor: ${b.bars} bars`);
  if (d.labels.length) console.log(`  labels: ${d.labels.map((l) => `"${l.text}" ${l.barsAgo} bars ago`).join(', ')}`);
  if (r.strategy) console.log(`  strategy ${r.strategy.side}: ${r.strategy.entries} entries, ${r.strategy.exits} exits${r.strategy.lastEntryBarsAgo !== null ? ` (last entry ${r.strategy.lastEntryBarsAgo} bars ago)` : ''}`);
  for (const i of r.inputs) console.log(`  input ${i.label} (${i.kind}) = ${i.default}${i.options ? ` [${i.options.join(', ')}]` : ''}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  for (const l of r.logs) console.log(`  log ${l}`);
}

export async function main(argv: string[]): Promise<number> {
  const { cmd, rest, flags } = parse(argv);
  const json = !!flags.json;
  const locale: Locale = flags.lang?.[0] === 'en' ? 'en' : flags.lang?.[0] === 'ko' ? 'ko' : systemLocale();
  const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  // No --tf: the script's own timeframe (indicator({ timeframe })), else 60.
  const tf = flags.tf?.[0];
  if (tf !== undefined && !isResolution(tf)) throw new Error(`--tf must be one of ${RESOLUTIONS.join(' ')}.`);
  const common = { symbol: flags.symbol?.[0], resolution: tf, count: flags.bars ? Number(flags.bars[0]) : undefined, inputs: inputs(flags.input), locale };

  switch (cmd) {
    case 'check': {
      const r = checkScript(readCode(rest[0]), locale);
      if (json) out(r);
      else {
        for (const p of r.types ?? []) console.log(`✗ TYPE (line ${p.line}): ${p.message}`);
        if (r.types === null) console.log('· TypeScript not installed: types not checked');
        if (r.run.ok) printRun(r.run);
        else printFailure(r.run);
      }
      return r.ok ? 0 : 1;
    }
    case 'run': {
      const r = await runScript(readCode(rest[0]), common);
      if (json) out(r);
      else {
        console.log(`${r.symbol} · ${r.resolution}`);
        for (const u of r.unavailable ?? []) console.log(`  ! not fetched: ${u}`);
        if (r.result.ok) printRun(r.result);
        else printFailure(r.result);
      }
      return r.result.ok ? 0 : 1;
    }
    case 'backtest': {
      const r = await backtestScript(readCode(rest[0]), { ...common, feePct: flags.fee ? Number(flags.fee[0]) : undefined, slippagePct: flags.slippage ? Number(flags.slippage[0]) : undefined });
      if (json) out(r);
      else {
        console.log(`${r.symbol} · ${r.resolution}`);
        for (const u of r.unavailable ?? []) console.log(`  ! not fetched: ${u}`);
        if (!r.result.ok) printFailure(r.result);
        else if (!r.backtest) console.log('✗ no strategy({ long, longExit, … }) in this script');
        else {
          const b = r.backtest;
          console.log(`✓ ${b.trades} trades · return ${b.totalReturnPct}% (buy & hold ${b.buyHoldPct}%) · win rate ${b.winRatePct ?? '—'}% · max drawdown ${b.maxDrawdownPct}% · profit factor ${b.profitFactor ?? '—'}`);
          console.log(`  avg win ${b.avgWinPct ?? '—'}% · avg loss ${b.avgLossPct ?? '—'}% · payoff ${b.payoff ?? '—'} · losing streak ${b.maxLosingStreak} · exposure ${b.exposurePct}% · final ${b.finalEquity}`);
          console.log(`  long ${b.long.trades} (${b.long.returnPct}%) · short ${b.short.trades} (${b.short.returnPct}%) · exits ${Object.entries(b.exits).map(([k, v]) => `${k} ${v}`).join(', ')}`);
          if (b.leverage > 1) console.log(`  leverage ${b.leverage}x`);
          if (b.monthly.length > 1) console.log(`  monthly ${b.monthly.map((m) => `${m.month} ${m.returnPct}%`).join(' · ')}`);
          for (const t of b.recentTrades) console.log(`  ${t.side} ${t.entry} → ${t.exit} ${t.returnPct}% ${t.reason}${t.partPct < 100 ? ` (${t.partPct}% of it)` : ''}${t.entries > 1 ? ` [${t.entries} entries]` : ''}${t.open ? ' (open)' : ''}`);
        }
      }
      return r.result.ok && r.backtest ? 0 : 1;
    }
    case 'open': {
      const url = openLink(readCode(rest[0]));
      if (json) out({ url });
      else console.log(url);
      return 0;
    }
    case 'docs':
      console.log(flags.dts ? DTS_TEXT : docs());
      return 0;
    case 'fn': {
      const f = getFunction(rest[0] ?? '');
      if (!f) {
        console.log(json ? JSON.stringify(listFunctions(locale)) : `Unknown function. Try: ${listFunctions('en').flatMap((g) => g.names.map((n) => n.name)).join(', ')}`);
        return 1;
      }
      if (json) out(f);
      else console.log(`${f.name} (${f.group})\n  ${f.ts}\n  ${locale === 'ko' ? f.ko : f.en}${f.example ? `\n  e.g. ${f.example}` : ''}`);
      return 0;
    }
    case 'examples': {
      const list = findExamples(rest.join(' '));
      if (json) out(list);
      else if (rest.length && list.length === 1) console.log(list[0]!.code);
      else for (const e of list) console.log(`${e.file}  ${e.code.split('\n')[1]?.replace(/^\/\/\s*/, '') ?? ''}`);
      return list.length ? 0 : 1;
    }
    default:
      console.log(HELP);
      return cmd === 'help' || flags.help ? 0 : 1;
  }
}
