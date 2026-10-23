// Saga Executor: content and a live panel. Every run executes for real: a throwaway Vercel Sandbox forks Pharos
// mainnet with anvil and the saga runs as real EVM transactions; the page streams the run while it happens.
import { $, api, esc, short } from '../util.js';
import { createRunLog } from '../runlog.js';
import { ICONS } from '../art.js';
import { kv, pill } from '../panels/factory.js';
import { EXPLORER, REPO } from '../consts.js';

const VAULT = '0x047cD0a91E9B92ED979189a6C8A120bf280f02E5';

export const content = {
  tagline: 'Run dependent on-chain steps safely: verify each one, retry what is worth retrying, and undo everything if a step fails for good.',
  tools: ['chain', 'rpc'],
  skill: true,
  story: [
    'Some workflows cannot be left half-done. “Approve USDC, deposit it into a vault, send the shares to the treasury” is three transactions, and if the third fails after the second succeeded you are left holding shares and an open approval you never meant to keep. The Saga Executor is a Pharos Skill for exactly that: it runs the steps in order, and if one fails permanently it walks back through the finished ones and undoes them.',
    'Each step is checked twice before the next begins: the receipt must say success, and the resulting state must match (the allowance is what we set, shares were issued). Transient trouble such as a dropped transaction or an under-priced replacement is retried with backoff. A revert is never retried, because sending the same failing transaction again cannot fix it.',
    'Everything you run here is real. Each run boots a fresh, isolated machine on Vercel that forks Pharos mainnet with anvil, so the vault (RockawayX USDC), the USDC token and the EVM are the live ones, and the saga’s transactions are really executed, in about 30 seconds, with the log streaming into this page as it happens. Only the funds are fake: the fork exists for one run, the test account is funded on the fork alone, and nothing is ever sent to the real network. One scenario each shows a clean success, a retry, a failure that is fully undone, and an undo that gets stuck. Where we inject a fault to provoke the retry or the stuck undo, the log says so.',
  ],
  how: [
    { server: 'local', tool: 'Vercel Sandbox + anvil fork', text: 'Boot an isolated machine from a snapshot with Foundry, fork Pharos mainnet in it so the vault and USDC are the real contracts, and fund a test account by impersonating a USDC holder, on the fork only.' },
    { server: 'local', tool: 'step 1: approve', text: 'Approve the vault to take 100 USDC. Verify the allowance equals exactly that amount.' },
    { server: 'local', tool: 'step 2: deposit', text: 'Deposit into the vault. Verify shares were issued and remember how many (step 3 and the undo need that number).' },
    { server: 'local', tool: 'step 3: transfer', text: 'Send the shares to a treasury. Verify the treasury holds them. In the failure run this step sends them to the zero address and reverts.' },
    { server: 'local', tool: 'retry policy', text: 'Transient errors: retry up to 3 attempts, backoff 400 ms doubling to a 4 s cap. Reverts and failed checks: fail at once.' },
    { server: 'local', tool: 'compensation', text: 'On a permanent failure, undo confirmed steps newest first: bring the shares back, redeem them, revoke the approval. Check each undo too.' },
    { server: 'local', tool: 'final check', text: 'Compare end state with what the outcome requires: nothing left behind after a rollback, funds with the treasury after a success.' },
  ],
  decisions: [
    { title: 'Real EVM, no real funds', text: 'The hosted Chain MCP is read-only and we hold no mainnet key (and should not). The only key in this project is a throwaway wallet for Atlantic testnet, used by the Dry-Run and Batch runs and never by this skill. An anvil fork gives real contract logic, real receipts and real revert reasons without touching anything real.' },
    { title: 'Verify state, not just the receipt', text: 'A transaction can succeed and still not do what the next step needs. Every step has a state check, and a failed check is a permanent failure.' },
    { title: 'Reverts are never retried', text: 'Only network and mempool trouble is transient. The classification is tested, so a revert cannot loop.' },
    { title: 'Honest about a failed undo', text: 'If a compensation fails, the saga reports “compensation-failed” and lists what is stranded, instead of claiming a rollback. The “stuck” scenario shows it.' },
    { title: 'No simulator in the demo', text: 'An in-memory model proves the engine, not the contracts, so the demo does not use one. Vercel’s functions cannot run anvil, so each run starts a Vercel Sandbox (a throwaway microVM) from a snapshot with Foundry installed and streams its output back. The in-memory model survives only as a test double for the engine’s unit tests.' },
    { title: 'A public button that runs code must be locked down', text: 'A visitor can choose one of four fixed scenarios and a retry limit from 1 to 5, and nothing else; nothing they send reaches a command line (tested against injection attempts). The machine may only reach rpc.pharos.xyz and lives for at most 6 minutes. At most 2 run at once, a visitor can have only one running and must wait 15 seconds between runs, and there is an hourly cap; these limits are read from Vercel’s own sandbox listing (with a hashed visitor id, never the IP), so they hold across server instances.' },
    { title: 'Two things the sandbox taught us', text: 'The newest Foundry (anvil 1.8.6) cannot fork Pharos, because the Pharos RPC rejects a block parameter that version sends (“failed to parse block hash or number”); version 1.4.0 works, so the snapshot pins it. And a sandbox booted from a snapshot has no /vercel/sandbox directory, so our first version wrote its output nowhere and never reported progress; the run now uses absolute paths under /tmp.' },
    { title: 'A second bug: re-recording the runs failed, and it was gas', text: 'When we re-recorded the runs for this page, the forced-failure run ended stuck: the undo of the deposit reverted, four times out of four. A plain call of the same redeem succeeded, which ruled out the vault’s liquidity. A trace showed the transaction had used exactly its gas limit (263,262 of 263,262): the harness let anvil pick the limit, the estimate was exact, and this vault’s withdrawal needs more than the estimate because it calls into a lending market. The first recording had been clean only by luck (the redeem cost 144k gas then, 273k now). The harness now adds 30% headroom like a wallet does and reports “out of gas” instead of a bare revert, with tests for both.' },
    { title: 'A bug we caught in our own harness', text: 'The first recorded run called a completed saga “NOT CLEAN” because the check only knew about rollbacks, and a hand-written reset between runs corrupted the second run’s starting balance. The check now depends on the outcome, and every scenario starts from a fresh fork.' },
    { title: 'The injected fault is labelled', text: 'To show retries on demand the success run injects one transient error. It says so in the log (“injected fault”); it is not presented as a network failure.' },
  ],
  evidence: [
    'Three dependent steps (approve, deposit, transfer), each confirmed by its receipt and by a state check (allowance, shares, treasury balance) before the next starts.',
    'A defined retry policy: up to 3 attempts, exponential backoff, only for transient errors (underpriced, nonce, timeout, dropped, 429/503); reverts are never retried. Shown in the retry scenario and in the recorded success run.',
    'A compensation path (bring shares back, redeem, revoke approval) with a demo: the forced-failure scenario runs for real on a fork, right here on this page.',
    'A state log records every transition with a timestamp: step start, attempt, sent, confirmed, retry, failed, compensation, and the final outcome.',
    'Four real scenarios run on demand against a fork of Pharos mainnet (success, retry, forced failure with full recovery, stuck undo), plus the earlier success and failure runs recorded in reports/saga-runs.json with their provenance.',
  ],
  files: ['skills/pharos-saga-executor/SKILL.md', 'skills/pharos-saga-executor/references/saga-executor.md', 'skills/pharos-saga-executor/scripts/saga.mjs', 'lib/saga.js', 'lib/saga-scenario.js', 'lib/saga-fork.js', 'lib/saga-sandbox.js', 'scripts/build-saga-snapshot.mjs', 'config/saga-snapshot.json'],
  run: {
    commands: ['node skills/pharos-saga-executor/scripts/saga.mjs', 'node skills/pharos-saga-executor/scripts/saga.mjs --scenario failure --out run.json', 'node skills/pharos-saga-executor/scripts/saga.mjs --scenario stuck --stream   # JSON lines, as the web page reads them'],
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
    { title: 'Reproduce a run on your own machine', text: 'Needs Foundry (anvil 1.4.0 works; the newest versions cannot fork Pharos). This forks mainnet, runs both recorded scenarios and exits 0 only if both ended as expected. Transaction hashes exist only on a fork, so they will not appear on the explorer.', code: 'node skills/pharos-saga-executor/scripts/saga.mjs' },
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

const SCENARIO_LABELS = {
  plain: 'Success: all three steps',
  retry: 'Retry: the deposit is dropped twice, then lands',
  failure: 'Forced failure: step 3 reverts, undo steps 2 and 1',
  stuck: 'Stuck: step 3 fails and the undo of the deposit is blocked',
};
const EXAMPLES = [
  ['plain', 'Success'],
  ['retry', 'Retry (2 injected drops)'],
  ['failure', 'Forced failure with recovery'],
  ['stuck', 'Stuck undo'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = 2500;

export function mount(root, { params }) {
  let cancelled = false;
  root.innerHTML = `
    <p class="panel-intro">Each run starts a fresh, isolated machine that forks Pharos mainnet and executes the saga as real EVM transactions. It takes about 30 seconds and the log streams in below as it happens. Faults we inject (retry, stuck) are labelled.</p>
    <form class="form" id="f" autocomplete="off">
      <label class="grow">Scenario<select id="f-scenario">${Object.entries(SCENARIO_LABELS).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <label>Max attempts<input id="f-attempts" type="number" min="1" max="5" step="1" value="3"><small class="hint">1 to 5 (retry policy)</small></label>
      <div class="actions">
        <button class="primary" id="go">${ICONS.play} Run for real</button>
        <button class="ghost" type="button" id="recorded">Show the recorded runs</button>
      </div>
    </form>
    <div class="chips" role="group" aria-label="Examples">${EXAMPLES.map(([v, l]) => `<button type="button" class="chip" data-sc="${v}">${esc(l)}</button>`).join('')}</div>
    <div id="out" class="out" aria-live="polite"><div class="idle">Pick a scenario and press “Run for real”. A new machine starts, forks Pharos mainnet, and the transactions appear here one by one.</div></div>
    <div id="log"></div>`;

  const out = $('#out', root);
  const go = $('#go', root);
  const recordedBtn = $('#recorded', root);
  const log = createRunLog($('#log', root), { task: 'saga-executor' });
  const scenarioEl = $('#f-scenario', root);
  const attemptsEl = $('#f-attempts', root);
  if (SCENARIO_LABELS[params.scenario]) scenarioEl.value = params.scenario;
  const busy = (b) => { go.disabled = b; recordedBtn.disabled = b; };

  const eventRow = (e) => `<tr><td class="num">${e.t} ms</td><td><code>${esc(e.event)}</code></td><td>${esc([e.step, e.attempt && `attempt ${e.attempt}`, e.waitMs && `wait ${e.waitMs} ms`].filter(Boolean).join(' · '))}</td><td>${e.txHash ? `<code title="${esc(e.txHash)}">${esc(short(e.txHash))}</code>` : ''}${e.error ? `<span class="bad">${esc(e.error)}</span>` : ''}${e.why ? ` <small class="muted">${esc(e.why)}</small>` : ''}</td></tr>`;
  const KEY = /confirmed|failed|retry|completed|compensated|stuck/;

  async function runReal(scenario, maxAttempts) {
    const r = log.run(`Real run: ${scenario}`);
    r.add({ kind: 'ui', title: 'You started a real run', request: { scenario, maxAttempts } });
    out.innerHTML = '<div class="idle">Starting a machine…</div>';
    busy(true);
    const t0 = performance.now();
    try {
      const sent = r.now();
      const res = await api('run', { slug: 'saga-executor', real: 'start', scenario, maxAttempts });
      const { started } = res.data;
      r.add({ kind: 'http', title: `GET /api/run (start) answered ${res.status}`, ms: res.ms, at: sent, detail: `machine ${started.id}` });
      out.innerHTML = `
        <div class="card" id="live">
          <div class="verdict info">RUNNING<small id="phase">Starting the machine…</small></div>
          <p class="muted"><span id="elapsed">0</span> s elapsed · machine <code>${esc(started.id)}</code> · it is removed when the run ends (6 minutes at most)</p>
          <div class="scroll"><table class="tbl"><thead><tr><th>Time</th><th>Event</th><th>Step</th><th>Detail</th></tr></thead><tbody id="events"></tbody></table></div>
        </div>`;
      const tick = setInterval(() => { const el = $('#elapsed', root); if (el) el.textContent = String(Math.round((performance.now() - t0) / 1000)); }, 500);
      let from = 0;
      let failures = 0;
      try {
        for (;;) {
          if (cancelled) return;
          await sleep(POLL_MS);
          let st;
          try {
            st = (await api('run', { slug: 'saga-executor', real: 'status', id: started.id, from })).data.status;
            failures = 0;
          } catch (err) {
            if (++failures >= 4) throw err;
            continue;
          }
          const phase = $('#phase', root);
          if (phase) phase.textContent = st.phase;
          const body = $('#events', root);
          for (const e of st.events) {
            body?.insertAdjacentHTML('beforeend', eventRow(e));
            if (KEY.test(e.event)) // A failed step is usually the point of the scenario, so it is a negative check in the log, not an error of the run.
            r.add({ kind: 'decision', ok: !e.event.includes('failed'), title: `${e.event}${e.step ? `: ${e.step}` : ''}`, detail: [e.error, e.why, e.txHash].filter(Boolean).join(' · ') || undefined, at: Math.round(performance.now() - t0) });
          }
          from = st.total;
          if (st.state === 'running') continue;
          if (st.state !== 'done') throw new Error(st.error ?? st.message ?? `the run ${st.state}`);
          const rec = st.result;
          const run = rec.runs[0];
          out.innerHTML = `${provenanceHtml(rec, 'Ran on a throwaway machine just now')}<div class="card">${runHtml(run, 'real EVM on an anvil fork of Pharos mainnet, started for this click')}</div>`;
          r.end({ status: run.finalCheck.clean ? 'ok' : 'error', summary: `${run.status} · ${run.steps.map((x) => x.state).join(' / ')} · ${Math.round((performance.now() - t0) / 1000)} s` });
          return;
        }
      } finally {
        clearInterval(tick);
      }
    } catch (err) {
      r.add({ kind: 'error', title: err.message, error: err.detail ?? err.message });
      r.end({ status: 'error', summary: err.message });
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      busy(false);
    }
  }

  async function showRecorded() {
    const r = log.run('Recorded runs');
    busy(true);
    try {
      const sent = r.now();
      const res = await api('run', { slug: 'saga-executor', scenario: 'recorded' });
      r.add({ kind: 'http', title: `GET /api/run answered ${res.status}`, ms: res.ms, at: sent, detail: res.url });
      const rec = res.data.recorded;
      out.innerHTML = `${provenanceHtml(rec, 'Recorded earlier')}${rec.runs.map((x) => `<div class="card" style="margin-bottom:14px">${runHtml(x, 'real EVM on a local anvil fork')}</div>`).join('')}`;
      r.end({ status: 'ok', summary: `${rec.runs.length} recorded runs` });
    } catch (err) {
      r.add({ kind: 'error', title: err.message, error: err.message });
      r.end({ status: 'error', summary: err.message });
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      busy(false);
    }
  }

  $('#f', root).onsubmit = (e) => { e.preventDefault(); runReal(scenarioEl.value, attemptsEl.value); };
  recordedBtn.onclick = showRecorded;
  root.querySelectorAll('.chip').forEach((b) => (b.onclick = () => { scenarioEl.value = b.dataset.sc; runReal(b.dataset.sc, attemptsEl.value); }));
  return () => { cancelled = true; };
}

function provenanceHtml(rec, when) {
  const p = rec.provenance;
  return `<p class="muted">${esc(when)}${rec.recordedAt ? ` (${esc(rec.recordedAt)})` : ''}: <b>${esc(rec.network)}</b>. Transaction hashes exist only on that fork and will not appear on the explorer.</p>${
    p
      ? `<details class="prov"><summary>Where these numbers came from</summary>${kv([
          ['Command', `<code>${esc(p.command)}</code>`],
          ['Forked from', `${esc(p.forkRpc)} at block ${Object.entries(p.forkBlocks).map(([k, b]) => `${b.toLocaleString('en-US')} (${esc(k)} run)`).join(', ')}`],
          ['Tool', esc(p.anvil)],
          ['Vault', `<code>${esc(p.contracts.vault)}</code> (RockawayX USDC, Morpho Vault V2)`],
          ['USDC', `<code>${esc(p.contracts.usdc)}</code>, funded from ${esc(p.contracts.usdcSource)}`],
          ['Accounts', esc(p.accounts)],
        ])}</details>`
      : ''
  }`;
}
