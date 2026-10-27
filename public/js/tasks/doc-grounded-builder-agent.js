// Task 29: "how do I do X on Pharos?", answered end to end: the docs for the plan, Chain MCP for the action, the chain for the verification.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const TONE = { success: 'ok', prepared: 'ok', 'explained-only': 'warn', 'not-covered': 'warn', 'needs-input': 'warn', failure: 'bad', pending: 'warn' };
const ACTOR = { 'docs-mcp': 'Docs MCP', 'chain-mcp': 'Chain MCP', 'chain-rpc': 'Atlantic RPC', 'public-rpc': 'Public RPC', agent: 'The agent' };
const short = (h) => `${String(h).slice(0, 10)}…${String(h).slice(-6)}`;

export const content = {
  tagline: 'Ask “how do I do X on Pharos?”: it finds the answer in the docs, does X through Chain MCP, and checks on chain that it worked.',
  tools: ['docs', 'chain', 'rpc'],
  story: [
    'You ask a question the way a developer would: “How do I read the BTC/USD price on Pharos?”, “How do I send 0.001 PROS to…?”, “How do I deploy a contract to the Atlantic testnet?”. The agent first asks Developer Docs MCP, keeps only an answer the documentation really supports, and lists the pages it cites. That is the plan.',
    'It then reads the facts it needs from the docs pages themselves, not from memory: the chain ID of the network, the address of the price feed from the docs table, the heartbeat that decides what counts as fresh. It does the work through Chain MCP and checks it: a second source for every read, the chain ID against the docs, the price against the heartbeat.',
    'Anything that moves funds is only prepared: the agent builds the unsigned transaction (nonce, gas, fee, balance check) and hands it over, because it holds no key. When you give back the hash of the transaction you signed, it reads the receipt and says, step by step, whether the outcome matches the plan. A question the docs do not cover is answered with exactly that, and nothing is done.',
  ],
  how: [
    { server: 'docs', tool: 'askQuestion + searchDocumentation', text: 'The plan: an answer that must pass the docs-support test (it must not refuse, the search must match, and it must link a docs page), with the pages it cites.' },
    { server: 'docs', tool: 'getPage', text: 'The network page (chain ID, RPC, explorer) and, for prices, the feeds page (the table of proxy addresses, the decimals, the heartbeat). The agent reads its facts here.' },
    { server: 'chain', tool: 'get_chain_info, get_balance, eth_call', text: 'The action on mainnet; Atlantic testnet is served by the same calls over its RPC. Reads are pinned to one block two behind the head.' },
    { server: 'chain', tool: 'get_transaction_count, get_gas_price, estimate_gas', text: 'For a transfer or a deployment: the unsigned transaction and the proof that it would succeed now.' },
    { server: 'rpc', tool: 'a second read', text: 'Every read is repeated on the public RPC; the two must agree. After signing, the receipt, the transaction and the code at the new address are read back.' },
  ],
  decisions: [
    { title: 'The docs are the source of facts, and the agent says when they are silent', text: 'The chain ID, the price feed address and its decimals are read from the docs pages. If the page does not state one, the agent stops. If the docs do not support the question at all, it does nothing and says so: it never improvises an answer or an action.' },
    { title: 'Fund-moving actions are prepared, not performed', text: 'The agent has no key. A transfer comes back unsigned with its nonce, gas and a check that the sender can afford it; a deployment likewise. On mainnet the recorded run stops there. On Atlantic, the throwaway testnet wallet plays the user: it signs, and the agent verifies.' },
    { title: 'Four things it can do, and it says so', text: 'Checking a balance, reading a price feed, preparing a transfer of PROS, preparing a contract deployment. For anything else the docs explain, it explains with sources and stops: “not something I can do myself”.' },
    { title: 'Verification is against the plan, not just success', text: 'A deployment is verified by the receipt’s contract address, the code there being byte for byte the compiled Counter, and a call to it answering; a transfer by its sender, recipient, amount, nonce and chain.' },
    { title: 'Sources are labelled cited or related', text: 'Only a page the answer itself links counts as cited. Pages the search merely returned are shown as related.' },
  ],
  evidence: [
    'The docs answer comes first: a plan with the pages it cites, produced by Docs MCP and accepted only if the docs support the question; the facts the action uses come from the docs pages.',
    'Reads go through Chain MCP; the transfer and the deployment are prepared as unsigned transactions. The mainnet transfer was never signed or sent; the Atlantic ones were signed by the throwaway wallet standing in for the user.',
    'Each run ends with a list of checks against the plan (chain ID, a second read, freshness; or sender, recipient, amount, nonce, code and a call) and a verdict of success or failure.',
    'Six different requests were done and verified or prepared: a balance, two price feeds, a transfer on mainnet (prepared), a transfer on Atlantic (signed, verified) and a deployment (signed, verified).',
    'Two requests the docs do not cover (liquidity on FaroSwap, baking bread) were answered with “the docs do not cover this” and nothing was done; a third the docs explain but the agent cannot do (running a validator) was explained with sources and left there.',
  ],
  files: ['agents/doc-grounded-builder-agent/pharos-build.js', 'lib/builder.js', 'lib/builder-artifacts.js', 'lib/tasks/doc-grounded-builder-agent.js', 'lib/rpc-chain.js', 'scripts/builder-run.mjs', 'reports/builder-run.json'],
  run: {
    commands: [
      'node scripts/builder-run.mjs   # nine real requests: reads, a prepared transfer, two signed Atlantic transactions, and three the docs cannot support',
      'node agents/doc-grounded-builder-agent/pharos-build.js "How do I read the BTC/USD price on Pharos?"',
      'node agents/doc-grounded-builder-agent/pharos-build.js "How do I send 0.001 PROS to 0x… from 0x…?" --save-prepared prepared.json',
      'node agents/doc-grounded-builder-agent/pharos-build.js --verify 0x<hash of the transaction you signed> --prepared prepared.json',
    ],
    sampleLabel: 'Output of node scripts/builder-run.mjs:',
    sample: `balance: → success: Done and verified: 0x1159105d… holds 2.995240515625 PROS
price-pros: → success: Done and verified: PROS/USD is $0.5986, observed 241 s before block 21,397,235
send-mainnet: → prepared: Prepared for your signature: 0.001 PROS to 0x000000…00dEaD
send-atlantic: → prepared → success
deploy: → prepared → success
not-covered-1: → not-covered: The docs do not cover this, so I did nothing
explained-only: → explained-only: The docs explain this, but it is not something I can do myself`,
  },
  verify: [
    { title: 'Ask your own', text: 'The Try tab takes any question; the examples are the recorded ones.' },
    { title: 'Check the docs’ facts', text: 'The agent’s chain ID and feed address are on these pages.', link: ['https://docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe', 'Chainlink Push Engine Feeds (docs)'] },
    { title: 'Open the two Atlantic transactions', text: 'The Run tab links the signed transfer and deployment; the deployed Counter’s code is on the explorer.' },
    { title: 'Read the tests', text: 'Understanding the request, the docs-support gate, each recipe, and the verification of a signed outcome run against fake docs and chain clients.', link: [`${REPO}/blob/main/test/builder.test.js`, 'test/builder.test.js'] },
  ],
};

