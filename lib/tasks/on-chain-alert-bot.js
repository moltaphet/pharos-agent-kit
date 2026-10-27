// Task: On-Chain Alert Bot. The web side of lib/alerts.js: the recorded mainnet run (its alerts re-read from the chain on every load) and a live scan of the latest blocks.
// The web never delivers to a channel (that needs the owner's webhook or token); it shows the exact messages and the dedup.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { newState, runCycle, validateConditions, MAX_SCAN_BLOCKS } from '../alerts.js';
import { publicRpc } from '../onchain.js';
import { TOKENS } from '../payments.js';
import { FEEDS } from '../defi.js';
import { UserError } from '../snapshot.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
export const readRun = () => json('reports/alerts-run.json');
export const EXAMPLE = [
  { id: 'usdc-10k', label: 'USDC transfer of 10,000 or more', type: 'transfer', token: 'USDC', min: '10000' },
  { id: 'pros-above-60c', label: 'PROS/USD above 0.60', type: 'price', feed: 'PROS/USD', op: 'above', threshold: '0.60' },
  { id: 'wpros-deposits', label: 'WPROS Deposit events', type: 'event', contract: '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0', signature: 'Deposit(address,uint256)' },
  { id: 'calls', label: 'Calls of 0x04060252 on 0xf4a0…904c', type: 'call', contract: '0xf4a04f7537d8456ba0c78a518cb60a334579904c', method: '0x04060252' },
];
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// every alert of the recording that points at a transaction is read back from mainnet: the log (or the transaction) is there, in the recorded block
async function verify(run) {
  const rows = run.alerts.keys.filter((k) => /^0x[0-9a-f]{64}:/.test(k.key));
  const results = {};
  // a node behind the others may not have a transaction yet: an item that does not verify is asked again, after a pause, before it is called a mismatch
  const check = async (k) => {
    const [hash, idx] = k.key.split(':');
    const r = await publicRpc('eth_getTransactionReceipt', [hash]);
    return Boolean(r) && r.status === '0x1' && Number(BigInt(r.blockNumber)) === k.block && (idx === 'call' || r.logs.some((l) => Number(BigInt(l.logIndex)) === Number(idx)));
  };
  await Promise.all(rows.map(async (k) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { if (await check(k)) { results[k.key] = { verified: true }; return; } } catch (err) { results[k.key] = { verified: false, error: err.message }; }
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
    results[k.key] ??= { verified: false };
  }));
  return { checkedAt: new Date().toISOString(), total: rows.length, verifiedCount: Object.values(results).filter((r) => r.verified).length, results, head: Number(BigInt(await publicRpc('eth_blockNumber', []))) };
}

export default async function run({ q }) {
  if (q.example) return { conditions: EXAMPLE, tokens: TOKENS.filter((t) => !t.native).map((t) => t.symbol), feeds: Object.keys(FEEDS), channels: ['discord', 'telegram', 'ntfy', 'webhook', 'console'] };
  if (q.recorded) { const run = await readRun(); return { run, verification: await verify(run) }; }
  if (q.scan) {
    const blocks = Math.floor(Number(q.blocks ?? 1000));
    if (!Number.isInteger(blocks) || blocks < 10 || blocks > 2000) throw new UserError('blocks must be a whole number from 10 to 2000 (about 15 s to 30 min of chain time)');
    const conditions = validateConditions([
      { id: 'transfer', type: 'transfer', token: q.token ?? 'USDC', min: String(q.min ?? '10000') },
      { id: 'price', type: 'price', feed: q.feed ?? 'PROS/USD', op: q.op ?? 'above', threshold: String(q.threshold ?? '0.60') },
    ]);
    const sent = [];
    const channel = { id: 'preview', type: 'preview', send: async (a) => { sent.push(a); return { ok: true, status: null }; } };
    const state = newState();
    const first = await runCycle({ conditions, channels: [channel], state, lookback: blocks, maxBlocks: Math.min(blocks, MAX_SCAN_BLOCKS) });
    // the very same blocks again (no margin, same start): what was sent must not be sent twice
    const second = await runCycle({ conditions, channels: [channel], state: { ...state, cursor: null, side: {} }, head: first.to, confirmations: 0, lookback: first.to - first.from + 1 });
    return { window: [first.from, first.to], conditions: conditions.map((c) => c.label), alerts: first.alerts.slice(0, 25), total: first.alerts.length, secondPass: { found: second.found, sent: second.delivered.length, suppressed: second.duplicates }, note: 'Preview only: nothing was delivered to a channel from the web. The CLI delivers to your Discord, Telegram, ntfy or webhook.' };
  }
  throw new UserError('use ?example=1, ?recorded=1 or ?scan=1&token=USDC&min=10000&threshold=0.60&blocks=1000');
}
