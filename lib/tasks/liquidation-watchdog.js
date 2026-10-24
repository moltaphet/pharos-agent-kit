// Task: Liquidation Watchdog. The API around lib/liquidation.js: check one borrower's position in a Morpho Blue market on Pharos mainnet, find recent
// borrowers, serve the examples, the recorded demo and the fork run, and REPLAY a recorded case at its pinned block.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THRESHOLDS, MARKET_ID, consoleChannel, parseThresholds, readPosition, assess, runWatchdog, scanBorrowers } from '../liquidation.js';
import { blockNumber } from '../chain.js';
import { publicRpc } from '../onchain.js';
import { UserError } from '../snapshot.js';

const AGENT = fileURLToPath(new URL('../../agents/liquidation-watchdog/', import.meta.url));
const REPORTS = fileURLToPath(new URL('../../reports/', import.meta.url));
export const readExamples = async () => JSON.parse(await readFile(AGENT + 'examples/positions.json', 'utf8'));
export const readDemo = async () => JSON.parse(await readFile(REPORTS + 'liquidation-demo.json', 'utf8'));
export const readFork = async () => JSON.parse(await readFile(REPORTS + 'liquidation-fork-run.json', 'utf8'));

// What a replay must reproduce: the position, the health factor and the verdict (all read at the pinned block).
export function compareReplay(recorded, replayed) {
  const same = (a, b) => String(a) === String(b);
  const fields = [
    ['collateral', recorded.position.collateral, replayed.position.collateral],
    ['borrowed', recorded.position.borrowed, replayed.position.borrowed],
    ['oracle price', recorded.position.price, replayed.position.price],
    ['health factor', recorded.healthFactor, replayed.healthFactor],
    ['level', recorded.level, replayed.level],
    ['repay to reach the target', recorded.remedies?.repayToTarget ?? null, replayed.remedies?.repayToTarget ?? null],
    ['collateral to add', recorded.remedies?.addCollateral ?? null, replayed.remedies?.addCollateral ?? null],
  ].map(([what, a, b]) => ({ what, recorded: a, replayed: b, same: same(a, b) }));
  return { sameBlock: recorded.block.number === replayed.block.number, compared: fields.length, identical: fields.filter((f) => f.same).length, differing: fields.filter((f) => !f.same), fields };
}

const toBlock = (v) => {
  if (v == null || v === '') return null;
  if (!/^\d+$/.test(String(v))) throw new UserError('block must be a whole number');
  return Number(v);
};
const thresholdsOf = (src) => parseThresholds({ ...(src.warn != null && src.warn !== '' && { warn: src.warn }), ...(src.critical != null && src.critical !== '' && { critical: src.critical }) });

export default async function run({ q, body, chain, rpc }) {
  if (q.example) return { positions: await readExamples(), defaults: DEFAULT_THRESHOLDS };
  if (q.recorded) return { demo: await readDemo(), fork: await readFork() };
  if (q.replay) {
    const demo = await readDemo();
    const rec = demo.cases.find((c) => c.id === q.replay);
    if (!rec) throw new UserError(`unknown recorded case "${q.replay}"; known: ${demo.cases.map((c) => c.id).join(', ')}`);
    const replayed = await runWatchdog({ chain, ...(rpc && { rpc }), marketId: rec.marketId, borrower: rec.borrower, block: rec.block, thresholds: rec.thresholds, channels: [consoleChannel(() => {})] });
    return { case: { id: rec.id, label: rec.label, block: rec.block }, replayed, comparison: compareReplay(rec.result, replayed) };
  }
  if (q.scan) {
    const windows = Number(q.windows ?? 40);
    if (!Number.isInteger(windows) || windows < 1 || windows > 80) throw new UserError('windows must be a whole number from 1 to 80 (each is 1,000 blocks)');
    const th = thresholdsOf(q);
    const head = await blockNumber(chain);
    const found = await scanBorrowers({ rpc: rpc ?? publicRpc, head, windows, concurrency: 5 });
    const rows = [];
    for (const b of found.borrowers.slice(0, 8)) {
      try {
        const read = await readPosition({ chain, ...(rpc && { rpc }), marketId: b.marketId, borrower: b.borrower });
        const a = assess(read, th);
        rows.push({ ...b, pair: `${read.collateral.symbol}/${read.loan.symbol}`, healthFactor: a.health.hf, level: a.level, debtText: `${Number(a.health.borrowed) / 10 ** read.loan.decimals} ${read.loan.symbol}`.replace(/(\.\d{2})\d+/, '$1') });
      } catch (err) {
        rows.push({ ...b, error: err.message });
      }
    }
    rows.sort((x, y) => (x.healthFactor ?? 99) - (y.healthFactor ?? 99));
    return { scan: { ...found.scanned, found: found.borrowers.length, shown: rows.length, head, positions: rows } };
  }
  const src = { ...q, ...(body ?? {}) };
  const marketId = src.marketId;
  const borrower = src.borrower;
  if (!marketId || !borrower) throw new UserError('give a marketId and a borrower, e.g. marketId=0xc79579a0… borrower=0x743d…');
  if (!MARKET_ID.test(String(marketId))) throw new UserError('marketId must be a 0x… id of 32 bytes (64 hex characters)');
  return { watchdog: await runWatchdog({ chain, ...(rpc && { rpc }), marketId, borrower, block: toBlock(src.block), thresholds: thresholdsOf(src), channels: [consoleChannel(() => {})] }) };
}
