#!/usr/bin/env node
// The Policy Gatekeeper in front of a real wallet on Pharos Atlantic testnet.
//
//   node scripts/testnet-gatekeeper.mjs            rehearsal on a free local fork of Atlantic (no real spend)
//   node scripts/testnet-gatekeeper.mjs --live     the real testnet; writes reports/testnet-gatekeeper.json
//
// The gate (lib/audit-log.js guardedExecute + lib/policy.js) decides every request. Its executor is the guarded testnet signer, so
// an ALLOWED request becomes a real transaction and a DENIED one never reaches the signer. Time comes from the latest block header.
// Afterwards the CHAIN is asked whether the denied requests happened:
//   - recipients are brand-new addresses, so their balances must equal exactly what was allowed to them (a stranger's must be 0);
//   - the Counter id of the denied contract call must read 0;
//   - the wallet's nonce must have grown by exactly the number of allowed requests.

import { readFileSync, writeFileSync } from 'node:fs';
import { MemoryLog, guardedExecute, verifyLog } from '../lib/audit-log.js';
import { parsePolicy } from '../lib/policy.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { startFork } from '../lib/saga-fork.js';
import { makeSigner, phrs } from '../lib/testnet-signer.js';

const live = process.argv.includes('--live');
const outArg = process.argv.indexOf('--out');
const out = outArg > -1 ? process.argv[outArg + 1] : live ? 'reports/testnet-gatekeeper.json' : '/tmp/testnet-gatekeeper-rehearsal.json';
const log = (...a) => console.error(...a);
const BUDGET_WEI = 2n * 10n ** 15n; // 0.002 PHRS: the allowed transfers total 0.0002 plus gas
const counter = JSON.parse(readFileSync(new URL('../reports/testnet-runs.json', import.meta.url), 'utf8')).batch.calls.contract;
const PING = '0x773acdef';
const COUNT = '0x3b3546c8';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

let fork = null;
let RPC = ATLANTIC.rpc;
if (!live) {
  fork = await startFork({ port: 8711, forkUrl: ATLANTIC.rpc });
  RPC = fork.url;
}
const startedAt = new Date().toISOString();
const signer = makeSigner({ rpcUrl: RPC, budgetWei: BUDGET_WEI, log, startedAt });
const blockTime = async () => Number(BigInt((await signer.rpc('eth_getBlockByNumber', ['latest', false])).timestamp));
const nonceOf = async () => BigInt(await signer.rpc('eth_getTransactionCount', [signer.wallet.address, 'latest']));
const balanceOf = (a) => signer.balance(a);
const countOf = async (id) => BigInt(await signer.rpc('eth_call', [{ to: counter, data: COUNT + word(id) }, 'latest']));

