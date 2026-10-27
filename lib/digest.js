// Weekly digest for Pharos mainnet: what changed in a period, the key numbers against the previous period, and the three most notable things that happened, as text a person
// can read, delivered to a channel or published as a page. Key numbers are read at sampled blocks (archive state through the public RPC, in batches): the PROS/USD price, USDC
// supply, the Morpho Blue syzUSD/USDC market, the four USDC vaults (value locked and share price, so the realised return of the period), and network activity. In `full` depth the
// Morpho Blue event logs of both periods are counted too (supplies, withdrawals, borrows, repayments, liquidations) and the largest ones are candidates for the notable events.

import { formatUnits } from './abi.js';
import { VAULT_LIST } from './defi.js';
import { FEEDS, EXPLORER } from './defi.js';
import { keccak256, selectorOf } from './keccak.js';
import { MORPHO } from './protocols.js';
import { batchRpc, batchRpcStrict } from './rpc-batch.js';
import { PHAROS_RPC } from './rpc.js';
import { UserError } from './snapshot.js';

export const MAX_DAYS = 14;
const MARKET_ID = MORPHO.markets['syzUSD/USDC'];
const SAMPLES_PER_DAY = 4;
const hex = (n) => '0x' + n.toString(16);
const num = (h) => Number(BigInt(h));
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const T = (sig) => '0x' + keccak256(Buffer.from(sig));
const MORPHO_EVENTS = {
  [T('Supply(bytes32,address,address,uint256,uint256)')]: 'supply', [T('Withdraw(bytes32,address,address,address,uint256,uint256)')]: 'withdraw', [T('Borrow(bytes32,address,address,address,uint256,uint256)')]: 'borrow',
  [T('Repay(bytes32,address,address,uint256,uint256)')]: 'repay', [T('Liquidate(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)')]: 'liquidate',
};
const usdc = (raw) => Number(raw) / 1e6;
const money = (v) => `$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
const pct = (v) => (Math.abs(v) >= 10 ? `×${(1 + v).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `${v > 0 ? '+' : ''}${(v * 100).toFixed(Math.abs(v) < 0.01 ? 2 : 1)}%`);
const iso = (t) => new Date(t * 1000).toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC');

// ---- periods ------------------------------------------------------------------------------------------------------------------------------

const batchOpts = (url) => ({ url, concurrency: 3 });
async function headers(url, ns) { const rows = await batchRpcStrict(ns.map((n) => ({ method: 'eth_getBlockByNumber', params: [hex(n), false] })), { url }); return rows.map((b, i) => ({ number: ns[i], time: num(b.timestamp) })); }
async function header(url, n) { return (await headers(url, [n]))[0]; }
// The first block at or after `ts`, in a handful of batched reads instead of a long search: guess from the average block time, then narrow with one batch of headers around the guess.
async function blockAt(url, ts, head) {
  if (ts >= head.time) return head.number;
  const ref = await header(url, Math.max(1, head.number - 200_000));
  const perBlock = (head.time - ref.time) / (head.number - ref.number);
  let lo = Math.max(1, Math.floor(head.number - (head.time - ts) / perBlock - 3000)); let hi = Math.min(head.number, lo + 6000);
  while (hi - lo > 40) {
    const marks = Array.from({ length: 41 }, (_, i) => Math.min(hi, lo + Math.round(((hi - lo) * i) / 40)));
    const hs = await headers(url, marks);
    const idx = hs.findIndex((h) => h.time >= ts);
    if (idx === 0) { lo = Math.max(1, lo - 6000); continue; }          // the guess was too late: step back and look again
    if (idx === -1) { lo = hi; hi = Math.min(head.number, hi + 6000); continue; } // too early: step forward
    lo = hs[idx - 1].number; hi = hs[idx].number;
  }
  const hs = await headers(url, Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
  return hs.find((h) => h.time >= ts)?.number ?? hi;
}

/** The current period (ending at `end`, default now) and the previous one of the same length, as block numbers. */
export async function periods({ days = 7, end = null, url = PHAROS_RPC }) {
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) throw new UserError(`days must be 1 to ${MAX_DAYS}`);
  const [b] = await batchRpcStrict([{ method: 'eth_blockNumber' }], { url });
  const head = await header(url, num(b) - 2);
  const endTime = end == null ? head.time : Math.min(end, head.time);
  const span = days * 86_400;
  const [s0, s1, s2] = await Promise.all([blockAt(url, endTime - 2 * span, head), blockAt(url, endTime - span, head), blockAt(url, endTime, head)]);
  const [h0, h1, h2] = await Promise.all([header(url, s0), header(url, s1), header(url, s2)]);
  return { days, previous: { fromBlock: s0, toBlock: s1 - 1, fromTime: h0.time, toTime: h1.time }, current: { fromBlock: s1, toBlock: s2, fromTime: h1.time, toTime: h2.time } };
}

