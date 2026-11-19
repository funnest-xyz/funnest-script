# Changelog

## 0.1.0 — unreleased

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
