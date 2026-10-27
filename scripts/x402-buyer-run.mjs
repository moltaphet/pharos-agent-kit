#!/usr/bin/env node
// The x402 Agent Buyer, run for real on Pharos Atlantic testnet (chain 688689): real HTTP to the facilitator + paywalled server of task 20 (separate processes),
// real EIP-3009 settlements, each read back from the chain. Three jobs: one completes, one stops at its budget, one skips an endpoint that is not worth its price.
//
//   node scripts/x402-buyer-run.mjs     writes reports/x402-buyer-run.json   (needs scripts/x402-setup.mjs to have run)

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { rpcCall } from '../lib/rpc.js';
import { selectorOf } from '../lib/keccak.js';
import { runBuyerJob } from '../lib/x402-buyer.js';

const config = JSON.parse(readFileSync(new URL('../config/x402.json', import.meta.url), 'utf8'));
const payerKey = JSON.parse(readFileSync(fileURLToPath(new URL('../.wallet/x402-payer.json', import.meta.url)), 'utf8')).privateKey;
const facilitatorKeyFile = fileURLToPath(new URL('../.wallet/atlantic-testnet.json', import.meta.url));
const rpc = (method, params) => rpcCall(method, params, { url: ATLANTIC.rpc, why: `x402 buyer run: ${method}` });
const say = (s) => process.stderr.write(s + '\n');
const balanceOf = async (who) => BigInt(await rpc('eth_call', [{ to: config.asset, data: selectorOf('balanceOf(address)') + who.replace(/^0x/, '').toLowerCase().padStart(64, '0') }, 'latest']));
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const env = { ...process.env, FACILITATOR_PRIVATE_KEY_FILE: facilitatorKeyFile, FACILITATOR_URL: 'http://127.0.0.1:4132' };
delete env.FACILITATOR_PRIVATE_KEY;
const children = [];
const start = (script, port) => new Promise((resolve, reject) => {
  const p = spawn('node', [script], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(p);
  let out = '';
  p.stdout.on('data', (d) => { out += d; if (/ on http/.test(out)) resolve(out.trim()); });
  p.stderr.on('data', (d) => { out += d; });
  p.on('exit', (code) => reject(new Error(`${script} exited ${code}: ${out}`)));
  setTimeout(() => reject(new Error(`${script} did not start: ${out}`)), 15000);
});

// each settlement the buyer reports is read back from the chain: it must be a successful transfer of exactly the price from the payer to payTo
async function verifyOnChain(payments) {
  const rows = [];
  for (const p of payments) {
    const receipt = await rpc('eth_getTransactionReceipt', [p.transaction]);
    const log = receipt?.logs.find((l) => l.address.toLowerCase() === config.asset && l.topics[0] === TRANSFER);
    const from = log && '0x' + log.topics[1].slice(26);
    const to = log && '0x' + log.topics[2].slice(26);
    const value = log && BigInt(log.data).toString();
    rows.push({ item: p.item, transaction: p.transaction, explorer: p.explorer, block: receipt ? Number(BigInt(receipt.blockNumber)) : null, status: receipt?.status === '0x1' ? 'success' : 'missing', from, to, value,
      matches: Boolean(log) && receipt.status === '0x1' && from.toLowerCase() === config.payer.toLowerCase() && to.toLowerCase() === config.payTo.toLowerCase() && value === p.price });
  }
  return rows;
}

let report;
try {
  say('starting the facilitator and the paywalled server (task 20) …');
  say('  ' + await start('agents/x402-paywalled-api/facilitator.js', 4132));
  say('  ' + await start('agents/x402-paywalled-api/server.js', 4131));
  const base = 'http://127.0.0.1:4131';
  const tasks = [
    { id: 'protocol-summary', name: 'Protocol summary', url: `${base}/api/info`, value: '5000' },
    { id: 'market-data', name: 'Market data', url: `${base}/data`, value: '10000' },
  ];
  const common = { privateKey: payerKey, maxPerCall: '10000', expectedAsset: config.asset };
  const scenarios = [
    { id: 'complete', title: 'Job completed within budget', plan: tasks, budget: '15000' },
    { id: 'budget-stop', title: 'Stopped at the budget before buying the second endpoint', plan: tasks, budget: '7000' },
    { id: 'not-worth-it', title: 'Skipped an endpoint whose price is above its estimated value', plan: [tasks[0], { ...tasks[1], value: '9000' }], budget: '15000' },
  ];
  const before = { payer: await balanceOf(config.payer), payTo: await balanceOf(config.payTo) };
  say(`balances before: payer ${before.payer}, payTo ${before.payTo}`);
  const out = [];
  for (const s of scenarios) {
    const b0 = { payer: await balanceOf(config.payer), payTo: await balanceOf(config.payTo) };
    const result = await runBuyerJob({ ...common, tasks: s.plan, budget: s.budget });
    const chain = await verifyOnChain(result.payments);
    const b1 = { payer: await balanceOf(config.payer), payTo: await balanceOf(config.payTo) };
    const moved = b0.payer - b1.payer;
    const row = { id: s.id, title: s.title, plan: s.plan.map(({ id, name, value }) => ({ id, name, value })), budget: s.budget, result, chain, tokenMoved: moved.toString(), ledgerAgreesWithChain: moved === BigInt(result.spent) && chain.every((c) => c.matches) && BigInt(b1.payTo - b0.payTo) === moved };
    out.push(row);
    say(`  ${s.id}: ${result.status}${result.stopReason ? ` (${result.stopReason})` : ''} · spent ${result.spent} · token moved ${moved} · ledger agrees with chain: ${row.ledgerAgreesWithChain}`);
  }
  // the buyer's CLI-level refusal with no key must not reach the signer
  const keyless = await runBuyerJob({ tasks, budget: '15000', maxPerCall: '10000', expectedAsset: config.asset });
  report = {
    recordedAt: new Date().toISOString(),
    network: 'Pharos Atlantic testnet (688689): real HTTP to the task-20 facilitator and server, real settlement transactions on a test USDC deployed for this demo',
    asset: config.asset, payer: config.payer, payTo: config.payTo, balancesBefore: { payer: String(before.payer), payTo: String(before.payTo) },
    scenarios: out, noKey: { status: keyless.status, stopReason: keyless.stopReason, spent: keyless.spent },
    summary: { scenarios: out.length, allAgree: out.every((s) => s.ledgerAgreesWithChain), transactions: out.reduce((n, s) => n + s.chain.length, 0) },
  };
  writeFileSync(new URL('../reports/x402-buyer-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  console.log(`wrote reports/x402-buyer-run.json: ${report.summary.transactions} real settlement(s), ledger vs chain ${report.summary.allAgree ? 'agree' : 'DISAGREE'}`);
  process.exitCode = report.summary.allAgree ? 0 : 1;
} finally {
  for (const c of children) c.kill();
}
