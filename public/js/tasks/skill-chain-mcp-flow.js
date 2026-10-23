// Skill + Chain MCP Flow: content, the sequence diagram, a live panel that shows every step of a real run, and the recorded demo with Replay.
import { api, esc } from '../util.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

// Kept identical to skills/pharos-transfer-preflight/examples/ (a test checks it).
export const EXAMPLE_POLICY = {
  version: 1,
  name: 'treasury transfers on Pharos mainnet',
  rules: [
    { id: 'usdc-cap', type: 'spend-limit', asset: '0xc879c018db60520f4355c26ed1a6d572cdac1815', decimals: 6, symbol: 'USDC', perRequest: '100', perWindow: { amount: '250', seconds: 86400 } },
    { id: 'pros-cap', type: 'spend-limit', asset: 'native', symbol: 'PROS', perRequest: '1' },
    { id: 'known-targets', type: 'allowlist', field: 'target', values: ['0xc879c018db60520f4355c26ed1a6d572cdac1815', '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0', '0x768b959191ce5876cabbbc014a08d72615bdde54', '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92'] },
    { id: 'known-recipients', type: 'allowlist', field: 'recipient', values: ['0x768b959191ce5876cabbbc014a08d72615bdde54', '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92'] },
    { id: 'known-functions', type: 'allowlist', field: 'selector', values: ['0xa9059cbb'] },
    { id: 'office-hours', type: 'time-window', timezone: 'UTC', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:00', to: '18:00' },
  ],
};
const SENDER = '0x18573fa18fd17ddfd790b4a5b5b2977aad3b4efb';
const R1 = '0x768b959191ce5876cabbbc014a08d72615bdde54';
const THURSDAY = 20918892; // 2026-10-22 10:00:01 UTC
const SATURDAY = 20471429; // 2026-10-17 10:00:00 UTC
export const EXAMPLE_REQUESTS = [
  { id: 'ready', label: 'A transfer the policy allows and the chain confirms (a Thursday block)', text: `send 1 USDC from ${SENDER} to ${R1}`, block: THURSDAY },
  { id: 'weekend', label: 'The same request at a Saturday block: the chain’s clock changes the answer', text: `send 1 USDC from ${SENDER} to ${R1}`, block: SATURDAY },
  { id: 'over-limit', label: 'Over the policy’s per-request limit', text: `send 150 USDC from ${SENDER} to ${R1}`, block: THURSDAY },
  { id: 'no-balance', label: 'Allowed by the policy, but the sender holds no USDC: the chain stops it', text: `send 1 USDC from 0x0000000000000000000000000000000000000001 to ${R1}`, block: THURSDAY },
  { id: 'stranger', label: 'A recipient that is not on the allowlist', text: `send 1 USDC from ${SENDER} to 0x3333333333333333333333333333333333333333`, block: THURSDAY },
  { id: 'latest', label: 'Right now: the latest block, whatever day it is', text: `send 1 USDC from ${SENDER} to ${R1}`, block: null },
];
const json = (v) => JSON.stringify(v, null, 2);

// ---- the diagram (requirement: what calls what, and in what order) ---------------------------------------------------------------
const X = { user: 60, flow: 215, gate: 380, chain: 545, dry: 695 };
const NAMES = [['user', 'User'], ['flow', 'Skill flow'], ['gate', 'Policy Gatekeeper'], ['chain', 'Chain MCP'], ['dry', 'Dry-Run Executor']];
const MSGS = [
  { n: 1, from: 'user', to: 'flow', y: 96, text: '“send 1 USDC from A to B”' },
  { n: 2, from: 'flow', to: 'chain', y: 126, text: 'get_block_number' },
  { n: 3, from: 'flow', to: 'chain', y: 154, text: 'get_block → its time is the clock' },
  { n: 4, from: 'flow', to: 'chain', y: 182, text: 'eth_call symbol(), decimals()' },
  { n: 5, self: 'flow', y: 214, text: 'check token, build transfer' },
  { n: 6, from: 'flow', to: 'gate', y: 244, text: 'request + the block’s time' },
  { n: 7, from: 'gate', to: 'dry', y: 308, text: 'ALLOW → simulate', alt: true },
  { n: 8, from: 'dry', to: 'chain', y: 338, text: 'eth_call, estimate_gas, balances', alt: true },
  { n: 9, from: 'chain', to: 'dry', y: 366, text: 'result, gas, balances', alt: true, back: true },
  { n: 10, from: 'dry', to: 'flow', y: 394, text: 'GO or BLOCKED', alt: true, back: true },
  { n: 11, from: 'flow', to: 'user', y: 436, text: 'READY (unsigned tx) or STOP (rule / revert)', back: true },
];
const DIAGRAM = (() => {
  const c = (k) => X[k];
  const arrow = (m) => {
    if (m.self) return `<path d="M${c(m.self)} ${m.y - 10} h34 v18 h-34" class="d-line" marker-end="url(#d-arrow)"/><text x="${c(m.self) + 42}" y="${m.y + 1}" class="d-t">${m.n}. ${m.text}</text>`;
    const x1 = c(m.from);
    const x2 = c(m.to);
    const mid = (x1 + x2) / 2;
    return `<line x1="${x1}" y1="${m.y}" x2="${x2 + (x2 > x1 ? -4 : 4)}" y2="${m.y}" class="d-line ${m.back ? 'd-back' : ''}" marker-end="url(#d-arrow)"/><text x="${mid}" y="${m.y - 5}" text-anchor="middle" class="d-t">${m.n}. ${m.text}</text>`;
  };
  return `<figure class="diagram"><div class="scroll"><svg viewBox="0 0 760 470" role="img" aria-label="Sequence diagram of the flow: the user's request goes to the Skill flow, which asks Chain MCP for the block, its time and the token facts, hands the request and the block's time to the Policy Gatekeeper, and only if it allows asks the Dry-Run Executor to simulate through Chain MCP, then answers READY or STOP." style="min-width:560px;width:100%;height:auto">
    <defs><marker id="d-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" style="fill:var(--accent)"/></marker></defs>
    <style>.d-t{font:12px var(--sans);fill:var(--text)}.d-h{font:600 12px var(--sans);fill:var(--text)}.d-life{stroke:var(--border-2);stroke-dasharray:4 4}.d-line{stroke:var(--accent);stroke-width:1.6;fill:none}.d-back{stroke-dasharray:5 3}.d-box{fill:var(--surface-2);stroke:var(--border-2)}.d-alt{fill:none;stroke:var(--border-2);stroke-dasharray:3 3}.d-bad{fill:var(--bad-bg);stroke:var(--bad)}.d-lbl{font:600 11px var(--sans);fill:var(--muted)}</style>
    ${NAMES.map(([k, label]) => `<rect x="${c(k) - 62}" y="14" width="124" height="32" rx="8" class="d-box"/><text x="${c(k)}" y="35" text-anchor="middle" class="d-h">${label}</text><line x1="${c(k)}" y1="46" x2="${c(k)}" y2="456" class="d-life"/>`).join('')}
    ${MSGS.filter((m) => !m.alt).map(arrow).join('')}
    <rect x="170" y="266" width="560" height="26" rx="6" class="d-bad"/><text x="180" y="283" class="d-t"><tspan class="d-lbl">IF DENIED  </tspan>DENY names the rule; Chain MCP is never asked to simulate → STOP</text>
    <rect x="150" y="298" width="590" height="128" rx="8" class="d-alt"/>
    ${MSGS.filter((m) => m.alt).map(arrow).join('')}
    <text x="156" y="418" class="d-lbl">IF ALLOWED (the dashed box): the Gatekeeper’s executor is the simulation</text>
  </svg></div><figcaption class="muted">Solid arrows are requests, dashed arrows are answers. Everything the flow asks Chain MCP is pinned to one block. Step 7 exists only after an allow.</figcaption></figure>`;
})();

export const content = {
  tagline: 'One sentence in, one verdict out: Chain MCP supplies live facts, two Skills decide with them, and the next question depends on the last answer.',
  tools: ['chain'],
  skill: true,
  diagram: DIAGRAM,
  story: [
    'A Skill that only reads, and a chain tool that only fetches, are two separate things. This flow makes them one. You say “send 1 USDC from A to B”. The flow asks Chain MCP for the latest block and then for that block’s header, because the header’s timestamp is the clock the policy will be checked against. It asks what the token really is (symbol and decimals), turns “1” into the integer the contract understands, and hands the request and the block’s time to the Policy Gatekeeper Skill.',
    'The two tools are woven in both directions. Chain MCP’s answers decide what the Skill concludes: the same request is READY at a Thursday block and STOP, by the time-window rule, at a Saturday one, because the chain’s clock says so; the decimals set the amount; the sender’s balance decides whether the simulation succeeds. And the Skill’s decision decides what Chain MCP is asked next: if the policy denies, the simulation is never requested, so no balance, gas or call is read for a transfer that was already refused.',
    'Nothing here is staged. Every run reads Pharos mainnet through the hosted Chain MCP, and the recorded demo is five real runs pinned to specific mainnet blocks. Replay asks the chain the same questions at the same blocks and compares every answer with the recording. The end of a successful flow is an unsigned transaction with the gas limit worked out: signing is yours.',
  ],
  how: [
    { server: 'local', tool: 'parse the request', text: '“send <amount> <PROS|USDC|WPROS> from <0x…> to <0x…>”, strictly: a request the flow cannot read is refused, not guessed.' },
    { server: 'chain', tool: 'get_block_number · get_block', text: 'The head, then the header of the pinned block (two behind the head, or the block you choose). Its timestamp is the policy’s clock, not the machine’s.' },
    { server: 'chain', tool: 'eth_call symbol() · decimals()', text: 'What the token at that address really is. A different symbol, or a policy that counts it in other decimals, stops the flow before anything is decided.' },
    { server: 'local', tool: 'build the transfer', text: 'transfer(recipient, amount × 10^decimals), using the decimals the chain just answered.' },
    { server: 'local', tool: 'Policy Gatekeeper (Skill)', text: 'Spend limit, allowlist, time window, checked at the block’s time. ALLOW or DENY with the named rule; the decision is written to the audit log before anything else happens.' },
    { server: 'chain', tool: 'eth_call · estimate_gas · get_gas_price · balances', text: 'Dry-Run Executor (Skill), requested only after an ALLOW: would it succeed, what would it cost, what would the balances be.' },
    { server: 'local', tool: 'verdict', text: 'READY with an unsigned transaction (gas limit = estimate + 30%), or STOP with the rule that denied it or the revert the chain predicted.' },
  ],
  decisions: [
    { title: 'Composed in both directions, not side by side', text: 'A flow where a Skill and a fetch merely sit next to each other proves nothing. Here the chain’s time changes the Skill’s decision (shown on this page by running one request at two blocks), and the Skill’s decision changes which calls reach the chain (a deny means no simulation). The numbers in each run’s step list show which earlier steps every step used.' },
    { title: 'The clock is the block’s timestamp', text: 'A time window checked against the machine’s clock would be wrong the moment the machine, the user and the chain disagree. The flow reads the pinned block’s header and uses its time. That is also what makes a run replayable: it is a question about one block.' },
    { title: 'Everything is pinned to one block, so a run can be repeated', text: 'The head (get_block_number) and the gas price (the tool has no block parameter) are always current; every other answer is read at the pinned block and comes back identical on a replay. The page says which two are not pinned instead of hiding it.' },
    { title: 'Check the token before trusting the address', text: 'The request says USDC, the flow knows an address for it, and the chain must agree: symbol() has to answer USDC. The policy also names the token’s decimals, and if they differ from the chain’s the flow stops, because every limit would be off by a power of ten.' },
    { title: 'A deny never reaches the simulation', text: 'The simulation is the Policy Gatekeeper’s executor, so the gate’s own rule applies: denied actions are never executed. The step list shows the skipped calls by name.' },
    { title: 'The gas limit has 30% headroom', text: 'estimate_gas can undershoot on nested calls (we saw a real transaction run out of gas on an exact estimate), so the prepared limit is the estimate plus 30%. Unused gas is refunded.' },
    { title: 'Two bugs the tests caught before any real run', text: 'The first version recorded the policy-gate step after the simulation it triggered, so the printed order was wrong; the step is now written before the executor runs. And a policy counting USDC in 6 decimals met a chain that said 18: the flow first decided on an amount off by 10^12; it now stops with the reason.' },
    { title: 'What this flow does not do', text: 'It sends nothing and holds no key. The spend window counts only requests in one run (the web page keeps no history; the CLI can keep one in a file through the gate’s audit log). A simulation is a prediction about a block that has passed.' },
  ],
  evidence: [
    'The verdict depends on live Chain MCP data: the block’s time picks the time-window rule (the same request is READY at a Thursday block and STOP by office-hours at a Saturday block), the token’s decimals set the amount, and the sender’s balance decides the simulation.',
    'One sentence (“send 1 USDC from A to B”) runs the whole flow end to end: parse, read the chain, check the token, decide, simulate, prepare. One call, one verdict.',
    'A sequence diagram on this page and a Mermaid one in the Skill’s reference show what calls what and in what order; every run also lists each step in order with the earlier steps it used.',
    'The recorded demo is five real runs pinned to Pharos mainnet blocks, with every Chain MCP answer; Replay asks the chain again at the same blocks and shows the answers are identical.',
  ],
  files: ['lib/flow.js', 'lib/tasks/skill-chain-mcp-flow.js', 'scripts/flow-demo.mjs', 'reports/flow-demo.json', 'lib/policy.js', 'lib/audit-log.js', 'lib/tasks/dry-run-executor.js', 'skills/pharos-transfer-preflight/SKILL.md', 'skills/pharos-transfer-preflight/references/transfer-preflight.md', 'skills/pharos-transfer-preflight/scripts/preflight.mjs', 'skills/pharos-transfer-preflight/examples/policy.json', 'skills/pharos-transfer-preflight/examples/requests.json'],
  run: {
    commands: ['node skills/pharos-transfer-preflight/scripts/preflight.mjs --request "send 1 USDC from 0x18573fa18fd17ddfd790b4a5b5b2977aad3b4efb to 0x768b959191ce5876cabbbc014a08d72615bdde54"', '… --block 20471429   # the same request at a Saturday block', '… --out run.json   # every step and the audit log as JSON'],
    sample: `request: send 1 USDC from 0x18573fa1…4efb to 0x768b959…de54
block 20,918,892 (pinned by --block)  ·  thu 2026-10-22 10:00:01 UTC

 2  CHAIN MCP  get_block_number       →  {"blockNumber":"21023594", …}
 3  CHAIN MCP  get_block              {"block":20918892}  →  the header (timestamp 1792663201)
 4  CHAIN MCP  eth_call               symbol()    →  USDC
 5  CHAIN MCP  eth_call               decimals()  →  6
 6  SKILL      token-check            The chain confirms … is USDC with 6 decimals (the policy agrees).  (uses 4, 5)
 8  SKILL      policy-gate            Policy Gatekeeper: ALLOW … allowed: all 6 rules passed (5 applied)  (uses 3, 7)
 9  CHAIN MCP  eth_call               simulate transfer(…, 1000000)
10  CHAIN MCP  estimate_gas           58,620 gas
16  CHAIN MCP  eth_call               balanceOf(sender)  →  1,242,441.562141 USDC
18  SKILL      dry-run-verdict        Dry-Run Executor: GO. 1,242,441.562141 USDC → 1,242,440.562141 USDC.

READY: allowed, simulated, prepared (unsigned)
  prepared: to 0xc879…1815, value 0, gas limit 76,206 (estimate 58,620 + 30%)

what the chain’s data decided:
  step 3: the block’s time = thu 2026-10-22 10:00:01 UTC  →  the time-window rule “office-hours” passed
  13 Chain MCP calls; audit log intact (2 entries)`,
  },
  verify: [
    { title: 'Check the block’s time yourself', text: 'The Saturday block’s timestamp, straight from the public RPC with none of our code in the path. 1792231200 is Saturday 17 October 2026, 10:00:00 UTC.', code: 'cast block 20471429 --field timestamp --rpc-url https://rpc.pharos.xyz\ndate -u -r 1792231200' },
    { title: 'Check the sender’s balance at the pinned block', text: 'The balance the simulation used for the READY run. It should read 1242441562141 (1,242,441.562141 USDC).', code: 'cast call 0xc879c018db60520f4355c26ed1a6d572cdac1815 "balanceOf(address)(uint256)" 0x18573fa18fd17ddfd790b4a5b5b2977aad3b4efb --block 20918892 --rpc-url https://rpc.pharos.xyz' },
    { title: 'Replay a recorded run', text: 'In the recorded demo card on this page, press Replay: the flow runs again at the recorded block and reports how many Chain MCP answers are identical to the recording.' },
    { title: 'Run it from the command line', text: 'Needs only Node.js 20+. Add --block to repeat a recorded run exactly.', code: 'node skills/pharos-transfer-preflight/scripts/preflight.mjs --request "send 1 USDC from 0x18573fa18fd17ddfd790b4a5b5b2977aad3b4efb to 0x768b959191ce5876cabbbc014a08d72615bdde54" --block 20918892' },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference with the Mermaid sequence diagram, the script and the example policy and requests are in the repository.', link: [`${REPO}/tree/main/skills/pharos-transfer-preflight`, 'skills/pharos-transfer-preflight'] },
  ],
};

// ---- the live panel: the whole run, step by step --------------------------------------------------------------------------------
const tone = (v) => (v.status === 'ready' ? 'ok' : 'bad');
const uses = (s) => (s.uses?.length ? `<small class="muted">uses ${s.uses.map((u) => `#${u}`).join(' ')}</small>` : '');
const stepRow = (s) => {
  const skill = s.actor === 'skill';
  const left = skill ? `<b><code>${esc(s.name)}</code></b><br><small>${esc(s.summary)}</small> ${uses(s)}` : '';
  const right = skill ? '' : `<b><code>${esc(s.name)}</code></b> <small class="muted">${s.ms} ms</small><br><small class="muted">in</small> <code class="tiny">${esc(s.input)}</code><br><small class="muted">out</small> <code class="tiny">${esc(s.error ? `ERROR ${s.error}` : s.output)}</code>`;
  return [s.n, left, right];
};

const livePanel = makePanel({
  intro: 'Type one request and run it. Every Chain MCP call and every Skill step is listed in the order it happened, with the earlier steps it used. Nothing is sent.',
  fields: [
    { name: 'text', label: 'The request', type: 'text', value: EXAMPLE_REQUESTS[0].text, grow: true, wide: true, hint: 'send <amount> <PROS|USDC|WPROS> from <0x…> to <0x…>' },
    { name: 'block', label: 'Pin to block', type: 'number', optional: true, min: 1, step: 1, value: String(THURSDAY), hint: 'Empty = two blocks behind the latest. A pinned block repeats a run exactly, and its time is the policy’s clock.' },
    { name: 'policy', label: 'Policy (JSON)', type: 'textarea', rows: 12, wide: true, value: json(EXAMPLE_POLICY), hint: 'Spend limit, allowlist and time-window rules, as in the Policy Gatekeeper.' },
  ],
  button: 'Run the flow',
  examples: EXAMPLE_REQUESTS.map((r) => ({ label: r.label, values: { text: r.text, block: r.block == null ? '' : String(r.block), policy: json(EXAMPLE_POLICY) } })),
  title: (v) => `Flow: ${v.text.slice(0, 60)}`,
  call: (v) => {
    let policy;
    try { policy = JSON.parse(v.policy); } catch (err) { throw new Error(`The policy is not valid JSON: ${err.message}`); }
    return { body: { text: v.text, policy, ...(v.block !== '' && { block: Number(v.block) }) } };
  },
  decode: ({ flow: f }) => [
    ...f.steps.map((s) => ({ kind: s.actor === 'skill' ? 'decision' : 'decode', title: `${s.n}. ${s.actor === 'skill' ? 'Skill' : 'Chain MCP'}: ${s.name}`, detail: s.actor === 'skill' ? s.summary : `${s.input} → ${(s.output ?? s.error ?? '').slice(0, 120)}` })),
    { kind: 'decision', title: f.verdict.headline, detail: f.verdict.reason },
  ],
  summary: ({ flow: f }) => `${f.verdict.status.toUpperCase()} · ${f.chainCalls} Chain MCP calls · block ${f.block.number.toLocaleString('en-US')}`,
  render: ({ flow: f }) => `
    <div class="verdict ${tone(f.verdict)}">${esc(f.verdict.headline)}<small>${esc(f.verdict.reason)}</small></div>
    <p class="muted">Block <b>${f.block.number.toLocaleString('en-US')}</b>${f.block.historical ? ' (pinned)' : ' (two behind the latest)'} · <b>${esc(f.block.weekday)} ${esc(f.block.iso)}</b> is the clock the policy was checked against · policy “${esc(f.policy.name)}” <code>${esc(f.policy.hash.slice(0, 12))}…</code></p>
    <h4 class="list-h">What the chain’s data decided</h4>
    ${table(['Step', 'What Chain MCP said', 'Value', 'What it changed'], f.dependsOn.map((d) => [`#${d.step ?? '–'}`, esc(d.what), `<code>${esc(d.value)}</code>`, `<small>${esc(d.effect)}</small>`]))}
    <h4 class="list-h">Who called what, in order</h4>
    ${table(['#', 'Skill', 'Chain MCP'], f.steps.map(stepRow))}
    ${f.skippedChainCalls ? `<p class="check warn"><b>Not called, because the policy denied it:</b> ${f.skippedChainCalls.map((x) => `<code>${esc(x)}</code>`).join(', ')}.</p>` : ''}
    ${f.verdict.prepared ? `<h4 class="list-h">Prepared transaction (unsigned)</h4><pre class="plain">network ${esc(f.verdict.prepared.network)}\nto      ${esc(f.verdict.prepared.to)}\nvalue   ${esc(f.verdict.prepared.value)}\ngas     ${f.verdict.prepared.gasLimit.toLocaleString('en-US')}  (estimate ${f.verdict.gas.units.toLocaleString('en-US')} + 30%)\ndata    ${esc(f.verdict.prepared.data.slice(0, 74))}…</pre><p class="muted">Nothing was sent. Signing is your step, and a simulation is a prediction about a block that has already passed.</p>` : ''}
    <p class="check ${f.integrity.ok ? 'ok' : 'bad'}">${f.integrity.ok ? '✓' : '✗'} Audit log: ${f.integrity.count} entries, hash chain ${f.integrity.ok ? 'intact' : 'BROKEN'}. ${f.chainCalls} Chain MCP calls in all.</p>`,
});

// ---- the recorded demo, with Replay --------------------------------------------------------------------------------------------
function mountDemo(el, slug) {
  el.innerHTML = '<section class="card tn"><h3>Recorded demo: five real runs on Pharos mainnet</h3><div class="idle" data-role="body">Loading the recording…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, recorded: 1 })
    .then(({ data }) => {
      const { demo } = data;
      body.classList.remove('idle');
      const rows = demo.cases.map((c) => {
        const v = c.result.verdict;
        const r = c.result;
        return [`<b>${esc(c.title)}</b><br><code class="tiny">${esc(c.text.replace(/0x([0-9a-f]{6})[0-9a-f]{30}([0-9a-f]{4})/g, '0x$1…$2'))}</code>`,
          `${c.block.toLocaleString('en-US')}<br><small class="muted">${esc(r.block.weekday)} ${esc(r.block.iso.slice(0, 16))}</small>`,
          `${pill(v.status.toUpperCase(), tone(v))}<br><small>${esc(v.rule ? `rule ${v.rule.id}` : v.stage === 'simulation' ? v.reason : 'prepared, unsigned')}</small>`,
          `${r.chainCalls}`, `<button type="button" class="btn small" data-replay="${esc(c.id)}">Replay</button><div data-out="${esc(c.id)}"></div>`];
      });
      body.innerHTML = `<p class="muted">Recorded ${esc(demo.recordedAt.slice(0, 10))}. Each run is pinned to a block, so Replay asks Chain MCP the same questions at the same block and compares every answer with the recording. Only the head and the gas price are current.</p>
        ${table(['Run', 'Pinned block', 'Verdict', 'Chain MCP calls', ''], rows)}`;
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-replay]');
        if (!b) return;
        const out = body.querySelector(`[data-out="${b.dataset.replay}"]`);
        b.disabled = true;
        out.innerHTML = '<small class="muted">Replaying against Chain MCP…</small>';
        try {
          const { data: d } = await api('run', { slug, replay: b.dataset.replay });
          const c = d.comparison;
          const same = c.sameVerdict && c.chainAnswers.identical === c.chainAnswers.compared;
          out.innerHTML = `<p class="check ${same ? 'ok' : 'bad'}">${same ? '✓' : '✗'} <b>Same verdict, and ${c.chainAnswers.identical} of ${c.chainAnswers.compared} pinned Chain MCP answers identical</b> to the recording${c.chainAnswers.differing.length ? `; differing: ${c.chainAnswers.differing.map((x) => esc(x.call)).join(', ')}` : ''}.</p>`;
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
