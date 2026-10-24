#!/usr/bin/env node
// Records the demos of the three payment agents on REAL Pharos mainnet (read-only), every case pinned to one block so it can be replayed exactly.
//   node scripts/payments-demo.mjs        writes reports/payments-demo.json (Natural-Language and Invoice-to-Payment) and reports/recurring-demo.json (Recurring)
import { readFileSync, writeFileSync } from 'node:fs';
import { McpClient, PHAROS_CHAIN_MCP } from '../lib/mcp.js';
import { preparePayment } from '../lib/payments.js';
import { prepareInvoicePayment } from '../lib/invoice.js';
import { tick } from '../lib/recurring.js';
import { blockNumber } from '../lib/chain.js';

const dir = (p) => new URL(`../agents/${p}`, import.meta.url);
const requests = JSON.parse(readFileSync(dir('natural-language-payment-agent/examples/requests.json'), 'utf8'));
const invoices = JSON.parse(readFileSync(dir('invoice-to-payment-agent/examples/invoices.json'), 'utf8'));
const schedules = JSON.parse(readFileSync(dir('recurring-payment-agent/examples/schedules.json'), 'utf8'));
const chain = new McpClient(PHAROS_CHAIN_MCP);
const NOW = Date.parse('2026-10-25T00:00:00Z'); // the date the invoices' due dates are judged against, kept in the recording so a replay judges them the same way
try {
  const block = (await blockNumber(chain)) - 3000; // a little behind, so every node has it and it stays readable
  const payments = [];
  for (const r of requests) {
    process.stderr.write(`payment ${r.id} … `);
    const result = await preparePayment({ chain, text: r.text, from: r.from ?? null, answers: r.answers ?? {}, block });
    process.stderr.write(`${result.status}\n`);
    payments.push({ id: r.id, label: r.label, text: r.text, from: r.from ?? null, answers: r.answers ?? null, block, result });
  }
  const inv = [];
  for (const i of invoices) {
    process.stderr.write(`invoice ${i.id} … `);
    const result = await prepareInvoicePayment({ chain, invoice: i.text, from: i.from ?? null, payIn: i.payIn ?? null, block, now: NOW });
    process.stderr.write(`${result.status}\n`);
    inv.push({ id: i.id, label: i.label, text: i.text, from: i.from ?? null, payIn: i.payIn ?? null, block, now: NOW, result });
  }
  const note = 'Every case is pinned to one mainnet block, so replaying it asks Chain MCP the same questions and must reach the same verdict, checks and transaction. Nothing is signed or sent.';
  writeFileSync(new URL('../reports/payments-demo.json', import.meta.url), JSON.stringify({ recordedAt: new Date().toISOString(), network: { name: 'Pharos Pacific Mainnet', chainId: 1672 }, note, payments, invoices: inv }, null, 1) + '\n');
  const cases = [];
  for (const s of schedules) {
    process.stderr.write(`recurring ${s.id} … `);
    const result = await tick({ chain, schedule: s.schedule, block });
    process.stderr.write(`${result.counts.paid} paid · ${result.counts.pending} pending · ${result.counts.upcoming} upcoming; ${result.action?.kind ?? 'no action'}\n`);
    cases.push({ id: s.id, label: s.label, schedule: s.schedule, block, result });
  }
  writeFileSync(new URL('../reports/recurring-demo.json', import.meta.url), JSON.stringify({ recordedAt: new Date().toISOString(), network: { name: 'Pharos Pacific Mainnet', chainId: 1672 }, note: 'Each schedule is looked at on real mainnet at one pinned block: the chain’s clock decides what is due, the chain decides what is paid, and nothing is sent. The full lifecycle (sign, fail, retry, never twice) is in the fork run.', cases }, null, 1) + '\n');
  console.log(`wrote reports/payments-demo.json (${payments.length} payments, ${inv.length} invoices) and reports/recurring-demo.json (${cases.length} schedules)`);
} finally {
  await chain.close();
}
