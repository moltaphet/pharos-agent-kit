#!/usr/bin/env node
// Task: Natural-Language Payment Agent.
// Turns "send 100 USDC to 0x…" into a summary and an UNSIGNED transaction on Pharos mainnet, or asks what is unclear. It never signs and never sends: it has no key.

import { McpClient, PHAROS_CHAIN_MCP } from '../../lib/mcp.js';
import { preparePayment } from '../../lib/payments.js';
import { fail, parseCli } from '../../lib/cli.js';

const usage = `Usage: pharos-pay "<what to pay>" --from 0x… [options]

  pharos-pay "send 100 USDC to 0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B" --from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f
  pharos-pay "send 50 to bob" --from 0x8ecd… --answer recipient=0xAb58… --answer token=USDC

Options:
  --from <0x…>         the wallet that pays (its balance is checked and the payment is simulated as it)
  --answer <field=v>   answer a question the agent asked: amount, token, recipient or from (repeat for several)
  --contact <name=0x…> an address-book entry, so "to bob" can be understood (repeat for several)
  --block <n>          check everything at this block (default: two behind the latest)
  --json               print the full result as JSON
  -h, --help           show this help

Exit codes: 0 ready · 10 needs an answer, blocked or refused · 1 error`;

const { values, positionals } = parseCli({ usage, options: { from: { type: 'string' }, answer: { type: 'string', multiple: true, default: [] }, contact: { type: 'string', multiple: true, default: [] }, block: { type: 'string' }, json: { type: 'boolean' } } });
const text = positionals.join(' ').trim();
if (!text) fail('write what to pay, in quotes', usage);
const pairs = (list, what) => Object.fromEntries(list.map((p) => { const i = p.indexOf('='); if (i < 1) fail(`--${what} needs field=value, got "${p}"`, usage); return [p.slice(0, i), p.slice(i + 1)]; }));
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const r = await preparePayment({ chain, text, from: values.from ?? null, answers: pairs(values.answer, 'answer'), contacts: pairs(values.contact, 'contact'), block: values.block ? Number(values.block) : null });
  if (values.json) console.log(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  else {
    console.log(`\n${r.status.toUpperCase()}${r.block ? ` · block ${r.block.number.toLocaleString('en-US')}` : ''}`);
    for (const n of r.notes ?? []) console.log(`  note: ${n}`);
    for (const q of r.questions ?? []) console.log(`  ? ${q.question}${q.options ? `  [${q.options.join(' | ')}]` : ''}   (answer with --answer ${q.field}=…)`);
    if (r.reason) console.log(`  ${r.reason}`);
    if (r.summaryText) console.log(`\n${r.summaryText.split('\n').map((l) => `  ${l}`).join('\n')}`);
    for (const c of r.checks ?? []) console.log(`  ${{ pass: '✓', note: '·', warn: '!', fail: '✗' }[c.level]} ${c.name}: ${c.detail}`);
    if (r.transaction) console.log(`\n  UNSIGNED transaction (nothing was signed or sent):\n    to ${r.transaction.to}\n    data ${r.transaction.data.slice(0, 74)}${r.transaction.data.length > 74 ? '…' : ''}\n    value ${r.transaction.value}  gas ${r.transaction.gas}  chain ${r.transaction.chainId}\n    ${r.eip681}\n    sign this hash offline: ${r.transaction.unsignedRaw.signingHash}`);
  }
  process.exitCode = r.status === 'ready' ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
