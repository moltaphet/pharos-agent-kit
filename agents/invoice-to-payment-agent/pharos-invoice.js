#!/usr/bin/env node
// Task: Invoice-to-Payment Agent.
// Reads an invoice (plain text, JSON, or an ethereum: payment link) and prepares the matching payment as an UNSIGNED transaction that carries the invoice's reference, or says what
// is wrong with the invoice. Nothing is guessed, signed or sent.

import { readFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP } from '../../lib/mcp.js';
import { prepareInvoicePayment } from '../../lib/invoice.js';
import { fail, parseCli } from '../../lib/cli.js';

const usage = `Usage: pharos-invoice <invoice-file> --from 0x… [options]

  pharos-invoice agents/invoice-to-payment-agent/examples/sample-invoice.txt --from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f
  pharos-invoice invoice.json --from 0x8ecd… --pay-in USDC

Options:
  --from <0x…>      the wallet that pays
  --pay-in <token>  for an invoice in US dollars: the token to pay in (USDC); it is never chosen for you
  --block <n>       check everything at this block (default: two behind the latest)
  --json            print the full result as JSON
  -h, --help        show this help

Exit codes: 0 ready · 10 blocked, needs information, or ready only with warnings · 1 error`;

const { values, positionals } = parseCli({ usage, options: { from: { type: 'string' }, 'pay-in': { type: 'string' }, block: { type: 'string' }, json: { type: 'boolean' } } });
if (!positionals[0]) fail('give the invoice file', usage);
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const invoice = await readFile(positionals[0], 'utf8');
  const r = await prepareInvoicePayment({ chain, invoice, from: values.from ?? null, payIn: values['pay-in'] ?? null, block: values.block ? Number(values.block) : null });
  if (values.json) console.log(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  else {
    console.log(`\n${r.status.toUpperCase()} · ${r.format} invoice${r.invoice.reference ? ` ${r.invoice.reference}` : ''}`);
    for (const f of r.flags) console.log(`  ${{ error: '✗', warn: '!', info: '·' }[f.severity]} [${f.code}] ${f.message}`);
    for (const q of r.questions ?? []) console.log(`  ? ${q.question}`);
    if (r.summaryText) console.log(`\n${r.summaryText.split('\n').map((l) => `  ${l}`).join('\n')}`);
    for (const c of r.checks ?? []) console.log(`  ${{ pass: '✓', note: '·', warn: '!', fail: '✗' }[c.level]} ${c.name}: ${c.detail}`);
    if (r.transaction) console.log(`\n  UNSIGNED transaction carrying reference "${r.invoice.reference}" (nothing was signed or sent):\n    to ${r.transaction.to}\n    data ${r.transaction.data.slice(0, 74)}…\n    gas ${r.transaction.gas}  chain ${r.transaction.chainId}\n    sign this hash offline: ${r.transaction.unsignedRaw.signingHash}`);
  }
  process.exitCode = r.status === 'ready' ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
