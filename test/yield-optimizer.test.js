import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, HEADROOM, classifyDeposit, describeRevert, gasTableFrom, optimize } from '../lib/yield-optimizer.js';
import { annualise } from '../lib/yields.js';
import { selectorOf } from '../lib/keccak.js';
import { VAULT_LIST, USDC_SLOTS, usdcStateDiff } from '../lib/defi.js';
import { UserError } from '../lib/snapshot.js';
import { WALLET, makeWorld } from './support/defi-world.js';

const GAS = { approve: 55_437, deposit: { 'r25-weekly': 171_204, 'rockaway-usdc': 301_187 }, redeem: { 'r25-weekly': 184_003, 'rockaway-usdc': 273_262 }, forkBlock: 21_116_004, recordedAt: '2026-10-24T00:00:00Z', wallet: WALLET };
const IDLE = { usdc: 1_000_000_000_000n, shares: {} }; // 1,000,000 USDC idle in the wallet, no vault shares
const opt = (w, o = {}) => optimize({ chain: w.chain, rpc: w.rpc, wallet: WALLET, gas: GAS, ...o });
const byId = (r, id) => r.candidates.find((c) => c.id === id);
const APPROVE = selectorOf('approve(address,uint256)');
const DEPOSIT = selectorOf('deposit(uint256,address)');
const REDEEM = selectorOf('redeem(uint256,address,address)');

// ---- measuring a rate -------------------------------------------------------------------------------------------------------------------------------
test('annualise: a rise of 1% in 36.525 days is about 10.4% a year compounded, and nothing is invented when a price is missing', () => {
  const a = annualise(1_000_000_000_000n, 1_010_000_000_000n, 36.525 * 86400);
  assert.ok(Math.abs(a.growth - 0.01) < 1e-9);
  assert.ok(Math.abs(a.apy - (1.01 ** 10 - 1)) < 1e-6);
  for (const bad of [[0n, 5n, 100], [5n, 0n, 100], [5n, 6n, 0], [5n, 6n, -1]]) assert.equal(annualise(...bad), null);
});

test('the gas table comes only from what really succeeded on the fork', () => {
  const g = gasTableFrom(JSON.parse(readFileSync(new URL('../reports/yield-fork-run.json', import.meta.url), 'utf8')));
  assert.deepEqual(Object.keys(g.deposit).sort(), ['r25-weekly', 'rockaway-usdc']);
  assert.ok(g.approve > 40_000 && g.approve < 100_000);
  assert.ok(g.deposit['r25-weekly'] > 100_000 && g.redeem['r25-weekly'] > 100_000);
  assert.equal(g.deposit['r25-quarterly'], undefined, 'a deposit that reverted has no gas figure');
});

test('the pretend allowance is the storage the USDC contract really uses: two slots, one key each', () => {
  const d = usdcStateDiff({ owner: WALLET, spender: '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268', allowance: 5n, balance: 7n });
  const keys = Object.keys(d['0xc879c018db60520f4355c26ed1a6d572cdac1815'].stateDiff);
  assert.equal(keys.length, 2);
  assert.ok(keys.every((k) => /^0x[0-9a-f]{64}$/.test(k)));
  assert.equal(USDC_SLOTS.balance, 9);
  assert.equal(USDC_SLOTS.allowance, 10);
  assert.equal(Object.keys(usdcStateDiff({ owner: WALLET, spender: WALLET, allowance: 1n })['0xc879c018db60520f4355c26ed1a6d572cdac1815'].stateDiff).length, 1);
});

