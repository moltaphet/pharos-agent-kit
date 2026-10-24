// x402 Paywalled API: content, a live card that talks to the hosted paywall (a real 402 and real verification), and the recorded real run on Pharos Atlantic testnet
// (every settlement transaction is read back from the chain on each load).
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const EXPLORER = 'https://atlantic.pharosscan.xyz';
const short = (a) => (a && a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a ?? '');
const n = (x) => Number(x).toLocaleString('en-US');
const usdc = (base) => `${(Number(base) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} USDC`;

export const content = {
  tagline: 'An API that charges per request with x402 on Pharos Atlantic testnet: two paid routes, one free, its own facilitator, and a client that pays and gets the data, with every settlement on the explorer.',
  tools: ['chain', 'rpc'],
  story: [
    'x402 puts a price on an HTTP request. A client asks for a paid route, the server answers 402 Payment Required with what it wants (how much, in which token, to whom), the client signs a payment and asks again, and this time it gets a 200 and, in a PAYMENT-RESPONSE header, the hash of the transaction that settled the payment. No account, no API key: the payment is the credential.',
    'This is the whole thing, built from the protocol with no dependency, on Pharos Atlantic testnet (eip155:688689). The server has two paid routes at different prices (GET /api/info at 0.005 USDC and GET /data at 0.01 USDC) and one free route (GET /health). The facilitator is its own service with /verify, /settle and /supported: it checks a payment against the chain and submits it, paying the gas, so the payer needs tokens but no PHRS. The scheme is “exact”: the payer signs an EIP-712 TransferWithAuthorization (EIP-3009) for the exact price, and the token contract moves the money when the facilitator presents it.',
    'It ran for real, over real HTTP, as three separate processes (facilitator, server, client): a 402, a signed payment, a 200 with the PAYMENT-RESPONSE header, and a settlement transaction on Atlantic that the explorer shows, which this page re-reads from the chain every time it loads. Then nine ways of cheating were tried (underpaying, paying the wrong address, an expired authorization, a forged signature, a tampered one, an account with no tokens, replaying a settled payment, garbage, and a payment for the cheaper route sent to the dearer one) and every one got another 402 and moved no token.',
    'One thing the build found: the test USDC named in the Pharos x402 guide cannot be used with this scheme. It has no transferWithAuthorization, no permit, and its mint is restricted, as the check below shows from the chain. So the demo uses a test USDC deployed for it (an EIP-3009 token, not official, no value). The paywall is also hosted on this site: it answers real 402s and verifies real payments against the chain; it cannot settle unless a facilitator key is configured, and says so.',
  ],
  how: [
    { server: 'local', tool: 'GET /data (no payment)', text: 'The server answers 402 with a PAYMENT-REQUIRED header (base64 JSON) and the same in the body: scheme exact, network eip155:688689, the amount in the token’s base units, the token, who to pay, and the EIP-712 domain (name and version) the signature must use.' },
    { server: 'local', tool: 'sign an EIP-3009 authorization', text: 'The client signs TransferWithAuthorization (from, to, value, validAfter, validBefore, a random nonce) with the payer’s key. The key is read from the environment or a file, never from code, and the client refuses to pay more than the cap it was given.' },
    { server: 'local', tool: 'GET /data with PAYMENT-SIGNATURE', text: 'The server decodes the payment, rebuilds the requirements for this route and asks the facilitator over HTTP to verify it.' },
    { server: 'rpc', tool: 'facilitator /verify', text: 'It checks the scheme and network, that the payment is for this route’s amount, token and recipient, that the signed value equals the price, that it has not expired, that the signature is the payer’s, that the payer holds enough and that the nonce is unused, then simulates the transfer against the token contract on Atlantic.' },
    { server: 'rpc', tool: 'facilitator /settle', text: 'It sends transferWithAuthorization to the token, signed by the facilitator’s own key (pays the gas), waits for the receipt, and answers with the transaction hash.' },
    { server: 'local', tool: '200 with PAYMENT-RESPONSE', text: 'The server returns the data and a PAYMENT-RESPONSE header (base64 JSON: success, payer, transaction, network). Anything wrong at any step is another 402 with the reason, and nothing is served.' },
  ],
  decisions: [
    { title: 'Built from the protocol, with no dependency', text: 'The wire format (PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE), EIP-712 hashing, secp256k1 signing (checked byte for byte against cast), RLP and the settlement transaction are written here, so the repository still has one dependency. The facilitator’s three routes and the request bodies are those of the Pharos x402 guide.' },
    { title: 'The token in the docs cannot do this, so we deployed one that can', text: 'The exact scheme needs transferWithAuthorization. The token named in the Pharos x402 guide (0xE0BE…) has neither that nor a permit, and only a role can mint it; the Token Registry’s USDC has none of it either. Both were checked from the chain and recorded. The demo token is clearly labelled as ours, not official, with no value.' },
    { title: 'Underpaying is not a close call', text: 'The exact scheme means exact. A payment signed for half the price is refused with the reason (“underpaid: 5000 base units were signed but the price is 10000”), and so is one for more. The facilitator also checks the signed amount against the route’s price, not against what the client says it paid.' },
    { title: 'Verify, then settle, then serve', text: 'The data is only served after the settlement transaction succeeded on chain. A payment that verifies but cannot be settled serves nothing and charges nothing.' },
    { title: 'A replay is refused by the chain’s own nonce', text: 'The settled authorization’s nonce is used on the token contract, and the facilitator reads that before it does anything: the same PAYMENT-SIGNATURE sent again is another 402.' },
    { title: 'The payer needs no gas', text: 'The settlement transaction’s sender is the facilitator, and the page shows it for each payment: the payer’s only action is a signature.' },
    { title: 'Keys are in the environment or a file', text: 'The facilitator reads FACILITATOR_PRIVATE_KEY (or a file named by FACILITATOR_PRIVATE_KEY_FILE) and the client EVM_PRIVATE_KEY (or EVM_PRIVATE_KEY_FILE). The demo run starts the facilitator as its own process with only a file path in its environment. No key is in the code, on a command line, in a report, or in a prompt.' },
    { title: 'The hosted paywall does not hold a key', text: 'On this site the paywall and the facilitator’s /verify and /supported are live and real, but without a key the facilitator cannot submit a payment, and a valid payment gets a 503 that says so and charges nothing. Settlement is shown by the recorded real run, and anyone can run the three processes locally.' },
  ],
  evidence: [
    'It runs on Pharos Atlantic testnet (eip155:688689): the requirements name the network and the test USDC, and the prices are 0.005 and 0.01 USDC.',
    'There are two paid routes at different prices (GET /api/info at 0.005 USDC, GET /data at 0.01 USDC) and one free route (GET /health).',
    'It runs its own facilitator with GET /supported, POST /verify and POST /settle, as a separate process the server talks to over HTTP.',
    'The demo shows the full flow over real HTTP: a 402, a signed payment, then a 200 with a PAYMENT-RESPONSE header and the transaction hash, linked on the explorer and re-read from the chain on this page.',
    'It rejects a bad or underpaid payment with another 402: nine attempts (underpaid, wrong recipient, expired, forged and tampered signatures, no funds, a replay, garbage, a payment for the wrong route) were all refused and moved no token.',
    'Private keys are read from the environment or a file (FACILITATOR_PRIVATE_KEY and EVM_PRIVATE_KEY, or the _FILE form), never from code or prompts; the recorded run started the facilitator with only a file path.',
  ],
  files: ['lib/x402.js', 'lib/secp256k1.js', 'lib/rlp.js', 'lib/tasks/x402-paywalled-api.js', 'api/x402.js', 'agents/x402-paywalled-api/server.js', 'agents/x402-paywalled-api/facilitator.js', 'agents/x402-paywalled-api/client.js', 'contracts/TestUSDC.sol', 'config/x402.json', 'scripts/x402-setup.mjs', 'scripts/x402-run.mjs', 'reports/x402-run.json', 'reports/x402-token-check.json'],
  run: {
    commands: ['FACILITATOR_PRIVATE_KEY_FILE=… node agents/x402-paywalled-api/facilitator.js   # port 4022: GET /supported, POST /verify, POST /settle', 'node agents/x402-paywalled-api/server.js   # port 4021: GET /health (free), GET /api/info ($0.005), GET /data ($0.01)', 'EVM_PRIVATE_KEY_FILE=… node agents/x402-paywalled-api/client.js http://localhost:4021/data   # 402, pays, 200 and the explorer link', 'node scripts/x402-run.mjs   # all of it, plus nine cheats, recorded to reports/x402-run.json'],
    sample: `GET /health            → 200 {"status":"ok"}   (free)
GET /data              → 402 PAYMENT-SIGNATURE header is required
                         accepts: exact · eip155:688689 · 10000 base units of the test USDC · payTo 0x2629…8b13
GET /data + payment    → 200 {"message":"Hello, paid user!"}   PAYMENT-RESPONSE: success · tx 0x9eb8e6a2…94b1
GET /data, underpaid   → 402 invalid_exact_evm_payload_authorization_value: underpaid: 5000 base units were signed but the price is 10000`,
  },
  verify: [
    { title: 'Read the paywall’s 402 yourself', text: 'The hosted paywall answers a real 402 with its requirements in the PAYMENT-REQUIRED header.', code: 'curl -si https://pharos-agent-kit.vercel.app/x402/data | head -20' },
    { title: 'Open a settlement on the explorer', text: 'Each paid request in the recorded run links to its settlement transaction on Atlantic; its sender is the facilitator, and the token’s Transfer log shows payer → payee for exactly the price.' },
    { title: 'Read the token balances', text: 'The recipient’s balance of the demo token, from the Atlantic RPC.', code: 'cast call 0xa952d7f3dc17da87a71d1e33958139bcd5565eef "balanceOf(address)(uint256)" 0x262927e3f2e3AD7824aa708CdF39106084988B13 --rpc-url https://atlantic.dplabs-internal.com' },
    { title: 'See why the docs’ token cannot be used', text: 'It has no transferWithAuthorization: this call reverts.', code: 'cast call 0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8 "authorizationState(address,bytes32)(bool)" 0x0000000000000000000000000000000000000001 0x0000000000000000000000000000000000000000000000000000000000000001 --rpc-url https://atlantic.dplabs-internal.com' },
    { title: 'Run it yourself', text: 'Start the facilitator, the server and the client in three terminals (the keys come from files or the environment).', code: 'node scripts/x402-run.mjs' },
    { title: 'Read the code', text: 'The protocol, the three processes, the token and the recordings are in the repository.', link: [`${REPO}/tree/main/agents/x402-paywalled-api`, 'agents/x402-paywalled-api'] },
  ],
};

