// Task 25: a pre-transaction check that says low, medium or high, and why, in plain language.
import { api, esc } from '../util.js';
import { pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

const num = (n) => Number(n).toLocaleString('en-US');
const tone = (level) => (level === 'low' ? 'ok' : level === 'medium' ? 'warn' : 'bad');
const stTone = (s) => (s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'bad' ? 'bad' : 'warn');

export const content = {
  tagline: 'Looks at a wallet’s or contract’s history on Pharos and flags red flags before you interact with it.',
  tools: ['rpc'],
  story: [
    'Paste an address. The checker reads the chain, no one else’s opinion, and runs a set of signals. For a contract: how old its code is, whether it is an upgradeable proxy and who can change it, who owns it and what the owner can do (mint, freeze, change fees, pause, drain), and whether the bytecode contains instructions that can destroy the contract or run outside code as its own. For a wallet: how old its first transaction is, how much history it has, whether it was only just funded, and which unlimited token approvals it still has outstanding.',
    'The answer is a level, low, medium or high, with every flag in plain language: what was found, why it matters and the evidence. A signal that comes out fine is shown too, so you can see what was checked. You can also supply your own list of dangerous addresses, and the checker reports any contact with them.',
    'A check is not a verdict on honesty. USDC comes out medium because its administrator can upgrade it, which is true and worth knowing; a deliberately risky token comes out high; WPROS, which nobody can change, comes out low.',
  ],
  how: [
    { server: 'rpc', tool: 'eth_getCode at past blocks', text: 'A binary search over block history finds the first block where the contract’s code exists: its age. The same search over the transaction count gives a wallet’s first outgoing transaction.' },
    { server: 'rpc', tool: 'eth_getStorageAt', text: 'The EIP-1967 (and the older OpenZeppelin) implementation and admin slots tell a proxy from a plain contract; EIP-1167 clones are recognised from their code.' },
    { server: 'local', tool: 'bytecode scan', text: 'The code is read instruction by instruction (skipping the data of PUSH): SELFDESTRUCT, DELEGATECALL and the function selectors of mint, blacklist, fee, pause, upgrade and drain functions.' },
    { server: 'rpc', tool: 'owner() / paused()', text: 'Who the owner is (an ordinary wallet, a contract, or nobody) and whether the contract is paused.' },
    { server: 'rpc', tool: 'eth_getLogs and allowance()', text: 'Approval events of the wallet over the last 20,000 blocks; each unlimited one is confirmed against the live allowance, and an unlabelled spender is itself checked.' },
  ],
  decisions: [
    { title: 'Source verification cannot be read, so it is not claimed', text: 'The Pharos explorer has no public verification API. The checker does not pretend to know whether source code is verified; it reads the deployed bytecode and chain state, which anyone can repeat.' },
    { title: 'Powers matter more than intentions', text: 'A single key that can mint or freeze is a risk whether or not its holder is honest. The flag says what the key can do, and is lower when an administrator contract (a multisig, a timelock) holds it, and absent when ownership is renounced.' },
    { title: 'Levels from flags, openly', text: 'Each flag is low, medium or high. Any high flag, or enough smaller ones together, makes the result high; any medium makes it medium. The flags are the score.' },
    { title: 'An unlimited approval is judged by who received it', text: 'A wallet with an unlimited approval to a labelled protocol is shown but not alarming. To an unlabelled contract it is a flag, and a high one if that contract itself checks out risky. This is how the fresh-wallet example is caught.' },
    { title: 'Time changes the answer, and the page says so', text: 'The risky token’s “deployed minutes ago” flag will fade with time; its other flags will not. The recorded run keeps the result as seen; the Try tab checks any address now.' },
  ],
  evidence: [
    'Eight signals: contract age, upgradeability, admin powers, dangerous instructions, wallet age and activity, outstanding unlimited approvals, and contact with a flag list. Each check shows which were read.',
    'The result is low, medium or high, with each flag listed with its severity, a title and its evidence. USDC, for example, is medium: “Upgradeable proxy”.',
    'Every flag has a plain-language paragraph saying what was found and why it matters; clean signals say what was checked and found fine.',
    'Five recorded examples: WPROS and an established wallet (both low), USDC (medium), a deliberately risky token and a brand-new wallet with an unlimited approval to it (both high).',
  ],
  files: ['agents/wallet-risk-checker/pharos-risk.js', 'lib/risk.js', 'lib/tasks/wallet-risk-checker.js', 'contracts/RiskyToken.sol', 'config/risk-demo.json', 'scripts/risk-run.mjs', 'reports/risk-run.json'],
  run: {
    commands: [
      'node scripts/risk-run.mjs   # deploys the risky demo token on Atlantic (once), checks five examples, writes reports/risk-run.json',
      'node agents/wallet-risk-checker/pharos-risk.js 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0',
      'node agents/wallet-risk-checker/pharos-risk.js 0x7d7abe8bf2de1191ce659f997869434510a18d32 --chain atlantic',
    ],
    sampleLabel: 'Output of node scripts/risk-run.mjs:',
    sample: `  → low: LOW risk: none of the 4 signals checked raised a flag.
  → low: LOW risk: none of the 3 signals checked raised a flag.
  → medium: MEDIUM risk: Upgradeable proxy.
  → high: HIGH risk: Deployed 6 minutes ago; One key controls the contract; The contract can destroy itself; Runs outside code as its own.
  → high: HIGH risk: Unlimited USDC (demo) approval to 0x7d7a…8d32; New wallet: first activity 6 minutes ago.`,
  },
  verify: [
    { title: 'Check an address yourself', text: 'Use the Try tab: any address on mainnet or Atlantic.' },
    { title: 'Look at the risky token', text: 'Open its address on the Atlantic explorer: owner, mint and the rest are in its code (contracts/RiskyToken.sol).' },
    { title: 'Repeat a signal by hand', text: 'The owner of a contract is one call away.', code: 'cast call 0xc879c018db60520f4355c26ed1a6d572cdac1815 "owner()(address)" --rpc-url https://rpc.pharos.xyz' },
    { title: 'Read the tests', text: 'The bytecode scanner, every flag and the level rules run against a fake chain.', link: [`${REPO}/blob/main/test/risk.test.js`, 'test/risk.test.js'] },
  ],
};

function renderResult(r) {
  return `<p class="check ${tone(r.level)}"><b>${esc(r.level.toUpperCase())} risk</b> · ${esc(r.label ?? r.address)} · ${esc(r.kind)} on ${esc(r.chainName)} · block ${num(r.checkedBlock)}</p>
    <h4 class="list-h">Signals checked</h4>
    ${table(['Signal', 'Result', 'What was found'], r.signals.map((s) => [esc(s.title), pill(s.status === 'ok' ? 'fine' : s.status === 'na' ? 'n/a' : s.status === 'warn' ? 'note' : 'flag', stTone(s.status)), `<small>${esc(s.detail)}</small>`]))}
    <h4 class="list-h">${r.flags.length ? 'Red flags' : 'No red flags'}</h4>
    ${r.flags.map((f) => `<div class="check ${tone(f.severity)}"><b>${esc(f.severity.toUpperCase())}: ${esc(f.title)}</b><br><small>${esc(f.plain)}</small></div>`).join('')}
    <p class="muted"><a href="${esc(r.explorer)}" target="_blank" rel="noopener">${esc(r.address)}</a></p>`;
}

function mountTry(el, slug) {
  el.innerHTML = `<section class="card tn"><h3>Check an address</h3>
    <p class="muted">Reads the chain now (10 to 25 seconds). Optional: addresses you consider dangerous, one per line; the checker reports any contact with them.</p>
    <form data-form>
      <div class="row"><label>Network<select name="chain"><option value="mainnet">Pharos mainnet</option><option value="atlantic">Atlantic testnet</option></select></label>
      <label style="flex:1">Address<input name="address" style="width:100%" placeholder="0x…" value="0x52c48d4213107b20bc583832b0d951fb9ca8f0b0"></label>
      <button type="submit" class="chip">Check</button></div>
      <label>Your flag list<textarea name="flagged" rows="2" style="width:100%"></textarea></label></form>
    <div data-out><div class="idle">Press Check.</div></div></section>`;
  const out = el.querySelector('[data-out]');
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    f.flagged = (f.flagged ?? '').split(/\s+/).filter(Boolean).join(',');
    out.innerHTML = '<div class="idle">Reading the chain…</div>';
    try { out.innerHTML = renderResult((await api('run', { slug, check: 1, ...f })).data.result); } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });
}

