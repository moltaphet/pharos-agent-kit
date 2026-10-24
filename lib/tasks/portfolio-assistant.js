// Task: Portfolio Assistant (DeFi / Portfolio). The API around lib/portfolio.js: ask a question about a wallet, serve the examples and the recorded
// demo, and REPLAY a recorded question at its pinned block to show the recorded figures are what the chain says.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { askPortfolio } from '../portfolio.js';
import { UserError } from '../snapshot.js';

const SKILL = fileURLToPath(new URL('../../skills/pharos-portfolio-assistant/', import.meta.url));
export const readExamples = async () => ({ wallets: JSON.parse(await readFile(SKILL + 'examples/wallets.json', 'utf8')), questions: JSON.parse(await readFile(SKILL + 'examples/questions.json', 'utf8')) });
export const readDemo = async () => JSON.parse(await readFile(fileURLToPath(new URL('../../reports/portfolio-demo.json', import.meta.url)), 'utf8'));

// The figures of a recording against the same question replayed at the same block: every figure's text, and the raw base-unit amount of every position.
export function compareReplay(recorded, replayed) {
  const figs = (r) => new Map(r.answer.figures.map((f) => [f.label, f.value]));
  const a = figs(recorded);
  const b = figs(replayed);
  const rows = [...a].map(([label, value]) => ({ label, recorded: value, replayed: b.get(label) ?? null, same: b.get(label) === value }));
  const pos = (r) => new Map(r.positions.map((p) => [p.id, p.amountRaw]));
  const pa = pos(recorded);
  const pb = pos(replayed);
  const positions = [...pa].map(([id, raw]) => ({ id, recorded: raw, replayed: pb.get(id) ?? null, same: pb.get(id) === raw }));
  return {
    sameText: recorded.answer.text === replayed.answer.text,
    figures: { compared: rows.length, identical: rows.filter((x) => x.same).length, differing: rows.filter((x) => !x.same) },
    positions: { compared: positions.length, identical: positions.filter((x) => x.same).length, differing: positions.filter((x) => !x.same) },
    sameBlock: recorded.block.number === replayed.block.number,
  };
}

const toBlock = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(String(v))) throw new UserError('block must be a whole number');
  return Number(v);
};

export default async function run({ q, body, chain, rpc }) {
  if (q.example) return await readExamples();
  if (q.recorded) return { demo: await readDemo() };
  if (q.replay) {
    const demo = await readDemo();
    const rec = demo.cases.find((c) => c.id === q.replay);
    if (!rec) throw new UserError(`unknown recorded case "${q.replay}"; known: ${demo.cases.map((c) => c.id).join(', ')}`);
    const replayed = await askPortfolio({ chain, ...(rpc && { rpc }), wallet: rec.wallet, question: rec.question, block: rec.block });
    return { case: { id: rec.id, question: rec.question, block: rec.block }, replayed, comparison: compareReplay(rec.result, replayed) };
  }
  const wallet = body?.wallet ?? q.wallet;
  const question = body?.question ?? q.question;
  if (!wallet || !question) throw new UserError('give a wallet and a question, e.g. wallet=0x… question=Where is my USDC?');
  return { portfolio: await askPortfolio({ chain, ...(rpc && { rpc }), wallet, question, block: toBlock(body?.block ?? q.block) }) };
}
