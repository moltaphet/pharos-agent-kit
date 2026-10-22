// Saga Executor: content and a factory panel (simulator + recorded real-EVM fork runs).
import { esc, short } from '../util.js';
import { makePanel, pill } from '../panels/factory.js';
import { EXPLORER, REPO } from '../consts.js';

const VAULT = '0x047cD0a91E9B92ED979189a6C8A120bf280f02E5';

export const content = {
  tagline: 'Run dependent on-chain steps safely: verify each one, retry what is worth retrying, and undo everything if a step fails for good.',
  tools: ['chain', 'rpc'],
  skill: true,
  story: [
    'Some workflows cannot be left half-done. “Approve USDC, deposit it into a vault, send the shares to the treasury” is three transactions, and if the third fails after the second succeeded you are left holding shares and an open approval you never meant to keep. The Saga Executor is a Pharos Skill for exactly that: it runs the steps in order, and if one fails permanently it walks back through the finished ones and undoes them.',
    'Each step is checked twice before the next begins: the receipt must say success, and the resulting state must match (the allowance is what we set, shares were issued). Transient trouble such as a dropped transaction or an under-priced replacement is retried with backoff. A revert is never retried, because sending the same failing transaction again cannot fix it.',
    'The real proof is on a local fork of Pharos mainnet: a real vault (RockawayX USDC), real USDC, real EVM execution, and no real funds. Two runs are recorded below: one that completes, and one forced to fail at the last step that recovers fully. The interactive demo uses the same engine against an in-memory model so you can try the scenarios yourself, including one where the undo itself fails.',
  ],
  how: [
    { server: 'chain', tool: 'anvil fork of mainnet', text: 'Fork Pharos mainnet locally so the vault and USDC are the real contracts. Fund a test account by impersonating a USDC holder, on the fork only.' },
    { server: 'local', tool: 'step 1: approve', text: 'Approve the vault to take 100 USDC. Verify the allowance equals exactly that amount.' },
    { server: 'local', tool: 'step 2: deposit', text: 'Deposit into the vault. Verify shares were issued and remember how many (step 3 and the undo need that number).' },
    { server: 'local', tool: 'step 3: transfer', text: 'Send the shares to a treasury. Verify the treasury holds them. In the failure run this step sends them to the zero address and reverts.' },
    { server: 'local', tool: 'retry policy', text: 'Transient errors: retry up to 3 attempts, backoff 400 ms doubling to a 4 s cap. Reverts and failed checks: fail at once.' },
    { server: 'local', tool: 'compensation', text: 'On a permanent failure, undo confirmed steps newest first: bring the shares back, redeem them, revoke the approval. Check each undo too.' },
    { server: 'local', tool: 'final check', text: 'Compare end state with what the outcome requires: nothing left behind after a rollback, funds with the treasury after a success.' },
  ],
  decisions: [
    { title: 'Real EVM, no real funds', text: 'The hosted Chain MCP is read-only and we hold no key (and should not). An anvil fork gives real contract logic, real receipts and real revert reasons without touching anything real.' },
    { title: 'Verify state, not just the receipt', text: 'A transaction can succeed and still not do what the next step needs. Every step has a state check, and a failed check is a permanent failure.' },
    { title: 'Reverts are never retried', text: 'Only network and mempool trouble is transient. The classification is tested, so a revert cannot loop.' },
    { title: 'Honest about a failed undo', text: 'If a compensation fails, the saga reports “compensation-failed” and lists what is stranded, instead of claiming a rollback. The “stuck” scenario shows it.' },
    { title: 'A bug we caught in our own harness', text: 'The first recorded run called a completed saga “NOT CLEAN” because the check only knew about rollbacks, and a hand-written reset between runs corrupted the second run’s starting balance. The check now depends on the outcome, and every scenario starts from a fresh fork.' },
    { title: 'The injected fault is labelled', text: 'To show retries on demand the success run injects one transient error. It says so in the log (“injected fault”); it is not presented as a network failure.' },
  ],
  evidence: [
    'Three dependent steps (approve, deposit, transfer), each confirmed by its receipt and by a state check (allowance, shares, treasury balance) before the next starts.',
    'A defined retry policy: up to 3 attempts, exponential backoff, only for transient errors (underpriced, nonce, timeout, dropped, 429/503); reverts are never retried. Shown in the retry scenario and in the recorded success run.',
    'A compensation path (bring shares back, redeem, revoke approval) with a demo: the forced-failure run, recorded on a real-EVM fork and runnable here.',
    'A state log records every transition with a timestamp: step start, attempt, sent, confirmed, retry, failed, compensation, and the final outcome.',
    'One fully successful run and one forced-failure run with full recovery, both recorded on a fork of Pharos mainnet (reports/saga-runs.json) and both reproducible here.',
  ],
  files: ['skills/pharos-saga-executor/SKILL.md', 'skills/pharos-saga-executor/references/saga-executor.md', 'skills/pharos-saga-executor/scripts/saga.mjs', 'lib/saga.js', 'lib/saga-scenario.js', 'lib/saga-fork.js', 'lib/saga-sim.js'],
  run: {
    commands: ['node skills/pharos-saga-executor/scripts/saga.mjs', 'node skills/pharos-saga-executor/scripts/saga.mjs --scenario failure --out run.json'],
    sample: `=== vault-saga:failure → COMPENSATED ===
    0 ms  step:start                 approve
    8 ms  step:confirmed             approve
   19 ms  step:confirmed             deposit
16149 ms  step:failed                transfer  transaction reverted: ZeroAddress
16835 ms  compensation:confirmed     deposit
16839 ms  compensation:confirmed     approve
16839 ms  saga:compensated
final state: USDC 999999999 (started 1000000000, spent 1), account shares 0, allowance 0, treasury shares 0
expected: everything undone, nothing left behind → AS EXPECTED`,
  },
  verify: [
    { title: 'The vault is real', text: 'The deposit goes into the RockawayX USDC vault on Pharos mainnet. Open it on the explorer.', link: [`${EXPLORER}/address/${VAULT}`, 'RockawayX USDC on Pharosscan'] },
    { title: 'Reproduce the real-EVM run', text: 'Needs Foundry. This forks mainnet, runs both scenarios and exits 0 only if both ended as expected. Transaction hashes in the recorded run exist only on that local fork, so they will not appear on the explorer.', code: 'node skills/pharos-saga-executor/scripts/saga.mjs' },
    { title: 'Check the revert reason yourself', text: 'The forced failure is a real revert of the vault’s transfer to the zero address.', code: `anvil --fork-url https://rpc.pharos.xyz --port 8599 &\ncast call ${VAULT} "transfer(address,uint256)" 0x0000000000000000000000000000000000000000 1 --from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url http://127.0.0.1:8599   # ZeroAddress` },
    { title: 'Read the recorded runs', text: 'The recorded state logs and final checks are in the repository.', link: [`${REPO}/blob/main/reports/saga-runs.json`, 'reports/saga-runs.json'] },
  ],
};

