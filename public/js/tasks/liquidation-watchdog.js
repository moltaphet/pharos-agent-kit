// Liquidation Watchdog: content, a live panel (check a Morpho Blue position on Pharos mainnet), a borrower finder, the recorded demo with Replay, and the fork run against the real Morpho.
import { api, esc } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { replayButton, wireReplay } from '../panels/replay.js';
import { REPO } from '../consts.js';

// Kept identical to agents/liquidation-watchdog/examples/positions.json (a test checks it).
export const POSITIONS = [
  {"id": "largest-near-liquidation", "label": "A $1.5M USDC loan against syzUSD, a hair above liquidation", "marketId": "0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86", "borrower": "0xa4a57dcf7b15456b7053f10a377bdb437c073dcc"},
  {"id": "second-near-liquidation", "label": "Another $1.3M syzUSD loan, also critical", "marketId": "0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86", "borrower": "0xe6a4771284342462f4d2bfbfb86db12c8f19fe7c"},
  {"id": "apt-usdc", "label": "A loan in a different market: APT collateral, USDC debt", "marketId": "0xd834016ed49b76ffcbeb8402733e2d69b1f77d30b28d6f21c826931214ae5aea", "borrower": "0x966b9dce3d091c0214ada42cedf51400df4fb257"},
  {"id": "comfortable", "label": "A comfortable loan (health factor about 1.5)", "marketId": "0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86", "borrower": "0xf8b4036d88dd71a7783aa97e9a4e14fbaa78b127"},
  {"id": "comfortable-strict", "label": "The same loan with stricter thresholds (warn at 1.6, critical at 1.5)", "marketId": "0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86", "borrower": "0xf8b4036d88dd71a7783aa97e9a4e14fbaa78b127", "warn": 1.6, "critical": 1.5},
  {"id": "sample-borrower", "label": "The first borrower we found in this market", "marketId": "0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86", "borrower": "0x743d7b30661d65b41960bf6b5d1bb93cf7972a73"},
  {"id": "nothing-borrowed", "label": "An address with no position in the market", "marketId": "0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86", "borrower": "0x00000000000000000000000000000000000000a1"},
];
const short = (a) => (a && a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a ?? '');
const TONE = { ok: 'ok', warning: 'warn', critical: 'bad', liquidatable: 'bad', 'no-debt': 'info' };

