#!/usr/bin/env node
// The Recurring Payment Agent run end to end on a REAL EVM: a throwaway fork of Pharos mainnet (anvil, fake funds) with the live USDC contract. The agent prepares
// each payment as an unsigned transaction; the script plays the person who signs it (an impersonated payer: no key is read or needed) and tells the agent what happened.
// Every number below is read from the chain, not from the agent's own records.
//
//   week 0   three weekly periods are already due                        → the oldest is prepared (with its reference)
//   sign it  the payment is mined and its hash reported                  → paid, confirmed from the receipt and the Transfer log
//   fail     the next payment is sent with too little gas: it reverts    → failed; a retry is prepared; nothing was moved
//   lost     the retry is mined but the hash is never reported           → found on chain by the scan, so it is paid and NOT prepared again
//   poor     the payer's USDC drops below the amount                     → blocked: nothing is prepared, nothing can be paid twice
//   top up   the balance is restored                                     → prepared, signed, paid
//   guard    reporting a paid period again, or reusing a hash             → refused
//   proof    the payee holds exactly three payments
//
//   node scripts/recurring-fork-run.mjs        writes reports/recurring-fork-run.json   (needs Foundry: anvil 1.4.0)

import { writeFileSync } from 'node:fs';
import { startFork } from '../lib/saga-fork.js';
import { tick } from '../lib/recurring.js';
import { USDC } from '../lib/protocols.js';
import { usdcStateDiff } from '../lib/defi.js';
import { forkChain } from './support/fork-chain.mjs';

const PAYER = '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f'; // holds ~942,942 USDC on mainnet
const PAYEE = '0x000000000000000000000000000000000000b0b0'; // a fresh address: its USDC balance is the proof
const AMOUNT = '25';
const fork = await startFork({ port: 8630 });
const url = fork.url;
const raw = async (method, params = []) => {
  const r = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (r.error) throw Object.assign(new Error(r.error.message), { rpc: r.error });
  return r.result;
};
const usdcOf = async (who) => BigInt(await raw('eth_call', [{ to: USDC, data: '0x70a08231' + who.slice(2).padStart(64, '0') }, 'latest']));
const setUsdc = async (who, balance) => { for (const [slot, value] of Object.entries(usdcStateDiff({ owner: who, spender: '0x000000000000000000000000000000000000dEaD', allowance: 0, balance })[USDC].stateDiff)) if (slot.length) await raw('anvil_setStorageAt', [USDC, slot, value]); };
const mine = (n = 3) => raw('anvil_mine', ['0x' + n.toString(16)]);
const say = (s) => process.stderr.write(s + '\n');

