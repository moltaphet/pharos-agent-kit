import { createWallet } from './wallet.js';
import { createLedger } from './storage.js';
import { esc, short } from '../util.js';

const $ = (selector) => document.querySelector(selector);
const wallet = createWallet();
let ledger;
try { ledger = createLedger(globalThis.localStorage); }
catch { ledger = createLedger({ getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); }, removeItem: () => {} }); }
let config = null;
let account = null;
let walletChain = null;
let inspecting = false;
let plan = null;
let revision = 0;
let lastTrace = null;
let chainEvents = [];
let busy = false;
const polls = new Set();
const STATUS = { confirmed: 'Confirmed', reverted: 'Reverted', mismatch: 'Does not match', pending: 'Pending confirmation', 'awaiting-wallet': 'Wallet request unresolved', uncertain: 'Check wallet activity' };
const KIND = { payment: 'Invoice payment', approval: 'Token approval', faucet: 'Test-token mint' };

async function api(action, body = null) {
  const response = await fetch(`/api/treasury?action=${encodeURIComponent(action)}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) } : undefined);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error ?? `The server could not complete this request (HTTP ${response.status}).`);
  lastTrace = result.trace ?? null;
  return result.data;
}

function message(text = '', error = false) {
  const target = $(error ? '#page-error' : '#page-message');
  $('#page-error').hidden = true;
  $('#page-message').hidden = true;
  target.textContent = text;
  target.hidden = !text;
}

function invoiceInput() {
  return { reference: $('#invoice-reference').value.trim(), recipient: $('#invoice-recipient').value.trim(), amount: $('#invoice-amount').value.trim() };
}

function policyInput() {
  return { maxAmount: $('#policy-max').value.trim(), allowlist: $('#policy-allowlist').value.split(/[\n,]+/).map((a) => a.trim()).filter(Boolean) };
}

function payer() { return inspecting ? config?.demo?.payer : account; }

function invalidate() {
  revision++;
  plan = null;
  $('#signing-area').hidden = true;
  $('#agent-state').textContent = 'Review needed';
  syncControls();
}

function syncControls() {
  const ready = Boolean(config?.router && config?.token?.address);
  const connected = Boolean(account);
  const correctNetwork = connected && walletChain === Number(config?.chainId);
  const unresolved = ready && connected && ledger.pending(config, account).length > 0;
  $('#connect-wallet').disabled = busy || !ready;
  $('#connect-wallet').textContent = connected ? inspecting ? 'Use my connected wallet ↗' : `${short(account)} · Connected` : 'Connect wallet ↗';
  $('#connect-wallet').title = account ?? 'Connect your wallet';
  $('#switch-network').hidden = !connected || correctNetwork;
  $('#switch-network').disabled = busy;
  $('#review-invoice').disabled = busy || !ready || !(payer());
  $('#invoice-fields').disabled = busy;
  $('#inspect-example').disabled = busy || !config?.demo?.payer;
  $('#hero-inspect').disabled = busy || !config?.demo?.payer;
  $('#show-proof').disabled = busy || !config?.demo?.hash;
  $('#chain-mine').disabled = !connected;
  if (config) updateJourney();
  $('#mode-label').textContent = inspecting ? 'Recorded payer · read-only' : connected ? 'Your connected wallet' : 'Read-only until connected';
  $('#wallet-detail').textContent = inspecting ? 'Inspecting the recorded payer. Connect your wallet to make your own payment.' : connected ? correctNetwork ? 'Your signatures stay in your wallet.' : 'Switch networks before requesting a signature.' : 'Or inspect the recorded example without a wallet.';
  $('#funding-area').hidden = !connected || inspecting || !config?.faucetTransaction;
  $('#mint-tokens').disabled = busy || !correctNetwork || unresolved || !ledger.available(config);
  const ackNeeded = Boolean(plan?.acknowledgement?.required) && !$('#ack')?.checked;
  const canSign = plan && !inspecting && correctNetwork && !unresolved && !ackNeeded && ledger.available(config) && ['ready', 'needs-approval'].includes(plan.status);
  $('#sign-transaction').disabled = busy || !canSign;
  if (plan && ['ready', 'needs-approval'].includes(plan.status)) {
    $('#signing-area').hidden = false;
    $('#sign-transaction').textContent = plan.status === 'needs-approval' ? 'Approve exact amount in wallet ↗' : 'Pay invoice in wallet ↗';
    $('#signing-hint').textContent = ackNeeded && !inspecting && connected && correctNetwork ? 'Confirm the recipient above first. The agent asks because of what it found about this address.' : inspecting ? 'This is an inspection of the recorded payer. Connect your own wallet to sign.' : !connected ? 'Connect your wallet to sign this payment.' : !correctNetwork ? 'Switch your wallet to Atlantic Testnet before signing.' : unresolved ? 'An earlier transaction is unresolved. Check it in the receipt ledger first.' : !ledger.available(config) ? 'Enable browser storage before signing so pending transactions can be recovered.' : plan.status === 'needs-approval' ? 'First allow the router to use this exact amount of tUSDC. The invoice is reviewed again after approval.' : 'Check the recipient and amount in your wallet. Your signature submits this testnet payment.';
  }
}

function updateJourney() {
  const mine = account ? ledger.read(config ?? {}).filter((row) => String(row.payer).toLowerCase() === account.toLowerCase()) : [];
  const connected = Boolean(account);
  const done = {
    connect: connected && !inspecting,
    network: connected && !inspecting && walletChain === Number(config?.chainId),
    tokens: mine.some((row) => row.kind === 'faucet' && row.status === 'confirmed') || (plan?.balances && Number(plan.balances.token) > 0 && !inspecting),
    review: Boolean(plan && !inspecting && ['ready', 'needs-approval'].includes(plan.status)) || mine.some((row) => row.kind === 'payment' && row.status === 'confirmed'),
    pay: mine.some((row) => row.kind === 'payment' && row.status === 'confirmed'),
  };
  let current = null;
  document.querySelectorAll('#journey li').forEach((item) => {
    const isDone = Boolean(done[item.dataset.step]);
    if (!isDone && !current) current = item;
    item.classList.toggle('done', isDone);
    item.classList.toggle('current', item === current);
    if (item === current) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  });
}

function renderEvidence() {
  const link = (url, label) => externalLink(url, label);
  const items = [
    ['Network', 'Atlantic Testnet · chain 688689'],
    ['Invoice router', link(`${config.explorer}/address/${config.router}`, short(config.router)) + (config.verification?.router ? ` · ${link(config.verification.router, 'source verified ↗')}` : '')],
    [`${config.token.symbol} demo token`, link(`${config.explorer}/address/${config.token.address}`, short(config.token.address)) + (config.verification?.token ? ` · ${link(config.verification.token, 'source verified ↗')}` : '')],
  ];
  if (config.demo?.hash) items.push(['Verified payment', link(`${config.explorer}/tx/${config.demo.hash}`, short(config.demo.hash)) + ' · 9 checks']);
  if (config.video && safeUrl(config.video)) items.push(['Demo video', link(config.video, 'Watch the walkthrough ↗')]);
  $('#evidence-grid').innerHTML = items.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${name === 'Network' ? esc(value) : value}</dd></div>`).join('');
}

