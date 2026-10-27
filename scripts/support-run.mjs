#!/usr/bin/env node
// The dApp Support Agent, run on real failed transactions. On Pharos MAINNET: four transactions that really failed (found by scanning receipts), diagnosed through Chain MCP.
// On Pharos ATLANTIC testnet: this script makes nine transactions fail on purpose (throwaway wallets, test tokens, contracts deployed for the demo), each a different kind of failure,
// and diagnoses every one. The diagnoses are recorded; the transactions stay on chain, so anyone can repeat them.
//
//   node scripts/support-run.mjs        writes reports/support-run.json and config/support-demo.json

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { makeSigner } from '../lib/testnet-signer.js';
import { failLabBytecode } from '../lib/testnet-contracts.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { rpcCall } from '../lib/rpc.js';
import { selectorOf } from '../lib/keccak.js';
import { diagnose, mcpTools, rpcTools } from '../lib/support.js';

const say = (s) => process.stderr.write(s + '\n');
const DIR = fileURLToPath(new URL('../', import.meta.url));
const demoFile = new URL('../config/support-demo.json', import.meta.url);
const risk = JSON.parse(readFileSync(new URL('../config/risk-demo.json', import.meta.url), 'utf8'));
const x402 = JSON.parse(readFileSync(new URL('../config/x402.json', import.meta.url), 'utf8'));
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const atl = (m, p = []) => rpcCall(m, p, { url: ATLANTIC.rpc, why: `support run: ${m}` });

// ---- 1. the failures on Atlantic ---------------------------------------------------------------------------------------------------------
let demo = existsSync(demoFile) ? JSON.parse(readFileSync(demoFile, 'utf8')) : null;
if (!demo?.complete) {
  const me = makeSigner({ rpcUrl: ATLANTIC.rpc, log: say, budgetWei: 5n * 10n ** 15n });
  const fresh = makeSigner({ rpcUrl: ATLANTIC.rpc, log: say, walletFile: DIR + '.wallet/risk-fresh.json', budgetWei: 2n * 10n ** 15n });
  say('deploying FailLab …');
  const lab = demo?.failLab ?? (await me.send({ label: 'deploy FailLab', to: null, create: failLabBytecode(), gas: 400_000 })).contractAddress;
  const RISKY = risk.riskyToken; const USDC = x402.asset; const OTHER = '0x000000000000000000000000000000000000dEaD';
  const failures = demo?.failures ?? [];
  const save = (complete = false) => writeFileSync(demoFile, JSON.stringify({ network: 'Pharos Atlantic testnet (688689)', failLab: lab, failures, complete, note: 'Made to fail on purpose by scripts/support-run.mjs, with throwaway wallets and test tokens.' }, null, 1) + '\n');
  // saved after every failure, so a dropped connection can be resumed; "could not send" happens before anything reaches the chain, so one retry is safe
  const fail = async (id, title, signer, tx) => {
    if (failures.some((f) => f.id === id)) return;
    let r;
    for (let i = 0; ; i++) { try { r = await signer.send({ label: `fail: ${id}`, ...tx }); break; } catch (e) { if (i >= 2 || !/error sending request/.test(e.message)) throw e; await new Promise((x) => setTimeout(x, 2000)); } }
    if (r.status !== 'reverted') throw new Error(`${id} did not fail: ${r.status}`);
    failures.push({ id, title, hash: r.hash }); save();
  };
  await fail('not-authorized', 'A stranger calls the token’s owner-only mint()', fresh, { to: RISKY, data: selectorOf('mint(address,uint256)') + addrWord(fresh.from) + word(1), gas: 100_000 });
  await fail('insufficient-balance', 'Sending far more USDC than the account holds', me, { to: USDC, data: selectorOf('transfer(address,uint256)') + addrWord(OTHER) + word(10n ** 15n), gas: 100_000 });
  await fail('insufficient-allowance', 'Spending someone else’s USDC without an approval', me, { to: USDC, data: selectorOf('transferFrom(address,address,uint256)') + addrWord(fresh.from) + addrWord(me.from) + word(5), gas: 100_000 });
  if (!failures.some((f) => f.id === 'paused')) await me.send({ label: 'pause the risky token', to: RISKY, data: selectorOf('pause()'), gas: 80_000 });
  await fail('paused', 'Moving tokens while the contract is paused', me, { to: RISKY, data: selectorOf('transfer(address,uint256)') + addrWord(OTHER) + word(0), gas: 100_000 });
  if ((await atl('eth_call', [{ to: RISKY, data: selectorOf('paused()') }, 'latest'])) !== '0x' + '0'.repeat(64)) await me.send({ label: 'unpause the risky token', to: RISKY, data: selectorOf('unpause()'), gas: 80_000 });
  await fail('out-of-gas', 'A gas limit set too low for a contract call', me, { to: RISKY, data: selectorOf('mint(address,uint256)') + addrWord(me.from) + word(1), gas: 30_000 });
  await fail('panic', 'A contract that divides by zero', me, { to: lab, data: selectorOf('divide(uint256,uint256)') + word(1) + word(0), gas: 100_000 });
  await fail('custom-error', 'A payment smaller than the contract’s minimum (a custom error)', me, { to: lab, data: selectorOf('atLeast(uint256)') + word(10), value: 3n, gas: 100_000 });
  await fail('not-payable', 'Attaching PROS to a function that does not accept it', me, { to: RISKY, data: selectorOf('transfer(address,uint256)') + addrWord(OTHER) + word(0), value: 1n, gas: 100_000 });
  await fail('wrong-function', 'Calling a function the contract does not have', me, { to: USDC, data: '0x12345678', gas: 100_000 });
  save(true);
  demo = JSON.parse(readFileSync(demoFile, 'utf8'));
  await new Promise((r) => setTimeout(r, 3000));
}

