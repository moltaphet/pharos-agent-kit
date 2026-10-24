// Natural-Language Payment Agent: content, a live panel (a sentence in, questions or an unsigned transaction out), the recorded demo with Replay, and the fork run that signs the output.
import { api, esc } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { replayButton, wireReplay } from '../panels/replay.js';
import { REPO } from '../consts.js';

// Kept identical to agents/natural-language-payment-agent/examples/requests.json (a test checks it).
export const REQUESTS = [
  {"id": "usdc", "label": "Send 100 USDC to an address", "text": "send 100 USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "thousand", "label": "Amounts like 1.5k work", "text": "pay 1.5k usdc to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "sender-in-text", "label": "The paying wallet written in the sentence", "text": "transfer 25 USDC from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A"},
  {"id": "no-link", "label": "More LINK than the wallet holds", "text": "send 25 LINK to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "no-pros", "label": "PROS from a wallet that holds none", "text": "send 0.5 PROS to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "name", "label": "A name instead of an address (asks)", "text": "send 50 to bob", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "name-answered", "label": "…and the answers to its questions", "text": "send 50 to bob", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f", "answers": {"recipient": "0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "token": "USDC"}},
  {"id": "dollars", "label": "\"Dollars\" is not a token (asks)", "text": "send 100 dollars to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "short-address", "label": "An address with too few characters (asks)", "text": "send 5 USDC to 0x12abc", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "all", "label": "\"All my USDC\" (asks for an exact amount)", "text": "send all my USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "two-amounts", "label": "Two amounts in one sentence (asks)", "text": "send 100 USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A in 2 installments of 50 and 50", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "typo", "label": "A mistyped character in the address (refused)", "text": "send 100 USDC to 0x5A5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "to-token", "label": "Sending USDC to the USDC contract itself (refused)", "text": "send 100 USDC to 0xc879c018db60520f4355c26ed1a6d572cdac1815", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "too-precise", "label": "More decimals than USDC has (refused)", "text": "send 1.1234567 USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
  {"id": "not-a-payment", "label": "Not a payment at all", "text": "what is the price of USDC?", "from": "0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f"},
];
const short = (a) => (a && a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a ?? '');
const TONE = { ready: 'ok', 'needs-info': 'info', blocked: 'bad', refused: 'warn' };
const LEVEL = { pass: ['✓', 'ok'], note: ['·', ''], warn: ['!', 'warn'], fail: ['✗', 'bad'] };

