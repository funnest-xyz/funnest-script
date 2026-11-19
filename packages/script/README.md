# @funnest/script

The Funnest Script v2 language: a small JavaScript language for trading indicators and strategies.
Runtime, backtest, the live trading rules (the same ones, bar by bar) and machine-readable docs.
No dependencies; runs in browsers and Node.

```sh
npm i @funnest/script
```

```ts
import { execute, backtest } from '@funnest/script';

const r = execute(code, { open, high, low, close, volume, time }); // Float64Arrays, oldest first
if (!r.ok) console.log(r.error, 'line', r.line, r.hint);
else {
  r.plots;      // lines to draw
  r.alerts;     // alert(): the bars each would ring on
  r.screens;    // screen(): screener columns
  if (r.strategy) backtest(rows, r.strategy); // rows: { time, open, high, low, close }[]
}
```

- `execute` trusts the code it runs. For other people's scripts use a Worker or an isolated
  context with a time limit: `@funnest/script/worker` exports the runtime as one script string.
- `atOpen`, `guardsAt`, `hitAt`, `nextBest`: the backtest's rules one bar or one price at a
  time, for paper or live trading that acts exactly like the backtest.
- Docs: `@funnest/script/docs/llms.txt` (for AI assistants), `funnest-script.d.ts` (types),
  `reference.json`; also at https://funnest.xyz/scripts/llms.txt.

Apache-2.0. "Funnest" and "Funnest Script" are trademarks of Funnest (see NOTICE).