export const content = {
  tagline: 'Watch a loan on Pharos and get told before it can be liquidated, with the amount to repay or to add to be safe again.',
  tools: ['chain', 'rpc'],
  story: [
    'A loan on a lending market is safe as long as its collateral is worth enough. When the collateral price falls, or interest piles up, the loan slips towards liquidation, and anyone can then repay part of it and take the collateral at a discount. The Liquidation Watchdog watches one position and tells you early, while there is still time to act.',
    'It works on the real lending market on Pharos mainnet: Morpho Blue. It reads the position (collateral and borrow shares), the market (how much is borrowed and when interest was last added), the oracle price and the interest rate model, all at one pinned block through Chain MCP, and repeats every batch on the public RPC. The health factor is worked out the way Morpho’s own code decides: maxBorrow / borrowed, with the debt carried forward by the interest that has built up since the market was last touched.',
    'Then it grades the position against thresholds you choose (warn at 1.3 and critical at 1.1 by default) and raises an alert with a timestamp. Each alert says what to do, in numbers: how much to repay, or how much collateral to add, to get back to a safe health factor, how far the collateral price may fall before liquidation, and how long interest alone would take. The alert goes to the console, and to Discord or Telegram if you set a webhook or a bot token in the environment. It is read-only: it has no key and every call is an eth_call.',
    'The positions are real. Four borrowers were active in the last two days; three of them are within about 3.5% of liquidation right now, one with a debt of $1.5 million. A fork run also asks the deployed Morpho to liquidate one of them on both sides of health factor 1, with the oracle price moved on the fork only, and Morpho agrees with the watchdog every time.',
  ],
  how: [
    { server: 'chain', tool: 'get_block_number · get_block', text: 'Pin the read to one block, two behind the head, and take that block’s time as “now” for the interest that has accrued.' },
    { server: 'chain', tool: 'Multicall3 eth_call: idToMarketParams, market, position', text: 'The market’s tokens, oracle, interest rate model and LLTV; its totals and last update; and the borrower’s collateral and borrow shares. Repeated on the public RPC and compared.' },
    { server: 'chain', tool: 'Multicall3 eth_call: oracle.price(), irm.borrowRateView, symbols', text: 'The collateral price in the loan token (scaled by 1e36), the current per-second borrow rate, and the two tokens’ symbols and decimals.' },
    { server: 'local', tool: 'health factor', text: 'Morpho’s rule: healthy while collateral × price × LLTV ≥ debt. The debt is the borrow shares converted at the market’s totals after adding the interest accrued since the last update (the same Taylor expansion Morpho uses). Exact integer arithmetic.' },
    { server: 'local', tool: 'level and action', text: 'OK, warning, critical or liquidatable against your thresholds; then the repayment or the collateral that restores a target health factor, the price drop to liquidation, and the days interest alone would take.' },
    { server: 'local', tool: 'alert channels', text: 'A console line with a timestamp; Discord and Telegram too when configured. An alert is raised when the level gets worse (or recovers), not on every look.' },
  ],
  decisions: [
    { title: 'Morpho’s own definition of “unhealthy”', text: 'A health factor is only useful if it matches what the lender decides. The watchdog uses Morpho’s rule and its debt accrual, not a textbook formula, and a fork run checks it against the deployed contract.' },
    { title: 'Checked against the real Morpho contract', text: 'On a fork of mainnet the oracle’s code is swapped for a one-line contract returning a chosen price. At 0.0002% above health factor 1 the real Morpho refuses to liquidate (“position is healthy”); at 0.0002% below it executes the liquidation. The liquidation bonus it paid, 1.026167, equals the one the watchdog quotes. The oracle is replaced only on the fork.' },
    { title: 'Interest is part of the position', text: 'A market that nobody touched for three hours still owes three hours of interest. Without it the watchdog would say a position is safer than Morpho will think it is. The rate comes from the market’s own interest rate model.' },
    { title: 'The alert says what to do, with numbers', text: '“Repay 336,001.93 USDC or add 437,713.00 syzUSD of collateral to get back to a health factor of 1.30” is something a person can act on. The amounts are exact, and the tests check that one unit less would not be enough.' },
    { title: 'Thresholds are yours, and validated', text: 'Critical must be above 1 (at 1 the position is already liquidatable) and warn above critical. The same loan is OK, a warning or critical depending on them, and the recording shows it.' },
    { title: 'No alert storms', text: 'An alert is sent when the level changes for the worse, or when it recovers, not on every poll. A channel that fails never stops the others or loses the alert.' },
    { title: 'Keys and tokens stay in the environment', text: 'A Discord webhook or a Telegram bot token is read from DISCORD_WEBHOOK_URL, TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. Only the console channel was used in the recordings.' },
    { title: 'Read-only', text: 'It reads positions and never touches them. It cannot repay or add collateral; it tells you how much.' },
  ],
  evidence: [
    'It reads the position’s collateral, debt and health factor from Morpho Blue on Pharos mainnet (collateral and borrow shares, the market totals, the oracle price and the interest rate model), in two Multicall3 batches at one pinned block, each confirmed on the public RPC.',
    'Thresholds are configurable (warn 1.3 and critical 1.1 by default, validated); the same recorded loan is OK, a warning or critical under different thresholds.',
    'Alerts go to the console with a timestamp, and to Discord or Telegram when a webhook or bot token is set in the environment; an alert is raised when the level worsens or recovers, not on every look.',
    'Every alert carries a concrete action: how much to repay, or how much collateral to add, to get back to a safe health factor, plus how far the price may fall and how long interest alone would take.',
  ],
  files: ['lib/liquidation.js', 'lib/onchain.js', 'lib/tasks/liquidation-watchdog.js', 'agents/liquidation-watchdog/pharos-watchdog.js', 'agents/liquidation-watchdog/examples/positions.json', 'scripts/liquidation-demo.mjs', 'scripts/liquidation-fork-run.mjs', 'reports/liquidation-demo.json', 'reports/liquidation-fork-run.json'],
  run: {
    commands: ['node agents/liquidation-watchdog/pharos-watchdog.js --market 0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86 --borrower 0x743d7b30661d65b41960bf6b5d1bb93cf7972a73', '… --warn 1.5 --critical 1.2 --watch 60   # look again every minute; alert when the level worsens', 'DISCORD_WEBHOOK_URL=… node agents/liquidation-watchdog/pharos-watchdog.js …   # also to Discord', 'node scripts/liquidation-fork-run.mjs   # ask the real Morpho to liquidate on a fork (needs Foundry)'],
    sample: `[2026-10-24T21:09:28.373Z] CRITICAL: health factor 1.0134 (warn at 1.3, critical at 1.1)
    position 0xa4a57d…073dcc in market 0xc79579a0… (syzUSD/USDC)
    Collateral 1,547,470.9011 syzUSD worth 1,687,707.0967 USDC; debt 1,523,888.0824 USDC; liquidation threshold (LLTV) 91.5%; current loan-to-value 90.29%.
    syzUSD would have to fall 1.32% (to 1.0762 USDC each) to reach liquidation.
    Even at a flat price, interest at 9.35% a year takes about 51.8 days to get there.
    → repay 336,001.9336 USDC or add 437,713.0043 syzUSD of collateral to get back to a health factor of 1.30.`,
  },
  verify: [
    { title: 'Read the position yourself', text: 'The borrower’s collateral and borrow shares in the demo market, straight from Morpho Blue on the public RPC.', code: 'cast call 0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb "position(bytes32,address)(uint256,uint128,uint128)" 0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86 0x743d7b30661d65b41960bf6b5d1bb93cf7972a73 --rpc-url https://rpc.pharos.xyz' },
    { title: 'Read the oracle price', text: 'The collateral price the market uses (1.0906e24 means 1.0906 USDC per syzUSD, scaled by 1e36 and the tokens’ decimals).', code: 'cast call 0x4eEfC4C6e7216Aedd5E809e4fC74fb8859B3FA46 "price()(uint256)" --rpc-url https://rpc.pharos.xyz' },
    { title: 'See Morpho agree on a fork', text: 'The fork card above lists what the real Morpho did when asked to liquidate the same borrower on both sides of health factor 1. Run it yourself with Foundry.', code: 'node scripts/liquidation-fork-run.mjs' },
    { title: 'Replay a recorded position', text: 'In the recorded card press Replay: the position is read again at the recorded block and compared with the recording.' },
    { title: 'Read the code', text: 'The engine, the CLI, the examples and the recordings are in the repository.', link: [`${REPO}/tree/main/agents/liquidation-watchdog`, 'agents/liquidation-watchdog'] },
  ],
};

