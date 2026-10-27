// Task 21: a budgeted agent that discovers x402 prices before deciding to buy.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const baseUsdc = (n) => `${(Number(n) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} test USDC`;

export const content = {
  tagline: 'A buyer that reads the offer, checks the value and budget, then pays only for data worth its price.',
  tools: ['http'],
  story: [
    'The buyer takes a short plan of useful data to fetch. It asks each x402 endpoint for its price, compares that offer with the value estimate supplied for the task, checks a per-call ceiling and the remaining job budget, then signs only an offer that passes all four checks.',
    'The plan can call two or more different APIs in one job. Each confirmed purchase is logged with its item, exact token-unit price, settlement hash and running total. On Pharos Atlantic the amounts are integer test-USDC base units, so there is no floating-point rounding in budget decisions.',
    'A network error after signing is different from a clean refusal: settlement may already have happened. The buyer retries only the same signed authorization, never signs a replacement for that endpoint, reserves the uncertain price and stops the job until someone checks the transaction. The jobs below are real: the settlements are Atlantic transactions you can open.',
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
    { title: 'The demonstration is a real run', text: 'The recorded jobs call the task-20 facilitator and paywalled server over HTTP as separate processes, sign real EIP-3009 authorizations and settle on Pharos Atlantic. Every settlement the buyer reports is read back from the chain: a successful transfer of exactly that price, payer to payee, and the payer’s token balance fell by exactly the ledger total.' },
  ],
  evidence: [
    'The plan buys two distinct routes of the task-20 server (/api/info and /data) in one job; both settle on Atlantic and are re-read from the chain on this page.',
    'The engine checks an exact per-call cap and the cumulative budget before signing; the recorded budget-stop job buys one endpoint and refuses the other with 2,000 units left against a 10,000 price.',
    'The confirmed-payment ledger records the item, exact price, settlement hash, attempt count and running total; unconfirmed attempts are reserved separately.',
    'Transient retries reuse byte-identical PAYMENT-SIGNATURE data. Uncertain settlement stops the job, and repeated transaction hashes or authorization nonces cannot raise the paid total.',
    'Three real jobs are recorded: one completed, one stopped by the budget, one that skipped an endpoint priced above its estimated value. In each the payer’s balance moved by exactly the ledger total.',
  ],
  files: ['agents/x402-agent-buyer/pharos-buy.js', 'agents/x402-agent-buyer/plan.example.json', 'lib/x402-buyer.js', 'lib/tasks/x402-agent-buyer.js', 'scripts/x402-buyer-run.mjs', 'reports/x402-buyer-run.json'],
  run: {
    commands: [
      'node scripts/x402-buyer-run.mjs   # starts the task-20 facilitator and server, runs three real jobs on Atlantic, reads every settlement back, writes reports/x402-buyer-run.json',
      'node agents/x402-agent-buyer/pharos-buy.js --plan agents/x402-agent-buyer/plan.example.json --budget 15000 --max-call 10000 --asset 0xa952d7f3dc17da87a71d1e33958139bcd5565eef   # against your own running server (EVM_PRIVATE_KEY_FILE = a funded throwaway Atlantic key)',
    ],
    sampleLabel: 'Output of node scripts/x402-buyer-run.mjs (real settlements on Atlantic):',
    sample: `  complete: complete · spent 15000 · token moved 15000 · ledger agrees with chain: true
  budget-stop: stopped (budget) · spent 5000 · token moved 5000 · ledger agrees with chain: true
  not-worth-it: complete · spent 5000 · token moved 5000 · ledger agrees with chain: true
wrote reports/x402-buyer-run.json: 4 real settlement(s), ledger vs chain agree`,
  },
  verify: [
    { title: 'Open a settlement', text: 'Each purchase in the recorded run links to its transaction on Atlantic; the token’s Transfer log shows payer → payee for exactly the price.' },
    { title: 'Try the decisions yourself', text: 'Change the budget, the per-call cap and the value estimates on the Try tab: the buyer takes its decisions on the paywall’s real offers. Nothing is signed or paid from the web.' },
    { title: 'Run it', text: 'Run the script; it needs the throwaway Atlantic wallets of task 20 (scripts/x402-setup.mjs).', code: 'node scripts/x402-buyer-run.mjs' },
    { title: 'Read the regression tests', text: 'Tests cover price caps, budget stops, value skips, invalid offers, asset mismatch, retries, uncertain settlement and duplicate-payment prevention.', link: [`${REPO}/blob/main/test/x402-buyer.test.js`, 'test/x402-buyer.test.js'] },
  ],
};

