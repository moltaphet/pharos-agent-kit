// Task 21: a budgeted agent that discovers x402 prices before deciding to buy.
import { esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const baseUsdc = (n) => `${(Number(n) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} test USDC`;

export const content = {
  tagline: 'A buyer that reads the offer, checks the value and budget, then pays only for data worth its price.',
  tools: ['http'],
  story: [
    'The buyer takes a short plan of useful data to fetch. It asks each x402 endpoint for its price, compares that offer with the value estimate supplied for the task, checks a per-call ceiling and the remaining job budget, then signs only an offer that passes all four checks.',
    'The plan can call two or more different APIs in one job. Each confirmed purchase is logged with its item, exact token-unit price, settlement hash and running total. On Pharos Atlantic the amounts are integer test-USDC base units, so there is no floating-point rounding in budget decisions.',
    'A network error after signing is different from a clean refusal: settlement may already have happened. The buyer retries only the same signed authorization, never signs a replacement for that endpoint, reserves the uncertain price and stops the job until someone checks the transaction. The demo below uses a mock facilitator offline; it does not claim to be a live payment.',
  ],
  how: [
    { server: 'http', tool: 'GET endpoint', text: 'Request the resource without payment. A free 2xx result is returned directly; a paid route returns a PAYMENT-REQUIRED challenge.' },
    { server: 'local', tool: 'evaluate offer', text: 'Validate x402 v2, exact scheme, Atlantic network, token address, EIP-712 domain and uint256 amount; require consistent token/domain across the job.' },
    { server: 'local', tool: 'budget and value policy', text: 'Compare the endpoint’s price with the per-call cap, the remaining total budget and the plan’s explicit value estimate. A caller supplies the estimate; the agent does not invent value.' },
    { server: 'local', tool: 'EIP-712 authorization', text: 'Only after approval, sign the exact offer with the existing x402 signer. The key is loaded from EVM_PRIVATE_KEY or EVM_PRIVATE_KEY_FILE, never from the plan or CLI arguments.' },
    { server: 'http', tool: 'retry same payment', text: 'Send PAYMENT-SIGNATURE. On a transient error retry the same serialized signature; a repeated 402 or ambiguous settlement stops the job and reserves the price.' },
    { server: 'local', tool: 'settlement ledger', text: 'Count the purchase once only when PAYMENT-RESPONSE says success on Atlantic and includes a valid transaction hash; reject duplicate hashes/authorizations.' },
  ],
  decisions: [
    { title: 'Value estimates are explicit inputs', text: 'The agent cannot know whether market data is useful to a particular job. Each plan item states its estimated value in the same token base units; if that value is below the offer, it skips the endpoint without signing.' },
    { title: 'Budgets use integer base units', text: 'Prices, value estimates, caps and budgets are decimal integer strings, not JavaScript floats. The buyer refuses mixed assets or EIP-712 domains because their prices cannot be added safely.' },
    { title: 'No fresh payment after uncertainty', text: 'A lost response can hide a successful settlement. The buyer resends the identical authorization for bounded retries, then reports an unresolved reservation and stops. It never creates a replacement authorization for that endpoint.' },
    { title: 'Confirmed means a success receipt header', text: 'A 200 alone is not proof of payment. Spend is added only when PAYMENT-RESPONSE has success=true, the expected network and a transaction hash. Duplicate hashes and authorizations are not counted twice.' },
    { title: 'The demo is offline and clearly marked', text: 'The two sample jobs use a mock x402 endpoint and injected signer; their hashes are fixture identifiers, not chain transactions. To buy real testnet data, run the CLI against an endpoint and test facilitator you control.' },
  ],
  evidence: [
    'The example plan buys two distinct routes (/api/info and /data); the offline demo exercises both in one completed job.',
    'The engine checks an exact per-call cap and cumulative budget before signing, and demonstrates stopping before the second purchase when only 2,000 units remain.',
    'The confirmed-payment ledger records the endpoint/item, exact price, settlement hash, attempt count and running total; unconfirmed attempts are separately reserved.',
    'Transient retries reuse byte-identical PAYMENT-SIGNATURE data. Uncertain settlement stops the workflow, and repeated transaction hashes or authorization nonces cannot increase the paid total.',
    'Two deterministic task demos are included: a completed two-endpoint job and a job that stops at its budget. Both are explicitly labelled simulated and make no network calls.',
  ],
  files: ['agents/x402-agent-buyer/pharos-buy.js', 'agents/x402-agent-buyer/plan.example.json', 'lib/x402-buyer.js', 'scripts/x402-buyer-demo.mjs', 'reports/x402-buyer-demo.json'],
  run: {
    commands: [
      'node scripts/x402-buyer-demo.mjs',
      'node agents/x402-agent-buyer/pharos-buy.js --plan agents/x402-agent-buyer/plan.example.json --budget 15000 --max-call 10000 --asset 0xa952d7f3dc17da87a71d1e33958139bcd5565eef',
      'node agents/x402-agent-buyer/pharos-buy.js --plan agents/x402-agent-buyer/plan.example.json --budget 7000 --max-call 10000 --asset 0xa952d7f3dc17da87a71d1e33958139bcd5565eef',
    ],
    sampleLabel: 'Deterministic offline mock output; no payment was sent:',
    sample: `OFFLINE BUYER DEMO — mock endpoint and signer; no payment was sent
Job: complete · bought Protocol summary (5000) + Market data (10000) · total 15000 test-USDC base units
  simulated settlement ids: 0x1111…1111, 0x2222…2222 (not explorer transactions)
Job: stopped · bought Protocol summary (5000) · Market data refused: budget has 2000 left but the price is 10000
  confirmed total 5000 · reserved 0 · remaining 2000`,
  },
  verify: [
    { title: 'Inspect the plan', text: 'Each plan entry names a different endpoint and includes a value estimate in token base units.' },
    { title: 'Run the offline scenarios', text: 'The demo script makes no HTTP or RPC requests and marks all settlement IDs as simulated.' },
    { title: 'Run against your test facilitator', text: 'Start the x402 server and facilitator from task 20, set EVM_PRIVATE_KEY_FILE to a funded throwaway Atlantic test wallet, and direct a copied plan to those endpoints. Never use a mainnet key for this demo.', link: [`${REPO}/tree/main/agents/x402-paywalled-api`, 'Task 20 server and facilitator'] },
    { title: 'Read the regression tests', text: 'Fake fetch tests cover price caps, budget stops, value skips, invalid offers, asset mismatch, retries, uncertain settlement and duplicate-payment prevention.', link: [`${REPO}/blob/main/test/x402-buyer.test.js`, 'Buyer tests'] },
  ],
};

const scenarios = [
  { title: 'Job completed', tone: 'ok', rows: [['Protocol summary', '0.005 USDC', 'bought'], ['Market data', '0.01 USDC', 'bought'], ['Running total', '0.015 USDC', 'within 0.015 budget']] },
  { title: 'Budget stop', tone: 'warn', rows: [['Protocol summary', '0.005 USDC', 'bought'], ['Market data', '0.01 USDC', 'refused · 0.002 remains'], ['Running total', '0.005 USDC', 'stopped before signing']] },
];

export function mount(root) {
  root.innerHTML = `<section class="card tn"><h3>Buyer demonstrations</h3>
    <p class="muted">Deterministic offline fixtures. No network call, private key, token movement or real transaction is involved; the sample settlement IDs are not explorer links.</p>
    <div class="grid cols-2">${scenarios.map((s) => `<article class="card"><h4>${pill(s.title, s.tone)}</h4>${table(['Data item', 'Offer', 'Decision'], s.rows.map((r) => r.map(esc)))}</article>`).join('')}</div>
    <p class="muted">The buyer CLI can run the same policy against a test endpoint. It loads keys only from environment variables or a file.</p></section>`;
  return () => { root.replaceChildren(); };
}
