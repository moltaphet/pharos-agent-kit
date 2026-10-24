// Task: Yield Optimizer (DeFi / Portfolio). The API around lib/yield-optimizer.js: run an optimisation, serve the examples, the recorded demo and the fork
// evidence, and REPLAY a recorded case at its pinned block to show the recorded decision is what the chain says.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { optimize, gasTableFrom, DEFAULTS } from '../yield-optimizer.js';
import { UserError } from '../snapshot.js';

const SKILL = fileURLToPath(new URL('../../skills/pharos-yield-optimizer/', import.meta.url));
const REPORTS = fileURLToPath(new URL('../../reports/', import.meta.url));
export const readCases = async () => JSON.parse(await readFile(SKILL + 'examples/cases.json', 'utf8'));
export const readDemo = async () => JSON.parse(await readFile(REPORTS + 'yield-demo.json', 'utf8'));
export const readFork = async () => JSON.parse(await readFile(REPORTS + 'yield-fork-run.json', 'utf8'));

export function compareReplay(recorded, replayed) {
  const rows = recorded.candidates.map((c) => {
    const d = replayed.candidates.find((x) => x.id === c.id);
    return { id: c.id, recorded: { apy: c.apy, enter: c.enter.eligible, redeemable: c.redeemable, viable: c.viable }, replayed: d ? { apy: d.apy, enter: d.enter.eligible, redeemable: d.redeemable, viable: d.viable } : null };
  });
  const same = (x) => x.replayed && x.recorded.enter === x.replayed.enter && x.recorded.redeemable === x.replayed.redeemable && x.recorded.viable === x.replayed.viable && x.recorded.apy === x.replayed.apy;
  return {
    sameAction: recorded.recommendation.action === replayed.recommendation.action && recorded.recommendation.to === replayed.recommendation.to,
    sameNetGain: recorded.recommendation.netGainUsd === replayed.recommendation.netGainUsd,
    candidates: { compared: rows.length, identical: rows.filter(same).length, differing: rows.filter((x) => !same(x)) },
    note: 'Everything is read at the pinned block, so the rates, the eligibility and the vaults’ answers repeat exactly. The gas price and the PROS price are live (they have no block parameter in Chain MCP), so a replay’s dollar figures for gas can differ slightly.',
  };
}

const toBlock = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(String(v))) throw new UserError('block must be a whole number');
  return Number(v);
};
const num = (v, d, what) => {
  if (v == null || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UserError(`${what} must be a number`);
  return n;
};

export default async function run({ q, body, chain, rpc }) {
  if (q.example) return { cases: await readCases(), defaults: DEFAULTS };
  if (q.recorded) return { demo: await readDemo(), fork: await readFork() };
  const gas = gasTableFrom(await readFork());
  if (q.replay) {
    const demo = await readDemo();
    const rec = demo.cases.find((c) => c.id === q.replay);
    if (!rec) throw new UserError(`unknown recorded case "${q.replay}"; known: ${demo.cases.map((c) => c.id).join(', ')}`);
    const replayed = await optimize({ chain, ...(rpc && { rpc }), gas, wallet: rec.wallet, from: rec.from, amount: rec.amount, block: rec.block, minHoldDays: rec.minHoldDays, minNetGainUsd: rec.minNetGainUsd });
    return { case: { id: rec.id, label: rec.label, block: rec.block }, replayed, comparison: compareReplay(rec.result, replayed) };
  }
  const wallet = body?.wallet ?? q.wallet;
  if (!wallet) throw new UserError('give a wallet, e.g. wallet=0x… from=idle');
  return { optimizer: await optimize({ chain, ...(rpc && { rpc }), gas, wallet, from: body?.from ?? q.from ?? 'auto', amount: body?.amount ?? q.amount ?? null, minHoldDays: num(body?.minHoldDays ?? q.minHoldDays, DEFAULTS.minHoldDays, 'minHoldDays'), minNetGainUsd: num(body?.minNetGainUsd ?? q.minNetGainUsd, DEFAULTS.minNetGainUsd, 'minNetGainUsd'), block: toBlock(body?.block ?? q.block) }) };
}
