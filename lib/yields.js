// Realised yield of an ERC-4626 vault, measured from its own share price: how much one share was worth in the underlying asset at three blocks
// (a lookback ago, halfway, now). This is what the vault actually paid, net of whatever it charges (a performance fee mints shares to the fee
// recipient, so it is already in the price). It says nothing about the future, and the agents say so.

import { SEL, VAULT_LIST, enc } from './defi.js';
import { getBlock } from './chain.js';
import { asUint } from './onchain.js';
import { UserError } from './snapshot.js';

export const DEFAULT_LOOKBACK = 400_000; // blocks, about 4.3 days on Pharos mainnet
const EXTRA_DIGITS = 6; // ask for the value of a million shares, so the price has 6 more digits of precision than one share would give

const unitOf = (v) => 10n ** BigInt(v.shareDecimals + EXTRA_DIGITS);

// annualised rate from two prices (as BigInt, same unit) and the seconds between them; null when it cannot be computed honestly
export function annualise(p0, p1, seconds) {
  if (!(p0 > 0n) || !(p1 > 0n) || !(seconds > 0)) return null;
  const growth = Number((p1 * 1_000_000_000_000n) / p0) / 1e12 - 1; // exact to 12 digits before leaving BigInt
  const years = seconds / 31_557_600;
  return { growth, apy: (1 + growth) ** (1 / years) - 1, simple: growth / years };
}

// Reads the share price of each vault at three blocks and works out the rate over the whole window and over each half.
// `reader` is a makeReader() (every batch is confirmed on the public RPC); `tr` the shared step recorder; `chain` is only used for block headers.
export async function measureYields({ reader, tr, chain, head, lookback = DEFAULT_LOOKBACK, vaults = VAULT_LIST, headerOf }) {
  if (!Number.isInteger(lookback) || lookback < 1000 || lookback >= head) throw new UserError(`lookback must be a whole number of blocks from 1,000 to ${head - 1}`);
  const blocks = { start: head - lookback, mid: head - Math.floor(lookback / 2), end: head };
  const header = headerOf ?? ((b) => getBlock(chain, b, 'Block header: the time between two share-price readings'));
  const [t0, tm, t1] = await Promise.all([header(blocks.start), header(blocks.mid), header(blocks.end)]);
  const times = { start: t0.timestamp, mid: tm.timestamp, end: t1.timestamp };
  const read = {};
  for (const [name, b] of Object.entries(blocks)) {
    read[name] = await reader.batch(vaults.map((v) => ({ id: v.id, target: v.address, data: SEL.convertToAssets + enc.uint(unitOf(v)), label: `convertToAssets(${unitOf(v)}): value of a million shares` })), `Share price of ${vaults.length} vaults at block ${b.toLocaleString('en-US')}`, b);
  }
  const stepUsed = [read.start[0]?.source.step, read.mid[0]?.source.step, read.end[0]?.source.step].filter(Boolean);
  return Object.fromEntries(vaults.map((v, i) => {
    const p = { start: asUint(read.start[i]), mid: asUint(read.mid[i]), end: asUint(read.end[i]) };
    if (p.start == null || p.mid == null || p.end == null) return [v.id, { vault: v, ok: false, reason: 'the share price could not be read at one of the three blocks', steps: stepUsed }];
    const whole = annualise(p.start, p.end, times.end - times.start);
    const early = annualise(p.start, p.mid, times.mid - times.start);
    const late = annualise(p.mid, p.end, times.end - times.mid);
    return [v.id, {
      vault: v, ok: whole != null, blocks, times, prices: p, days: (times.end - times.start) / 86400,
      growth: whole?.growth ?? null, apy: whole?.apy ?? null, apyEarly: early?.apy ?? null, apyLate: late?.apy ?? null,
      // "steady": both halves of the window are within a factor of two of each other (a vault that paid everything in one day is not 15% a year)
      steady: Boolean(whole && early && late && early.apy > 0 && late.apy > 0 && Math.max(early.apy, late.apy) / Math.min(early.apy, late.apy) <= 2),
      sources: [read.start[i].source, read.mid[i].source, read.end[i].source], steps: stepUsed,
    }];
  }));
}