const STATE_TONE = { confirmed: 'ok', compensated: 'info', failed: 'bad', 'compensation-failed': 'bad', 'not-undoable': 'warn', pending: '', running: 'info', compensating: 'warn' };
const STATUS_TONE = { completed: 'ok', compensated: 'warn', 'compensation-failed': 'bad' };

function runHtml(run, kind) {
  const f = run.finalCheck;
  const logRows = run.log
    .map((e) => `<tr><td class="num">${e.t} ms</td><td><code>${esc(e.event)}</code></td><td>${esc([e.step, e.attempt && `attempt ${e.attempt}`, e.waitMs && `wait ${e.waitMs} ms`].filter(Boolean).join(' · '))}</td><td>${e.txHash ? `<code title="${esc(e.txHash)}">${esc(short(e.txHash))}</code>` : ''}${e.error ? `<span class="bad">${esc(e.error)}</span>` : ''}${e.why ? ` <small class="muted">${esc(e.why)}</small>` : ''}</td></tr>`)
    .join('');
  return `
    <div class="verdict ${STATUS_TONE[run.status] ?? 'info'}">${esc(run.status.toUpperCase())}<small>${esc(run.name)} · ${kind}${run.description ? ` · ${esc(run.description)}` : ''}</small></div>
    <ol class="steps-list">${run.steps.map((s, i) => `<li><span class="si ${s.state === 'confirmed' || s.state === 'compensated' ? 'ok' : s.state === 'failed' || s.state === 'compensation-failed' ? 'bad' : ''}">${i + 1}</span><div><b>${esc(s.title)}</b> ${pill(s.state, STATE_TONE[s.state])} <span class="muted">${s.attempts} attempt${s.attempts === 1 ? '' : 's'}${s.compensationAttempts ? ` · undo took ${s.compensationAttempts}` : ''}</span>${s.error ? `<p class="bad">${esc(s.error)}</p>` : ''}${s.compensationTx ? `<p>undone in <code>${esc(short(s.compensationTx))}</code></p>` : ''}</div></li>`).join('')}</ol>
    ${run.injectedFault ? `<p class="check warn">Injected fault (to show the retry policy): ${esc(run.injectedFault)}.</p>` : ''}
    <h4 class="list-h">State log</h4><div class="scroll"><table class="tbl"><thead><tr><th>Time</th><th>Event</th><th>Step</th><th>Detail</th></tr></thead><tbody>${logRows}</tbody></table></div>
    <div class="check ${f.clean ? 'ok' : 'bad'}"><b>${f.clean ? '✓ As expected' : '✗ Not as expected'}:</b> ${esc(f.expected)}.<br>USDC ${esc(f.usdc)} (started ${esc(f.usdcBefore)}, spent ${esc(f.spent)}) · account shares ${esc(f.accountShares)} · allowance ${esc(f.allowance)} · treasury shares ${esc(f.treasuryShares)}</div>`;
}

