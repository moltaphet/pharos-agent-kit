#!/usr/bin/env node
// Real transactions on Pharos Atlantic testnet for the Dry-Run Executor and the Batch Executor.
//
//   node scripts/testnet-run.mjs                 rehearsal on a free local anvil fork of Atlantic (no real spend)
//   node scripts/testnet-run.mjs --live          the real testnet; writes reports/testnet-runs.json
//
// The sender is the throwaway wallet in .wallet/atlantic-testnet.json (testnet only, git-ignored). `cast` can only take a raw
// key as `--private-key`, so the key is on that process's argument list for the second each send takes (visible to other
// users of this machine, which is acceptable for a throwaway key holding test tokens); it is never printed or logged.
// Every send is guarded: the chain id must be 688689 (so it can never reach mainnet), and the run stops if it would spend
// more than the budget.
//
// What it proves: the Dry-Run Executor's simulation is compared with what the chain then did, and the Batch Executor's
// planned gas saving is compared with the real gas of three separate transactions against one Multicall3 transaction.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATLANTIC, rpcChain } from '../lib/rpc-chain.js';
import { makeSigner, phrs } from '../lib/testnet-signer.js';
import { startFork } from '../lib/saga-fork.js';
import { dryRun } from '../lib/tasks/dry-run-executor.js';
import { planBatch } from '../lib/tasks/batch-executor.js';
import { encodeAddress } from '../lib/abi.js';
import { counterBytecode } from '../lib/testnet-contracts.js';

const live = process.argv.includes('--live');
const outArg = process.argv.indexOf('--out');
const out = outArg > -1 ? process.argv[outArg + 1] : live ? 'reports/testnet-runs.json' : '/tmp/testnet-rehearsal.json';
const BUDGET_WEI = 10n ** 16n; // 0.01 PHRS: the most a run may spend on gas and transfers (we hold 0.05)
const log = (...a) => console.error(...a);

const FROM = JSON.parse(readFileSync(fileURLToPath(new URL('../.wallet/atlantic-testnet.json', import.meta.url)), 'utf8')).address.toLowerCase();
const wallet = { address: FROM };

let fork = null;
let RPC = ATLANTIC.rpc;
if (!live) {
  fork = await startFork({ port: 8700, forkUrl: ATLANTIC.rpc });
  RPC = fork.url;
}
const chain = rpcChain({ url: RPC, name: ATLANTIC.name, chainId: ATLANTIC.chainId });

// ---- helpers ---------------------------------------------------------------------------------------------------------
const startedAt = new Date().toISOString();
const signer = makeSigner({ rpcUrl: RPC, budgetWei: BUDGET_WEI, log, startedAt });
const { send, txs, fresh, rpc } = signer;
const fmt = phrs;
const balance = signer.balance;
const startBalance = await balance(FROM);

