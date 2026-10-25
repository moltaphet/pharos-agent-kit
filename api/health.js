// GET /api/health: are the three upstreams reachable right now, and how fast?
// Cached for a few seconds so many open pages can't hammer the shared MCP servers.
import { chainClient, docsClient, handle } from '../lib/server.js';
import { blockNumber } from '../lib/chain.js';
import { PHAROS_CHAIN_MCP, PHAROS_DOCS_MCP } from '../lib/mcp.js';
import { PHAROS_RPC, rpcCall } from '../lib/rpc.js';

const TTL_MS = 10_000;
let cache = { at: 0, value: null };
let pending = null;

async function probe(id, name, url, run) {
  const start = performance.now();
  try {
    const detail = await run();
    return { id, name, url, ok: true, ms: Math.round(performance.now() - start), detail };
  } catch (err) {
    return { id, name, url, ok: false, ms: Math.round(performance.now() - start), detail: err.message };
  }
}

export default handle(async () => {
  if (Date.now() - cache.at < TTL_MS) return { ...cache.value, cached: true };
  // A burst of cold requests must share probes as well as the eventual cached result.
  if (pending) return { ...await pending, cached: true };
  pending = (async () => {
    const services = await Promise.all([
      probe('chain', 'Chain MCP', PHAROS_CHAIN_MCP, async () => {
        const head = await blockNumber(chainClient());
        if (!Number.isSafeInteger(head) || head < 0) throw new Error('Invalid block number from Chain MCP');
        return `latest block ${head.toLocaleString('en-US')}`;
      }),
      probe('docs', 'Developer Docs MCP', PHAROS_DOCS_MCP, async () => `${(await docsClient().listTools()).length} tools`),
      probe('rpc', 'Public RPC', PHAROS_RPC, async () => {
        const raw = await rpcCall('eth_blockNumber', []);
        if (typeof raw !== 'string' || !/^0x[0-9a-f]+$/i.test(raw) || !Number.isSafeInteger(Number(BigInt(raw)))) throw new Error('Invalid block number from Public RPC');
        return `latest block ${Number(BigInt(raw)).toLocaleString('en-US')}`;
      }),
    ]);
    cache = { at: Date.now(), value: { checkedAt: new Date().toISOString(), services } };
    return cache.value;
  })();
  try { return { ...await pending, cached: false }; }
  finally { pending = null; }
});
