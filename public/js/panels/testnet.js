// "Real transactions on Pharos Atlantic testnet": the recorded run (reports/testnet-runs.json) shown with a live check.
// The API re-reads every transaction from the chain when this card loads, so each hash carries a badge that says whether
// the chain agrees right now with what was recorded.
import { api, esc, short } from '../util.js';
import { kv, pill, table } from './factory.js';

const EXPLORER = 'https://atlantic.pharosscan.xyz';
const n = (x) => Number(x).toLocaleString('en-US');
const phrs = (wei, d = 6) => `${(Number(wei) / 1e18).toFixed(d)} PHRS`;
const sign = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}%`;

const txLink = (hash, verification) => {
  const v = verification.results[hash];
  const badge = v?.verified ? '<span class="ok" title="The chain agrees with the recorded status, gas, block and value">✓</span>' : `<span class="bad" title="${esc(v?.reason ?? 'not checked')}">✗</span>`;
  return `<a href="${EXPLORER}/tx/${esc(hash)}" target="_blank" rel="noopener"><code>${esc(short(hash))}</code></a> ${badge}`;
};

function header(rec, ver) {
  const all = ver.verifiedCount === ver.total;
  return `
    <p class="check ${all ? 'ok' : 'bad'}">${all ? '✓' : '✗'} <b>${ver.verifiedCount} of ${ver.total} transactions verified on-chain just now</b> (${esc(ver.checkedAt.slice(11, 19))} UTC, testnet block ${n(ver.head)}). Each hash below was read back from the public Atlantic RPC and compared with what we recorded: status, gas used, block and value.</p>
    ${kv([
      ['Network', `${esc(rec.network.name)} · chain ${rec.network.chainId}`],
      ['Sender', `<a href="${EXPLORER}/address/${esc(rec.wallet)}" target="_blank" rel="noopener"><code>${esc(rec.wallet)}</code></a> <small class="muted">a throwaway wallet, testnet only</small>`],
      ['Recorded', esc(rec.recordedAt)],
      ['Spent', `${phrs(rec.budget.spentWei)} of test tokens (wallet holds ${phrs(ver.walletBalanceWei, 4)} now)`],
    ])}`;
}

function dryRunView(rec, ver) {
  const rows = rec.dryRun.cases.map((c) => {
    const r = c.report;
    const said = `${pill(r.verdict === 'go' ? 'GO' : 'BLOCKED', r.verdict === 'go' ? 'ok' : 'bad')} ${esc(r.summary)}${r.gas ? `<br><small class="muted">estimated ${n(r.gas.units)} gas</small>` : ''}`;
    const did = c.sent
      ? `${txLink(c.sent.hash, ver)} ${pill(c.sent.status, c.sent.status === 'success' ? 'ok' : 'warn')}<br><small class="muted">${n(c.sent.gasUsed)} gas used${c.check?.gasErrorPct != null ? ` (estimate off by ${c.check.gasErrorPct.toFixed(1)}%)` : ''}</small>`
      : '<span class="muted">not sent: the simulation blocked it</span>';
    return [esc(c.title), said, did, c.check?.matched ? pill('✓ matched', 'ok') : pill('✗ differs', 'bad')];
  });
  return `
    <h4 class="list-h">What the simulation said, and what the chain then did</h4>
    ${table(['Case', 'Simulation (before sending)', 'The chain (after)', ''], rows)}
    <p class="muted">The second blocked case was sent anyway, once, with a fixed gas limit, to prove the prediction: it really reverted, and cost ${n(rec.dryRun.cases.find((c) => c.id === 'token-revert').sent.gasUsed)} gas that a blocked transaction would never have spent.</p>`;
}

function batchView(rec, ver) {
  const { transfers, calls, exclude } = rec.batch;
  const txs = (list) => list.map((t) => txLink(t.hash, ver)).join('<br>');
  const cmp = (c, noun) => {
    const rc = c.realComparison;
    const worse = rc.gasSaved < 0;
    const pl = rc.plannedGasSavedPct;
    const planned = pl < 0 ? `it would cost ${Math.abs(pl).toFixed(1)}% more` : `it would save ${pl.toFixed(1)}%`;
    const gap = Math.abs(pl - rc.gasSavedPct);
    return `<p class="check ${worse ? 'warn' : 'ok'}"><b>${worse ? `Batching cost ${Math.abs(rc.gasSavedPct).toFixed(1)}% MORE gas` : `Batching saved ${rc.gasSavedPct.toFixed(1)}% of the gas`}</b> (${n(rc.gasSeparate)} → ${n(rc.gasBatched)}). Before sending, the planner predicted ${planned}${gap > 5 ? `: the right direction, but off by ${gap.toFixed(0)} points` : `: within ${Math.max(1, Math.ceil(gap))} point${gap > 1 ? 's' : ''} of the real result`}.${noun}</p>`;
  };
  return `
    <h4 class="list-h">Three plain transfers: one by one vs one Multicall3 transaction</h4>
    ${table(['', 'Transactions', 'Gas used'], [['Sent one by one', txs(transfers.separate.transactions), n(transfers.separate.totalGas)], ['As one batch', txLink(transfers.batched.transaction.hash, ver), n(transfers.batched.transaction.gasUsed)]])}
    ${cmp(transfers, ' Each inner transfer pays the call overhead, and each already cost only the 21,000 base, so there was nothing to save.')}
    <h4 class="list-h">Three calls to a contract we deployed: one by one vs one batch</h4>
    <p class="muted">Contract <a href="${EXPLORER}/address/${esc(calls.contract)}" target="_blank" rel="noopener"><code>${esc(short(calls.contract))}</code></a>, deployed in ${txLink(calls.deployment.hash, ver)}. Its <code>ping(id)</code> does not depend on the caller, which is what makes a call safe to batch.</p>
    ${table(['', 'Transactions', 'Gas used'], [['Sent one by one', txs(calls.separate.transactions), n(calls.separate.totalGas)], ['As one batch', txLink(calls.batched.transaction.hash, ver), n(calls.batched.transaction.gasUsed)]])}
    ${cmp(calls, ` ${calls.batched.everyCallLanded ? 'All three calls landed (each counter reads 1).' : '<b>Not every call landed.</b>'} The saving is the two base costs of 21,000 that the batch does not pay, minus its overhead.`)}
    <h4 class="list-h">Policy “exclude”: an action that cannot work is left out, the rest is sent</h4>
    <p>${esc(exclude.plan.summary)} ${exclude.excluded.map((x) => `<br><small class="muted">${esc(x.id)}: ${esc(x.why)}</small>`).join('')}</p>
    <p>Sent as ${txLink(exclude.transaction.hash, ver)} (${n(exclude.transaction.gasUsed)} gas). ${exclude.recipientsFunded ? '✓ Both remaining recipients received their funds.' : '✗ A recipient did not receive its funds.'}</p>`;
}

function guardianView(rec, ver) {
  const cards = rec.runs.map((run) => {
    const fired = run.decision === 'fire';
    const rows = run.conditions.map((c) => [`<code>${esc(c.id)}</code>`, esc(c.detail ?? String(c.value)), `${esc(c.op)} ${n(c.threshold)}`, c.pass ? pill('met', 'ok') : pill('not met', 'bad')]);
    const action = run.action
      ? `<p class="check ok">✓ The guardian <b>fired</b>, and the action really happened: ${txLink(run.action.tx.hash, ver)} (${n(run.action.tx.gasUsed)} gas) called <code>ping(${esc(String(run.action.id))})</code> on the counter contract. Afterwards the chain says that counter reads <b>${esc(run.counterAfter)}</b>.</p>`
      : `<p class="check ok">✓ The guardian <b>held</b>: ${run.passed} of ${run.total} conditions were met, so <b>nothing was sent</b>. The counter for this run's id reads <b>${esc(run.counterAfter)}</b> on the chain, as it should.</p>`;
    return `
      <div class="verdict ${fired ? 'ok' : 'warn'}">${fired ? 'FIRE' : 'HOLD'}<small>${esc(run.title)} · read at testnet block ${n(run.block)}</small></div>
      ${table(['Condition', 'Value read from the chain', 'Rule', ''], rows)}
      ${action}`;
  });
  return `<h4 class="list-h">Two runs of the same guardian, on the real testnet</h4>${cards.join('')}`;
}