// ---- the decision ------------------------------------------------------------------------------------------------------------------------------------
test('idle USDC is moved to the best vault that really lets this wallet in, and the plan is two unsigned transactions', async () => {
  const w = makeWorld(IDLE);
  const r = await opt(w, { from: 'idle' });
  assert.equal(r.recommendation.action, 'move');
  assert.equal(r.recommendation.to, 'r25-weekly');
  assert.match(r.recommendation.headline, /^MOVE 1,000,000 USDC from USDC idle in the wallet to R25 VRPC Weekly$/);
  assert.deepEqual(r.prepared.transactions.map((t) => t.step), ['approve', 'deposit']);
  const [approve, deposit] = r.prepared.transactions;
  assert.equal(approve.to, '0xc879c018db60520f4355c26ed1a6d572cdac1815');
  assert.ok(approve.data.startsWith(APPROVE));
  assert.equal(deposit.to, VAULT_LIST[0].address);
  assert.ok(deposit.data.startsWith(DEPOSIT));
  assert.equal(approve.gasLimit, Math.ceil(GAS.approve * HEADROOM));
  assert.equal(deposit.gasLimit, Math.ceil(GAS.deposit['r25-weekly'] * HEADROOM));
  assert.match(r.prepared.note, /Unsigned\. Nothing was sent and the agent holds no key/);
  assert.equal(JSON.stringify(r).includes('privateKey'), false);
});

test('the expected net gain is the extra yield over the holding period minus gas and fees, worked out the way it is shown', async () => {
  const w = makeWorld(IDLE);
  const r = await opt(w, { from: 'idle', minHoldDays: 30 });
  const c = byId(r, 'r25-weekly');
  const amountUsd = 1_000_000; // USDC/USD is exactly 1 in the fake world
  const grossExpected = amountUsd * ((1 + c.apy) ** (30 / 365) - 1);
  assert.ok(Math.abs(c.grossGain - grossExpected) < 0.01);
  const gasExpected = ((GAS.approve + GAS.deposit['r25-weekly']) * 10 * 0.6) / 1e9; // gas units x 10 gwei x $0.60 per PROS
  assert.ok(Math.abs(c.gasUsd - gasExpected) < 1e-6, `${c.gasUsd} vs ${gasExpected}`);
  assert.ok(Math.abs(c.net - (c.grossGain - c.gasUsd - c.feeUsd)) < 1e-9);
  assert.equal(r.recommendation.netGainUsd, c.net);
  assert.ok(c.breakEvenDays < 1);
});

test('a longer holding period is worth more: the gain grows with the days you commit to', async () => {
  const w = makeWorld(IDLE);
  const [a, b] = [await opt(w, { from: 'idle', minHoldDays: 7 }), await opt(w, { from: 'idle', minHoldDays: 90 })];
  assert.ok(byId(b, 'r25-weekly').grossGain > 10 * byId(a, 'r25-weekly').grossGain);
  assert.equal(b.assumptions.minHoldDays, 90);
});

test('a vault that refuses this wallet is rejected even with the approval in place, and the reason says what the refusal carries', async () => {
  const r = await opt(makeWorld(IDLE), { from: 'idle' });
  const q = byId(r, 'r25-quarterly');
  assert.equal(q.enter.eligible, false);
  assert.equal(q.viable, false);
  assert.match(q.rejected.join(' '), /refuses this wallet even with the approval in place: custom error 0xe19a2672 \(it carries this wallet’s address, which suggests an access check; the vault does not say which\)/);
  assert.ok(q.apy > byId(r, 'r25-weekly').apy, 'it pays more, and that does not matter: the wallet cannot enter');
});

