import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLog, GENESIS, MemoryLog, guardedExecute, historyOf, makeEntry, verifyLog } from '../lib/audit-log.js';
import { parsePolicy } from '../lib/policy.js';

const A = '0x' + 'a1'.repeat(20);
const C = '0x' + 'c3'.repeat(20);
const FROM = '0x' + 'f0'.repeat(20);
const MON_10 = Date.UTC(2026, 9, 26, 10, 0) / 1000;

const POLICY = parsePolicy({
  version: 1,
  name: 't',
  rules: [
    { id: 'cap', type: 'spend-limit', asset: 'native', perRequest: '0.01', perWindow: { amount: '0.015', seconds: 3600 } },
    { id: 'to', type: 'allowlist', field: 'target', values: [A] },
    { id: 'hours', type: 'time-window', timezone: 'UTC', from: '08:00', to: '18:00' },
  ],
});
const req = (over = {}) => ({ from: FROM, to: A, value: '1000000000000000', ...over }); // 0.001

test('entries chain: each one carries the previous hash, starting from the genesis hash', async () => {
  const log = new MemoryLog();
  const a = await log.append('decision', { x: 1 });
  const b = await log.append('decision', { x: 2 });
  assert.equal(a.prev, GENESIS);
  assert.equal(b.prev, a.hash);
  assert.deepEqual([a.seq, b.seq], [0, 1]);
  const v = verifyLog(await log.all());
  assert.deepEqual([v.ok, v.count, v.head], [true, 2, b.hash]);
  assert.deepEqual(verifyLog([]), { ok: true, count: 0, head: GENESIS, problems: [] });
});

test('hash does not depend on key order', () => {
  const a = makeEntry(null, 'decision', { a: 1, b: { c: 2, d: 3 } });
  const b = makeEntry(null, 'decision', { b: { d: 3, c: 2 }, a: 1 });
  assert.equal(a.hash, b.hash);
});

test('verifyLog catches an edited entry, a deleted one, a reordered pair and an inserted one', async () => {
  const log = new MemoryLog();
  for (let i = 0; i < 4; i++) await log.append('decision', { decision: 'allow', i });
  const good = await log.all();

  const edited = structuredClone(good);
  edited[1].body.i = 99;
  const e = verifyLog(edited);
  assert.equal(e.ok, false);
  assert.match(e.problems[0].problem, /entry 1 was changed after it was written/);

  const deleted = structuredClone(good);
  deleted.splice(1, 1);
  assert.equal(verifyLog(deleted).ok, false);
  assert.match(verifyLog(deleted).problems[0].problem, /missing, duplicated or reordered/);

  const swapped = structuredClone(good);
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.equal(verifyLog(swapped).ok, false);

  const inserted = structuredClone(good);
  inserted.splice(2, 0, makeEntry(good[1], 'decision', { decision: 'allow', forged: true }));
  assert.equal(verifyLog(inserted).ok, false);

  // rewriting an entry AND its hash still breaks the next entry's link
  const rehashed = structuredClone(good);
  rehashed[1].body.i = 99;
  rehashed[1].hash = makeEntry({ seq: 0, hash: rehashed[0].hash }, 'decision', rehashed[1].body).hash;
  assert.match(verifyLog(rehashed).problems.map((p) => p.problem).join(' | '), /does not follow the entry before it/);
});

test('a log that shows a denied request as executed is invalid', async () => {
  const log = new MemoryLog();
  const d = await log.append('decision', { decision: 'deny', atSec: 1, spend: [] });
  await log.append('execution', { decisionSeq: d.seq, status: 'executed', result: {} });
  const v = verifyLog(await log.all());
  assert.equal(v.ok, false);
  assert.match(v.problems[0].problem, /shows a DENIED request .* as executed/);
});

test('an execution entry must point at an earlier decision', async () => {
  const log = new MemoryLog();
  await log.append('execution', { decisionSeq: 5, status: 'executed' });
  assert.match(verifyLog(await log.all()).problems[0].problem, /does not come before it/);
});

test('guardedExecute: an allowed request is recorded first, then executed, then its outcome recorded', async () => {
  const log = new MemoryLog();
  const order = [];
  const r = await guardedExecute({
    policy: POLICY, log, request: req(), nowSec: MON_10,
    execute: async () => { order.push(['exec', (await log.all()).length]); return { txHash: '0xabc' }; },
  });
  assert.equal(r.decision.decision, 'allow');
  assert.equal(r.executed, true);
  assert.deepEqual(order, [['exec', 1]], 'the decision was already in the log when the executor ran');
  const entries = await log.all();
  assert.deepEqual(entries.map((e) => e.kind), ['decision', 'execution']);
  assert.deepEqual(entries[1].body, { decisionSeq: 0, status: 'executed', result: { txHash: '0xabc' } });
  assert.equal(verifyLog(entries).ok, true);
});

