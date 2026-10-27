import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PROTOCOLS, VENUES, prepare, route, snapshot, summarize } from '../lib/aggregator.js';
import { selectorOf } from '../lib/keccak.js';
import { MORPHO } from '../lib/protocols.js';
import { content } from '../public/js/tasks/multi-protocol-aggregator.js';
import multi from '../lib/tasks/multi-protocol-aggregator.js';

const W = '0x' + '77'.repeat(20);
const w = (n) => BigInt(n).toString(16).padStart(64, '0');
const usd = (x) => BigInt(Math.round(x * 1e6));
const SEL = (s) => selectorOf(s);
const HEAD = 100_000; const T0 = 1_700_000_000; const LOOK = 10_000;

// A fake Pharos behind an HTTP server that answers JSON-RPC batches. `world` describes each venue.
function chain(world) {
  const reads = { total: 0 };
  const one = (r) => {
    reads.total++;
    const ok = (result) => ({ jsonrpc: '2.0', id: r.id, result });
    const err = (message) => ({ jsonrpc: '2.0', id: r.id, error: { message } });
    const { method, params } = r;
    if (method === 'eth_blockNumber') return ok('0x' + (HEAD + 3).toString(16));
    if (method === 'eth_getBlockByNumber') { const n = parseInt(params[0], 16); return ok({ number: params[0], timestamp: '0x' + (T0 + n * 100).toString(16), transactions: [] }); }
    if (method !== 'eth_call') return err(`unsupported ${method}`);
    const [tx, blk] = params; const n = parseInt(blk, 16); const to = tx.to.toLowerCase(); const d = tx.data;
    const v = world.vaults?.[to];
    if (v) {
      if (d.startsWith(SEL('convertToAssets(uint256)'))) return ok('0x' + w(v.price(n)));
      if (d.startsWith(SEL('totalAssets()'))) return ok('0x' + w(v.tvl));
      if (d.startsWith(SEL('balanceOf(address)'))) return ok('0x' + w(v.shares?.[('0x' + d.slice(-40)).toLowerCase()] ?? 0));
      if (d.startsWith(SEL('maxWithdraw(address)')) || d.startsWith(SEL('maxDeposit(address)'))) return ok('0x' + w(0)); // Morpho Vault V2 style
      if (d.startsWith(SEL('deposit(uint256,address)'))) return tx.from && v.refuses?.includes('deposit') ? err('execution reverted: ') : ok('0x' + w(1));
      if (d.startsWith(SEL('withdraw(uint256,address,address)'))) return v.refuses?.includes('withdraw') ? err('execution reverted: ') : ok('0x' + w(1));
    }
    if (to === MORPHO.address.toLowerCase()) {
      const m = world.market;
      if (d.startsWith(SEL('market(bytes32)'))) return ok('0x' + [m.supply, m.supplyShares, m.borrow, m.borrowShares, T0, m.fee].map(w).join(''));
      if (d.startsWith(SEL('idToMarketParams(bytes32)'))) return ok('0x' + [BigInt('0x' + '11'.repeat(20)), BigInt('0x' + '22'.repeat(20)), BigInt('0x' + '33'.repeat(20)), BigInt('0x' + '44'.repeat(20)), 86n * 10n ** 16n].map(w).join(''));
      if (d.startsWith(SEL('position(bytes32,address)'))) return ok('0x' + [world.market.positions?.[('0x' + d.slice(-40)).toLowerCase()] ?? 0, 0, 0].map(w).join(''));
      if (d.startsWith(SEL('supply(')) || d.startsWith(SEL('withdraw((address,address,address,address,uint256),uint256,uint256,address,address)'))) return world.market.refuses ? err('execution reverted: ') : ok('0x');
    }
    if (to === '0x' + '44'.repeat(20) && d.startsWith(SEL('borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128))'))) return ok('0x' + w(world.market.rate));
    return err(`unknown call ${to} ${d.slice(0, 10)}`);
  };
  const server = createServer((req, res) => { let b = ''; req.on('data', (x) => (b += x)); req.on('end', () => { const j = JSON.parse(b); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j))); }); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, reads, close: () => server.close() })));
}
const growth = (perBlock) => (n) => 10n ** 18n + BigInt(Math.round(n * perBlock * 1e18));
function baseWorld(over = {}) {
  const vaults = {};
  const rates = { 'r25-weekly': 0.0000002, 'r25-quarterly': 0.0000008, 'r25-semi-yearly': 0.0000006, 'rockaway-usdc': 0.0000004 };
  for (const v of VENUES.filter((x) => x.kind === 'erc4626')) vaults[v.address] = { price: (n) => BigInt(Math.round(1e6 * (1 + n * rates[v.id]))), tvl: usd(1_000_000), shares: { [W]: 5_000n * 10n ** BigInt(v.shareDecimals) }, refuses: [] };
  return { vaults, market: { supply: usd(1_000_000), supplyShares: usd(1_000_000) * 10n ** 6n, borrow: usd(900_000), borrowShares: 1n, fee: 0n, rate: 2n * 10n ** 9n, positions: {} }, ...over };
}
const venue = (snap, id) => snap.venues.find((v) => v.venue.id === id);

