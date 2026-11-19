import { main } from './eval';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`funnest-script-eval: ${(e as Error)?.message ?? e}`);
    process.exitCode = 2;
  },
);
