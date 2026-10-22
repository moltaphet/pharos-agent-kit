import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fidelity, shape } from '../lib/tasks/saga-executor.js';

const rec = () => JSON.parse(readFileSync(new URL('../reports/saga-runs.json', import.meta.url), 'utf8'));

test('the web simulator reproduces every recorded real-EVM run entry for entry', async () => {
  const f = await fidelity(rec());
  assert.equal(f.rows.length, 2);
  for (const r of f.rows) {
    assert.equal(r.identical, true, `${r.run}: ${JSON.stringify(r.firstDifference)}`);
    assert.equal(r.realEntries, r.simulatedEntries);
    assert.ok(r.realEntries >= 16);
  }
});

test('the check can fail: a tampered recorded log is reported with its first difference', async () => {
  const r = rec();
  r.runs[0].log.splice(5, 1); // drop one entry from the success run
  const f = await fidelity(r);
  assert.equal(f.rows[0].identical, false);
  assert.equal(f.rows[0].firstDifference.index, 5);
  assert.equal(f.rows[1].identical, true);
});

test('the check can fail: a different status is not "identical" even with the same events', async () => {
  const r = rec();
  r.runs[1].status = 'completed';
  assert.equal((await fidelity(r)).rows[1].identical, false);
});

test('shape ignores timings, hashes, blocks and gas but not events, steps, attempts or errors', () => {
  const a = { event: 'step:sent', step: 'approve', attempt: 1, txHash: '0x1', t: 5, gasUsed: 10 };
  const b = { event: 'step:sent', step: 'approve', attempt: 1, txHash: '0x2', t: 99, gasUsed: 99 };
  assert.deepEqual(shape([a]), shape([b]));
  assert.notDeepEqual(shape([a]), shape([{ ...b, attempt: 2 }]));
  assert.notDeepEqual(shape([a]), shape([{ ...b, error: 'boom' }]));
});

test('recorded runs carry provenance: command, fork blocks, tool version, contracts', () => {
  const r = rec();
  assert.match(r.provenance?.command ?? '', /saga\.mjs/);
  assert.match(r.provenance?.anvil ?? '', /anvil/);
  assert.equal(Object.keys(r.provenance?.forkBlocks ?? {}).sort().join(), 'failure,success');
  assert.ok(r.provenance?.contracts?.vault && r.provenance.contracts.usdc);
});
