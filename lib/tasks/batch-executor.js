// Task: Batch Executor (Skill).
//
// Bundles several independent native-value actions into ONE prepared transaction through
// Multicall3.aggregate3Value, and reports what that saves against sending them one by one.
// Every action is simulated first, so a failing one is named and handled by policy instead of
// being discovered on chain. The transaction is only PREPARED (unsigned): this module never sends.
//
// Why only native-value actions: through Multicall3 the sender of each inner call is the
// Multicall3 contract, not you. An ERC-20 transfer would move Multicall3's tokens (not yours),
// and approving Multicall3 so it could move yours would let anyone spend them. Such actions
// are refused with that explanation.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blockNumber } from '../chain.js';
import { encodeAggregate3Value } from '../multicall.js';
import { MULTICALL3 } from '../protocols.js';
import { isAddress, formatUnits } from '../abi.js';
import { parseMcpRevert, decodeRevert } from '../revert.js';
import { UserError } from '../snapshot.js';
import { shortAddress } from '../labels.js';

export const MIN_ACTIONS = 3;
// transfer, approve, transferFrom: all depend on msg.sender
const SENDER_DEPENDENT = { '0xa9059cbb': 'an ERC-20 transfer', '0x095ea7b3': 'an ERC-20 approval', '0x23b872dd': 'an ERC-20 transferFrom' };

export function parseAmount(text, what) {
  if (!/^\d+(\.\d{1,18})?$/.test(String(text ?? '0'))) throw new UserError(`${what} must be a decimal number of PROS with at most 18 decimals`);
  const [whole, frac = ''] = String(text ?? '0').split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, '0'));
}

export function parseActions(list) {
  if (!Array.isArray(list)) throw new UserError('actions must be a JSON array');
  if (list.length < MIN_ACTIONS) throw new UserError(`a batch needs at least ${MIN_ACTIONS} independent actions (got ${list.length})`);
  if (list.length > 25) throw new UserError('at most 25 actions per batch');
  return list.map((a, i) => {
    const id = a.id ?? `a${i + 1}`;
    if (!isAddress(a.to)) throw new UserError(`action ${id}: "to" must be a 0x address`);
    const data = (a.data ?? '0x').toLowerCase();
    if (!/^0x([0-9a-f]{2})*$/.test(data)) throw new UserError(`action ${id}: "data" must be 0x followed by whole bytes`);
    const why = SENDER_DEPENDENT[data.slice(0, 10)];
    if (why) throw new UserError(`action ${id} is ${why}. It cannot be batched through Multicall3: the inner sender would be the Multicall3 contract, not you (and approving Multicall3 would let anyone spend your tokens). Send it on its own.`);
    return { id, to: a.to.toLowerCase(), data, value: parseAmount(a.amountPros ?? '0', `action ${id} amountPros`) };
  });
}

const hex = (v) => '0x' + v.toString(16);
async function simulate(chain, tool, tx, block, why) {
  try {
    return { ok: true, result: await chain.callTool(tool, { transaction: tx, block }, { why }) };
  } catch (err) {
    const rv = parseMcpRevert(err);
    if (!rv) throw err;
    return { ok: false, reason: decodeRevert(rv.data, rv.message).message };
  }
}
const pros = (v) => formatUnits(v, 18, 9);

