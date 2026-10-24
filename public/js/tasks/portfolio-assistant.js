// Portfolio Assistant: content, a live panel (ask a question about a wallet), and the recorded demo with Replay.
import { api, esc } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

// Kept identical to skills/pharos-portfolio-assistant/examples/ (a test checks it).
export const WALLETS = [
  { id: 'r25-wallet', label: 'A smart-contract wallet with USDC idle in the wallet and positions in two R25 vaults', wallet: '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f' },
  { id: 'rockaway-wallet', label: 'A wallet with a position in the RockawayX (Morpho) vault and some PROS', wallet: '0x62a0e4b7fd967fab5be1a733c09b22ebc4510673' },
];
export const QUESTIONS = [
  { id: 'total', wallet: 'r25-wallet', question: 'What is my total balance?' },
  { id: 'holdings', wallet: 'r25-wallet', question: 'What do I hold?' },
  { id: 'where-usdc', wallet: 'r25-wallet', question: 'Where is my USDC?' },
  { id: 'biggest', wallet: 'r25-wallet', question: "What's my biggest position?" },
  { id: 'position-quarterly', wallet: 'r25-wallet', question: 'How much do I have in R25 Quarterly?' },
  { id: 'protocols', wallet: 'r25-wallet', question: 'Which protocols am I using?' },
  { id: 'earning', wallet: 'r25-wallet', question: 'What am I earning?' },
  { id: 'token-value', wallet: 'rockaway-wallet', question: 'How much is my PROS worth?' },
  { id: 'rockaway-position', wallet: 'rockaway-wallet', question: 'How much do I have in Rockaway?' },
  { id: 'earned', wallet: 'r25-wallet', question: 'How much have I earned so far?' },
  { id: 'aave', wallet: 'r25-wallet', question: 'How much do I have on Aave?' },
];
const walletOf = (id) => WALLETS.find((w) => w.id === id).wallet;
const short = (a) => (a && a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a ?? '');