let chainToken = 0;
function amountText(raw, decimals) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${value / base}${fraction ? '.' + fraction : ''}`;
}

async function loadChain() {
  if (!config) return;
  const token = ++chainToken;
  const mine = Boolean(account) && $('#chain-mine').checked;
  $('#chain-note').textContent = 'Reading InvoicePaid events from Atlantic…';
  try {
    const response = await fetch(`/api/treasury?action=history${mine ? `&payer=${encodeURIComponent(account)}` : ''}`);
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error ?? `HTTP ${response.status}`);
    if (token !== chainToken) return;
    const data = result.data;
    chainEvents = data.events;
    $('#chain-export').disabled = !data.events.length;
    const known = new Map(ledger.read(config).filter((row) => row.invoice?.invoiceId).map((row) => [row.invoice.invoiceId, row.invoice.reference]));
    const KIND_LABEL = { payment: 'Invoice payment', approval: 'Approval', mint: 'Test-token mint' };
    const rows = data.events.map((event) => {
      const yours = account && event.payer === account.toLowerCase();
      const when = event.timestamp ? new Date(event.timestamp * 1000).toLocaleString() : `block ${event.blockNumber.toLocaleString()}`;
      const amount = `${amountText(event.amountRaw, config.token.decimals)} ${config.token.symbol}`;
      const head = event.kind === 'mint' ? `+${amount}` : amount;
      const reference = config.references?.[event.invoiceId] ?? known.get(event.invoiceId);
      const meta = event.kind === 'payment'
        ? `<span>From ${esc(short(event.payer))}</span><span>To ${esc(short(event.recipient))}</span><span>${reference ? `Reference ${esc(reference)}` : `Reference hash ${esc(short(event.invoiceId))}`}</span>`
        : event.kind === 'approval' ? `<span>Wallet ${esc(short(event.payer))}</span><span>Router may spend up to this amount</span>`
        : `<span>To ${esc(short(event.payer))}</span><span>Free demonstration tokens</span>`;
      return `<li class="treasury-history-item"><div class="treasury-history-row"><strong>${esc(head)}${yours ? '<span class="treasury-you">YOUR WALLET</span>' : ''}</strong><span class="treasury-kind treasury-kind-${esc(event.kind)}">${esc(KIND_LABEL[event.kind] ?? event.kind)}</span></div><div class="treasury-history-meta">${meta}<time>${esc(when)}</time></div><div class="treasury-history-actions">${externalLink(`${config.explorer}/tx/${event.hash}`, `${short(event.hash)} ↗`, 'treasury-text-button')}</div></li>`;
    });
    $('#chain-history').innerHTML = rows.length ? `<ul class="treasury-history-list">${rows.join('')}</ul>` : '';
    const range = `blocks ${data.fromBlock?.toLocaleString() ?? '?'} to ${data.toBlock.toLocaleString()}`;
    $('#chain-note').textContent = rows.length
      ? `Latest ${rows.length} of ${data.total} transactions found in ${range}${data.complete ? '' : ' (the scan stopped early; newer blocks were read first)'}. Payments, approvals and mints, read directly from the chain.`
      : `No ${mine ? 'transactions from your wallet' : 'transactions'} found in ${range}. A payment appears here once it is mined.`;
  } catch (err) {
    if (token === chainToken) $('#chain-note').textContent = `Could not read on-chain receipts right now: ${err.message}`;
  }
}

async function renderReceipt() {
  if (!config?.demo?.hash) return;
  const demo = config.demo;
  $('#receipt-amount').textContent = demo.amount;
  $('#receipt-from').textContent = demo.payer;
  $('#receipt-to').textContent = demo.recipient;
  $('#receipt-ref').textContent = demo.reference;
  const link = safeUrl(`${config.explorer}/tx/${demo.hash}`);
  if (link) $('#receipt-link').href = link;
  try {
    const proof = await api('proof');
    const verified = proof.verification;
    const lines = (verified.checks ?? []).filter((c) => c.ok).map((c) => c.message);
    const done = new Map((proof.report?.checks ?? []).map((c) => [c.id, c.ok]));
    if (done.get('recipient-gained-exact-amount')) lines.push('The recipient gained exactly this amount.');
    if (done.get('router-held-no-tokens')) lines.push('The router kept no tokens.');
    if (done.get('duplicate-blocked')) lines.push('Paying the same reference again was refused by the contract.');
    $('#receipt-block').textContent = verified.blockNumber ? `block ${Number(verified.blockNumber).toLocaleString('en-US')}` : 'on Atlantic';
    const list = $('#receipt-checks');
    list.replaceChildren();
    if (verified.status !== 'confirmed') { const li = document.createElement('li'); li.className = 'pending'; li.textContent = verified.message ?? 'The payment could not be confirmed right now.'; list.append(li); return; }
    lines.forEach((text, index) => { const li = document.createElement('li'); li.textContent = text; li.style.setProperty('--i', String(index)); list.append(li); });
  } catch (err) {
    $('#receipt-block').textContent = 'unavailable';
    $('#receipt-checks').innerHTML = `<li class="pending">${esc(err.message)}</li>`;
  }
}

function setBusy(value) {
  busy = value;
  $('#invoice-form').setAttribute('aria-busy', String(value));
  syncControls();
}

function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function externalLink(url, label, className = '') {
  const safe = safeUrl(url);
  return safe ? `<a class="${className}" href="${esc(safe)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);
}