const usdc = (n) => `${(Number(n) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} USDC`;
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const num = (n) => Number(n).toLocaleString('en-US');

function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded run on Pharos Atlantic testnet, re-read from the chain</h3><div class="idle" data-role="body">Reading every settlement back from the chain…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 }).then(({ data }) => {
    const { run, verification: ver } = data;
    body.classList.remove('idle');
    const ok = ver.verifiedCount === ver.total;
    body.innerHTML = `<p class="check ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} settlement transactions verified on-chain just now</b> (testnet block ${num(ver.head)}). Recorded ${esc(run.recordedAt.slice(0, 16).replace('T', ' '))} UTC.</p>` +
      run.scenarios.map((sc) => `<h4 class="list-h">${esc(sc.title)} ${pill(sc.result.status === 'complete' ? 'complete' : `stopped · ${sc.result.stopReason}`, sc.result.status === 'complete' ? 'ok' : 'warn')}</h4>
        ${table(['Item', 'Decision', 'Price', 'Detail'], sc.result.decisions.map((d) => [esc(d.item), pill(d.decision, d.decision === 'bought' ? 'ok' : 'warn'), d.price ? esc(usdc(d.price)) : '', `<small>${esc(d.detail)}</small>`]))}
        ${sc.chain.length ? table(['Transaction', 'Block', 'Token moved', 'Chain agrees'], sc.chain.map((c) => [`<a href="${esc(c.explorer)}" target="_blank" rel="noopener"><code>${esc(short(c.transaction))}</code></a>`, num(c.block), esc(usdc(c.value)), ver.results[c.transaction]?.verified ? pill('yes', 'ok') : pill('no', 'bad')])) : ''}
        <p class="muted">Budget ${esc(usdc(sc.budget))} · spent ${esc(usdc(sc.result.spent))} · remaining ${esc(usdc(sc.result.remaining))} · the payer’s balance fell by ${esc(usdc(sc.tokenMoved))}${sc.ledgerAgreesWithChain ? ' (equal to the ledger)' : ' — DISAGREES with the ledger'}.</p>`).join('') +
      `<p class="muted">Token: test USDC <code>${esc(short(run.asset))}</code> deployed for this demo (task 20); payer ${esc(short(run.payer))}, payee ${esc(short(run.payTo))}. Without a key the buyer stops before signing: ${esc(run.noKey.stopReason)}.</p>`;
  }).catch((err) => { body.classList.remove('idle'); body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

function mountDecide(el, slug) {
  el.innerHTML = `<section class="card tn"><h3>What would the buyer decide?</h3>
    <p class="muted">The buyer reads the real offers of this site’s paywall (0.005 and 0.01 USDC) and decides under your limits. Amounts are token base units (6 decimals: 10000 = 0.01 USDC). Nothing is signed or paid from the web.</p>
    <form class="row" data-form>${[['budget', 'Budget', 15000], ['maxPerCall', 'Per-call cap', 10000], ['valueInfo', 'Value of /api/info', 5000], ['valueData', 'Value of /data', 10000]].map(([k, l, v]) => `<label>${l}<input name="${k}" type="number" min="1" step="1" value="${v}"></label>`).join('')}<button type="submit" class="chip">Decide</button></form>
    <div data-out><div class="idle">Press Decide.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    out.innerHTML = '<div class="idle">Reading the offers…</div>';
    try {
      const { data } = await api('run', { slug, decide: 1, ...f });
      const r = data.result;
      out.innerHTML = `<p class="check ${r.status === 'complete' ? 'ok' : 'warn'}"><b>${esc(r.status)}${r.stopReason ? ` · ${esc(r.stopReason)}` : ''}</b> · would spend ${esc(usdc(r.spent))} of ${esc(usdc(r.budget))}</p>` +
        table(['Item', 'Decision', 'Price', 'Detail'], r.decisions.map((d) => [esc(d.item), pill(d.decision, d.decision === 'bought' ? 'ok' : 'warn'), d.price ? esc(usdc(d.price)) : '', `<small>${esc(d.detail.replace(/Settlement confirmed in [^.]*\./, 'Within every limit: it would sign and buy.'))}</small>`])) + `<p class="muted">${esc(data.note)}</p>`;
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="decide"></div><div data-slot="run"></div>';
  mountDecide(root.querySelector('[data-slot=decide]'), ctx.slug);
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  return () => { root.replaceChildren(); };
}
