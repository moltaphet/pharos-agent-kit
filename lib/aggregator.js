// Multi-protocol aggregator for USDC on Pharos mainnet: one interface over R25's three vaults, the RockawayX vault of Morpho Vault V2, and a Morpho Blue lending market.
// Queries (rates, liquidity, a wallet's positions) and actions (deposit, withdraw: PREPARED as unsigned transactions, never sent) go through the same venue interface; each request
// is routed to the venue that suits it best and the reasons are given, including why the others were passed over. A venue that cannot be read is reported and left out; it never
// stops the others.
//
// Venue adapters: `read(venue)` gives { apy, tvl, liquidity, ... }, `position(venue, wallet)` gives the wallet's assets and what it can take out, `prepare(venue, action, ...)` gives the
// transactions. Two kinds of venue so far: an ERC-4626 vault, and a Morpho Blue market (supply side). A new protocol is a new adapter, not a change in the router.

import { formatUnits, isAddress } from './abi.js';
import { USDC_SLOTS, VAULT_LIST, usdcStateDiff } from './defi.js';
import { selectorOf } from './keccak.js';
import { MORPHO, USDC } from './protocols.js';
import { batchRpc, batchRpcStrict } from './rpc-batch.js';
import { PHAROS_RPC } from './rpc.js';
import { UserError } from './snapshot.js';

const hex = (n) => '0x' + BigInt(n).toString(16);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const SECONDS_PER_YEAR = 31_556_926;
const WAD = 10n ** 18n;
export const LOOKBACK = 200_000; // blocks (about two days) over which a vault's return is measured
export const MARKET_ID = MORPHO.markets['syzUSD/USDC'];
const SEL = {
  convertToAssets: selectorOf('convertToAssets(uint256)'), totalAssets: selectorOf('totalAssets()'), balanceOf: selectorOf('balanceOf(address)'), maxDeposit: selectorOf('maxDeposit(address)'), maxWithdraw: selectorOf('maxWithdraw(address)'),
  deposit: selectorOf('deposit(uint256,address)'), withdraw: selectorOf('withdraw(uint256,address,address)'), approve: selectorOf('approve(address,uint256)'),
  market: selectorOf('market(bytes32)'), params: selectorOf('idToMarketParams(bytes32)'), position: selectorOf('position(bytes32,address)'), borrowRateView: selectorOf('borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128))'),
  supply: selectorOf('supply((address,address,address,address,uint256),uint256,uint256,address,bytes)'), mWithdraw: selectorOf('withdraw((address,address,address,address,uint256),uint256,uint256,address,address)'),
};

