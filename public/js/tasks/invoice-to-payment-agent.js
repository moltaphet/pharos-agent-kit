// Invoice-to-Payment Agent: content, a live panel (paste an invoice, get flags or an unsigned payment with the invoice's reference), sample invoices, the recorded demo with Replay, and the fork run.
import { api, esc } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { replayButton, wireReplay } from '../panels/replay.js';
import { REPO } from '../consts.js';

// Kept identical to agents/invoice-to-payment-agent/examples/invoices.json (a test checks it).
export const INVOICES = [
  {"id": "text-usdc", "label": "A plain-text invoice in USDC", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "INVOICE #INV-2026-0042\nDate: 2026-10-20\nDue: 2027-11-19\nFrom: Harbor Studio Ltd\nPay to: 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A\n\nBrand sprint – 2 x 100.00 USDC\nDomain and hosting – 40.00 USDC\nSubtotal: 240.00 USDC\nTax: 10.00 USDC\nTotal due: 250.00 USDC"},
  {"id": "json-usdc", "label": "The same kind of invoice as JSON", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "{\n  \"invoice\": {\n    \"id\": \"2026-117\",\n    \"issued\": \"2026-10-21\",\n    \"due\": \"2027-12-01\",\n    \"payee\": {\n      \"name\": \"Nova Audio\",\n      \"address\": \"0x7B7b7b7b7B7B7B7b7b7b7B7B7b7b7b7B7b7B7B01\"\n    },\n    \"currency\": \"USDC\",\n    \"items\": [\n      {\n        \"description\": \"Mixing, 3 tracks\",\n        \"quantity\": 3,\n        \"unitPrice\": \"300.00\"\n      },\n      {\n        \"description\": \"Mastering\",\n        \"quantity\": 1,\n        \"unitPrice\": \"300.50\"\n      }\n    ],\n    \"total\": \"1200.50\"\n  },\n  \"payment\": {\n    \"chainId\": 1672,\n    \"token\": \"0xc879c018db60520f4355c26ed1a6d572cdac1815\"\n  }\n}"},
  {"id": "link-usdc", "label": "An ethereum: payment link (EIP-681)", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "ethereum:0xc879c018db60520f4355c26ed1a6d572cdac1815@1672/transfer?address=0x3C3C3C3C3c3C3c3C3C3C3C3C3c3c3c3c3c3c3c3C&uint256=75000000&ref=ORD-88123"},
  {"id": "wrong-total", "label": "An invoice that does not add up", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "INVOICE #INV-2026-0043\nDue: 2027-11-19\nFrom: Harbor Studio Ltd\nPay to: 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A\n\nBrand sprint – 2 x 100.00 USDC\nDomain and hosting – 40.00 USDC\nSubtotal: 240.00 USDC\nTax: 10.00 USDC\nTotal due: 205.00 USDC"},
  {"id": "no-address", "label": "An invoice with no wallet address", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "INVOICE #INV-2026-0044\nDue: 2027-11-19\nFrom: Harbor Studio Ltd\nPay to: Harbor Studio, account 4471 0902\nTotal due: 90.00 USDC"},
  {"id": "fake-usdc", "label": "An invoice that names a look-alike USDC contract", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "{\"invoice\":{\"id\":\"INV-9001\",\"payee\":{\"name\":\"Quick Supplies\",\"address\":\"0x3C3C3C3C3c3C3c3C3C3C3C3C3c3c3c3c3c3c3c3C\"},\"currency\":\"USDC\",\"total\":\"500.00\"},\"payment\":{\"chainId\":1672,\"token\":\"0xdEDEDEDEdEdEdEDedEDeDedEdEdeDedEdEDedEdE\"}}"},
  {"id": "usd-no-token", "label": "An invoice in US dollars, no token chosen", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "Invoice number: BX-5521\nDue: 2027-12-15\nFrom: Blue Ox Consulting\nWallet: 0x7B7b7b7b7B7B7B7b7b7b7B7B7b7b7b7B7b7B7B01\nTotal due: $1,250.00"},
  {"id": "usd-in-usdc", "label": "The same invoice, paying in USDC", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "payIn": "USDC", "text": "Invoice number: BX-5521\nDue: 2027-12-15\nFrom: Blue Ox Consulting\nWallet: 0x7B7b7b7b7B7B7B7b7b7b7B7B7b7b7b7B7b7B7B01\nTotal due: $1,250.00"},
  {"id": "euro", "label": "An invoice in euros", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "INVOICE EU-2210\nDue: 2027-12-15\nPay to: 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A\nTotal due: 480.00 EUR"},
  {"id": "typo-address", "label": "An invoice whose address has a mistyped character", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "text": "INVOICE #INV-2026-0045\nDue: 2027-11-19\nPay to: 0x5A5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A\nTotal due: 60.00 USDC"},
];
const short = (a) => (a && a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a ?? '');
const TONE = { ready: 'ok', 'ready-with-warnings': 'warn', blocked: 'bad', 'needs-info': 'info' };
const SEV = { error: ['✗', 'bad'], warn: ['!', 'warn'], info: ['·', ''] };
const LEVEL = { pass: ['✓', 'ok'], note: ['·', ''], warn: ['!', 'warn'], fail: ['✗', 'bad'] };

