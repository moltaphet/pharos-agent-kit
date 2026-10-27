#!/usr/bin/env node
// Task 29: ask "how do I …" on Pharos; get the plan from the docs, the action through Chain MCP, and the check on chain. Funds are only ever prepared for your signature.
//   pharos-build "How do I read the PROS/USD price on Pharos?"
//   pharos-build "How do I send 0.001 PROS to 0x… from 0x…?"            prints the prepared transaction; sign it yourself, then:
//   pharos-build --verify <tx hash> --prepared prepared.json [--network atlantic]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, parseCli } from '../../lib/cli.js';
import { McpClient, PHAROS_CHAIN_MCP, PHAROS_DOCS_MCP } from '../../lib/mcp.js';
import { atlanticChain } from '../../lib/rpc-chain.js';
import { runRequest, verifyOutcome } from '../../lib/builder.js';

const usage = 'Usage: pharos-build "<question>" [--save-prepared <file>] [--json]   |   pharos-build --verify <tx hash> --prepared <file> [--network mainnet|atlantic]';
const { values, positionals } = parseCli({ usage, options: { verify: { type: 'string' }, prepared: { type: 'string' }, network: { type: 'string' }, 'save-prepared': { type: 'string' }, json: { type: 'boolean' } } });
const chain = new McpClient(PHAROS_CHAIN_MCP, { label: 'builder-chain' });
const docs = new McpClient(PHAROS_DOCS_MCP, { label: 'builder-docs' });
const clients = { chain, docs, atlantic: atlanticChain() };
const mark = (ok) => (ok ? '✓' : '✗');
try {
  if (values.verify) {
    if (!values.prepared) fail('--verify needs --prepared <file>', usage);
    const o = await verifyOutcome({ prepared: JSON.parse(readFileSync(resolve(values.prepared), 'utf8')), hash: values.verify, clients, network: values.network ?? 'mainnet' });
    if (values.json) console.log(JSON.stringify(o, null, 2)); else { console.log(`${o.headline}`); for (const v of o.verification) console.log(`  ${mark(v.ok)} ${v.what} (expected ${v.expected}, got ${v.actual})`); }
    process.exitCode = o.status === 'success' ? 0 : 1;
  } else {
    const [question] = positionals;
    if (!question) fail('ask a question', usage);
    const r = await runRequest({ question, clients });
    if (values.json) console.log(JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)); else {
      console.log(`${r.verdict.headline}\n${r.verdict.reason}\n`);
      if (r.docs?.answer) console.log(`From the docs:\n${r.docs.answer}\n\nSources:\n${r.docs.sources.map((s) => `  - ${s.title} ${s.url}${s.cited ? ' (cited)' : ''}`).join('\n')}\n`);
      if (r.plan?.length) console.log('Plan:\n' + r.plan.map((p) => `  ${mark(p.done)} ${p.step} [${p.from}]`).join('\n') + '\n');
      if (r.verification?.length) console.log('Checks:\n' + r.verification.map((v) => `  ${mark(v.ok)} ${v.what}`).join('\n') + '\n');
      if (r.prepared) { console.log('Prepared transaction (unsigned):\n' + JSON.stringify(r.prepared, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2).slice(0, 1500)); if (values['save-prepared']) { writeFileSync(resolve(values['save-prepared']), JSON.stringify(r.prepared, null, 2)); console.error(`saved to ${values['save-prepared']}`); } }
    }
    if (['failure', 'not-covered'].includes(r.verdict.status)) process.exitCode = 1;
  }
} catch (err) { console.error(`error: ${err.message}`); process.exitCode = 1; } finally { await chain.close(); await docs.close(); }
