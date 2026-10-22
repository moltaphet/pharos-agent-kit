// GET /api/logs?address=0x…&event=Transfer[&from=BLOCK]
// Without `from` it just reports the chain head (the browser then watches "from now").
// With `from` it scans forward (bounded) and returns decoded events plus `nextFrom`.
import { chainClient, handle, need, one } from '../lib/server.js';
import { EVENTS, isAddress } from '../lib/abi.js';
import { blockNumber, readToken } from '../lib/chain.js';
import { decodeLog, scanLogs } from '../lib/watch.js';
import { KNOWN } from '../lib/labels.js';

const MAX_BEHIND = 5000; // never let one request chew through more than this
const tokens = new Map(); // symbol/decimals never change, so cache per contract

export default handle(async (q) => {
  const address = (one(q.address) || '').toLowerCase();
  need(isAddress(address), 'address must be a 0x contract address');
  const event = one(q.event) || 'Transfer';
  need(EVENTS[event], `event must be one of ${Object.keys(EVENTS).join(', ')}`);
  const from = one(q.from);
  need(!from || /^\d{1,12}$/.test(from), 'from must be a block number');

  const client = chainClient();
  const head = await blockNumber(client, 'Ask which block is the latest');
  const cached = tokens.has(address);
  if (!cached) {
    const { symbol, decimals } = await readToken(client, address);
    tokens.set(address, { symbol, decimals });
  }
  const token = tokens.get(address);
  if (!from) return { head, nextFrom: head + 1, token, tokenCached: cached, events: [], labels: {} };

  const start = Math.max(Number(from), head - MAX_BEHIND);
  const { logs, nextFrom } = await scanLogs(client, { address, topic0: EVENTS[event], from: start, head });
  const events = logs.map((l) => decodeLog(l, token));
  const labels = {};
  for (const e of events) for (const a of [e.from, e.to, e.owner, e.spender]) if (a && KNOWN[a.toLowerCase()]) labels[a] = KNOWN[a.toLowerCase()];
  return { head, nextFrom, scanned: { from: start, to: nextFrom - 1 }, clamped: start !== Number(from), token, tokenCached: cached, events, labels };
});