function renderPlan(result) {
  const descriptions = {
    ready: ['Ready for your review.', 'The checks passed and the payment was simulated. Check the details before signing.'],
    'needs-approval': ['Approval comes first.', 'The router needs permission to spend this exact invoice amount. Payment is checked again after approval.'],
    blocked: ['This payment is on hold.', 'A check did not pass. Review the reasons below before changing the invoice.'],
    'already-paid': ['This reference is already paid.', 'The contract has recorded this reference for this payer. Another payment is not prepared.'],
  };
  const [heading, text] = descriptions[result.status] ?? ['Review could not finish.', 'Check the available evidence below and try again.'];
  const inv = result.invoice ?? invoiceInput();
  const checks = (result.checks ?? []).map((check) => `<li><span class="treasury-check-mark${check.ok ? '' : ' failed'}" aria-hidden="true">${check.ok ? '✓' : '×'}</span><span><span class="sr-only">${check.ok ? 'Passed: ' : 'Stopped: '}</span>${esc(check.message ?? check.title ?? check.id)}</span></li>`).join('');
  const steps = (result.steps ?? []).map((step) => `<li><span class="treasury-tool-source">${esc(step.source ?? step.tool)} · ${esc(step.status ?? 'completed')}</span><strong>${esc(step.title ?? step.tool)}</strong><p>${esc(typeof step.detail === 'object' ? JSON.stringify(step.detail) : step.detail ?? '')}</p></li>`).join('');
  const docs = result.docs;
  const badges = result.steps?.length ? `<div class="treasury-badges" aria-label="Tools the agent used">${result.steps.map((step) => `<span class="treasury-badge ${step.status === 'passed' ? 'passed' : ''}">${esc(step.tool)}</span>`).join('')}</div>` : '';
  const advisoryList = (result.advisories ?? []).map((item) => `<li class="${item.level === 'warn' ? 'warn' : 'note'}"><span class="treasury-advice-mark" aria-hidden="true">${item.level === 'warn' ? '!' : 'i'}</span><span><span class="sr-only">${item.level === 'warn' ? 'Warning: ' : 'Note: '}</span>${esc(item.message)}</span></li>`).join('');
  const ack = result.acknowledgement?.required && ['ready', 'needs-approval'].includes(result.status) ? '<label class="treasury-ack"><input type="checkbox" id="ack"> I confirmed this recipient address with them.</label>' : '';
  const grouped = new Map();
  for (const call of (lastTrace?.calls ?? []).filter((entry) => ['mcp', 'rpc', 'skill'].includes(entry.kind))) {
    const label = call.kind === 'mcp' ? call.server : call.kind === 'skill' ? 'SkillEngine' : 'Atlantic RPC';
    const key = `${label}|${call.tool ?? call.title ?? ''}`;
    const entry = grouped.get(key) ?? { label, tool: call.tool ?? call.title ?? '', count: 0, ms: 0 };
    entry.count += 1;
    entry.ms += Number(call.ms) || 0;
    grouped.set(key, entry);
  }
  const calls = [...grouped.values()];
  const traceHtml = calls.length ? `<details class="treasury-details"><summary>Tool calls · ${(lastTrace?.calls ?? []).filter((entry) => ['mcp', 'rpc', 'skill'].includes(entry.kind)).length} · ${esc(lastTrace.ms)} ms</summary><table class="treasury-trace"><thead><tr><th>Tool</th><th>Call</th><th>ms</th></tr></thead><tbody>${calls.map((call) => `<tr><td>${esc(call.label)}</td><td>${esc(call.tool)}${call.count > 1 ? ` ×${call.count}` : ''}</td><td>${esc(call.ms)}</td></tr>`).join('')}</tbody></table></details>` : '';
  const sources = (docs?.sources ?? []).map((source) => `<li>${externalLink(source.url ?? source.href, source.title ?? source.url ?? 'Documentation source')}</li>`).join('');
  $('#agent-output').innerHTML = `<div class="treasury-decision"><h4>${esc(heading)}</h4><p>${esc(text)}</p></div><div class="treasury-decision-amount">${esc(inv.amount ?? '—')}<span>${esc(config.token.symbol)}</span></div><p class="treasury-hint">To ${esc(inv.recipient ?? '—')}<br>Reference ${esc(inv.reference ?? '—')}</p>${badges}${checks ? `<ul class="treasury-checks">${checks}</ul>` : ''}${advisoryList ? `<ul class="treasury-advice">${advisoryList}</ul>${ack}` : ''}${steps ? `<details class="treasury-details" open><summary>Agent evidence · ${result.steps.length} steps</summary><ol class="treasury-tool-list">${steps}</ol></details>` : ''}${traceHtml}${docs ? `<details class="treasury-details"><summary>Documentation behind the plan</summary><p class="treasury-doc-answer">${esc(docs.answer ?? 'No documentation answer was returned.')}</p>${sources ? `<ul class="treasury-doc-sources">${sources}</ul>` : ''}</details>` : ''}`;
  $('#agent-state').textContent = { ready: 'Checks passed', blocked: 'Blocked', 'needs-approval': 'Needs approval', 'already-paid': 'Already recorded' }[result.status] ?? 'Review incomplete';
  syncControls();
}