function gatekeeperView(rec, ver, extra) {
  const rows = rec.results.map((r) => {
    const deny = r.decision === 'deny';
    const said = `${pill(deny ? 'DENY' : 'ALLOW', deny ? 'bad' : 'ok')} <code>${esc(r.rule.id)}</code><br><small class="muted">${esc(r.reason)}</small>`;
    const did = r.executed
      ? `${txLink(r.transaction.hash, ver)} ${pill(r.transaction.status, 'ok')}`
      : '<span class="muted">never sent</span>';
    return [esc(r.title), said, did, r.matched ? pill('✓ as expected', 'ok') : pill('✗ differs', 'bad')];
  });
  const p = rec.proof;
  const audit = extra.auditNow;
  const balanceRows = p.balances.map((b, i) => [esc(b.label), `<a href="${EXPLORER}/address/${esc(b.address)}" target="_blank" rel="noopener"><code>${esc(short(b.address))}</code></a>`, phrs(b.expectedWei, 4), phrs(b.chainWei, 4), extra.balancesNow[i]?.matchesRecorded ? pill('✓ still true now', 'ok') : pill('✗ changed since', 'bad')]);
  return `
    <h4 class="list-h">${rec.summary.requests} requests through the gate: ${rec.summary.allowed} allowed and sent, ${rec.summary.denied} denied and never sent</h4>
    ${table(['Request', 'The gate said', 'The chain (after)', ''], rows)}
    <p class="check ${rec.summary.deniedThatWereExecuted === 0 ? 'ok' : 'bad'}">${rec.summary.deniedThatWereExecuted === 0 ? '✓' : '✗'} <b>Denied requests that were executed: ${rec.summary.deniedThatWereExecuted}.</b> Denials by rule: ${Object.entries(rec.summary.deniedByRule).map(([k, v]) => `<code>${esc(k)}</code> × ${v}`).join(', ')}.</p>
    <h4 class="list-h">Asked of the chain afterwards: did the denied requests happen?</h4>
    ${table(['Account', 'Address', 'Allowed to receive', 'Holds on chain', ''], balanceRows)}
    <p class="check ${p.walletNonce.ok ? 'ok' : 'bad'}">${p.walletNonce.ok ? '✓' : '✗'} The sending wallet's nonce grew from ${esc(p.walletNonce.before)} to ${esc(p.walletNonce.after)}: exactly ${p.walletNonce.allowedRequests} transactions, the number of allowed requests. A denied request that had slipped through would have used a nonce too.</p>
    <p class="check ${p.counter.ok ? 'ok' : 'bad'}">${p.counter.ok ? '✓' : '✗'} The denied call <code>Counter.ping(${esc(String(p.counter.id))})</code> never landed: that counter reads <b>${esc(p.counter.chain)}</b> on the chain.</p>
    <h4 class="list-h">Policies in force</h4>
    ${table(['Policy', 'SHA-256', 'Rules, in the order they are checked'], Object.values(rec.policies).map((x) => [esc(x.source.name), `<code>${esc(x.hash.slice(0, 16))}…</code>`, x.source.rules.map((r) => `<code>${esc(r.id)}</code> <small class="muted">${esc(r.type)}</small>`).join('<br>')]))}
    <h4 class="list-h">Audit log</h4>
    <p class="check ${audit.ok ? 'ok' : 'bad'}">${audit.ok ? '✓' : '✗'} <b>The hash chain of all ${audit.count} entries was re-checked just now: ${audit.ok ? 'intact' : 'BROKEN'}.</b> Head <code>${esc(audit.head.slice(0, 24))}…</code>. ${audit.ok ? '' : esc(audit.problems[0].problem)}</p>
    <details><summary>Show the ${audit.count} entries</summary><pre class="plain">${esc(rec.auditLog.entries.map((e) => `${String(e.seq).padStart(2)}  ${e.kind.padEnd(9)} ${e.kind === 'decision' ? `${e.body.decision.toUpperCase().padEnd(5)} ${e.body.rule.id}` : `${e.body.status}`}  hash ${e.hash.slice(0, 12)}… prev ${e.prev.slice(0, 12)}…`).join('\n'))}</pre></details>`;
}