// ---- the live card: the hosted paywall -------------------------------------------------------------------------------------------------
async function probe(path) {
  const t0 = performance.now();
  const res = await fetch(path);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ms: Math.round(performance.now() - t0), headers: { 'PAYMENT-REQUIRED': res.headers.get('PAYMENT-REQUIRED'), 'PAYMENT-RESPONSE': res.headers.get('PAYMENT-RESPONSE') }, body };
}

function mountLive(el) {
  el.innerHTML = `<section class="card tn"><h3>Try the hosted paywall</h3>
    <p class="muted">These requests go to this site’s own x402 server and facilitator, on Atlantic testnet. The paid routes answer a real 402; a payment is verified against the chain. Settling needs a facilitator key, which this deployment does not hold (see the decisions), so a paid request ends with a clear 503.</p>
    <div class="chips"><button type="button" class="chip" data-path="/x402/health">GET /x402/health (free)</button><button type="button" class="chip" data-path="/x402/api/info">GET /x402/api/info (0.005 USDC)</button><button type="button" class="chip" data-path="/x402/data">GET /x402/data (0.01 USDC)</button><button type="button" class="chip" data-path="/x402-facilitator/supported">GET /x402-facilitator/supported</button><button type="button" class="chip" data-path="/x402/nothing">GET /x402/nothing (not a route)</button></div>
    <div data-out><div class="idle">Press a request.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-path]');
    if (!b) return;
    out.innerHTML = '<div class="idle">Asking…</div>';
    try {
      const r = await probe(b.dataset.path);
      let decoded = null;
      if (r.headers['PAYMENT-REQUIRED']) { try { decoded = JSON.parse(atob(r.headers['PAYMENT-REQUIRED'])); } catch { decoded = null; } }
      out.innerHTML = `<p class="check ${r.status === 200 ? 'ok' : r.status === 402 ? 'warn' : 'bad'}"><b>GET ${esc(b.dataset.path)} → HTTP ${r.status}</b> <small class="muted">${r.ms} ms</small></p>
        ${decoded ? `<h4 class="list-h">The PAYMENT-REQUIRED header, decoded</h4>${table(['Field', 'Value'], [['scheme', esc(decoded.accepts[0].scheme)], ['network', esc(decoded.accepts[0].network)], ['amount', `${esc(decoded.accepts[0].amount)} base units = ${esc(usdc(decoded.accepts[0].amount))}`], ['token', `<a href="${EXPLORER}/address/${esc(decoded.accepts[0].asset)}" target="_blank" rel="noopener"><code>${esc(short(decoded.accepts[0].asset))}</code></a>`], ['pay to', `<code>${esc(decoded.accepts[0].payTo)}</code>`], ['EIP-712 domain', esc(`${decoded.accepts[0].extra.name} v${decoded.accepts[0].extra.version}`)], ['resource', esc(decoded.resource.url)]])}` : ''}
        <pre class="plain">${esc(typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2))}</pre>`;
    } catch (err) {
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  });
}

// ---- the recorded real run -----------------------------------------------------------------------------------------------------------
function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded run on Pharos Atlantic testnet, re-read from the chain</h3><div class="idle" data-role="body">Reading every settlement back from the chain…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { run, tokenCheck, verification: ver } = data;
      body.classList.remove('idle');
      const ok = ver.verifiedCount === ver.total;
      const req = run.requests.filter((r) => r.request.method);
      const flow = run.requests.map((r) => [esc(r.label), `<b>${r.response.status}</b>`, `<small>${esc(r.response.body?.error ?? (r.response.paymentResponse ? `PAYMENT-RESPONSE: ${r.response.paymentResponse.success ? 'success' : 'failed'} · tx ${short(r.response.paymentResponse.transaction)}` : JSON.stringify(r.response.body ?? '').slice(0, 90)))}</small>`]);
      const settled = run.settlements.map((s) => [esc(s.path), `<a href="${esc(s.explorer)}" target="_blank" rel="noopener"><code>${esc(short(s.hash))}</code></a> ${ver.results[s.hash]?.verified ? '<span class="ok" title="The chain agrees with the recorded status, gas, block and value">✓</span>' : '<span class="bad">✗</span>'}`, pill(s.status, s.status === 'success' ? 'ok' : 'bad'), `${esc(usdc(s.transferValue))} <small class="muted">${esc(short(s.transferFrom))} → ${esc(short(s.transferTo))}</small>`, `<small>gas paid by <code>${esc(short(s.from))}</code> (the facilitator), not by the payer</small>`]);
      const cheats = run.cheats.map((c) => [esc(c.label), pill(`HTTP ${c.status}`, c.status === 402 ? 'ok' : 'bad'), `<small>${esc((c.reason ?? '').slice(0, 130))}</small>`]);
      const tc = (t, label) => [label, `<code class="tiny">${esc(short(t.token))}</code>`, t.transferWithAuthorization ? pill('yes', 'ok') : pill('no', 'bad'), t.authorizationState ? pill('yes', 'ok') : pill('no', 'bad'), t.permit ? 'yes' : 'no', `<small>${esc(t.mintAttempt)}</small>`];
      body.innerHTML = `
        <p class="check ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} settlement transactions verified on-chain just now</b> (${esc(ver.checkedAt.slice(11, 19))} UTC, testnet block ${n(ver.head)}). Recorded ${esc(run.recordedAt.slice(0, 10))}. Facilitator ${esc(short(run.facilitator))}, payer ${esc(short(run.payer))}, pay-to ${esc(short(run.payTo))}.</p>
        <h4 class="list-h">The flow, over real HTTP (${req.length} requests)</h4>
        ${table(['Request', 'HTTP', 'What came back'], flow)}
        <h4 class="list-h">The settlements, on the explorer</h4>
        ${table(['Route', 'Transaction', 'Status', 'Token moved', 'Gas'], settled)}
        <p class="muted">The recipient received ${esc(usdc(run.summary.payToReceived))} (expected ${esc(usdc(run.summary.expectedPayTo))}). Balances in base units: payer ${esc(run.balances.before.payer)} → ${esc(run.balances.afterPaid.payer)}, pay-to ${esc(run.balances.before.payTo)} → ${esc(run.balances.afterPaid.payTo)}; the cheats and the verify-only calls moved ${esc(run.summary.tokensMovedByCheats)}.</p>
        <h4 class="list-h">Nine ways of cheating, all refused with a 402</h4>
        ${table(['Attempt', 'Answer', 'Reason given'], cheats)}
        <p class="check ${run.summary.cheatsRejectedWith402 === run.summary.cheatsAttempted ? 'ok' : 'bad'}">${run.summary.cheatsRejectedWith402} of ${run.summary.cheatsAttempted} attempts got a 402, and no token moved.</p>
        <h4 class="list-h">Which test USDC can be used with the exact scheme?</h4>
        <p class="muted">Checked on the Atlantic chain on ${esc(tokenCheck.checkedAt.slice(0, 10))}: does the contract have EIP-3009 transferWithAuthorization (what “exact” needs), and can a plain account mint it?</p>
        ${table(['Token', 'Address', 'transferWithAuthorization', 'authorizationState', 'permit', 'Mint by a plain account'], [tc(tokenCheck.docsToken, 'The token in the Pharos x402 guide'), tc(tokenCheck.registryToken, 'The Token Registry’s Atlantic USDC'), tc(tokenCheck.ourToken, 'The test USDC deployed for this demo')])}
        <p class="muted">The demo token is <a href="${esc(run.token.explorer)}" target="_blank" rel="noopener"><code>${esc(short(run.token.address))}</code></a>: ${esc(run.token.note)}</p>`;
    })
    .catch((err) => {
      body.classList.remove('idle');
      body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="run"></div><div data-slot="live"></div>';
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  mountLive(root.querySelector('[data-slot=live]'));
  return () => {};
}