export const VENUES = [
  ...VAULT_LIST.map((v) => ({ id: v.id, name: v.name, protocol: v.protocol === 'Morpho' ? 'Morpho Vault V2' : 'R25', kind: 'erc4626', address: v.address.toLowerCase(), shareDecimals: v.shareDecimals })),
  { id: 'morpho-syzusd-usdc', name: 'Morpho Blue syzUSD/USDC market (supply)', protocol: 'Morpho Blue', kind: 'morpho-market', address: MORPHO.address.toLowerCase(), marketId: MARKET_ID },
];
export const PROTOCOLS = [...new Set(VENUES.map((v) => v.protocol))];
const usdc = (raw) => Number(raw) / 1e6;
const fmtUsdc = (raw) => `${formatUnits(BigInt(raw), 6, 2)} USDC`;
const pct = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`);
const uint = (hexData, i = 0) => (typeof hexData === 'string' && hexData.length >= 66 + 64 * i ? BigInt('0x' + hexData.slice(2 + 64 * i, 66 + 64 * i)) : null);

// ---- adapters -----------------------------------------------------------------------------------------------------------------------------

/** The calls that make up a venue's rate and size, at `block`, and a function that turns the answers into numbers. */
const adapters = {
  erc4626: {
    calls(v, block, { lookback }) {
      const unit = 10n ** BigInt(v.shareDecimals);
      return [
        { method: 'eth_call', params: [{ to: v.address, data: SEL.convertToAssets + word(unit) }, hex(block)] }, { method: 'eth_call', params: [{ to: v.address, data: SEL.convertToAssets + word(unit) }, hex(block - lookback)] },
        { method: 'eth_call', params: [{ to: v.address, data: SEL.totalAssets }, hex(block)] }, { method: 'eth_getBlockByNumber', params: [hex(block), false] }, { method: 'eth_getBlockByNumber', params: [hex(block - lookback), false] },
      ];
    },
    rates(v, r, { lookback }) {
      const now = r[0].ok ? uint(r[0].result) : null; const then = r[1].ok ? uint(r[1].result) : null; const tvl = r[2].ok ? uint(r[2].result) : null;
      if (now == null || tvl == null) throw new Error('the vault did not answer its share price and its total assets');
      const dt = r[3].ok && r[4].ok ? Number(BigInt(r[3].result.timestamp) - BigInt(r[4].result.timestamp)) : null;
      const apy = then && then > 0n && dt > 0 ? (Number(now) / Number(then)) ** (SECONDS_PER_YEAR / dt) - 1 : null;
      return { apy, tvlRaw: tvl.toString(), liquidityRaw: null, basis: apy == null ? 'no share price from two days ago' : `share price over ${(dt / 86400).toFixed(1)} days` };
    },
    positionCalls: (v, wallet, block) => [
      { method: 'eth_call', params: [{ to: v.address, data: SEL.balanceOf + addrWord(wallet) }, hex(block)] }, { method: 'eth_call', params: [{ to: v.address, data: SEL.maxWithdraw + addrWord(wallet) }, hex(block)] },
      { method: 'eth_call', params: [{ to: v.address, data: SEL.maxDeposit + addrWord(wallet) }, hex(block)] }, { method: 'eth_call', params: [{ to: v.address, data: SEL.convertToAssets + word(10n ** BigInt(v.shareDecimals)) }, hex(block)] },
    ],
    position(v, r) {
      const shares = r[0].ok ? uint(r[0].result) : null; const maxWithdraw = r[1].ok ? uint(r[1].result) : null; const maxDeposit = r[2].ok ? uint(r[2].result) : null; const px = r[3].ok ? uint(r[3].result) : null;
      if (shares == null || px == null) throw new Error('the vault did not answer a balance');
      return { assetsRaw: ((shares * px) / 10n ** BigInt(v.shareDecimals)).toString(), withdrawableRaw: (maxWithdraw ?? 0n).toString(), depositCapRaw: maxDeposit == null ? null : maxDeposit.toString() };
    },
    prepare(v, action, { amountRaw, wallet }) {
      if (action === 'deposit') return [{ label: `Approve ${v.name} to take the USDC`, to: USDC, data: SEL.approve + addrWord(v.address) + word(amountRaw), value: '0x0' }, { label: `Deposit into ${v.name}`, to: v.address, data: SEL.deposit + word(amountRaw) + addrWord(wallet), value: '0x0' }];
      return [{ label: `Withdraw from ${v.name}`, to: v.address, data: SEL.withdraw + word(amountRaw) + addrWord(wallet) + addrWord(wallet), value: '0x0' }];
    },
  },
  'morpho-market': {
    calls: (v, block) => [{ method: 'eth_call', params: [{ to: v.address, data: SEL.market + v.marketId.slice(2) }, hex(block)] }, { method: 'eth_call', params: [{ to: v.address, data: SEL.params + v.marketId.slice(2) }, hex(block)] }, { method: 'eth_getBlockByNumber', params: [hex(block), false] }],
    async rates(v, r, ctx) {
      const m = r[0].ok ? r[0].result : null; const p = r[1].ok ? r[1].result : null;
      if (!m || !p) throw new Error('Morpho Blue did not answer the market');
      const mw = [0, 1, 2, 3, 4, 5].map((i) => uint(m, i)); const pw = [0, 1, 2, 3, 4].map((i) => uint(p, i));
      const marketTuple = mw.map(word).join(''); const paramsTuple = pw.map((x, i) => (i < 4 ? addrWord(hex(x)) : word(x))).join('');
      const [rate] = await ctx.batch([{ method: 'eth_call', params: [{ to: '0x' + pw[3].toString(16).padStart(40, '0'), data: SEL.borrowRateView + paramsTuple + marketTuple }, hex(ctx.block)] }]);
      const perSecond = uint(rate); // WAD per second
      if (perSecond == null) throw new Error('the interest rate model did not answer');
      const supply = mw[0]; const borrow = mw[2]; const fee = mw[5];
      const util = supply > 0n ? Number(borrow) / Number(supply) : 0;
      const supplyRate = (Number(perSecond) / 1e18) * util * (1 - Number(fee) / 1e18);
      return { apy: Math.exp(supplyRate * SECONDS_PER_YEAR) - 1, tvlRaw: supply.toString(), liquidityRaw: (supply - borrow).toString(), utilization: util, params: { loanToken: pw[0], collateralToken: pw[1], oracle: pw[2], irm: pw[3], lltv: pw[4] }, market: mw, basis: 'the interest-rate model’s current borrow rate × utilisation × (1 − fee)' };
    },
    positionCalls: (v, wallet, block) => [{ method: 'eth_call', params: [{ to: v.address, data: SEL.position + v.marketId.slice(2) + addrWord(wallet) }, hex(block)] }, { method: 'eth_call', params: [{ to: v.address, data: SEL.market + v.marketId.slice(2) }, hex(block)] }],
    position(v, r) {
      const pos = r[0].ok ? uint(r[0].result) : null; const m = r[1].ok ? r[1].result : null;
      if (pos == null || !m) throw new Error('Morpho Blue did not answer the position');
      const supply = uint(m, 0); const shares = uint(m, 1); const borrow = uint(m, 2);
      const assets = (pos * (supply + 1n)) / (shares + 10n ** 6n); // Morpho's virtual shares and assets
      const liquidity = supply - borrow;
      return { assetsRaw: assets.toString(), withdrawableRaw: (assets < liquidity ? assets : liquidity).toString(), depositCapRaw: null };
    },
    prepare(v, action, { amountRaw, wallet, rate }) {
      const p = rate.params; const tuple = [p.loanToken, p.collateralToken, p.oracle, p.irm].map((x) => addrWord(hex(x))).join('') + word(p.lltv);
      if (action === 'deposit') return [{ label: `Approve Morpho Blue to take the USDC`, to: USDC, data: SEL.approve + addrWord(v.address) + word(amountRaw), value: '0x0' }, { label: `Supply to the ${v.name}`, to: v.address, data: SEL.supply + tuple + word(amountRaw) + word(0) + addrWord(wallet) + word(0x120) + word(0), value: '0x0' }];
      return [{ label: `Withdraw from the ${v.name}`, to: v.address, data: SEL.mWithdraw + tuple + word(amountRaw) + word(0) + addrWord(wallet) + addrWord(wallet), value: '0x0' }];
    },
  },
};

// ---- querying -----------------------------------------------------------------------------------------------------------------------------

// The public RPC is load-balanced and a node behind it now and then answers a block-pinned read from other state. Every venue's reads are made twice and must agree; if they do not, a third
// read breaks the tie, and a venue whose reads never agree is reported as unavailable rather than guessed at.
async function agreed(requests, opts) {
  const key = (rows) => JSON.stringify(rows);
  const reads = [await batchRpc(requests, opts)];
  for (let i = 0; i < 3; i++) {
    reads.push(await batchRpc(requests, opts));
    const hit = reads.find((r) => reads.filter((x) => key(x) === key(r)).length >= 2);
    if (hit) return hit;
  }
  throw new Error('the node gave different answers to the same block-pinned reads each time');
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took more than ${ms / 1000} s`)), ms))]);