export const content = {
  tagline: 'Turn “send 100 USDC to 0x…” into a checked summary and an unsigned transaction on Pharos. It asks when anything is unclear, and it never signs or sends.',
  tools: ['chain', 'rpc'],
  story: [
    'People say what they want in a sentence: “send 100 USDC to 0x…”. A payment needs more than that to be safe: which token contract, how many decimals, whether the address is real, whether the wallet holds enough, whether the transfer would even go through. This agent does that work and hands back an unsigned transaction. You sign it, or your wallet does.',
    'It reads the amount (including “1.5k”), the token (by name, or by contract address), the recipient and, if you write it, the sender. If anything is missing or could mean two things, it asks, and does not guess: “send 50 to bob” gets two questions (who is bob? which token?), “dollars” is not a token, an address with the wrong number of characters is refused, and so is a mixed-case address whose checksum does not match, a likely typo that would send money to a stranger.',
    'Then it checks the request against Pharos mainnet at one block, through Chain MCP and the public RPC: the token contract exists and says what the Token Registry says, the paying wallet holds enough (and enough PROS for the gas), and the transfer succeeds when simulated as that wallet. It shows a plain-language summary, and the transaction in the forms a wallet takes: a JSON-RPC request, an EIP-681 link, and the exact bytes a signer signs.',
    'It holds no key, so it cannot sign or send. To show the transaction is right, a fork of mainnet takes the agent’s output, signs it with a throwaway key and sends it: the real USDC contract moves exactly the amount, and the hash the agent’s bytes produce is the hash the chain reports.',
  ],
  how: [
    { server: 'local', tool: 'read the sentence', text: 'The amount, the token and the recipient are found by plain rules (no model), and every doubt becomes a question: a missing amount, “dollars”, a name instead of an address, two addresses, two amounts, “all”, an address of the wrong length.' },
    { server: 'chain', tool: 'get_block_number · get_block · get_gas_price', text: 'Pin everything to one block, two behind the head, and read the gas price to cost the transfer.' },
    { server: 'chain', tool: 'Multicall3 eth_call: symbol, decimals, balanceOf, PROS balance', text: 'The token says what it is, and what the paying wallet holds, in one batch that is repeated on the public RPC and compared.' },
    { server: 'chain', tool: 'get_code · eth_call · estimate_gas', text: 'The token address must hold a contract; the transfer is simulated as the paying wallet, and its gas is estimated. A transfer that would revert is refused with the decoded reason.' },
    { server: 'local', tool: 'validate', text: 'EIP-55 checksum of the recipient, the recipient is not the zero address or the token contract, the amount is exact for the token (no rounding of someone’s money), the balance covers the amount and, for PROS, the gas too.' },
    { server: 'local', tool: 'summary and unsigned transaction', text: 'A summary a person can read, then the transaction: to, data, value, gas, chain id; an eth_sendTransaction request; an EIP-681 link; and the RLP bytes with the hash to sign offline.' },
  ],
  decisions: [
    { title: 'It asks instead of guessing', text: 'Every ambiguity is a question with the choices that make sense, and the answers go back in as fields. Nothing is chosen for you: not the token, not the recipient, not which of two numbers is the amount.' },
    { title: 'A mistyped address is caught by its own checksum', text: 'A mixed-case address carries an EIP-55 checksum. If it does not match, the request is blocked and the correct spelling is shown. An all-lowercase address has no checksum, and the check says so instead of pretending it verified anything.' },
    { title: 'Exact money', text: 'Amounts are parsed as exact decimals into the token’s base units. “1.1234567 USDC” is refused (USDC has 6 decimals) rather than rounded.' },
    { title: 'Simulate as the sender', text: 'A balance check is not enough: a token can refuse a transfer for other reasons. The transfer is run as an eth_call from the paying wallet, and refused if it would revert. A contract wallet whose gas is paid by someone else is flagged as a warning, an ordinary account with no PROS as a failure.' },
    { title: 'Several payments in one sentence is a question', text: '“Send 100 USDC in 2 installments of 50 and 50” could mean 100, 50 or two payments. It prepares one payment at a time, so it asks which amount is this payment’s.' },
    { title: 'Proved on a real EVM', text: 'On a fork of mainnet the agent’s unsigned bytes are signed with a throwaway key (using this repository’s own secp256k1 and RLP, checked against cast) and sent. The chain accepts them, the payee’s balance moves by exactly the amount, and the transaction hash matches the one the bytes imply.' },
    { title: 'No key, ever', text: 'The agent has no signing code path at all. The fork run uses a public throwaway key (anvil’s dev account #0), not a key from this project.' },
    { title: 'Names need your address book', text: 'The agent will not resolve a name by itself. You may pass your own contacts (name → address); otherwise it asks for a 0x address.' },
  ],
  evidence: [
    'It parses amount (including 1.5k and 1,250.50), token (by symbol or contract address) and recipient from a sentence, and asks a follow-up when a field is missing or ambiguous: a name, “dollars”, two addresses, two amounts, “all”, a short address.',
    'It validates the recipient (format and EIP-55 checksum, not the zero address or the token contract), the token contract (code present, decimals match the registry) and the balance (token and gas), and simulates the transfer as the sender on Pharos mainnet.',
    'It shows a human-readable summary (what is sent, from where to where, the fee, the balance after) and every check, before the transaction.',
    'It never signs or sends: it holds no key. The output is an unsigned transaction, an eth_sendTransaction request, an EIP-681 link and the hash to sign, and a fork run shows a real EVM accepting those bytes once a throwaway key signs them.',
  ],
  files: ['lib/payments.js', 'lib/address.js', 'lib/rlp.js', 'lib/tasks/natural-language-payment-agent.js', 'agents/natural-language-payment-agent/pharos-pay.js', 'agents/natural-language-payment-agent/examples/requests.json', 'scripts/payments-demo.mjs', 'scripts/payments-fork-run.mjs', 'reports/payments-demo.json', 'reports/payments-fork-run.json'],
  run: {
    commands: ['node agents/natural-language-payment-agent/pharos-pay.js "send 100 USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A" --from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f', '… "send 50 to bob" --from 0x8ecd… --answer recipient=0x5a5A… --answer token=USDC', '… "send 50 to bob" --contact bob=0x5a5A… --from 0x8ecd…   # then only the token is asked', 'node scripts/payments-fork-run.mjs   # sign the output with a throwaway key on a fork (needs Foundry)'],
    sample: `send 100 USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A   (from 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f)

READY · block 21,151,643

  Send 100 USDC from 0x8ecdf4…24ab9f to 0x5a5A5a…5A5A5A on Pharos Pacific Mainnet.
  It is a call to the USDC contract (0xc879c0…ac1815): transfer(0x5a5A5a…5A5A5A, 100000000).
  Network fee: about 0.000957 PROS (79,786 gas at 10 gwei).
  Balance after: 942,842.429833 USDC.
  ✓ The recipient is a well-formed address: mixed-case, and its EIP-55 checksum is correct
  ✓ The sender holds enough USDC: holds 942,942.429833 USDC; after the payment 942,842.429833 USDC
  ✓ The transfer succeeds when simulated as the sender: eth_call succeeds and estimate_gas says 79,786 gas, at block 21,151,643

  UNSIGNED transaction (nothing was signed or sent):
    to 0xc879c018db60520f4355c26ed1a6d572cdac1815
    value 0  gas 95744  chain 1672`,
  },
  verify: [
    { title: 'Check the balance it used', text: 'The demo wallet’s USDC balance on the public RPC.', code: 'cast call 0xc879c018db60520f4355c26ed1a6d572cdac1815 "balanceOf(address)(uint256)" 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --rpc-url https://rpc.pharos.xyz' },
    { title: 'Check an EIP-55 checksum', text: 'The agent’s checksum is Ethereum’s: this should print the address with the same capital letters.', code: 'cast to-check-sum-address 0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a' },
    { title: 'Decode the calldata it prepared', text: 'The unsigned transaction’s data is a plain ERC-20 transfer.', code: 'cast calldata-decode "transfer(address,uint256)" 0xa9059cbb0000000000000000000000005a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0000000000000000000000000000000000000000000000000000000005f5e100' },
    { title: 'See a real EVM accept it', text: 'The fork card shows each output signed with a throwaway key and sent to a fork of mainnet. Run it yourself with Foundry.', code: 'node scripts/payments-fork-run.mjs' },
    { title: 'Replay a recorded request', text: 'In the recorded card press Replay: the request is worked out again at the recorded block and compared with the recording.' },
    { title: 'Read the code', text: 'The engine, the CLI, the examples and the recordings are in the repository.', link: [`${REPO}/tree/main/agents/natural-language-payment-agent`, 'agents/natural-language-payment-agent'] },
  ],
};

