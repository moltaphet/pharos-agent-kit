// Budgeted x402 purchaser. A signed authorization is created only after the price, value estimate,
// asset/domain and remaining budget are checked. Any uncertain submission reserves that price and
// stops the job; a retry always reuses the exact same PAYMENT-SIGNATURE.

import { isAddress } from './abi.js';
import { UserError } from './snapshot.js';
import { b64, createPayment, HEADERS, NETWORK, X402_VERSION, explorerTx } from './x402.js';

const UINT256_MAX = (1n << 256n) - 1n;
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const uint = (x, label, { positive = false } = {}) => {
  if (!(typeof x === 'string' && /^\d{1,78}$/.test(x) || typeof x === 'number' && Number.isSafeInteger(x) && x >= 0)) throw new UserError(`${label} must be a non-negative integer in base units`);
  const n = BigInt(x);
  if (n > UINT256_MAX || (positive && n === 0n)) throw new UserError(`${label} must be ${positive ? 'a positive ' : 'a '}uint256 amount`);
  return n;
};
const safeBody = async (response) => { try { return await response.json(); } catch { return null; } };
const settlementFrom = (response) => {
  try { return b64.dec(response.headers?.get?.(HEADERS.response) ?? ''); } catch { return null; }
};
const safeHeader = (headers) => Object.fromEntries(new Headers(headers ?? {}).entries());

function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length < 2 || tasks.length > 20) throw new UserError('tasks must list 2 to 20 distinct endpoints');
  const ids = new Set();
  return tasks.map((task, index) => {
    if (!record(task)) throw new UserError(`task ${index + 1} must be an object`);
    const id = String(task.id ?? '').trim();
    const name = String(task.name ?? '').trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || ids.has(id)) throw new UserError(`task ${index + 1} needs a unique id (letters, digits, underscore or hyphen)`);
    ids.add(id);
    if (!name || name.length > 120) throw new UserError(`task ${id} needs a name of 1 to 120 characters`);
    let url;
    try { url = new URL(task.url); } catch { throw new UserError(`task ${id} needs an absolute HTTP or HTTPS URL`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new UserError(`task ${id} URL must be HTTP(S), without credentials or a fragment`);
    const value = uint(task.value, `task ${id} value`);
    return { id, name, url: url.href, value };
  });
}

function requirementsFrom(challenge, expectedAsset) {
  if (!record(challenge) || challenge.x402Version !== X402_VERSION || !Array.isArray(challenge.accepts)) return null;
  const exact = challenge.accepts.filter((r) => record(r) && r.scheme === 'exact' && r.network === NETWORK &&
    typeof r.amount === 'string' && /^\d{1,78}$/.test(r.amount) && BigInt(r.amount) > 0n && BigInt(r.amount) <= UINT256_MAX &&
    typeof r.asset === 'string' && isAddress(r.asset) && typeof r.payTo === 'string' && isAddress(r.payTo) &&
    Number.isSafeInteger(r.maxTimeoutSeconds) && r.maxTimeoutSeconds > 6 && r.maxTimeoutSeconds <= 86_400 &&
    record(r.extra) && typeof r.extra.name === 'string' && r.extra.name.length > 0 && r.extra.name.length <= 256 &&
    typeof r.extra.version === 'string' && r.extra.version.length > 0 && r.extra.version.length <= 256);
  const acceptable = exact.filter((r) => expectedAsset == null || r.asset.toLowerCase() === expectedAsset.toLowerCase());
  return acceptable.length === 1 ? acceptable[0] : null;
}

async function responseChallenge(response) {
  const header = response.headers?.get?.(HEADERS.required);
  if (header) return b64.dec(header);
  return safeBody(response);
}

const decision = (task, kind, detail, price = null) => ({ id: task.id, item: task.name, decision: kind, detail, ...(price != null && { price: String(price) }) });

/**
 * Run a budgeted data-buying job. Values, budget and caps are integer token base units.
 * `signPayment` is injectable for deterministic offline demonstrations; production defaults to
 * the audited EIP-712 signer and requires a privateKey only when an offer is approved.
 */
