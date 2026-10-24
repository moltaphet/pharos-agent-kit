#!/usr/bin/env node
// The Saga Executor's two retry/undo rules, proved on the REAL Pharos Atlantic testnet (chain 688689), not on a fork and not with a fake executor:
//
//   1. A transient error AFTER a step was sent (the receipt lookup times out) must not send the step again.
//   2. A step that executed but failed its check has changed the chain, so it must be undone together with the earlier steps.
//
// Every transaction is real: it is signed by the throwaway testnet wallet (.wallet/, git-ignored, test tokens only; lib/testnet-signer.js refuses any
// chain but 688689), mined on Atlantic, and the result is read back from the chain. The saga steps call a tiny Ledger contract deployed for this run:
// `credit(id)` is the step, `debit(id)` its compensation, and `balance(id)` tells the chain's own count of how many times the step really ran.
//
// The only thing injected is the network trouble itself: the first receipt lookups after a send throw "request timed out" (labelled as injected in the
// log). The sends, the mining and the state reads are all real. Each scenario is run twice, with scripts/support/saga-before-fix.js (the engine as it
// was before the fix) and with lib/saga.js (now), so the difference is on chain: the old engine credited a step three times, the current one once.
//
//   node scripts/testnet-saga.mjs        writes reports/testnet-saga.json   (needs .wallet/atlantic-testnet.json with a little PHRS and Foundry)

import { writeFileSync } from 'node:fs';
import { runSaga as runNow } from '../lib/saga.js';
import { runSaga as runBefore } from './support/saga-before-fix.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { makeSigner, phrs } from '../lib/testnet-signer.js';
import { ledgerBytecode } from '../lib/testnet-contracts.js';
import { selectorOf } from '../lib/keccak.js';

const BUDGET_WEI = 3n * 10n ** 15n; // 0.003 PHRS for the whole run
const startedAt = new Date().toISOString();
const log = (s) => process.stderr.write(s + '\n');
const signer = makeSigner({ rpcUrl: ATLANTIC.rpc, budgetWei: BUDGET_WEI, log, startedAt });
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const SEL = { credit: selectorOf('credit(uint256)'), debit: selectorOf('debit(uint256)'), balance: selectorOf('balance(uint256)') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const head0 = Number(BigInt(await signer.rpc('eth_blockNumber')));
const balance0 = await signer.balance();
const nonce0 = Number(BigInt(await signer.rpc('eth_getTransactionCount', [signer.wallet.address, 'latest'])));
log(`Atlantic head ${head0}, wallet ${signer.wallet.address}, ${phrs(balance0)}`);

// ---- the contract -------------------------------------------------------------------------------------------------------------------------
const deploy = await signer.send({ label: 'deploy the Ledger contract', to: null, create: ledgerBytecode(), gas: 300_000 });
const ledger = deploy.contractAddress.toLowerCase();
const deployBlock = deploy.blockNumber;
await sleep(4000); // a new contract is invisible to a node that is a block or two behind the one that mined it

const readBalance = async (id) => BigInt(await signer.rpc('eth_call', [{ to: ledger, data: SEL.balance + word(id) }, 'latest']));
// Reads until the chain shows `want` (a node a block behind would show the old value), or the last value seen after 30 s.
async function settled(id, want) {
  let v = null;
  for (let i = 0; i < 30; i++) {
    v = await readBalance(id);
    if (v === want) return v;
    await sleep(1000);
  }
  return v;
}

// ---- an executor that really sends and really reads receipts; only the network trouble is injected ------------------------------------------------
function realExec(saga, { receiptFaults = {} } = {}) {
  const left = { ...receiptFaults }; // step tag -> how many receipt lookups still time out after its send
  const sent = [];
  const byHash = new Map();
  return {
    sent,
    async send(tx) {
      const t = await signer.send({ label: `${saga}: ${tx.tag}`, to: tx.to, data: tx.data, gas: 120_000 });
      sent.push({ tag: tx.tag, hash: t.hash, status: t.status, blockNumber: t.blockNumber, gasUsed: t.gasUsed });
      byHash.set(t.hash, tx.tag);
      return t.hash;
    },
    async receipt(hash) {
      const tag = byHash.get(hash);
      if ((left[tag] ?? 0) > 0) { left[tag]--; throw new Error('request timed out (injected network fault: the transaction is already mined)'); }
      const r = await signer.rpc('eth_getTransactionReceipt', [hash]);
      if (!r) throw new Error('request timed out: no receipt yet');
      return { hash, status: r.status === '0x1' ? 'success' : 'reverted', blockNumber: Number(BigInt(r.blockNumber)), gasUsed: Number(BigInt(r.gasUsed)) };
    },
  };
}

// One saga step per id: credit(id), verified against the chain's own balance, undone by debit(id).
function step(name, id, { wrongCheck = false } = {}) {
  return {
    id: name, title: `credit ${name}`,
    tx: () => ({ to: ledger, data: SEL.credit + word(id), tag: `credit ${name}` }),
    async verify() {
      const got = await settled(id, 1n);
      if (wrongCheck) return `the ledger shows ${got} for ${name}, but the check insists on 2`; // a post-condition that is not met
      return got === 1n ? true : `the ledger shows ${got} for ${name}, expected 1`;
    },
    compensate: {
      title: `debit ${name}`,
      tx: () => ({ to: ledger, data: SEL.debit + word(id), tag: `debit ${name}` }),
      async verify() { const got = await settled(id, 0n); return got === 0n ? true : `the ledger still shows ${got} for ${name}`; },
    },
  };
}

const idFor = (label) => BigInt('0x' + signer.fresh(label).slice(2, 18)); // a fresh id per run and label, so every count starts at 0
const fast = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 1000 };