// ---- 2. diagnose everything ---------------------------------------------------------------------------------------------------------------
const client = new McpClient(PHAROS_CHAIN_MCP, { label: 'support-run' });
const mainnet = [
  ['mainnet-slippage', 'A swap that moved past its price limit (Uniswap V3 code SPL)', '0xf7fc5fcc273c9dd0fdbbb3e15ba90d4f902409f50ac5f812fffa108b73d797b1'],
  ['mainnet-allowance', 'A transfer the spender was not approved for', '0xe8b01dc91222df4f54aa3e07ad25404da394f2e9b32e08eaf9e73eac9bd09586'],
  ['mainnet-state', 'A call that works on the state before its block (something changed first)', '0xcc0a673a516d492450aab88554ef4b48a45d88e5ea1f3727ac1250f2fb7066e8'],
  ['mainnet-custom', 'A call refused with a custom error of a contract with no public ABI here', '0x5560f21df22c69b4a8b422d73c5d37607c3528cec140fc66c33ba0251415c47c'],
];
const cases = [];
try {
  for (const [id, title, hash] of mainnet) {
    say(`mainnet ${id} …`);
    const d = await diagnose({ hash, tools: mcpTools(client) });
    cases.push({ id, chain: 'mainnet', title, hash, explorer: `https://www.pharosscan.xyz/tx/${hash}`, diagnosis: d });
  }
  for (const f of demo.failures) {
    say(`atlantic ${f.id} …`);
    const d = await diagnose({ hash: f.hash, tools: rpcTools(atl, 'Atlantic RPC'), explorer: 'https://atlantic.pharosscan.xyz' });
    cases.push({ id: f.id, chain: 'atlantic', title: f.title, hash: f.hash, explorer: `https://atlantic.pharosscan.xyz/tx/${f.hash}`, diagnosis: d });
  }
} finally { await client.close(); }
const report = { recordedAt: new Date().toISOString(), network: 'Pharos mainnet (read-only, via Chain MCP) and Pharos Atlantic testnet (failures made on purpose)', demo, cases, summary: { cases: cases.length, categories: [...new Set(cases.map((c) => c.diagnosis.category))] } };
const bj = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 1);
writeFileSync(new URL('../reports/support-run.json', import.meta.url), bj(report) + '\n');
for (const c of cases) console.log(`${c.id.padEnd(24)} ${c.diagnosis.category.padEnd(26)} ${c.diagnosis.headline}`);
console.log(`wrote reports/support-run.json: ${cases.length} failures, ${report.summary.categories.length} different categories`);