// policy: 'exclude' = batch what passes and name what was left out; 'abort' = if any action
// fails, prepare nothing.
export async function planBatch({ chain }, { from, actions: input, onFailure = 'exclude' }) {
  if (!isAddress(from)) throw new UserError('from must be a 0x address (the account that would send the batch)');
  if (!['exclude', 'abort'].includes(onFailure)) throw new UserError('onFailure must be "exclude" or "abort"');
  const actions = parseActions(input);
  const block = await blockNumber(chain, 'Pin the whole plan to one block');
  const solo = (a) => ({ from, to: a.to, data: a.data, ...(a.value > 0n ? { value: hex(a.value) } : {}) });

  // 1. Each action on its own: would it work, and what would it cost sent alone?
  const checked = [];
  for (const a of actions) {
    const [call, gas] = await Promise.all([
      simulate(chain, 'eth_call', solo(a), block, `Simulate ${a.id} on its own (${shortAddress(a.to)})`),
      simulate(chain, 'estimate_gas', solo(a), block, `Gas of ${a.id} sent as its own transaction`),
    ]);
    const ok = call.ok && gas.ok;
    checked.push({ id: a.id, to: a.to, valuePros: pros(a.value), value: a.value.toString(), status: ok ? 'ok' : 'fails', reason: ok ? null : (call.reason ?? gas.reason), soloGas: ok ? Number(gas.result.gas) : null, included: false, action: a });
  }
  const failed = checked.filter((c) => c.status === 'fails');
  const included = onFailure === 'abort' && failed.length ? [] : checked.filter((c) => c.status === 'ok');
  included.forEach((c) => (c.included = true));
  const excluded = checked.filter((c) => !c.included);

  const out = {
    block, from, onFailure,
    actions: checked.map(({ action, ...rest }) => rest),
    included: included.map((c) => c.id), excluded: excluded.map((c) => ({ id: c.id, why: c.status === 'fails' ? `would fail: ${c.reason}` : 'left out because the policy is abort and another action fails' })),
    batch: null, comparison: null, verdict: included.length >= 1 ? 'ready' : 'nothing-to-send',
  };
  if (!included.length) {
    out.summary = onFailure === 'abort' && failed.length ? `Aborted: ${failed.map((f) => f.id).join(', ')} would fail, so nothing was prepared.` : 'No action can be sent.';
    return out;
  }

  // 2. The batch: one transaction through Multicall3, all-or-nothing (allowFailure=false) so a
  //    failing call can never strand the value that was meant for it.
  const calls = included.map((c) => ({ target: c.action.to, data: c.action.data, value: c.action.value, allowFailure: false }));
  const total = calls.reduce((s, c) => s + c.value, 0n);
  const tx = { from, to: MULTICALL3, data: encodeAggregate3Value(calls), value: hex(total) };
  const [call, gas] = await Promise.all([simulate(chain, 'eth_call', tx, block, 'Simulate the whole batch'), simulate(chain, 'estimate_gas', tx, block, 'Gas of the whole batch as one transaction')]);
  if (!call.ok || !gas.ok) {
    out.verdict = 'batch-would-fail';
    out.summary = `Every action passed alone but the batch would fail: ${call.reason ?? gas.reason}.`;
    out.batch = { to: MULTICALL3, value: total.toString(), valuePros: pros(total), calls: calls.length, data: tx.data, gas: null };
    return out;
  }
  const batchGas = Number(gas.result.gas);
  const soloTotal = included.reduce((s, c) => s + c.soloGas, 0);
  out.batch = { to: MULTICALL3, value: total.toString(), valuePros: pros(total), calls: calls.length, data: tx.data, gas: batchGas, tx };
  out.comparison = { transactionsBefore: included.length, transactionsAfter: 1, soloGasTotal: soloTotal, batchGas, gasSaved: soloTotal - batchGas, gasSavedPct: ((soloTotal - batchGas) / soloTotal) * 100 };
  out.summary = `${included.length} actions in 1 transaction: ${out.comparison.gasSaved >= 0 ? 'saves' : 'costs'} ${Math.abs(out.comparison.gasSaved).toLocaleString('en-US')} gas (${Math.abs(out.comparison.gasSavedPct).toFixed(1)}%)${excluded.length ? `; ${excluded.length} left out` : ''}.`;
  return out;
}

export default async function run({ q, chain }) {
  if (q.recorded) return { recorded: JSON.parse(await readFile(fileURLToPath(new URL('../../reports/batch-runs.json', import.meta.url)), 'utf8')) };
  let actions;
  try {
    actions = JSON.parse(q.actions ?? '[]');
  } catch (err) {
    throw new UserError(`actions is not valid JSON: ${err.message}`);
  }
  return { plan: await planBatch({ chain }, { from: q.from, actions, onFailure: q.onFailure ?? 'exclude' }) };
}
