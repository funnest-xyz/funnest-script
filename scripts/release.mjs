// Publish the packages to npm in dependency order (the release workflow runs this; by hand too).
//   pnpm release             # npm asks for the 2FA code (or opens the browser)
//   pnpm release 123456      # pass the 6-digit 2FA code (valid ~30s)
// `pnpm pack` first so workspace:* becomes the real version, then `npm publish` the tarball
// (in the release workflow, `npm stage publish` when the trusted publisher may only stage).
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, '.release');
const ORDER = ['script', 'cli', 'mcp'];
const otp = process.argv[2];
const staged = [];

const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: 'inherit', shell: true });
const quiet = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], shell: true }).toString().trim();
  } catch {
    return '';
  }
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
run('pnpm build');
for (const pkg of ORDER) execSync(`pnpm pack --pack-destination "${OUT}"`, { cwd: join(ROOT, 'packages', pkg), stdio: 'ignore', shell: true });

for (const pkg of ORDER) {
  const { name, version } = JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'));
  if (quiet(`npm view ${name}@${version} version`) === version) {
    console.log(`skip ${name}@${version} (already published)`);
    continue;
  }
  const file = join(OUT, `${name.replace('@', '').replace('/', '-')}-${version}.tgz`);
  console.log(`\npublish ${name}@${version}`);
  try {
    run(`npm publish "${file}" --access public${otp ? ` --otp=${otp}` : ''}`);
  } catch (err) {
    // In the release workflow the trusted publisher may be allowed to stage only (npm's safer
    // default): then the version waits on npmjs.com until a maintainer approves it with 2FA.
    if (!process.env.GITHUB_ACTIONS) throw err;
    console.log(`direct publish refused; staging ${name}@${version} for approval on npmjs.com`);
    run(`npm stage publish "${file}" --access public`);
    staged.push(`${name}@${version}`);
  }
}
if (staged.length) console.log(`\nstaged (approve on npmjs.com, or \`npm stage list\` / \`npm stage approve <id>\`): ${staged.join(', ')}`);
console.log('\ndone');
