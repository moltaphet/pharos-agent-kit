// Docs MCP + Chain MCP Agent: content, a live panel that shows what the docs said and what the chain said side by side, and the recorded demo with Replay.
import { api, esc, md } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

// Kept identical to agents/docs-chain-mcp-agent/examples/cases.json (a test checks it).
export const CASES = [
  { id: 'btc-feed', label: 'BTC/USD price feed: latestAnswer()', contract: '0x8b5db228fbccf588f08b073c235254acb6791d36', function: 'latestAnswer()(int256)', args: [], block: 21100000 },
  { id: 'pros-feed', label: 'PROS/USD price feed: the same function on another contract', contract: '0x371ed36aee5bffbed1a2aa9b7ded7f4eb30f5466', function: 'latestAnswer()(int256)', args: [], block: 21100000 },
  { id: 'usdc-supply', label: 'USDC: totalSupply()', contract: '0xc879c018db60520f4355c26ed1a6d572cdac1815', function: 'totalSupply()(uint256)', args: [], block: 21100000 },
  { id: 'wpros-balance', label: 'WPROS: balanceOf(address), a function with an argument (the FaroSwap V2 pair)', contract: '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0', function: 'balanceOf(address)(uint256)', args: ['0xb7d5d299c671e4a4c7c0c5a33b812185182fc417'], block: 21100000 },
  { id: 'pair-token0', label: 'A FaroSwap V2 pair: token0(), which the docs do not cover', contract: '0xb7d5d299c671e4a4c7c0c5a33b812185182fc417', function: 'token0()(address)', args: [], block: 21100000 },
];

