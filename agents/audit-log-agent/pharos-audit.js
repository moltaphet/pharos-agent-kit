#!/usr/bin/env node
// Task 26: a plain-language activity report for a wallet over a date range, written as Markdown, CSV or PDF.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, parseCli } from '../../lib/cli.js';
import { rpcCall } from '../../lib/rpc.js';
import { buildReport, resolveRange, toCsv, toMarkdown, toPdf } from '../../lib/auditlog.js';

const usage = 'Usage: pharos-audit <wallet> --from <YYYY-MM-DD[THH:MM]> --to <YYYY-MM-DD[THH:MM]> [--format md|csv|pdf] [--out <file>]   (UTC; at most 7 days)';
const { values, positionals } = parseCli({ usage, options: { from: { type: 'string' }, to: { type: 'string' }, format: { type: 'string' }, out: { type: 'string' } } });
const [wallet] = positionals;
if (!wallet || !values.from || !values.to) fail('give a wallet, --from and --to', usage);
const format = values.format ?? 'md';
if (!['md', 'csv', 'pdf'].includes(format)) fail('--format must be md, csv or pdf', usage);
try {
  const rpc = (m, p) => rpcCall(m, p, { why: `audit-log agent: ${m}` });
  const range = await resolveRange({ rpc, from: values.from, to: values.to });
  console.error(`blocks ${range.fromBlock.toLocaleString('en-US')}–${range.toBlock.toLocaleString('en-US')} (${range.blocks.toLocaleString('en-US')}); reading the chain …`);
  const report = await buildReport({ wallet, ...range });
  const body = format === 'md' ? toMarkdown(report) : format === 'csv' ? toCsv(report) : toPdf(report);
  if (values.out) { writeFileSync(resolve(values.out), body); console.error(`wrote ${values.out}`); } else process.stdout.write(body);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
