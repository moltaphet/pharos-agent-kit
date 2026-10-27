// Task 27: paste a failed transaction hash, get the reason in plain words and what to do.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const num = (n) => Number(n).toLocaleString('en-US');
const TONE = { succeeded: 'ok', pending: 'warn', 'not-found': 'warn' };

export const content = {
  tagline: 'Paste the hash of a failed transaction and get why it failed, in plain words, and what you can do about it.',
  tools: ['chain'],
  story: [
    'A wallet says “transaction failed” and nothing else. The agent takes the hash, fetches the transaction and its receipt through Chain MCP, and finds out why: it replays the exact call on the state just before its block, so the contract answers in its own words (a message, a built-in panic, a custom error, or silence), and it checks the numbers behind the usual causes.',
    'It tells you in a few sentences what went wrong, without jargon, and what to do: raise the gas limit, approve the contract first, use a different account, wait until the contract is unpaused, and so on. When the replay works on the earlier state it says so: something changed in the same block before the transaction, as happens with swaps.',
    'The recorded cases are thirteen real failures of eleven kinds: four on Pharos mainnet that happened without us, and nine we made fail on purpose on Atlantic testnet so that every kind of cause could be shown on the same chain.',
  ],
  how: [
    { server: 'chain', tool: 'get_transaction / get_transaction_receipt', text: 'The transaction (sender, target, data, value, gas limit) and the receipt (status, gas used).' },
    { server: 'chain', tool: 'eth_call at the previous block', text: 'The same call replayed on the state before the block, which gives the contract’s revert data.' },
    { server: 'local', tool: 'decode', text: 'Error(string), Panic(code), well-known custom errors (token, ownership, pause, router errors), and short codes such as Uniswap V3’s SPL.' },
    { server: 'chain', tool: 'balanceOf / allowance / get_balance / get_code', text: 'The account’s token balance and allowance on the block before, the native balance, and whether the target has a function with the selector that was called.' },
    { server: 'local', tool: 'explain', text: 'A plain-language cause and a fix for each kind: out of gas, not enough tokens, no approval, not authorised, paused, slippage, deadline, wrong function, PROS sent to a non-payable function, a contract bug, and a state change in the same block.' },
  ],
  decisions: [
    { title: 'Ask the contract, do not guess from the text alone', text: 'The replay gives the real revert data. The message is matched against known causes only after that, and token numbers (balance, allowance) are read to decide between two causes that read alike.' },
    { title: 'Out of gas is recognised by its shape', text: 'A failed transaction that used 98% or more of its gas limit and whose replay gives no reason ran out of gas. The report says how much it used.' },
    { title: '“It works now” is a real answer', text: 'If the replay on the previous block succeeds, the failure came from something earlier in the same block. The agent says that instead of inventing a cause.' },
    { title: 'Honest about what it cannot name', text: 'A custom error it does not know is reported with its code and a pointer to the contract’s ABI. Three of the four mainnet cases are like that or close to it, and are shown as such.' },
    { title: 'Reads only', text: 'The agent never sends anything. On mainnet it uses Chain MCP; Atlantic testnet is not served by Chain MCP, so it uses the RPC there.' },
  ],
  evidence: [
    'The agent takes a transaction hash and fetches the transaction and receipt through Chain MCP (the Try tab and the CLI do this on mainnet; the first step of every diagnosis lists the call).',
    'It identifies the cause from the contract’s own revert data and the numbers behind it: revert message, custom error, panic, out of gas, token balance, allowance, authorisation, paused contract, slippage, native value sent to a non-payable function, and a missing function.',
    'Each diagnosis is a short headline, a plain paragraph with the numbers (for example how much the spender was approved for and how much it needed), and a list of fixes.',
    'Thirteen real failed transactions across eleven kinds are recorded, four on mainnet and nine made on purpose on Atlantic; their failed status is re-read from the chain when this page loads.',
  ],
  files: ['agents/dapp-support-agent/pharos-support.js', 'lib/support.js', 'lib/tasks/dapp-support-agent.js', 'contracts/FailLab.sol', 'config/support-demo.json', 'scripts/support-run.mjs', 'reports/support-run.json'],
  run: {
    commands: [
      'node scripts/support-run.mjs   # diagnoses four real mainnet failures; makes nine fail on Atlantic (once) and diagnoses them; writes reports/support-run.json',
      'node agents/dapp-support-agent/pharos-support.js 0xf7fc5fcc273c9dd0fdbbb3e15ba90d4f902409f50ac5f812fffa108b73d797b1',
      'node agents/dapp-support-agent/pharos-support.js 0x393c87d70c904916c74c780b3498a492a2b636cc1f912b69594b281ff9f301c9 --chain atlantic',
    ],
    sampleLabel: 'Output of node scripts/support-run.mjs:',
    sample: `mainnet-slippage         slippage                   The price moved too much
mainnet-allowance        insufficient-allowance     The contract was not approved to spend enough
mainnet-state            state-changed              It would work now: something changed just before it was mined
not-authorized           not-authorized             This account is not allowed to do that
insufficient-balance     insufficient-token-balance Not enough tokens
paused                   paused-or-blocked          The contract is paused or the account is blocked
out-of-gas               out-of-gas                 It ran out of gas
panic                    panic                      The contract hit a bug-like error
wrong-function           wrong-function             The contract has no such function
wrote reports/support-run.json: 13 failures, 11 different categories`,
  },
  verify: [
    { title: 'Open a failed transaction', text: 'Each recorded case links to the explorer, which shows the failed status the agent started from.' },
    { title: 'Diagnose your own', text: 'The Try tab takes any hash on mainnet or Atlantic.' },
    { title: 'Run it', text: 'The CLI prints the explanation and every step it took.', code: 'node agents/dapp-support-agent/pharos-support.js 0xf7fc5fcc273c9dd0fdbbb3e15ba90d4f902409f50ac5f812fffa108b73d797b1' },
    { title: 'Read the tests', text: 'Each cause is tested against a fake chain, including the numbers that tell balance and allowance failures apart.', link: [`${REPO}/blob/main/test/support.test.js`, 'test/support.test.js'] },
  ],
};