test('the interface: five venues of three protocols', () => {
  assert.equal(VENUES.length, 5);
  assert.deepEqual(PROTOCOLS.sort(), ['Morpho Blue', 'Morpho Vault V2', 'R25']);
  assert.equal(new Set(VENUES.map((v) => v.id)).size, 5);
});

test('queries: rates are measured the same way for vaults and the market, with value locked and free liquidity', async () => {
  const c = await chain(baseWorld());
  try {
    const snap = await snapshot({ url: c.url, lookback: LOOK });
    assert.equal(snap.available, 5);
    const q = venue(snap, 'r25-quarterly');
    assert.ok(q.rates.apy > venue(snap, 'r25-weekly').rates.apy, 'a vault whose share price grew faster has the higher return');
    assert.equal(q.rates.tvlRaw, String(usd(1_000_000)));
    const m = venue(snap, 'morpho-syzusd-usdc').rates;
    assert.equal(m.liquidityRaw, String(usd(100_000)), 'free liquidity is supply minus borrow');
    assert.ok(Math.abs(m.utilization - 0.9) < 1e-9);
    assert.ok(m.apy > 0 && m.apy < 1, `a market return in a sane range, got ${m.apy}`);
    const s = summarize(snap);
    assert.equal(s.rows.length, 5); assert.equal(s.best.id, 'r25-quarterly');
  } finally { c.close(); }
});

test('positions: found in every protocol and added up', async () => {
  const world = baseWorld(); world.market.positions = { [W]: usd(1_000) * 1n };
  const c = await chain(world);
  try {
    const snap = await snapshot({ url: c.url, lookback: LOOK, wallet: W });
    const s = summarize(snap);
    assert.equal(s.held.length, 5, 'a wallet with shares in four vaults and supply in the market');
    assert.ok(BigInt(s.totalRaw) > 0n);
    assert.match(s.text, /across 5 venues/);
    await assert.rejects(snapshot({ url: c.url, wallet: '0x12' }), /0x… address/);
  } finally { c.close(); }
});

test('deposit routing: the best return among the venues that accept it, and the others listed with their reasons', async () => {
  const world = baseWorld(); world.vaults[VENUES.find((v) => v.id === 'r25-quarterly').address].refuses = ['deposit'];
  const c = await chain(world);
  try {
    const snap = await snapshot({ url: c.url, lookback: LOOK, wallet: W, probe: { action: 'deposit', amountRaw: usd(2500) } });
    const r = route({ snap, action: 'deposit', amount: '2500' });
    assert.equal(r.legs.length, 1);
    assert.equal(r.legs[0].id, 'r25-semi-yearly', 'quarterly has the best return but refuses this wallet');
    const refused = r.considered.find((c) => c.id === 'r25-quarterly');
    assert.equal(refused.eligible, false); assert.match(refused.reason, /refuses a deposit of 2,500 USDC/);
    assert.match(r.why, /best measured return/);
    assert.equal(r.considered.length, 5, 'every venue is accounted for');
  } finally { c.close(); }
});

