import { defineConfig } from 'tsup';

// The library (index) and the command (bin, with a shebang so `npx @funnest/script-cli` runs it).
// TypeScript stays outside the bundle (installed with the package).
const external = ['typescript'];
export default defineConfig([
  { entry: ['src/index.ts'], format: 'esm', target: 'node20', clean: true, dts: true, external },
  // The sandboxed run's process (isolate.ts starts it next to itself).
  { entry: ['src/sandbox-child.mjs'], format: 'esm', target: 'node20' },
  { entry: ['src/bin.ts'], format: 'esm', target: 'node20', external, banner: { js: '#!/usr/bin/env node' } },
]);