async function review() {
  if (!payer()) throw new Error('Connect your wallet or inspect the recorded example first.');
  const version = ++revision;
  plan = null;
  message();
  setBusy(true);
  $('#agent-state').textContent = 'Reading tools…';
  $('#agent-output').innerHTML = '<div class="treasury-agent-empty"><h4>The copilot is working.</h4><p>It is asking the Developer Docs MCP about the Atlantic network and signing procedure, and reading balances, allowance and the invoice registry through the SkillEngine. This usually takes 10 to 30 seconds.</p></div>';
  $('#review-invoice').textContent = 'Checking invoice…';
  $('#signing-area').hidden = true;
  try {
    const result = await api('plan', { payer: payer(), invoice: invoiceInput(), policy: policyInput() });
    if (version !== revision) return;
    plan = result;
    renderPlan(result);
  } finally {
    setBusy(false);
    $('#review-invoice').textContent = 'Review invoice →';
    if (version === revision && !plan) $('#agent-state').textContent = 'Review incomplete';
  }
}

async function refreshWallet({ invalidatePlan = true } = {}) {
  if (!wallet.available()) return;
  try {
    const context = await wallet.context();
    const changed = account !== context.account || walletChain !== context.chainId;
    account = context.account;
    walletChain = context.chainId;
    if (changed && invalidatePlan) invalidate();
  } catch { account = null; walletChain = null; invalidate(); }
  syncControls();
}