/**
 * Read every venue: rates, size, and (given a wallet) its position there. Each venue is read on its own: one that fails comes back as unavailable with the reason, and the rest are unaffected.
 * `down`: protocol names whose reads are pointed at an unreachable endpoint, to show an outage (used by the demo and the tests; real outages look the same).
 */
export async function snapshot({ wallet = null, venues = VENUES, down = [], url = PHAROS_RPC, block = null, lookback = LOOKBACK, timeoutMs = 25_000, probe = null } = {}) {
  if (probe && !wallet) throw new UserError('a probe needs a wallet');
  if (probe && (!['deposit', 'withdraw'].includes(probe.action) || !(BigInt(probe.amountRaw ?? 0) > 0n))) throw new UserError('probe needs an action and a positive amountRaw');
  if (wallet != null && !isAddress(wallet)) throw new UserError('wallet must be a 0x… address of 40 hex digits');
  for (const d of down) if (!PROTOCOLS.includes(d)) throw new UserError(`down must name protocols from ${PROTOCOLS.join(', ')}`);
  const [b] = await batchRpcStrict([{ method: 'eth_blockNumber' }], { url });
  const at = block ?? Number(BigInt(b)) - 3;
  const rows = await Promise.all(venues.map(async (v) => {
    const venueUrl = down.includes(v.protocol) ? 'http://127.0.0.1:9' : url; // nothing listens there: a real connection failure
    const batch = (reqs) => batchRpcStrict(reqs, { url: venueUrl, tries: down.includes(v.protocol) ? 1 : 4 });
    const a = adapters[v.kind];
    try {
      const raw = await withTimeout((async () => {
        const answers = await agreed([...a.calls(v, at, { lookback }), ...(wallet ? a.positionCalls(v, wallet, at) : [])], { url: venueUrl, tries: down.includes(v.protocol) ? 1 : 4 });
        const nCalls = a.calls(v, at, { lookback }).length;
        const rates = await a.rates(v, answers.slice(0, nCalls), { lookback, batch, block: at });
        const position = wallet ? a.position(v, answers.slice(nCalls), { rates }) : null;
        // what the venue itself says to this exact request: the call is simulated from the wallet (a deposit as if the wallet held and had approved the USDC)
        const probed = probe ? await probeVenue({ v, a, rates, wallet, probe, block: at, url: venueUrl, tries: down.includes(v.protocol) ? 1 : 4 }) : null;
        return { rates, position, probe: probed };
      })(), timeoutMs, v.name);
      return { venue: v, status: 'ok', ...raw };
    } catch (err) { return { venue: v, status: 'unavailable', error: String(err.message).slice(0, 200) }; }
  }));
  return { block: at, lookback, wallet, venues: rows, available: rows.filter((r) => r.status === 'ok').length, unavailable: rows.filter((r) => r.status !== 'ok').map((r) => ({ id: r.venue.id, protocol: r.venue.protocol, error: r.error })) };
}

