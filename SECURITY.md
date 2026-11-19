# Security

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this
repository (private vulnerability reporting). Don't open a public issue for it. We'll confirm we
got it, keep you posted while we fix it, and credit you in the release notes if you'd like.

## What a script can and can't do

Scripts are other people's code — often written by an AI, or copied from a feed — so running one
must not reach the machine or the page it runs on.

- **The language** has no clock, randomness, network, timers or imports: `Date.now`,
  `Math.random`, `fetch`, `setTimeout`, `XMLHttpRequest`, `WebSocket` and `importScripts` throw.
  This keeps results the same for everyone; it is not a sandbox by itself.
- **`execute()` from `@funnest/script` is not a sandbox.** It runs the code in the calling
  realm. To run code you don't trust, run it elsewhere: a Worker inside a sandboxed iframe with a
  CSP that allows no network (what Funnest does in the browser; `@funnest/script/worker` is the
  runtime as one script string), or an isolated process like the CLI below. Always with a time
  limit.
- **The CLI and the MCP server** (`@funnest/script-cli`, `@funnest/script-mcp`) run each script in
  a separate Node process under Node's permission model — it may read only its own file: no other
  files, no child processes, no worker threads, no native addons — with no environment variables
  (no keys or tokens to find), a memory cap and a time limit (promise callbacks included). Inside
  that process the script runs in a `vm` context that holds no object from outside, so the usual
  `vm` escapes have nothing to climb through. Node's permission model doesn't cover the network;
  the process has nothing to send.
- **Type-checking** a script reads only the script, the language's declarations and TypeScript's
  own library files: a `/// <reference path>` or an `import` in a script is not followed.
- **Market data** comes only from fixed exchange hosts (Binance, Upbit, Bybit, OKX); a symbol is
  passed as a query value, never as an address.

Needs Node 22.13 or newer for the permission model (older versions still get the separate
process, the empty environment and the limits).
