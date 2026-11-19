# @funnest/script-mcp

An MCP server for Funnest Script: AI tools (Claude Code, Claude Desktop, Cursor, …) read the docs,
check a draft, run it on real bars, read the result, fix it and backtest — by themselves.

```sh
claude mcp add funnest-script -- npx -y @funnest/script-mcp
```

Other clients: command `npx`, args `["-y", "@funnest/script-mcp"]`.

| Tool | What it does |
|---|---|
| `get_docs` | The language (llms.txt), or one section |
| `list_functions` · `get_function` | Every name in scope; one function's signature, description, example |
| `get_examples` | Example scripts |
| `check_script` | Type-check and test-run (no network): errors with line numbers and how to fix them |
| `run_script` | Run on real bars: each line's last value and range, signals, drawings, alerts |
| `backtest_script` | Backtest a strategy: return vs buy & hold, win rate, drawdown, trades |

Runs on your machine; market data comes from the exchanges' public APIs (fixed hosts only — it
never fetches an address it's given).

Apache-2.0. "Funnest" and "Funnest Script" are trademarks of Funnest (see NOTICE).
