// The x402 Paywalled API, hosted: GET /x402/health (free), GET /x402/api/info (0.005 test USDC), GET /x402/data (0.01 test USDC), and the facilitator's /x402-facilitator/supported,
// /verify and /settle, all on Pharos Atlantic testnet (eip155:688689). The paywall answers a real 402 and verifies a real signed payment against the chain. It can SETTLE only if the
// deployment points FACILITATOR_URL to a dedicated single-writer facilitator. Without that URL it is verify-only (503), even if a private key is present. vercel.json maps the pretty paths here.
import { readFileSync } from 'node:fs';
import { HEADERS, createFacilitator, createResourceServer, facilitatorHandler, httpFacilitator } from '../lib/x402.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { rpcCall } from '../lib/rpc.js';

const config = JSON.parse(readFileSync(new URL('../config/x402.json', import.meta.url), 'utf8'));
const rpc = (method, params) => rpcCall(method, params, { url: ATLANTIC.rpc, why: `x402: ${method}` });
// Serverless replicas cannot safely coordinate a shared settlement account nonce in memory.
// A dedicated facilitator owns the key and serializes submissions; this function never loads it.
export function createHostedHandler({ facilitatorUrl = process.env.FACILITATOR_URL, fetchImpl = fetch, rpcImpl = rpc } = {}) {
  const facilitator = facilitatorUrl
    ? httpFacilitator(facilitatorUrl, fetchImpl)
    : createFacilitator({ rpc: rpcImpl, supportedAssets: [{ asset: config.asset, name: config.name, version: config.version, decimals: config.decimals }] });
  const server = createResourceServer({
    config, facilitator,
    handlers: {
      '/health': () => ({ status: 'ok' }),
      '/api/info': () => ({ name: 'Pharos x402 demo', network: 'Pharos Atlantic Testnet', chainId: 688689, timestamp: Date.now() }),
      '/data': () => ({ message: 'Hello, paid user!', timestamp: Date.now() }),
    },
  });
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': `content-type, ${HEADERS.signature}`, 'access-control-expose-headers': `${HEADERS.required}, ${HEADERS.response}` };

  return async function route(req, res) {
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
  };
}

export default createHostedHandler();