function renderRun(r, { slug, onSigned = null } = {}) {
  const v = r.verdict;
  const prepared = r.prepared ? `<h4 class="list-h">The prepared transaction (unsigned)</h4><pre class="plain">${esc(JSON.stringify(r.prepared, (k, x) => (k === 'data' && String(x).length > 80 ? `${String(x).slice(0, 66)}… (${(String(x).length - 2) / 2} bytes)` : x), 2))}</pre>
    <form data-signed class="row"><label style="flex:1">Hash of the transaction you signed and sent<input name="hash" style="width:100%" placeholder="0x…"></label><label>Network<select name="network"><option value="${r.request?.network ?? 'mainnet'}">${r.request?.network === 'atlantic' ? 'Atlantic testnet' : 'Pharos mainnet'}</option></select></label><button class="chip" type="submit">Verify it</button></form><div data-outcome></div>` : '';
  return `<p class="check ${TONE[v.status] ?? 'warn'}"><b>${esc(v.headline)}</b><br><small>${esc(v.reason)}</small></p>
    ${r.docs?.answer ? `<h4 class="list-h">The plan, from the docs</h4><blockquote>${esc(r.docs.answer).replace(/\n/g, '<br>')}</blockquote><p class="muted">Sources: ${r.docs.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${s.cited ? ' ✓cited' : ''}`).join(' · ')}</p>` : ''}
    ${r.plan?.length ? `<h4 class="list-h">The plan</h4><ol>${r.plan.map((p) => `<li>${p.done ? '✓' : '○'} ${esc(p.step)} <small class="muted">[${esc(p.from)}]</small></li>`).join('')}</ol>` : ''}
    ${r.verification?.length ? `<h4 class="list-h">Checked against the plan</h4>${table(['Check', 'Expected', 'Got', ''], r.verification.map((c) => [esc(c.what), esc(c.expected), esc(c.actual), c.ok ? pill('✓', 'ok') : pill('✗', 'bad')]))}` : ''}
    ${r.result ? `<p class="muted">Result: ${esc(JSON.stringify(r.result, (k, x) => x))}</p>` : ''}
    ${prepared}
    <h4 class="list-h">Every step</h4>${table(['#', 'Who', 'What', 'Result'], r.steps.map((s) => [s.n, esc(ACTOR[s.actor] ?? s.actor), esc(s.what), esc(String(s.result ?? ''))]))}`;
}

function mountTry(el, slug, examples) {
  el.innerHTML = `<section class="card tn"><h3>Ask a “how do I…” question</h3>
    <p class="muted">The agent plans with the docs, acts through Chain MCP and verifies on chain. It never signs: anything that moves funds comes back prepared. (15 to 25 seconds.)</p>
    <form data-form><div class="row"><label style="flex:1">Your question<input name="question" style="width:100%" value="How do I read the BTC/USD price on Pharos?"></label><button type="submit" class="chip">Ask</button></div></form>
    <div class="chips" data-ex>${examples.map((e) => `<button type="button" class="chip" data-q="${esc(e.question)}">${esc(e.title.replace(/^[A-Za-z ]+: /, ''))}</button>`).join('')}</div>
    <div data-out><div class="idle">Ask something.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  const go = async (question) => {
    out.innerHTML = '<div class="idle">Reading the docs, then the chain…</div>';
    try {
      const { data } = await api('run', { slug, ask: 1, question });
      out.innerHTML = renderRun(data.result);
      const f = out.querySelector('[data-signed]');
      if (f) f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const hash = new FormData(f).get('hash'); const box = out.querySelector('[data-outcome]');
        box.innerHTML = '<div class="idle">Reading the receipt…</div>';
        try { const res = await api('run', { slug, verify: 1 }, { method: 'POST', body: { prepared: data.result.prepared, hash, network: data.result.request.network } }); box.innerHTML = `<p class="check ${res.data.outcome.status === 'success' ? 'ok' : 'bad'}"><b>${esc(res.data.outcome.headline)}</b></p>${table(['Check', 'Expected', 'Got', ''], res.data.outcome.verification.map((c) => [esc(c.what), esc(c.expected), esc(c.actual), c.ok ? pill('✓', 'ok') : pill('✗', 'bad')]))}`; } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      });
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };
  el.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); go(new FormData(e.target).get('question')); });
  el.querySelector('[data-ex]').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (!b) return; el.querySelector('[name=question]').value = b.dataset.q; go(b.dataset.q); });
}

