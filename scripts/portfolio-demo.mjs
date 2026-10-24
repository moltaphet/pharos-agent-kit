#!/usr/bin/env node
// Records the Portfolio Assistant demo: real questions about real wallets on Pharos mainnet, every one PINNED to a block so it can be replayed exactly.
//   node scripts/portfolio-demo.mjs        writes reports/portfolio-demo.json
import { readFileSync, writeFileSync } from 'node:fs';
import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { askPortfolio } from '../lib/portfolio.js';
import { blockNumber } from '../lib/chain.js';

const dir = new URL('../skills/pharos-portfolio-assistant/examples/', import.meta.url);
const wallets = Object.fromEntries(JSON.parse(readFileSync(new URL('wallets.json', dir), 'utf8')).map((w) => [w.id, w]));
const questions = JSON.parse(readFileSync(new URL('questions.json', dir), 'utf8'));
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const block = (await blockNumber(chain)) - 3000; // a little behind, so every node has it and it stays readable for days
  const cases = [];
  for (const q of questions) {
    const w = wallets[q.wallet];
    process.stderr.write(`${q.id} (${w.id}) … `);
    const result = await askPortfolio({ chain, wallet: w.wallet, question: q.question, block });
    process.stderr.write(`${result.answer.intent}, ${result.answer.figures.length} figures, ${result.chainCalls} Chain MCP + ${result.rpcCalls} RPC calls, ${result.integrity.confirmed + result.integrity.resolved}/${result.integrity.batches} batches confirmed\n`);
    cases.push({ id: q.id, walletId: w.id, wallet: w.wallet, walletLabel: w.label, question: q.question, block, result });
  }
  const record = { recordedAt: new Date().toISOString(), network: { name: 'Pharos Pacific Mainnet', chainId: 1672 }, note: 'Every case is pinned to one mainnet block, so replaying it asks Chain MCP the same questions at the same block.', cases };
  writeFileSync(new URL('../reports/portfolio-demo.json', import.meta.url), JSON.stringify(record, null, 1) + '\n');
  console.log(`wrote reports/portfolio-demo.json: ${cases.map((c) => `${c.id}=${c.result.answer.intent}`).join(', ')}`);
} finally {
  await chain.close();
}
