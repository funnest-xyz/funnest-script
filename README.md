# Funnest Script

A small JavaScript language for **trading indicators and strategies**: draw on a chart, backtest,
send alerts, screen markets and paper-trade — the same script everywhere. It is the scripting
language of [Funnest](https://funnest.xyz/trade), open source under Apache-2.0.

```js
//@version=2
indicator({ name: 'EMA cross', overlay: true })
const fast = ta.ema(close, input.int('Fast', 12))
const slow = ta.ema(close, input.int('Slow', 26))
plot('Fast', fast, { color: color.orange })
plot('Slow', slow, { color: color.purple })

strategy({
  long: ta.crossover(fast, slow),
  short: ta.crossunder(fast, slow),
  stopLoss: { long: sub(low, ta.atr(14)), short: add(high, ta.atr(14)) },
  takeProfit: 4,
})
alert(ta.crossover(fast, slow), '{symbol} golden cross at {close}')
```

- **Plain JavaScript**, run once over all bars: series (one value per bar), 40+ `ta.*` indicators,
  drawing (`plot`, `fill`, `plotshape`, `bgcolor`, `label`, `line`, `box`, `table`), inputs.
- **Strategies with honest fills**: signals fill at the next bar's open, stops and targets inside
  the bar (the stop wins a tie), per-side levels, trailing stops, position size, fees.
- **Other timeframes and market data**: `request.bars({ timeframe: '1D' })` with no look-ahead,
  `request.data('funding')`.
- **Alerts and screener columns**: `alert(cond, message)`, `screen(name, value)`.
- **Made for AI**: one spec generates the docs for AI assistants (`llms.txt`), TypeScript
  declarations and a JSON reference, and an eval checks that models write working scripts from it.

## Packages

| Package | What it is |
|---|---|
| [`@funnest/script`](packages/script) | The language: runtime, backtest, live trading rules, docs. No dependencies; browser and Node. |
| [`@funnest/script-cli`](packages/cli) | `npx @funnest/script-cli check / run / backtest` — type-check a script, run it on real exchange bars, backtest it. |
| [`@funnest/script-mcp`](packages/mcp) | An MCP server: Claude, Cursor and other AI tools read the docs, check, run and backtest scripts by themselves. |
| [`skills/funnest-script`](skills/funnest-script) | A skill for AI coding agents: how to write, check and fix Funnest Script. |

## Use it with an AI assistant

| Where | Use | What happens |
|---|---|---|
| A chat (ChatGPT, Claude…) | The app's **Make it with AI** button | Copies the docs and a request; paste the code back and the app checks it |
| AI tools (Claude Code, Cursor…) | MCP server + skill | The AI reads, writes, checks and backtests by itself |
| Terminal | CLI | Check, run on real prices and backtest a file |

- **Chat**: a chat AI can't run code. In the [Funnest](https://funnest.xyz/trade/) script editor,
  **Make it with AI** copies the docs ([`llms.txt`](https://funnest.xyz/scripts/llms.txt)) and a request.
  Paste it into the chat, say what you want, and paste the code you get back into the editor.
  On an error, **Paste the error into an AI** hands over the error and how to fix it.
- **AI tools**: add the MCP server, then ask in plain words:

  ```sh
  claude mcp add funnest-script -- npx -y @funnest/script-mcp
  ```

- **Skill**: not more docs, but how to work: read the docs, write, check, fix, backtest, and the
  mistakes models often make. It loads only for Funnest Script tasks. Use it with the MCP server:
  copy [`skills/funnest-script`](skills/funnest-script) into your agent's skills folder
  (for Claude Code, `~/.claude/skills/`).

More in the [AI · CLI · MCP docs](https://funnest.xyz/en/scripts/docs/ai/).

## Run a script yourself

```sh
npx @funnest/script-cli check my-script.js
npx @funnest/script-cli run my-script.js --symbol BINANCEF:BTCUSDT --tf 60
npx @funnest/script-cli backtest my-script.js --symbol UPBIT:KRW-BTC --tf 1D --bars 1000
```

Market data comes from the exchanges' public APIs (Binance, Upbit, Bybit, OKX); nothing goes
through Funnest.

## In your own app

```ts
import { execute, backtest } from '@funnest/script';

// Columns as Float64Arrays, oldest bar first; time in ms (UTC).
const result = execute(code, { open, high, low, close, volume, time });
// The backtest reads bars as rows: { time, open, high, low, close }[].
if (result.ok && result.strategy) console.log(backtest(rows, result.strategy).totalReturn);
```

`execute` runs synchronously and trusts the code it's given: to run other people's scripts, run it
in a Worker (`@funnest/script/worker` is the runtime as one script string) or an isolated context,
with a time limit.

## Develop

```sh
pnpm install
pnpm test        # every package, from source
pnpm generate    # after changing src/spec.ts or examples/: the docs and the Worker bundle
pnpm eval        # the AI eval (needs the claude CLI): can models write working scripts from llms.txt?
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE). "Funnest" and "Funnest Script" are trademarks of Funnest; see [NOTICE](NOTICE).
