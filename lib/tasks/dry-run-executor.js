// Task: Dry-Run Executor (Skill).
//
// Before a transaction is sent, simulate it: would it succeed, why would it revert, what
// would it cost, and what would change? If the simulation fails, execution is blocked
// automatically. The simulation is eth_call + estimate_gas on the live chain at one pinned
// block, so nothing is broadcast. The gate (guardedExecute) is the only way this module
// hands a transaction to an executor, and it will not do so after a failed simulation.

import { getCode, noCodeProblem, optionalCall, pinnedBlock } from '../chain.js';
import { SELECTORS, decodeString, decodeUint, encodeAddress, formatUnits, isAddress } from '../abi.js';
import { decodeRevert, parseMcpRevert } from '../revert.js';
import { UserError } from '../snapshot.js';
import { testnetEvidence } from '../testnet-report.js';
import { shortAddress } from '../labels.js';

const SEL = { transfer: '0xa9059cbb', approve: '0x095ea7b3', allowance: '0xdd62ed3e' };

export function parseTx(input) {
  const tx = { from: (input.from ?? '').toLowerCase(), to: (input.to ?? '').toLowerCase(), data: (input.data ?? '0x').toLowerCase(), value: input.value ?? '0' };
  if (!isAddress(tx.from)) throw new UserError('from must be a 0x address (the account that would send it)');
  if (!isAddress(tx.to)) throw new UserError('to must be a 0x address');
  if (!/^0x([0-9a-f]{2})*$/.test(tx.data)) throw new UserError('data must be 0x followed by whole bytes of hex');
  if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(String(tx.value))) throw new UserError('value must be a whole number of wei (decimal or 0x hex)');
  tx.value = BigInt(tx.value);
  if (tx.value >= 2n ** 256n) throw new UserError('value is larger than any amount the chain can hold (2^256 wei)');
  return tx;
}
const hexValue = (v) => '0x' + v.toString(16);
const toCall = (tx) => ({ from: tx.from, to: tx.to, data: tx.data, ...(tx.value > 0n ? { value: hexValue(tx.value) } : {}) });

// Run one simulation tool and return { ok, ... } instead of throwing on a revert.
async function simulate(chain, tool, tx, block, why) {
  try {
    const r = await chain.callTool(tool, { transaction: toCall(tx), block }, { why });
    return { ok: true, result: r };
  } catch (err) {
    const rv = parseMcpRevert(err);
    if (!rv) throw err; // a network/protocol failure is not a "revert": surface it
    return { ok: false, revert: decodeRevert(rv.data, rv.message) };
  }
}

// What would change, for the cases we can predict exactly: ERC-20 transfer and approve, and native value.
async function predictOutcome(chain, tx, block, willSucceed) {
  const sel = tx.data.slice(0, 10);
  const words = tx.data.slice(10).match(/.{64}/g) ?? [];
  const isToken = (sel === SEL.transfer && words.length >= 2) || (sel === SEL.approve && words.length >= 2);
  if (isToken && (await getCode(chain, tx.to, block))) {
    const [symRaw, decRaw] = await Promise.all([
      optionalCall(chain, tx.to, SELECTORS.symbol, block, 'Token symbol, to label the outcome'),
      optionalCall(chain, tx.to, SELECTORS.decimals, block, 'Token decimals, to format the outcome'),
    ]);
    const decimals = decRaw ? Number(decodeUint(decRaw)) : 18;
    const symbol = (symRaw && decodeString(symRaw)) || 'tokens';
    const counterparty = '0x' + words[0].slice(24);
    const amount = BigInt('0x' + words[1]);
    const fmt = (n) => `${formatUnits(n, decimals)} ${symbol}`;
    const bal = async (who) => decodeUint((await optionalCall(chain, tx.to, SELECTORS.balanceOf + encodeAddress(who), block, `balanceOf(${shortAddress(who)}) before`)) ?? '0x0') ?? 0n;
    if (sel === SEL.transfer) {
      const [a, b] = await Promise.all([bal(tx.from), bal(counterparty)]);
      // A token that charges a fee, rebases or otherwise does not move exactly `amount` cannot be predicted from the amount alone.
      const exact = !willSucceed || a >= amount;
      return { kind: 'erc20-transfer', ...(exact ? {} : { caveat: `the balance read here (${fmt(a)}) is below the amount, yet the call succeeds, so this token does not move exactly the amount it is asked to: the after-values are not predicted` }), summary: `Move ${fmt(amount)} from ${shortAddress(tx.from)} to ${shortAddress(counterparty)}`, rows: [
        { label: `${shortAddress(tx.from)} ${symbol}`, before: fmt(a), after: !willSucceed ? 'unchanged (it would revert)' : exact ? fmt(a - amount) : 'not predicted' },
        { label: `${shortAddress(counterparty)} ${symbol}`, before: fmt(b), after: !willSucceed ? 'unchanged (it would revert)' : exact ? fmt(b + amount) : 'not predicted' },
      ] };
    }
    const allowance = decodeUint((await optionalCall(chain, tx.to, SEL.allowance + encodeAddress(tx.from) + encodeAddress(counterparty), block, 'Current allowance')) ?? '0x0') ?? 0n;
    return { kind: 'erc20-approve', summary: `Let ${shortAddress(counterparty)} spend up to ${fmt(amount)} of ${shortAddress(tx.from)}’s ${symbol}`, rows: [{ label: `allowance of ${shortAddress(counterparty)}`, before: fmt(allowance), after: willSucceed ? fmt(amount) : 'unchanged (it would revert)' }] };
  }
  if (tx.value > 0n) {
    const bal = async (who) => BigInt((await chain.callTool('get_balance', { address: who, block }, { why: `Native balance of ${shortAddress(who)} before` })).balanceWei);
    const [a, b] = await Promise.all([bal(tx.from), bal(tx.to)]);
    const f = (n) => `${formatUnits(n, 18)} PROS`;
    return { kind: 'native-transfer', summary: `Send ${f(tx.value)} from ${shortAddress(tx.from)} to ${shortAddress(tx.to)} (gas is extra)`, rows: [
      { label: `${shortAddress(tx.from)} PROS`, before: f(a), after: willSucceed ? f(a - tx.value) + ' (before gas)' : 'unchanged (it would revert)' },
      { label: `${shortAddress(tx.to)} PROS`, before: f(b), after: willSucceed ? f(b + tx.value) : 'unchanged (it would revert)' },
    ] };
  }
  return { kind: 'unknown', summary: 'This call is not a plain transfer or approval, so a before/after state diff cannot be predicted from the call data alone (run it on a fork to get one).', rows: [] };
}

