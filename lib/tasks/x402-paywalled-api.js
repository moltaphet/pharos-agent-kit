// Task: x402 Paywalled API. The web side of lib/x402.js: what the paywall asks for, a REAL verification of a signed payment against Pharos Atlantic testnet, the facilitator's
// supported kinds, and the recorded run (the real HTTP flow with its settlement transactions, re-read from the chain on every load).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ROUTES, createFacilitator, b64, requirementsFor, parseConfig, HEADERS, X402_VERSION } from '../x402.js';
import { testnetEvidence } from '../testnet-report.js';
import { ATLANTIC } from '../rpc-chain.js';
import { rpcCall } from '../rpc.js';
import { UserError } from '../snapshot.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
export const readConfig = () => json('config/x402.json');
export const readRun = () => json('reports/x402-run.json');
export const readTokenCheck = () => json('reports/x402-token-check.json');
const rpcAtlantic = (method, params) => rpcCall(method, params, { url: ATLANTIC.rpc, why: `x402 verification: ${method}` });

// A keyless facilitator: it can verify a payment against the chain, but it can never settle one.
async function keylessFacilitator() {
  const c = await readConfig();
  return createFacilitator({ rpc: rpcAtlantic, key: null, supportedAssets: [{ asset: c.asset, name: c.name, version: c.version, decimals: c.decimals }] });
}

export default async function run({ q, body }) {
  const config = await readConfig();
  const publicConfig = { network: config.network, asset: config.asset, name: config.name, version: config.version, decimals: config.decimals, payTo: config.payTo, payer: config.payer, deployTx: config.deployTx, note: config.note };
  if (q.example) {
    return { config: publicConfig, routes: ROUTES.map((r) => ({ method: r.method, path: r.path, price: r.price, description: r.description, ...(r.price && { requirements: requirementsFor(parseConfig(config), r) }) })), headers: HEADERS, x402Version: X402_VERSION };
  }
  if (q.recorded) {
    const [run, tokenCheck] = await Promise.all([readRun(), readTokenCheck()]);
    // every settlement transaction in the recording is read back from the chain now
    const report = { wallet: run.facilitator, transactions: run.settlements.map((s) => ({ hash: s.hash, status: s.status, gasUsed: s.gasUsed, blockNumber: s.blockNumber, from: s.from, to: s.to, valueWei: s.value })) };
    const evidence = await testnetEvidence({ report, rpc: rpcAtlantic });
    return { run, tokenCheck, verification: evidence.verification };
  }
  if (q.challenge) {
    const route = ROUTES.find((r) => r.path === q.challenge && r.price != null);
    if (!route) throw new UserError(`challenge must be one of the paid routes: ${ROUTES.filter((r) => r.price).map((r) => r.path).join(', ')}`);
    const required = { x402Version: X402_VERSION, error: `${HEADERS.signature} header is required`, resource: { url: `/x402${route.path}`, description: route.description, mimeType: 'application/json' }, accepts: [requirementsFor(parseConfig(config), route)] };
    return { status: 402, headers: { [HEADERS.required]: b64.enc(required) }, body: required };
  }
  if (q.supported) return (await keylessFacilitator()).supported();
  if (q.verify) {
    const { paymentPayload, route } = body ?? {};
    const r = ROUTES.find((x) => x.path === route && x.price != null);
    if (!paymentPayload || !r) throw new UserError('POST { "route": "/data", "paymentPayload": { … } } (the decoded PAYMENT-SIGNATURE) to have it verified against the chain');
    const requirements = requirementsFor(parseConfig(config), r);
    return { requirements, verdict: await (await keylessFacilitator()).verify(paymentPayload, requirements), settled: false, note: 'This only verifies. Settlement needs a facilitator key; none is configured here.' };
  }
  throw new UserError('use ?example=1, ?recorded=1, ?challenge=/data, ?supported=1 or POST ?verify=1; the paywalled API itself is at /x402/data, /x402/api/info and /x402/health');
}
