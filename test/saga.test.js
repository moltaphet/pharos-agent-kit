import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, runSaga, withInjectedFault } from '../lib/saga.js';
import { simulate } from '../lib/tasks/saga-executor.js';

// A scripted executor: each send returns the next planned outcome for that tx's `tag`.
const make = (plan = {}) => {
  const sent = [];
  const exec = {
    sent,
    async send(tx) {
      sent.push(tx.tag);
      const next = (plan[tx.tag] ??= []).shift();
      if (next instanceof Error) throw next;
      return `0x${tx.tag}`;
    },
    async receipt(hash) {
      const tag = hash.slice(2);
      return { hash, status: plan[`status:${tag}`] === 'revert' ? 'reverted' : 'success', reason: plan[`status:${tag}`] === 'revert' ? 'Nope' : undefined, blockNumber: 1, gasUsed: 21000 };
    },
  };
  return exec;
};
const step = (id, extra = {}) => ({ id, title: id, tx: () => ({ tag: id }), compensate: { title: `undo ${id}`, tx: () => ({ tag: `undo-${id}` }) }, ...extra });
const fast = { baseDelayMs: 1, maxDelayMs: 2 };
const noSleep = () => Promise.resolve();

test('classifyError: network and mempool trouble is transient, a revert is permanent', () => {
  for (const m of ['replacement transaction underpriced', 'nonce too low', 'request timed out', 'HTTP 429', 'transaction dropped from the mempool']) assert.equal(classifyError(new Error(m)), 'transient', m);
  for (const m of ['execution reverted: ZeroAddress', 'insufficient funds for gas', 'verification failed']) assert.equal(classifyError(new Error(m)), 'permanent', m);
});

test('a clean run confirms every step in order and logs each state change', async () => {
  const exec = make();
  const r = await runSaga({ steps: [step('a'), step('b'), step('c')], exec, policy: fast, sleep: noSleep });
  assert.equal(r.status, 'completed');
  assert.deepEqual(exec.sent, ['a', 'b', 'c']);
  assert.deepEqual(r.steps.map((s) => s.state), ['confirmed', 'confirmed', 'confirmed']);
  assert.deepEqual(r.log.map((e) => e.event).filter((e) => e.startsWith('step:start')), ['step:start', 'step:start', 'step:start']);
  assert.equal(r.log.at(-1).event, 'saga:completed');
});

test('a step is verified before the next one starts; a failed check stops the saga', async () => {
  const exec = make();
  const r = await runSaga({ steps: [step('a'), step('b', { verify: async () => 'balance did not change' }), step('c')], exec, policy: fast, sleep: noSleep });
  assert.equal(r.status, 'compensated');
  assert.equal(r.failure.step, 'b');
  assert.match(r.failure.error, /verification failed: balance did not change/);
  assert.ok(!exec.sent.includes('c'), 'step c never started');
});

test('transient errors are retried with backoff, then the step succeeds', async () => {
  const exec = make({ b: [new Error('replacement transaction underpriced'), new Error('nonce too low')] });
  const waits = [];
  const r = await runSaga({ steps: [step('a'), step('b')], exec, policy: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 }, sleep: async (ms) => waits.push(ms) });
  assert.equal(r.status, 'completed');
  assert.equal(r.steps[1].attempts, 3);
  assert.deepEqual(waits, [100, 200]); // exponential backoff
  assert.equal(r.log.filter((e) => e.event === 'step:retry').length, 2);
});

test('retries are capped by the policy, then the saga undoes what it did', async () => {
  const exec = make({ b: [new Error('request timed out'), new Error('request timed out')] });
  const r = await runSaga({ steps: [step('a'), step('b')], exec, policy: { maxAttempts: 2, baseDelayMs: 1 }, sleep: noSleep });
  assert.equal(r.status, 'compensated');
  assert.equal(r.failure.kind, 'transient');
  assert.equal(r.steps[1].attempts, 2);
  assert.deepEqual(exec.sent, ['a', 'b', 'b', 'undo-a']);
});