// ---- the live panel ----------------------------------------------------------------------------------------------------------------
const ACTOR = { agent: 'Agent', 'chain-mcp': 'Chain MCP', 'public-rpc': 'Public RPC' };
const stepRow = (s) => [s.n, `<span class="tpill ${{ agent: '', 'chain-mcp': 'ok', 'public-rpc': 'warn' }[s.actor]}">${ACTOR[s.actor]}</span>`, s.actor === 'agent' ? `<b><code>${esc(s.name)}</code></b><br><small>${esc(s.summary)}</small>` : `<b><code>${esc(s.name)}</code></b> <small class="muted">${s.ms} ms</small><br><code class="tiny">${esc(s.input)}</code>`];

export function render(r) {
  const p = r.position;
  const rem = r.remedies;
  return `
    <div class="verdict ${TONE[r.level]}">${esc(r.level === 'no-debt' ? 'NO DEBT' : r.level.toUpperCase())}${r.healthFactor != null ? ` · health factor ${r.healthFactor.toFixed(4)}` : ''}<small>${esc(r.market.pair)} · block ${r.block.number.toLocaleString('en-US')} · ${esc(r.block.iso)} · read-only</small></div>
    <h4 class="list-h">The alert (what a console receives)</h4>
    <pre class="plain">${esc(r.alert.text)}</pre>
    ${r.alert.action ? `<p class="check ${r.level === 'ok' ? 'ok' : 'warn'}"><b>What to do:</b> ${esc(r.alert.action)}</p>` : ''}
    <h4 class="list-h">The position, as Morpho counts it</h4>
    ${table(['', 'Amount', ''], [
      ['Collateral', esc(p.collateralText), `worth ${esc(p.collateralValueText)} at ${esc(p.priceText)}`],
      ['Debt', `<b>${esc(p.borrowedText)}</b>`, p.interestSeconds ? `includes interest carried forward ${p.interestSeconds.toLocaleString('en-US')} s` : ''],
      ['Most it can borrow', esc(p.maxBorrowText), `LLTV ${esc(r.market.lltvText)}`],
      ['Loan to value', `${(p.ltv * 100).toFixed(2)}%`, ''],
    ])}
    ${rem ? `<h4 class="list-h">Ways back to ${rem.target.toFixed(2)}</h4>${table(['Option', 'Amount'], [['Repay', esc(rem.repayToTargetText)], ['Or add collateral', esc(rem.addCollateralText)], ['Collateral price at liquidation', `${esc(rem.liquidationPriceText)} (${rem.priceDropPct.toFixed(2)}% below now)`], ['Interest alone gets there in', rem.daysToLiquidationByInterest == null ? '–' : `${rem.daysToLiquidationByInterest.toFixed(1)} days at ${(rem.borrowRatePerYear * 100).toFixed(2)}% a year`]])}` : ''}
    <h4 class="list-h">Sources</h4>
    ${table(['#', 'Contract', 'Call', 'Block', 'How it was read'], r.sources.map((s, i) => [i + 1, `<code>${esc(short(s.contract))}</code>`, esc(s.call), s.block.toLocaleString('en-US'), `${esc(s.tool)}<br>${pill(s.integrity === 'confirmed' ? 'confirmed on the public RPC' : s.integrity, s.integrity === 'inconclusive' ? 'warn' : 'ok')}`]))}
    <h4 class="list-h">Who called what, in order</h4>
    ${table(['#', 'Who', 'What'], r.steps.map(stepRow))}
    <p class="muted">${r.chainCalls} Chain MCP calls and ${r.rpcCalls} public RPC calls. Channels used: ${r.delivered.map((d) => esc(d.channel)).join(', ') || 'none needed'}. Read-only: only eth_call.</p>`;
}

