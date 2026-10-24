#!/usr/bin/env node
// Task: Docs MCP + Chain MCP Agent.
// Explains a contract function with Developer Docs MCP, calls it through Chain MCP, and reads the result in the light of the explanation.
// Read-only: the call is an eth_call, nothing is sent.

import { McpClient, PHAROS_CHAIN_MCP, PHAROS_DOCS_MCP } from '../../lib/mcp.js';
import { runAgent } from '../../lib/docs-chain.js';
import { fail, parseCli } from '../../lib/cli.js';

const usage = `Usage: pharos-explain --contract 0x… --function "latestAnswer()(int256)" [options]

Explain a contract function from the Pharos docs, call it on mainnet, and read the answer the way the docs say.

  pharos-explain --contract 0x8b5db228fbccf588f08b073c235254acb6791d36 --function "latestAnswer()(int256)"
  pharos-explain --contract 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 --function "balanceOf(address)(uint256)" --arg 0xb7d5d299c671e4a4c7c0c5a33b812185182fc417

Options:
  --contract <0x…>     the contract to explain and call
  --function <sig>     written like cast: name(inputs)(outputs)
  --arg <value>        an argument for the call (repeat for several)
  --block <n>          pin everything to this block (default: two behind the latest)
  --out <file>         write the full run (every step) as JSON
  --json               print the full run as JSON
  -h, --help           show this help

Exit codes: 0 explained and called · 10 called but not explained, or stopped · 1 error`;

const { values } = parseCli({
  usage,
  options: { contract: { type: 'string' }, function: { type: 'string' }, arg: { type: 'string', multiple: true, default: [] }, block: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' } },
});
if (!values.contract || !values.function) fail('--contract and --function are required', usage);

const chain = new McpClient(PHAROS_CHAIN_MCP);
const docs = new McpClient(PHAROS_DOCS_MCP, { retries: 1, timeoutMs: 50_000, retryTimeouts: false });
let exitCode = 0;
try {
  const r = await runAgent({ chain, docs, contract: values.contract, signature: values.function, args: values.arg, block: values.block ? Number(values.block) : null });
  if (values.out) (await import('node:fs/promises')).writeFile(values.out, JSON.stringify(r, null, 2) + '\n');
  if (values.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`\n${r.request.signature} on ${r.request.contract}\nblock ${r.block.number.toLocaleString('en-US')} · ${r.block.iso}\n`);
    for (const s of r.steps) {
      const who = { agent: 'AGENT     ', 'docs-mcp': 'DOCS MCP  ', 'chain-mcp': 'CHAIN MCP ', 'public-rpc': 'PUBLIC RPC' }[s.actor];
      console.log(`${String(s.n).padStart(2)}  ${who} ${s.name.padEnd(20)} ${s.actor === 'agent' ? s.summary : `${s.input.slice(0, 60)}  →  ${(s.output ?? `ERROR ${s.error}`).replace(/\s+/g, ' ').slice(0, 60)}  [${s.ms} ms]`}${s.uses?.length ? `  (uses ${s.uses.join(', ')})` : ''}`);
    }
    console.log(`\n${r.verdict.headline}\n  ${r.verdict.reason}`);
    if (r.explanation?.text) {
      console.log(`\nWhat the docs say${r.explanation.kind === 'general' ? ' (general only, NOT applied)' : ''}:\n  ${r.explanation.text.replace(/\n+/g, '\n  ')}`);
      console.log('\nSources');
      r.explanation.sources.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}${s.cited ? '  (cited in the answer)' : '  (related)'}\n     ${s.url}`));
    }
    for (const c of r.interpretation?.checks ?? []) console.log(`\n${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`);
    console.log(`\n${r.chainCalls} Chain MCP calls, ${r.docsCalls} Docs MCP calls, ${r.rpcCalls} public RPC calls (every read is confirmed there)`);
  }
  exitCode = r.verdict.status === 'explained' ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  exitCode = 1;
} finally {
  await chain.close();
  await docs.close();
}
process.exitCode = exitCode;
