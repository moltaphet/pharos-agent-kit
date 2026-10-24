#!/usr/bin/env node
// Task: x402 Paywalled API: the resource server. GET /health is free; GET /api/info costs 0.005 USDC and GET /data costs 0.01 USDC. Anything else without a valid payment gets a 402.
// FACILITATOR_URL says where the facilitator is (default http://localhost:4022).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { HEADERS, createResourceServer, httpFacilitator } from '../../lib/x402.js';

const port = Number(process.env.PORT ?? 4021);
const config = JSON.parse(readFileSync(new URL('../../config/x402.json', import.meta.url), 'utf8'));
const server = createResourceServer({
  config,
  facilitator: httpFacilitator(process.env.FACILITATOR_URL ?? 'http://localhost:4022'),
  handlers: {
    '/health': () => ({ status: 'ok' }),
    '/api/info': () => ({ name: 'Pharos x402 demo', network: 'Pharos Atlantic Testnet', chainId: 688689, timestamp: Date.now() }),
    '/data': () => ({ message: 'Hello, paid user!', timestamp: Date.now() }),
  },
});
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const out = await server.handle({ method: req.method, path: url.pathname, headers: req.headers, baseUrl: `http://localhost:${port}` });
  res.writeHead(out.status, out.headers).end(JSON.stringify(out.body));
}).listen(port, () => console.log(`x402 server on http://localhost:${port}: GET /health (free), GET /api/info ($0.005), GET /data ($0.01); header ${HEADERS.signature}`));