const livePanel = makePanel({
  intro: 'Pick a position (or paste a market id and a borrower), choose the thresholds, and run. Everything is read from Pharos mainnet at one block and confirmed on a second source. Nothing is sent.',
  fields: [
    { name: 'marketId', label: 'Morpho Blue market id', type: 'text', value: POSITIONS[5].marketId, grow: true, wide: true },
    { name: 'borrower', label: 'Borrower address', type: 'text', value: POSITIONS[5].borrower, grow: true, wide: true },
    { name: 'warn', label: 'Warn at', type: 'number', step: 0.05, min: 1, value: '1.3', hint: 'Default 1.3' },
    { name: 'critical', label: 'Critical at', type: 'number', step: 0.05, min: 1, value: '1.1', hint: 'Default 1.1; must be below the warning' },
    { name: 'block', label: 'Pin to block', type: 'number', optional: true, min: 1, step: 1, value: '', hint: 'Empty = two blocks behind the latest.' },
  ],
  button: 'Check the position',
  examples: POSITIONS.map((p) => ({ label: p.label, values: { marketId: p.marketId, borrower: p.borrower, warn: String(p.warn ?? 1.3), critical: String(p.critical ?? 1.1), block: '' } })),
  title: (v) => `Check ${short(v.borrower)}`,
  call: (v) => ({ params: { marketId: v.marketId, borrower: v.borrower, warn: v.warn, critical: v.critical, ...(v.block !== '' && { block: v.block }) } }),
  decode: ({ watchdog: r }) => [
    ...r.steps.map((s) => ({ kind: s.actor === 'agent' ? 'decision' : 'decode', title: `${s.n}. ${ACTOR[s.actor]}: ${s.name}`, detail: s.actor === 'agent' ? s.summary : `${s.input} → ${(s.output ?? s.error ?? '').slice(0, 120)}` })),
    { kind: 'decision', ok: r.level === 'ok' || r.level === 'no-debt', title: r.alert.headline, detail: r.alert.text },
  ],
  summary: ({ watchdog: r }) => `${r.level}${r.healthFactor ? ` · health factor ${r.healthFactor.toFixed(4)}` : ''} · ${r.chainCalls} Chain MCP + ${r.rpcCalls} RPC calls`,
  render: ({ watchdog: r }) => render(r),
});