test('a positive deposit cap below the amount is a reason, and maxDeposit() = 0 (Morpho Vault V2) is NOT a cap', async () => {
  const r = await opt(makeWorld(IDLE), { from: 'idle' });
  assert.match(byId(r, 'r25-semi-yearly').rejected.join(' '), /caps this wallet's deposit at 8\.203251 USDC, below the 1,000,000 USDC to move/);
  const rock = byId(r, 'rockaway-usdc');
  assert.equal(rock.enter.eligible, true, 'it reports maxDeposit 0 and still accepts deposits');
});

test('a vault that cannot be previewed for redemption is flagged as one that may lock the money, and is not recommended', async () => {
  const w = makeWorld({ ...IDLE, locked: ['r25-quarterly'], gated: [] }); // quarterly lets the wallet in, but will not preview a redeem
  const r = await opt(w, { from: 'idle' });
  const q = byId(r, 'r25-quarterly');
  assert.equal(q.enter.eligible, true);
  assert.equal(q.redeemable, false);
  assert.equal(q.viable, false);
  assert.match(q.rejected.join(' '), /will not preview a redemption, so getting out again is not assured \(funds may be locked\)/);
});

test('moving out of a lower-yield vault into a better one prepares redeem, approve and deposit, in that order', async () => {
  // the weekly vault now pays less than Rockaway
  const w = makeWorld({ shares: { 'r25-weekly': 1_000_000_000_000n }, usdc: 0n, perBlock: { 'r25-weekly': 0.00000005, 'r25-quarterly': 0.0000006, 'r25-semi-yearly': 0.0000005, 'rockaway-usdc': 0.0000004 }, locked: ['r25-quarterly'] });
  const r = await opt(w, { from: 'r25-weekly' });
  assert.equal(r.recommendation.action, 'move');
  assert.equal(r.recommendation.to, 'rockaway-usdc');
  assert.deepEqual(r.prepared.transactions.map((t) => t.step), ['redeem', 'approve', 'deposit']);
  const redeem = r.prepared.transactions[0];
  assert.equal(redeem.to, VAULT_LIST[0].address);
  assert.ok(redeem.data.startsWith(REDEEM));
  assert.ok(redeem.data.endsWith(WALLET.slice(2).padStart(64, '0')), 'owner and receiver are the wallet');
  assert.equal(redeem.gasLimit, Math.ceil(GAS.redeem['r25-weekly'] * HEADROOM));
  assert.match(r.source.amountText, /USDC$/);
  assert.match(r.recommendation.reason, /It pays for itself after/);
});

test('STAY PUT when no other vault pays more, and the reason names the rate comparison', async () => {
  const r = await opt(makeWorld({ shares: { 'r25-weekly': 1_000_000_000n }, usdc: 0n }), { from: 'r25-weekly' });
  assert.equal(r.recommendation.action, 'stay');
  assert.match(r.recommendation.headline, /^STAY PUT in R25 VRPC Weekly$/);
  assert.match(byId(r, 'rockaway-usdc').rejected[0], /it pays no more than where the money is now \(\d+\.\d+% against \d+\.\d+%\)/);
  assert.equal(r.prepared, null);
});

test('STAY PUT when the source itself cannot be redeemed, with one clear reason instead of a repeated one', async () => {
  const w = makeWorld({ shares: { 'r25-quarterly': 500_000_000n }, usdc: 0n });
  const r = await opt(w, { from: 'r25-quarterly' });
  assert.equal(r.recommendation.action, 'stay');
  assert.match(r.recommendation.reason, /^R25 VRPC Quarterly cannot be redeemed by this wallet right now \(.*custom error 0xa0387940.*\), so .* USDC cannot be moved out of it, whatever the other vaults pay\.$/);
  assert.ok(r.candidates.every((c) => !c.viable));
});

test('STAY PUT when the gain does not reach your minimum, saying by how much it falls short', async () => {
  const r = await opt(makeWorld(IDLE), { from: 'idle', minNetGainUsd: 1_000_000_000 });
  assert.equal(r.recommendation.action, 'stay');
  assert.match(byId(r, 'r25-weekly').rejected.join(' '), /net gain over 30 days \(\$.*\) is below your minimum of \$1,000,000,000\.00/);
});

test('gas is counted: at an absurd gas price the same move is not worth it', async () => {
  const r = await opt(makeWorld({ ...IDLE, gasPriceWei: 10n ** 20n }), { from: 'idle', amount: '100' });
  assert.equal(r.recommendation.action, 'stay');
  const c = byId(r, 'r25-weekly');
  assert.ok(c.gasUsd > 1_000_000);
  assert.ok(c.net < 0);
});

test('an unsteady yield (it paid almost everything in one half of the window) is not a reliable guide, so it is not chosen', async () => {
  // weekly paid ~0 in the first half of the window and a lot in the second
  const L = 400_000;
  const priceAt = (id, block) => {
    const head = 1_000_000 - 2;
    const t = (block - (head - L)) / L; // 0 at the start of the window, 1 at the end
    const flat = 1 + 0.0000002 * block;
    if (id !== 'r25-weekly') return flat;
    return 1.2 + (t <= 0.5 ? 0.0001 * t : 0.0001 * 0.5 + 0.2 * (t - 0.5));
  };
  const r = await opt(makeWorld({ ...IDLE, priceAt }), { from: 'idle' });
  const c = byId(r, 'r25-weekly');
  assert.equal(c.steady, false);
  assert.match(c.rejected.join(' '), /its yield is uneven \(\d+\.\d% in the first half of the window, \d+\.\d% in the second\)/);
  assert.equal(c.viable, false);
});

test('a move that cannot be priced (no measured gas for that vault) is not recommended, and says so', async () => {
  const r = await opt(makeWorld(IDLE), { from: 'idle', gas: { ...GAS, deposit: { 'rockaway-usdc': 301_187 } } });
  const c = byId(r, 'r25-weekly');
  assert.equal(c.viable, false);
  assert.equal(c.net, null);
  assert.match(c.rejected.join(' '), /no measured gas exists for depositing into this vault/);
  assert.equal(r.recommendation.to, 'rockaway-usdc');
});

test('when the public RPC cannot simulate with a pretend allowance, deposits are tested as they stand: an allowance stop still counts as "let in"', async () => {
  const r = await opt(makeWorld({ ...IDLE, overridesUnsupported: true }), { from: 'idle' });
  assert.equal(byId(r, 'r25-weekly').enter.eligible, true);
  assert.equal(byId(r, 'r25-quarterly').enter.eligible, false);
  assert.ok(r.steps.some((s) => s.name === 'check-override' && /cannot simulate with a pretend allowance/.test(s.summary)));
});

test('classifyDeposit and describeRevert read refusals carefully', () => {
  assert.equal(classifyDeposit(null).eligible, true);
  assert.equal(classifyDeposit({ message: 'ERC20: transfer amount exceeds allowance' }).eligible, true);
  const custom = classifyDeposit({ message: 'custom error 0xe19a2672', selector: '0xe19a2672', raw: '0xe19a2672' + '8ecdf4245efddd2210f79517fbd9d12ff524ab9f'.padStart(64, '0'), walletInError: true });
  assert.equal(custom.eligible, false);
  assert.match(custom.why, /suggests an access check/);
  assert.match(describeRevert({ selector: '0x0267cc62', raw: '0x0267cc62' + (5_000_000n).toString(16).padStart(64, '0') }, WALLET, 5_000_000n), /carries the amount to deposit, which suggests a limit/);
  assert.equal(describeRevert({ message: 'plain reason' }, WALLET, 1n), 'plain reason');
});

// ---- bad input, honesty, safety -------------------------------------------------------------------------------------------------------------------------
test('bad input is a UserError', async () => {
  const w = makeWorld(IDLE);
  await assert.rejects(opt(w, { from: 'idle', amount: '2000000' }), /amount is more than the 1,000,000 USDC this wallet has/);
  await assert.rejects(opt(w, { from: 'idle', amount: '0' }), /amount must be more than zero/);
  await assert.rejects(opt(w, { from: 'idle', amount: 'abc' }), UserError);
  await assert.rejects(opt(w, { from: 'nowhere' }), /from must be "auto", "idle" or one of/);
  await assert.rejects(opt(w, { minHoldDays: 0 }), /minHoldDays must be from 1 to 365/);
  await assert.rejects(opt(w, { minNetGainUsd: -1 }), /minNetGainUsd must be zero or more/);
  await assert.rejects(opt(w, { wallet: '0x12' }), /wallet must be a 0x address/);
  await assert.rejects(optimize({ chain: w.chain, rpc: w.rpc, wallet: WALLET }), /needs the measured gas table/);
});

test('a wallet with no USDC anywhere has nothing to move, and says so', async () => {
  const r = await optimize({ chain: makeWorld().chain, rpc: makeWorld().rpc, wallet: '0x000000000000000000000000000000000000dead', gas: GAS });
  assert.equal(r.recommendation.action, 'stay');
  assert.match(r.recommendation.reason, /holds no USDC/);
  assert.equal(r.candidates.length, 0);
});

test('auto picks the largest USDC bucket, and a part of a bucket can be moved', async () => {
  const w = makeWorld({ usdc: 5_000_000_000n, shares: { 'r25-weekly': 100_000_000_000n } });
  const auto = await opt(w);
  assert.equal(auto.source.id, 'r25-weekly');
  const part = await opt(makeWorld(IDLE), { from: 'idle', amount: '250000' });
  assert.equal(part.source.amountText, '250,000 USDC');
  assert.match(part.prepared.transactions[1].data, /^0x[0-9a-f]+$/);
});

test('read-only: only reads were asked of the chain, and the result is plain JSON', async () => {
  const w = makeWorld(IDLE);
  const r = await opt(w, { from: 'idle' });
  const tools = new Set(w.calls.filter((c) => c.server === 'chain').map((c) => c.name));
  assert.deepEqual([...tools].sort(), ['eth_call', 'get_block', 'get_block_number', 'get_gas_price']);
  assert.ok(w.calls.filter((c) => c.server === 'rpc').every((c) => c.name === 'eth_call'));
  assert.ok(JSON.stringify(r).length > 3000);
  assert.equal(r.assumptions.minHoldDays, DEFAULTS.minHoldDays);
});

test('every batch of reads was confirmed on the public RPC, and a wrong backend answer cannot change the recommendation', async () => {
  const clean = await opt(makeWorld(IDLE), { from: 'idle' });
  assert.equal(clean.integrity.inconclusive, 0);
  assert.equal(clean.integrity.confirmed + clean.integrity.resolved, clean.integrity.batches);
  let hit = 0;
  // once, a backend claims the weekly vault paid nothing at the first block of the window
  const wrong = (target, data) => (target.toLowerCase() === VAULT_LIST[0].address && data.startsWith('0x07a2d13a') && hit++ === 0 ? '0x' + (1n).toString(16).padStart(64, '0') : undefined);
  const noisy = await opt(makeWorld({ ...IDLE, wrong }), { from: 'idle' });
  assert.equal(noisy.integrity.resolved, 1);
  assert.equal(noisy.recommendation.action, clean.recommendation.action);
  assert.equal(noisy.recommendation.to, clean.recommendation.to);
  assert.equal(noisy.recommendation.netGainUsd, clean.recommendation.netGainUsd);
});

test('every candidate shows its sources and the plan shows the rates it rests on', async () => {
  const r = await opt(makeWorld(IDLE), { from: 'idle' });
  for (const c of r.candidates) assert.ok(c.sources.length === 3 && c.sources.every((s) => s.contract === VAULT_LIST.find((v) => v.id === c.id).address), c.id);
  assert.ok(r.yields['r25-weekly'].apy > 0);
  assert.ok(r.gasTable.forkBlock > 0);
});

test('a bad source or amount is refused before the chain is asked at all', async () => {
  const never = { callTool: async () => { throw new Error('the chain must not be asked'); } };
  const rpc = async () => { throw new Error('the RPC must not be asked'); };
  await assert.rejects(optimize({ chain: never, rpc, wallet: WALLET, gas: GAS, from: 'nowhere' }), (e) => e instanceof UserError && /from must be "auto", "idle" or one of/.test(e.message));
  await assert.rejects(optimize({ chain: never, rpc, wallet: WALLET, gas: GAS, amount: '0' }), (e) => e instanceof UserError && /amount must be more than zero/.test(e.message));
  await assert.rejects(optimize({ chain: never, rpc, wallet: WALLET, gas: GAS, amount: '1e3' }), UserError);
});