try {
  // never start a run in the last minute of a UTC day: the "all day" window ends at 23:59
  let now = await blockTime();
  if (new Date(now * 1000).getUTCHours() === 23 && new Date(now * 1000).getUTCMinutes() === 59) { log('waiting out the last minute of the UTC day'); await new Promise((r) => setTimeout(r, 65_000)); now = await blockTime(); }
  const today = DAYS[new Date(now * 1000).getUTCDay()];

  const A = signer.fresh('allowed-recipient-a');
  const B = signer.fresh('allowed-recipient-b');
  const STRANGER = signer.fresh('stranger-not-on-the-allowlist');
  const pingId = Number(BigInt(Date.now()) % 900_000_000n) + 1000;

  const rules = (days) => [
    { id: 'native-spend', type: 'spend-limit', asset: 'native', symbol: 'PHRS', perRequest: '0.0002', perWindow: { amount: '0.0003', seconds: 3600 } },
    { id: 'known-targets', type: 'allowlist', field: 'target', values: [A, B, counter] },
    { id: 'known-functions', type: 'allowlist', field: 'selector', values: ['0xa9059cbb'] },
    { id: 'allowed-hours', type: 'time-window', timezone: 'UTC', days, from: '00:00', to: '23:59' },
  ];
  // The same rules twice. The second has today's weekday taken out of the time window, so the time-window rule is the one that decides.
  const policyOpen = { version: 1, name: 'testnet policy (every day)', rules: rules(DAYS) };
  const policyClosedToday = { version: 1, name: `testnet policy (not on ${today})`, rules: rules(DAYS.filter((d) => d !== today)) };
  const policies = { open: parsePolicy(policyOpen), closedToday: parsePolicy(policyClosedToday) };

  const startBalance = await signer.balance();
  const startNonce = await nonceOf();
  log(`${live ? 'LIVE on Pharos Atlantic testnet' : 'REHEARSAL on a local fork of Atlantic'}; wallet ${signer.wallet.address}, balance ${phrs(startBalance)}, nonce ${startNonce}`);
  if (startBalance < 5n * BUDGET_WEI) throw new Error(`the wallet needs at least ${phrs(5n * BUDGET_WEI)}; it has ${phrs(startBalance)}`);

  const from = signer.from;
  const send = (to, wei) => ({ from, to, value: wei });
  // expect: what the gate must answer. proof: how the chain is asked afterwards.
  const scenarios = [
    { id: 'pay-a', title: 'Pay recipient A 0.0001 PHRS', policy: 'open', request: send(A, '100000000000000'), expect: { decision: 'allow' } },
    { id: 'pay-b', title: 'Pay recipient B 0.0001 PHRS', policy: 'open', request: send(B, '100000000000000'), expect: { decision: 'allow' } },
    { id: 'too-big', title: 'Pay recipient A 0.001 PHRS (limit per request is 0.0002)', policy: 'open', request: send(A, '1000000000000000'), expect: { decision: 'deny', rule: 'native-spend' } },
    { id: 'over-the-hour', title: 'Pay recipient A 0.0002 PHRS (fine alone, but 0.0002 was already allowed this hour and the window limit is 0.0003)', policy: 'open', request: send(A, '200000000000000'), expect: { decision: 'deny', rule: 'native-spend' } },
    { id: 'stranger', title: 'Pay an address that is not on the allowlist', policy: 'open', request: send(STRANGER, '100000000000000'), expect: { decision: 'deny', rule: 'known-targets' } },
    { id: 'unlisted-function', title: 'Call Counter.ping(id): the contract is allowed, the function is not', policy: 'open', request: { from, to: counter, data: PING + word(pingId) }, expect: { decision: 'deny', rule: 'known-functions' } },
    { id: 'wrong-day', title: `Pay recipient A 0.0001 PHRS, under a policy that is closed on ${today}`, policy: 'closedToday', request: send(A, '100000000000000'), expect: { decision: 'deny', rule: 'allowed-hours' } },
    { id: 'garbage', title: 'A request that cannot be read', policy: 'open', request: { from, to: 'not-an-address' }, expect: { decision: 'deny', rule: 'request-shape' } },
  ];

  const auditLog = new MemoryLog();
  const results = [];
  for (const s of scenarios) {
    log(`\n${s.title}`);
    const nowSec = await blockTime();
    const r = await guardedExecute({
      policy: policies[s.policy], log: auditLog, request: s.request, nowSec,
      execute: (req) => signer.send({ label: s.title, to: req.to, value: BigInt(req.value ?? 0), gas: 30_000 }),
    });
    const d = r.decision;
    log(`  ${d.decision.toUpperCase()} by ${d.rule.id}: ${d.reason}`);
    results.push({
      id: s.id, title: s.title, policy: policies[s.policy].name, policyHash: policies[s.policy].hash, request: s.request, nowSec,
      decision: d.decision, rule: d.rule, reason: d.reason, checks: d.checks, executed: r.executed,
      transaction: r.executed ? r.result : null,
      decisionSeq: r.decisionEntry.seq, executionSeq: r.executionEntry.seq,
      matched: d.decision === s.expect.decision && (s.expect.rule ? d.rule.id === s.expect.rule : true) && (d.decision === 'allow' ? r.executed && r.result.status === 'success' : !r.executed),
    });
  }

  // ---- the chain is asked what really happened ----
  const entries = await auditLog.all();
  const integrity = verifyLog(entries);
  const allowedTo = (addr) => results.filter((r) => r.executed && r.request.to === addr).reduce((s, r) => s + BigInt(r.request.value), 0n);
  const proof = {
    walletNonce: { before: startNonce.toString(), after: (await nonceOf()).toString(), allowedRequests: results.filter((r) => r.executed).length },
    balances: await Promise.all([[A, 'recipient A (allowed)'], [B, 'recipient B (allowed)'], [STRANGER, 'stranger (denied)']].map(async ([address, label]) => ({ label, address, expectedWei: allowedTo(address).toString(), chainWei: (await balanceOf(address)).toString() }))),
    counter: { address: counter, id: pingId, expected: '0', chain: (await countOf(pingId)).toString() },
  };
  proof.walletNonce.ok = BigInt(proof.walletNonce.after) - BigInt(proof.walletNonce.before) === BigInt(proof.walletNonce.allowedRequests);
  for (const b of proof.balances) b.ok = b.expectedWei === b.chainWei;
  proof.counter.ok = proof.counter.expected === proof.counter.chain;
  proof.ok = proof.walletNonce.ok && proof.balances.every((b) => b.ok) && proof.counter.ok;

  const endBalance = await signer.balance();
  const record = {
    recordedAt: startedAt,
    mode: live ? 'live' : 'rehearsal on a local anvil fork of Atlantic (not real, not for the site)',
    network: { name: ATLANTIC.name, chainId: ATLANTIC.chainId, rpc: ATLANTIC.rpc, explorer: ATLANTIC.explorer },
    wallet: signer.wallet.address,
    counter,
    policies: { open: { source: policyOpen, hash: policies.open.hash }, closedToday: { source: policyClosedToday, hash: policies.closedToday.hash } },
    results,
    summary: {
      requests: results.length,
      allowed: results.filter((r) => r.decision === 'allow').length,
      denied: results.filter((r) => r.decision === 'deny').length,
      deniedByRule: Object.fromEntries([...new Set(results.filter((r) => r.decision === 'deny').map((r) => r.rule.id))].map((id) => [id, results.filter((r) => r.decision === 'deny' && r.rule.id === id).length])),
      deniedThatWereExecuted: results.filter((r) => r.decision === 'deny' && r.executed).length,
    },
    auditLog: { entries, integrity },
    proof,
    budget: { startWei: startBalance.toString(), endWei: endBalance.toString(), spentWei: (startBalance - endBalance).toString(), limitWei: BUDGET_WEI.toString() },
    transactions: signer.txs,
  };
  writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
  log(`\nwrote ${out}; spent ${phrs(startBalance - endBalance)}; balance now ${phrs(endBalance)}; audit log ${integrity.ok ? 'intact' : 'BROKEN'} (${integrity.count} entries); chain proof ${proof.ok ? 'OK' : 'FAILED'}`);
  console.log(JSON.stringify({ mode: record.mode, txs: signer.txs.length, results: results.map((r) => `${r.id}: ${r.decision} by ${r.rule.id} executed=${r.executed} matched=${r.matched}`), proofOk: proof.ok, auditIntact: integrity.ok }, null, 1));
  process.exitCode = results.every((r) => r.matched) && proof.ok && integrity.ok ? 0 : 1;
} finally {
  fork?.stop();
}