// `block` (optional) pins the simulation to a block the caller already chose, e.g. a flow that read the block's time first.
export async function dryRun({ chain }, input, { block: given } = {}) {
  const tx = parseTx(input);
  const block = given ?? (await pinnedBlock(chain, 'Pin the simulation to one block (just behind the latest, which every backend node has)'));
  const [call, gas, price] = await Promise.all([
    simulate(chain, 'eth_call', tx, block, 'Simulate the call (no broadcast): does it succeed?'),
    simulate(chain, 'estimate_gas', tx, block, 'Estimate the gas it would use'),
    chain.callTool('get_gas_price', {}, { why: 'Current gas price, to cost it' }),
  ]);
  const noCode = await noCodeProblem(chain, tx.to, tx.data, block);
  const returned = call.ok ? call.result.result ?? '0x' : null;
  const tokenCall = [SEL.transfer, SEL.approve, '0x23b872dd'].includes(tx.data.slice(0, 10));
  const refused = tokenCall && call.ok && returned !== '0x' && returned !== '0x' + '0'.repeat(63) + '1';
  const success = call.ok && gas.ok && !noCode && !refused;
  const revert = noCode ? { message: noCode, kind: 'no-code' } : refused ? { message: 'The token returned false or an invalid boolean: the operation was refused', kind: 'token-return' } : call.revert ?? gas.revert ?? null;
  const gasUnits = gas.ok ? Number(gas.result.gas) : null;
  const gasWei = gasUnits == null ? null : BigInt(gasUnits) * BigInt(price.gasPriceWei);
  const outcome = await predictOutcome(chain, tx, block, success);
  return {
    block, tx: { ...tx, value: tx.value.toString() },
    verdict: success ? 'go' : 'blocked',
    summary: success ? 'The simulation succeeded: the transaction would go through.' : `The simulation failed: ${(revert?.message ?? 'the call reverted').replace(/[.\s]+$/, '')}.`,
    prediction: success ? 'success' : 'revert',
    revert, returnData: returned,
    gas: gasUnits == null ? null : { units: gasUnits, suggestedLimit: Math.ceil(gasUnits * 1.2), priceGwei: Number(price.gasPriceGwei), costPros: formatUnits(gasWei, 18, 9), costWei: gasWei.toString() },
    outcome,
  };
}

// The gate. A transaction reaches `exec.send` only if its simulation succeeded.
export async function guardedExecute({ chain, exec }, input) {
  const report = await dryRun({ chain }, input);
  if (report.verdict !== 'go') return { executed: false, blocked: true, reason: report.summary, report };
  const sent = await exec.send(toCall(parseTx(input)));
  return { executed: true, blocked: false, sent, report };
}

export default async function run({ q, chain }) {
  if (q.real === 'testnet') return { testnet: await testnetEvidence() };
  return { report: await dryRun({ chain }, { from: q.from, to: q.to, data: q.data, value: q.value || '0' }) };
}