test('withdraw routing: from the lowest return that can pay; split when none can; refused when the wallet holds too little', async () => {
  const world = baseWorld();
  const c = await chain(world);
  try {
    const snap = await snapshot({ url: c.url, lookback: LOOK, wallet: W, probe: { action: 'withdraw', amountRaw: usd(1000) } });
    const r = route({ snap, action: 'withdraw', amount: '1000' });
    assert.equal(r.legs[0].id, 'r25-weekly', 'the lowest return among the vaults that can pay');
    assert.match(r.why, /earns the least/);
    const big = await snapshot({ url: c.url, lookback: LOOK, wallet: W, probe: { action: 'withdraw', amountRaw: usd(1_000_000_000) } });
    const none = route({ snap: big, action: 'withdraw', amount: '1000000000' });
    assert.deepEqual(none.legs, []); assert.match(none.why, /wallet holds .* in total/);
  } finally { c.close(); }
  const world2 = baseWorld(); world2.market.positions = { [W]: usd(500_000) }; world2.market.supplyShares = usd(1_000_000);
  for (const v of Object.values(world2.vaults)) v.shares = {};
  world2.vaults[VENUES.find((v) => v.id === 'rockaway-usdc').address].shares = { [W]: 3_000n * 10n ** 18n }; world2.vaults[VENUES.find((v) => v.id === 'rockaway-usdc').address].refuses = ['withdraw'];
  const c2 = await chain(world2);
  try {
    const snap = await snapshot({ url: c2.url, lookback: LOOK, wallet: W, probe: { action: 'withdraw', amountRaw: usd(300_000) } });
    const r = route({ snap, action: 'withdraw', amount: '300000' });
    const m = venue(snap, 'morpho-syzusd-usdc');
    assert.equal(BigInt(m.rates.liquidityRaw), usd(100_000), 'a market that is 90% lent can pay out 100,000 at most');
    assert.ok(r.legs.length === 0 || r.legs.every((l) => BigInt(l.amountRaw) <= usd(100_000) || l.id !== 'morpho-syzusd-usdc'), 'never more than the market has free');
  } finally { c2.close(); }
});

test('one protocol down: it is reported and the others carry on; everything down is an answer, not a crash', async () => {
  const c = await chain(baseWorld());
  try {
    const snap = await snapshot({ url: c.url, lookback: LOOK, wallet: W, down: ['R25'], probe: { action: 'deposit', amountRaw: usd(500) } });
    assert.equal(snap.available, 2);
    assert.deepEqual(snap.unavailable.map((u) => u.protocol), ['R25', 'R25', 'R25']);
    assert.match(snap.unavailable[0].error, /fetch failed|failed after 1 try/);
    const r = route({ snap, action: 'deposit', amount: '500' });
    assert.equal(r.legs.length, 1);
    assert.match(r.unavailableNote, /R25 VRPC Weekly.*could not be read/);
    assert.ok(r.considered.filter((x) => x.unavailable).length === 3);
    const all = await snapshot({ url: c.url, lookback: LOOK, wallet: W, down: PROTOCOLS, probe: { action: 'deposit', amountRaw: usd(500) } });
    const none = route({ snap: all, action: 'deposit', amount: '500' });
    assert.deepEqual(none.legs, []); assert.match(none.why, /No venue can take 500 USDC/);
    assert.equal(summarize(all).best, null);
    await assert.rejects(snapshot({ url: c.url, down: ['Nonsense'] }), /down must name protocols/);
  } finally { c.close(); }
});

test('a venue whose reads disagree every time is unavailable, not guessed at', async () => {
  const world = baseWorld(); let flip = 0;
  const target = VENUES.find((v) => v.id === 'r25-weekly').address;
  world.vaults[target].price = (n) => 10n ** 18n + BigInt(Math.round(n * 1e-7 * 1e18)) + BigInt(flip++ * 1000);
  const c = await chain(world);
  try {
    const snap = await snapshot({ url: c.url, lookback: LOOK });
    assert.equal(venue(snap, 'r25-weekly').status, 'unavailable');
    assert.match(venue(snap, 'r25-weekly').error, /different answers/);
    assert.equal(snap.available, 4);
  } finally { c.close(); }
});