/** A wallet's positions across every protocol, and the best current rate, as plain sentences. */
export function summarize(snap) {
  const rows = snap.venues.map((r) => r.status !== 'ok' ? { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, status: 'unavailable', error: r.error }
    : { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, status: 'ok', apy: r.rates.apy, apyText: pct(r.rates.apy), tvlText: fmtUsdc(r.rates.tvlRaw), liquidityText: r.rates.liquidityRaw == null ? 'redeemable on request' : fmtUsdc(r.rates.liquidityRaw), basis: r.rates.basis,
      ...(r.position && { positionRaw: r.position.assetsRaw, positionText: fmtUsdc(r.position.assetsRaw), withdrawableText: fmtUsdc(r.position.withdrawableRaw) }) });
  const held = rows.filter((x) => x.positionRaw && BigInt(x.positionRaw) > 0n);
  const total = held.reduce((s, x) => s + BigInt(x.positionRaw), 0n);
  const best = rows.filter((x) => x.status === 'ok' && x.apy != null).sort((a, b) => b.apy - a.apy)[0] ?? null;
  return { rows, held, totalRaw: total.toString(), totalText: fmtUsdc(total), best, text: held.length ? `Holds ${fmtUsdc(total)} across ${held.length} venue${held.length === 1 ? '' : 's'}: ${held.map((x) => `${x.positionText} in ${x.name}`).join('; ')}.${snap.unavailable.length ? ` Could not read ${snap.unavailable.map((u) => u.protocol).join(', ')}, so those positions are not included.` : ''}` : `Holds nothing in the venues that could be read.${snap.unavailable.length ? ` Could not read ${snap.unavailable.map((u) => u.protocol).join(', ')}.` : ''}` };
}

async function probeVenue({ v, a, rates, wallet, probe, block, url, tries }) {
  const amountRaw = BigInt(probe.amountRaw);
  const main = a.prepare(v, probe.action, { amountRaw, wallet, rate: rates }).at(-1);
  const overrides = probe.action === 'deposit' ? usdcStateDiff({ owner: wallet, spender: v.address, allowance: 2n ** 255n, balance: amountRaw * 2n }) : null;
  const [row] = await batchRpc([{ method: 'eth_call', params: [{ from: wallet, to: main.to, data: main.data, value: main.value }, hex(block), ...(overrides ? [overrides] : [])] }], { url, tries });
  return row.ok ? { ok: true, amountRaw: amountRaw.toString() } : { ok: false, amountRaw: amountRaw.toString(), error: String(row.error).replace(/^eth_call failed: /, '').slice(0, 160) };
}

// ---- routing ------------------------------------------------------------------------------------------------------------------------------

