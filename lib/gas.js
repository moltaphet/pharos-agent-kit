// Gas fee optimizer for Pharos. Reads what a transaction would cost right now (base fee, eth_gasPrice, the suggested tip) and how it has moved, decides whether the price is
// favourable against a target, and runs a hold-until-favourable-or-deadline loop that ALWAYS submits by the deadline. The transaction is priced with EIP-1559 fields
// (maxFee with headroom, minimal tip), so what is paid is base fee + tip, not the padded eth_gasPrice a naive wallet would sign.

import { rpcCall } from './rpc.js';
import { UserError } from './snapshot.js';

export const GWEI = 10n ** 9n;
const hex = (n) => '0x' + n.toString(16);
const num = (h) => Number(BigInt(h));
export const gwei = (wei) => Number(wei) / 1e9;
export const fmtGwei = (wei) => `${(Number(wei) / 1e9).toFixed(Number(wei) % 10 ** 9 === 0 ? 0 : 6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')} gwei`;
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- reading ------------------------------------------------------------------------------------------------------------------------------

/** One reading of the network's price: the next block's base fee, what eth_gasPrice says, and the suggested tip. */
export async function sampleGas(rpc) {
  const [block, gasPrice, tip] = await Promise.all([
    rpc('eth_getBlockByNumber', ['latest', false]),
    rpc('eth_gasPrice', []),
    rpc('eth_maxPriorityFeePerGas', []).catch(() => '0x0'),
  ]);
  const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : BigInt(gasPrice); // a chain without a base fee: the gas price is the price
  return { at: Date.now(), block: num(block.number), blockTime: num(block.timestamp), baseFee, gasPrice: BigInt(gasPrice), tip: BigInt(tip), fullness: Number(BigInt(block.gasUsed)) / Number(BigInt(block.gasLimit)) };
}

/** What a transaction pays per gas at a sample if it is priced the efficient way: base fee plus the tip. */
export const effectivePrice = (s) => s.baseFee + s.tip;

/** The price history: `points` samples spread over the last `span` blocks (block header reads only). */
export async function gasHistory(rpc, { span = 2400, points = 24 } = {}) {
  if (!Number.isInteger(span) || span < 10 || span > 100_000 || !Number.isInteger(points) || points < 2 || points > 60) throw new UserError('span must be 10 to 100,000 blocks and points 2 to 60');
  const head = num(await rpc('eth_blockNumber', [])) - 1;
  const step = Math.max(1, Math.floor(span / (points - 1)));
  const rows = [];
  for (let i = points - 1; i >= 0; i--) {
    const n = head - i * step;
    if (n < 1) continue;
    const b = await rpc('eth_getBlockByNumber', [hex(n), false]);
    if (b) rows.push({ block: n, time: num(b.timestamp), baseFee: b.baseFeePerGas ? BigInt(b.baseFeePerGas) : null, fullness: Number(BigInt(b.gasUsed)) / Number(BigInt(b.gasLimit)) });
  }
  const fees = rows.map((r) => r.baseFee).filter((x) => x != null).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pct = (p) => fees[Math.min(fees.length - 1, Math.floor((p / 100) * fees.length))];
  const stats = fees.length ? { min: fees[0], p25: pct(25), median: pct(50), p75: pct(75), max: fees[fees.length - 1], samples: fees.length, flat: fees[0] === fees[fees.length - 1] } : null;
  return { span, step, rows, stats };
}

// ---- the decision -------------------------------------------------------------------------------------------------------------------------

/**
 * Favourable means the price a transaction would pay now is at or below the target. The target is the caller's own ceiling (`maxPrice`, wei per gas) or, if none is
 * given, the history's 25th percentile: "no worse than the cheap quarter of recent blocks".
 */
export function decide({ sample, maxPrice = null, history = null }) {
  const price = effectivePrice(sample);
  const target = maxPrice != null ? BigInt(maxPrice) : history?.stats?.p25 != null ? history.stats.p25 + sample.tip : null;
  if (target == null) throw new UserError('give a maxPrice or a gas history to derive the target from');
  return { favorable: price <= target, price, target, targetSource: maxPrice != null ? 'your ceiling' : 'the 25th percentile of recent base fees' };
}