export const mount = makePanel({
  intro: 'Pick a scenario. This runs the real engine against an in-memory model of the contracts (a simulation). The recorded runs on a real fork are one click away.',
  fields: [
    { name: 'scenario', label: 'Scenario', type: 'select', options: [['success', 'Success: all three steps'], ['retry', 'Retry: the deposit drops twice, then lands'], ['failure', 'Forced failure: step 3 reverts, undo steps 2 and 1'], ['stuck', 'Stuck: step 3 fails and the undo fails too'], ['recorded', 'Recorded real-EVM runs (anvil fork of mainnet)']], value: 'success' },
    { name: 'maxAttempts', label: 'Max attempts', type: 'number', value: '3', min: 1, step: 1, hint: '1 to 5 (retry policy)' },
  ],
  button: 'Run the saga',
  examples: [
    { label: 'Retry scenario, 2 attempts (retries run out)', values: { scenario: 'retry', maxAttempts: '2' } },
    { label: 'Forced failure with recovery', values: { scenario: 'failure', maxAttempts: '3' } },
    { label: 'Show the recorded real-EVM runs', values: { scenario: 'recorded', maxAttempts: '3' } },
  ],
  title: (v) => (v.scenario === 'recorded' ? 'Recorded fork runs' : `Saga: ${v.scenario}`),
  call: (v) => ({ params: { scenario: v.scenario, maxAttempts: v.maxAttempts } }),
  decode: (d) => (d.recorded ? d.recorded.runs.map((r) => ({ kind: 'decision', title: `${r.name}: ${r.status}`, detail: `${r.log.length} state-log entries; final check ${r.finalCheck.clean ? 'as expected' : 'NOT as expected'}` })) : d.simulated.log.filter((e) => /confirmed|failed|retry|completed|compensated|stuck/.test(e.event)).map((e) => ({ kind: e.event.includes('failed') ? 'error' : 'decision', title: `${e.event}${e.step ? `: ${e.step}` : ''}`, detail: [e.error, e.why, e.txHash].filter(Boolean).join(' · ') || undefined }))),
  verdict: (d) => (d.recorded ? 'ok' : d.simulated.status === 'completed' ? 'ok' : d.simulated.status === 'compensated' ? 'ok' : 'error'),
  summary: (d) => (d.recorded ? `${d.recorded.runs.length} recorded runs` : `${d.simulated.status} · ${d.simulated.steps.map((s) => s.state).join(' / ')}`),
  render: (d) =>
    d.recorded
      ? `<p class="muted">Recorded ${esc(d.recorded.recordedAt)} on a <b>${esc(d.recorded.network)}</b>. Transaction hashes exist only on that fork.</p>${d.recorded.runs.map((r) => `<div class="card" style="margin-bottom:14px">${runHtml(r, 'real EVM on a local fork')}</div>`).join('')}`
      : `<div class="card">${runHtml(d.simulated, 'simulation (in-memory model, same engine)')}</div>`,
});
