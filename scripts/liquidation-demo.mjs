#!/usr/bin/env node
// Records the Liquidation Watchdog demo: real borrowers in Morpho Blue on Pharos mainnet, every one PINNED to a block so it can be replayed exactly.
//   node scripts/liquidation-demo.mjs        writes reports/liquidation-demo.json
import { readFileSync, writeFileSync } from 'node:fs';
import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { consoleChannel, DEFAULT_THRESHOLDS, runWatchdog } from '../lib/liquidation.js';
import { blockNumber } from '../lib/chain.js';

const positions = JSON.parse(readFileSync(new URL('../agents/liquidation-watchdog/examples/positions.json', import.meta.url), 'utf8'));
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const block = (await blockNumber(chain)) - 3000; // a little behind, so every node has it and it stays readable
  const cases = [];
  for (const p of positions) {
    process.stderr.write(`${p.id} … `);
    const thresholds = { warn: p.warn ?? DEFAULT_THRESHOLDS.warn, critical: p.critical ?? DEFAULT_THRESHOLDS.critical };
    const lines = [];
    const result = await runWatchdog({ chain, marketId: p.marketId, borrower: p.borrower, block, thresholds, channels: [consoleChannel((s) => lines.push(s))] });
    process.stderr.write(`${result.level}${result.healthFactor ? ` (HF ${result.healthFactor.toFixed(4)})` : ''}, ${result.chainCalls} Chain MCP + ${result.rpcCalls} RPC calls, alert ${result.alertSent ? 'sent' : 'not needed'}\n`);
    cases.push({ ...p, thresholds, block, result, consoleOutput: lines });
  }
  const record = { recordedAt: new Date().toISOString(), network: { name: 'Pharos Pacific Mainnet', chainId: 1672 }, note: 'Every case is pinned to one mainnet block, so replaying it asks Chain MCP the same questions and must get the same position, health factor and alert. Nothing is sent to anyone but the console.', cases };
  writeFileSync(new URL('../reports/liquidation-demo.json', import.meta.url), JSON.stringify(record, null, 1) + '\n');
  console.log(`wrote reports/liquidation-demo.json: ${cases.map((c) => `${c.id}=${c.result.level}`).join(', ')}`);
} finally {
  await chain.close();
}