export const content = {
  tagline: 'Ask in plain English what a wallet holds, where its USDC is, what it earns. Every number comes with the contract and block it was read from, and it says so when it does not know.',
  tools: ['chain', 'rpc'],
  skill: true,
  story: [
    'A wallet’s money on Pharos is spread over native PROS, tokens, and vault shares from different protocols. Finding out “where is my USDC?” means reading several contracts, turning vault shares into dollars, and pricing everything. The Portfolio Assistant does that and answers in a sentence.',
    'It reads the wallet in two batches at one pinned block through Chain MCP (native PROS, USDC and WPROS balances, shares in the four vaults of R25 and the RockawayX Morpho vault, and the Chainlink USD feeds), then repeats every batch on the public RPC and compares the raw answers. A figure appears only if they agree. Each figure in an answer points to its source: the contract, the call, the block, and whether it was confirmed. A question like “what am I earning?” adds three more readings of each vault’s share price, because earnings are what the vault actually paid over the last days.',
    'It refuses what it cannot know. “How much do I have on Aave?” gets “I do not read Aave” and no number. “How much have I earned so far?” gets the reason it cannot be known from a balance, plus what it can say instead. A vault it cannot read is named and left out of the totals, not guessed. The assistant is read-only: it has no key and every call is an eth_call.',
  ],
  how: [
    { server: 'chain', tool: 'get_block_number · get_block', text: 'Pin everything to one block, two behind the head, and take its time as “now” for the age of every price.' },
    { server: 'chain', tool: 'Multicall3 eth_call: balances, shares, prices', text: 'One batched read: native PROS, USDC and WPROS balances, shares and decimals in each vault, and the USDC/USD and PROS/USD feeds with their timestamps.' },
    { server: 'rpc', tool: 'the same batch on the public RPC', text: 'The raw answers are compared. A disagreement is settled by reading again; a disagreement that cannot be settled stops the run. If the RPC cannot answer, the figures stand but are marked unconfirmed.' },
    { server: 'chain', tool: 'Multicall3 eth_call: what the shares are worth', text: 'convertToAssets for each position held, previewRedeem and maxRedeem, so a position that cannot be redeemed is flagged.' },
    { server: 'local', tool: 'classify the question', text: 'One of eight types, recognised by its words (no model): total, holdings, where is a token, what is a token worth, biggest position, position in a named vault, protocols used, earning. Anything else is refused with the list of what it can answer.' },
    { server: 'local', tool: 'answer with sources', text: 'The sentence, then each figure with the numbered source it came from: contract, call, block, tool, confirmation. Caveats are added where they matter (old prices, restricted vaults, unreadable protocols).' },
  ],
  decisions: [
    { title: 'Every figure has an address', text: 'A number without a source is a claim. Each figure carries the contract it was read from, the exact call, the pinned block and whether the public RPC agreed, and the page links the contract on the explorer.' },
    { title: 'Reads are confirmed, because Chain MCP once answered wrongly', text: 'While building the docs agent, one backend of the hosted Chain MCP answered a block-pinned call with the wrong state (81,587 instead of 80,683). Here every batch is repeated on the public RPC: if they differ, Chain MCP is asked again and the two that agree win; if nothing settles it the run stops and reports no figure.' },
    { title: 'Totals refuse to have holes', text: 'If a price feed could not be read, one holding has no dollar value, and the assistant will not state a total that silently leaves it out. It says how many holdings it could add up and why the total is withheld.' },
    { title: 'Earnings are measured, not assumed', text: 'What a vault earns is read from its own share price at three blocks over about four days (net of its fees, which are inside the price), per vault, with the two halves of the window compared. It is shown as what the vault paid, never as a promise. Idle USDC in the wallet is said to earn nothing.' },
    { title: 'Some questions have no answer on chain', text: '“What have I earned so far?” needs what you paid for each position. A balance does not contain it, and the assistant does not read deposit history, so it says exactly that and does not substitute a number.' },
    { title: 'A position you cannot get out of is not the same as one you can', text: 'Two of the R25 vaults will not preview a redemption at all, and for the quarterly one this wallet can redeem only part of its shares. The assistant counts them in your portfolio and says that not all of it can be taken out at will.' },
    { title: 'Only what was verified', text: 'It reads native PROS, USDC, WPROS and four vaults whose code and interface were checked on chain. Anything else is “not read”. Adding a protocol means adding a reader and a test, not widening a guess.' },
    { title: 'Refusals read nothing', text: 'A question about Aave or about what you earned since depositing is answered without a single call to the chain, so a refusal is instant and cannot be wrong about the chain.' },
  ],
  evidence: [
    'It reads positions from two protocols (R25 and the RockawayX Morpho vault, four vaults in all) plus the wallet’s PROS, USDC and WPROS balances, in two Multicall3 batches at one pinned block, each confirmed on the public RPC.',
    'It answers eight question types: total balance, what you hold, where a token is, what a token is worth, the biggest position, a named vault, which protocols you use, and what you are earning. Each is covered by tests, and eleven recorded real questions are shown.',
    'Every figure shows its source: the contract, the call, the block and whether the public RPC confirmed it; the contract links to the explorer.',
    'It says so when it does not know: another protocol is refused by name, “what have I earned” is explained as unknowable from a balance, a vault it cannot read is named and left out, and a missing price withholds the total.',
    'It is read-only: it holds no key, every call is an eth_call, and a test checks the only tools it ever asks of the chain are reads.',
  ],
  files: ['lib/portfolio.js', 'lib/yields.js', 'lib/onchain.js', 'lib/defi.js', 'lib/tasks/portfolio-assistant.js', 'scripts/portfolio-demo.mjs', 'reports/portfolio-demo.json', 'skills/pharos-portfolio-assistant/SKILL.md', 'skills/pharos-portfolio-assistant/references/portfolio-assistant.md', 'skills/pharos-portfolio-assistant/scripts/ask.mjs', 'skills/pharos-portfolio-assistant/examples/wallets.json', 'skills/pharos-portfolio-assistant/examples/questions.json'],
  run: {
    commands: ['node skills/pharos-portfolio-assistant/scripts/ask.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --question "Where is my USDC?"', '… --question "What am I earning?"', '… --question "How much do I have on Aave?"   # refused: it does not read Aave', '… --block 21115337   # repeat a recorded answer exactly'],
    sample: `Where is my USDC?
wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f · block 21,115,337

Your USDC is in 3 places: 942,942.429833 USDC in the wallet; 1,736,877.466879 USDC in R25 VRPC Weekly; 2,402,278.047197 USDC in R25 VRPC Quarterly.

Figures
  USD Coin in the wallet: 942,942.429833 USDC   [source 1]
  R25 VRPC Weekly (R25): 1,736,877.466879 USDC   [source 2]
  R25 VRPC Quarterly (R25): 2,402,278.047197 USDC   [source 3]

Sources
  [1] 0xc879c018…  balanceOf(address)  block 21,115,337  (Chain MCP eth_call via Multicall3; confirmed on the public RPC)
  [2] 0x1c2bc8b5…  convertToAssets(uint256): what these shares are worth  block 21,115,337  (… confirmed …)
  [3] 0x94f7ebc6…  convertToAssets(uint256): what these shares are worth  block 21,115,337  (… confirmed …)

Note: Not all of this can be taken out at will: R25 VRPC Quarterly (the vault will not preview a redemption, so exits may be restricted).`,
  },
  verify: [
    { title: 'Check a balance yourself', text: 'USDC in the demo wallet at the recorded block, straight from the public RPC. It should read 942942429833 (942,942.429833 USDC).', code: 'cast call 0xc879c018db60520f4355c26ed1a6d572cdac1815 "balanceOf(address)(uint256)" 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --block 21115337 --rpc-url https://rpc.pharos.xyz' },
    { title: 'Check what the vault shares are worth', text: 'The weekly vault’s own conversion of the wallet’s shares into USDC.', code: 'cast call 0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268 "convertToAssets(uint256)(uint256)" $(cast call 0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268 "balanceOf(address)(uint256)" 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --block 21115337 --rpc-url https://rpc.pharos.xyz | cut -d" " -f1) --block 21115337 --rpc-url https://rpc.pharos.xyz' },
    { title: 'Replay a recorded question', text: 'In the recorded card press Replay: the same question is asked again at the recorded block and every figure and position is compared with the recording.' },
    { title: 'Run it from the command line', text: 'Needs only Node.js 20+.', code: 'node skills/pharos-portfolio-assistant/scripts/ask.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --question "What is my total balance?"' },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference, the script and the examples are in the repository.', link: [`${REPO}/tree/main/skills/pharos-portfolio-assistant`, 'skills/pharos-portfolio-assistant'] },
  ],
};

