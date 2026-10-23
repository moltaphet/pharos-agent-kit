import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startFork } from '../lib/saga-fork.js';

// A fake `anvil`: fails (exit 1, with a message on stderr) the first `failures` times it is started, then serves eth_chainId.
function fakeAnvil({ failures, exitMessage = 'Error: failed to get account: cu limit exceeded' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fake-anvil-'));
  const counter = path.join(dir, 'count');
  writeFileSync(counter, '0');
  const bin = path.join(dir, 'anvil');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const n = Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) + 1;
fs.writeFileSync(${JSON.stringify(counter)}, String(n));
fs.writeFileSync(${JSON.stringify(path.join(dir, 'args'))}, process.argv.slice(2).join(' '));
if (n <= ${failures}) { console.error(${JSON.stringify(exitMessage)}); process.exit(1); }
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
require('node:http').createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end('{"jsonrpc":"2.0","id":1,"result":"0x688"}'); }).listen(port, '127.0.0.1');
`);
  chmodSync(bin, 0o755);
  return { bin, attempts: () => Number(readFileSync(counter)), args: () => readFileSync(path.join(dir, 'args'), 'utf8') };
}
import { readFileSync } from 'node:fs';
const opts = (f, extra = {}) => ({ command: f.bin, port: 18000 + Math.floor(Math.random() * 1000), backoffMs: 20, readyTries: 40, ...extra });

test('anvil that starts first time: one attempt, throttled, and stoppable', async () => {
  const f = fakeAnvil({ failures: 0 });
  const fork = await startFork(opts(f));
  try {
    assert.equal(fork.attempt, 1);
    assert.match(f.args(), /--compute-units-per-second 100/);
  } finally { fork.stop(); }
});

test('a refused start is retried after a pause and then succeeds', async () => {
  const f = fakeAnvil({ failures: 2 });
  const fork = await startFork(opts(f));
  try {
    assert.equal(fork.attempt, 3);
    assert.equal(f.attempts(), 3);
  } finally { fork.stop(); }
});

test('when every attempt fails the error says how many tries were made and what anvil itself said', async () => {
  const f = fakeAnvil({ failures: 99 });
  const t0 = Date.now();
  await assert.rejects(startFork(opts(f)), (e) => /after 3 attempts/.test(e.message) && /cu limit exceeded/.test(e.message));
  assert.equal(f.attempts(), 3);
  assert.ok(Date.now() - t0 < 5000, 'it must fail fast when anvil has exited, not wait out the whole readiness window');
});

test('a binary that is not installed fails with a clear message instead of hanging', async () => {
  await assert.rejects(startFork({ command: '/nonexistent/anvil', port: 18999, attempts: 2, backoffMs: 10, readyTries: 10 }), /did not start after 2 attempts/);
});