// ---- state samples ------------------------------------------------------------------------------------------------------------------------

const SEL = { totalSupply: selectorOf('totalSupply()'), market: selectorOf('market(bytes32)'), totalAssets: selectorOf('totalAssets()'), convertToAssets: selectorOf('convertToAssets(uint256)'), latestAnswer: selectorOf('latestAnswer()'), latestRoundData: '0xfeaf968c' };
const callsAt = () => [
  ['price', FEEDS['PROS/USD'].address, SEL.latestRoundData], ['usdcSupply', '0xc879c018db60520f4355c26ed1a6d572cdac1815', SEL.totalSupply], ['market', MORPHO.address, SEL.market + MARKET_ID.slice(2)],
  ...VAULT_LIST.flatMap((v) => [[`tvl:${v.address}`, v.address, SEL.totalAssets], [`px:${v.address}`, v.address, SEL.convertToAssets + word(10n ** BigInt(v.shareDecimals))]]),
];
const uint = (r, i = 0) => (r?.ok && r.result?.length >= 66 + 64 * i ? BigInt('0x' + r.result.slice(2 + 64 * i, 66 + 64 * i)) : null);

/** State at each of the given blocks, in as few requests as possible. */
export async function sampleState(blocks, { url = PHAROS_RPC, light = false } = {}) {
  const calls = light ? callsAt().slice(0, 1) : callsAt(); // light: the block header and the price only
  const reqs = blocks.flatMap((n) => [{ method: 'eth_getBlockByNumber', params: [hex(n), false] }, ...calls.map(([, to, data]) => ({ method: 'eth_call', params: [{ to, data }, hex(n)] }))]);
  const rows = await batchRpc(reqs, batchOpts(url));
  const per = calls.length + 1;
  return blocks.map((n, i) => {
    const r = rows.slice(i * per, (i + 1) * per);
    const b = r[0].ok ? r[0].result : null;
    const get = (id) => r[1 + calls.findIndex((c) => c[0] === id)];
    const mk = light ? null : get('market');
    const supply = uint(mk, 0); const borrow = uint(mk, 2);
    return {
      block: n, time: b ? num(b.timestamp) : null, txs: b ? b.transactions.length : null, fullness: b ? Number(BigInt(b.gasUsed)) / Number(BigInt(b.gasLimit)) : null,
      price: uint(get('price'), 1), priceUpdatedAt: uint(get('price'), 3), usdcSupply: light ? null : uint(get('usdcSupply')), marketSupply: supply, marketBorrow: borrow,
      vaults: Object.fromEntries(VAULT_LIST.map((v) => [v.address, light ? { tvl: null, px: null } : { tvl: uint(get(`tvl:${v.address}`)), px: uint(get(`px:${v.address}`)) }])),
    };
  });
}