export const content = {
  tagline: 'Read an invoice, flag what is missing or does not add up instead of guessing, and prepare the matching payment as an unsigned transaction that carries the invoice’s reference.',
  tools: ['chain', 'rpc'],
  story: [
    'Paying an invoice by hand means copying an address and an amount from a document: the places where mistakes and fraud live. This agent reads the invoice, checks it against itself and against the chain, and only then prepares a payment. It reads three formats: plain text (labelled lines), JSON, and an ethereum: payment link (EIP-681).',
    'It does not guess. A missing reference, a name where an address should be, an address whose checksum is wrong (a typo), two different addresses on one invoice, a total that disagrees with the line items, a currency it cannot convert (euros), a token that is called USDC but whose contract is not the USDC on Pharos, a payment for another chain: each is a flag, and a flag that is an error means no transaction is prepared. An invoice in US dollars with no token chosen is not paid in a token of the agent’s choosing: you say USDC, and it warns that this treats 1 USDC as 1 USD.',
    'When the invoice holds up, it checks the payment against Pharos mainnet exactly as the Natural-Language Payment Agent does (the token contract, the balance, the simulation as the paying wallet) and prepares an unsigned transaction. The invoice’s reference is written into the transaction data after the transfer, so the payment can be matched to the invoice on chain, by the payee or by anyone: the fork run reads each reference back from a mined transaction.',
    'The demo is ten sample invoices of the three formats, three that are payable and seven that are not, each for a different reason. All were worked out on real mainnet state, and three were paid on a fork with a throwaway key: the amounts moved exactly and the references can be read on chain.',
  ],
  how: [
    { server: 'local', tool: 'detect and read the format', text: 'JSON, an ethereum: link, or plain text with labelled lines (invoice number, pay to, due, subtotal, tax, discount, total, line items). Nothing is read by a model: the same invoice always gives the same reading.' },
    { server: 'local', tool: 'check the invoice against itself', text: 'Reference present and plain; one pay-to address, well-formed, with its EIP-55 checksum; one total (all stated totals equal); line items plus tax minus discount equal the total; currency and token agree; the chain is Pharos.' },
    { server: 'local', tool: 'decide the token', text: 'A token symbol or contract named by the invoice must be one the Token Registry knows and must match. USD needs the payer to say USDC; other currencies cannot be converted (no rate source), so they stop here.' },
    { server: 'chain', tool: 'get_block_number · get_gas_price · Multicall3 · get_code', text: 'Pin to a block; read the token and the paying wallet’s balances in a batch repeated on the public RPC; check the token has code.' },
    { server: 'chain', tool: 'eth_call · estimate_gas', text: 'Simulate the payment as the paying wallet, with the reference appended to the transfer’s data.' },
    { server: 'local', tool: 'summary and unsigned transaction', text: 'A payment summary naming the invoice, the payee, the amount and the due date; then the transaction, the wallet request, the EIP-681 link and the hash to sign. Nothing is signed or sent.' },
  ],
  decisions: [
    { title: 'A flag is better than a guess', text: 'Every doubt is a named flag with a sentence: “missing-reference”, “checksum”, “several-addresses”, “total-mismatch”, “token-mismatch”, “no-conversion”. Errors stop the payment; warnings are shown with the transaction.' },
    { title: 'Two addresses on one invoice is an error', text: 'Redirecting a payment is done by putting a second address in a document. If the invoice names an address beside the pay-to one, it is not paid until the issuer confirms which is right.' },
    { title: 'A look-alike token is not USDC', text: 'An invoice that says USDC but names a different contract is refused, naming the real USDC contract. Paying a look-alike pays nothing.' },
    { title: 'No exchange rates, no guesses', text: 'The agent has no price source for euros or pounds and will not invent one. For dollars it asks you to choose the token, and says that 1 USDC is treated as 1 USD.' },
    { title: 'The reference is on chain', text: 'The invoice reference follows the transfer’s arguments in the calldata. Token contracts ignore trailing bytes, so the transfer is the same, and the fork run reads each reference back from the mined transaction.' },
    { title: 'The arithmetic is exact', text: 'Totals are checked in exact decimals (line items, tax and discount), not floating point, so 0.1 + 0.2 never makes an invoice “not add up”, and 205.00 against 250.00 always does.' },
    { title: 'Dates are judged against a fixed day', text: 'Whether an invoice is overdue depends on “today”, so the recording stores the day it used and a replay uses the same one.' },
    { title: 'No key', text: 'The output is an unsigned transaction. The fork run signs with a public throwaway key to show a real EVM accepts the bytes.' },
  ],
  evidence: [
    'It extracts the payee, amount, token or currency and reference from three formats: plain text, JSON and an ethereum: payment link (EIP-681).',
    'It flags instead of guessing: a missing reference or payee, a name instead of an address, a wrong checksum, a second address, totals that disagree or do not add up, a look-alike token, a currency it cannot convert, the wrong chain, an overdue date.',
    'It produces a payment summary and an unsigned transaction whose data carries the invoice reference after the transfer; on a fork the reference was read back from the mined transaction for each of three invoices.',
    'The demo has ten sample invoices of the three formats: three payable, one payable with a warning, six refused, each for a named reason, and each recorded on real Pharos mainnet state and replayable.',
  ],
  files: ['lib/invoice.js', 'lib/payments.js', 'lib/address.js', 'lib/tasks/invoice-to-payment-agent.js', 'agents/invoice-to-payment-agent/pharos-invoice.js', 'agents/invoice-to-payment-agent/examples/invoices.json', 'scripts/payments-demo.mjs', 'scripts/payments-fork-run.mjs', 'reports/payments-demo.json', 'reports/payments-fork-run.json'],
  run: {
    commands: ['node agents/invoice-to-payment-agent/pharos-invoice.js invoice.txt --from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f', '… invoice.json --from 0x8ecd… --pay-in USDC   # an invoice in dollars: you choose the token', 'node scripts/payments-fork-run.mjs   # sign the output with a throwaway key on a fork (needs Foundry)'],
    sample: `INVOICE #INV-2026-0043
Due: 2027-11-19
From: Harbor Studio Ltd
Pay to: 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A

Brand sprint – 2 x 100.00 USDC
Domain and hosting – 40.00 USDC
Subtotal: 240.00 USDC
Tax: 10.00 USDC
Total due: 205.00 USDC

BLOCKED · text invoice INV-2026-0043
  ✗ [total-mismatch] The invoice does not add up: subtotal 240.00 + tax 10.00 = 250.00, but the total says 205.00.`,
  },
  verify: [
    { title: 'Read a reference off the chain', text: 'The fork card lists each mined transaction; the reference is the text after the 68 bytes of the transfer.', code: 'cast tx <hash> input | cut -c139- | xxd -r -p' },
    { title: 'Check an address checksum', text: 'The “typo” invoice’s address fails EIP-55: this prints the correct spelling.', code: 'cast to-check-sum-address 0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a' },
    { title: 'See the real USDC contract', text: 'The look-alike invoice is refused because the real USDC on Pharos is this contract.', code: 'cast call 0xc879c018db60520f4355c26ed1a6d572cdac1815 "symbol()(string)" --rpc-url https://rpc.pharos.xyz' },
    { title: 'Replay a recorded invoice', text: 'In the recorded card press Replay: the invoice is read again at the recorded block and the flags, the checks and the transaction are compared.' },
    { title: 'Read the code', text: 'The parser, the CLI, the sample invoices and the recordings are in the repository.', link: [`${REPO}/tree/main/agents/invoice-to-payment-agent`, 'agents/invoice-to-payment-agent'] },
  ],
};