// ---- the live panel ----------------------------------------------------------------------------------------------------------------
const ACTOR = { agent: 'Agent', 'chain-mcp': 'Chain MCP', 'public-rpc': 'Public RPC' };
const stepRow = (s) => [s.n, `<span class="tpill ${{ agent: '', 'chain-mcp': 'ok', 'public-rpc': 'warn' }[s.actor]}">${ACTOR[s.actor]}</span>`, s.actor === 'agent' ? `<b><code>${esc(s.name)}</code></b><br><small>${esc(s.summary)}</small>` : `<b><code>${esc(s.name)}</code></b> <small class="muted">${s.ms} ms</small><br><code class="tiny">${esc(s.input)}</code>`];
const checkRows = (checks) => checks.map((c) => [`<span class="${LEVEL[c.level][1]}">${LEVEL[c.level][0]}</span>`, esc(c.name), `<small>${esc(c.detail)}</small>`]);

export function render(r) {
  const u = r.understood ?? {};
  const rows = [['Amount', u.amount ?? '<span class="muted">not given</span>'], ['Token', u.token?.symbol ?? (u.token?.address ? `<code>${esc(short(u.token.address))}</code>` : '<span class="muted">not given</span>')], ['Recipient', u.recipient ? `<code>${esc(u.recipient)}</code>` : '<span class="muted">not given</span>'], ['Paying wallet', u.from ? `<code>${esc(u.from)}</code>` : '<span class="muted">not given</span>']];
  const tx = r.transaction;
  return `
    <div class="verdict ${TONE[r.status]}">${esc(r.status.toUpperCase().replace('-', ' '))}<small>${r.block ? `block ${r.block.number.toLocaleString('en-US')} · ${esc(r.block.iso)} · ` : ''}nothing is signed or sent</small></div>
    ${r.reason ? `<p class="check ${r.status === 'blocked' ? 'bad' : 'warn'}">${esc(r.reason)}</p>` : ''}
    ${(r.notes ?? []).map((n) => `<p class="muted">${esc(n)}</p>`).join('')}
    <h4 class="list-h">What I understood</h4>
    ${table(['', ''], rows)}
    ${r.questions?.length ? `<h4 class="list-h">What I need to know</h4>${r.questions.map((q) => `<p class="check warn"><b>${esc(q.field)}:</b> ${esc(q.question)}</p>${q.options ? `<div class="chips">${q.options.map((o) => `<button type="button" class="chip" data-answer="${esc(q.field)}" data-value="${esc(o)}">${esc(q.field)} = ${esc(String(o).length > 20 ? short(o) : o)}</button>`).join('')}</div>` : ''}`).join('')}<p class="muted">Press an answer, or type it into “Answers” below and run again.</p>` : ''}
    ${r.summary ? `<h4 class="list-h">Summary, before anything is signed</h4><ul class="plain-list">${r.summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${r.checks?.length ? `<h4 class="list-h">Checks</h4>${table(['', 'Check', 'Result'], checkRows(r.checks))}` : ''}
    ${tx ? `<h4 class="list-h">The unsigned transaction</h4>
      ${table(['Field', 'Value'], [['to', `<code>${esc(tx.to)}</code>`], ['data', `<code class="tiny">${esc(tx.data)}</code>`], ['value', esc(tx.value)], ['gas limit', esc(tx.gas)], ['chain id', esc(tx.chainId)], ['EIP-681 link', `<code class="tiny">${esc(r.eip681)}</code>`], ['hash to sign (EIP-155 legacy)', `<code class="tiny">${esc(tx.unsignedRaw.signingHash)}</code>`]])}
      <details><summary>The wallet request (eth_sendTransaction) and the bytes to sign</summary><pre class="plain">${esc(JSON.stringify(tx.walletRequest, null, 2))}</pre><pre class="plain">${esc(tx.unsignedRaw.hex)}</pre></details>
      <p class="muted">${esc(r.neverSent)}</p>` : ''}
    <h4 class="list-h">Who called what, in order</h4>
    ${table(['#', 'Who', 'What'], r.steps.map(stepRow))}
    <p class="muted">${r.chainCalls} Chain MCP calls and ${r.rpcCalls} public RPC calls. Read-only: no key, only reads.</p>`;
}

const livePanel = makePanel({
  intro: 'Write a payment in a sentence and say which wallet pays. The agent checks it on Pharos mainnet and prepares an unsigned transaction, or asks. Nothing is signed or sent.',
  fields: [
    { name: 'text', label: 'What to pay', type: 'text', value: REQUESTS[0].text, grow: true, wide: true, hint: 'For example: send 100 USDC to 0x…' },
    { name: 'from', label: 'Paying wallet', type: 'text', value: REQUESTS[0].from, grow: true, wide: true },
    { name: 'answers', label: 'Answers to its questions (JSON)', type: 'text', optional: true, value: '', hint: 'e.g. {"recipient":"0x…","token":"USDC"}', grow: true },
    { name: 'contacts', label: 'Your address book (JSON)', type: 'text', optional: true, value: '', hint: 'e.g. {"bob":"0x…"}', grow: true },
  ],
  button: 'Prepare the payment',
  examples: REQUESTS.map((r) => ({ label: r.label, values: { text: r.text, from: r.from ?? '', answers: r.answers ? JSON.stringify(r.answers) : '', contacts: '' } })),
  title: (v) => `Pay: ${v.text.slice(0, 60)}`,
  call: (v) => ({ params: { text: v.text, ...(v.from && { from: v.from }), ...(v.answers && { answers: v.answers }), ...(v.contacts && { contacts: v.contacts }) } }),
  decode: ({ payment: r }) => [
    ...r.steps.map((s) => ({ kind: s.actor === 'agent' ? 'decision' : 'decode', title: `${s.n}. ${ACTOR[s.actor]}: ${s.name}`, detail: s.actor === 'agent' ? s.summary : `${s.input} → ${(s.output ?? s.error ?? '').slice(0, 120)}` })),
    { kind: 'decision', ok: r.status === 'ready', title: `${r.status}${r.reason ? `: ${r.reason}` : r.questions?.length ? `: ${r.questions.length} question(s)` : ''}`.slice(0, 140) },
  ],
  summary: ({ payment: r }) => `${r.status} · ${r.chainCalls} Chain MCP + ${r.rpcCalls} RPC calls`,
  verdict: () => 'ok',
  render: ({ payment: r }) => render(r),
});

// ---- the recorded demo with Replay, and the fork run ------------------------------------------------------------------------------------
function mountDemo(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Recorded demo: fifteen real requests on Pharos mainnet, and a real EVM accepting the output</h3><div class="idle" data-role="body">Loading the recording…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { demo, fork } = data;
      body.classList.remove('idle');
      const rows = demo.payments.map((c) => [`<b>${esc(c.label)}</b><br><small class="muted"><code class="tiny">${esc(c.text.length > 70 ? c.text.slice(0, 70) + '…' : c.text)}</code></small>`, pill(c.result.status.replace('-', ' '), TONE[c.result.status]), `<small>${esc(c.result.questions?.[0]?.question ?? c.result.reason ?? c.result.summary?.[0] ?? '')}</small>`, replayButton(c.id)]);
      const fr = fork.cases.filter((c) => c.task === 17).map((c) => [esc(c.label), `<code class="tiny">${esc(short(c.sent.hash))}</code>`, pill(c.sent.status, c.sent.status === 'success' ? 'ok' : 'bad'), c.exact ? pill(`payee +${c.payeeBalanceChange}`, 'ok') : pill('differs', 'bad'), c.hashMatches ? pill('hash matches', 'ok') : pill('hash differs', 'bad')]);
      body.innerHTML = `
        <p class="muted">Recorded ${esc(demo.recordedAt.slice(0, 10))}, all at block ${demo.payments[0].block.toLocaleString('en-US')}. Replay works the request out again at that block and compares the understanding, the checks and the transaction with the recording.</p>
        ${table(['Request', 'Verdict', 'What it said', ''], rows)}
        <h4 class="list-h">The output, signed and sent on a fork of mainnet</h4>
        <p class="muted">The agent’s unsigned bytes were signed with a throwaway key (anvil’s public dev account) and sent with eth_sendRawTransaction to a fork of Pharos mainnet at the live USDC contract. A wrong byte would have been refused, or the balances would not have moved by exactly the amount.</p>
        ${table(['Case', 'Transaction', 'Mined', 'Payee’s balance', 'Hash'], fr)}`;
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
  const stop = livePanel(root.querySelector('[data-slot=live]'), ctx);
  // a question's answer buttons fill the “Answers” field and run again
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-answer]');
    if (!b) return;
    const field = root.querySelector('#f-answers');
    let cur = {};
    try { cur = field.value ? JSON.parse(field.value) : {}; } catch { cur = {}; }
    cur[b.dataset.answer] = b.dataset.value;
    field.value = JSON.stringify(cur);
    root.querySelector('#go').click();
  });
  return stop;
}