function mountRun(el, rec, ver) {
  el.innerHTML = `<section class="card tn"><h3>The recorded runs: nine requests</h3>
    <p class="check ${ver.verifiedCount === ver.total ? 'ok' : 'bad'}">${ver.verifiedCount === ver.total ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} facts about the two Atlantic transactions match the chain just now:</b> ${ver.checks.map((c) => `${esc(c.what)} ${c.ok ? '✓' : '✗'}`).join(' · ')}.</p>
    ${table(['Request', 'Outcome', 'After signing'], rec.cases.map((c) => [`<b>${esc(c.title)}</b><br><small>${esc(c.question)}</small>`, `${pill(c.run.verdict.status, TONE[c.run.verdict.status] ?? 'warn')}<br><small>${esc(c.run.verdict.headline)}</small>`, c.afterSigning ? `${pill(c.afterSigning.status, TONE[c.afterSigning.status])}<br><small>${c.afterSigning.verification.length} checks, gas ${esc(c.afterSigning.gasUsed)}, block ${Number(c.afterSigning.block).toLocaleString('en-US')}</small>` : '—']))}
    ${rec.cases.map((c) => `<details><summary>${esc(c.title)}</summary>${renderRun(c.run).replace(/<form data-signed[\s\S]*?<\/form><div data-outcome><\/div>/, '')}${c.afterSigning ? `<h4 class="list-h">After the user signed: checked against the plan</h4>${table(['Check', 'Expected', 'Got', ''], c.afterSigning.verification.map((x) => [esc(x.what), esc(x.expected), esc(x.actual), x.ok ? pill('✓', 'ok') : pill('✗', 'bad')]))}` : ''}</details>`).join('')}
    <p class="muted">${esc(rec.network)}</p></section>`;
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"><section class="card tn"><div class="idle">Loading the recorded runs…</div></section></div>';
  api('run', { slug: ctx.slug, recorded: 1 }).then(({ data }) => {
    mountTry(root.querySelector('[data-slot=try]'), ctx.slug, data.run.cases);
    mountRun(root.querySelector('[data-slot=run]'), data.run, data.verification);
  }).catch((err) => { root.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
  return () => { root.replaceChildren(); };
}