// ---- the live panel ----------------------------------------------------------------------------------------------------------------
const ACTOR = { agent: 'Agent', 'chain-mcp': 'Chain MCP', 'public-rpc': 'Public RPC' };
const stepRow = (s) => [s.n, `<span class="tpill ${{ agent: '', 'chain-mcp': 'ok', 'public-rpc': 'warn' }[s.actor]}">${ACTOR[s.actor]}</span>`,
  s.actor === 'agent' ? `<b><code>${esc(s.name)}</code></b><br><small>${esc(s.summary)}</small>` : `<b><code>${esc(s.name)}</code></b> <small class="muted">${s.ms} ms</small><br><code class="tiny">${esc(s.input)}</code><br><small class="muted">→</small> <code class="tiny">${esc(s.error ? `ERROR ${s.error}` : s.output)}</code>`];
const confirmation = { confirmed: pill('confirmed on the public RPC', 'ok'), resolved: pill('confirmed after a second read', 'ok'), inconclusive: pill('not confirmed', 'warn') };

export function render(r) {
  const a = r.answer;
  const tone = a.known ? 'ok' : 'warn';
  const posRows = r.positions.map((p) => [`<b>${esc(p.label)}</b>${p.protocol ? `<br><small class="muted">${esc(p.protocol)}</small>` : ''}`, esc(p.units) + (p.sharesText ? `<br><small class="muted">${esc(p.sharesText)} shares</small>` : ''), esc(p.usdText ?? '–'), p.liquidity && p.liquidity !== 'instant' ? pill(p.liquidity === 'partial' ? 'partly redeemable' : 'redemption not previewable', 'warn') : p.kind === 'vault' ? pill('redeemable', 'ok') : '']);
  return `
    <div class="verdict ${tone}">${esc(a.text)}<small>${r.block ? `block ${r.block.number.toLocaleString('en-US')} · ${esc(r.block.iso)} · read-only` : 'answered without reading the chain · read-only'}</small></div>
    ${a.figures.length ? `<h4 class="list-h">The figures, with their sources</h4>${table(['Figure', 'Value', 'Source'], a.figures.map((f) => [esc(f.label), `<b>${esc(f.value)}</b>`, f.sources.map((n) => `<a href="#src-${n}" class="src-ref">[${n}]</a>`).join(' ')]))}` : ''}
    ${a.sources.length ? `<h4 class="list-h">Sources</h4>${table(['#', 'Contract', 'Call', 'Block', 'How it was read'], a.sources.map((s) => [`<span id="src-${s.n}">${s.n}</span>`, s.explorer ? `<a href="${esc(s.explorer)}" target="_blank" rel="noopener"><code>${esc(short(s.contract))}</code></a>` : '<code>Multicall3 (native balance)</code>', `<small>${esc(s.call)}</small>`, s.block.toLocaleString('en-US'), `${esc(s.tool)}<br>${confirmation[s.integrity]}`]))}` : ''}
    ${a.caveats.map((c) => `<p class="check warn">${esc(c)}</p>`).join('')}
    ${r.positions.length ? `<h4 class="list-h">Everything it read in this wallet</h4>${table(['Holding', 'Amount', 'Value', ''], posRows)}${r.totalUsdText ? `<p class="muted">Total ${esc(r.totalUsdText)}</p>` : ''}` : ''}
    ${r.steps.length ? `<h4 class="list-h">Who called what, in order</h4>${table(['#', 'Who', 'What'], r.steps.map(stepRow))}<p class="muted">${r.chainCalls} Chain MCP calls and ${r.rpcCalls} public RPC calls (every batch is repeated there). Read-only: only eth_call reads, no key, nothing sent.</p>` : ''}`;
}