try {
  log(`${live ? 'LIVE on Pharos Atlantic testnet' : 'REHEARSAL on a local fork of Atlantic'}; wallet ${wallet.address}, balance ${fmt(startBalance)}`);
  if (startBalance < 2n * BUDGET_WEI) throw new Error(`the wallet needs at least ${fmt(2n * BUDGET_WEI)}; it has ${fmt(startBalance)}`);
  const head = Number(BigInt(await rpc('eth_blockNumber')));

  // ================= Dry-Run Executor =================
  log('\nDry-Run Executor');
  const cases = [];

  // 1. A transfer that should pass: simulate, send, compare.
  {
    const to = fresh('dry-1');
    const tx = { from: FROM, to, data: '0x', value: '1' };
    const report = await dryRun({ chain }, tx);
    const c = { id: 'native-transfer', title: 'Send 1 wei: simulated GO, then really sent', input: tx, report: slim(report), sent: null, check: null };
    if (report.verdict === 'go') {
      const before = await balance(to);
      const t = await send({ label: 'dry-run: 1 wei transfer', to, value: 1n, gas: report.gas.suggestedLimit });
      const after = await balance(to);
      c.sent = t;
      c.check = { predicted: 'success', actual: t.status, predictedGas: report.gas.units, actualGas: t.gasUsed, gasErrorPct: (Math.abs(t.gasUsed - report.gas.units) / t.gasUsed) * 100, recipientGained: (after - before).toString(), matched: t.status === 'success' && after - before === 1n };
    }
    cases.push(c);
  }

  // 2. A transfer the wallet cannot afford: must be blocked, and is never sent.
  {
    const tx = { from: FROM, to: fresh('dry-2'), data: '0x', value: (startBalance + 10n ** 18n).toString() };
    const report = await dryRun({ chain }, tx);
    cases.push({ id: 'unaffordable', title: 'Send more than the wallet holds: simulated BLOCKED, never sent', input: tx, report: slim(report), sent: null, check: { predicted: 'revert', actual: 'not sent', matched: report.verdict === 'blocked' } });
  }

  // 3. An ERC-20 transfer the wallet has no balance for: blocked; then, to PROVE the prediction, sent anyway with a fixed gas limit.
  {
    const to = fresh('dry-3');
    const data = '0xa9059cbb' + encodeAddress(to) + (1_000_000n).toString(16).padStart(64, '0');
    const tx = { from: FROM, to: ATLANTIC.usdc, data, value: '0' };
    const report = await dryRun({ chain }, tx);
    const c = { id: 'token-revert', title: 'Send 1 USDC the wallet does not have: simulated BLOCKED, then sent anyway to check the prediction', input: { ...tx, data: data.slice(0, 10) + '…' }, report: slim(report), sent: null, check: null };
    if (report.verdict === 'blocked') {
      const t = await send({ label: 'dry-run: forced USDC transfer (predicted to revert)', to: ATLANTIC.usdc, data, gas: 120_000 });
      c.sent = t;
      c.check = { predicted: 'revert', actual: t.status, gasWasted: t.gasUsed, matched: t.status === 'reverted' };
    }
    cases.push(c);
  }

  // ================= Batch Executor =================
  log('\nBatch Executor');
  const action = (id, to) => ({ id, to, amountPros: '0.000000000000000001' }); // 1 wei each
  const mk = (tag) => ['a', 'b', 'c'].map((x) => action(`${tag}-${x}`, fresh(`${tag}-${x}`)));

  // Same three transfers, once as three transactions and once as one Multicall3 transaction; every recipient a fresh account.
  const soloActions = mk('solo');
  const soloPlan = await planBatch({ chain }, { from: FROM, actions: soloActions });
  const soloTxs = [];
  for (const [i, a] of soloActions.entries()) {
    const planned = soloPlan.actions[i].soloGas;
    soloTxs.push({ ...(await send({ label: `batch: separate transfer ${a.id}`, to: a.to, value: 1n, gas: Math.ceil(planned * 1.3) })), plannedGas: planned });
  }

  const batchActions = mk('batch');
  const plan = await planBatch({ chain }, { from: FROM, actions: batchActions });
  const batchTx = await send({ label: 'batch: one Multicall3 transaction with 3 transfers', to: plan.batch.to, data: plan.batch.data, value: BigInt(plan.batch.value), gas: Math.ceil(plan.batch.gas * 1.3) });
  const gained = await Promise.all(batchActions.map((a) => balance(a.to)));
  const soloTotal = soloTxs.reduce((s, t) => s + t.gasUsed, 0);

  // A batch where one action cannot work: policy "exclude" leaves it out and sends the rest, for real.
  const exTo = [fresh('ex-a'), fresh('ex-b')];
  const exActions = [action('ex-a', exTo[0]), action('ex-b', exTo[1]), { id: 'ex-bad', to: fresh('ex-bad'), amountPros: '1000000' }];
  const exPlan = await planBatch({ chain }, { from: FROM, actions: exActions, onFailure: 'exclude' });
  const exTx = await send({ label: 'batch: policy exclude (unaffordable action left out)', to: exPlan.batch.to, data: exPlan.batch.data, value: BigInt(exPlan.batch.value), gas: Math.ceil(exPlan.batch.gas * 1.3) });
  const exGained = await Promise.all(exTo.map(balance));

  // Calls that really do save gas: three state-changing calls to a contract we deploy, each with its own id so every call starts
  // from the same state, once as three transactions and once as one. (The planner's estimates are made from today's state,
  // which is exactly the state each separate call starts from.)
  log('\nBatch Executor: contract calls');
  const deploy = await send({ label: 'batch: deploy the Counter contract', to: null, create: counterBytecode(), gas: 250_000 });
  const counter = deploy.contractAddress;
  // The planners pin to two blocks behind the head (every backend node has it), so wait until the new contract is that old.
  const visibleAt = deploy.blockNumber + 3;
  if (!live) await rpc('anvil_mine', ['0x3']);
  else for (let i = 0; i < 90 && Number(BigInt(await rpc('eth_blockNumber'))) < visibleAt; i++) await new Promise((x) => setTimeout(x, 1500));
  const ping = (id) => '0x773acdef' + BigInt(id).toString(16).padStart(64, '0');
  const count = async (id) => BigInt(await rpc('eth_call', [{ to: counter, data: '0x3b3546c8' + BigInt(id).toString(16).padStart(64, '0') }, 'latest']));
  const callActions = (base) => [1, 2, 3].map((i) => ({ id: `ping-${base + i}`, to: counter, data: ping(base + i), amountPros: '0' }));
  const soloCalls = callActions(100);
  const soloCallPlan = await planBatch({ chain }, { from: FROM, actions: soloCalls });
  const soloCallTxs = [];
  for (const [i, a] of soloCalls.entries()) {
    const planned = soloCallPlan.actions[i].soloGas;
    soloCallTxs.push({ ...(await send({ label: `batch: separate call ${a.id}`, to: counter, data: a.data, gas: Math.ceil(planned * 1.3) })), plannedGas: planned });
  }
  const batchCalls = callActions(200);
  const callPlan = await planBatch({ chain }, { from: FROM, actions: batchCalls });
  const callBatchTx = await send({ label: 'batch: one Multicall3 transaction with 3 calls', to: callPlan.batch.to, data: callPlan.batch.data, value: 0n, gas: Math.ceil(callPlan.batch.gas * 1.3) });
  const counts = await Promise.all([101, 102, 103, 201, 202, 203].map(count));
  const soloCallTotal = soloCallTxs.reduce((x, t) => x + t.gasUsed, 0);
  const calls = {
    contract: counter,
    deployment: deploy,
    separate: { transactions: soloCallTxs, totalGas: soloCallTotal, plannedGasTotal: soloCallPlan.comparison?.soloGasTotal },
    batched: { transaction: callBatchTx, plannedGas: callPlan.batch.gas, plannedSaving: callPlan.comparison, everyCallLanded: counts.every((c) => c === 1n) },
    realComparison: { gasSeparate: soloCallTotal, gasBatched: callBatchTx.gasUsed, gasSaved: soloCallTotal - callBatchTx.gasUsed, gasSavedPct: ((soloCallTotal - callBatchTx.gasUsed) / soloCallTotal) * 100, plannedGasSavedPct: callPlan.comparison.gasSavedPct },
  };

  const endBalance = await balance(FROM);
  const result = {
    recordedAt: startedAt,
    mode: live ? 'live' : 'rehearsal on a local anvil fork of Atlantic (not real, not for the site)',
    network: { name: ATLANTIC.name, chainId: ATLANTIC.chainId, rpc: ATLANTIC.rpc, explorer: ATLANTIC.explorer, headAtStart: head },
    wallet: wallet.address,
    budget: { startWei: startBalance.toString(), endWei: endBalance.toString(), spentWei: (startBalance - endBalance).toString(), limitWei: BUDGET_WEI.toString() },
    dryRun: { cases },
    batch: {
      transfers: {
        separate: { transactions: soloTxs, totalGas: soloTotal, plannedGasTotal: soloPlan.comparison?.soloGasTotal },
        batched: { transaction: batchTx, plannedGas: plan.batch.gas, plannedSaving: plan.comparison, recipientsFunded: gained.every((g) => g === 1n) },
        realComparison: { gasSeparate: soloTotal, gasBatched: batchTx.gasUsed, gasSaved: soloTotal - batchTx.gasUsed, gasSavedPct: ((soloTotal - batchTx.gasUsed) / soloTotal) * 100, plannedGasSavedPct: plan.comparison.gasSavedPct },
      },
      calls,
      exclude: { included: exPlan.included, excluded: exPlan.excluded, transaction: exTx, recipientsFunded: exGained.every((g) => g === 1n), plan: { verdict: exPlan.verdict, summary: exPlan.summary } },
    },
    transactions: txs,
  };
  writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  log(`\nwrote ${out}; spent ${fmt(startBalance - endBalance)}; balance now ${fmt(endBalance)}`);
  console.log(JSON.stringify({ mode: result.mode, txs: txs.length, spentPHRS: Number(startBalance - endBalance) / 1e18, dryRun: cases.map((c) => `${c.id}: ${c.report.verdict} / ${c.check?.matched}`), batch: { transfers: result.batch.transfers.realComparison, calls: result.batch.calls.realComparison, everyCallLanded: calls.batched.everyCallLanded } }, null, 1));
} finally {
  fork?.stop();
}

function slim(r) {
  return { block: r.block, verdict: r.verdict, summary: r.summary, prediction: r.prediction, revert: r.revert ? { message: r.revert.message, kind: r.revert.kind } : null, gas: r.gas, outcome: r.outcome ? { kind: r.outcome.kind, summary: r.outcome.summary, rows: r.outcome.rows } : null };
}
