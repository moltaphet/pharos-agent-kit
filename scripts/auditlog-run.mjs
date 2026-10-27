#!/usr/bin/env node
// The Audit-Log Agent, run on Pharos MAINNET (read-only) for three real wallets over one whole UTC day. Between them the reports contain every category: transfers in and out,
// swaps, approvals and contract interactions. Each report is written as Markdown, CSV and PDF, and the facts are recorded for the page, which re-reads the notable transactions
// from the chain on every load.
//
//   node scripts/auditlog-run.mjs [YYYY-MM-DD]        writes reports/auditlog-run.json and reports/auditlog/<wallet>.{md,csv,pdf}

import { writeFileSync } from 'node:fs';
import { rpcCall } from '../lib/rpc.js';
import { buildReport, resolveRange, toCsv, toMarkdown, toPdf } from '../lib/auditlog.js';

const say = (s) => process.stderr.write(s + '\n');
const rpc = (m, p) => rpcCall(m, p, { why: `audit-log run: ${m}` });
const day = process.argv[2] ?? new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10);
const range = await resolveRange({ rpc, from: day, to: day });
say(`period ${range.requested.from} – ${range.requested.to}: blocks ${range.fromBlock}–${range.toBlock} (${range.blocks.toLocaleString('en-US')})`);
const wallets = [
  { id: 'wallet-a', address: '0x16797a0f3f0dbbf3a9d2dfb66c9c4a5a61e9cb76', title: 'A wallet that moves tokens, grants approvals and calls contracts' },
  { id: 'wallet-c', address: '0xb246960e21e6a1bb8cfe2974809981848b86bde6', title: 'A wallet that sends tokens' },
  { id: 'wallet-b', address: '0xde027284a721e4435cb4598cf019c28cc4bc2c15', title: 'A wallet that swaps, approves and calls contracts' },
];
const reports = [];
for (const w of wallets) {
  say(`report for ${w.address} …`);
  const t0 = Date.now();
  const r = await buildReport({ wallet: w.address, ...range });
  const base = new URL(`../reports/auditlog/${w.id}`, import.meta.url);
  writeFileSync(base.pathname.replace(/%20/g, ' ') + '.md', toMarkdown(r));
  writeFileSync(base.pathname.replace(/%20/g, ' ') + '.csv', toCsv(r));
  writeFileSync(base.pathname.replace(/%20/g, ' ') + '.pdf', toPdf(r));
  say(`  ${Object.entries(r.totals).map(([k, v]) => `${k} ${v.count}`).join(' · ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  reports.push({ ...w, report: r });
}
const out = { recordedAt: new Date().toISOString(), network: 'Pharos mainnet (1672), read-only', day, range, wallets: reports.map((x) => ({ id: x.id, title: x.title, address: x.address, report: x.report })) };
writeFileSync(new URL('../reports/auditlog-run.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
const cats = new Set(reports.flatMap((x) => Object.entries(x.report.totals).filter(([, v]) => v.count > 0).map(([k]) => k)));
console.log(`wrote reports/auditlog-run.json and reports/auditlog/*: categories seen across both reports: ${[...cats].join(', ')}`);
process.exitCode = ['transfer', 'swap', 'approval', 'contract interaction'].every((c) => cats.has(c)) ? 0 : 1;
