// Task: Skill + Chain MCP Flow (Composition).
//
// One request ("send 1 USDC from 0x… to 0x…") goes through lib/flow.js: Chain MCP supplies the block, its time, the token facts and
// the simulation; the Policy Gatekeeper and Dry-Run Executor Skills decide. This file is the API around it: run a request, serve the
// example, serve the recorded demo, and REPLAY a recorded case at the same pinned block to show the recorded data is what the chain
// says, not a transcript.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runFlow } from '../flow.js';
import { UserError } from '../snapshot.js';

const SKILL = fileURLToPath(new URL('../../skills/pharos-transfer-preflight/', import.meta.url));
export const readExample = async (name) => JSON.parse(await readFile(SKILL + 'examples/' + name, 'utf8'));
export const readDemo = async () => JSON.parse(await readFile(fileURLToPath(new URL('../../reports/flow-demo.json', import.meta.url)), 'utf8'));

// Chain calls whose answer depends on "now" even when the request is pinned to a block: the head, and the gas price (no block parameter).
const MOVING = new Set(['get_block_number', 'get_gas_price']);

// Compares a recorded case with the same request replayed at the same block: the verdict, and every Chain MCP answer that is pinned to a block.
export function compareReplay(recorded, replayed) {
  const pinned = (r) => r.steps.filter((s) => s.actor === 'chain-mcp' && !MOVING.has(s.name));
  const a = pinned(recorded);
  const b = pinned(replayed);
  const key = (s) => `${s.name} ${s.input}`;
  const mine = new Map(b.map((s) => [key(s), s]));
  const rows = a.map((s) => ({ call: s.name, input: s.input, recorded: s.output ?? s.error, replayed: mine.get(key(s))?.output ?? mine.get(key(s))?.error ?? null, same: (mine.get(key(s))?.output ?? mine.get(key(s))?.error) === (s.output ?? s.error) }));
  const sameVerdict = recorded.verdict.status === replayed.verdict.status && recorded.verdict.stage === replayed.verdict.stage && recorded.verdict.reason === replayed.verdict.reason;
  const gas = (r) => r.verdict.gas?.priceGwei ?? r.simulation?.gas?.priceGwei ?? null;
  return { sameVerdict, chainAnswers: { compared: rows.length, identical: rows.filter((x) => x.same).length, differing: rows.filter((x) => !x.same) }, sameStepCount: recorded.steps.length === replayed.steps.length, gasPriceGwei: { recorded: gas(recorded), replayed: gas(replayed), note: 'the gas price has no block parameter, so it is always the current one and may differ' } };
}

const toBlock = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(String(v))) throw new UserError('block must be a whole number');
  return Number(v);
};

export default async function run({ q, body, chain }) {
  if (q.example) return { policy: await readExample('policy.json'), requests: await readExample('requests.json') };
  if (q.recorded) return { demo: await readDemo() };
  if (q.replay) {
    const demo = await readDemo();
    const rec = demo.cases.find((c) => c.id === q.replay);
    if (!rec) throw new UserError(`unknown recorded case "${q.replay}"; known: ${demo.cases.map((c) => c.id).join(', ')}`);
    const replayed = await runFlow({ chain, text: rec.text, policy: demo.policy, block: rec.block });
    return { case: { id: rec.id, title: rec.title, block: rec.block }, replayed, comparison: compareReplay(rec.result, replayed) };
  }
  const text = body?.text ?? q.text;
  if (!text) throw new UserError('give the request as text, e.g. send 1 USDC from 0x… to 0x…');
  const policy = body?.policy ?? (await readExample('policy.json'));
  return { flow: await runFlow({ chain, text, policy, block: toBlock(body?.block ?? q.block) }) };
}