export const content = {
  tagline: 'Give it a contract function: it asks the docs what it means, calls it on chain, and reads the answer the way the docs say, checking the docs against the chain.',
  tools: ['docs', 'chain'],
  skill: false,
  story: [
    'Raw contract values mean nothing without their context. A price feed returns 80683130407437730000000. Is that dollars, cents, 18 decimals, 8? This agent finds out the way a careful developer would. It asks Developer Docs MCP what the function does, what it returns and what to check, and it keeps the answer with its sources. Then it calls the same function on Pharos mainnet through Chain MCP, at one pinned block, and reads the number the way the explanation says: divide by 10^18, so 80,683.13 BTC/USD.',
    'The two servers are composed, not run one after the other. The explanation decides which extra Chain MCP calls are made. If the docs state a scale, the agent asks the contract for its own decimals() to confirm it. If the docs say to check freshness with latestTimestamp(), the agent calls that too and reports how old the price is. And the chain can contradict the docs: if the stated scale differs from decimals(), the agent says so and trusts the chain.',
    'It is honest about what the docs do not know. A function the documentation does not cover is shown as the raw value with no invented meaning, and an answer that hedges (“if this is a Uniswap pair…”, “I can’t confirm this contract”) is shown but never applied. The recorded demo has five real functions on five real contracts: four explained and applied, one the docs do not cover.',
  ],
  how: [
    { server: 'local', tool: 'parse the function', text: 'A signature written like cast (latestAnswer()(int256), balanceOf(address)(uint256)). The selector is computed with a built-in Keccak-256, checked against cast, and the arguments are encoded and type-checked.' },
    { server: 'chain', tool: 'get_block_number · get_block · get_code', text: 'Pin everything to one block, take its time as “now”, and make sure the address really is a contract before asking the docs anything.' },
    { server: 'docs', tool: 'askQuestion · searchDocumentation', text: 'What does this function do on this contract, what are the units, what should be checked? The answer must name the function or the address and link a docs page; a refusal or a hedged answer is not treated as documentation.' },
    { server: 'local', tool: 'read the explanation', text: 'The scale it states (“divide by 10^18”, “6 decimal places”), the unit (“BTC/USD price”), and the checks it asks for (“call decimals()”, “check latestTimestamp()”). Contradictory scales are reported, not guessed.' },
    { server: 'chain', tool: 'eth_call the function', text: 'The real value at the pinned block, repeated on the public RPC to confirm it, and decoded by its declared type; wrong-shaped data is refused instead of printed as nonsense.' },
    { server: 'chain', tool: 'eth_call the follow-ups the docs asked for', text: 'Only from a fixed list of harmless reads (decimals(), latestTimestamp()), and only when the explanation points at them.' },
    { server: 'local', tool: 'interpret', text: 'The raw value scaled the way the docs say, cross-checked against decimals(), with the unit and the age of the data. The step list shows which earlier steps each conclusion used.' },
  ],
  decisions: [
    { title: 'The explanation drives the calls, and the chain can overrule it', text: 'Which follow-up calls happen depends on what the docs said, and what the docs said is checked against what the contract says. When they disagree the agent reports the conflict and uses the contract’s own decimals().' },
    { title: 'An answer is documentation only if the docs list the contract', text: 'Docs MCP always produces an answer, even when it only knows the topic in general (for a Uniswap-style pair it wrote “token0() is typically a pair contract’s getter…” with a link to an unrelated tutorial). Phrase-matching such hedges failed three times, each time on a new wording. So the test is objective: a documentation search for the contract’s ADDRESS must find a page that contains it. The price feeds, USDC and WPROS are listed (in the feeds page and the Token Registry); the FaroSwap pair is not, so its answer is kept as general information and nothing in it is applied to the value.' },
    { title: 'Two bugs that only real runs showed', text: 'The first version reused the Doc-Search test (the question’s words must appear in search snippets), which rejected a correct answer about a price feed because snippets rarely contain an address. And “divide by 10^decimals” was read as “divide by 10^1”. The test now looks at the answer itself, and a number must stand alone to count as a scale. Both have tests built from the real wording.' },
    { title: 'A hedge detector that is not too eager', text: 'An early version treated “the registry doesn’t list decimals” as a hedge and threw away a good answer about USDC. That sentence is the documentation saying something. Only phrases that say the model cannot confirm the contract count.' },
    { title: 'Only harmless follow-ups', text: 'An explanation can name any function. The agent only follows decimals() and latestTimestamp(), and every call it makes is an eth_call, a read. Nothing is signed or sent.' },
    { title: 'Every read is confirmed, because Chain MCP once answered wrongly', text: 'The hosted Chain MCP is load-balanced. While recording the demo one backend answered a block-pinned call with the wrong state: 81,587 for a price that was 80,683 at that block, and the next ten calls were right. So every eth_call (the function and each follow-up) is repeated on the public RPC. If they differ, Chain MCP is asked again and the two that agree win; if nothing settles it, the run stops and reports no value. If the public RPC cannot answer, the read is kept but marked unconfirmed.' },
    { title: 'A pinned block, and what replays', text: 'Every case is read at one block, so the chain’s side repeats exactly. The explanation is generated afresh by Docs MCP, so Replay compares the chain’s answers (the calls both runs made), not the wording.' },
    { title: 'Its own Keccak-256', text: 'To call any function by its signature the agent needs the selector. A small Keccak-256 is built in (no dependency) and tested against published vectors and `cast sig` across block boundaries.' },
  ],
  evidence: [
    'The explanation comes from Developer Docs MCP (askQuestion) and is shown in full with its sources marked cited or related; it counts as documentation only if a documentation search for the contract’s address finds a page that lists it, and the answer names the function and links a docs page.',
    'The agent then calls the same function on chain through Chain MCP (eth_call at one pinned block, repeated on the public RPC to confirm it), built from the signature you give, and decodes the result by its declared type.',
    'It interprets the value in the context of the explanation: it applies the scale the docs state, confirms it against the contract’s decimals(), reads the unit and the freshness the docs ask about, and reports a conflict if the docs and the chain disagree.',
    'It works for different functions and contracts: five recorded real cases (two price feeds with the same function, USDC totalSupply(), WPROS balanceOf(address), a pair’s token0()), four explained and applied and one the docs do not cover, shown raw.',
  ],
  files: ['lib/docs-chain.js', 'lib/abi-call.js', 'lib/keccak.js', 'lib/docs.js', 'lib/tasks/docs-chain-mcp-agent.js', 'scripts/docs-chain-demo.mjs', 'reports/docs-chain-demo.json', 'agents/docs-chain-mcp-agent/pharos-explain.js', 'agents/docs-chain-mcp-agent/examples/cases.json'],
  run: {
    commands: ['node agents/docs-chain-mcp-agent/pharos-explain.js --contract 0x371ed36aee5bffbed1a2aa9b7ded7f4eb30f5466 --function "latestAnswer()(int256)"', 'node agents/docs-chain-mcp-agent/pharos-explain.js --contract 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 --function "balanceOf(address)(uint256)" --arg 0xb7d5d299c671e4a4c7c0c5a33b812185182fc417', '… --block 21100000   # repeat a recorded run on the same block'],
    sample: `latestAnswer() on 0x371ed36aee5bffbed1a2aa9b7ded7f4eb30f5466
block 21,110,xxx · sat 2026-10-24 10:10 UTC

 8  AGENT      read-explanation     The docs explain latestAnswer() (1 cited page). Scale stated: 10^18; unit: PROS/USD; follow-up calls it asks for: decimals.
 9  CHAIN MCP  eth_call             latestAnswer()  →  645560037162381300
12  AGENT      follow-up decimals   the explanation states a scale (18 decimals), so the contract's own decimals() is asked to confirm it. decimals() = 18.
15  AGENT      interpret            … Read the way the docs say (docs and chain agree), that is 0.6455600371 (PROS/USD).

EXPLAINED AND CALLED: the docs’ explanation was applied to the live value

What the docs say:
  latestAnswer() reads the latest PROS/USD price from this Pacific Mainnet feed. It returns one signed int256 value, scaled to 18 decimals: divide the raw result by 10^18 to get USD per PROS.
Sources
  1. Chainlink Push Engine Feeds  (cited in the answer)

✓ the documented scale matches the contract’s decimals(): the docs say 10^18 and the contract says decimals() = 18`,
  },
  verify: [
    { title: 'Check the value yourself', text: 'The BTC/USD feed read at the recorded block, straight from the public RPC. It should return 80683130407437730000000, i.e. 80,683.13 with 18 decimals.', code: 'cast call 0x8b5DB228Fbccf588f08B073C235254aCb6791D36 "latestAnswer()(int256)" --block 21100000 --rpc-url https://rpc.pharos.xyz' },
    { title: 'Check the decimals the docs state', text: 'The agent applies a scale only after the contract confirms it. You can ask the same contract.', code: 'cast call 0x8b5DB228Fbccf588f08B073C235254aCb6791D36 "decimals()(uint8)" --rpc-url https://rpc.pharos.xyz' },
    { title: 'Check the selector it computed', text: 'The built-in Keccak-256 gives the same selector as Foundry.', code: 'cast sig "latestAnswer()"   # 0x50d25bcd' },
    { title: 'Read the explanation at its source', text: 'The page the explanation cites for the price feeds.', link: ['https://docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe', 'Chainlink Push Engine Feeds (Pharos docs)'] },
    { title: 'Replay a recorded case', text: 'In the recorded demo card on this page press Replay: the agent runs again at the recorded block and reports how many Chain MCP answers match the recording.' },
    { title: 'Read the code', text: 'The agent, its ABI helpers and the tests are in the repository.', link: [`${REPO}/tree/main/agents/docs-chain-mcp-agent`, 'agents/docs-chain-mcp-agent'] },
  ],
};

