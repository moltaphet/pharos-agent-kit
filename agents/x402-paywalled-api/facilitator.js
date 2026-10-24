#!/usr/bin/env node
// Task: x402 Paywalled API: the facilitator. GET /supported, POST /verify, POST /settle (the same three routes as in the Pharos x402 guide), on Pharos Atlantic testnet.
// It needs a key to settle (it pays the gas): FACILITATOR_PRIVATE_KEY in the environment, or a file named by FACILITATOR_PRIVATE_KEY_FILE. Never put a key in code or on the command line.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createFacilitator, facilitatorHandler, loadPrivateKey } from '../../lib/x402.js';
import { ATLANTIC } from '../../lib/rpc-chain.js';
import { rpcCall } from '../../lib/rpc.js';

const port = Number(process.env.PORT ?? 4022);
const config = JSON.parse(readFileSync(new URL('../../config/x402.json', import.meta.url), 'utf8'));
const key = loadPrivateKey({ name: 'FACILITATOR_PRIVATE_KEY' });
const rpc = (method, params) => rpcCall(method, params, { url: ATLANTIC.rpc, why: `x402 facilitator: ${method}` });
const facilitator = createFacilitator({ rpc, key, supportedAssets: [{ asset: config.asset, name: config.name, version: config.version, decimals: config.decimals }] });

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  let json = null;
  try { json = body ? JSON.parse(body) : null; } catch { /* handled below */ }
  const out = body && json == null ? { status: 400, body: { error: 'the body is not JSON' } } : await facilitatorHandler(facilitator, { method: req.method, path: new URL(req.url, 'http://x').pathname, body: json }).catch((e) => ({ status: 500, body: { error: e.message } }));
  res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
}).listen(port, () => console.log(`x402 facilitator on http://localhost:${port} (eip155:688689, settles from ${facilitator.address})`));