function renderDiagnosis(d) {
  const ev = d.evidence ?? {};
  const rows = [];
  if (ev.balance) rows.push(['Token balance before the failure', esc(ev.balance.formatted), ev.balance.neededFormatted ? `needed ${esc(ev.balance.neededFormatted)}` : '']);
  if (ev.allowance) rows.push(['Allowance given to the spender', esc(ev.allowance.formatted), `needed ${esc(ev.allowance.neededFormatted)}`]);
  if (ev.gas) rows.push(['Gas used / limit', `${num(ev.gas.used)} / ${num(ev.gas.limit)}`, `${ev.gas.percent}%`]);
  return `<div class="check ${TONE[d.status] ?? (d.status === 'failed' ? 'bad' : 'warn')}"><b>${esc(d.headline)}</b> ${d.category ? pill(d.category, 'warn') : ''}<br>${esc(d.plain)}</div>
    ${d.fix?.length ? `<h4 class="list-h">What you can do</h4><ul>${d.fix.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${d.reason ? `<p class="muted">The contract’s own words: <code>${esc(d.reason)}</code></p>` : ''}
    ${rows.length ? table(['Number', 'Value', ''], rows) : ''}
    <h4 class="list-h">What I checked</h4>${table(['Through', 'What', 'Result'], (d.steps ?? []).map((s) => [esc(s.tool), esc(s.what), esc(s.result)]))}
    <p class="muted"><a href="${esc(d.links.explorer)}" target="_blank" rel="noopener">The transaction on the explorer</a></p>`;
}

function mountTry(el, slug, examples) {
  el.innerHTML = `<section class="card tn"><h3>Why did my transaction fail?</h3>
    <p class="muted">Paste a transaction hash, or pick a real failure. Reads only.</p>
    <form data-form><div class="row"><label>Network<select name="chain"><option value="mainnet">Pharos mainnet</option><option value="atlantic">Atlantic testnet</option></select></label>
    <label style="flex:1">Transaction hash<input name="hash" style="width:100%" placeholder="0x…"></label><button type="submit" class="chip">Explain</button></div></form>
    <div class="chips" data-ex>${examples.map((c) => `<button type="button" class="chip" data-chain="${esc(c.chain)}" data-hash="${esc(c.hash)}">${esc(c.title.length > 46 ? c.title.slice(0, 44) + '…' : c.title)}</button>`).join('')}</div>
    <div data-out><div class="idle">Press Explain.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  const go = async (chain, hash) => {
    out.innerHTML = '<div class="idle">Reading the chain…</div>';
    try { out.innerHTML = renderDiagnosis((await api('run', { slug, diagnose: 1, chain, hash })).data.diagnosis); } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };
  el.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries()); go(f.chain, f.hash); });
  el.querySelector('[data-ex]').addEventListener('click', (e) => { const b = e.target.closest('[data-hash]'); if (!b) return; el.querySelector('[name=chain]').value = b.dataset.chain; el.querySelector('[name=hash]').value = b.dataset.hash; go(b.dataset.chain, b.dataset.hash); });
}

function mountRun(el, run, ver) {
  const ok = ver.failedCount === ver.total;
  el.innerHTML = `<section class="card tn"><h3>Thirteen real failures, diagnosed</h3>
    <p class="check ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} <b>${ver.failedCount} of ${ver.total} transactions are failed on-chain just now.</b> ${run.summary.categories.length} kinds of cause.</p>
    ${table(['Case', 'Network', 'Diagnosis', 'Kind', 'Transaction'], run.cases.map((c) => [esc(c.title), esc(c.chain), `<b>${esc(c.diagnosis.headline)}</b><br><small>${esc(c.diagnosis.plain.slice(0, 190))}${c.diagnosis.plain.length > 190 ? '…' : ''}</small>`, pill(c.diagnosis.category, 'warn'), `<a href="${esc(c.explorer)}" target="_blank" rel="noopener">${esc(short(c.hash))}</a> ${ver.results[c.id]?.failed ? '' : pill('?', 'bad')}`]))}
    <p class="muted">${esc(run.network)}</p></section>`;
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"><section class="card tn"><div class="idle">Loading the recorded cases…</div></section></div>';
  api('run', { slug: ctx.slug, recorded: 1 }).then(({ data }) => {
    mountTry(root.querySelector('[data-slot=try]'), ctx.slug, data.run.cases);
    mountRun(root.querySelector('[data-slot=run]'), data.run, data.verification);
  }).catch((err) => { root.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
  return () => { root.replaceChildren(); };
}
