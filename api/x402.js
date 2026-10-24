// The x402 Paywalled API, hosted: GET /x402/health (free), GET /x402/api/info (0.005 test USDC), GET /x402/data (0.01 test USDC), and the facilitator's /x402-facilitator/supported,
// /verify and /settle, all on Pharos Atlantic testnet (eip155:688689). The paywall answers a real 402 and verifies a real signed payment against the chain. It can SETTLE only if the
// deployment has a facilitator key (FACILITATOR_PRIVATE_KEY, a throwaway testnet key): without one it says so (503) and charges nothing. vercel.json maps the pretty paths here.
import { readFileSync } from 'node:fs';
import { HEADERS, createFacilitator, createResourceServer, facilitatorHandler, loadPrivateKey } from '../lib/x402.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { rpcCall } from '../lib/rpc.js';

const config = JSON.parse(readFileSync(new URL('../config/x402.json', import.meta.url), 'utf8'));
const rpc = (method, params) => rpcCall(method, params, { url: ATLANTIC.rpc, why: `x402: ${method}` });
let key = null;
try { key = loadPrivateKey({ name: 'FACILITATOR_PRIVATE_KEY' }); } catch { key = null; }
const facilitator = createFacilitator({ rpc, key, supportedAssets: [{ asset: config.asset, name: config.name, version: config.version, decimals: config.decimals }] });
const server = createResourceServer({
  config, facilitator,
  handlers: {
    '/health': () => ({ status: 'ok' }),
    '/api/info': () => ({ name: 'Pharos x402 demo', network: 'Pharos Atlantic Testnet', chainId: 688689, timestamp: Date.now() }),
    '/data': () => ({ message: 'Hello, paid user!', timestamp: Date.now() }),
  },
});
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': `content-type, ${HEADERS.signature}`, 'access-control-expose-headers': `${HEADERS.required}, ${HEADERS.response}` };

export default async function route(req, res) {
  const url = new URL(req.url, `https://${req.headers.host ?? 'localhost'}`);
  const scope = url.searchParams.get('scope') === 'facilitator' ? 'facilitator' : 'resource';
  const path = '/' + (url.searchParams.get('path') ?? '').replace(/^\/+/, '');
  const send = (status, headers, body) => { for (const [k, v] of Object.entries({ ...CORS, ...headers })) res.setHeader(k, v); res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(204, {}, {});
  try {
    if (scope === 'facilitator') {
      const out = await facilitatorHandler(facilitator, { method: req.method, path, body: req.body ?? null });
      return send(out.status, {}, out.body);
    }
    const out = await server.handle({ method: req.method, path, headers: req.headers, baseUrl: `${req.headers['x-forwarded-proto'] ?? (/^localhost|^127\./.test(req.headers.host ?? '') ? 'http' : 'https')}://${req.headers.host}/x402` });
    return send(out.status, out.headers, out.body);
  } catch (err) {
    return send(500, {}, { error: err.message });
  }
}