/**
 * Choose where a deposit or a withdrawal should go, and say why. Deposit: the venue with the best measured rate that has room for the amount. Withdraw: take the money from the venue that
 * earns the least, as long as it can pay out the amount now; if no single venue can, split it across venues, again from the lowest rate up.
 */
export function route({ snap, action, amount }) {
  if (!['deposit', 'withdraw'].includes(action)) throw new UserError('action must be deposit or withdraw');
  if (!/^\d+(\.\d{1,6})?$/.test(String(amount ?? ''))) throw new UserError('amount must be a plain number of USDC with at most 6 decimals, like 2500 or 1250.5');
  const [w, f = ''] = String(amount).split('.');
  const amountRaw = BigInt(w) * 10n ** 6n + BigInt(f.padEnd(6, '0'));
  if (amountRaw === 0n) throw new UserError('amount must be above zero');
  const considered = snap.venues.map((r) => {
    if (r.status !== 'ok') return { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, eligible: false, reason: `unavailable right now (${r.error})`, unavailable: true };
    const apy = r.rates.apy;
    if (action === 'deposit') {
      if (r.probe && !r.probe.ok) return { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, apy, eligible: false, reason: `the venue refuses a deposit of ${fmtUsdc(amountRaw)} from this wallet (${r.probe.error})` };
      const cap = !r.probe && r.position?.depositCapRaw != null && BigInt(r.position.depositCapRaw) > 0n ? BigInt(r.position.depositCapRaw) : null;
      if (cap != null && cap < amountRaw) return { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, apy, eligible: false, reason: `it accepts at most ${fmtUsdc(cap)} from this wallet` };
      if (apy == null) return { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, apy, eligible: false, reason: 'its return could not be measured, so it cannot be compared' };
      return { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, apy, eligible: true, reason: `${pct(apy)} measured (${r.rates.basis})` };
    }
    const held = r.position ? BigInt(r.position.assetsRaw) : 0n;
    // the venue's own answer decides when it was asked; maxWithdraw is only a hint (Morpho Vault V2 reports zero for it), and a market can only pay out what is not lent
    const free = r.rates.liquidityRaw != null ? BigInt(r.rates.liquidityRaw) : null;
    let can = r.position ? BigInt(r.position.withdrawableRaw) : 0n;
    if (r.probe) can = r.probe.ok ? (held < amountRaw ? held : amountRaw) : (free != null && free < amountRaw && held > 0n && r.venue.kind === 'morpho-market' ? (free < held ? free : held) : 0n);
    if (free != null && can > free) can = free; // a lending market can only pay out what is not lent, whatever a simulation says
    if (can > held) can = held;
    if (held === 0n) return { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, apy, eligible: false, reason: 'the wallet has nothing here' };
    return { id: r.venue.id, name: r.venue.name, protocol: r.venue.protocol, apy, heldRaw: held.toString(), withdrawableRaw: can.toString(), eligible: can > 0n, reason: can >= amountRaw ? `holds ${fmtUsdc(held)}; the venue lets it withdraw ${fmtUsdc(amountRaw)} now${apy != null ? `, earning ${pct(apy)}` : ''}` : `holds ${fmtUsdc(held)} but ${can > 0n ? `only ${fmtUsdc(can)}` : 'nothing'} can be withdrawn now${r.probe && !r.probe.ok && r.venue.kind !== 'morpho-market' ? ` (the venue refuses: ${r.probe.error})` : ''}${r.rates.liquidityRaw != null ? ` (the market has ${fmtUsdc(r.rates.liquidityRaw)} of free liquidity)` : ''}` };
  });
  const eligible = considered.filter((c) => c.eligible);
  let legs = []; let why;
  if (action === 'deposit') {
    const ranked = [...eligible].sort((a, b) => b.apy - a.apy);
    if (ranked.length) { legs = [{ id: ranked[0].id, amountRaw: amountRaw.toString() }]; const next = ranked[1]; why = `Deposit ${fmtUsdc(amountRaw)} in ${ranked[0].name}: the best measured return (${pct(ranked[0].apy)}) among the ${ranked.length} venue${ranked.length === 1 ? '' : 's'} that can take it${next ? `; the next best is ${next.name} at ${pct(next.apy)}` : ''}.`; }
  } else {
    const single = eligible.filter((c) => BigInt(c.withdrawableRaw) >= amountRaw).sort((a, b) => (a.apy ?? 0) - (b.apy ?? 0))[0];
    if (single) { legs = [{ id: single.id, amountRaw: amountRaw.toString() }]; why = eligible.length === 1 ? `Withdraw ${fmtUsdc(amountRaw)} from ${single.name}: it is the only venue where this wallet has money that can be paid out now (it earns ${pct(single.apy)}).` : `Withdraw ${fmtUsdc(amountRaw)} from ${single.name}: it can pay out the whole amount now and earns the least (${pct(single.apy)}) of the venues that can, so the money left elsewhere keeps its higher returns.`; }
    else {
      let left = amountRaw;
      for (const c of [...eligible].sort((a, b) => (a.apy ?? 0) - (b.apy ?? 0))) { if (left <= 0n) break; const take = BigInt(c.withdrawableRaw) < left ? BigInt(c.withdrawableRaw) : left; legs.push({ id: c.id, amountRaw: take.toString() }); left -= take; }
      if (left > 0n) { const held = considered.reduce((x, c) => x + BigInt(c.heldRaw ?? 0), 0n); legs = []; why = held < amountRaw ? `Cannot withdraw ${fmtUsdc(amountRaw)}: the wallet holds ${fmtUsdc(held)} in total in the venues that were read.` : `Cannot withdraw ${fmtUsdc(amountRaw)}: the venues that were read can pay out ${fmtUsdc(amountRaw - left)} between them right now.`; }
      else why = `No single venue can pay ${fmtUsdc(amountRaw)} now, so it is split: ${legs.map((l) => `${fmtUsdc(l.amountRaw)} from ${considered.find((c) => c.id === l.id).name}`).join(' and ')}, taking from the lowest return up.`;
    }
  }
  if (!legs.length && !why) why = action === 'deposit' ? `No venue can take ${fmtUsdc(amountRaw)} right now.` : `No venue holds anything that can be withdrawn.`;
  const unavailable = considered.filter((c) => c.unavailable);
  return { action, amountRaw: amountRaw.toString(), amountText: fmtUsdc(amountRaw), legs, why, considered, unavailableNote: unavailable.length ? `${unavailable.map((u) => u.name).join(', ')} could not be read, so ${unavailable.length === 1 ? 'it was' : 'they were'} not considered; the choice is among the venues that answered.` : null };
}

