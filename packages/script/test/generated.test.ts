import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The bundled worker runtime and the docs are committed: they must match the sources.
describe('generated files are up to date', () => {
  for (const script of ['build-worker.mjs', 'build-docs.mjs'])
    it(script, () => {
      const out = execFileSync(process.execPath, [join(__dirname, '..', 'scripts', script), '--check'], { encoding: 'utf8' });
      expect(out).toMatch(/up to date/);
    }, 60_000);
});
