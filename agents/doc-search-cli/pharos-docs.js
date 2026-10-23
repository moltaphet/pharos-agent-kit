#!/usr/bin/env node
// Task: Doc-Search CLI (Developer Docs MCP)
// Ask a question in plain English, get a concise answer plus the doc pages it
// came from, straight from the terminal. Says so when the docs don't know.

import { McpClient, PHAROS_DOCS_MCP } from '../../lib/mcp.js';
import { DOCS_GOAL, buildResult } from '../../lib/docs.js';
import { fail, parseCli } from '../../lib/cli.js';

const usage = `Usage: pharos-docs "<question>" [options]

Ask the Pharos docs (via Developer Docs MCP) a question and get a sourced answer.

  pharos-docs "how do I deploy a contract?"

Options:
  --sources <n>   max number of source links to show (default: 5)
  --json          machine-readable output
  -h, --help      show this help

Exit codes: 0 answer found · 2 no good answer found · 1 error`;

const { values, positionals } = parseCli({
  usage,
  options: { sources: { type: 'string', default: '5' }, json: { type: 'boolean' } },
});

const question = positionals.join(' ').trim();
if (!question) fail('please provide a question', usage);
const maxSources = Number(values.sources);
if (!Number.isInteger(maxSources) || maxSources < 1) fail('--sources must be a positive integer', usage);

const client = new McpClient(PHAROS_DOCS_MCP);
let exitCode = 0;

try {
  // askQuestion synthesises the answer; searchDocumentation tells us whether the
  // docs contain anything relevant at all, which guards against invented answers.
  const [askText, searchText] = await Promise.all([
    client.callTool('askQuestion', { question, goal: DOCS_GOAL }),
    client.callTool('searchDocumentation', { query: question }),
  ]);
  const result = buildResult({ question, askText, searchText, maxSources });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.found) {
    console.log(`\nQ: ${question}\n\n${result.answer}\n\nSources`);
    result.sources.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}${s.cited ? '  (cited in the answer)' : '  (related)'}\n     ${s.url}`));
    console.log();
  } else {
    console.log(`\nNo good answer found in the Pharos docs for: "${question}"`);
    console.log('Try rephrasing with more specific terms (e.g. a product, tool, or network name).');
    if (result.partial) console.log(`\nWhat the docs server said instead (not a direct answer):\n  ${result.partial.replace(/\n+/g, '\n  ')}`);
    if (result.related.length) {
      console.log('\nClosest pages (related, not an answer):');
      result.related.forEach((s) => console.log(`  - ${s.title}: ${s.url}`));
    }
    console.log(`\nBrowse everything at https://docs.pharos.xyz\n`);
  }
  if (!result.found) exitCode = 2;
} catch (err) {
  console.error(`error: ${err.message}`);
  exitCode = 1;
}
await client.close();
process.exit(exitCode);