// ---- the live panel ----------------------------------------------------------------------------------------------------------------------
const TONE = { explained: 'ok', 'general-only': 'warn', unexplained: 'warn', stop: 'bad' };
const short = (a) => (a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a);
const uses = (s) => (s.uses?.length ? `<small class="muted">uses ${s.uses.map((u) => `#${u}`).join(' ')}</small>` : '');
const ACTOR = { agent: 'Agent', 'docs-mcp': 'Docs MCP', 'chain-mcp': 'Chain MCP', 'public-rpc': 'Public RPC' };
const stepRow = (s) => {
  const body = s.actor === 'agent'
    ? `<b><code>${esc(s.name)}</code></b><br><small>${esc(s.summary)}</small> ${uses(s)}`
    : `<b><code>${esc(s.name)}</code></b> <small class="muted">${s.ms} ms</small><br><small class="muted">in</small> <code class="tiny">${esc(s.input)}</code><br><small class="muted">out</small> <code class="tiny">${esc(s.error ? `ERROR ${s.error}` : s.output)}</code>`;
  return [s.n, `<span class="tpill ${{ agent: '', 'docs-mcp': 'info', 'chain-mcp': 'ok', 'public-rpc': 'warn' }[s.actor]}">${ACTOR[s.actor]}</span>`, body];
};
const sourceLine = (s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> ${s.cited ? pill('cited in the answer', 'ok') : '<small class="muted">related</small>'}</li>`;

function result(a) {
  const v = a.verdict;
  const ex = a.explanation;
  const i = a.interpretation;
  if (!ex) return `<div class="verdict bad">${esc(v.headline)}<small>${esc(v.reason)}</small></div>${table(['#', 'Who', 'What'], a.steps.map(stepRow))}`;
  return `
    <div class="verdict ${TONE[v.status] ?? 'info'}">${esc(v.headline)}<small>${esc(a.request.signature)} on ${esc(short(a.request.contract))} · block ${a.block.number.toLocaleString('en-US')} · ${esc(a.block.iso)}</small></div>
    <div class="two-col">
      <section class="card"><h4 class="list-h">What the docs said ${ex.kind === 'documented' ? pill('applied', 'ok') : ex.kind === 'general' ? pill('general only, not applied', 'warn') : pill('nothing', 'warn')}</h4>
        ${ex.text ? `<div class="answer">${md(ex.text)}</div>` : `<p class="muted">${esc(ex.reason)}</p>`}
        ${ex.sources?.length ? `<ul class="plain-list">${ex.sources.map(sourceLine).join('')}</ul>` : ''}
        ${ex.listedIn?.length ? `<p class="muted">The docs list this address in: ${ex.listedIn.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`).join(', ')}.</p>` : '<p class="muted">No page of the docs lists this address.</p>'}
        ${ex.kind !== 'documented' && ex.reason ? `<p class="check warn">${esc(ex.reason)}</p>` : ''}</section>
      <section class="card"><h4 class="list-h">What the chain said</h4>
        <p><code>${esc(a.request.signature)}</code> returned <code>${esc(a.call?.values?.map((x) => x.text).join(', ') ?? '–')}</code>${a.request.args.length ? `<br><small class="muted">with ${a.request.args.map((x) => `<code>${esc(short(x))}</code>`).join(', ')}</small>` : ''}</p>
        ${a.followUps?.length ? `<p class="muted">Follow-up calls the explanation asked for:</p><ul class="plain-list">${a.followUps.map((f) => `<li><code>${esc(f.fn)}</code> → <b>${f.value == null ? esc(f.error ?? 'no answer') : esc(f.value)}</b><br><small class="muted">${esc(f.why)}</small></li>`).join('')}</ul>` : ''}</section>
    </div>
    <h4 class="list-h">The two put together</h4>
    <p class="interpretation">${esc(i?.summary ?? v.reason)}</p>
    ${i?.checks?.length ? i.checks.map((c) => `<p class="check ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} <b>${esc(c.name)}:</b> ${esc(c.detail)}</p>`).join('') : ''}
    <h4 class="list-h">Who called what, in order</h4>
    ${table(['#', 'Who', 'What'], a.steps.map(stepRow))}
    <p class="muted">${a.chainCalls} Chain MCP calls, ${a.docsCalls} Docs MCP calls and ${a.rpcCalls} public RPC calls (each read repeated to confirm it). Everything is read-only: the function is called with eth_call and nothing is sent.</p>`;
}

const livePanel = makePanel({
  intro: 'Pick a contract and a function (or one of the examples) and run it. The agent asks the docs, calls the chain, and puts the two together. Takes about 20 seconds.',
  fields: [
    { name: 'contract', label: 'Contract address', type: 'text', value: CASES[0].contract, grow: true },
    { name: 'fn', label: 'Function, written like cast', type: 'text', value: CASES[0].function, grow: true, hint: 'name(inputs)(outputs), e.g. balanceOf(address)(uint256)' },
    { name: 'args', label: 'Arguments', type: 'text', optional: true, value: '', hint: 'Comma separated, in order.' },
    { name: 'block', label: 'Pin to block', type: 'number', optional: true, min: 1, step: 1, value: String(CASES[0].block), hint: 'Empty = two blocks behind the latest.' },
  ],
  button: 'Explain it and call it',
  examples: CASES.map((c) => ({ label: c.label, values: { contract: c.contract, fn: c.function, args: c.args.join(','), block: String(c.block) } })),
  title: (v) => `Agent: ${v.fn}`,
  call: (v) => ({ params: { contract: v.contract, function: v.fn, args: v.args, ...(v.block !== '' && { block: v.block }) } }),
  decode: ({ agent: a }) => [
    ...a.steps.map((s) => ({ kind: s.actor === 'agent' ? 'decision' : 'decode', title: `${s.n}. ${ACTOR[s.actor]}: ${s.name}`, detail: s.actor === 'agent' ? s.summary : `${s.input} → ${(s.output ?? s.error ?? '').slice(0, 120)}` })),
    { kind: 'decision', title: a.verdict.headline, detail: a.verdict.reason },
  ],
  summary: ({ agent: a }) => `${a.verdict.status.toUpperCase()} · ${a.chainCalls} Chain MCP + ${a.docsCalls} Docs MCP calls`,
  render: ({ agent: a }) => result(a),
});

// ---- the recorded demo, with Replay -----------------------------------------------------------------------------------------------------
function mountDemo(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Recorded demo: five real functions on Pharos mainnet</h3><div class="idle" data-role="body">Loading the recording…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { demo } = data;
      body.classList.remove('idle');
      const rows = demo.cases.map((c) => {
        const r = c.result;
        const val = r.interpretation?.value;
        return [`<b>${esc(c.label)}</b><br><code class="tiny">${esc(c.function)} on ${esc(short(c.contract))}</code>`,
          `${pill(r.verdict.status.replace('-', ' '), TONE[r.verdict.status])}`,
          val ? `<b>${esc(val.scaled)}</b>${val.unit ? ` <small class="muted">${esc(val.unit)}</small>` : ''}<br><small class="muted">raw ${esc(r.call.values[0].text.slice(0, 22))}${r.call.values[0].text.length > 22 ? '…' : ''}</small>` : `<small class="muted">raw ${esc(r.call?.values?.[0]?.text?.slice(0, 26) ?? '–')}</small>`,
          `${r.explanation.sources.filter((s) => s.cited).map((s) => esc(s.title)).join(', ') || '<small class="muted">none</small>'}`,
          `<button type="button" class="btn small" data-replay="${esc(c.id)}">Replay</button><div data-out="${esc(c.id)}"></div>`];
      });
      body.innerHTML = `<p class="muted">Recorded ${esc(demo.recordedAt.slice(0, 10))}, all pinned to block ${demo.cases[0].block.toLocaleString('en-US')}. Replay runs the agent again at that block and compares the chain’s answers with the recording. The explanation is generated again, so its wording can differ.</p>
        ${table(['Function', 'Result', 'Value, as the docs say', 'Docs cited', ''], rows)}`;
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
          const same = c.sameRawValue && c.chainAnswers.identical === c.chainAnswers.compared;
          out.innerHTML = `<p class="check ${same ? 'ok' : 'bad'}">${same ? '✓' : '✗'} <b>Same raw value, and ${c.chainAnswers.identical} of ${c.chainAnswers.compared} Chain MCP answers identical</b> to the recording. Now: ${esc(res.data.replayed.verdict.status)}.</p>`;
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