test('a revert is permanent: no retry, and confirmed steps are undone newest first', async () => {
  const exec = make({ 'status:c': 'revert' });
  const r = await runSaga({ steps: [step('a'), step('b'), step('c')], exec, policy: fast, sleep: noSleep });
  assert.equal(r.status, 'compensated');
  assert.equal(r.steps[2].attempts, 1, 'a revert is never retried');
  assert.match(r.failure.error, /reverted: Nope/);
  assert.deepEqual(exec.sent, ['a', 'b', 'c', 'undo-b', 'undo-a']);
  assert.deepEqual(r.steps.map((s) => s.state), ['compensated', 'compensated', 'failed']);
});

test('when an undo itself fails the saga says so instead of claiming success', async () => {
  const exec = make({ 'status:c': 'revert', 'undo-b': [new Error('execution reverted: vault is paused')] });
  const r = await runSaga({ steps: [step('a'), step('b'), step('c')], exec, policy: fast, sleep: noSleep });
  assert.equal(r.status, 'compensation-failed');
  assert.deepEqual(r.stuck, ['b']);
  assert.equal(r.steps[1].state, 'compensation-failed');
  assert.equal(r.steps[0].state, 'compensated', 'the remaining undos still run');
  assert.equal(r.log.at(-1).event, 'saga:stuck');
});

test('a step with no compensation is reported as not undoable', async () => {
  const exec = make({ 'status:b': 'revert' });
  const a = { ...step('a'), compensate: undefined };
  const r = await runSaga({ steps: [a, step('b')], exec, policy: fast, sleep: noSleep });
  assert.equal(r.status, 'compensation-failed');
  assert.equal(r.steps[0].state, 'not-undoable');
});

test('withInjectedFault fails only the matching sends, a limited number of times', async () => {
  const exec = withInjectedFault(make(), { match: (tx) => tx.tag === 'b', times: 1 });
  await exec.send({ tag: 'a' });
  await assert.rejects(exec.send({ tag: 'b' }), /injected fault/);
  assert.equal(await exec.send({ tag: 'b' }), '0xb');
});

// ---- the simulator running the real vault-saga steps -------------------------------
test('simulated success moves the USDC into treasury shares', async () => {
  const r = await simulate({ scenario: 'success' });
  assert.equal(r.status, 'completed');
  assert.equal(r.finalCheck.clean, true);
  assert.equal(r.finalCheck.spent, '100000000');
  assert.ok(BigInt(r.finalCheck.treasuryShares) > 0n);
});

test('simulated retry: two transient failures, then the deposit goes through', async () => {
  const r = await simulate({ scenario: 'retry', maxAttempts: 3 });
  assert.equal(r.status, 'completed');
  assert.equal(r.steps[1].attempts, 3);
  const none = await simulate({ scenario: 'retry', maxAttempts: 2 });
  assert.equal(none.status, 'compensated', 'with only 2 attempts the deposit never lands');
});

test('simulated forced failure rolls everything back to the start', async () => {
  const r = await simulate({ scenario: 'failure' });
  assert.equal(r.status, 'compensated');
  assert.match(r.failure.error, /ZeroAddress/);
  assert.deepEqual(r.steps.map((s) => s.state), ['compensated', 'compensated', 'failed']);
  assert.equal(r.finalCheck.clean, true);
  assert.equal(r.finalCheck.spent, '0');
  assert.equal(r.finalCheck.allowance, '0');
});

test('simulated "stuck" run is reported as compensation-failed with funds stranded', async () => {
  const r = await simulate({ scenario: 'stuck' });
  assert.equal(r.status, 'compensation-failed');
  assert.deepEqual(r.stuck, ['deposit']);
  assert.equal(r.finalCheck.clean, false);
});

test('bad inputs are rejected', async () => {
  await assert.rejects(simulate({ scenario: 'nope' }), /scenario must be one of/);
  await assert.rejects(simulate({ scenario: 'success', maxAttempts: 9 }), /maxAttempts must be 1 to 5/);
});