async function scenario({ key, title, engine, engineName, steps, faults, expect }) {
  log(`\n== ${key} (${engineName}): ${title}`);
  const exec = realExec(key, { receiptFaults: faults });
  const result = await engine({ name: key, steps: steps.map((s) => s.step), exec, policy: fast });
  const readings = [];
  for (const s of steps) readings.push({ step: s.step.id, id: s.id.toString(), balance: (await settled(s.id, s.expectBalance)).toString(), expected: s.expectBalance.toString() });
  const checks = expect(result, exec, readings);
  for (const c of checks) log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.what}`);
  return { key, title, engine: engineName, status: result.status, failure: result.failure, steps: result.steps.map((s) => ({ id: s.id, state: s.state, attempts: s.attempts })), log: result.log.map(({ t, event, step, attempt, error, why, txHash, mined }) => ({ t, event, step, attempt, error, why, txHash, mined })), transactions: exec.sent, chainReadings: readings, checks };
}

const out = [];

// 1. The receipt of the second step times out twice AFTER it was really sent and mined.
for (const [engine, engineName] of [[runBefore, 'before the fix'], [runNow, 'current']]) {
  const ids = [idFor(`a-${engineName}-1`), idFor(`a-${engineName}-2`), idFor(`a-${engineName}-3`)];
  const fixed = engineName === 'current';
  out.push(await scenario({
    key: `receipt-timeout`, title: 'the receipt lookup of step 2 times out twice after the transaction was sent', engine, engineName,
    steps: ids.map((id, i) => ({ id, step: step(`step${i + 1}`, id), expectBalance: fixed ? 1n : (i === 1 ? 3n : i === 0 ? 0n : 0n) })),
    faults: { 'credit step2': 2 },
    expect: (r, exec, readings) => fixed ? [
      { what: 'the saga completed', ok: r.status === 'completed' },
      { what: 'exactly three transactions were sent: step 2 was asked about again, not sent again', ok: exec.sent.length === 3 },
      { what: 'the chain’s own ledger shows each step credited exactly once', ok: readings.every((x) => x.balance === '1') },
    ] : [
      { what: 'the old engine sent step 2 three times', ok: exec.sent.filter((s) => s.tag === 'credit step2').length === 3 },
      { what: 'so the chain’s ledger shows step 2 credited 3 times (the step ran three times)', ok: readings[1].balance === '3' },
    ],
  }));
}

// 2. Step 2 executes, then fails its check.
for (const [engine, engineName] of [[runBefore, 'before the fix'], [runNow, 'current']]) {
  const ids = [idFor(`b-${engineName}-1`), idFor(`b-${engineName}-2`), idFor(`b-${engineName}-3`)];
  const fixed = engineName === 'current';
  out.push(await scenario({
    key: `executed-but-unverified`, title: 'step 2 is mined, then its post-condition is not met', engine, engineName,
    steps: [{ id: ids[0], step: step('step1', ids[0]), expectBalance: 0n }, { id: ids[1], step: step('step2', ids[1], { wrongCheck: true }), expectBalance: fixed ? 0n : 1n }, { id: ids[2], step: step('step3', ids[2]), expectBalance: 0n }],
    faults: {},
    expect: (r, exec, readings) => fixed ? [
      { what: 'the saga ended compensated', ok: r.status === 'compensated' },
      { what: 'step 2 was undone first, then step 1', ok: exec.sent.map((s) => s.tag).join(' > ') === 'credit step1 > credit step2 > debit step2 > debit step1' },
      { what: 'the chain’s ledger is back to 0 for every id: nothing is left behind', ok: readings.every((x) => x.balance === '0') },
    ] : [
      { what: 'the old engine undid only step 1', ok: exec.sent.map((s) => s.tag).join(' > ') === 'credit step1 > credit step2 > debit step1' },
      { what: 'so step 2’s credit is still on chain: its effect was never undone', ok: readings[1].balance === '1' },
    ],
  }));
}

const nonce1 = Number(BigInt(await signer.rpc('eth_getTransactionCount', [signer.wallet.address, 'latest'])));
const balance1 = await signer.balance();
const allChecks = out.flatMap((s) => s.checks);
const report = {
  recordedAt: new Date().toISOString(),
  mode: 'live',
  network: { name: ATLANTIC.name, chainId: ATLANTIC.chainId, rpc: ATLANTIC.rpc, explorer: ATLANTIC.explorer, headAtStart: head0 },
  wallet: signer.wallet.address,
  ledger: { address: ledger, deployedAtBlock: deployBlock, source: 'contracts/Ledger.sol' },
  note: 'Real transactions on Pharos Atlantic testnet. Only the network trouble is injected (a receipt lookup that times out after the transaction is already mined); every send, every receipt and every balance is the chain’s. Each scenario runs with the engine as it was before the fix and with the current one.',
  budget: { startWei: balance0.toString(), endWei: balance1.toString(), spentWei: (balance0 - balance1).toString(), limitWei: BUDGET_WEI.toString() },
  transactionsSent: nonce1 - nonce0,
  summary: { checks: allChecks.length, passed: allChecks.filter((c) => c.ok).length },
  scenarios: out,
  transactions: signer.txs.map((t) => ({ ...t, from: signer.wallet.address.toLowerCase(), to: t.to ?? undefined })),
};
writeFileSync(new URL('../reports/testnet-saga.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log(`wrote reports/testnet-saga.json: ${report.summary.passed}/${report.summary.checks} checks, ${report.transactions.length} real transactions, spent ${phrs(balance0 - balance1)}`);
process.exitCode = report.summary.passed === report.summary.checks ? 0 : 1;
