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
    return `<p class="check ${worse ? 'warn' : 'ok'}"><b>${worse ? `Batching cost ${Math.abs(rc.gasSavedPct).toFixed(1)}% MORE gas` : `Batching saved ${rc.gasSavedPct.toFixed(1)}% of the gas`}</b> (${n(rc.gasSeparate)} → ${n(rc.gasBatched)}). The planner predicted ${sign(rc.plannedGasSavedPct * 1)} before sending${worse ? (Math.abs(rc.plannedGasSavedPct - rc.gasSavedPct) > 5 ? ', so it overstated the cost but pointed the same way' : '') : ', within a few points of the real result'}.${noun}</p>`;
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

export function mountTestnet(el, { slug, kind }) {
  el.innerHTML = '<section class="card tn"><h3>Real transactions on Pharos Atlantic testnet</h3><div class="idle" data-role="body">Reading every recorded transaction back from the chain…</div></section>';
  const body = el.querySelector('[data-role=body]');
  api('run', { slug, real: 'testnet' })
    .then(({ data }) => {
      const { report: rec, verification: ver } = data.testnet;
      body.classList.remove('idle');
      body.innerHTML = header(rec, ver) + (kind === 'batch' ? batchView(rec, ver) : dryRunView(rec, ver)) + `<p class="muted">Re-run it yourself with your own funded testnet key: <code>node scripts/testnet-run.mjs --live</code> (a rehearsal on a free local fork is the default).</p>`;
    })
    .catch((err) => {
      body.classList.remove('idle');
      body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    });
}
