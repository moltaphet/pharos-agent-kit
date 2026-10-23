import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetTestnetCache, testnetEvidence, verifyTx } from '../lib/testnet-report.js';

const report = JSON.parse(readFileSync(new URL('../reports/testnet-runs.json', import.meta.url), 'utf8'));
const hex = (n) => '0x' + BigInt(n).toString(16);

// A chain that answers exactly what the report recorded (or something different where a test asks for it).
const chainFor = (rec, tweak = () => ({})) => async (method, params) => {
  if (method === 'eth_blockNumber') return hex(31_800_000);
  if (method === 'eth_getBalance') return hex(49_000_000_000_000_000n);
  const tx = rec.transactions.find((t) => t.hash === params[0]);
  if (!tx) return null;
  const t = { ...tx, ...tweak(tx) };
  if (method === 'eth_getTransactionReceipt') return t.missing ? null : { status: t.status === 'success' ? '0x1' : '0x0', gasUsed: hex(t.gasUsed), blockNumber: hex(t.blockNumber), from: t.from, to: t.contractAddress ? null : t.to, contractAddress: t.contractAddress ?? null };
  if (method === 'eth_getTransactionByHash') return { value: hex(BigInt(t.valueWei)) };
  throw new Error(`unexpected ${method}`);
};

test('the recorded run is a live-network run with the evidence a reviewer needs', () => {
  assert.equal(report.mode, 'live');
  assert.equal(report.network.chainId, 688689);
  assert.match(report.wallet, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(report.transactions.length, 12);
  for (const t of report.transactions) assert.match(t.hash, /^0x[0-9a-f]{64}$/);
  assert.ok(BigInt(report.budget.spentWei) < BigInt(report.budget.limitWei), 'stayed inside its gas budget');
  assert.equal(JSON.stringify(report).includes('privateKey'), false, 'no key material in the report');
});

test('every dry-run prediction matched what the chain then did', () => {
  for (const c of report.dryRun.cases) assert.equal(c.check?.matched, true, c.id);
  const blocked = report.dryRun.cases.filter((c) => c.report.verdict === 'blocked');
  assert.equal(blocked.length, 2);
  assert.ok(blocked.some((c) => c.sent?.status === 'reverted'), 'the blocked ERC-20 call was sent anyway once, and really reverted');
  assert.ok(blocked.some((c) => c.sent === null), 'the unaffordable transfer was never sent');
});

test('batching: plain transfers cost MORE, shared-state calls save, and the planner said so beforehand', () => {
  const { transfers, calls } = report.batch;
  assert.ok(transfers.realComparison.gasSaved < 0 && transfers.realComparison.plannedGasSavedPct < 0);
  assert.ok(calls.realComparison.gasSaved > 0 && calls.realComparison.plannedGasSavedPct > 0);
  assert.ok(Math.abs(calls.realComparison.gasSavedPct - calls.realComparison.plannedGasSavedPct) < 3, 'the real saving is within 3 points of the plan');
  assert.equal(calls.batched.everyCallLanded, true);
  assert.equal(report.batch.exclude.excluded.length, 1);
});

test('verifyTx: a transaction the chain agrees with is verified', async () => {
  const r = await verifyTx(report.transactions[0], chainFor(report));
  assert.equal(r.verified, true);
});

test('verifyTx: says no when the chain disagrees on gas, status, block or value, or has never heard of it', async () => {
  const tx = report.transactions[1];
  for (const [what, tweak] of [['gasUsed', () => ({ gasUsed: tx.gasUsed + 1 })], ['status', () => ({ status: tx.status === 'success' ? 'reverted' : 'success' })], ['blockNumber', () => ({ blockNumber: tx.blockNumber + 1 })], ['value', () => ({ valueWei: '12345' })]]) {
    const r = await verifyTx(tx, chainFor(report, tweak));
    assert.equal(r.verified, false, what);
    assert.match(r.reason, new RegExp(what));
  }
  const gone = await verifyTx(tx, chainFor(report, () => ({ missing: true })));
  assert.equal(gone.verified, false);
  assert.match(gone.reason, /no receipt/);
  const down = await verifyTx(tx, async () => { throw new Error('connect ECONNREFUSED'); });
  assert.equal(down.verified, false);
  assert.match(down.reason, /could not read it from the chain/);
});

test('testnetEvidence counts verified transactions and reports the wallet balance and head', async () => {
  const ev = await testnetEvidence({ rpc: chainFor(report), report });
  assert.equal(ev.verification.total, 12);
  assert.equal(ev.verification.verifiedCount, 12);
  assert.equal(ev.verification.head, 31_800_000);
  const bad = report.transactions[3].hash;
  const ev2 = await testnetEvidence({ rpc: chainFor(report, (t) => (t.hash === bad ? { gasUsed: 1 } : {})), report });
  assert.equal(ev2.verification.verifiedCount, 11);
  assert.equal(ev2.verification.results[bad].verified, false);
});

test('the live check is cached for a minute so a page view does not hammer the public RPC', async () => {
  resetTestnetCache();
  let calls = 0;
  const rpc = async (m, p) => { calls++; return chainFor(report)(m, p); };
  let t = 1_000;
  const clock = () => t;
  const reportless = { rpc, now: clock };
  const a = await testnetEvidence(reportless);
  const first = calls;
  t += 30_000;
  const b = await testnetEvidence(reportless);
  assert.equal(calls, first, 'served from cache');
  assert.equal(a.verification.checkedAt, b.verification.checkedAt);
  t += 31_000;
  await testnetEvidence(reportless);
  assert.ok(calls > first, 'refreshed after the TTL');
  resetTestnetCache();
});

// ---- the Guardian's recorded run ---------------------------------------------------------------------
const guardian = JSON.parse(readFileSync(new URL('../reports/testnet-guardian.json', import.meta.url), 'utf8'));

test('the Guardian ran for real on the testnet: FIRE sent one transaction that landed, HOLD sent nothing', () => {
  assert.equal(guardian.mode, 'live');
  assert.equal(guardian.network.chainId, 688689);
  const [fire, hold] = [guardian.runs.find((r) => r.id === 'fire'), guardian.runs.find((r) => r.id === 'hold')];
  assert.equal(fire.decision, 'fire');
  assert.equal(fire.passed, fire.total);
  assert.equal(fire.action.tx.status, 'success');
  assert.equal(fire.counterAfter, '1', 'the chain says the action happened');
  assert.equal(hold.decision, 'hold');
  assert.ok(hold.passed < hold.total && hold.conditions.some((c) => !c.pass));
  assert.equal(hold.action, null);
  assert.equal(hold.counterAfter, '0', 'the chain says nothing happened');
  assert.ok(guardian.runs.every((r) => r.matched));
  assert.equal(guardian.transactions.length, 1, 'only the FIRE run sent a transaction');
  assert.equal(JSON.stringify(guardian).includes('privateKey'), false);
});

test('the Guardian run reads three independent conditions, each with its value on the trace', () => {
  for (const run of guardian.runs) {
    assert.equal(run.conditions.length, 3);
    assert.equal(new Set(run.conditions.map((c) => c.type)).size, 3, 'three different kinds of condition');
    assert.ok(run.trace.some((l) => /^DECISION/.test(l)));
  }
});

test('the Guardian transaction verifies against the chain, and a wrong claim about it does not', async () => {
  const rec = { ...guardian };
  const ok = await testnetEvidence({ rpc: chainFor(rec), report: rec });
  assert.equal(ok.verification.verifiedCount, 1);
  const lied = await testnetEvidence({ rpc: chainFor(rec, () => ({ status: 'reverted' })), report: rec });
  assert.equal(lied.verification.verifiedCount, 0);
});

test('hash links written into page text point at the transactions in the recorded reports (re-recording must not leave stale links)', () => {
  const page = readFileSync(new URL('../public/js/tasks/threshold-guardian.js', import.meta.url), 'utf8');
  const fire = guardian.runs.find((r) => r.id === 'fire').action.tx.hash;
  const linked = [...page.matchAll(/atlantic\.pharosscan\.xyz\/tx\/(0x[0-9a-f]{64})/g)].map((m) => m[1]);
  assert.ok(linked.length >= 1, 'the Guardian page links the real transaction');
  for (const h of linked) assert.equal(h, fire, 'the Guardian page links a transaction that is not in reports/testnet-guardian.json');
  for (const file of ['dry-run-executor.js', 'batch-executor.js']) {
    const src = readFileSync(new URL(`../public/js/tasks/${file}`, import.meta.url), 'utf8');
    const all = new Set(report.transactions.map((t) => t.hash));
    for (const m of src.matchAll(/atlantic\.pharosscan\.xyz\/tx\/(0x[0-9a-f]{64})/g)) assert.ok(all.has(m[1]), `${file} links a transaction that is not in reports/testnet-runs.json`);
  }
});
