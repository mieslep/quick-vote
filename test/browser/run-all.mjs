// Starts a local Worker with a temporary database, runs every browser-flow suite, and stops the Worker.
// It needs Linux, macOS or WSL. Run it with: npm run test:browser
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const port = process.env.QUICK_VOTE_TEST_PORT || '8788';
const code = process.env.QUICK_VOTE_TEST_CODE || 'abc123';
const wrangler = path.join(root, 'node_modules', '.bin', 'wrangler');
const suites = ['multi-booth.mjs', 'single-booth.mjs', 'connect.mjs'];
const env = { ...process.env, QUICK_VOTE_TEST_API: `http://localhost:${port}`, QUICK_VOTE_TEST_CODE: code };
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-vote-test-'));

function killTree(pid) {
  const kids = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  kids.forEach((kid) => killTree(Number(kid)));
  try { process.kill(pid, 'SIGKILL'); } catch { /* The process has already ended. */ }
}

const setup = spawnSync(wrangler, ['d1', 'execute', 'quick-vote', '--local', '--persist-to', data, '--file=schema.sql'], { cwd: path.join(root, 'worker'), encoding: 'utf8' });
if (setup.status !== 0) {
  console.error(setup.stdout, setup.stderr);
  process.exit(1);
}

const worker = spawn(wrangler, ['dev', '--local', '--port', port, '--inspector-port', String(Number(port) + 551), '--persist-to', data, '--var', `CREATE_CODE:${code}`], {
  cwd: path.join(root, 'worker'),
  stdio: 'ignore',
});

let failed = false;
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    up = await fetch(`http://localhost:${port}/api/ping`).then((r) => r.ok).catch(() => false);
    if (!up) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!up) throw new Error('The local Worker did not start.');
  for (const suite of suites) {
    console.log(`\n=== ${suite}`);
    const result = spawnSync(process.execPath, [path.join(here, suite)], { stdio: 'inherit', env });
    if (result.status !== 0) failed = true;
  }
} catch (err) {
  console.error(err.message);
  failed = true;
} finally {
  killTree(worker.pid);
  fs.rmSync(data, { recursive: true, force: true });
}
console.log(failed ? '\nSome browser-flow tests failed.' : '\nAll browser-flow tests passed.');
process.exit(failed ? 1 : 0);
