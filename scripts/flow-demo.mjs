#!/usr/bin/env node
// Records the demo of the Skill + Chain MCP flow: real requests run through lib/flow.js against Pharos mainnet, each PINNED to a
// block so anyone can replay it later and get the same chain data (the page's Replay button does exactly that).
//   node scripts/flow-demo.mjs        writes reports/flow-demo.json
import { readFileSync, writeFileSync } from 'node:fs';
import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { runFlow } from '../lib/flow.js';

const dir = new URL('../skills/pharos-transfer-preflight/examples/', import.meta.url);
const policy = JSON.parse(readFileSync(new URL('policy.json', dir), 'utf8'));
const requests = JSON.parse(readFileSync(new URL('requests.json', dir), 'utf8')).filter((r) => r.block != null);
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const cases = [];
  for (const r of requests) {
    process.stderr.write(`${r.id} @ ${r.block} … `);
    const result = await runFlow({ chain, text: r.text, policy, block: r.block });
    process.stderr.write(`${result.verdict.status.toUpperCase()}${result.verdict.rule ? ` by ${result.verdict.rule.id}` : ''}, ${result.chainCalls} Chain MCP calls\n`);
    cases.push({ id: r.id, title: r.label, text: r.text, block: r.block, result });
  }
  const record = {
    recordedAt: new Date().toISOString(),
    network: { name: 'Pharos Pacific Mainnet', chainId: 1672, mcp: PHAROS_CHAIN_MCP },
    note: 'Each case is pinned to a mainnet block. Replaying it later asks Chain MCP the same questions at the same block; only the head and the gas price (no block parameter) are current.',
    policy,
    cases,
  };
  writeFileSync(new URL('../reports/flow-demo.json', import.meta.url), JSON.stringify(record, null, 1) + '\n');
  console.log(`wrote reports/flow-demo.json: ${cases.map((c) => `${c.id}=${c.result.verdict.status}`).join(', ')}`);
} finally {
  await chain.close();
}