const ACTOR = { agent: 'Agent', 'chain-mcp': 'Chain MCP', 'public-rpc': 'Public RPC' };
const stepRow = (s) => [s.n, `<span class="tpill ${{ agent: '', 'chain-mcp': 'ok', 'public-rpc': 'warn' }[s.actor]}">${ACTOR[s.actor]}</span>`, s.actor === 'agent' ? `<b><code>${esc(s.name)}</code></b><br><small>${esc(s.summary)}</small>` : `<b><code>${esc(s.name)}</code></b> <small class="muted">${s.ms} ms</small><br><code class="tiny">${esc(s.input)}</code>`];

export function render(r) {
  const inv = r.invoice;
  const tx = r.transaction;
  return `
    <div class="verdict ${TONE[r.status]}">${esc(r.status.toUpperCase().replace(/-/g, ' '))}<small>${esc(inv.format)} invoice${inv.reference ? ` ${esc(inv.reference)}` : ''}${r.block ? ` · block ${r.block.number.toLocaleString('en-US')}` : ''} · nothing is signed or sent</small></div>
    ${r.reason ? `<p class="check bad">${esc(r.reason)}</p>` : ''}
    <h4 class="list-h">What the invoice says</h4>
    ${table(['', ''], [['Reference', inv.reference ? `<code>${esc(inv.reference)}</code>` : '<span class="muted">missing</span>'], ['Payee', inv.payee.address ? `<code>${esc(inv.payee.address)}</code>${inv.payee.name ? `<br><small class="muted">${esc(inv.payee.name)}</small>` : ''}` : '<span class="muted">no address</span>'], ['Amount', inv.amount ? `${esc(inv.amount.base ? inv.amount.raw + ' base units' : inv.amount.text)} ${esc(inv.currency ?? '')}` : '<span class="muted">none</span>'], ['Token', inv.token ? (inv.token.symbol ?? `<code>${esc(short(inv.token.address))}</code>`) + (inv.token.custom ? ' (not in the registry)' : '') : '<span class="muted">not decided</span>'], ['Due', esc(inv.due ?? 'not stated')]])}
    ${r.flags.length ? `<h4 class="list-h">Flags</h4>${table(['', 'Flag', 'What it means'], r.flags.map((f) => [`<span class="${SEV[f.severity][1]}">${SEV[f.severity][0]}</span>`, `<code>${esc(f.code)}</code>`, esc(f.message)]))}` : '<p class="check ok">✓ No flags: the invoice is complete and consistent.</p>'}
    ${r.questions?.length ? r.questions.map((q) => `<p class="check warn">${esc(q.question)}</p>`).join('') : ''}
    ${r.summary ? `<h4 class="list-h">Payment summary</h4><ul class="plain-list">${r.summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${r.checks?.length ? `<h4 class="list-h">Checks on Pharos mainnet</h4>${table(['', 'Check', 'Result'], r.checks.map((c) => [`<span class="${LEVEL[c.level][1]}">${LEVEL[c.level][0]}</span>`, esc(c.name), `<small>${esc(c.detail)}</small>`]))}` : ''}
    ${tx ? `<h4 class="list-h">The unsigned transaction, carrying the reference</h4>${table(['Field', 'Value'], [['to', `<code>${esc(tx.to)}</code>`], ['data', `<code class="tiny">${esc(tx.data)}</code>`], ['reference in the data', `<code>${esc(inv.reference)}</code>`], ['gas limit', esc(tx.gas)], ['chain id', esc(tx.chainId)], ['EIP-681 link', `<code class="tiny">${esc(r.eip681)}</code>`], ['hash to sign', `<code class="tiny">${esc(tx.unsignedRaw.signingHash)}</code>`]])}<p class="muted">${esc(r.neverSent)}</p>` : ''}
    <h4 class="list-h">Who called what, in order</h4>
    ${table(['#', 'Who', 'What'], r.steps.map(stepRow))}
    <p class="muted">${r.chainCalls} Chain MCP calls and ${r.rpcCalls} public RPC calls. Read-only: no key, only reads.</p>`;
}

const livePanel = makePanel({
  intro: 'Paste an invoice (plain text, JSON or an ethereum: link) and say which wallet pays. It flags what is wrong, or prepares an unsigned payment that carries the invoice’s reference. Nothing is signed or sent.',
  fields: [
    { name: 'invoice', label: 'Invoice', type: 'textarea', rows: 12, value: INVOICES[0].text, wide: true, grow: true },
    { name: 'from', label: 'Paying wallet', type: 'text', value: INVOICES[0].from, grow: true, wide: true },
    { name: 'payIn', label: 'Pay in (for an invoice in dollars)', type: 'select', options: [['', 'as the invoice says'], ['USDC', 'USDC']], value: '' },
  ],
  button: 'Prepare the payment',
  examples: INVOICES.map((i) => ({ label: i.label, values: { invoice: i.text, from: i.from, payIn: i.payIn ?? '' } })),
  title: (v) => `Invoice: ${v.invoice.split('\n')[0].slice(0, 50)}`,
  call: (v) => ({ body: { invoice: v.invoice, from: v.from, ...(v.payIn && { payIn: v.payIn }) } }),
  decode: ({ payment: r }) => [
    ...r.steps.map((s) => ({ kind: s.actor === 'agent' ? 'decision' : 'decode', title: `${s.n}. ${ACTOR[s.actor]}: ${s.name}`, detail: s.actor === 'agent' ? s.summary : `${s.input} → ${(s.output ?? s.error ?? '').slice(0, 120)}` })),
    ...r.flags.filter((f) => f.severity !== 'info').map((f) => ({ kind: 'decision', ok: false, title: `${f.severity}: ${f.code}`, detail: f.message })),
    { kind: 'decision', ok: r.status.startsWith('ready'), title: `${r.status}${r.reason ? `: ${r.reason}` : ''}`.slice(0, 140) },
  ],
  summary: ({ payment: r }) => `${r.status} · ${r.flags.filter((f) => f.severity === 'error').length} error flags · ${r.chainCalls} Chain MCP + ${r.rpcCalls} RPC calls`,
  render: ({ payment: r }) => render(r),
});

function mountDemo(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Recorded demo: ten sample invoices on Pharos mainnet, and three paid on a fork</h3><div class="idle" data-role="body">Loading the recording…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { demo, fork } = data;
      body.classList.remove('idle');
      const rows = demo.invoices.map((c) => [`<b>${esc(c.label)}</b><br><small class="muted">${esc(c.result.format)} · ${esc(c.result.invoice.reference ?? 'no reference')}</small>`, pill(c.result.status.replace(/-/g, ' '), TONE[c.result.status]), `<small>${esc(c.result.flags.find((f) => f.severity !== 'info')?.message ?? c.result.summary?.[0] ?? '')}</small>`, replayButton(c.id)]);
      const fr = fork.cases.filter((c) => c.task === 19).map((c) => [esc(c.label), `<code>${esc(c.referenceOnChain)}</code>`, `<code class="tiny">${esc(short(c.sent.hash))}</code>`, c.exact ? pill(`payee +${Number(c.payeeBalanceChange) / 1e6} USDC`, 'ok') : pill('differs', 'bad'), c.referenceMatches ? pill('reference read back', 'ok') : pill('differs', 'bad')]);
      body.innerHTML = `
        <p class="muted">Recorded ${esc(demo.recordedAt.slice(0, 10))}, all at block ${demo.invoices[0].block.toLocaleString('en-US')}, judging due dates against ${esc(new Date(demo.invoices[0].now).toISOString().slice(0, 10))}. Replay reads the invoice again at that block and compares the flags, the checks and the transaction.</p>
        ${table(['Invoice', 'Verdict', 'What it said', ''], rows)}
        <h4 class="list-h">Three payable invoices, paid on a fork of mainnet</h4>
        <p class="muted">The unsigned transaction was signed with a throwaway key and sent to a fork of Pharos mainnet at the live USDC contract. The reference was then read back from the mined transaction’s data.</p>
        ${table(['Invoice', 'Reference on chain', 'Transaction', 'Payee’s balance', ''], fr)}`;
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
