#!/usr/bin/env node
// Task: Docs MCP Onboarding
// Asks Developer Docs MCP the questions a new developer would ask, checks every answer
// against the live network, and prints an honest Markdown report of what worked, what
// did not, and what the docs should say instead.

import { writeFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP, PHAROS_DOCS_MCP } from '../../lib/mcp.js';
import run, { STEPS, buildReport } from '../../lib/tasks/docs-mcp-onboarding.js';
import { fail, parseCli } from '../../lib/cli.js';

const usage = `Usage: pharos-onboard [--out report.md]

Runs ${STEPS.length} onboarding questions through Developer Docs MCP, verifies each answer
against the live network, and prints a Markdown report (gaps, evidence, suggested fixes).

Options:
  --out <file>   write the report to a file instead of stdout
  -h, --help     show this help`;

const { values } = parseCli({ usage, options: { out: { type: 'string' } }, allowPositionals: false });
const docs = new McpClient(PHAROS_DOCS_MCP, { timeoutMs: 60_000 });
const chain = new McpClient(PHAROS_CHAIN_MCP);

try {
  const results = [];
  for (const s of STEPS) {
    process.stderr.write(`[${results.length + 1}/${STEPS.length}] ${s.goal} … `);
    const r = await run({ q: { step: s.id }, docs, chain });
    results.push(r);
    process.stderr.write(r.gap ? 'GAP\n' : 'ok\n');
  }
  process.stderr.write('Running what the docs let us build … ');
  const finale = await run({ q: { step: 'finale' }, docs, chain });
  process.stderr.write('done\n');
  const { markdown } = await run({ q: { step: 'report' }, body: { results, finale }, docs, chain });
  if (values.out) {
    await writeFile(values.out, markdown);
    console.error(`Report written to ${values.out}`);
  } else console.log(markdown);
} catch (err) {
  fail(err.message);
} finally {
  await Promise.all([docs.close(), chain.close()]);
}
