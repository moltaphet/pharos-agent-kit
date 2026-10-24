// Task: Docs MCP + Chain MCP Agent (Composition).
//
// Given a contract and a function, lib/docs-chain.js asks Developer Docs MCP what the function does, calls it through Chain MCP, and reads the
// result in the light of the explanation. This file is the API around it: run one, serve the examples and the recorded demo, and REPLAY a
// recorded case at its pinned block to show the chain's side of the recording is what the chain says.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../docs-chain.js';
import { UserError } from '../snapshot.js';

const AGENT = fileURLToPath(new URL('../../agents/docs-chain-mcp-agent/', import.meta.url));
export const readCases = async () => JSON.parse(await readFile(AGENT + 'examples/cases.json', 'utf8'));
export const readDemo = async () => JSON.parse(await readFile(fileURLToPath(new URL('../../reports/docs-chain-demo.json', import.meta.url)), 'utf8'));

const MOVING = new Set(['get_block_number']);

// The chain's answers in a recording against a replay of the same request at the same block. The explanation is generated afresh each
// time, so its wording is not compared; what it asked for can differ, so only calls made in both are compared.
export function compareReplay(recorded, replayed) {
  const key = (s) => `${s.name} ${s.input}`;
  const pinned = (r) => r.steps.filter((s) => s.actor === 'chain-mcp' && !MOVING.has(s.name));
  const mine = new Map(pinned(replayed).map((s) => [key(s), s]));
  const rows = pinned(recorded).filter((s) => mine.has(key(s))).map((s) => ({ call: s.name, input: s.input, recorded: s.output ?? s.error, replayed: mine.get(key(s)).output ?? mine.get(key(s)).error, same: (mine.get(key(s)).output ?? mine.get(key(s)).error) === (s.output ?? s.error) }));
  return {
    sameRawValue: recorded.call?.raw === replayed.call?.raw,
    chainAnswers: { compared: rows.length, identical: rows.filter((x) => x.same).length, differing: rows.filter((x) => !x.same) },
    sameStatus: recorded.verdict.status === replayed.verdict.status,
    note: 'The explanation is generated again every time, so its wording (and what it asks the agent to check) can differ. Only the chain’s answers to the calls both runs made are compared.',
  };
}

const toBlock = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(String(v))) throw new UserError('block must be a whole number');
  return Number(v);
};
const toArgs = (v) => {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  try {
    const j = JSON.parse(String(v));
    if (Array.isArray(j)) return j.map(String);
  } catch { /* not JSON: a comma separated list */ }
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
};

export default async function run({ q, body, chain, docs, rpc }) {
  if (q.example) return { cases: await readCases() };
  if (q.recorded) return { demo: await readDemo() };
  if (q.replay) {
    const demo = await readDemo();
    const rec = demo.cases.find((c) => c.id === q.replay);
    if (!rec) throw new UserError(`unknown recorded case "${q.replay}"; known: ${demo.cases.map((c) => c.id).join(', ')}`);
    const replayed = await runAgent({ chain, docs, ...(rpc && { rpc }), contract: rec.contract, signature: rec.function, args: rec.args, block: rec.block });
    return { case: { id: rec.id, label: rec.label, block: rec.block }, replayed, comparison: compareReplay(rec.result, replayed) };
  }
  const contract = body?.contract ?? q.contract;
  const signature = body?.function ?? q.function;
  if (!contract || !signature) throw new UserError('give a contract and a function, e.g. contract=0x… function=latestAnswer()(int256)');
  return { agent: await runAgent({ chain, docs, ...(rpc && { rpc }), contract, signature, args: toArgs(body?.args ?? q.args), block: toBlock(body?.block ?? q.block) }) };
}
