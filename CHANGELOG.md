# Changelog

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
