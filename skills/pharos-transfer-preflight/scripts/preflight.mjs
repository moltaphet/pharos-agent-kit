#!/usr/bin/env node
// One request in, one verdict out: Chain MCP and two Pharos Skills (Policy Gatekeeper, Dry-Run Executor) in a single flow.
//   node skills/pharos-transfer-preflight/scripts/preflight.mjs --request "send 1 USDC from 0x… to 0x…" [--policy policy.json] [--block N] [--json] [--out run.json]
// Run from the repository root. Reads Pharos mainnet; sends nothing. A READY result is an unsigned transaction for you to sign.
// --block pins the whole flow to an earlier block (its time becomes the policy's clock), so a run can be repeated exactly.
// Exit code: 0 ready, 10 stop, 1 error.
import { readFile, writeFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { runFlow } from '../../../lib/flow.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const text = arg('request');
if (!text) { console.error('Usage: preflight.mjs --request "send 1 USDC from 0x… to 0x…" [--policy policy.json] [--block N] [--json] [--out run.json]'); process.exit(1); }
const chain = new McpClient(PHAROS_CHAIN_MCP);
try {
  const policy = JSON.parse(await readFile(arg('policy', new URL('../examples/policy.json', import.meta.url)), 'utf8'));
  const block = arg('block') ? Number(arg('block')) : null;
  const r = await runFlow({ chain, text, policy, block });
  console.log(`\nrequest: ${text}\nblock ${r.block.number.toLocaleString('en-US')}${r.block.historical ? ' (pinned by --block)' : ''}  ·  ${r.block.weekday} ${r.block.iso}  ·  policy "${r.policy.name}" ${r.policy.hash.slice(0, 12)}…\n`);
  for (const s of r.steps) {
    const who = s.actor === 'skill' ? 'SKILL     ' : 'CHAIN MCP ';
    const uses = s.uses?.length ? `  (uses ${s.uses.join(', ')})` : '';
    console.log(`${String(s.n).padStart(2)}  ${who} ${s.name.padEnd(22)} ${s.actor === 'skill' ? s.summary : `${s.input}  →  ${(s.output ?? `ERROR ${s.error}`).slice(0, 90)}  [${s.ms} ms]`}${uses}`);
  }
  console.log(`\n${r.verdict.headline}\n  ${r.verdict.reason}`);
  if (r.verdict.prepared) console.log(`  prepared: to ${r.verdict.prepared.to}, value ${r.verdict.prepared.value}, gas limit ${r.verdict.prepared.gasLimit.toLocaleString('en-US')}, data ${r.verdict.prepared.data.slice(0, 18)}… (${r.verdict.prepared.note})`);
  console.log('\nwhat the chain’s data decided:');
  for (const d of r.dependsOn) console.log(`  step ${d.step}: ${d.what} = ${d.value}  →  ${d.effect}`);
  console.log(`\n${r.chainCalls} Chain MCP calls; audit log ${r.integrity.ok ? 'intact' : 'BROKEN'} (${r.integrity.count} entries)`);
  if (arg('out')) await writeFile(arg('out'), JSON.stringify(r, null, 2) + '\n');
  if (has('json')) console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.verdict.status === 'ready' ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await chain.close();
}
