---
name: funnest-script
description: Write, check and fix Funnest Script v2 — the JavaScript language for trading indicators, strategies, alerts and screeners on Funnest (@funnest/script). Use when asked for a trading indicator or strategy script for Funnest, to port a TradingView Pine Script, to backtest an idea on real exchange bars, or to fix a script that fails.
---

# Funnest Script v2

A script is plain JavaScript that runs **once over all bars** of a chart. Names like `close`,
`ta.ema`, `plot`, `strategy` are in scope. Full reference: `npx @funnest/script-cli docs` or the
MCP tool `get_docs` (the same text as https://funnest.xyz/scripts/llms.txt). Read it before the
first script of a session; look one name up with `get_function` / `npx @funnest/script-cli fn <name>`.

## Workflow

1. **Write** the script (template below).
2. **Check** it — `check_script` (MCP) or `npx @funnest/script-cli check file.js`: types against the
   language's declarations plus a run on sample bars. Errors come with a line, a code and a hint:
   apply the hint literally, then check again. Repeat until it passes.
3. **Run on real bars** — `run_script` / `npx @funnest/script-cli run file.js --symbol BINANCEF:BTCUSDT --tf 60`.
   Read the numbers: each plot's last value and range, how often signals fire, alerts, screener
   values. A line that is all empty, or an entry that fires on half the bars, is a bug.
4. **Backtest** strategies — `backtest_script` / `npx @funnest/script-cli backtest file.js --symbol UPBIT:KRW-BTC --tf 1D --bars 1000`.
   Report return vs buy & hold, max drawdown, trades and win rate honestly; don't tune inputs to
   one stretch of history and call it an edge.
5. **Reply with the code** (one script). The user pastes it into Funnest → 지표 만들기.

Symbols: `BINANCEF:BTCUSDT` (Binance futures), `BINANCE:BTCUSDT`, `UPBIT:KRW-BTC`, `BYBIT:BTCUSDT`,
`OKX:BTC-USDT-SWAP`. Timeframes: `1 3 5 15 30 60 120 240 1D 1W`.

## Template

```js
//@version=2
indicator({ name: 'My indicator', overlay: true })   // overlay: true = on the candles, false = own pane
const len = input.int('Length', 20, { min: 2 })
const ma = ta.ema(close, len)
plot('EMA', ma, { color: color.orange })
```

## Rules models get wrong

| Wrong | Right |
|---|---|
| `close - open`, `close > open` (whole series) | `sub(close, open)`, `gt(close, open)` — or `map((i) => close[i] - open[i])` |
| `if (ta.crossover(a, b)) …` (always true) | pass the condition: `strategy({ long: ta.crossover(a, b) })`, `plotshape(cond)`, or `cond[i]` inside `map` |
| `close[i + 1]` | never look ahead: only `i` and earlier |
| `Date.now()`, `new Date()`, `Math.random()`, `fetch` | not available (same chart, same result). A bar's time is `time[i]` (ms, UTC) |
| RSI / stochastic with `overlay: true` | `indicator({ overlay: false, range: [0, 100] })` |
| `ta.lowest(x, n)` inside `map` | compute it once outside, read `[i]` inside (inside `map` it recomputes every bar) |
| One price-series stop for a long/short strategy | `stopLoss: { long: sub(low, atr), short: add(high, atr) }` — one series would sit on the same side for both |

- Line 1 is `//@version=2`; then `indicator({...})` once. No `import`, `export`, `async`.
- Series: one value per bar, index 0 the oldest, `last(x)` the newest. Missing values are `NaN`
  (`nz(x)` → 0).
- `map((i) => …)` runs oldest bar first; variables outside it carry state from bar to bar
  (Pine's `var`).

## Strategies

```js
strategy({
  long: ta.crossover(fast, slow), longExit: ta.crossunder(fast, slow),
  short: ta.crossunder(fast, slow), shortExit: ta.crossover(fast, slow),
  stopLoss: 2,                         // % from the entry, a price series, or { long, short }
  takeProfit: { long: 4, short: 3 },   // a side left out has none
  trailingStop: 3,                     // % back from the best price
  size: 50,                            // % of the account per trade (default 100)
})
```

How it trades (backtest and paper auto-trading alike): a signal on a bar's close fills at the
**next bar's open**; one position at a time; an entry the other way turns it (`reverse: false` to
not); stops and targets are checked inside every bar, the stop wins a bar that touches both; a
price-series level uses the bar before's value; fee and slippage on every fill.

## Alerts, screener, other data

- `alert(cond, '{symbol} … {close} {time}')`: rings when `cond` is true on a bar that just closed
  (the user turns it on in 지표 만들기 › 자동 실행).
- `screen('RSI', ta.rsi(close, 14))`: a screener column (the last bar's value).
- `request.bars({ timeframe: '1D' })` (or `{ symbol }`): another timeframe / market lined up with
  the chart, no look-ahead; `.compute((b) => b.ta.ema(b.close, 20))` calculates on those bars
  (Pine's `request.security(…, ta.ema(close, 20))`).
- `request.data('funding' | 'openInterest' | 'longShortRatio' | 'kimchiPremium' | 'cvd' | 'fearGreed' | …)`.
  Requested data is `NaN` until it arrives; write code that tolerates that.

## Porting Pine Script

| Pine | Funnest Script |
|---|---|
| `ta.ema(close, 20)`, `ta.rsi`, `ta.atr`, `ta.supertrend` … | the same names under `ta.` |
| `a - b`, `a > b` on series | `sub(a, b)`, `gt(a, b)`, or `map` |
| `var x = 0` / bar-by-bar logic | a `let` outside `map((i) => …)` |
| `plot`, `hline`, `fill`, `plotshape`, `bgcolor`, `barcolor`, `label.new`, `line.new`, `box.new`, `table.new` | `plot`, `hline`, `fill`, `plotshape`, `bgcolor`, `barcolor`, `label`, `line`, `box`, `table` |
| `input.int/float/bool/string/source/color` | `input.int/number/bool/select/text/source/color` |
| `strategy.entry/exit/close`, `strategy.exit(stop=, limit=, trail_percent=)` | one `strategy({ long, longExit, short, shortExit, stopLoss, takeProfit, trailingStop })` |
| `request.security(sym, tf, expr)` | `request.bars({ symbol, timeframe }).compute((b) => …)` |
| `alertcondition(cond, title, msg)` | `alert(cond, msg)` |

Not available yet: pyramiding (several entries), limit-order entries, partial exits.
