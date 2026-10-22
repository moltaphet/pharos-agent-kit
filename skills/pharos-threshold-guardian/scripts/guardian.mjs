#!/usr/bin/env node
// Evaluate a Threshold Guardian config against live Pharos mainnet data (read-only).
//   node skills/pharos-threshold-guardian/scripts/guardian.mjs <config.json> [--json]
// Exit code: 0 = FIRE, 10 = HOLD, 1 = error. Run it from the repository root.
import { readFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { evaluate } from '../../../lib/tasks/threshold-guardian.js';

const [file, flag] = process.argv.slice(2);
if (!file || file.startsWith('-')) {
  console.error('Usage: guardian.mjs <config.json> [--json]');
  process.exit(1);
}
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const result = await evaluate({ chain }, JSON.parse(await readFile(file, 'utf8')));
  if (flag === '--json') console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.name}  ·  block ${result.block.toLocaleString('en-US')}\n\n${result.trace.join('\n')}`);
  process.exitCode = result.decision === 'fire' ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
