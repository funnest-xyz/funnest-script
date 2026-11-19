import { main } from './cli';

/**
 * Exit through exitCode, after closing fetch's pooled connections: exiting while they're still
 * open trips an assertion in Node on Windows ("UV_HANDLE_CLOSING").
 */
async function closeConnections() {
  const dispatcher = (globalThis as Record<symbol, { close?: () => Promise<void> } | undefined>)[Symbol.for('undici.globalDispatcher.1')];
  await dispatcher?.close?.().catch(() => undefined);
}

main(process.argv.slice(2))
  .then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`funnest-script: ${(e as Error)?.message ?? e}`);
      process.exitCode = 2;
    },
  )
  .finally(closeConnections);
