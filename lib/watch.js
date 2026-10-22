// Core of the event monitor, kept free of I/O so it can be unit-tested.

import { EVENTS, decodeUint, formatUnits, topicToAddress } from './abi.js';

export const MAX_RANGE = 1000; // Chain MCP rejects get_logs ranges larger than this

// Splits [from, to] into windows the server will accept.
export function* pageRange(from, to, size = MAX_RANGE) {
  for (let start = from; start <= to; start += size) yield [start, Math.min(start + size - 1, to)];
}

// One bounded scan for the web API: reads at most `maxPages` windows starting at
// `from` and reports where it stopped, so the caller can resume with `nextFrom`.
export async function scanLogs(client, { address, topic0, from, head, maxPages = 3 }) {
  const logs = [];
  let nextFrom = from;
  let pages = 0;
  for (const [a, b] of pageRange(from, head)) {
    if (pages++ >= maxPages) break;
    logs.push(...(await client.callTool('get_logs', { address, topics: [topic0], fromBlock: a, toBlock: b })));
    nextFrom = b + 1;
  }
  const byPosition = (x, y) => Number(BigInt(x.blockNumber) - BigInt(y.blockNumber)) || Number(BigInt(x.logIndex) - BigInt(y.logIndex));
  return { logs: logs.filter((l) => !l.removed).sort(byPosition), nextFrom };
}

// Identity of a log. Same key => same event, even if we fetch it twice.
export const logKey = (log) => `${log.transactionHash}:${log.logIndex}`;

// Remembers keys but forgets anything older than `keepBlocks`, so a monitor that
// runs for days doesn't grow without bound.
export class Dedupe {
  constructor(keepBlocks = 5000) {
    this.keepBlocks = keepBlocks;
    this.seen = new Map(); // key -> block
  }
  isNew(log) {
    const key = logKey(log);
    if (this.seen.has(key)) return false;
    this.seen.set(key, Number(BigInt(log.blockNumber)));
    return true;
  }
  prune(head) {
    for (const [k, b] of this.seen) if (b < head - this.keepBlocks) this.seen.delete(k);
  }
}

const eventName = Object.fromEntries(Object.entries(EVENTS).map(([n, t]) => [t, n]));

// Turns a raw log into readable fields. `token` = { symbol, decimals } or null.
export function decodeLog(log, token = null) {
  const name = eventName[log.topics[0]] ?? 'Unknown';
  const base = {
    event: name,
    block: Number(BigInt(log.blockNumber)),
    timestamp: log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : null,
    txHash: log.transactionHash,
    logIndex: Number(BigInt(log.logIndex)),
    contract: log.address,
  };
  const amount = (raw) =>
    raw == null ? null : { raw: raw.toString(), formatted: token?.decimals != null ? formatUnits(raw, token.decimals) : raw.toString(), symbol: token?.symbol ?? null };
  const value = decodeUint(log.data);

  switch (name) {
    case 'Transfer':
      // ERC-20 has 3 topics + amount in data; ERC-721 indexes the tokenId as a 4th topic.
      if (log.topics.length === 4) {
        return { ...base, from: topicToAddress(log.topics[1]), to: topicToAddress(log.topics[2]), tokenId: BigInt(log.topics[3]).toString() };
      }
      return { ...base, from: topicToAddress(log.topics[1]), to: topicToAddress(log.topics[2]), amount: amount(value) };
    case 'Approval':
      return { ...base, owner: topicToAddress(log.topics[1]), spender: topicToAddress(log.topics[2]), amount: amount(value) };
    case 'Deposit':
      return { ...base, to: topicToAddress(log.topics[1]), amount: amount(value) };
    case 'Withdrawal':
      return { ...base, from: topicToAddress(log.topics[1]), amount: amount(value) };
    default:
      return { ...base, topics: log.topics, data: log.data };
  }
}