test('guardedExecute: a denied request never reaches the executor, and the denial is logged with the rule', async () => {
  for (const [name, over, nowSec, rule] of [
    ['spend-limit', req({ value: '20000000000000000' }), MON_10, 'cap'],
    ['allowlist', req({ to: C }), MON_10, 'to'],
    ['time-window', req(), Date.UTC(2026, 9, 26, 3, 0) / 1000, 'hours'],
  ]) {
    const log = new MemoryLog();
    let calls = 0;
    const r = await guardedExecute({ policy: POLICY, log, request: over, nowSec, execute: async () => { calls++; } });
    assert.equal(calls, 0, name);
    assert.equal(r.executed, false, name);
    assert.equal(r.decision.rule.id, rule, name);
    const entries = await log.all();
    assert.equal(entries[1].body.status, 'not-executed');
    assert.match(entries[1].body.note, new RegExp(`denied by ${rule}; the executor was not called`));
    assert.equal(verifyLog(entries).ok, true);
  }
});

test('an unreadable request is denied by request-shape and never executed', async () => {
  const log = new MemoryLog();
  let calls = 0;
  const r = await guardedExecute({ policy: POLICY, log, request: { from: 'nope' }, nowSec: MON_10, execute: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(r.decision.rule.id, 'request-shape');
});

test('spend windows are fed from the log: the second allowed request pushes the third over the window limit', async () => {
  const log = new MemoryLog();
  const run = (value, t) => guardedExecute({ policy: POLICY, log, request: req({ value }), nowSec: t, execute: async () => ({}) });
  assert.equal((await run('8000000000000000', MON_10)).decision.decision, 'allow'); // 0.008
  assert.equal((await run('8000000000000000', MON_10 + 60)).decision.decision, 'deny'); // 0.016 > 0.015
  assert.equal((await run('7000000000000000', MON_10 + 120)).decision.decision, 'allow'); // 0.008 + 0.007 = 0.015, the limit itself is allowed
  assert.equal((await run('1', MON_10 + 180)).decision.decision, 'deny'); // 1 wei over
  assert.equal((await run('8000000000000000', MON_10 + 3601)).decision.decision, 'allow'); // first spend aged out of the 1 h window
});

test('a failing executor is recorded as failed, and the error is not swallowed', async () => {
  const log = new MemoryLog();
  const r = await guardedExecute({ policy: POLICY, log, request: req(), nowSec: MON_10, execute: async () => { throw new Error('rpc down'); } });
  assert.equal(r.executed, false);
  assert.equal(r.error.message, 'rpc down');
  assert.deepEqual((await log.all())[1].body, { decisionSeq: 0, status: 'failed', error: 'rpc down' });
});

test('fail closed: if the decision cannot be written, nothing is executed', async () => {
  const log = new MemoryLog();
  log.append = async () => { throw new Error('disk full'); };
  let calls = 0;
  await assert.rejects(guardedExecute({ policy: POLICY, log, request: req(), nowSec: MON_10, execute: async () => { calls++; } }), /disk full/);
  assert.equal(calls, 0);
});

test('fail closed: a tampered log blocks every further decision', async () => {
  const log = new MemoryLog();
  await guardedExecute({ policy: POLICY, log, request: req(), nowSec: MON_10, execute: async () => ({}) });
  log.entries[0].body.spend = [];
  let calls = 0;
  await assert.rejects(guardedExecute({ policy: POLICY, log, request: req(), nowSec: MON_10, execute: async () => { calls++; } }), /audit log is not intact/);
  assert.equal(calls, 0);
});

test('historyOf lists decisions only, with time and spend', async () => {
  const log = new MemoryLog();
  await guardedExecute({ policy: POLICY, log, request: req(), nowSec: MON_10, execute: async () => ({}) });
  const h = historyOf(await log.all());
  assert.equal(h.length, 1);
  assert.deepEqual(h[0], { decision: 'allow', atSec: MON_10, spend: [{ asset: 'native', amountRaw: '1000000000000000' }] });
});

test('FileLog persists across instances, stays a valid chain, and serialises concurrent writers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-'));
  const path = join(dir, 'audit.jsonl');
  const log = new FileLog(path);
  await Promise.all([1, 2, 3, 4, 5].map((i) => log.append('decision', { decision: 'allow', i, atSec: i, spend: [] })));
  const reopened = new FileLog(path);
  const entries = await reopened.all();
  assert.equal(entries.length, 5);
  assert.equal(verifyLog(entries).ok, true);
  assert.equal((await readFile(path, 'utf8')).split('\n').filter(Boolean).length, 5);

  // tamper with the file on disk
  const text = (await readFile(path, 'utf8')).replace('"i":3', '"i":33');
  await writeFile(path, text);
  assert.equal(verifyLog(await reopened.all()).ok, false);
  // a missing file is an empty log
  assert.deepEqual(await new FileLog(join(dir, 'none.jsonl')).all(), []);
  // a garbled line is an error, not silently skipped
  await writeFile(path, '{not json\n');
  await assert.rejects(reopened.all(), /line 1 is not valid JSON/);
});

