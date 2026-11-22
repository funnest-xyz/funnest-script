# @funnest/script-cli

Funnest Script from the terminal: type-check and test-run a script, run it on real exchange bars,
backtest a strategy, read the docs.

```sh
npx @funnest/script-cli check my-script.js                 # types + a run on sample bars (no network)
npx @funnest/script-cli run my-script.js --symbol BINANCEF:BTCUSDT --tf 60
npx @funnest/script-cli backtest my-script.js --symbol UPBIT:KRW-BTC --tf 1D --bars 1000
npx @funnest/script-cli docs                               # llms.txt, for an AI assistant
npx @funnest/script-cli fn ta.supertrend                   # one function
npx @funnest/script-cli examples cross                     # example scripts
npx @funnest/script-cli open my-script.js                 # a link that opens it in Funnest's editor
```

Options: `--symbol` (BINANCEF · BINANCE · UPBIT · BYBIT · OKX), `--tf` (1 3 5 15 30 60 120 240 1D 1W),
`--bars` (up to 1000), `--input label=value`, `--fee` / `--slippage` (%), `--lang ko|en`, `--json`.

Scripts run in an isolated context with a time limit; market data comes from the exchanges'
public APIs only. Also a library: `checkScript`, `runScript`, `backtestScript`, `fetchBars`.

Apache-2.0. "Funnest" and "Funnest Script" are trademarks of Funnest (see NOTICE).
