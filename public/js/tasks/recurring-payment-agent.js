// Recurring Payment Agent: content, a live panel (look at a schedule, report a payment, see the history), the recorded mainnet cases with Replay, and the fork run of the whole lifecycle.
import { api, esc } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { replayButton, wireReplay } from '../panels/replay.js';
import { REPO } from '../consts.js';

// Kept identical to agents/recurring-payment-agent/examples/schedules.json (a test checks it).
export const SCHEDULES = [
  {"id": "weekly-rent", "label": "Rent: 25 USDC every week", "schedule": {"id": "rent-weekly", "label": "Rent", "payer": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "payee": "0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "token": "USDC", "amount": "25", "frequency": "weekly", "start": "2026-10-05T09:00"}},
  {"id": "monthly-subscription", "label": "A subscription: 12.5 USDC on the 31st of every month", "schedule": {"id": "sub-monthly", "label": "Subscription", "payer": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "payee": "0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "token": "USDC", "amount": "12.5", "frequency": "monthly", "start": "2026-08-31T00:00"}},
  {"id": "payer-with-nothing", "label": "A payer that holds no USDC", "schedule": {"id": "poor-payer", "label": "Allowance", "payer": "0x00000000000000000000000000000000000000a1", "payee": "0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "token": "USDC", "amount": "10", "frequency": "weekly", "start": "2026-10-12T00:00"}},
];
const short = (a) => (a && a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a ?? '');
const TONE = { paid: 'ok', pending: 'warn', submitted: 'info', failed: 'bad', upcoming: '' };
const STORE = 'recurring-payment-agent-state-v1';
const store = {
  load() { try { return JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { return null; } },
  save(v) { try { v == null ? localStorage.removeItem(STORE) : localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private window: the page still works, it just does not remember */ } },
};

export const content = {
  tagline: 'A weekly or monthly payment that is prepared on time, tracked as paid, pending or failed from what is on chain, and never paid twice.',
  tools: ['chain', 'rpc'],
  story: [
    'Rent, a subscription, a salary: money that goes to the same place on a schedule. Doing it by hand means remembering, checking whether last time worked, and not paying twice when a transaction was slow or failed. This agent keeps the schedule and, whenever you look, tells you what is paid, what is due, what is next, and hands you the unsigned transaction for the payment to make now.',
    '“Paid” is a fact about the chain, not about the agent’s notes. Every payment it prepares carries a reference (rp:<schedule>:<period>) after the transfer’s own data, so a transfer on chain can be tied to exactly one period. A period is paid when the chain shows it: the transaction hash you report is read back (receipt, status, the token’s Transfer log), and even if you never report it, the agent scans the blocks since the schedule began and finds the transfer by itself. Before it prepares anything, it looks at the chain again, which is what stops a payment that already landed from being made twice.',
    'It copes with the things that go wrong. A payer without enough balance gets no transaction prepared and the reason, not a payment that will fail. A transaction that reverts is reported as failed, nothing was moved, and a retry is prepared (up to three attempts, then it stops and asks you to look). A transaction that landed but was never reported is found on chain, marked paid, and not prepared again. Reporting the same transaction twice, or a second one for a period already paid, is refused.',
    'The whole lifecycle ran on a fork of Pharos mainnet with the live USDC contract: three weekly periods due, the first signed and paid, the second failing with too little gas then retried and paid without being reported, the payer’s balance dropped below the amount (blocked), restored, the third paid. The payee ended with exactly three payments, one for each reference, and the chain says so.',
  ],
  how: [
    { server: 'chain', tool: 'get_block_number · get_block', text: 'The chain’s own clock: the time of the block it reads at decides which periods are due. Weekly is exactly seven days apart; monthly keeps the day and the time, and a short month takes its last day (the 31st becomes the 28th, 29th or 30th).' },
    { server: 'chain', tool: 'eth_getTransactionReceipt · eth_getTransactionByHash', text: 'Each transaction you reported is read back: mined or not, reverted or not, and for a token the Transfer log from the payer to the payee for at least the amount.' },
    { server: 'rpc', tool: 'eth_getLogs (Transfer, payer → payee)', text: 'The blocks since the schedule began (or since the last look) are scanned in windows of 1,000 blocks, the most the node answers. A transfer found there is tied to its period by the reference in its transaction data.' },
    { server: 'chain', tool: 'Multicall3 eth_call · estimate_gas', text: 'Before a payment is prepared: the payer’s balance, the token, the simulation as the payer and the gas, with the reference appended to the calldata.' },
    { server: 'local', tool: 'status of every period', text: 'Upcoming, pending, submitted, paid or failed, from the evidence above. The oldest open period is prepared first; a prepared payment is returned unchanged until it is paid, so it cannot be signed twice by mistake.' },
    { server: 'local', tool: 'history', text: 'Every step (prepared, reported, paid, failed, blocked) is written to a history with its time and transaction. The state is returned to you and passed back next time: the page keeps it in the browser, the CLI in a file.' },
  ],
  decisions: [
    { title: 'Paid means the chain says so', text: 'The agent does not mark a period paid because you said you sent something. It reads the receipt and the token’s own Transfer log. A transaction that succeeded but did not pay the payee the right amount is not a payment.' },
    { title: 'A reference in the calldata ties a payment to a period', text: 'The token’s decoder ignores bytes after the transfer’s arguments, so “rp:rent:2” can ride along and stay readable on chain. The fork run proves the live USDC accepts it and that exactly one transfer on chain carries each reference.' },
    { title: 'Look again before preparing', text: 'The chain is read again before each preparation: a payment that landed since the last look (even unreported) is found first. This is what makes “never twice” a property of the chain, not of the agent’s memory.' },
    { title: 'A payment that cannot be made is not prepared', text: 'If the payer cannot cover it, the agent says so (and how much is short) and prepares nothing, instead of a transaction that will fail and cost gas. When the balance is restored the next look prepares it.' },
    { title: 'Failed means moved nothing, and retries are bounded', text: 'A reverted transaction moved nothing, so a retry is safe, and it is prepared as a new attempt. After three failed attempts for one period the agent stops preparing it and asks a person to look, rather than looping.' },
    { title: 'Stale prepared payments are not repeated', text: 'A prepared transaction is returned unchanged until it is paid, so asking twice does not produce two different payments. After a failure it is replaced by a fresh one.' },
    { title: 'Honest about what it can find', text: 'Payments made before the schedule was created are not searched (the node answers log queries 1,000 blocks at a time); report their hashes. Native PROS payments leave no log, so they are tracked from the hashes you report. This is said on the page, not hidden.' },
    { title: 'No key', text: 'It prepares unsigned transactions only. In the fork run a person’s signing is played by an impersonated payer; no key is read or used.' },
  ],
  evidence: [
    'A schedule is weekly or monthly with an amount, a token and a recipient (and a start date and an optional count); the due times are exact (a month without the 31st takes its last day), and the next payment is shown.',
    'Each payment is prepared as an unsigned transaction when it is due, and every period is tracked as upcoming, pending, submitted, paid or failed, from the receipt and the token’s Transfer log on Pharos mainnet.',
    'A payer without enough balance gets nothing prepared and a reason; a reverted transaction is failed and retried (at most three times); a transaction that landed unreported is found on chain and never prepared again; reporting a paid period again is refused. On a fork the payee ended with exactly one payment per period.',
    'The page and the CLI show the payment history (every prepared, reported, paid, failed and blocked event with its transaction) and the next scheduled payment.',
  ],
  files: ['lib/recurring.js', 'lib/payments.js', 'lib/tasks/recurring-payment-agent.js', 'agents/recurring-payment-agent/pharos-recurring.js', 'agents/recurring-payment-agent/examples/schedules.json', 'scripts/payments-demo.mjs', 'scripts/recurring-fork-run.mjs', 'reports/recurring-demo.json', 'reports/recurring-fork-run.json'],
  run: {
    commands: ['node agents/recurring-payment-agent/pharos-recurring.js --state rent.json --payer 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --payee 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A --token USDC --amount 25 --frequency weekly --start 2026-10-05T09:00', '… --state rent.json --schedule rent.schedule.json --report 0 0x<hash you signed>   # tell it a payment was sent', 'node scripts/recurring-fork-run.mjs   # the whole lifecycle on a mainnet fork (needs Foundry)'],
    sample: `weekly 25 USDC  0x8ecdf4… → 0x5a5a5a…   at block 21,151,643 · 2026-10-24T20:49:06Z
  period  0  2026-10-05T09:00:00Z  PENDING  
  period  1  2026-10-12T09:00:00Z  PENDING  
  period  2  2026-10-19T09:00:00Z  PENDING  
  period  3  2026-10-26T09:00:00Z  UPCOMING 
  period  4  2026-11-02T09:00:00Z  UPCOMING 

  0 paid · 3 pending · 0 submitted · 0 failed · next: 25 USDC on 2026-10-26T09:00:00Z

  PREPARE period 0 (prepared); sign it once, then report it with --report 0 <hash>
    Send 25 USDC from 0x8ecdf4…24ab9f to 0x5a5a5a…5a5a5a on Pharos Pacific Mainnet.
    It is a call to the USDC contract (0xc879c0…ac1815): transfer(0x5a5a5a…5a5a5a, 25000000).
    Reference "rp:rent-weekly:0" is written into the transaction data after the transfer, so it can be read on chain.
    Network fee: about 0.000961 PROS (80,118 gas at 10 gwei).
    Balance after: 942,917.429833 USDC.`,
  },
  verify: [
    { title: 'Read the payee’s USDC balance on the fork run’s final state', text: 'The fork run ends with three payments of 25 USDC. Its report lists every transfer on chain with the reference read from its transaction data.', code: 'node scripts/recurring-fork-run.mjs' },
    { title: 'Read a reference from a transaction’s input', text: 'The data after the 68 bytes of a transfer is the reference: decode it from any transaction the agent prepared.', code: 'cast tx <hash> input | cut -c139- | xxd -r -p' },
    { title: 'Check the due dates', text: 'Weekly periods are 604,800 seconds apart: compare two due times in the table above.', code: 'date -u -r 1759654800' },
    { title: 'Replay a recorded schedule', text: 'In the recorded card press Replay: the schedule is looked at again at the recorded block, and the periods and the prepared transaction are compared.' },
    { title: 'Read the code', text: 'The engine, the CLI, the examples and the recordings are in the repository.', link: [`${REPO}/tree/main/agents/recurring-payment-agent`, 'agents/recurring-payment-agent'] },
  ],
};

// ---- the live panel ----------------------------------------------------------------------------------------------------------------
const ACTOR = { agent: 'Agent', 'chain-mcp': 'Chain MCP', 'public-rpc': 'Public RPC' };
const stepRow = (s) => [s.n, `<span class="tpill ${{ agent: '', 'chain-mcp': 'ok', 'public-rpc': 'warn' }[s.actor]}">${ACTOR[s.actor]}</span>`, s.actor === 'agent' ? `<b><code>${esc(s.name)}</code></b><br><small>${esc(s.summary)}</small>` : `<b><code>${esc(s.name)}</code></b> <small class="muted">${s.ms} ms</small><br><code class="tiny">${esc(s.input)}</code>`];
const when = (p) => (p.status === 'upcoming' ? `in ${(p.inSeconds / 86400).toFixed(1)} days` : p.status === 'pending' || p.status === 'failed' ? `${(p.overdueSeconds / 86400).toFixed(1)} days overdue` : '');

export function render(r) {
  const periods = r.periods.map((p) => [p.period, `<code class="tiny">${esc(p.dueIso)}</code>`, pill(p.status, TONE[p.status]), `<small>${p.evidence ? `<a href="${esc(p.explorer)}" target="_blank" rel="noopener"><code>${esc(short(p.evidence.hash))}</code></a> (${esc(p.evidence.how === 'found-on-chain' ? 'found on chain, nobody reported it' : 'reported, confirmed on chain')})` : p.failure ? `${esc(p.failure.reason)} · <code>${esc(short(p.failure.hash))}</code> · attempt ${p.attempts}` : p.submitted ? `<code>${esc(short(p.submitted.hash))}</code>: ${esc(p.submitted.reason)}` : esc(when(p))}</small>`]);
  const a = r.action;
  return `
    <div class="verdict ${r.counts.failed ? 'bad' : a?.transaction ? 'warn' : 'ok'}">${r.counts.paid} paid · ${r.counts.pending} pending · ${r.counts.submitted} submitted · ${r.counts.failed} failed<small>${esc(r.schedule.frequency)} ${esc(r.schedule.amount)} ${esc(r.schedule.token.symbol)} · block ${r.block.number.toLocaleString('en-US')} · the chain’s clock: ${esc(r.clock)}</small></div>
    ${r.next ? `<p class="check ok"><b>Next scheduled payment:</b> ${esc(r.next.text)} (period ${r.next.period}, in ${(r.next.inSeconds / 86400).toFixed(1)} days).</p>` : ''}
    ${r.notices.map((n) => `<p class="check warn">${esc(n.text)}</p>`).join('')}
    <h4 class="list-h">Every period</h4>
    ${table(['#', 'Due (UTC)', 'Status', 'Evidence'], periods)}
    ${a?.transaction ? `<h4 class="list-h">Prepare this payment: period ${a.period}${a.retry ? ` (${esc(a.retry)})` : ''}</h4><ul class="plain-list">${a.summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${table(['Field', 'Value'], [['to', `<code>${esc(a.transaction.to)}</code>`], ['data', `<code class="tiny">${esc(a.transaction.data)}</code>`], ['reference', `<code>${esc(a.reference)}</code>`], ['gas limit', esc(a.transaction.gas)]])}
      <p class="muted">Unsigned. Sign it once; then report its hash below so the agent can confirm it from the chain. Asking again returns this same transaction.</p>` : a ? `<p class="check bad"><b>Period ${a.period} cannot be paid now:</b> ${esc(a.reason)}</p>` : ''}
    <h4 class="list-h">History</h4>
    ${r.history.length ? table(['When', 'What', 'Period', 'Detail'], [...r.history].reverse().map((h) => [`<code class="tiny">${esc(h.at)}</code>`, pill(h.type, { paid: 'ok', prepared: 'info', submitted: 'info', failed: 'bad', blocked: 'warn' }[h.type]), h.period ?? '', `<small>${esc([h.hash ? short(h.hash) : '', h.how, h.reason, h.reference].filter(Boolean).join(' · '))}</small>`])) : '<p class="muted">Nothing yet.</p>'}
    ${r.scan ? `<p class="muted">Scanned blocks ${r.scan.from.toLocaleString('en-US')}–${r.scan.to.toLocaleString('en-US')} for ${esc(r.schedule.token.symbol)} transfers from the payer to the payee: ${r.scan.found} found${r.scan.complete ? '' : ' (not finished: it continues next time)'}. Payments from before the schedule was created are not searched: report their hashes.</p>` : ''}
    <h4 class="list-h">Who called what, in order</h4>
    ${table(['#', 'Who', 'What'], r.steps.map(stepRow))}
    <p class="muted">${r.chainCalls} Chain MCP calls and ${r.rpcCalls} public RPC calls. Read-only: no key, only reads.</p>`;
}

const S = SCHEDULES[0].schedule;
const livePanel = makePanel({
  intro: 'Describe the schedule and look at it. The first look remembers where the chain was; every look after that is checked against what happened on chain. The state is kept in this browser. Nothing is signed or sent.',
  fields: [
    { name: 'payer', label: 'Payer (the wallet that pays)', type: 'text', value: S.payer, grow: true, wide: true },
    { name: 'payee', label: 'Payee (who receives)', type: 'text', value: S.payee, grow: true, wide: true },
    { name: 'token', label: 'Token', type: 'select', options: [['USDC', 'USDC'], ['WPROS', 'WPROS'], ['LINK', 'LINK'], ['WETH', 'WETH'], ['PROS', 'PROS (native, tracked from reported hashes)']], value: 'USDC' },
    { name: 'amount', label: 'Amount each time', type: 'text', value: S.amount },
    { name: 'frequency', label: 'How often', type: 'select', options: [['weekly', 'Weekly'], ['monthly', 'Monthly']], value: 'weekly' },
    { name: 'start', label: 'First payment (UTC)', type: 'text', value: S.start, hint: 'e.g. 2026-11-01 or 2026-11-01T09:00' },
    { name: 'id', label: 'Schedule id', type: 'text', optional: true, value: S.id, hint: 'a–z, 0–9 and - (it is part of every payment’s reference)' },
    { name: 'period', label: 'Report: period', type: 'number', optional: true, min: 0, step: 1, value: '', hint: 'after you sign a payment' },
    { name: 'hash', label: 'Report: transaction hash', type: 'text', optional: true, value: '', grow: true },
  ],
  button: 'Look at the schedule',
  examples: SCHEDULES.map((x) => ({ label: x.label, values: { payer: x.schedule.payer, payee: x.schedule.payee, token: x.schedule.token, amount: x.schedule.amount, frequency: x.schedule.frequency, start: x.schedule.start, id: x.schedule.id, period: '', hash: '' } })),
  state: store,
  title: (v) => `Schedule ${v.id || ''}: ${v.amount} ${v.token} ${v.frequency}`,
  call: (v, state) => ({ body: { schedule: { id: v.id || undefined, payer: v.payer, payee: v.payee, token: v.token, amount: v.amount, frequency: v.frequency, start: v.start }, state: state?.scheduleId === (v.id || state?.scheduleId) ? state : null, ...(v.period !== '' && v.hash && { report: { period: Number(v.period), hash: v.hash } }) } }),
  nextState: (data) => data.agent.state,
  decode: ({ agent: r }) => [
    ...r.steps.map((s) => ({ kind: s.actor === 'agent' ? 'decision' : 'decode', title: `${s.n}. ${ACTOR[s.actor]}: ${s.name}`, detail: s.actor === 'agent' ? s.summary : `${s.input} → ${(s.output ?? s.error ?? '').slice(0, 120)}` })),
    { kind: 'decision', ok: !r.counts.failed, title: `${r.counts.paid} paid, ${r.counts.pending} pending, ${r.counts.failed} failed${r.action ? `; period ${r.action.period}: ${r.action.kind}` : ''}` },
  ],
  summary: ({ agent: r }) => `${r.counts.paid} paid · ${r.counts.pending} pending · ${r.counts.failed} failed · ${r.chainCalls} Chain MCP + ${r.rpcCalls} RPC calls`,
  render: ({ agent: r }) => render(r),
});

// ---- the recorded cases with Replay, and the fork lifecycle -------------------------------------------------------------------------------
function mountDemo(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Recorded demo: real schedules on Pharos mainnet, and the whole lifecycle on a real EVM</h3><div class="idle" data-role="body">Loading the recording…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { demo, fork } = data;
      body.classList.remove('idle');
      const rows = demo.cases.map((c) => [`<b>${esc(c.label)}</b><br><small class="muted">${esc(c.schedule.frequency)} · starts ${esc(c.schedule.start)} · <code class="tiny">${esc(short(c.schedule.payer))}</code></small>`, `${c.result.counts.paid} paid · ${c.result.counts.pending} pending · ${c.result.counts.upcoming} upcoming`, `<small>${esc(c.result.action?.kind === 'prepared' ? `prepared period ${c.result.action.period} (${c.result.action.reference})` : c.result.action?.reason ?? 'nothing to do')}</small>`, replayButton(c.id)]);
      const tl = fork.timeline.map((t) => [esc(t.label), t.periods.map((p) => `${p.period}:${p.status}`).join('  '), `<small>${esc(t.action ? `${t.action.kind} (period ${t.action.period})${t.action.reason ? ': ' + t.action.reason : ''}` : 'none')}</small>`]);
      const pr = fork.proof;
      body.innerHTML = `
        <p class="muted">Recorded ${esc(demo.recordedAt.slice(0, 10))}, all at block ${demo.cases[0].block.toLocaleString('en-US')}. Replay looks at the schedule again at that block and compares the clock, every period’s status and the prepared transaction.</p>
        ${table(['Schedule', 'Periods', 'Action', ''], rows)}
        <h4 class="list-h">The whole lifecycle, on a fork of mainnet</h4>
        <p class="muted">Weekly, 25 USDC, three periods already due; the live USDC contract; the payer is impersonated (no key). Each row is one look at the schedule.</p>
        ${table(['Step', 'Periods (number:status)', 'What the agent did'], tl)}
        <p class="check ${pr.exactlyOncePerPeriod ? 'ok' : 'bad'}">${pr.exactlyOncePerPeriod ? '✓' : '✗'} <b>The payee holds ${Number(pr.payeeBalances.final) / 1e6} USDC: exactly one payment for each of the three periods.</b> Transfers on chain carrying each reference: ${Object.entries(pr.transfersPerReference).map(([k, n]) => `${esc(k)} → ${n}`).join(', ')}. A transaction that failed on chain moved ${esc(pr.payeeBalances.afterFailureReported === pr.payeeBalances.afterFirstPayment ? 'nothing' : 'something')}; while the payer was short of funds the payee’s balance stayed at ${Number(pr.payeeBalances.whilePayerWasPoor) / 1e6} USDC.</p>
        <h4 class="list-h">Things it refused</h4>
        ${table(['Attempt', 'Result'], fork.guards.map((g) => [esc(g.what), g.refused ? pill('refused', 'ok') + ` <small>${esc(g.message)}</small>` : pill('accepted', 'bad')]))}`;
      wireReplay(body, slug);
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
