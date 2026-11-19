# Contributing

Thanks for helping. Issues and pull requests are welcome — for a new function or a change to how
strategies trade, open an issue first so we can agree on the shape.

## Setup

```sh
pnpm install
pnpm test        # every package, from its TypeScript source (no build needed)
pnpm typecheck
```

## How the code fits together

- `packages/script/src/spec.ts` is **the one description of the language**: every name a script can
  use, its TypeScript signature, what it does (Korean and English) and an example. The docs for AI
  (`docs/llms.txt`), the declarations (`docs/funnest-script.d.ts`) and `docs/reference.json` are
  generated from it. A name in the spec that the runtime lacks (or the other way round) fails the
  tests.
- `runtime.ts` runs a script; `lib.ts` (`ta.*`), `draw.ts`, `request.ts` and `strategy.ts` are what
  it puts in scope. `live.ts` holds the trading rules bar by bar; `backtest.ts` runs them over
  history, and paper / live trading runs the same functions.
- `packages/cli` runs scripts in an isolated Node context on real exchange bars; `packages/mcp`
  exposes the same tools to AI clients.

## Adding or changing a function

1. Implement it (`lib.ts` for `ta.*`, `draw.ts` for drawing, `runtime.ts` for the rest).
2. Describe it in `spec.ts` with an example that type-checks.
3. `pnpm generate` (docs + the Worker bundle), then `pnpm test`.
4. If it's something models are asked for, add a task to `eval/tasks.json` and run `pnpm eval`
   (needs the `claude` CLI) — a docs change should keep every task passing on the first try.

## Rules the code keeps

- Same chart, same result: no clock, randomness or network inside a script.
- No look-ahead: a value on bar `i` only uses bars up to `i`; requested bars line up with no peeking.
- Errors say what happened and how to fix it (Korean and English), with the line.
- Strategy fills are conservative: next bar's open, the stop wins a bar that touches both levels.

## Releases

Maintainers bump `version` in the three `packages/*/package.json` together, add a CHANGELOG entry
and push a `v*` tag; the release workflow tests and publishes.
