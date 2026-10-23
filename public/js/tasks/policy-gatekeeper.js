// Policy Gatekeeper: content and a factory panel.
import { esc } from '../util.js';
import { mountTestnet } from '../panels/testnet.js';
import { makePanel, pill, table } from '../panels/factory.js';
import { REPO } from '../consts.js';

// Kept identical to skills/pharos-policy-gatekeeper/examples/ (a test checks it).
export const EXAMPLE_POLICY = {
  version: 1,
  name: 'treasury-agent policy',
  rules: [
    { id: 'native-spend', type: 'spend-limit', asset: 'native', symbol: 'PROS', perRequest: '0.01', perWindow: { amount: '0.02', seconds: 86400 } },
    { id: 'known-targets', type: 'allowlist', field: 'target', values: ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'] },
    { id: 'known-functions', type: 'allowlist', field: 'selector', values: ['0xa9059cbb'] },
    { id: 'office-hours', type: 'time-window', timezone: 'UTC', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:00', to: '18:00' },
  ],
};
const W = '0x9999999999999999999999999999999999999999';
const T1 = '0x1111111111111111111111111111111111111111';
const T2 = '0x2222222222222222222222222222222222222222';
export const EXAMPLE_REQUESTS = [
  { id: 'r1-pay-treasury', at: '2026-10-26T10:00:00Z', from: W, to: T1, value: '5000000000000000' },
  { id: 'r2-too-big', at: '2026-10-26T10:01:00Z', from: W, to: T1, value: '50000000000000000' },
  { id: 'r3-pay-again', at: '2026-10-26T10:05:00Z', from: W, to: T2, value: '8000000000000000' },
  { id: 'r4-over-the-day', at: '2026-10-26T10:09:00Z', from: W, to: T1, value: '9000000000000000' },
  { id: 'r5-stranger', at: '2026-10-26T10:10:00Z', from: W, to: '0x3333333333333333333333333333333333333333', value: '1000000000000000' },
  { id: 'r6-unlisted-function', at: '2026-10-26T10:11:00Z', from: W, to: T1, data: '0x773acdef0000000000000000000000000000000000000000000000000000000000000001' },
  { id: 'r7-weekend', at: '2026-10-24T10:00:00Z', from: W, to: T1, value: '1000000000000000' },
  { id: 'r8-garbage', at: '2026-10-26T10:12:00Z', from: W, to: 'not-an-address' },
];
const json = (v) => JSON.stringify(v, null, 2);
const TWO_RULES = { ...EXAMPLE_POLICY, rules: EXAMPLE_POLICY.rules.filter((r) => r.type !== 'time-window') };

export const content = {
  tagline: 'A policy in front of an agent: every request is allowed or denied by a named rule, denied requests never run, and every decision is logged.',
  tools: ['chain'],
  skill: true,
  story: [
    'An agent that can spend money needs limits it cannot talk its way past. The Policy Gatekeeper is a Pharos Skill that sits in front of every action the agent wants to take and checks it against a policy file: how much it may spend, which addresses and functions it may touch, and during which hours. The answer is always allow or deny, with the specific rule that decided and the numbers behind it.',
    'The part that matters most is what happens next. The gate is the only path to the executor: it writes its decision to the audit log first, and only then, if the answer was allow, calls the executor. A denied request never reaches it, and if the decision cannot be written, nothing runs. The audit log is a hash chain, so an edited, removed or reordered entry is detected, and the gate refuses to decide on top of a log that fails the check.',
    'It is proven on a real chain. The testnet card on this page sent eight requests through the gate on Pharos Atlantic: two were allowed and became real transactions, six were denied (by the spend limit twice, the address allowlist, the function allowlist, the time window and the shape check) and never reached the wallet. Afterwards the chain itself was asked: the recipients hold exactly what was allowed, the stranger holds nothing, the denied contract call left its counter at 0, and the wallet’s nonce grew by exactly the number of allowed requests.',
  ],
  how: [
    { server: 'local', tool: 'parse the policy', text: 'Version 1, 1 to 50 rules with unique ids, and all three rule types present. Amounts are exact decimals turned into integers; nothing is a float. The policy gets a SHA-256 that every decision records.' },
    { server: 'local', tool: 'read the request', text: 'Native transfer, ERC-20 transfer, approve and transferFrom are decoded exactly (an approve counts as spending its full amount); any other call is a contract call. Anything that cannot be read is denied by `request-shape`, never guessed.' },
    { server: 'chain', tool: 'get_block_number · get_block', text: 'The clock is the timestamp of the latest confirmed block, so the time window is the chain’s time, in UTC. A request may carry its own `at` to test a what-if.' },
    { server: 'local', tool: 'check every rule in order', text: 'Spend limits (per request and per rolling window, counted from earlier allowed requests in the same asset), allowlists (target, recipient, selector) and time windows. The first failing rule decides; the trace lists all of them.' },
    { server: 'local', tool: 'append to the audit log', text: 'The decision is written before anything runs. Each entry carries the hash of the one before it.' },
    { server: 'local', tool: 'call the executor (allow only)', text: 'Denied requests stop here, and the log records “not executed”. On the page the executor only counts calls; on the testnet card it is a real signer.' },
  ],
  decisions: [
    { title: 'First failing rule decides, all failures are shown', text: 'A request can break several rules at once (too big, to a stranger, on a weekend). One rule has to be named as the decider so the answer is a single reason, and the policy order is that choice, so the strictest rules go first. The trace still lists every failed rule so nothing is hidden.' },
    { title: 'Fail closed, everywhere', text: 'An unreadable request, a malformed calldata (a transfer with a missing word, trailing bytes), an invalid policy, a log that fails verification, or a log that cannot be written: each ends in a deny or an error, never in an execution.' },
    { title: 'Write first, then run', text: 'If the executor ran first and the log write then failed, a payment could exist with no record. The decision entry is written before the executor is called; the outcome is added after.' },
    { title: 'An approval is a spend', text: 'ERC-20 approve(spender, amount) lets the spender take up to that amount, so it is checked against the spend limit at its full value, not as a free action.' },
    { title: 'Spend windows count only what was allowed', text: 'Denied requests spent nothing, so they do not use up the limit. A spend exactly 24 hours old is outside a 24-hour window; a limit may be reached exactly (0.015 allowed against a 0.015 limit) but not by one wei more. These edges are tests.' },
    { title: 'The time window is UTC and the clock is the chain’s', text: 'Time zones and daylight saving are a source of silent mistakes, so only UTC is accepted. A window cannot cross midnight (start-inclusive, end-exclusive); use the days list instead. The real run takes the time from the latest block header, not from the machine.' },
    { title: 'The testnet time-window deny uses a second policy', text: 'To make the time window decide on a real run without waiting for a weekend, the run builds a second policy identical to the first except that today’s weekday is taken out of the window, and sends the same request through it. The policy name and hash are recorded with each decision, so this is visible, not hidden.' },
    { title: 'What a hash chain proves and what it does not', text: 'It detects an entry that was edited, removed from the middle, reordered or inserted. It cannot prove that the last entries were not cut off, so the verifier prints the head hash to be kept elsewhere. And a spend limit only sees requests that went through the same gate: it cannot stop spending that bypasses it.' },
  ],
  evidence: [
    'A policy file with all three rule types: spend limit (per request and per window), allowlist (target, recipient, selector) and time window (UTC days and hours). A policy with fewer is rejected.',
    'Every request returns allow or deny with the deciding rule’s id and type, a one-sentence reason with the numbers, and the check of every rule.',
    'Denied requests never reach the executor: shown for each rule type on the live panel (executor calls vs denials) and on Pharos Atlantic, where the chain confirms no denied request was sent.',
    'A hash-chained audit log of every decision and its outcome, verified again when the page loads; editing an entry is detected and shown.',
  ],
  files: ['lib/policy.js', 'lib/audit-log.js', 'lib/tasks/policy-gatekeeper.js', 'scripts/testnet-gatekeeper.mjs', 'reports/testnet-gatekeeper.json', 'lib/testnet-signer.js', 'skills/pharos-policy-gatekeeper/SKILL.md', 'skills/pharos-policy-gatekeeper/references/policy-gatekeeper.md', 'skills/pharos-policy-gatekeeper/scripts/gate.mjs', 'skills/pharos-policy-gatekeeper/examples/policy.json', 'skills/pharos-policy-gatekeeper/examples/requests.json'],
  run: {
    commands: ['node skills/pharos-policy-gatekeeper/scripts/gate.mjs --policy skills/pharos-policy-gatekeeper/examples/policy.json --requests skills/pharos-policy-gatekeeper/examples/requests.json --log audit.jsonl', 'node skills/pharos-policy-gatekeeper/scripts/gate.mjs --verify audit.jsonl', 'node scripts/testnet-gatekeeper.mjs   # rehearsal on a free fork; add --live for the real testnet'],
    sample: ` 1  ALLOW r1-pay-treasury        rule: all-rules-passed
      allowed: all 4 rules passed (3 applied)
 2  DENY  r2-too-big             rule: native-spend
      denied by rule "native-spend" (spend-limit): 0.05 PROS is over the per-request limit of 0.01 PROS
 4  DENY  r4-over-the-day        rule: native-spend
      denied by rule "native-spend" (spend-limit): 0.009 PROS on top of 0.013 PROS already allowed in the last 24 h would be 0.022 PROS, over the window limit of 0.02 PROS
 5  DENY  r5-stranger            rule: known-targets
 7  DENY  r7-weekend             rule: office-hours
      denied by rule "office-hours" (time-window): sat 10:00 UTC is outside the allowed window (mon/tue/wed/thu/fri 08:00-18:00 UTC)

2 allowed, 6 denied (native-spend: 2, known-targets: 1, known-functions: 1, office-hours: 1, request-shape: 1); denied requests that reached the executor: 0
audit log: intact, 16 entries`,
  },
  verify: [
    { title: 'Open the real transactions', text: 'The two allowed payments on Atlantic. Every hash on the testnet card links to the explorer, and the card re-reads each one from the chain when it loads.', link: ['https://atlantic.pharosscan.xyz/tx/0x6dfe7b23afd362bf2119c0b651db91af61c33ef7f5573c945b46e9feabedd79f', 'Allowed payment to recipient A'] },
    { title: 'Ask the chain about a denied request yourself', text: 'The stranger address on the card was denied and must hold nothing. Replace the address with the one shown on the card.', code: 'cast balance <stranger address from the card> --rpc-url https://atlantic.dplabs-internal.com' },
    { title: 'Check the wallet sent only what was allowed', text: 'The nonce is the number of transactions the wallet has ever sent; compare it with the recorded value on the card (plus anything sent since).', code: 'cast nonce 0x0eC197b8A30543c93e521a6C3F2DB5d110e60850 --rpc-url https://atlantic.dplabs-internal.com' },
    { title: 'Reproduce the decisions', text: 'Runs the same engine on the example policy; needs only Node.js and, for requests without a time, Chain MCP.', code: 'node skills/pharos-policy-gatekeeper/scripts/gate.mjs --policy skills/pharos-policy-gatekeeper/examples/policy.json --requests skills/pharos-policy-gatekeeper/examples/requests.json --log audit.jsonl && node skills/pharos-policy-gatekeeper/scripts/gate.mjs --verify audit.jsonl' },
    { title: 'Read the skill itself', text: 'SKILL.md, the reference, the script and the example policy are in the repository.', link: [`${REPO}/tree/main/skills/pharos-policy-gatekeeper`, 'skills/pharos-policy-gatekeeper'] },
  ],
};

const dec = (d) => `${pill(d.decision.toUpperCase(), d.decision === 'allow' ? 'ok' : 'bad')} <code>${esc(d.rule.id)}</code>`;

const livePanel = makePanel({
  intro: 'Edit the policy and the requests (JSON) and run them through the gate. The executor here only counts calls: nothing is broadcast. The real transactions are on the testnet card above.',
  fields: [
    { name: 'policy', label: 'Policy (JSON)', type: 'textarea', rows: 14, wide: true, value: json(EXAMPLE_POLICY), hint: 'Needs a spend-limit, an allowlist and a time-window rule. Amounts are plain decimals, times are UTC.' },
    { name: 'requests', label: 'Requests (JSON list, in order)', type: 'textarea', rows: 14, wide: true, value: json(EXAMPLE_REQUESTS), hint: '"at" is a UTC time. Without it the latest confirmed Pharos block time is used. "value" is whole wei; "data" is 0x hex.' },
    { name: 'tamper', label: 'Tamper with log entry #', type: 'number', optional: true, min: 0, step: 1, value: '', hint: 'Edits that entry in a copy of the log and verifies the copy, to show the change is caught.' },
  ],
  button: 'Run the requests through the gate',
  examples: [
    { label: 'The 8-request demo (one deny per rule type)', values: { policy: json(EXAMPLE_POLICY), requests: json(EXAMPLE_REQUESTS), tamper: '' } },
    { label: 'Same, then tamper with entry 2', values: { policy: json(EXAMPLE_POLICY), requests: json(EXAMPLE_REQUESTS), tamper: '2' } },
    { label: 'Policy without a time window (rejected)', values: { policy: json(TWO_RULES), requests: json(EXAMPLE_REQUESTS), tamper: '' } },
  ],
  title: () => 'Run requests through the gate',
  call: (v) => {
    let policy;
    let requests;
    try { policy = JSON.parse(v.policy); } catch (err) { throw new Error(`The policy is not valid JSON: ${err.message}`); }
    try { requests = JSON.parse(v.requests); } catch (err) { throw new Error(`The requests are not valid JSON: ${err.message}`); }
    return { body: { policy, requests, ...(v.tamper !== '' && { tamper: Number(v.tamper) }) } };
  },
  decode: ({ gate: g }) => [
    ...g.results.map((r) => ({ kind: 'decision', ok: r.decision.decision === 'allow', title: `${r.index}. ${r.id ?? 'request'}: ${r.decision.decision.toUpperCase()} by ${r.decision.rule.id}`, detail: r.decision.reason })),
    { kind: 'decision', title: `${g.summary.allowed} allowed, ${g.summary.denied} denied; denied requests that reached the executor: ${g.summary.deniedThatReachedTheExecutor}` },
  ],
  summary: ({ gate: g }) => `${g.summary.allowed} allowed, ${g.summary.denied} denied, executor called ${g.summary.executorCalls} times`,
  render: ({ gate: g, tamper }) => `
    <div class="verdict ${g.summary.deniedThatReachedTheExecutor === 0 ? 'ok' : 'bad'}">${g.summary.allowed} ALLOWED · ${g.summary.denied} DENIED<small>The executor was called ${g.summary.executorCalls} time${g.summary.executorCalls === 1 ? '' : 's'}, once for each allowed request. Denied requests that reached it: ${g.summary.deniedThatReachedTheExecutor}.</small></div>
    ${table(['#', 'Request', 'Decided by', 'Reason', 'Executor'], g.results.map((r) => [r.index, `<code>${esc(r.id ?? '—')}</code><br><small class="muted">${new Date(r.nowSec * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC${r.clock === 'chain' ? ' (chain clock)' : ''}</small>`, dec(r.decision), `<small>${esc(r.decision.reason)}</small>`, r.executorCalled ? pill('called', 'ok') : pill('not called', 'warn')]))}
    <h4 class="list-h">Every rule, for the first denied request</h4>
    ${(() => {
      const d = g.results.find((r) => r.decision.decision === 'deny' && r.decision.checks.length)?.decision;
      return d ? table(['Rule', 'Type', 'Result', 'Detail'], d.checks.map((c) => [`<code>${esc(c.rule)}</code>`, esc(c.type), !c.applies ? pill('n/a', 'warn') : c.pass ? pill('pass', 'ok') : pill('fail', 'bad'), `<small>${esc(c.detail)}</small>`])) : '<p class="muted">No request was denied with a rule trace.</p>';
    })()}
    <h4 class="list-h">Audit log</h4>
    <p class="check ${g.integrity.ok ? 'ok' : 'bad'}">${g.integrity.ok ? '✓' : '✗'} <b>${g.integrity.count} entries, hash chain ${g.integrity.ok ? 'intact' : 'BROKEN'}.</b> Head <code>${esc(g.integrity.head.slice(0, 24))}…</code>. Each request wrote a decision entry before the executor was considered, and an outcome entry after.</p>
    ${tamper ? `<p class="check ${tamper.integrity.ok ? 'bad' : 'ok'}">${tamper.integrity.ok ? '✗ The change was NOT detected.' : '✓ Tamper detected.'} In a copy of the log, ${esc(tamper.change)}. Verifying the copy: <b>${tamper.integrity.ok ? 'passes' : 'fails'}</b>${tamper.integrity.ok ? '' : `: ${esc(tamper.integrity.problems[0].problem)}`}.</p>` : ''}
    <details><summary>Show the log entries</summary><pre class="plain">${esc(g.log.map((e) => `${String(e.seq).padStart(2)}  ${e.kind.padEnd(9)} ${e.kind === 'decision' ? `${e.body.decision.toUpperCase().padEnd(5)} ${e.body.rule.id}` : e.body.status}  hash ${e.hash.slice(0, 12)}…  prev ${e.prev.slice(0, 12)}…`).join('\n'))}</pre></details>
    <p class="muted">Policy “${esc(g.policy.name)}”, SHA-256 <code>${esc(g.policy.hash.slice(0, 16))}…</code>. The log lives only for this request; the CLI can keep one in a file.</p>`,
});

export function mount(root, ctx) {
  root.innerHTML = '<div data-slot="testnet"></div><div data-slot="live"></div>';
  mountTestnet(root.querySelector('[data-slot=testnet]'), { slug: ctx.slug, kind: 'gatekeeper' });
  return livePanel(root.querySelector('[data-slot=live]'), ctx);
}