function rowTitle(row) { return row.kind === 'payment' ? row.invoice?.reference ?? 'Invoice payment' : KIND[row.kind] ?? row.kind; }

function renderHistory() {
  if (!config) return;
  const rows = ledger.read(config);
  if (!rows.length) {
    $('#payment-history').innerHTML = '<div class="treasury-ledger-empty"><p>No transactions from this browser yet.<br><span class="treasury-small">A verified payment becomes a receipt here.</span></p></div>';
    return;
  }
  $('#payment-history').innerHTML = `<ul class="treasury-history-list">${rows.map((row) => {
    const pending = ['pending', 'awaiting-wallet', 'uncertain', 'mismatch'].includes(row.status);
    return `<li class="treasury-history-item"><div class="treasury-history-row"><strong>${esc(rowTitle(row))}</strong><span class="treasury-status treasury-status-${esc(row.status)}">${esc(STATUS[row.status] ?? row.status)}</span></div><div class="treasury-history-meta"><span>${esc(KIND[row.kind] ?? row.kind)}</span>${row.kind === 'payment' ? `<span>${esc(row.invoice.amount)} ${esc(config.token.symbol)}</span>` : ''}<span>From ${esc(short(row.payer))}</span><time datetime="${esc(row.createdAt)}">${esc(new Date(row.createdAt).toLocaleString())}</time></div>${row.message ? `<p class="treasury-hint">${esc(row.message)}</p>` : ''}<div class="treasury-history-actions">${row.hash ? externalLink(`${config.explorer}/tx/${row.hash}`, `${short(row.hash)} ↗`, 'treasury-text-button') : ''}${pending && row.hash ? `<button class="treasury-text-button" type="button" data-check-id="${esc(row.id)}">Check status</button>` : ''}</div>${pending && (!row.hash || row.status === 'mismatch') ? `<form class="treasury-hash-form" data-hash-id="${esc(row.id)}"><label>Transaction hash from wallet activity<input name="hash" type="text" spellcheck="false" autocomplete="off" pattern="0x[0-9a-fA-F]{64}" placeholder="0x…" required></label><button class="treasury-button treasury-button-secondary" type="submit">Check hash</button></form><p class="treasury-hint">A wallet request was saved before signing. Keep this record until its outcome is known.</p>` : ''}</li>`;
  }).join('')}</ul>`;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkRecord(record, { continuous = false } = {}) {
  if (!record?.hash || polls.has(record.id)) return;
  polls.add(record.id);
  try {
    const deadline = Date.now() + (continuous ? 60_000 : 0);
    let result;
    do {
      result = record.kind === 'payment' ? await api('verify', { payer: record.payer, invoice: record.invoice, hash: record.hash }) : await wallet.inspectTransaction(record.hash, { payer: record.payer, chainId: config.chainId, transaction: record.transaction });
      if (!['confirmed', 'reverted', 'mismatch', 'pending'].includes(result.status)) throw new Error('The verifier returned an unknown status. The transaction remains unresolved.');
      ledger.update(config, record.id, { status: result.status, hash: record.hash, result, message: result.message ?? '' });
      renderHistory();
      syncControls();
      if (result.status !== 'pending' || !continuous) break;
      await pause(2500);
    } while (Date.now() < deadline);
    if (result.status === 'confirmed') {
      if (record.kind === 'payment') loadChain();
      message(record.kind === 'payment' ? `Payment verified on chain for ${record.invoice.reference}. Its receipt is in the ledger.` : record.kind === 'approval' ? 'Token approval confirmed. Review the invoice again to prepare its payment.' : 'Test-token mint confirmed. You can now review an invoice from your wallet.');
      if (record.kind !== 'payment') invalidate();
    } else if (result.status === 'pending') message('The transaction is still pending. Its hash is saved; check its status before submitting anything else.');
    else message(result.status === 'reverted' ? 'The transaction reverted. No successful payment was recorded.' : 'This transaction does not match the expected request. Inspect the wallet activity and transaction before continuing.', true);
  } catch (err) {
    ledger.update(config, record.id, { message: `Status check unavailable: ${err.message}. The transaction remains saved.` });
    renderHistory();
    message(`Could not verify the transaction yet: ${err.message}. Its saved request will not be retried automatically.`, true);
  } finally { polls.delete(record.id); syncControls(); }
}

async function send(kind, transaction, invoice = null) {
  const currentPayer = account;
  if (!currentPayer || inspecting) throw new Error('Connect your own wallet before signing.');
  if (!ledger.available(config)) throw new Error('Enable browser storage before signing so pending transactions can be recovered.');
  const row = { id: crypto.randomUUID(), kind, payer: currentPayer, invoice, transaction, status: 'awaiting-wallet', hash: null, createdAt: new Date().toISOString() };
  let reserved = false;
  setBusy(true);
  message('Review the transaction in your wallet. This page is waiting for your decision.');
  try {
    const hash = await wallet.send({ ...transaction, from: currentPayer }, { payer: currentPayer, chainId: config.chainId, beforeSubmit: () => { ledger.reserve(config, row); reserved = true; renderHistory(); } });
    row.hash = hash;
    row.status = 'pending';
    ledger.update(config, row.id, { hash, status: 'pending' });
    invalidate();
    renderHistory();
    message('Transaction submitted. Checking the receipt against the requested action…');
    await checkRecord(row, { continuous: true });
  } catch (err) {
    if (reserved) {
      if (err.mayHaveSubmitted || row.hash) ledger.update(config, row.id, { status: row.hash ? 'pending' : 'uncertain', hash: row.hash, message: err.message });
      else ledger.remove(config, row.id);
      renderHistory();
    }
    throw err;
  } finally { setBusy(false); }
}

async function showProof() {
  const target = $('#proof-output');
  target.hidden = false;
  target.innerHTML = '<h3>Checking the recorded payment…</h3><p class="treasury-small">The transaction is read from Atlantic Testnet again.</p>';
  $('#show-proof').disabled = true;
  try {
    const proof = await api('proof');
    const demo = proof.demo ?? proof.run?.demo ?? config.demo;
    const verified = proof.verification ?? proof.result ?? proof;
    const checks = verified.checks ?? proof.checks ?? [];
    const status = verified.status ?? proof.status;
    const confirmed = status === 'confirmed';
    target.innerHTML = `<h3>${confirmed ? 'Recorded payment verified.' : 'Recorded payment evidence'}</h3><p class="treasury-small">A read-only example from the deployment wallet. This is separate from your wallet's ledger.</p><dl><div><dt>Reference</dt><dd>${esc(demo.reference)}</dd></div><div><dt>Amount</dt><dd>${esc(demo.amount)} ${esc(config.token.symbol)}</dd></div><div><dt>Payer</dt><dd>${esc(demo.payer)}</dd></div><div><dt>Recipient</dt><dd>${esc(demo.recipient)}</dd></div><div><dt>Transaction</dt><dd>${externalLink(`${config.explorer}/tx/${demo.hash}`, demo.hash)}</dd></div></dl>${checks.length ? `<ul class="treasury-checks">${checks.map((c) => `<li><span class="treasury-check-mark${c.ok ? '' : ' failed'}" aria-hidden="true">${c.ok ? '✓' : '×'}</span><span>${esc(c.message ?? c.what ?? c.id)}</span></li>`).join('')}</ul>` : `<p class="treasury-small">Verifier status: ${esc(status ?? 'No confirmation status returned')}</p>`}`;
  } catch (err) { target.innerHTML = `<h3>Verification unavailable.</h3><p class="treasury-small">${esc(err.message)} Try again when the upstream service is available.</p>`; }
  finally { syncControls(); }
}

function setTheme(next) {
  document.documentElement.dataset.theme = next;
  $('#theme-toggle').setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  try { localStorage.setItem('theme', next); } catch { /* Theme remains usable without storage. */ }
}

async function boot() {
  let theme;
  try { theme = localStorage.getItem('theme'); } catch { /* Use the page's light theme. */ }
  setTheme(theme === 'dark' ? 'dark' : 'light');
  $('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#invoice-form').addEventListener('input', () => { invalidate(); message(); });
  $('#invoice-form').addEventListener('submit', (event) => { event.preventDefault(); review().catch((err) => message(err.message, true)); });
  $('#connect-wallet').addEventListener('click', async () => {
    setBusy(true);
    try {
      const context = await wallet.connect();
      account = context.account;
      walletChain = context.chainId;
      inspecting = false;
      invalidate();
      message(walletChain === Number(config.chainId) ? 'Wallet connected. Enter your invoice and review it before signing.' : 'Wallet connected. Switch to Atlantic Testnet before signing.');
    } catch (err) { message(err.message, true); }
    finally { setBusy(false); }
  });
  $('#switch-network').addEventListener('click', async () => {
    setBusy(true);
    try { await wallet.switchNetwork(config); await refreshWallet(); message('Wallet switched to Atlantic Testnet. Review your invoice again.'); }
    catch (err) { message(err.message, true); }
    finally { setBusy(false); }
  });
  $('#inspect-example').addEventListener('click', () => {
    inspecting = true;
    $('#invoice-reference').value = config.demo.reference;
    $('#invoice-recipient').value = config.demo.recipient;
    $('#invoice-amount').value = config.demo.amount;
    invalidate();
    message('Inspecting the recorded invoice with the deployment payer. No wallet signature is available in this mode.');
    review().catch((err) => message(err.message, true));
  });
  $('#sign-transaction').addEventListener('click', async () => {
    if (!plan || inspecting) return;
    const prepared = plan;
    const version = revision;
    try {
      await wallet.assertContext({ payer: account, chainId: config.chainId });
      if (version !== revision || prepared !== plan) throw new Error('The invoice or account changed. Review the invoice again.');
      const kind = prepared.status === 'needs-approval' ? 'approval' : 'payment';
      const transaction = kind === 'approval' ? prepared.approval : prepared.transaction;
      if (!transaction) throw new Error('The agent did not prepare a transaction for this step.');
      await send(kind, transaction, prepared.invoice);
    } catch (err) { message(err.message, true); }
  });
  $('#mint-tokens').addEventListener('click', () => send('faucet', config.faucetTransaction).catch((err) => message(err.message, true)));
  $('#show-proof').addEventListener('click', showProof);
  $('#chain-mine').addEventListener('change', loadChain);
  $('#hero-sample').addEventListener('click', () => {
    $('#workspace').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('#intake').open = true;
    $('#intake-sample').click();
  });
  $('#hero-inspect').addEventListener('click', () => { $('#workspace').scrollIntoView(); $('#inspect-example').click(); });
  $('#agent-output').addEventListener('change', (event) => { if (event.target.id === 'ack') syncControls(); });
  $('#chain-export').addEventListener('click', () => {
    const cell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [['time_utc', 'kind', 'block', 'transaction', 'wallet', 'recipient', 'amount', 'token', 'reference', 'invoice_id_hash']].concat(chainEvents.map((e) => [e.timestamp ? new Date(e.timestamp * 1000).toISOString() : '', e.kind, e.blockNumber, e.hash, e.payer, e.recipient ?? '', amountText(e.amountRaw, config.token.decimals), config.token.symbol, config.references?.[e.invoiceId] ?? '', e.invoiceId ?? '']));
    const blob = new Blob([rows.map((row) => row.map(cell).join(',')).join('\n') + '\n'], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `treasury-receipts-atlantic-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  $('#intake-read').addEventListener('click', async () => {
    const box = $('#intake-result');
    box.hidden = false;
    box.textContent = 'Reading the invoice…';
    try {
      const result = await api('parse', { text: $('#intake-text').value });
      if (result.fields.reference) $('#invoice-reference').value = result.fields.reference;
      if (result.fields.recipient) $('#invoice-recipient').value = result.fields.recipient;
      if (result.fields.amount) $('#invoice-amount').value = result.fields.amount;
      invalidate();
      const label = { reference: 'Reference', recipient: 'Recipient', amount: 'Amount' };
      const read = result.readings.filter((r) => r.status === 'read').map((r) => `<li>${esc(label[r.field])}: <code>${esc(r.value)}</code></li>`).join('');
      const asks = result.questions.map((q) => `<li>${esc(q)}</li>`).join('');
      box.innerHTML = `${read ? `<p class="ok">Filled in the form:</p><ul>${read}</ul>` : ''}${asks ? `<p class="ask">I need your help with:</p><ul>${asks}</ul>` : '<p class="ok">Everything was found. Review the invoice when you are ready.</p>'}`;
    } catch (err) { box.textContent = err.message; }
  });
  $('#intake-sample').addEventListener('click', () => {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
    $('#intake-text').value = `Invoice INV-${stamp} from Acme Design Studio.\nDesign retainer, November.\nPlease pay 25 tUSDC to ${config?.demo?.recipient ?? '0x…'} within 14 days.`;
    $('#intake-read').click();
  });
  $('#payment-history').addEventListener('click', (event) => {
    const button = event.target.closest('[data-check-id]');
    if (!button) return;
    const row = ledger.read(config).find((r) => r.id === button.dataset.checkId);
    if (row) checkRecord(row);
  });
  $('#payment-history').addEventListener('submit', (event) => {
    const form = event.target.closest('[data-hash-id]');
    if (!form) return;
    event.preventDefault();
    const hash = new FormData(form).get('hash').trim();
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) return message('Paste the full 0x transaction hash from your wallet activity.', true);
    const row = ledger.update(config, form.dataset.hashId, { hash, status: 'pending' });
    renderHistory();
    checkRecord(row);
  });
  try {
    config = await api('config');
    if (Number(config.chainId) !== 688689 || !/^0x[0-9a-f]{40}$/i.test(config.router) || !/^0x[0-9a-f]{40}$/i.test(config.token?.address)) throw new Error('The Treasury contracts are not configured for Atlantic Testnet yet. Try again after deployment.');
    $('#network-label').textContent = 'Atlantic Testnet · 688689';
    $('#amount-token').textContent = config.token.symbol;
    document.querySelectorAll('.treasury-token-label').forEach((el) => { el.textContent = config.token.symbol; });
    $('#invoice-reference').value = `INV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`;
    $('#invoice-amount').value = '25';
    $('#contract-links').innerHTML = `${externalLink(`${config.explorer}/address/${config.router}`, `Invoice router ${short(config.router)} ↗`)}${externalLink(`${config.explorer}/address/${config.token.address}`, `${config.token.symbol} contract ${short(config.token.address)} ↗`)}${externalLink('https://docs.pharos.xyz/getting-started/network/atlantic-testnet', 'Network & testnet funding ↗')}`;
    renderEvidence();
    renderReceipt();
    loadChain();
    await refreshWallet({ invalidatePlan: false });
    wallet.subscribe(() => refreshWallet().catch(() => {}));
    renderHistory();
    syncControls();
    const pending = ledger.pending(config);
    if (pending.length) message('This browser has unresolved transactions. Check their status in the receipt ledger before signing another.');
    for (const row of pending.filter((r) => r.hash && r.kind === 'payment')) checkRecord(row);
  } catch (err) {
    $('#network-label').textContent = config?.chainId === 688689 ? 'Atlantic · Deployment pending' : 'Configuration unavailable';
    message(err.message, true);
  }
}

boot();
