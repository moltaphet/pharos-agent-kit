#!/usr/bin/env node
// Ask a question about a wallet on Pharos mainnet; every number comes with the contract, the call and the block it was read from.
//   node skills/pharos-portfolio-assistant/scripts/ask.mjs --wallet 0x… --question "Where is my USDC?" [--block N] [--json] [--out run.json]
// Run from the repository root. Read-only: no key, nothing is sent. Exit code: 0 answered, 10 could not answer that question, 1 error.
import { writeFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { askPortfolio, SUPPORTED_QUESTIONS } from '../../../lib/portfolio.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const wallet = arg('wallet');
const question = arg('question');
if (!wallet || !question) { console.error(`Usage: ask.mjs --wallet 0x… --question "…" [--block N] [--json] [--out run.json]\nQuestions it understands:\n  ${SUPPORTED_QUESTIONS.join('\n  ')}`); process.exit(1); }
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const r = await askPortfolio({ chain, wallet, question, block: arg('block') ? Number(arg('block')) : null });
  console.log(`\n${question}\nwallet ${r.wallet} · block ${r.block.number.toLocaleString('en-US')} · ${r.block.iso}\n\n${r.answer.text}\n`);
  if (r.answer.figures.length) {
    console.log('Figures');
    for (const f of r.answer.figures) console.log(`  ${f.label}: ${f.value}   [source${f.sources.length > 1 ? 's' : ''} ${f.sources.join(', ')}]`);
    console.log('\nSources');
    for (const s of r.answer.sources) console.log(`  [${s.n}] ${s.contract ?? 'Multicall3'}  ${s.call}  block ${s.block.toLocaleString('en-US')}  (${s.tool}; ${s.integrity === 'confirmed' ? 'confirmed on the public RPC' : s.integrity === 'resolved' ? 'confirmed after a second read' : 'NOT confirmed on the public RPC'})`);
  }
  for (const c of r.answer.caveats) console.log(`\nNote: ${c}`);
  console.log(`\n${r.chainCalls} Chain MCP calls, ${r.rpcCalls} public RPC calls (every batch of reads is repeated there)`);
  if (arg('out')) await writeFile(arg('out'), JSON.stringify(r, null, 2) + '\n');
  if (has('json')) console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.answer.known ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