// ---- borrower finder, recorded demo, fork run ---------------------------------------------------------------------------------------
function mountFinder(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Who is close to liquidation right now?</h3><p class="muted">Reads the Borrow events of Morpho Blue for the last 40,000 blocks (about 10 hours), then grades each borrower it finds. Takes about 30 seconds.</p><button class="ghost" type="button" data-scan>Find borrowers</button><div data-out></div></section>';
  const out = el.querySelector('[data-out]');
  const btn = el.querySelector('[data-scan]');
  btn.onclick = async () => {
    btn.disabled = true;
    out.innerHTML = '<div class="idle">Scanning…</div>';
    try {
      const { data } = await api('run', { slug, scan: 1, windows: 40 });
      const s = data.scan;
      out.innerHTML = `<p class="muted">Blocks ${s.from.toLocaleString('en-US')}–${s.to.toLocaleString('en-US')}: ${s.found} borrower${s.found === 1 ? '' : 's'} found.</p>${s.positions.length ? table(['Borrower', 'Market', 'Debt', 'Health factor', ''], s.positions.map((b) => [`<code>${esc(short(b.borrower))}</code>`, esc(b.pair ?? short(b.marketId)), esc(b.debtText ?? ''), b.healthFactor == null ? '–' : `<b>${b.healthFactor.toFixed(4)}</b>`, b.level ? pill(b.level, TONE[b.level]) : esc(b.error ?? '')])) : '<p class="muted">No borrowing in this window.</p>'}`;
    } catch (err) {
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  };
}

function mountDemo(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Recorded demo: real borrowers on Pharos mainnet, and the real Morpho agreeing</h3><div class="idle" data-role="body">Loading the recording…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { demo, fork } = data;
      body.classList.remove('idle');
      const rows = demo.cases.map((c) => [`<b>${esc(c.label)}</b><br><small class="muted"><code class="tiny">${esc(short(c.borrower))}</code> · warn ${c.thresholds.warn}, critical ${c.thresholds.critical}</small>`, `${pill(c.result.level, TONE[c.result.level])}${c.result.healthFactor != null ? ` <b>${c.result.healthFactor.toFixed(4)}</b>` : ''}`, `<small>${esc(c.result.alert.action ?? c.result.alert.headline)}</small>`, replayButton(c.id)]);
      const fr = fork.cases.map((c) => [esc(c.label), c.predictedHealthFactor.toFixed(6), pill(c.predictedHealthy ? 'healthy' : 'liquidatable', c.predictedHealthy ? 'ok' : 'bad'), esc(c.morphoSaid), c.agrees ? pill('agree', 'ok') : pill('DISAGREE', 'bad')]);
      body.innerHTML = `
        <p class="muted">Recorded ${esc(demo.recordedAt.slice(0, 10))}, all at block ${demo.cases[0].block.toLocaleString('en-US')}. Replay reads the position again at that block and compares collateral, debt, price, health factor and the verdict with the recording.</p>
        ${table(['Position', 'Level', 'What the alert says to do', ''], rows)}
        <h4 class="list-h">The real Morpho, asked to liquidate on a fork</h4>
        <p class="muted">Fork of Pharos mainnet at block ${fork.forkBlock.toLocaleString('en-US')}, the live Morpho Blue, the borrower ${esc(short(fork.borrower))}. Only the collateral price is moved, by replacing the oracle on the fork. The watchdog’s verdict at each price, and what Morpho did when a liquidation was attempted:</p>
        ${table(['Collateral price', 'Watchdog’s health factor', 'Watchdog says', 'Morpho', ''], fr)}
        <p class="check ${fork.summary.agree === fork.summary.cases ? 'ok' : 'bad'}">${fork.summary.agree === fork.summary.cases ? '✓' : '✗'} <b>Morpho agreed with the watchdog in ${fork.summary.agree} of ${fork.summary.cases} cases</b>, on both sides of health factor 1 (±0.0002%). The liquidation bonus Morpho paid, ${fork.cases.find((c) => c.bonusPaidByMorpho)?.bonusPaidByMorpho.toFixed(6)}, equals the one the watchdog quotes.</p>`;
      wireReplay(body, slug);
    })
    .catch((err) => {
      body.classList.remove('idle');
      body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    });
}

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="demo"></div><div data-slot="finder"></div><div data-slot="live"></div>';
  mountDemo(root.querySelector('[data-slot=demo]'), ctx.slug);
  mountFinder(root.querySelector('[data-slot=finder]'), ctx.slug);
  return livePanel(root.querySelector('[data-slot=live]'), ctx);
}