// The public RPC is load-balanced and some of its nodes answer from older state. Two guards: a price feed's updatedAt never goes back (a sample older than an earlier one is
// read again, and dropped if it stays old), and the first and last sample of each period, which decide every comparison, are read three times and each value must be agreed by two reads.
const FIELDS = ['price', 'priceUpdatedAt', 'usdcSupply', 'marketSupply', 'marketBorrow'];
const same = (a, b) => (a == null && b == null) || (a != null && b != null && String(a) === String(b));
function majority(reads, get) { for (const r of reads) if (reads.filter((x) => same(get(x), get(r))).length >= 2) return { ok: true, value: get(r) }; return { ok: false, value: null }; }
async function stabilize(samples, url) {
  const ends = [0, samples.length - 1];
  for (const i of ends) {
    const more = await sampleState([samples[i].block, samples[i].block], { url });
    const reads = [samples[i], ...more];
    for (const f of FIELDS) { const m = majority(reads, (x) => x[f]); samples[i][f] = m.value; }
    for (const v of VAULT_LIST) for (const k of ['tvl', 'px']) { const m = majority(reads, (x) => x.vaults[v.address][k]); samples[i].vaults[v.address][k] = m.value; }
  }
  let newest = 0n;
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    for (let tries = 0; tries < 3 && s.priceUpdatedAt != null && s.priceUpdatedAt < newest; tries++) { [s] = await sampleState([s.block], { url }); samples[i] = s; }
    if (s.priceUpdatedAt != null && s.priceUpdatedAt < newest) { s.price = null; s.priceUpdatedAt = null; }
    else if (s.priceUpdatedAt != null && s.priceUpdatedAt > newest) newest = s.priceUpdatedAt;
  }
  return samples;
}

// full state at the two ends of a period (they decide every comparison), the price and block header between them
async function sampleAll(blocks, url) {
  const [ends, mid] = await Promise.all([sampleState([blocks[0], blocks[blocks.length - 1]], { url }), blocks.length > 2 ? sampleState(blocks.slice(1, -1), { url, light: true }) : []]);
  return [ends[0], ...mid, ends[1]];
}

function spaced(from, to, count) { const out = []; for (let i = 0; i < count; i++) out.push(Math.round(from + ((to - from) * i) / (count - 1))); return out; }

async function morphoEvents({ fromBlock, toBlock, url }) {
  const reqs = [];
  for (let a = fromBlock; a <= toBlock; a += 1000) reqs.push({ method: 'eth_getLogs', params: [{ address: MORPHO.address, topics: [Object.keys(MORPHO_EVENTS), MARKET_ID], fromBlock: hex(a), toBlock: hex(Math.min(a + 999, toBlock)) }] });
  const logs = (await batchRpcStrict(reqs, batchOpts(url))).flat().filter((l) => !l.removed);
  return logs.map((l) => {
    const kind = MORPHO_EVENTS[l.topics[0]]; const d = l.data.slice(2); const w = (i) => BigInt('0x' + d.slice(i * 64, (i + 1) * 64));
    const assets = kind === 'supply' || kind === 'repay' ? w(0) : kind === 'liquidate' ? w(0) : w(1);
    return { kind, assets, block: num(l.blockNumber), hash: l.transactionHash, who: '0x' + l.topics[2].slice(26), ...(kind === 'liquidate' && { borrower: '0x' + l.topics[3].slice(26), seized: w(2), badDebt: w(3) }) };
  });
}

// ---- the digest ---------------------------------------------------------------------------------------------------------------------------

const change = (now, before) => (now == null || before == null || before === 0 ? null : (now - before) / before);
const metric = (id, label, now, before, fmt, { note = null, flow = false } = {}) => ({ id, label, now, before, text: now == null ? 'n/a' : fmt(now), beforeText: before == null ? 'n/a' : fmt(before), change: change(now, before), note, flow });

/**
 * Build the digest. depth: 'state' (fast, state reads only) or 'full' (adds the Morpho Blue event logs of both periods).
 */