/** EIP-1559 fields for a submission. The tip is the network's suggestion; maxFee has headroom so the transaction survives a base-fee rise before it is mined. It does not raise what is paid. */
export function feesFor(sample, { urgent = false } = {}) {
  const headroom = urgent ? 3n : 2n;
  return { maxFeePerGas: sample.baseFee * headroom + sample.tip, maxPriorityFeePerGas: sample.tip };
}

// ---- the loop -----------------------------------------------------------------------------------------------------------------------------

/**
 * Hold a transaction until the price is favourable or the deadline, whichever comes first, then submit it. The deadline is the latest moment of SUBMISSION: at that moment the
 * transaction goes out at whatever the price is. `submit(fees, sample)` must return { hash, gasUsed, effectiveGasPrice, ... } once mined (or throw).
 *
 * Time is injected (`now`, `sleep`) so the loop is tested with scripted prices; in the real run they are the clock.
 */
export async function submitWithin({ sampler, submit, deadlineMs, maxPrice = null, history = null, pollMs = 5000, leadMs = 0, now = Date.now, sleep = sleepReal, maxHoldSamples = 500, onSample = () => {} }) {
  if (typeof sampler !== 'function' || typeof submit !== 'function') throw new UserError('sampler and submit must be functions');
  if (!Number.isFinite(deadlineMs)) throw new UserError('deadlineMs must be a timestamp');
  if (!Number.isFinite(pollMs) || pollMs < 1) throw new UserError('pollMs must be at least 1 millisecond');
  const startedAt = now();
  if (deadlineMs < startedAt) throw new UserError('the deadline is already in the past');
  const holds = [];
  let first = null;
  let last = null;
  let reason = null;
  let lastError = null;
  for (let i = 0; ; i++) {
    const t = now();
    const mustGo = t + leadMs >= deadlineMs || i >= maxHoldSamples;
    let sample = null;
    try { sample = await sampler(); lastError = null; } catch (err) { lastError = err.message; }
    if (sample) {
      first ??= sample;
      last = sample;
      const d = decide({ sample, maxPrice, history });
      const row = { t: t - startedAt, block: sample.block, baseFee: sample.baseFee, price: d.price, target: d.target, favorable: d.favorable };
      holds.push(row);
      onSample(row);
      if (d.favorable) { reason = 'favorable'; break; }
    } else holds.push({ t: t - startedAt, error: lastError });
    if (mustGo) { reason = 'deadline'; break; }
    await sleep(Math.max(1, Math.min(pollMs, deadlineMs - leadMs - now())));
  }
  // at the deadline the price may not have been read at all (RPC trouble): use the last good reading, and read once more if there is none
  if (!last) { last = await sampler(); first = last; }
  const sentAt = now();
  const fees = feesFor(last, { urgent: reason === 'deadline' });
  let attempt = 0;
  let sent = null;
  for (;;) {
    try { sent = await submit(fees, last); break; } catch (err) { if (++attempt >= 3) throw Object.assign(new Error(`submission failed ${attempt} times; last error: ${err.message}`), { holds, reason }); await sleep(500 * attempt); }
  }
  const paid = BigInt(sent.effectiveGasPrice) * BigInt(sent.gasUsed);
  const naive = BigInt(sent.gasUsed) * first.gasPrice; // what signing at the price eth_gasPrice quoted at the request would have cost
  return {
    reason, heldMs: sentAt - startedAt, deadlineMs: Math.max(0, deadlineMs - sentAt), submittedBeforeDeadline: sentAt <= deadlineMs, samples: holds.length, holds,
    atRequest: { block: first.block, gasPrice: first.gasPrice, baseFee: first.baseFee }, atSubmit: { block: last.block, baseFee: last.baseFee, tip: last.tip, ...fees },
    paid: { gasUsed: BigInt(sent.gasUsed), effectiveGasPrice: BigInt(sent.effectiveGasPrice), costWei: paid }, naiveCostWei: naive, savedWei: naive - paid, tx: sent,
  };
}

export const publicSampler = (rpcUrl) => {
  const rpc = (method, params = []) => rpcCall(method, params, { url: rpcUrl, why: `gas optimizer: ${method}` });
  return { rpc, sample: () => sampleGas(rpc) };
};
