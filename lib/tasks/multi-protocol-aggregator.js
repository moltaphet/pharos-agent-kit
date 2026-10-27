// Task: Multi-Protocol Aggregator. The web side of lib/aggregator.js: query rates and a wallet's positions across the protocols, route a deposit or a withdrawal and get the
// unsigned transactions, and the recorded run, which is replayed on its pinned block on every load. Read-only: nothing is signed or sent.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PROTOCOLS, prepare, route, snapshot, summarize } from '../aggregator.js';
import { UserError } from '../snapshot.js';
import { isAddress } from '../abi.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const downOf = (q) => String(q.down ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const walletOf = (q, required = false) => {
  const w = q.wallet ? String(q.wallet).trim() : null;
  if (!w && required) throw new UserError('wallet is required: a 0x… address');
  if (w && !isAddress(w)) throw new UserError('wallet must be a 0x… address of 40 hex digits');
  return w;
};

// the recording is replayed at its block: every venue's value locked and every wallet's position must come out the same
async function replay(rec, attempt = 0) {
  const checks = [];
  const base = summarize(await snapshot({ block: rec.block }));
  for (const r of rec.rates.rows) { const now = base.rows.find((x) => x.id === r.id); checks.push({ what: `${r.name}: value locked at block ${rec.block.toLocaleString('en-US')}`, recorded: r.tvlText, now: now?.tvlText ?? 'n/a', ok: now?.tvlText === r.tvlText }); }
  const rows = await Promise.all(rec.queries.map(async (q) => ({ q, now: summarize(await snapshot({ wallet: q.address, block: rec.block })) })));
  for (const { q, now } of rows) checks.push({ what: `${q.title}: position`, recorded: q.summary.totalText, now: now.totalText, ok: now.totalText === q.summary.totalText });
  // a node that is behind the others can answer a pinned block from other state: one more look before anything is called a mismatch
  if (checks.some((c) => !c.ok) && attempt < 2) { await new Promise((r) => setTimeout(r, 1500)); return replay(rec, attempt + 1); }
  return { checkedAt: new Date().toISOString(), checks, total: checks.length, verifiedCount: checks.filter((c) => c.ok).length };
}

export default async function run({ q }) {
  if (q.recorded) { const rec = await json('reports/aggregator-run.json'); return { run: rec, verification: await replay(rec) }; }
  if (q.query) {
    const down = downOf(q);
    const snap = await snapshot({ wallet: walletOf(q), down });
    return jsonSafe({ block: snap.block, protocols: PROTOCOLS, summary: summarize(snap), unavailable: snap.unavailable });
  }
  if (q.route) {
    const wallet = walletOf(q, true);
    const action = String(q.action ?? '');
    const probeAmount = String(q.amount ?? '');
    const routedPreview = route({ snap: { venues: [] }, action, amount: probeAmount }); // validates the request before the chain is asked
    const snap = await snapshot({ wallet, down: downOf(q), probe: { action, amountRaw: BigInt(routedPreview.amountRaw) } });
    const routed = route({ snap, action, amount: probeAmount });
    return jsonSafe({ block: snap.block, routed, prepared: routed.legs.length ? await prepare({ snap, routed, wallet }) : null, venues: summarize(snap).rows });
  }
  throw new UserError('use ?query=1&wallet=0x…&down=R25, ?route=1&wallet=0x…&action=deposit&amount=2500, or ?recorded=1');
}
