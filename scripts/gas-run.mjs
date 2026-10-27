#!/usr/bin/env node
// The Gas Fee Optimizer, run for real. Reads: the gas price history of Pharos mainnet and of Atlantic testnet. Transactions: four REAL transfers on Atlantic testnet (chain 688689,
// the throwaway wallet): what a naive wallet pays (a legacy transaction at the price eth_gasPrice quotes), and the optimizer's three modes (favourable at once, hold to the deadline
// because the ceiling is below the network's floor, and automatic target). Every transaction is read back from the chain for the gas it really paid. Nothing is sent to mainnet.
//
//   node scripts/gas-run.mjs        writes reports/gas-run.json

import { writeFileSync } from 'node:fs';
import { makeSigner } from '../lib/testnet-signer.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { rpcCall } from '../lib/rpc.js';
import { fmtGwei, gasHistory, sampleGas, submitWithin } from '../lib/gas.js';

const say = (s) => process.stderr.write(s + '\n');
const signer = makeSigner({ rpcUrl: ATLANTIC.rpc, log: say, budgetWei: 5n * 10n ** 15n });
const atl = signer.rpc;
const main = (m, p = []) => rpcCall(m, p, { why: `gas run: ${m}` });
const ser = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const out = [];
const recipient = (label) => signer.fresh?.(label) ?? '0x' + [...label].reduce((h, c) => (h * 131 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(40, '0');

say('history …');
const [mainHist, atlHist] = [await gasHistory(main, { span: 3000, points: 30 }), await gasHistory(atl, { span: 3000, points: 30 })];
const mainNow = await sampleGas(main);
const atlNow = await sampleGas(atl);
say(`  mainnet: base fee ${fmtGwei(mainNow.baseFee)}, eth_gasPrice ${fmtGwei(mainNow.gasPrice)}; Atlantic: base fee ${fmtGwei(atlNow.baseFee)}, eth_gasPrice ${fmtGwei(atlNow.gasPrice)}`);

// a transfer of 1 wei to a new address: 21,000 gas, the same payload in every scenario
const submitter = (label) => async (fees) => {
  const tx = await signer.send({ label, to: recipient(label), value: 1n, gas: 21000, fees });
  const r = await atl('eth_getTransactionReceipt', [tx.hash]);
  const t = await atl('eth_getTransactionByHash', [tx.hash]);
  return { hash: tx.hash, gasUsed: Number(BigInt(r.gasUsed)), effectiveGasPrice: BigInt(r.effectiveGasPrice), block: Number(BigInt(r.blockNumber)), status: r.status === '0x1' ? 'success' : 'reverted', type: t.type, maxFeePerGas: t.maxFeePerGas ?? null, maxPriorityFeePerGas: t.maxPriorityFeePerGas ?? null };
};

// 1. what a naive wallet pays: sign at the price eth_gasPrice quotes
say('1. naive wallet: a legacy transaction at the quoted gas price …');
const quoted = atlNow.gasPrice;
const naiveTx = await submitter('naive legacy at eth_gasPrice')({ legacy: true, gasPrice: quoted });
out.push({ id: 'naive', title: 'A naive wallet: a legacy transaction at the price eth_gasPrice quotes', quotedGasPrice: quoted, tx: naiveTx, costWei: BigInt(naiveTx.gasUsed) * naiveTx.effectiveGasPrice });

// 2-4. the optimizer
const runMode = async (id, title, { maxPrice, history, deadlineSec }) => {
  say(`${id}: ${title}`);
  const t0 = Date.now();
  const r = await submitWithin({ sampler: () => sampleGas(atl), submit: submitter(`optimizer: ${id}`), deadlineMs: t0 + deadlineSec * 1000, maxPrice, history, pollMs: 5000, leadMs: 4000, onSample: (s) => say(`  t+${(s.t / 1000).toFixed(1)}s block ${s.block}: price ${fmtGwei(s.price)} vs target ${fmtGwei(s.target)} → ${s.favorable ? 'favourable' : 'hold'}`) });
  say(`  → ${r.reason}: submitted after ${(r.heldMs / 1000).toFixed(1)}s, ${r.submittedBeforeDeadline ? 'before' : 'AFTER'} the deadline; paid ${fmtGwei(r.paid.effectiveGasPrice)}`);
  out.push({ id, title, deadlineSec, maxPrice: maxPrice ?? null, ...r });
};
await runMode('favorable-now', 'Ceiling 2 gwei, the network is at its floor: submit at once', { maxPrice: 2n * 10n ** 9n, deadlineSec: 60 });
await runMode('hold-to-deadline', 'Ceiling 0.5 gwei is below the network floor: hold, then submit at the deadline anyway', { maxPrice: 5n * 10n ** 8n, deadlineSec: 40 });
await runMode('auto-target', 'No ceiling: the target is the 25th percentile of the last 3,000 blocks', { history: atlHist, deadlineSec: 60 });

const optimized = out.filter((o) => o.id !== 'naive');
const report = {
  recordedAt: new Date().toISOString(),
  network: 'History read from Pharos mainnet (chain 1672) and Atlantic testnet (688689); four real transactions on Atlantic testnet from the throwaway wallet. Nothing was sent to mainnet.',
  history: { mainnet: { now: mainNow, ...mainHist }, atlantic: { now: atlNow, ...atlHist } },
  scenarios: out,
  summary: {
    naiveCostWei: out[0].costWei, optimizedCostWei: optimized.map((o) => o.paid.costWei), allBeforeDeadline: optimized.every((o) => o.submittedBeforeDeadline),
    holdSubmittedAtDeadline: optimized.find((o) => o.id === 'hold-to-deadline').reason === 'deadline', savedPercent: Math.round((1 - Number(optimized[0].paid.costWei) / Number(out[0].costWei)) * 1000) / 10,
    gasFlat: { mainnet: mainHist.stats.flat, atlantic: atlHist.stats.flat },
  },
};
writeFileSync(new URL('../reports/gas-run.json', import.meta.url), JSON.stringify(ser(report), null, 1) + '\n');
console.log(`wrote reports/gas-run.json: naive ${out[0].costWei} wei vs optimized ${optimized.map((o) => o.paid.costWei).join(', ')}; all submitted before the deadline: ${report.summary.allBeforeDeadline}`);
process.exitCode = report.summary.allBeforeDeadline && report.summary.holdSubmittedAtDeadline ? 0 : 1;
