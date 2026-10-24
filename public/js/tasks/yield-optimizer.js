// Yield Optimizer: content, a live panel (compare vaults for a wallet, get a decision), the fork evidence, and the recorded demo with Replay.
import { api, esc } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

// Kept identical to skills/pharos-yield-optimizer/examples/cases.json (a test checks it).
export const CASES = [
  { id: 'idle-to-best', label: '942,942 USDC sitting idle in the wallet: is there somewhere better?', wallet: '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f', from: 'idle', amount: null },
  { id: 'weekly-stay', label: 'Money in the weekly vault: would any other vault be worth moving to?', wallet: '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f', from: 'r25-weekly', amount: null },
  { id: 'quarterly-stuck', label: 'Money in the quarterly vault (the best rate): can it even be taken out?', wallet: '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f', from: 'r25-quarterly', amount: null },
  { id: 'part-of-idle', label: 'Only 10,000 USDC of the idle money', wallet: '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f', from: 'idle', amount: '10000' },
  { id: 'rockaway-holder', label: 'A different wallet, with its money in the RockawayX vault', wallet: '0x62a0e4b7fd967fab5be1a733c09b22ebc4510673', from: 'auto', amount: null },
];
const pct = (x, d = 2) => (x == null ? '?' : `${(x * 100).toFixed(d)}%`);
const usd = (x) => (x == null ? '–' : Math.abs(x) < 0.01 && x !== 0 ? `$${x.toFixed(4)}` : `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const short = (a) => (a && a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a ?? '');

export const content = {
  tagline: 'Compare the USDC vaults on Pharos with live data, count gas, fees and whether you can even get in and out, and say “move” or “stay put”.',
  tools: ['chain', 'rpc'],
  skill: true,
  story: [
    'The highest rate is not the best place for your money. On Pharos mainnet the R25 quarterly vault pays about 15% a year and the weekly one about 6%, but this wallet cannot deposit into the quarterly vault at all, and cannot redeem from it. The Yield Optimizer finds that out before recommending anything.',
    'For one amount of USDC (idle in the wallet, or in a vault) it measures what each of the four vaults actually paid, from their share price at three blocks over about four days, and checks the two halves of that window agree. It then asks each vault whether this wallet can get in (the deposit is simulated as the wallet, as if it had approved the vault, on the public RPC) and whether the source can be redeemed (simulated too), and what each step skims. Gas is not guessed: it comes from really doing the steps on a fork of mainnet, at the live gas price.',
    'The answer is one of two things. MOVE: the amount, where from and to, the expected net gain over the holding period you choose, how it splits into extra yield, gas and fees, how many days it takes to break even, and the unsigned transactions to sign. Or STAY PUT with the reason, vault by vault. The agent holds no key and sends nothing.',
  ],
  how: [
    { server: 'chain', tool: 'Multicall3 eth_call at three blocks', text: 'The value of a million shares of each vault at the start, middle and end of a four-day window: the rate each paid, and whether it paid evenly. Every batch is repeated on the public RPC and compared.' },
    { server: 'chain', tool: 'balances, convertToAssets, previewRedeem', text: 'What the wallet holds and which bucket of USDC to move (idle, or in a vault), and whether the vault will preview a redemption at all.' },
    { server: 'rpc', tool: 'simulate the deposit as the wallet, as if approved', text: 'The public RPC runs the deposit from the wallet with a pretend USDC allowance. If the vault still refuses, that is a refusal of the wallet or the amount, not of the allowance. Chain MCP’s plain simulation is the cross-check.' },
    { server: 'chain', tool: 'simulate the redeem, previewDeposit, get_gas_price', text: 'Can the source be redeemed by this wallet, what each step skims (entry and exit fees from the previews), and the live gas price.' },
    { server: 'local', tool: 'net gain', text: 'Extra yield over your holding period, minus gas (measured units × live price × PROS/USD) and fees. A candidate needs a steady rate, a working entry and exit, a redeemable target and a gain above your minimum.' },
    { server: 'local', tool: 'decide and prepare', text: 'The best viable vault, or STAY PUT with a reason per vault. A MOVE comes with redeem, approve and deposit calldata, unsigned, with a 30% gas headroom.' },
  ],
  decisions: [
    { title: 'Rates are what the vault paid, not what it promises', text: 'A vault’s APY here is the growth of its share price over about four days, annualised, with the two halves compared. A vault that paid most of it in one half is flagged uneven and not chosen. It is net of the vault’s own fees, which are inside the price.' },
    { title: 'The best rate is often one you cannot use', text: 'The quarterly and semi-yearly R25 vaults pay the most. The quarterly one refuses this wallet’s deposit with a custom error that carries the wallet’s address and refuses its redemption too; the semi-yearly one caps a deposit at about 8 USDC. The optimizer reports each refusal and what the error carries, and never recommends them.' },
    { title: 'Gas comes from doing it, not from guessing', text: 'scripts/yield-fork-run.mjs impersonates a real vault holder on a local fork of mainnet and performs approve, deposit and redeem against every vault: 171,204 gas to deposit into the weekly vault, 301,187 into Rockaway’s, 184,003 and 273,262 to redeem. The optimizer uses only gas figures from steps that succeeded there; with no measured gas for a vault the move cannot be priced and is not recommended.' },
    { title: 'Eligibility is tested as if the wallet had approved', text: 'A deposit simulated as things stand fails on the USDC allowance for every vault, including the open ones, and Rockaway’s vault reports that as a custom error. So each deposit is run on the public RPC with a pretend allowance (found by overriding the USDC contract’s storage, and read back to prove it works on every run). What remains is the vault’s own decision.' },
    { title: 'maxDeposit() of zero is not a cap', text: 'Morpho Vault V2 returns 0 from maxDeposit() and still accepted a 1,000 USDC deposit on the fork. Only a positive limit below the amount counts as a cap.' },
    { title: 'The holding period is the question', text: 'You choose how long you will stay (default 30 days, 1 to 365). The net gain is for that long, and a move that does not clear your minimum, or does not pay for itself, is “stay put”. The break-even is in days.' },
    { title: 'Unsigned, always', text: 'A MOVE ends in transactions for you to sign in order, from your wallet. The agent has no key and no way to send. It tells you to run it again just before signing, because the share price moves.' },
    { title: 'Honest about what it cannot see', text: 'It does not know why a vault refuses (the errors are custom, not named), whether a rate will hold, or about vaults outside its four. It says each of these where it matters.' },
  ],
  evidence: [
    'It compares five yield sources from live on-chain data: the four vaults (R25 weekly, quarterly, semi-yearly and the RockawayX Morpho vault) and USDC left idle in the wallet, each rate measured from the vault’s share price at three blocks, confirmed on the public RPC.',
    'It accounts for gas (units measured by really executing the steps on a mainnet fork, priced at the live gas price and PROS/USD), entry and exit fees (from previewDeposit and previewRedeem against the share price), and a minimum holding period you set, over which the net gain is worked out.',
    'The output is a clear MOVE with the expected net gain split into extra yield, gas and fees and a break-even in days, or STAY PUT with the reason for every vault; a fork run of a real wallet checks the previews against what the vaults really paid.',
    'A MOVE prepares unsigned transactions (redeem, approve, deposit) for the user to sign; the agent holds no key, sends nothing, and a test checks that only reads are asked of the chain.',
  ],
  files: ['lib/yield-optimizer.js', 'lib/yields.js', 'lib/onchain.js', 'lib/portfolio.js', 'lib/defi.js', 'lib/tasks/yield-optimizer.js', 'scripts/yield-fork-run.mjs', 'scripts/yield-demo.mjs', 'reports/yield-fork-run.json', 'reports/yield-demo.json', 'skills/pharos-yield-optimizer/SKILL.md', 'skills/pharos-yield-optimizer/references/yield-optimizer.md', 'skills/pharos-yield-optimizer/scripts/optimize.mjs', 'skills/pharos-yield-optimizer/examples/cases.json'],
  run: {
    commands: ['node skills/pharos-yield-optimizer/scripts/optimize.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --from idle', '… --from r25-weekly --min-hold-days 90 --min-net-gain 100', '… --from idle --amount 10000   # move only part of it', 'node scripts/yield-fork-run.mjs   # re-measure the gas by really doing it on a fork (needs Foundry)'],
    sample: `from: USDC idle in the wallet, 942,942.429833 USDC, earning 0.00% a year

✓ R25 VRPC Weekly
    pays 5.82% a year · let in: yes · can be redeemed: yes · gas $0.0015 · fees – · net over 30 days $4,395.72
✗ R25 VRPC Quarterly
    pays 15.23% a year · let in: NO · can be redeemed: NO
    - the vault refuses this wallet even with the approval in place: custom error 0xe19a2672 (it carries this wallet’s address, which suggests an access check; the vault does not say which)
✗ R25 VRPC Semi-yearly
    - the vault caps this wallet's deposit at 8.203251 USDC, below the 942,942.429833 USDC to move
✓ RockawayX USDC (Morpho Vault V2)
    pays 4.22% a year · let in: yes · can be redeemed: yes · net over 30 days $3,208.43

MOVE 942,942.429833 USDC from USDC idle in the wallet to R25 VRPC Weekly
  … the expected net gain is $4,395.72: $4,395.72 extra yield, minus $0.0015 of gas, with no fee worth counting on entry or exit (under $0.0001: previewDeposit and previewRedeem match the share price) … It pays for itself after under a day.

Transactions to sign, in order (UNSIGNED; nothing was sent):
  1. Let R25 VRPC Weekly take 942,942.429833 USDC       gas limit 72,069
  2. Deposit into R25 VRPC Weekly                       gas limit 222,566`,
  },
  verify: [
    { title: 'Check a rate yourself', text: 'The weekly vault’s share price at two blocks four days apart, from the public RPC. The ratio is the growth the optimizer annualised.', code: 'cast call 0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268 "convertToAssets(uint256)(uint256)" 1000000000000 --block 21114435 --rpc-url https://rpc.pharos.xyz\ncast call 0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268 "convertToAssets(uint256)(uint256)" 1000000000000 --block 20714435 --rpc-url https://rpc.pharos.xyz' },
    { title: 'See a vault refuse the wallet', text: 'The quarterly vault’s own answer to a deposit from the demo wallet (with the allowance in place it still reverts with 0xe19a2672 followed by the wallet’s address).', code: 'cast call 0x94f7ebc6ae0819a4b4e231ae6ddaaf9bfd2a1a86 "deposit(uint256,address)(uint256)" 1000000 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --rpc-url https://rpc.pharos.xyz' },
    { title: 'Read the fork evidence', text: 'The fork card above lists what really happened when approve, deposit and redeem were executed against each vault: gas used, shares received against previewDeposit, USDC received against previewRedeem.' },
    { title: 'Replay a recorded case', text: 'In the recorded demo card press Replay: the decision is worked out again at the recorded block and compared with the recording.' },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference, the script and the example cases are in the repository.', link: [`${REPO}/tree/main/skills/pharos-yield-optimizer`, 'skills/pharos-yield-optimizer'] },
  ],
};

// ---- the live panel ---------------------------------------------------------------------------------------------------------------------
const ACTOR = { agent: 'Agent', 'chain-mcp': 'Chain MCP', 'public-rpc': 'Public RPC' };
const stepRow = (s) => [s.n, `<span class="tpill ${{ agent: '', 'chain-mcp': 'ok', 'public-rpc': 'warn' }[s.actor]}">${ACTOR[s.actor]}</span>`,
  s.actor === 'agent' ? `<b><code>${esc(s.name)}</code></b><br><small>${esc(s.summary)}</small>` : `<b><code>${esc(s.name)}</code></b> <small class="muted">${s.ms} ms</small><br><code class="tiny">${esc(s.input)}</code>`];

export function render(r) {
  const rec = r.recommendation;
  const move = rec.action === 'move';
  const rows = r.candidates.map((c) => [`<b>${esc(c.name)}</b>${c.viable ? ` ${pill('viable', 'ok')}` : ''}`, `<b>${pct(c.apy)}</b>${c.apyEarly != null ? `<br><small class="muted">${pct(c.apyEarly, 1)} then ${pct(c.apyLate, 1)}${c.steady ? '' : ' (uneven)'}</small>` : ''}`, c.enter.eligible ? pill('yes', 'ok') : pill('NO', 'bad'), c.redeemable ? pill('yes', 'ok') : pill('no', 'warn'), c.gasUsd == null ? '–' : usd(c.gasUsd), c.net == null ? '–' : `<b class="${c.net >= 0 ? 'ok' : 'bad'}">${usd(c.net)}</b>`, c.rejected.length ? `<small>${c.rejected.map((x) => esc(x)).join('<br>')}</small>` : '<small class="muted">ranked by net gain</small>']);
  return `
    <div class="verdict ${move ? 'ok' : 'info'}">${esc(rec.headline)}<small>${esc(rec.reason)}</small></div>
    ${r.source ? `<p class="muted">From <b>${esc(r.source.label)}</b>, ${esc(r.source.amountText)}, earning ${pct(r.source.apy)} a year · block ${r.block.number.toLocaleString('en-US')} · ${esc(r.block.iso)} · holding period ${r.assumptions.minHoldDays} days, minimum gain ${usd(r.assumptions.minNetGainUsd)}</p>` : ''}
    ${r.candidates.length ? `<h4 class="list-h">The vaults compared</h4>${table(['Vault', 'Paid a year', 'Let in?', 'Redeemable?', `Gas`, `Net over ${r.assumptions.minHoldDays} days`, 'Why not / note'], rows)}` : ''}
    ${move ? `<h4 class="list-h">How the expected gain adds up</h4>${table(['Extra yield', 'Gas', 'Vault fees', 'Net gain', 'Break-even'], [[usd(rec.grossGainUsd), usd(rec.gasUsd), usd(rec.feesUsd), `<b class="ok">${usd(rec.netGainUsd)}</b>`, rec.breakEvenDays == null ? '–' : rec.breakEvenDays < 1 ? 'under a day' : `${rec.breakEvenDays.toFixed(1)} days`]])}<p class="muted">Gas = measured units × ${r.prices.gasPriceGwei} gwei × $${r.prices.pros?.toFixed(3)} per PROS. Extra yield assumes the vaults keep paying what they paid over the last ${r.candidates[0]?.days?.toFixed(1) ?? 4} days, which they may not.</p>` : ''}
    ${r.prepared ? `<h4 class="list-h">Transactions to sign, in order <span class="tpill warn">unsigned</span></h4>${r.prepared.transactions.map((t, i) => `<div class="code"><button type="button" class="mini" data-copy="${esc(JSON.stringify({ to: t.to, data: t.data, value: t.value, gas: t.gasLimit }))}">Copy</button><pre><code>${i + 1}. ${esc(t.label)}\nto    ${esc(t.to)}\nvalue ${esc(t.value)}\ngas   ${t.gasLimit.toLocaleString('en-US')} (measured ${t.gasUnits.toLocaleString('en-US')} + 30%)\ndata  ${esc(t.data.slice(0, 90))}…\ncheck ${esc(t.simulated)}</code></pre></div>`).join('')}<p class="muted">${esc(r.prepared.note)}</p>` : ''}
    <h4 class="list-h">Who called what, in order</h4>${table(['#', 'Who', 'What'], r.steps.map(stepRow))}
    <p class="muted">${r.chainCalls} Chain MCP calls and ${r.rpcCalls} public RPC calls (every batch of reads is repeated there). Read-only: the agent holds no key and sends nothing.</p>`;
}

const livePanel = makePanel({
  intro: 'Pick a wallet and where its USDC is, choose how long you would hold, and run it. Everything is read from Pharos mainnet; a move is only ever prepared, unsigned. Takes about 30 seconds.',
  fields: [
    { name: 'wallet', label: 'Wallet address', type: 'text', value: CASES[0].wallet, grow: true, wide: true },
    { name: 'from', label: 'Move USDC from', type: 'select', options: [['auto', 'The largest USDC position'], ['idle', 'USDC idle in the wallet'], ['r25-weekly', 'R25 VRPC Weekly'], ['r25-quarterly', 'R25 VRPC Quarterly'], ['r25-semi-yearly', 'R25 VRPC Semi-yearly'], ['rockaway-usdc', 'RockawayX USDC (Morpho)']], value: 'idle' },
    { name: 'amount', label: 'Amount of USDC', type: 'text', optional: true, value: '', hint: 'Empty = all of it.' },
    { name: 'minHoldDays', label: 'Hold for at least (days)', type: 'number', min: 1, step: 1, value: '30' },
    { name: 'minNetGainUsd', label: 'Only move if the net gain is at least ($)', type: 'number', min: 0, step: 1, value: '10' },
  ],
  button: 'Compare and decide',
  examples: CASES.map((c) => ({ label: c.label, values: { wallet: c.wallet, from: c.from, amount: c.amount ?? '', minHoldDays: '30', minNetGainUsd: '10' } })),
  title: (v) => `Optimize from ${v.from}`,
  call: (v) => ({ params: { wallet: v.wallet, from: v.from, ...(v.amount && { amount: v.amount }), minHoldDays: v.minHoldDays, minNetGainUsd: v.minNetGainUsd } }),
  decode: ({ optimizer: r }) => [
    ...r.steps.map((s) => ({ kind: s.actor === 'agent' ? 'decision' : 'decode', title: `${s.n}. ${ACTOR[s.actor]}: ${s.name}`, detail: s.actor === 'agent' ? s.summary : `${s.input}` })),
    { kind: 'decision', title: r.recommendation.headline, detail: r.recommendation.reason },
  ],
  summary: ({ optimizer: r }) => `${r.recommendation.action.toUpperCase()}${r.recommendation.toName ? ` → ${r.recommendation.toName}` : ''} · ${r.chainCalls} Chain MCP + ${r.rpcCalls} RPC calls`,
  render: ({ optimizer: r }) => render(r),
});

// ---- fork evidence + the recorded demo with Replay -----------------------------------------------------------------------------------------------
function forkCard(fork) {
  const rows = Object.values(fork.vaults).map((v) => {
    const d = v.deposit;
    const x = v.redeem;
    const shares = d.status === 'success' ? (d.sharesReceived === d.predictedShares ? 'exactly the preview' : `${d.sharesReceived} vs preview ${d.predictedShares}`) : '';
    return [`<b>${esc(v.name)}</b>`, d.status === 'success' ? `${pill('worked', 'ok')} <small>${d.gasUsed.toLocaleString('en-US')} gas · shares ${esc(shares)}</small>` : `${pill('refused', 'bad')} <small>${esc(d.reason)}</small>`, x.status === 'success' ? `${pill('worked', 'ok')} <small>${x.gasUsed.toLocaleString('en-US')} gas · ${esc(x.usdcReceived)} base units back vs preview ${esc(x.predictedUsdc)}</small>` : x.status === 'reverted' ? `${pill('refused', 'bad')} <small>${esc(x.reason)}</small>` : `<small class="muted">${esc(x.reason)}</small>`];
  });
  return `<p class="muted">Measured ${esc(fork.recordedAt.slice(0, 10))} on a ${esc(fork.network)} at block ${fork.forkBlock.toLocaleString('en-US')}, impersonating <code>${esc(short(fork.wallet))}</code>, which holds USDC and vault shares. Each row: approve + deposit 1,000 USDC, then redeem about 1,000 USDC of shares. Nothing touches mainnet; the gas figures below are the ones the optimizer uses.</p>${table(['Vault', 'Deposit 1,000 USDC', 'Redeem about 1,000 USDC'], rows)}`;
}

function mountDemo(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Real fork run and recorded decisions</h3><div class="idle" data-role="body">Loading the recording…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { demo, fork } = data;
      body.classList.remove('idle');
      const rows = demo.cases.map((c) => {
        const r = c.result.recommendation;
        return [`<b>${esc(c.label)}</b><br><small class="muted">${esc(c.from)}${c.amount ? ` · ${esc(c.amount)} USDC` : ''} · <code class="tiny">${esc(short(c.wallet))}</code></small>`, pill(r.action === 'move' ? `MOVE → ${r.toName.replace(/ \(.*/, '')}` : 'STAY PUT', r.action === 'move' ? 'ok' : 'warn'), r.netGainUsd != null ? usd(r.netGainUsd) : '–', `<small>${esc(r.reason.length > 190 ? r.reason.slice(0, 188) + '…' : r.reason)}</small>`, `<button type="button" class="btn small" data-replay="${esc(c.id)}">Replay</button><div data-out="${esc(c.id)}"></div>`];
      });
      body.innerHTML = `<h4 class="list-h">What really happened on a mainnet fork</h4>${forkCard(fork)}<h4 class="list-h">Five recorded decisions on real wallets</h4><p class="muted">Recorded ${esc(demo.recordedAt.slice(0, 10))} at block ${demo.cases[0].block.toLocaleString('en-US')}. Replay works the decision out again at that block and compares it with the recording.</p>${table(['Case', 'Decision', 'Net gain', 'Why', ''], rows)}`;
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
          const same = c.sameAction && c.candidates.identical === c.candidates.compared;
          out.innerHTML = `<p class="check ${same ? 'ok' : 'bad'}">${same ? '✓' : '✗'} <b>Same decision, and ${c.candidates.identical} of ${c.candidates.compared} vaults identical</b> (rate, can enter, can redeem, viable)${c.sameNetGain ? '' : '; the gas price moved, so the net gain differs by a few cents'}.</p>`;
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