test('concurrent gate decisions reserve the window before either executor runs', async () => {
  for (const disk of [false, true]) {
    const path = disk ? join(await mkdtemp(join(tmpdir(), 'gate-race-')), 'audit.jsonl') : null;
    const log = disk ? new FileLog(path) : new MemoryLog();
    const other = disk ? new FileLog(path) : log;
    let executions = 0;
    const results = await Promise.all([log, other].map((store) => guardedExecute({
      policy: POLICY, log: store, request: req({ value: '8000000000000000' }), nowSec: MON_10,
      execute: async () => { executions++; return {}; },
    })));
    assert.equal(executions, 1, disk ? 'file-backed decisions' : 'memory-backed decisions');
    assert.deepEqual(results.map((r) => r.decision.decision).sort(), ['allow', 'deny']);
    assert.equal(verifyLog(await log.all()).ok, true);
  }
});

test('separate FileLog instances cannot fork the append chain', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'gate-writers-')), 'audit.jsonl');
  await Promise.all(Array.from({ length: 10 }, (_, i) => new FileLog(path).append('decision', { i })));
  assert.equal(verifyLog(await new FileLog(path).all()).ok, true);
});

test('MemoryLog snapshots isolate input, append results and reads from stored entries', async () => {
  const body = { nested: { amount: '1' } };
  const log = new MemoryLog();
  const appended = await log.append('decision', body);
  body.nested.amount = '2';
  appended.body.nested.amount = '3';
  const read = await log.all();
  read[0].body.nested.amount = '4';
  const reopened = new MemoryLog(await log.all());
  const initial = await reopened.all();
  initial[0].body.nested.amount = '5';
  assert.equal((await log.all())[0].body.nested.amount, '1');
  assert.equal((await reopened.all())[0].body.nested.amount, '1');
  assert.equal(verifyLog(await log.all()).ok, true);
});

test('independent processes reserve the same file-backed spend window atomically', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const runNode = promisify(execFile);
  const path = join(await mkdtemp(join(tmpdir(), 'gate-processes-')), 'audit.jsonl');
  const source = `
    import { FileLog, guardedExecute } from ${JSON.stringify(new URL('../lib/audit-log.js', import.meta.url).href)};
    import { parsePolicy } from ${JSON.stringify(new URL('../lib/policy.js', import.meta.url).href)};
    const policy = { name: 'test', hash: 'test', rules: [{ id: 'cap', type: 'spend-limit', asset: 'native', decimals: 18, symbol: 'PHRS', perWindowRaw: 15000000000000000n, windowSeconds: 3600 }] };
    const r = await guardedExecute({ policy, log: new FileLog(${JSON.stringify(path)}), request: ${JSON.stringify(req({ value: '8000000000000000' }))}, nowSec: ${MON_10}, execute: async () => ({}) });
    process.stdout.write(r.decision.decision);
  `;
  const results = await Promise.all([1, 2, 3].map(() => runNode(process.execPath, ['--input-type=module', '-e', source])));
  assert.deepEqual(results.map((r) => r.stdout).sort(), ['allow', 'deny', 'deny']);
  assert.equal(verifyLog(await new FileLog(path).all()).ok, true);
});

test('a successful executor is never misrecorded as failed when its outcome cannot be appended', async () => {
  const log = new MemoryLog();
  const append = log.append.bind(log);
  log.append = async (kind, body) => { if (kind === 'execution' && body.status === 'executed') throw new Error('disk full after send'); return append(kind, body); };
  let calls = 0;
  await assert.rejects(guardedExecute({ policy: POLICY, log, request: req(), nowSec: MON_10, execute: async () => { calls++; return { txHash: '0xsent' }; } }), /disk full after send/);
  assert.equal(calls, 1);
  assert.deepEqual((await log.all()).map((e) => e.kind), ['decision']);
});

test('a malformed but valid JSON audit entry is refused before any execution', async () => {
  const log = new MemoryLog([null]);
  assert.equal(verifyLog(await log.all()).ok, false);
  let calls = 0;
  await assert.rejects(guardedExecute({ policy: POLICY, log, request: req(), nowSec: MON_10, execute: async () => { calls++; } }), /audit log is not intact/);
  assert.equal(calls, 0);
});

test('JSON-compatible dates and undefined array values persist with verifiable hashes', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'gate-json-')), 'audit.jsonl');
  for (const log of [new MemoryLog(), new FileLog(path)]) {
    await log.append('decision', { at: new Date('2026-10-25T00:00:00.000Z'), values: [undefined, 1] });
    assert.equal(verifyLog(await log.all()).ok, true);
    assert.deepEqual((await log.all())[0].body, { at: '2026-10-25T00:00:00.000Z', values: [null, 1] });
  }
});
