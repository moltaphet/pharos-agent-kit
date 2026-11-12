// Payment history read straight from the chain: every InvoicePaid event the router has emitted.
// Atlantic's public RPC limits eth_getLogs to 1,000 blocks per request, so the newest window is scanned in
// parallel chunks and the result says exactly which blocks it covered. Nothing here is stored or trusted
// from the browser; the events themselves are the record.
import { PAYMENT_TOPIC, addressWord, validAddress } from './validation.js';

const CHUNK = 1000;
const WINDOW = 60000; // about 28 hours of Atlantic blocks
const CONCURRENCY = 4;
const DEFAULT_LIMIT = 25;

const word = (data, index) => BigInt('0x' + data.slice(2 + index * 64, 66 + index * 64));
const addressOf = (topic) => '0x' + topic.slice(-40).toLowerCase();

export function decodePayment(log, token) {
  if (!log?.topics || log.topics.length !== 4 || log.topics[0].toLowerCase() !== PAYMENT_TOPIC) return null;
  if (typeof log.data !== 'string' || log.data.length !== 2 + 128) return null;
  const eventToken = '0x' + log.data.slice(2 + 24, 2 + 64).toLowerCase();
  if (token && eventToken !== token.toLowerCase()) return null;
  return {
    hash: log.transactionHash,
    blockNumber: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex ?? '0x0')),
    payer: addressOf(log.topics[1]),
    invoiceId: log.topics[2].toLowerCase(),
    recipient: addressOf(log.topics[3]),
    amountRaw: word(log.data, 1).toString(),
  };
}

export async function readHistory(config, { rpc, payer = null, limit = DEFAULT_LIMIT, window = WINDOW, deadlineMs = 25000, now = Date.now } = {}) {
  const filter = payer ? validAddress(payer, 'Payer') : null;
  const startedAt = now();
  const latest = Number(BigInt(await rpc('eth_blockNumber')));
  const created = Number(config.deployment?.router?.blockNumber ?? 0);
  const floor = Math.max(created, latest - window + 1, 0);
  const ranges = [];
  for (let to = latest; to >= floor; to -= CHUNK) ranges.push([Math.max(floor, to - CHUNK + 1), to]);

  const events = [];
  let covered = latest + 1;
  let next = 0;
  let stop = false;
  const worker = async () => {
    while (!stop) {
      const index = next++;
      if (index >= ranges.length) return;
      if (now() - startedAt > deadlineMs) { stop = true; return; }
      const [from, to] = ranges[index];
      const topics = [PAYMENT_TOPIC, ...(filter ? ['0x' + addressWord(filter)] : [])];
      const logs = await rpc('eth_getLogs', [{ address: config.router, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics }]);
      for (const log of logs) { const event = decodePayment(log, config.token.address); if (event) events.push(event); }
      covered = Math.min(covered, from);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  events.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  const shown = events.slice(0, limit);
  const blocks = [...new Set(shown.map((event) => event.blockNumber))];
  const stamps = new Map(await Promise.all(blocks.map(async (number) => {
    const block = await rpc('eth_getBlockByNumber', ['0x' + number.toString(16), false]).catch(() => null);
    return [number, block?.timestamp ? Number(BigInt(block.timestamp)) : null];
  })));
  return {
    network: { chainId: config.chainId, router: config.router },
    scope: filter ? 'payer' : 'router',
    payer: filter,
    fromBlock: covered <= latest ? covered : null,
    toBlock: latest,
    complete: covered <= floor,
    total: events.length,
    events: shown.map((event) => ({ ...event, timestamp: stamps.get(event.blockNumber) ?? null })),
  };
}