export async function buildDigest({ days = 7, end = null, depth = 'full', url = PHAROS_RPC, subject = 'Pharos DeFi', now = () => new Date(), timing = null } = {}) {
  const lap = (label) => timing?.push([label, Date.now()]);
  lap('start');
  if (!['state', 'full'].includes(depth)) throw new UserError('depth must be state or full');
  const P = await periods({ days, end, url });
  lap('periods');
  const curBlocks = spaced(P.current.fromBlock, P.current.toBlock, days * SAMPLES_PER_DAY + 1);
  const prevBlocks = spaced(P.previous.fromBlock, P.previous.toBlock + 1, days + 1);
  const [cur, prev] = await Promise.all([sampleAll(curBlocks, url).then((x) => stabilize(x, url)), sampleAll(prevBlocks, url).then((x) => stabilize(x, url))]);
  lap('samples');
  const usable = (xs, k) => xs.map((s) => s[k]).filter((v) => v != null);
  const first = (xs, k) => xs.find((s) => s[k] != null)?.[k] ?? null; const last = (xs, k) => [...xs].reverse().find((s) => s[k] != null)?.[k] ?? null;
  const priceF = (raw) => Number(raw) / 1e18;
  const metrics = [];
  const pNow = last(cur, 'price'); const pStart = first(cur, 'price'); const pPrevEnd = last(prev, 'price');
  const prices = usable(cur, 'price').map(priceF);
  metrics.push(metric('price', 'PROS price (USD)', pNow == null ? null : priceF(pNow), pPrevEnd == null ? null : priceF(pPrevEnd), (v) => `$${v.toFixed(4)}`, { note: prices.length ? `range this period $${Math.min(...prices).toFixed(4)} to $${Math.max(...prices).toFixed(4)}` : null }));
  metrics.push(metric('usdc', 'USDC supply', last(cur, 'usdcSupply') == null ? null : usdc(last(cur, 'usdcSupply')), last(prev, 'usdcSupply') == null ? null : usdc(last(prev, 'usdcSupply')), money));
  const ms = last(cur, 'marketSupply'); const mb = last(cur, 'marketBorrow'); const ps = last(prev, 'marketSupply'); const pb = last(prev, 'marketBorrow');
  metrics.push(metric('market-supply', 'Morpho syzUSD/USDC: supplied', ms == null ? null : usdc(ms), ps == null ? null : usdc(ps), money));
  metrics.push(metric('market-borrow', 'Morpho syzUSD/USDC: borrowed', mb == null ? null : usdc(mb), pb == null ? null : usdc(pb), money));
  metrics.push(metric('utilization', 'Morpho syzUSD/USDC: utilisation', ms ? Number(mb) / Number(ms) : null, ps ? Number(pb) / Number(ps) : null, (v) => `${(v * 100).toFixed(1)}%`, { note: 'borrowed as a share of supplied' }));
  // vaults: value locked and the realised return of each period (share price at the end over the start)
  const vaultRows = VAULT_LIST.map((v) => {
    const a = cur[0].vaults[v.address]; const b = cur[cur.length - 1].vaults[v.address]; const c = prev[0].vaults[v.address]; const d = prev[prev.length - 1].vaults[v.address];
    const ret = (x, y) => (x?.px && y?.px ? Number(y.px) / Number(x.px) - 1 : null);
    return { name: v.name, address: v.address, tvl: b.tvl == null ? null : usdc(b.tvl), tvlBefore: d.tvl == null ? null : usdc(d.tvl), ret: ret(a, b), retBefore: ret(c, d), apr: ret(a, b) == null ? null : ret(a, b) * (365 / days) };
  });
  const tvlNow = vaultRows.reduce((s, v) => s + (v.tvl ?? 0), 0); const tvlBefore = vaultRows.reduce((s, v) => s + (v.tvlBefore ?? 0), 0);
  metrics.push(metric('vault-tvl', 'Value locked in the four USDC vaults', tvlNow, tvlBefore, money));
  const best = [...vaultRows].filter((v) => v.ret != null).sort((x, y) => y.ret - x.ret)[0];
  if (best) metrics.push(metric('best-vault', `Best vault return this period (${best.name})`, best.ret, best.retBefore, (v) => `${(v * 100).toFixed(3)}%`, { note: `about ${(best.apr * 100).toFixed(1)}% a year if it continued` }));
  const median = (xs, k) => { const v = usable(xs, k).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
  const blocksNow = P.current.toBlock - P.current.fromBlock + 1; const blocksPrev = P.previous.toBlock - P.previous.fromBlock + 1;
  metrics.push(metric('blocks', 'Blocks produced', blocksNow, blocksPrev, (v) => v.toLocaleString('en-US'), { flow: true }));
  // traffic on Pharos comes in bursts, so a total estimated from a few blocks swings wildly between runs; the median block is stable
  metrics.push(metric('txs', 'Transactions in a typical block (median of sampled blocks)', median(cur, 'txs'), median(prev, 'txs'), (v) => v.toLocaleString('en-US', { maximumFractionDigits: 1 }), { note: `median of ${usable(cur, 'txs').length} sampled blocks; the busiest held ${Math.max(0, ...usable(cur, 'txs'))}` }));

  // events (full depth)
  let events = null; let evNow = []; let evPrev = [];
  if (depth === 'full') {
    [evNow, evPrev] = await Promise.all([morphoEvents({ ...P.current, url }), morphoEvents({ ...P.previous, url })]);
    const sum = (e, k) => e.filter((x) => x.kind === k).reduce((s, x) => s + usdc(x.assets), 0);
    for (const k of ['supply', 'borrow', 'repay', 'withdraw']) metrics.push(metric(`ev-${k}`, `Morpho syzUSD/USDC: ${k} volume`, sum(evNow, k), sum(evPrev, k), money, { flow: true, note: `${evNow.filter((x) => x.kind === k).length} ${k} events (${evPrev.filter((x) => x.kind === k).length} the period before)` }));
    metrics.push(metric('ev-liq', 'Morpho syzUSD/USDC: liquidations', evNow.filter((x) => x.kind === 'liquidate').length, evPrev.filter((x) => x.kind === 'liquidate').length, (v) => String(v), { flow: true }));
    events = { current: evNow.length, previous: evPrev.length };
  }

  // the three most notable things
  const cand = [];
  for (const e of evNow.filter((x) => x.kind === 'liquidate')) cand.push({ score: 1000 + usdc(e.assets), event: true, kind: 'liquidation', text: `A position in the Morpho syzUSD/USDC market was liquidated: ${money(usdc(e.assets))} of debt repaid${e.badDebt > 0n ? `, with ${money(usdc(e.badDebt))} of bad debt` : ''}.`, link: `${EXPLORER}/tx/${e.hash}`, block: e.block });
  for (const k of ['supply', 'borrow', 'withdraw', 'repay']) { const top = evNow.filter((x) => x.kind === k).sort((a, b) => (b.assets > a.assets ? 1 : -1))[0]; if (top) cand.push({ score: ms ? (usdc(top.assets) / usdc(ms)) * 100 : 1, event: true, kind: `largest ${k}`, text: `The largest ${k} in the Morpho syzUSD/USDC market was ${money(usdc(top.assets))}.`, link: `${EXPLORER}/tx/${top.hash}`, block: top.block }); }
  if (prices.length > 1) {
    let big = null; for (let i = 1; i < cur.length; i++) { if (cur[i].price == null || cur[i - 1].price == null) continue; const c = priceF(cur[i].price) / priceF(cur[i - 1].price) - 1; if (!big || Math.abs(c) > Math.abs(big.c)) big = { c, at: cur[i].time, block: cur[i].block }; }
    const total = pNow && pStart ? priceF(pNow) / priceF(pStart) - 1 : 0;
    if (big && Math.abs(big.c) >= 0.01) cand.push({ score: Math.abs(big.c) * 100, kind: 'price move', text: `PROS moved ${pct(big.c)} within one six-hour window ending ${iso(big.at)}; over the period it went ${pct(total)} to $${priceF(pNow).toFixed(4)}.`, block: big.block });
    else if (Math.abs(total) >= 0.02) cand.push({ score: Math.abs(total) * 100, kind: 'price move', text: `PROS went ${pct(total)} over the period, to $${priceF(pNow).toFixed(4)}.`, block: P.current.toBlock });
  }
  for (const v of vaultRows) { const c = change(v.tvl, v.tvlBefore); if (c != null && Math.abs(c) >= 0.05 && Math.abs((v.tvl ?? 0) - (v.tvlBefore ?? 0)) > 1000) cand.push({ score: Math.abs(c) * 30, kind: 'vault flows', text: `${v.name} ${c > 0 ? 'gained' : 'lost'} ${money(Math.abs((v.tvl ?? 0) - (v.tvlBefore ?? 0)))} of deposits (${pct(c)}), to ${money(v.tvl)}.`, block: P.current.toBlock }); }
  if (best && best.ret > 0 && best.retBefore != null) cand.push({ score: 1 + Math.abs(best.ret - best.retBefore) * 1000, kind: 'vault return', text: `${best.name} returned ${(best.ret * 100).toFixed(3)}% this period (${(best.retBefore * 100).toFixed(3)}% the period before).`, block: P.current.toBlock });
  const mc = change(ms == null ? null : usdc(ms), ps == null ? null : usdc(ps));
  if (mc != null && Math.abs(mc) >= 0.05) cand.push({ score: Math.abs(mc) * 30, kind: 'market size', text: `The Morpho syzUSD/USDC market ${mc > 0 ? 'grew' : 'shrank'} ${pct(Math.abs(mc))} to ${money(usdc(ms))} supplied.`, block: P.current.toBlock });
  const uNow = ms ? Number(mb) / Number(ms) : null; const uPrev = ps ? Number(pb) / Number(ps) : null;
  if (uNow != null && uPrev != null && Math.abs(uNow - uPrev) >= 0.03) cand.push({ score: Math.abs(uNow - uPrev) * 100, kind: 'utilisation', text: `Utilisation of the Morpho syzUSD/USDC market went from ${(uPrev * 100).toFixed(1)}% to ${(uNow * 100).toFixed(1)}%.`, block: P.current.toBlock });
  const usdcC = change(last(cur, 'usdcSupply') && usdc(last(cur, 'usdcSupply')), last(prev, 'usdcSupply') && usdc(last(prev, 'usdcSupply')));
  if (usdcC != null && Math.abs(usdcC) >= 0.01) cand.push({ score: Math.abs(usdcC) * 30, kind: 'USDC supply', text: `The USDC on Pharos ${usdcC > 0 ? 'grew' : 'shrank'} ${pct(Math.abs(usdcC))} to ${money(usdc(last(cur, 'usdcSupply')))}.`, block: P.current.toBlock });
  // three different kinds, best first; if fewer than three stand out, the quiet facts fill the list so there are always three
  const notable = []; const kinds = new Set();
  const ranked = cand.sort((a, b) => b.score - a.score);
  for (const c of ranked) { if (kinds.has(c.kind) || notable.length >= 3) continue; kinds.add(c.kind); notable.push(c); }
  // a digest of "events" should carry at least one real on-chain event with its transaction, when the period had any
  if (!notable.some((n) => n.event)) { const ev = ranked.find((c) => c.event); if (ev) notable.splice(2, 1, ev); }
  const fillers = [
    { kind: 'activity', text: `The chain produced ${blocksNow.toLocaleString('en-US')} blocks; a typical block held ${metrics.find((m) => m.id === 'txs')?.text} transactions (${metrics.find((m) => m.id === 'txs')?.beforeText} the period before).`, block: P.current.toBlock },
    { kind: 'vault totals', text: `The four USDC vaults held ${money(tvlNow)} (${tvlBefore ? pct(change(tvlNow, tvlBefore)) : 'n/a'} against the period before).`, block: P.current.toBlock },
    { kind: 'steady market', text: `The Morpho syzUSD/USDC market stayed steady at ${money(usdc(ms ?? 0n))} supplied and ${(uNow != null ? uNow * 100 : 0).toFixed(1)}% utilised.`, block: P.current.toBlock },
  ];
  for (const f of fillers) if (notable.length < 3 && !kinds.has(f.kind)) { kinds.add(f.kind); notable.push({ ...f, quiet: true }); }

  const digest = {
    subject, depth, generatedAt: now().toISOString(), days, periods: P, chain: 'Pharos mainnet (1672)',
    samples: { current: cur.length, previous: prev.length },
    metrics, notable, vaults: vaultRows, events,
    headline: `${subject} digest, ${iso(P.current.fromTime)} to ${iso(P.current.toTime)}`,
  };
  digest.text = toText(digest); digest.markdown = toMarkdown(digest);
  return digest;
}

// ---- rendering ----------------------------------------------------------------------------------------------------------------------------

export function toText(d) {
  const lines = [`📰 ${d.headline}`, ''];
  lines.push('Top 3 this period:', ...d.notable.map((n, i) => `${i + 1}. ${n.text}${n.link ? ` ${n.link}` : ''}`), '', 'Key numbers (against the period before):');
  for (const m of d.metrics.filter((x) => ['price', 'usdc', 'market-supply', 'utilization', 'vault-tvl', 'best-vault', 'ev-liq'].includes(x.id))) lines.push(`• ${m.label}: ${m.text}${m.change != null ? ` (${pct(m.change)}; was ${m.beforeText})` : m.beforeText !== 'n/a' ? ` (was ${m.beforeText})` : ''}`);
  return lines.join('\n');
}

export function toMarkdown(d) {
  const o = [`# ${d.headline}`, '', `**Network:** ${d.chain}  `, `**This period:** ${iso(d.periods.current.fromTime)} to ${iso(d.periods.current.toTime)} (blocks ${d.periods.current.fromBlock.toLocaleString('en-US')}–${d.periods.current.toBlock.toLocaleString('en-US')})  `,
    `**Compared with:** ${iso(d.periods.previous.fromTime)} to ${iso(d.periods.previous.toTime)}  `, `**Generated:** ${d.generatedAt}`, '', '## The three things that stood out', ''];
  d.notable.forEach((n, i) => o.push(`${i + 1}. ${n.text}${n.link ? ` [Transaction](${n.link})` : ''}`));
  o.push('', '## Key numbers', '', '| Metric | This period | Previous period | Change |', '|---|---:|---:|---:|');
  for (const m of d.metrics) o.push(`| ${m.label}${m.note ? ` <br><small>${m.note}</small>` : ''} | ${m.text} | ${m.beforeText} | ${m.change == null ? '—' : pct(m.change)} |`);
  o.push('', '## The USDC vaults', '', '| Vault | Value locked | Return this period | Return previous period |', '|---|---:|---:|---:|');
  for (const v of d.vaults) o.push(`| ${v.name} | ${v.tvl == null ? 'n/a' : money(v.tvl)} | ${v.ret == null ? 'n/a' : (v.ret * 100).toFixed(3) + '%'} | ${v.retBefore == null ? 'n/a' : (v.retBefore * 100).toFixed(3) + '%'} |`);
  o.push('', `_Levels (price, supply, value locked) are read at the end of each period; flows (blocks, transactions, volumes) are totals over it. Read from the chain at ${d.samples.current + d.samples.previous} sampled blocks${d.depth === 'full' ? ' and from every Morpho Blue event log of both periods' : ''}._`, '');
  return o.join('\n');
}

export const publishPage = (d) => `<!doctype html><meta charset="utf-8"><title>${d.headline.replace(/</g, '&lt;')}</title><meta name="viewport" content="width=device-width,initial-scale=1"><pre style="white-space:pre-wrap;font:15px/1.5 system-ui;max-width:46rem;margin:2rem auto;padding:0 1rem">${toMarkdown(d).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
