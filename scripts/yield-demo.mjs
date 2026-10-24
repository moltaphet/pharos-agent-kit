#!/usr/bin/env node
// Records the Yield Optimizer demo: real wallets on Pharos mainnet, each case PINNED to a block so the decision can be replayed exactly. The gas figures come from
// reports/yield-fork-run.json (made by scripts/yield-fork-run.mjs, which really performs the steps on a mainnet fork).
//   node scripts/yield-demo.mjs        writes reports/yield-demo.json
import { readFileSync, writeFileSync } from 'node:fs';
import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { DEFAULTS, gasTableFrom, optimize } from '../lib/yield-optimizer.js';
import { blockNumber } from '../lib/chain.js';

const cases = JSON.parse(readFileSync(new URL('../skills/pharos-yield-optimizer/examples/cases.json', import.meta.url), 'utf8'));
const gas = gasTableFrom(JSON.parse(readFileSync(new URL('../reports/yield-fork-run.json', import.meta.url), 'utf8')));
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const block = (await blockNumber(chain)) - 3000;
  const out = [];
  for (const c of cases) {
    process.stderr.write(`${c.id} … `);
    const rec = { ...c, block, minHoldDays: DEFAULTS.minHoldDays, minNetGainUsd: DEFAULTS.minNetGainUsd };
    const result = await optimize({ chain, gas, wallet: c.wallet, from: c.from, amount: c.amount, block, minHoldDays: rec.minHoldDays, minNetGainUsd: rec.minNetGainUsd });
    process.stderr.write(`${result.recommendation.action.toUpperCase()}${result.recommendation.to ? ' → ' + result.recommendation.to : ''}, ${result.chainCalls} Chain MCP + ${result.rpcCalls} RPC calls\n`);
    out.push({ ...rec, result });
  }
  writeFileSync(new URL('../reports/yield-demo.json', import.meta.url), JSON.stringify({ recordedAt: new Date().toISOString(), network: { name: 'Pharos Pacific Mainnet', chainId: 1672 }, note: 'Each case is pinned to one mainnet block. The vault reads, rates, eligibility checks and fork-measured gas repeat exactly; the live gas price does not.', cases: out }, null, 1) + '\n');
  console.log(`wrote reports/yield-demo.json: ${out.map((c) => `${c.id}=${c.result.recommendation.action}`).join(', ')}`);
} finally {
  await chain.close();
}
