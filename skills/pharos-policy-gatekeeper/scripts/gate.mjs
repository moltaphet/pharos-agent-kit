#!/usr/bin/env node
// Check requests against a policy and keep an audit log. Nothing is ever broadcast: the executor here only counts.
//   node skills/pharos-policy-gatekeeper/scripts/gate.mjs --policy policy.json --requests requests.json [--log audit.jsonl] [--json]
//   node skills/pharos-policy-gatekeeper/scripts/gate.mjs --verify audit.jsonl
// Run from the repository root. A request without "at" is checked at the time of the latest confirmed Pharos block.
// Exit code: 0 every request allowed, 10 at least one denied, 2 audit log broken, 1 error.
import { readFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { FileLog, MemoryLog, verifyLog } from '../../../lib/audit-log.js';
import { runGate } from '../../../lib/tasks/policy-gatekeeper.js';
import { getBlock, pinnedBlock } from '../../../lib/chain.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const read = async (f) => JSON.parse(await readFile(f, 'utf8'));

if (has('verify')) {
  const v = verifyLog(await new FileLog(arg('verify')).all());
  console.log(v.ok ? `audit log intact: ${v.count} entries, head ${v.head}` : `audit log BROKEN:\n  ${v.problems.map((p) => p.problem).join('\n  ')}`);
  process.exit(v.ok ? 0 : 2);
}
if (!arg('policy') || !arg('requests')) { console.error('Usage: gate.mjs --policy policy.json --requests requests.json [--log audit.jsonl] [--json]   |   gate.mjs --verify audit.jsonl'); process.exit(1); }

let chain;
try {
  const requests = await read(arg('requests'));
  const needsClock = Array.isArray(requests) && requests.some((r) => r && r.at == null);
  if (needsClock) chain = new McpClient(PHAROS_CHAIN_MCP);
  let t;
  const clock = async () => (t ??= (await getBlock(chain, await pinnedBlock(chain))).timestamp);
  const g = await runGate({ policy: await read(arg('policy')), requests, clock, log: arg('log') ? new FileLog(arg('log')) : new MemoryLog() });
  console.log(`\npolicy "${g.policy.name}"  sha256 ${g.policy.hash.slice(0, 16)}…  rules: ${g.policy.rules.map((r) => `${r.id} (${r.type})`).join(', ')}\n`);
  for (const r of g.results) {
    const d = r.decision;
    console.log(`${String(r.index).padStart(2)}  ${d.decision.toUpperCase().padEnd(5)} ${(r.id ?? '').padEnd(22)} rule: ${d.rule.id}\n      ${d.reason}`);
  }
  const s = g.summary;
  console.log(`\n${s.allowed} allowed, ${s.denied} denied (${Object.entries(s.deniedByRule).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}); denied requests that reached the executor: ${s.deniedThatReachedTheExecutor}`);
  console.log(`audit log: ${g.integrity.ok ? 'intact' : 'BROKEN'}, ${g.integrity.count} entries, head ${g.integrity.head.slice(0, 16)}…${arg('log') ? ` (${arg('log')})` : ''}`);
  if (has('json')) console.log(JSON.stringify(g, null, 2));
  process.exitCode = !g.integrity.ok ? 2 : s.denied ? 10 : 0;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain?.close();
}
