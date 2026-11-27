# Changelog

## 0.2.0

- **32 more `ta.*` indicators**: `vwap` / `vwapbands` (starting over each day, week, month, year in
  the market's time zone, or at a condition), `sar`, `kc` / `kcw` / `bbw`, `wpr`, `cmo`, `tsi`,
  `cog`, `rci`, `swma`, `median`, `mode`, `percentile`, `percentrank`, `range`, `dev`, `variance`,
  `correlation`, `highestbars` / `lowestbars` (bars back, positive), `max` / `min` (so far),
  `accdist`, `pvt`, `nvi`, `pvi`, `wad`, `wvad`, `iii`, `pivots` (traditional, fibonacci, woodie,
  classic, camarilla) and `ichimoku`. Window statistics stay fast on long windows (a sorted window).
- **Market, interval, time**: `syminfo` (symbol, exchange, spot / perp / stock, currency, price step,
  time zone), `timeframe`, `bar.index` / `bar.last` / `bar.confirmed`, and `date.hour`, `minute`,
  `dayofweek`, `day`, `month`, `year`, `isNew`, `session` — in the market's zone (crypto UTC) unless
  one is given. Hosts pass them as `RunOptions.symbol`, `timeframe`, `confirmed`.
- **Inputs**: `input.timeframe`, `input.symbol`, `input.time`.
- **Strategies**: take profit in parts (`takeProfit: [{ at: 2, close: 50 }, { at: 5 }]`),
  `breakEven`, `exitAfter` (a time exit), entry orders at a price (`entryPrice`, `entryBars`: a limit
  below the signal bar's close for a long, a breakout stop above it), `pyramiding`, `leverage` (with
  liquidation; fees on the leveraged value), `amount` / `qty` instead of `size`. The live rules
  (`live.ts`) follow them too and are tested to trade like the backtest.
- **Backtest results**: monthly returns (`monthly`, in `BacktestOptions.timezone`), each exit's share
  of the position (`part`) and the entries in it (`entries`), `leverage`; new exit reasons `time` and
  `liquidation`. Short exits now pay the fee on the value at the exit (was: on what was left).
- **Security (the realm a script runs in)**: typed arrays and buffers now count against a limit
  (256 MB at once, 2 GB a run) — they live outside the JavaScript heap limit, so a script could
  take the machine's memory; WebAssembly, SharedArrayBuffer and Atomics are removed. For v2
  scripts the realm's clock and randomness are refused too (`globalThis.Math.random()`,
  `new (new Date(0).constructor)()`, `Intl…format()` with no date, `performance`, `crypto`), not
  only the names in the script's scope. Installed by the bundled runtime (`./worker`) only.
- **CLI · MCP**: runs tell the script its market and interval; backtest summaries add monthly
  returns, leverage and partial exits.
- Examples `15-scale-out.js` and `16-session-vwap.js`.

## 0.1.3

- **Showcase**: the long example is now `showcase/ma-bundle-sr.js` ("이평선 묶음 + 지지 · 저항"),
  written from scratch for Funnest: moving averages of the usual lengths (5 · 10 · 20 · 60 · 120 · 240,
  any kind or list), bullish / bearish alignment, golden and dead crosses with alerts, support and
  resistance zones where price turned several times, and a summary table. It replaces
  `showcase/ma12-sr.js`, a port of a TradingView community script whose author and license we
  couldn't confirm; please don't use that file from earlier versions.

## 0.1.2

- **Open in Funnest**: `funnest-script open <file>` (CLI) and `open_in_funnest` (MCP) give a link
  that opens the script in Funnest's editor, unsaved. The code rides in the link's `#` part
  (deflate + base64url): nothing is uploaded or stored.
- **CLI · MCP**: `run` and `backtest` use the script's own `timeframe` when `--tf` / `timeframe` isn't given
  (else 60, as before); `check` and `run` say what it's made for (`made for 240`, `timeframe` in JSON).

## 0.1.1

- **`indicator({ timeframe })`**: a script can name the interval it is tuned for (`'60'` = 1 hour, one of
  `REQUEST_TIMEFRAMES`). It shows in `meta.timeframe` (null when left out); apps pick it first and
  run the standard backtest on it. Other intervals still run. An unknown interval is a `BAD_ARG`.

## 0.1.0

First open-source release of the language Funnest runs.

- **Language**: series and conditions, 40+ `ta.*` indicators, inputs (`int`, `number`, `bool`,
  `select`, `text`, `source`, `color`, with groups and tooltips), drawing (`plot` in 7 styles,
  `hline`, `fill`, `plotshape`, `bgcolor`, `barcolor`, `label`, `line`, `box`, `table`).
- **Strategies**: long / short entries and exits, stop loss and take profit (% or a price per
  bar, or per side with `{ long, short }`), trailing stop, position size, fees and slippage. Fills
  at the next bar's open; stops and targets inside the bar.
- **Live rules** (`atOpen`, `guardsAt`, `hitAt`, `nextBest`): the backtest's rules one bar or price
  at a time, tested to trade exactly like the backtest.
- **Data**: `request.bars` (other timeframes and markets, no look-ahead, `.compute()`),
  `request.data` (funding, open interest, long/short ratio, kimchi premium, CVD, …).
- **Alerts and screener**: `alert(cond, message)`, `screen(name, value)`.
- **Docs for AI**: `llms.txt`, TypeScript declarations and a JSON reference generated from one spec.
- **CLI** (`@funnest/script-cli`): check, run on real bars (Binance, Upbit, Bybit, OKX), backtest.
- **MCP server** (`@funnest/script-mcp`) and a **skill** for AI coding agents.
