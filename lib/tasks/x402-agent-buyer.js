// Task: x402 Agent Buyer. The web side of lib/x402-buyer.js: the recorded real run (real HTTP, real settlements on Atlantic, each transfer re-read from the chain on every load),
// and a read-only "what would the buyer decide" against the offers this site's own paywall makes. Nothing is signed or paid from the web.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ROUTES, b64, requirementsFor, parseConfig, HEADERS, X402_VERSION } from '../x402.js';
import { runBuyerJob } from '../x402-buyer.js';
import { ATLANTIC } from '../rpc-chain.js';
import { rpcCall } from '../rpc.js';
import { UserError } from '../snapshot.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = async (p) => JSON.parse(await readFile(ROOT + p, 'utf8'));
const rpc = (method, params) => rpcCall(method, params, { url: ATLANTIC.rpc, why: `x402 buyer verification: ${method}` });
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const baseUnits = (v, label) => { if (typeof v !== 'string' || !/^\d{1,12}$/.test(v) || BigInt(v) === 0n) throw new UserError(`${label} must be a positive integer of token base units (6 decimals: 10000 = 0.01 USDC)`); return v; };

// every settlement of the recording is read back from the chain: a successful transfer of exactly the recorded price, payer → payTo
async function verifyRecorded(run) {
  const txs = run.scenarios.flatMap((s) => s.chain);
  const results = {};
  let head = null;
  await Promise.all(txs.map(async (t) => {
    const r = await rpc('eth_getTransactionReceipt', [t.transaction]);
    const log = r?.logs.find((l) => l.address.toLowerCase() === run.asset && l.topics[0] === TRANSFER);
    results[t.transaction] = { verified: Boolean(log) && r.status === '0x1' && '0x' + log.topics[1].slice(26) === t.from.toLowerCase() && '0x' + log.topics[2].slice(26) === t.to.toLowerCase() && BigInt(log.data).toString() === t.value, block: r ? Number(BigInt(r.blockNumber)) : null };
  }));
  head = Number(BigInt(await rpc('eth_blockNumber', [])));
  return { checkedAt: new Date().toISOString(), head, total: txs.length, verifiedCount: Object.values(results).filter((x) => x.verified).length, results };
}

export default async function run({ q }) {
  if (q.recorded) {
    const rec = await json('reports/x402-buyer-run.json');
    return { run: rec, verification: await verifyRecorded(rec) };
  }
  if (q.decide) {
    const config = await json('config/x402.json');
    const budget = baseUnits(q.budget ?? '15000', 'budget');
    const maxPerCall = baseUnits(q.maxPerCall ?? '10000', 'maxPerCall');
    const values = { '/api/info': baseUnits(q.valueInfo ?? '5000', 'valueInfo'), '/data': baseUnits(q.valueData ?? '10000', 'valueData') };
    const paid = ROUTES.filter((r) => r.price != null);
    // the offers are exactly those the paywall at /x402 makes; nothing is signed
    // a payment is "signed" by a stand-in and "accepted" by a stand-in, so the engine takes every decision it would take; no signature, request to the paywall or token movement exists
    let n = 0;
    const fetchImpl = async (url, init = {}) => {
      const route = paid.find((r) => url.endsWith(r.path));
      const required = { x402Version: X402_VERSION, resource: { url, description: route.description, mimeType: 'application/json' }, accepts: [requirementsFor(parseConfig(config), route)] };
      if (!new Headers(init.headers).has(HEADERS.signature)) return new Response(JSON.stringify(required), { status: 402, headers: { [HEADERS.required]: b64.enc(required) } });
      const transaction = '0x' + (++n).toString(16).padStart(64, '0');
      return new Response('{}', { status: 200, headers: { [HEADERS.response]: b64.enc({ success: true, network: config.network, transaction }) } });
    };
    const signPayment = ({ requirements }) => ({ x402Version: X402_VERSION, accepted: requirements, payload: { signature: '0x', authorization: { from: config.payer, nonce: '0x' + n.toString(16).padStart(64, '0') } } });
    const tasks = paid.map((r) => ({ id: r.path.replace(/\W+/g, '-').replace(/^-|-$/g, ''), name: r.description || r.path, url: `https://offers.invalid${r.path}`, value: values[r.path] }));
    const result = await runBuyerJob({ tasks, budget, maxPerCall, expectedAsset: config.asset, fetchImpl, signPayment });
    result.payments = result.payments.map(({ transaction, ...p }) => p);
    result.results = [];
    return { offers: paid.map((r) => ({ path: r.path, price: r.price })), result, note: 'Read-only: the buyer took its decisions on the real offers of the paywall on this site; nothing was signed or paid. Buying needs the payer key, which only the CLI loads.' };
  }
  throw new UserError('use ?recorded=1, or ?decide=1&budget=15000&maxPerCall=10000&valueInfo=5000&valueData=10000');
}