/** The unsigned transactions for a routed request, with the first one's outcome simulated from the wallet where it can be. Nothing is signed or sent. */
export async function prepare({ snap, routed, wallet, url = PHAROS_RPC, simulate = true }) {
  if (!isAddress(wallet)) throw new UserError('wallet must be a 0x… address of 40 hex digits');
  const out = [];
  for (const leg of routed.legs) {
    const r = snap.venues.find((x) => x.venue.id === leg.id);
    const txs = adapters[r.venue.kind].prepare(r.venue, routed.action, { amountRaw: BigInt(leg.amountRaw), wallet, rate: r.rates });
    let simulation = null;
    if (simulate) {
      const main = txs.at(-1);
      // a deposit is simulated as if the wallet had the USDC and had approved it (the public RPC can pretend that); a withdrawal is simulated as it is
      const overrides = routed.action === 'deposit' ? usdcStateDiff({ owner: wallet, spender: txs.length > 1 ? r.venue.address : r.venue.address, allowance: 2n ** 255n, balance: BigInt(leg.amountRaw) * 2n }) : null;
      try { const [res] = await batchRpcStrict([{ method: 'eth_call', params: [{ from: wallet, to: main.to, data: main.data, value: main.value }, hex(snap.block), ...(overrides ? [overrides] : [])] }], { url }); simulation = { ok: true, note: routed.action === 'deposit' ? 'the venue accepts this deposit (simulated as if the wallet held and had approved the USDC)' : 'the withdrawal would succeed now' }; void res; }
      catch (e) { simulation = { ok: false, note: `the simulation was refused: ${String(e.message).slice(0, 160)}` }; }
    }
    out.push({ venue: r.venue.name, protocol: r.venue.protocol, amountRaw: leg.amountRaw, transactions: txs.map((t) => ({ ...t, chainId: 1672 })), simulation });
  }
  return { signing: 'Nothing was signed or sent: sign these in your wallet, in order.', legs: out };
}

export { USDC_SLOTS };
