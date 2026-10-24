import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testnetEvidence, verifyTx } from '../lib/testnet-report.js';
import run from '../lib/tasks/saga-executor.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const rec = JSON.parse(file('../reports/testnet-saga.json'));
const sc = (key, engine) => rec.scenarios.find((s) => s.key === key && s.engine === engine);

test('the proof ran on Pharos Atlantic testnet (688689) with real transactions from the throwaway wallet, inside its budget', () => {
  assert.equal(rec.network.chainId, 688689);
  assert.equal(rec.mode, 'live');
  assert.match(rec.wallet, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(rec.transactions.length, 16);
  assert.equal(rec.transactionsSent, 16, 'the wallet’s nonce grew by exactly the number of transactions recorded');
  assert.equal(new Set(rec.transactions.map((t) => t.hash)).size, 16);
  for (const t of rec.transactions) {
    assert.match(t.hash, /^0x[0-9a-f]{64}$/);
    assert.equal(t.status, 'success', t.label);
    assert.equal(t.from.toLowerCase(), rec.wallet.toLowerCase());
  }
  assert.ok(BigInt(rec.budget.spentWei) < BigInt(rec.budget.limitWei));
  assert.equal(rec.transactions[0].contractAddress.toLowerCase(), rec.ledger.address.toLowerCase());
});

test('every check passed, in all four runs', () => {
  assert.equal(rec.summary.checks, 10);
  assert.equal(rec.summary.passed, 10);
  assert.deepEqual(rec.scenarios.map((s) => `${s.key}/${s.engine}`), ['receipt-timeout/before the fix', 'receipt-timeout/current', 'executed-but-unverified/before the fix', 'executed-but-unverified/current']);
  for (const s of rec.scenarios) assert.ok(s.checks.every((c) => c.ok), `${s.key}/${s.engine}`);
});

test('a receipt that times out after the send: the old engine ran step 2 three times on chain, the current one once', () => {
  const before = sc('receipt-timeout', 'before the fix');
  const now = sc('receipt-timeout', 'current');
  assert.equal(before.transactions.filter((t) => t.tag === 'credit step2').length, 3);
  assert.equal(before.chainReadings[1].balance, '3', 'the chain’s ledger counts three credits for step 2');
  assert.equal(before.status, 'compensated', 'and the old engine then undid only step 1, leaving the triple credit behind');
  assert.equal(now.status, 'completed');
  assert.deepEqual(now.transactions.map((t) => t.tag), ['credit step1', 'credit step2', 'credit step3']);
  assert.deepEqual(now.chainReadings.map((r) => r.balance), ['1', '1', '1']);
  assert.ok(now.log.filter((e) => e.event === 'step:retry').every((e) => /not sending it twice/.test(e.why)));
  assert.equal(now.log.filter((e) => e.event === 'step:retry' && /injected network fault/.test(e.error)).length, 2, 'the two injected timeouts are on record and labelled');
});

test('a step that executed but failed its check: the old engine left its effect on chain, the current one undid it', () => {
  const before = sc('executed-but-unverified', 'before the fix');
  const now = sc('executed-but-unverified', 'current');
  assert.equal(before.chainReadings[1].balance, '1', 'step 2’s credit is still on the chain');
  assert.equal(before.transactions.map((t) => t.tag).join(' > '), 'credit step1 > credit step2 > debit step1');
  assert.equal(now.transactions.map((t) => t.tag).join(' > '), 'credit step1 > credit step2 > debit step2 > debit step1');
  assert.deepEqual(now.chainReadings.map((r) => r.balance), ['0', '0', '0']);
  assert.equal(now.status, 'compensated');
  assert.equal(now.log.find((e) => e.event === 'step:failed').mined, true);
});

test('the report holds no secret', () => {
  const text = file('../reports/testnet-saga.json');
  assert.equal(/"privateKey"\s*:/i.test(text), false);
  try {
    const key = JSON.parse(file('../.wallet/atlantic-testnet.json')).privateKey;
    assert.equal(text.includes(key), false);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
});

test('the live check re-reads every recorded transaction; a chain that disagrees is reported, not hidden', async () => {
  const byHash = new Map(rec.transactions.map((t) => [t.hash, t]));
  const honest = async (method, params) => {
    if (method === 'eth_blockNumber') return '0x10';
    if (method === 'eth_getBalance') return '0x1';
    const t = byHash.get(params[0]);
    if (method === 'eth_getTransactionReceipt') return { status: t.status === 'success' ? '0x1' : '0x0', gasUsed: '0x' + t.gasUsed.toString(16), blockNumber: '0x' + t.blockNumber.toString(16), from: t.from, to: t.contractAddress ? null : t.to, contractAddress: t.contractAddress ?? null };
    return { from: t.from, to: t.contractAddress ? null : t.to, value: '0x0' };
  };
  const ok = await testnetEvidence({ report: rec, rpc: honest, now: () => 0 });
  assert.equal(ok.verification.verifiedCount, 16);
  const liar = async (method, params) => { const r = await honest(method, params); return method === 'eth_getTransactionReceipt' && params[0] === rec.transactions[3].hash ? { ...r, status: '0x0' } : r; };
  const bad = await testnetEvidence({ report: rec, rpc: liar, now: () => 0 });
  assert.equal(bad.verification.verifiedCount, 15);
  assert.match(bad.verification.results[rec.transactions[3].hash].reason, /status/);
  assert.equal(typeof verifyTx, 'function');
});

test('the API serves the proof under real=testnet, and the page mounts it for the saga task', async () => {
  const src = file('../public/js/tasks/saga-executor.js');
  assert.match(src, /mountTestnet\(.*kind: 'saga'/);
  assert.match(file('../public/js/panels/testnet.js'), /kind === 'saga' \? sagaView/);
  assert.equal(typeof run, 'function');
  await assert.rejects(run({ q: { real: 'nope' } }), /real=testnet/);
});