function sagaView(rec, ver) {
  const pairs = {};
  for (const s of rec.scenarios) (pairs[s.key] ??= {})[s.engine === 'current' ? 'now' : 'before'] = s;
  const tx = (s) => s.transactions.map((t) => `${esc(t.tag)}: ${txLink(t.hash, ver)}`).join('<br>');
  const readings = (s) => s.chainReadings.map((x) => `${esc(x.step)} = <b>${esc(x.balance)}</b>`).join(' · ');
  const col = (s, label, tone) => `
    <div class="card" style="margin:0">
      <h4 class="list-h">${label} ${pill(s.status, tone)}</h4>
      <p class="muted">Transactions, in the order they were sent (${s.transactions.length}):</p>
      <p>${tx(s)}</p>
      <p>What the chain’s ledger says afterwards: ${readings(s)}</p>
      ${s.checks.map((c) => `<p class="check ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.what)}</p>`).join('')}
    </div>`;
  return `
    <p class="muted">A tiny <a href="${EXPLORER}/address/${esc(rec.ledger.address)}" target="_blank" rel="noopener"><code>Ledger</code></a> contract counts how many times each step ran: the step is <code>credit(id)</code>, its undo is <code>debit(id)</code>. Everything below was sent and mined on Atlantic. The only thing injected is the network trouble (a receipt lookup that times out after the transaction is already mined). Each case ran twice: with the engine as it was before the fix, and with the current one.</p>
    <p class="check ${rec.summary.passed === rec.summary.checks ? 'ok' : 'bad'}">${rec.summary.passed === rec.summary.checks ? '✓' : '✗'} <b>${rec.summary.passed} of ${rec.summary.checks} checks passed</b> on ${rec.transactions.length} real transactions.</p>
    ${Object.values(pairs).map((p) => `
      <h4 class="list-h">${esc(p.now.title)}</h4>
      <div class="two-col">${col(p.before, 'Before the fix', 'bad')}${col(p.now, 'Now', 'ok')}</div>`).join('')}
    <p class="muted">Check it yourself: <code>cast call ${esc(rec.ledger.address)} "balance(uint256)(uint256)" &lt;id&gt; --rpc-url ${esc(rec.network.rpc)}</code>. The ids are in <a href="https://github.com/moltaphet/pharos-agent-kit/blob/main/reports/testnet-saga.json" target="_blank" rel="noopener">reports/testnet-saga.json</a>.</p>`;
}

export function mountTestnet(el, { slug, kind }) {
  el.innerHTML = '<section class="card tn"><h3>Real transactions on Pharos Atlantic testnet</h3><div class="idle" data-role="body">Reading every recorded transaction back from the chain…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, real: 'testnet' })
    .then(({ data }) => {
      const { report: rec, verification: ver } = data.testnet;
      const extra = data.testnet;
      body.classList.remove('idle');
      const script = kind === 'guardian' ? 'testnet-guardian' : kind === 'gatekeeper' ? 'testnet-gatekeeper' : kind === 'saga' ? 'testnet-saga' : 'testnet-run';
      body.innerHTML = header(rec, ver) + (kind === 'saga' ? sagaView(rec, ver) : kind === 'batch' ? batchView(rec, ver) : kind === 'guardian' ? guardianView(rec, ver) : kind === 'gatekeeper' ? gatekeeperView(rec, ver, extra) : dryRunView(rec, ver)) + `<p class="muted">Re-run it yourself with your own funded testnet key: <code>node scripts/${script}.mjs --live</code> (a rehearsal on a free local fork is the default).</p>`;
    })
    .catch((err) => {
      body.classList.remove('idle');
      body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    });
}