export async function runBuyerJob({ tasks: input, budget, maxPerCall, privateKey = null, fetchImpl = fetch, init = {}, now, maxAttempts = 2, expectedAsset = null, signPayment = createPayment } = {}) {
  const simulated = signPayment !== createPayment;
  const tasks = validateTasks(input);
  const budgetRaw = uint(budget, 'budget', { positive: true });
  const capRaw = uint(maxPerCall, 'per-call cap', { positive: true });
  const expected = expectedAsset == null ? null : String(expectedAsset);
  if (expected != null && !isAddress(expected)) throw new UserError('expectedAsset must be a token contract address');
  if (typeof fetchImpl !== 'function' || typeof signPayment !== 'function') throw new UserError('fetchImpl and signPayment must be functions');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new UserError('maxAttempts must be an integer from 1 to 3');

  let spent = 0n;
  let reserved = 0n;
  let jobTerms = null;
  const payments = [];
  const unresolved = [];
  const decisions = [];
  const results = [];
  const paidTransactions = new Set();
  const authorizations = new Set();
  let status = 'complete';
  let stopReason = null;

  const stop = (kind, task, detail, price = null) => {
    decisions.push(decision(task, kind, detail, price));
    status = kind === 'unresolved' ? 'unresolved' : 'stopped';
    stopReason = kind;
  };

  for (const task of tasks) {
    const requestHeaders = new Headers(init.headers ?? {});
    requestHeaders.delete(HEADERS.signature);
    let first;
    try { first = await fetchImpl(task.url, { ...init, method: 'GET', redirect: 'error', headers: Object.fromEntries(requestHeaders.entries()) }); }
    catch (err) { stop('request-failed', task, `Could not read the price: ${err.message}`); break; }
    if (first.status !== 402) {
      const body = await safeBody(first);
      if (first.status >= 200 && first.status < 300) {
        decisions.push(decision(task, 'free', 'Endpoint returned data without requiring payment.'));
        results.push({ id: task.id, name: task.name, status: first.status, paid: false, body });
        continue;
      }
      stop('request-failed', task, `Endpoint returned HTTP ${first.status} before presenting a payment offer.`);
      break;
    }

    const challenge = await responseChallenge(first);
    const requirements = requirementsFrom(challenge, expected);
    if (!requirements) { stop('invalid-requirements', task, 'No single valid exact-scheme offer for Pharos Atlantic was provided.'); break; }
    const price = BigInt(requirements.amount);
    if (jobTerms && (jobTerms.network !== requirements.network || jobTerms.asset !== requirements.asset.toLowerCase() || jobTerms.name !== requirements.extra.name || jobTerms.version !== requirements.extra.version)) {
      stop('incompatible-terms', task, 'This endpoint uses a different token or EIP-712 domain. One budget cannot safely total unlike assets.', price);
      break;
    }
    if (!jobTerms) jobTerms = { network: requirements.network, asset: requirements.asset.toLowerCase(), name: requirements.extra.name, version: requirements.extra.version };
    if (price > capRaw) { stop('per-call-cap', task, `Offer is ${price} base units; the per-call cap is ${capRaw}.`, price); break; }
    if (task.value < price) {
      decisions.push(decision(task, 'not-worth-it', `Estimated value ${task.value} base units is below the ${price} base-unit price.`, price));
      continue;
    }
    if (spent + reserved + price > budgetRaw) { stop('budget', task, `Offer is ${price} base units; only ${budgetRaw - spent - reserved} remain.`, price); break; }
    if (!privateKey && signPayment === createPayment) { stop('signing-unavailable', task, 'An approved offer needs a payer key from the environment or a key file.', price); break; }

    let payment;
    try { payment = signPayment({ requirements, privateKey, resource: challenge.resource, ...(now != null && { now }) }); }
    catch (err) { stop('signing-failed', task, `The payment could not be signed: ${err.message}`, price); break; }
    const signedHeaders = new Headers(requestHeaders);
    signedHeaders.set(HEADERS.signature, b64.enc(payment));
    let response = null;
    let lastError = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      try {
        response = await fetchImpl(task.url, { ...init, method: 'GET', redirect: 'error', headers: Object.fromEntries(signedHeaders.entries()) });
        lastError = null;
        const settlement = settlementFrom(response);
        if (settlement?.success === true && settlement.network === NETWORK && /^0x[0-9a-f]{64}$/i.test(settlement.transaction ?? '')) break;
        if (settlement?.transaction || ['settlement_timeout', 'settlement_unknown'].includes(settlement?.errorReason) || response.status === 402) break;
        if (response.status < 500 && response.status !== 429) break;
      } catch (err) { lastError = err; }
    }

    const settlement = response && settlementFrom(response);
    if (settlement?.success === true && settlement.network === NETWORK && /^0x[0-9a-f]{64}$/i.test(settlement.transaction ?? '') && (!settlement.payer || settlement.payer.toLowerCase() === payment.payload?.authorization?.from?.toLowerCase())) {
      const hashKey = settlement.transaction.toLowerCase();
      const auth = payment.payload?.authorization;
      const authKey = `${requirements.asset.toLowerCase()}:${auth?.from?.toLowerCase()}:${auth?.nonce?.toLowerCase()}`;
      if (paidTransactions.has(hashKey) || authorizations.has(authKey)) {
        reserved += price;
        unresolved.push({ id: task.id, item: task.name, price: price.toString(), transaction: settlement.transaction, attempts, reason: 'The same settlement transaction or authorization was returned more than once.' });
        stop('unresolved', task, 'The endpoint repeated a previously counted settlement. The amount is reserved until the duplicate is reconciled.', price);
        break;
      }
      paidTransactions.add(hashKey);
      authorizations.add(authKey);
      spent += price;
      const item = { id: task.id, item: task.name, price: price.toString(), transaction: settlement.transaction, ...(simulated ? { simulated: true } : { explorer: explorerTx(settlement.transaction) }), runningTotal: spent.toString(), attempts, status: response.status };
      payments.push(item);
      decisions.push(decision(task, 'bought', `Settlement confirmed in ${settlement.transaction}.`, price));
      results.push({ id: task.id, name: task.name, status: response.status, paid: true, body: await safeBody(response), transaction: settlement.transaction });
      if (response.status < 200 || response.status >= 300) {
        status = 'stopped';
        stopReason = 'resource-failed-after-payment';
        decisions.push(decision(task, 'resource-failed-after-payment', `Payment settled, but the resource returned HTTP ${response.status}. Do not pay this endpoint again until its handler is checked.`, price));
        break;
      }
      continue;
    }

    const receiptHash = settlement && /^0x[0-9a-f]{64}$/i.test(settlement.transaction ?? '') ? settlement.transaction : null;
    if (lastError || response?.status === 402 || (response && (response.status >= 500 || response.status === 429 || (response.status >= 200 && response.status < 300))) || settlement?.transaction || settlement?.errorReason === 'settlement_timeout' || settlement?.errorReason === 'settlement_unknown' || !response) {
      reserved += price;
      const item = { id: task.id, item: task.name, price: price.toString(), transaction: receiptHash, attempts, reason: lastError?.message ?? settlement?.errorMessage ?? 'No successful settlement receipt was returned.' };
      unresolved.push(item);
      stop('unresolved', task, receiptHash ? `Settlement is unresolved; check ${receiptHash} before doing anything else.` : 'The payment result is uncertain. The exact same authorization was retried, and the cost is reserved until settlement is checked.', price);
      break;
    }

    const body = await safeBody(response);
    stop('payment-failed', task, `The endpoint refused or failed the signed payment (HTTP ${response.status}): ${body?.error ?? body?.message ?? 'no settlement was confirmed'}.`, price);
    break;
  }

  return {
    status, mode: simulated ? 'simulated' : 'live', stopReason, network: jobTerms?.network ?? NETWORK, asset: jobTerms?.asset ?? expected?.toLowerCase() ?? null,
    budget: budgetRaw.toString(), maxPerCall: capRaw.toString(), spent: spent.toString(), reserved: reserved.toString(),
    remaining: (budgetRaw - spent - reserved).toString(), decisions, payments, unresolved, results,
  };
}