const timeline = [];
try {
  const forkStart = Number(BigInt(await raw('eth_blockNumber')));
  await raw('anvil_impersonateAccount', [PAYER]);
  await raw('anvil_setBalance', [PAYER, '0x' + (10n ** 19n).toString(16)]); // PROS for gas, on the fork only (on mainnet this wallet has none: it is a smart-contract wallet)
  await mine(8);
  const chain = forkChain(raw);
  const start = (await raw('eth_getBlockByNumber', ['latest', false])).timestamp;
  const startTs = Math.floor(Number(BigInt(start)) / 60) * 60 - 15 * 86400; // three weekly periods are due: 15, 8 and 1 days ago
  const schedule = { id: 'rent-demo', label: 'Rent, every week', payer: PAYER, payee: PAYEE, token: 'USDC', amount: AMOUNT, frequency: 'weekly', start: new Date(startTs * 1000).toISOString().slice(0, 16) };
  let state = null;
  const step = async (label, opts = {}) => {
    await mine();
    const r = await tick({ chain, rpc: raw, schedule, state, ...opts });
    state = r.state;
    const row = { label, block: r.block, clock: r.clock, counts: r.counts, periods: r.periods.map((p) => ({ period: p.period, dueIso: p.dueIso, status: p.status, hash: p.evidence?.hash ?? p.failure?.hash ?? p.submitted?.hash ?? null, how: p.evidence?.how ?? null, reason: p.failure?.reason ?? null, attempts: p.attempts ?? null })), action: r.action && { period: r.action.period, kind: r.action.kind, reason: r.action.reason ?? null, reference: r.action.reference ?? null, retry: r.action.retry ?? null, summary: r.action.summary ?? null, transaction: r.action.transaction && { to: r.action.transaction.to, data: r.action.transaction.data, gas: r.action.transaction.gas, walletRequest: r.action.transaction.walletRequest } }, notices: r.notices.map((n) => n.text), next: r.next, scan: r.scan, history: r.history, chainCalls: r.chainCalls, rpcCalls: r.rpcCalls };
    timeline.push(row);
    say(`${label}: paid ${r.counts.paid} · pending ${r.counts.pending} · submitted ${r.counts.submitted} · failed ${r.counts.failed} · upcoming ${r.counts.upcoming}; action: ${r.action ? r.action.kind + ' for period ' + r.action.period : 'none'}`);
    return r;
  };
  const sign = async (action, { gas } = {}) => {
    const p = { ...action.transaction.walletRequest.params[0], ...(gas && { gas: '0x' + gas.toString(16) }) };
    delete p.chainId;
    const hash = await raw('eth_sendTransaction', [p]);
    await mine();
    const receipt = await raw('eth_getTransactionReceipt', [hash]);
    return { hash, status: receipt.status === '0x1' ? 'success' : 'reverted', gasUsed: Number(BigInt(receipt.gasUsed)) };
  };

  const r0 = await step('1. first look: three periods are due');
  const sent0 = await sign(r0.action);
  say(`   signed and mined: ${sent0.status}`);
  await step('2. the signed payment is reported', { report: { period: r0.action.period, hash: sent0.hash } });
  const balanceAfterFirst = await usdcOf(PAYEE);

  const r2 = timeline.at(-1);
  const preparedNext = r2.action;
  const failedTx = await sign({ transaction: { walletRequest: preparedNext.transaction.walletRequest } }, { gas: 30_000 });
  say(`   sent with too little gas: ${failedTx.status}`);
  const moved = await usdcOf(PAYEE);
  const r3 = await step('3. a payment fails on chain and is reported', { report: { period: preparedNext.period, hash: failedTx.hash } });
  const balanceAfterFailure = await usdcOf(PAYEE);

  const retryAction = r3.action;
  const retryTx = await sign(retryAction);
  say(`   retry mined but never reported: ${retryTx.status}`);
  const r4 = await step('4. the retry landed; nobody reported it');

  await setUsdc(PAYER, 10n);
  const r5 = await step('5. the payer’s balance is below the amount');
  const balanceWhilePoor = await usdcOf(PAYEE);
  await setUsdc(PAYER, 500_000_000n);
  const r6 = await step('6. the balance is restored');
  const lastTx = await sign(r6.action);
  const r7 = await step('7. the last payment is signed and reported', { report: { period: r6.action.period, hash: lastTx.hash } });

  // the guards
  const guards = [];
  const tryIt = async (what, fn) => { try { await fn(); guards.push({ what, refused: false }); } catch (e) { guards.push({ what, refused: true, message: e.message }); } };
  await tryIt('report a second transaction for a period that is already paid, using a hash that was already used', () => tick({ chain, rpc: raw, schedule, state, report: { period: 0, hash: sent0.hash } }));
  await tryIt('report the retry’s hash for a different period', () => tick({ chain, rpc: raw, schedule, state, report: { period: 2, hash: retryTx.hash } }));
  await tryIt('report a malformed hash', () => tick({ chain, rpc: raw, schedule, state, report: { period: 2, hash: '0x1234' } }));
  const r8 = await step('8. a look after everything is paid');

  const payeeFinal = await usdcOf(PAYEE);
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const logs = await raw('eth_getLogs', [{ address: USDC, topics: [TRANSFER, '0x' + PAYER.slice(2).padStart(64, '0'), '0x' + PAYEE.slice(2).padStart(64, '0')], fromBlock: '0x' + forkStart.toString(16), toBlock: 'latest' }]);
  const transfers = [];
  for (const l of logs) { const tx = await raw('eth_getTransactionByHash', [l.transactionHash]); transfers.push({ hash: l.transactionHash, amount: BigInt(l.data).toString(), reference: Buffer.from(tx.input.slice(2 + 8 + 128), 'hex').toString('utf8') }); }
  const perReference = Object.fromEntries([0, 1, 2].map((k) => [`rp:rent-demo:${k}`, transfers.filter((t) => t.reference === `rp:rent-demo:${k}`).length]));
  const report = {
    recordedAt: new Date().toISOString(),
    network: 'local anvil fork of Pharos mainnet (chain 1672): the live USDC contract, fake funds; the payer is impersonated, no key is read',
    schedule, amountPerPeriod: AMOUNT, payer: PAYER, payee: PAYEE,
    timeline,
    guards,
    proof: {
      payeeBalances: { afterFirstPayment: balanceAfterFirst.toString(), whileOneTransferHadFailed: moved.toString(), afterFailureReported: balanceAfterFailure.toString(), whilePayerWasPoor: balanceWhilePoor.toString(), final: payeeFinal.toString() },
      expectedFinal: (3n * 25_000_000n).toString(),
      transfersOnChain: transfers, transfersPerReference: perReference,
      exactlyOncePerPeriod: payeeFinal === 3n * 25_000_000n && Object.values(perReference).every((n) => n === 1) && transfers.length === 3,
      failedTransaction: failedTx, firstTransaction: sent0, retryTransaction: retryTx, lastTransaction: lastTx,
      periodsPaid: r8.counts.paid,
    },
  };
  writeFileSync(new URL('../reports/recurring-fork-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  console.log(`wrote reports/recurring-fork-run.json: the payee holds ${Number(payeeFinal) / 1e6} USDC after ${r8.counts.paid} paid periods (expected 75); exactly once each: ${report.proof.exactlyOncePerPeriod}`);
  void [r4, r5, r7];
  process.exitCode = report.proof.exactlyOncePerPeriod ? 0 : 1;
} finally {
  fork.stop?.();
}