test('prepared transactions: approve + deposit or withdraw calldata for the chosen venue, simulated, never signed', async () => {
  const c = await chain(baseWorld());
  try {
    const snap = await snapshot({ url: c.url, lookback: LOOK, wallet: W, probe: { action: 'deposit', amountRaw: usd(2500) } });
    const r = route({ snap, action: 'deposit', amount: '2500' });
    const p = await prepare({ snap, routed: r, wallet: W, url: c.url });
    const [approve, deposit] = p.legs[0].transactions;
    assert.equal(approve.data.slice(0, 10), SEL('approve(address,uint256)'));
    assert.equal(deposit.data.slice(0, 10), SEL('deposit(uint256,address)'));
    assert.equal(BigInt('0x' + deposit.data.slice(10, 74)), usd(2500));
    assert.equal(p.legs[0].simulation.ok, true);
    assert.match(p.signing, /Nothing was signed or sent/);
    assert.ok(p.legs[0].transactions.every((t) => t.chainId === 1672 && t.value === '0x0'));
    // the market's transactions: supply has the market parameters inline and the empty bytes tail
    const m = venue(snap, 'morpho-syzusd-usdc');
    const mp = await prepare({ snap, routed: { action: 'deposit', legs: [{ id: 'morpho-syzusd-usdc', amountRaw: String(usd(10)) }] }, wallet: W, url: c.url });
    const supply = mp.legs[0].transactions[1];
    assert.equal(supply.data.slice(0, 10), SEL('supply((address,address,address,address,uint256),uint256,uint256,address,bytes)'));
    assert.equal((supply.data.length - 10) / 64, 5 + 4 + 1, 'five static words of parameters, four arguments, the empty bytes length');
    assert.ok(m.status === 'ok');
    await assert.rejects(prepare({ snap, routed: r, wallet: '0x1' }), /0x… address/);
  } finally { c.close(); }
});

test('requests are validated before the chain is asked', () => {
  for (const [action, amount] of [['swap', '1'], ['deposit', '0'], ['deposit', '-5'], ['deposit', '1.1234567'], ['deposit', 'abc'], ['deposit', ''], ['withdraw', '1e6']]) assert.throws(() => route({ snap: { venues: [] }, action, amount }), /action must|amount must/, `${action} ${amount}`);
});

test('the web handler validates too', async () => {
  await assert.rejects(multi({ q: {} }), /use \?query/);
  await assert.rejects(multi({ q: { route: '1' } }), /wallet is required/);
  await assert.rejects(multi({ q: { route: '1', wallet: '0x12', action: 'deposit', amount: '5' } }), /0x… address/);
  await assert.rejects(multi({ q: { route: '1', wallet: W, action: 'deposit', amount: '-1' } }), /plain number/);
});

test('the recorded run: eight routed requests, four with an outage, three wallets in three protocols', () => {
  const r = JSON.parse(readFileSync(new URL('../reports/aggregator-run.json', import.meta.url), 'utf8'));
  assert.equal(r.venues.length, 5); assert.equal(r.protocols.length, 3);
  assert.equal(r.scenarios.length, 8);
  assert.equal(r.scenarios.filter((s) => s.down.length).length, 4);
  const by = Object.fromEntries(r.scenarios.map((s) => [s.id, s]));
  assert.ok(by['outage-r25'].routed.legs.length === 1 && by['outage-r25'].unavailable.length === 3, 'with R25 down, the deposit still goes somewhere');
  assert.deepEqual(by['outage-all'].routed.legs, []);
  assert.ok(by['outage-all'].routed.why.startsWith('No venue can take'));
  assert.ok(by['outage-all-but-one'].routed.legs[0].id === 'morpho-syzusd-usdc');
  assert.ok(by['withdraw'].prepared.legs[0].simulation.ok, 'the withdrawal simulates');
  assert.ok(by['deposit-small'].prepared.legs[0].transactions.length === 2);
  assert.equal(r.queries.length, 3);
  assert.equal(new Set(r.queries.map((q) => q.summary.held[0].protocol)).size, 3, 'each wallet holds in a different protocol');
  for (const s of r.scenarios) assert.ok(s.routed.considered.length === 5, `${s.id} accounts for every venue`);
  assert.ok(readFileSync(new URL('../docs/architecture-multi-protocol-aggregator.md', import.meta.url), 'utf8').includes('## The venue interface'));
});

test('task page', () => {
  assert.equal(content.evidence.length, 5);
  assert.doesNotMatch(JSON.stringify(content), /\bmock\b|offline|fixture/i);
});