function mountRun(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>The recorded examples</h3><div class="idle" data-role="body">Re-reading the setup transactions from Atlantic…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 }).then(({ data }) => {
    const { run, verification: ver } = data;
    body.classList.remove('idle');
    const groups = [['Clean', 'clean'], ['In between', 'middle'], ['Risky', 'risky']];
    body.innerHTML = `<p class="check ${ver.verifiedCount === ver.total ? 'ok' : 'bad'}">${ver.verifiedCount === ver.total ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} setup facts match Atlantic just now</b>: ${ver.txs.map((t) => `<a href="https://atlantic.pharosscan.xyz/tx/${esc(t.hash)}" target="_blank" rel="noopener">${esc(t.label.toLowerCase())}</a> ${t.ok ? '✓' : '✗'}`).join(' · ')} · the risky token has code ${ver.riskyTokenHasCode ? '✓' : '✗'}. Recorded ${esc(run.recordedAt.slice(0, 16).replace('T', ' '))} UTC.</p>
      ${table(['Example', 'Network', 'Level', 'Flags'], run.examples.map((e) => [esc(e.title), esc(e.chain), pill(e.result.level, tone(e.result.level)), `<small>${esc(e.result.flags.map((f) => f.title).join('; ') || 'none')}</small>`]))}
      ${groups.map(([title, key]) => run.examples.filter((e) => e.expect === key).map((e) => `<details><summary><b>${esc(title)}</b>: ${esc(e.title)}</summary>${renderResult(e.result)}</details>`).join('')).join('')}
      <p class="muted">${esc(run.network)}</p>`;
  }).catch((err) => { body.classList.remove('idle'); body.innerHTML = `<p class="error">${esc(err.message)}</p>`; });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="try"></div><div data-slot="run"></div>';
  mountTry(root.querySelector('[data-slot=try]'), ctx.slug);
  mountRun(root.querySelector('[data-slot=run]'), ctx.slug);
  return () => { root.replaceChildren(); };
}
