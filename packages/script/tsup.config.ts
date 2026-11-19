import { defineConfig } from 'tsup';

// The language for apps (index) and the same runtime as one script string for a sandbox Worker (worker).
export default defineConfig({ entry: { index: 'src/index.ts', worker: 'src/generated/worker.ts' }, format: 'esm', target: 'es2020', clean: true, dts: true });
