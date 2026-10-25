#!/usr/bin/env node
// Fully offline, deterministic buyer demo. The signer, endpoints and settlement receipts are fixtures.
// These hashes are simulated identifiers and must never be opened on an explorer.
import { writeFileSync } from 'node:fs';
import { b64, HEADERS, NETWORK } from '../lib/x402.js';
import { runBuyerJob } from '../lib/x402-buyer.js';

const asset = '0xa952d7f3dc17da87a71d1e33958139bcd5565eef';
const payTo = '0x262927e3f2e3AD7824aa708CdF39106084988B13';
const plan = [
  { id: 'protocol-summary', name: 'Protocol summary', url: 'https://mock.invalid/api/info', value: '5000' },
  { id: 'market-data', name: 'Market data', url: 'https://mock.invalid/data', value: '10000' },
];
const txs = ['0x' + '11'.repeat(32), '0x' + '22'.repeat(32)];
let settlement = 0;
const response = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const fetchImpl = async (url, init = {}) => {
  const route = url.endsWith('/api/info') ? 0 : 1;
  if (!new Headers(init.headers).has(HEADERS.signature)) {
    const offer = { x402Version: 2, resource: { url }, accepts: [{ scheme: 'exact', network: NETWORK, amount: route ? '10000' : '5000', asset, payTo, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } }] };
    return response(402, offer, { [HEADERS.required]: b64.enc(offer) });
  }
  const hash = txs[settlement++];
  return response(200, { data: route ? 'simulated market data' : 'simulated protocol summary' }, { [HEADERS.response]: b64.enc({ success: true, network: NETWORK, transaction: hash }) });
};
let nonce = 0;
const signPayment = ({ requirements }) => ({ x402Version: 2, accepted: requirements, payload: { signature: `simulated-signature-${++nonce}`, authorization: { from: '0x581A4ffEd2ca1C7A1211dF2273DFf5e2AbA73fb7', nonce: '0x' + nonce.toString(16).padStart(64, '0') } } });

const common = { tasks: plan, maxPerCall: '10000', fetchImpl, signPayment };
const complete = await runBuyerJob({ ...common, budget: '15000' });
settlement = 0;
nonce = 0;
const budgetStop = await runBuyerJob({ ...common, budget: '7000' });
const report = {
  generatedAt: new Date().toISOString(),
  mode: 'simulated',
  disclaimer: 'Offline mock endpoints, injected signer and mock settlement hashes. No network request, key, token or on-chain transaction was used.',
  scenarios: [
    { id: 'complete', title: 'Job completed within budget', result: complete },
    { id: 'budget-stop', title: 'Stopped at the budget before buying the second endpoint', result: budgetStop },
  ],
};
const output = new URL('../reports/x402-buyer-demo.json', import.meta.url);
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
