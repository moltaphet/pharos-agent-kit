#!/usr/bin/env node
// Should this wallet move its USDC to a better vault? Rates, whether the vaults let the wallet in and out, gas and fees, and the net gain over the holding period.
//   node skills/pharos-yield-optimizer/scripts/optimize.mjs --wallet 0x… [--from auto|idle|<vault id>] [--amount 10000] [--min-hold-days 30] [--min-net-gain 10] [--block N] [--json] [--out run.json]
// Run from the repository root. Read-only: it prepares unsigned transactions for you to sign and never holds a key. Exit code: 0 move, 10 stay put, 1 error.
import { readFile, writeFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { DEFAULTS, gasTableFrom, optimize } from '../../../lib/yield-optimizer.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const wallet = arg('wallet');
if (!wallet) { console.error('Usage: optimize.mjs --wallet 0x… [--from auto|idle|<vault id>] [--amount 10000] [--min-hold-days 30] [--min-net-gain 10] [--block N] [--json] [--out run.json]'); process.exit(1); }
const chain = new McpClient(PHAROS_CHAIN_MCP);
const pct = (x) => (x == null ? '?' : `${(x * 100).toFixed(2)}%`);
const usd = (x) => (x == null ? '–' : Math.abs(x) < 0.01 && x !== 0 ? `$${x.toFixed(4)}` : `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
try {
  const gas = gasTableFrom(JSON.parse(await readFile(new URL('../../../reports/yield-fork-run.json', import.meta.url), 'utf8')));
  const r = await optimize({ chain, wallet, gas, from: arg('from', 'auto'), amount: arg('amount', null), minHoldDays: Number(arg('min-hold-days', DEFAULTS.minHoldDays)), minNetGainUsd: Number(arg('min-net-gain', DEFAULTS.minNetGainUsd)), block: arg('block') ? Number(arg('block')) : null });
  console.log(`\nwallet ${r.wallet} · block ${r.block.number.toLocaleString('en-US')} · ${r.block.iso}`);
  if (r.source) console.log(`from: ${r.source.label}, ${r.source.amountText}, earning ${pct(r.source.apy)} a year`);
  console.log('');
  for (const c of r.candidates) {
    console.log(`${c.viable ? '✓' : '✗'} ${c.name}`);
    console.log(`    pays ${pct(c.apy)} a year${c.apyEarly != null ? ` (${pct(c.apyEarly)} then ${pct(c.apyLate)}${c.steady ? '' : ', uneven'})` : ''} · let in: ${c.enter.eligible ? 'yes' : 'NO'} · can be redeemed: ${c.redeemable ? 'yes' : 'NO'} · gas ${usd(c.gasUsd)} · fees ${usd(c.feeUsd)} · net over ${r.assumptions.minHoldDays} days ${usd(c.net)}`);
    for (const why of c.rejected) console.log(`    - ${why}`);
  }
  console.log(`\n${r.recommendation.headline}\n  ${r.recommendation.reason}`);
  if (r.prepared) {
    console.log(`\nTransactions to sign, in order (UNSIGNED; nothing was sent):`);
    r.prepared.transactions.forEach((t, i) => console.log(`  ${i + 1}. ${t.label}\n     to ${t.to}  value 0  gas limit ${t.gasLimit.toLocaleString('en-US')}\n     data ${t.data.slice(0, 74)}…\n     checked: ${t.simulated}`));
    console.log(`\n${r.prepared.note}`);
  }
  console.log(`\n${r.chainCalls} Chain MCP calls, ${r.rpcCalls} public RPC calls (every batch of reads is repeated there). Gas: ${r.assumptions.gasFrom}.`);
  if (arg('out')) await writeFile(arg('out'), JSON.stringify(r, null, 2) + '\n');
  if (has('json')) console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.recommendation.action === 'move' ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