const livePanel = makePanel({
  intro: 'Pick a wallet, ask a question. Everything is read from Pharos mainnet at one block, confirmed on a second source, and shown with where it came from. Nothing is sent.',
  fields: [
    { name: 'wallet', label: 'Wallet address', type: 'text', value: WALLETS[0].wallet, grow: true, wide: true },
    { name: 'question', label: 'Question', type: 'text', value: 'Where is my USDC?', grow: true, wide: true, hint: 'Try: total balance · what do I hold · where is my USDC · biggest position · how much in R25 Quarterly · which protocols · what am I earning' },
    { name: 'block', label: 'Pin to block', type: 'number', optional: true, min: 1, step: 1, value: '', hint: 'Empty = two blocks behind the latest.' },
  ],
  button: 'Ask',
  examples: QUESTIONS.map((q) => ({ label: `${q.question}${q.wallet === 'rockaway-wallet' ? ' (other wallet)' : ''}`, values: { wallet: walletOf(q.wallet), question: q.question, block: '' } })),
  title: (v) => `Ask: ${v.question.slice(0, 60)}`,
  call: (v) => ({ params: { wallet: v.wallet, question: v.question, ...(v.block !== '' && { block: v.block }) } }),
  decode: ({ portfolio: r }) => [
    ...r.steps.map((s) => ({ kind: s.actor === 'agent' ? 'decision' : 'decode', title: `${s.n}. ${ACTOR[s.actor]}: ${s.name}`, detail: s.actor === 'agent' ? s.summary : `${s.input} → ${(s.output ?? s.error ?? '').slice(0, 120)}` })),
    { kind: 'decision', title: r.answer.text.slice(0, 120), detail: r.answer.text },
  ],
  summary: ({ portfolio: r }) => `${r.answer.intent.replace('_', ' ')} · ${r.answer.figures.length} figures · ${r.chainCalls} Chain MCP + ${r.rpcCalls} RPC calls`,
  render: ({ portfolio: r }) => render(r),
});

// ---- the recorded demo with Replay ---------------------------------------------------------------------------------------------------------
function mountDemo(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Recorded demo: eleven real questions about two real wallets</h3><div class="idle" data-role="body">Loading the recording…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { demo } = data;
      body.classList.remove('idle');
      const rows = demo.cases.map((c) => [`<b>${esc(c.question)}</b><br><small class="muted">${esc(c.walletId)} · <code class="tiny">${esc(short(c.wallet))}</code></small>`, `${pill(c.result.answer.intent.replace('_', ' '), c.result.answer.known ? 'ok' : 'warn')}`, `<small>${esc(c.result.answer.text.length > 170 ? c.result.answer.text.slice(0, 168) + '…' : c.result.answer.text)}</small>`, c.result.answer.figures.length ? `<button type="button" class="btn small" data-replay="${esc(c.id)}">Replay</button><div data-out="${esc(c.id)}"></div>` : '<small class="muted">nothing to replay: it read nothing</small>']);
      body.innerHTML = `<p class="muted">Recorded ${esc(demo.recordedAt.slice(0, 10))}, all at block ${demo.cases[0].block.toLocaleString('en-US')}. Replay asks again at that block and compares every figure and position with the recording. The two refusals (“earned”, “Aave”) read nothing.</p>${table(['Question', 'Type', 'Answer', ''], rows)}`;
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-replay]');
        if (!b) return;
        const out = body.querySelector(`[data-out="${b.dataset.replay}"]`);
        b.disabled = true;
        out.innerHTML = '<small class="muted">Replaying…</small>';
        try {
          let res;
          for (let attempt = 1; ; attempt++) {
            try { res = await api('run', { slug, replay: b.dataset.replay }); break; } catch (err) { if (attempt >= 2 || !(err.status >= 500)) throw err; }
          }
          const c = res.data.comparison;
          const same = c.sameText && c.figures.identical === c.figures.compared && c.positions.identical === c.positions.compared;
          out.innerHTML = `<p class="check ${same ? 'ok' : 'bad'}">${same ? '✓' : '✗'} <b>Same answer: ${c.figures.identical} of ${c.figures.compared} figures and ${c.positions.identical} of ${c.positions.compared} positions identical</b> to the recording${c.sameText ? '' : '; the wording differs'}.</p>`;
        } catch (err) {
          out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
        } finally {
          b.disabled = false;
        }
      });
    })
    .catch((err) => {
      body.classList.remove('idle');
      body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="demo"></div><div data-slot="live"></div>';
  mountDemo(root.querySelector('[data-slot=demo]'), ctx.slug);
  return livePanel(root.querySelector('[data-slot=live]'), ctx);
}
