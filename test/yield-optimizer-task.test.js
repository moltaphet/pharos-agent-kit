import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run, { compareReplay, readCases, readDemo, readFork } from '../lib/tasks/yield-optimizer.js';
import { HEADROOM } from '../lib/yield-optimizer.js';
import { UserError } from '../lib/snapshot.js';
import { WALLET, makeWorld } from './support/defi-world.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const demo = JSON.parse(file('../reports/yield-demo.json'));
const fork = JSON.parse(file('../reports/yield-fork-run.json'));
const cases = JSON.parse(file('../skills/pharos-yield-optimizer/examples/cases.json'));
const byId = (id) => demo.cases.find((c) => c.id === id);
const cand = (c, id) => c.result.candidates.find((x) => x.id === id);

// ---- the fork evidence: gas measured by really doing it ----------------------------------------------------------------------------------
test('the fork run really executed approve, deposit and redeem against the live vault contracts, and what failed is on record', () => {
  assert.match(fork.network, /anvil fork of Pharos mainnet \(chain 1672\)/);
  assert.deepEqual(Object.keys(fork.vaults).sort(), ['r25-quarterly', 'r25-semi-yearly', 'r25-weekly', 'rockaway-usdc']);
  for (const id of ['r25-weekly', 'rockaway-usdc']) {
    const v = fork.vaults[id];
    assert.equal(v.deposit.status, 'success', id);
    assert.equal(v.redeem.status, 'success', id);
    assert.ok(v.deposit.gasUsed > 100_000 && v.redeem.gasUsed > 100_000, `${id}: real gas, not a placeholder`);
    // what the vault really paid out against what it previewed: equal for R25; a few parts in a hundred million apart for Morpho, whose share price accrues between the preview and the deposit
    const close = (a, b) => { const x = BigInt(a), y = BigInt(b); return (x > y ? x - y : y - x) * 1_000_000n <= y; };
    assert.ok(close(v.deposit.sharesReceived, v.deposit.predictedShares), `${id}: shares received are within a millionth of previewDeposit`);
    assert.ok(close(v.redeem.usdcReceived, v.redeem.predictedUsdc), `${id}: USDC received is within a millionth of previewRedeem`);
  }
  // the quarterly vault really refused, with the codes that the optimizer reports; it is not given a made-up gas number
  assert.equal(fork.vaults['r25-quarterly'].deposit.status, 'reverted');
  assert.equal(fork.vaults['r25-quarterly'].deposit.reason, '0xe19a2672');
  assert.equal(fork.vaults['r25-quarterly'].redeem.reason, '0xa0387940');
  assert.equal(fork.vaults['r25-semi-yearly'].deposit.status, 'reverted');
  assert.equal(fork.vaults['r25-semi-yearly'].redeem.status, 'not-tried');
});

// ---- the recorded demo ------------------------------------------------------------------------------------------------------------------------
test('the recording covers moves and stay-puts on two real wallets, all pinned to one real block', () => {
  assert.deepEqual(demo.cases.map((c) => c.id), cases.map((c) => c.id));
  assert.deepEqual(demo.cases.map((c) => c.result.recommendation.action), ['move', 'stay', 'stay', 'move', 'move']);
  assert.equal(new Set(demo.cases.map((c) => c.wallet)).size, 2);
  assert.equal(new Set(demo.cases.map((c) => c.block)).size, 1, 'every case at the same block');
  for (const c of demo.cases) {
    assert.equal(c.result.block.number, c.block, c.id);
    assert.equal(c.result.block.historical, true, c.id);
    assert.equal(c.result.wallet, c.wallet, c.id);
  }
});

test('a vault is only recommended if it is let in, can be left, has a steady measured rate and has a measured gas figure', () => {
  for (const c of demo.cases) for (const x of c.result.candidates) {
    if (!x.viable) { assert.ok(x.rejected.length >= 1 || x.apy == null || x.net == null || x.net < c.minNetGainUsd || x.apy <= (c.result.source.apy ?? 0) + 1e-9, `${c.id}/${x.id}: a not-viable vault has a reason`); continue; }
    assert.equal(x.enter.eligible, true, `${c.id}/${x.id}`);
    assert.equal(x.redeemable, true, `${c.id}/${x.id}`);
    assert.equal(x.steady, true, `${c.id}/${x.id}`);
    assert.ok(x.gasUnits > 0, `${c.id}/${x.id}: gas is a measured number`);
    assert.ok(x.net >= c.minNetGainUsd, `${c.id}/${x.id}`);
  }
});

test('the quarterly vault pays the most and is rejected, with the reason it gives; the semi-yearly one is capped', () => {
  const c = byId('idle-to-best');
  const best = [...c.result.candidates].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))[0];
  assert.equal(best.id, 'r25-quarterly', 'the highest rate is the quarterly vault');
  assert.equal(best.viable, false);
  assert.equal(best.enter.eligible, false);
  assert.ok(best.rejected.some((r) => /refuses this wallet even with the approval in place: custom error 0xe19a2672/.test(r)));
  assert.ok(best.rejected.every((r) => !/whitelist|KYC|permissioned/i.test(r)), 'no invented explanation for a custom error');
  assert.ok(cand(c, 'r25-semi-yearly').rejected.some((r) => /caps this wallet's deposit at 8\.203251 USDC/.test(r)));
  assert.equal(c.result.recommendation.to, 'r25-weekly', 'the move is to the best vault that works, not the best rate');
});

test('a MOVE splits the gain into extra yield, gas and fees, and the transactions are unsigned with gas limits from the fork', () => {
  for (const id of ['idle-to-best', 'part-of-idle', 'rockaway-holder']) {
    const r = byId(id).result;
    const rec = r.recommendation;
    assert.ok(Math.abs(rec.grossGainUsd - rec.gasUsd - rec.feesUsd - rec.netGainUsd) < 0.01, `${id}: net = gross − gas − fees`);
    assert.ok(rec.netGainUsd >= byId(id).minNetGainUsd, id);
    assert.match(r.prepared.note, /^Unsigned\. Nothing was sent and the agent holds no key/);
    assert.deepEqual(r.prepared.transactions.map((t) => t.step), id === 'rockaway-holder' ? ['redeem', 'approve', 'deposit'] : ['approve', 'deposit']);
    for (const t of r.prepared.transactions) {
      assert.equal(t.value, '0', id);
      assert.match(t.data, /^0x[0-9a-f]+$/, id);
      assert.equal(t.gasLimit, Math.ceil(t.gasUnits * HEADROOM), `${id}/${t.step}: measured units plus 30%`);
    }
    const dep = r.prepared.transactions.find((t) => t.step === 'deposit');
    assert.equal(dep.gasUnits, fork.vaults[rec.to].deposit.gasUsed, `${id}: the deposit gas is the number from the fork run`);
  }
  assert.equal(byId('idle-to-best').result.prepared.transactions[0].data.slice(0, 10), '0x095ea7b3', 'approve(address,uint256)');
  assert.equal(byId('idle-to-best').result.prepared.transactions[1].data.slice(0, 10), '0x6e553f65', 'deposit(uint256,address)');
});

test('a STAY PUT gives the reason, prepares nothing, and does not suggest forcing a move', () => {
  for (const id of ['weekly-stay', 'quarterly-stuck']) {
    const r = byId(id).result;
    assert.equal(r.recommendation.action, 'stay', id);
    assert.equal(r.prepared, null, `${id}: nothing to sign`);
    assert.ok(r.recommendation.reason.length > 60, id);
  }
  assert.match(byId('quarterly-stuck').result.recommendation.reason, /cannot be redeemed by this wallet right now/);
  assert.match(byId('weekly-stay').result.recommendation.reason, /^No vault is worth moving/);
});

test('only a part of the money moves when asked: ten thousand of the idle USDC', () => {
  const r = byId('part-of-idle').result;
  assert.equal(r.source.amountRaw, '10000000000', 'ten thousand USDC in base units');
  assert.equal(r.source.id, byId('idle-to-best').result.source.id, 'out of the same idle balance');
  assert.match(r.recommendation.headline, /^MOVE 10,000 USDC/);
  assert.ok(r.recommendation.netGainUsd < byId('idle-to-best').result.recommendation.netGainUsd / 50);
});

test('the fee line says "no fee" rather than a zero-dollar fee when none is skimmed', () => {
  for (const id of ['idle-to-best', 'part-of-idle', 'rockaway-holder']) {
    const rec = byId(id).result.recommendation;
    assert.doesNotMatch(rec.reason, /\$0\.0000 of vault fees/, id);
    assert.match(rec.reason, /no fee worth counting on entry or exit/, id);
  }
});

test('every read in the recording was confirmed on the public RPC; the override probe and the simulations are on record', () => {
  for (const c of demo.cases) {
    const i = c.result.integrity;
    assert.equal(i.inconclusive, 0, c.id);
    assert.equal(i.confirmed + i.resolved, i.batches, c.id);
    assert.ok(c.result.steps.some((s) => s.name === 'check-override'), `${c.id}: the pretend-allowance trick was checked by reading it back`);
    assert.ok(c.result.steps.some((s) => s.actor === 'public-rpc' && /eth_call/.test(s.name)), c.id);
    assert.deepEqual(c.result.steps.map((s) => s.n), c.result.steps.map((_, i) => i + 1), c.id);
  }
});

test('the recording is read-only, plain JSON, and holds no secrets', () => {
  for (const t of new Set(demo.cases.flatMap((c) => c.result.steps.filter((s) => s.actor === 'chain-mcp').map((s) => s.name)))) assert.ok(['eth_call', 'get_block', 'get_block_number', 'get_gas_price'].includes(t), `read-only tool: ${t}`);
  const text = JSON.stringify(demo) + JSON.stringify(fork);
  assert.equal(/"privateKey"\s*:/i.test(text), false);
  assert.equal(/"(?:mnemonic|seed)"\s*:/i.test(text), false);
  try {
    const key = JSON.parse(file('../.wallet/atlantic-testnet.json')).privateKey;
    assert.equal(text.includes(key), false, 'the throwaway wallet key is not in the recording');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
});

// ---- replay ----------------------------------------------------------------------------------------------------------------------------
test('compareReplay: identical decisions pass; a changed decision, rate or eligibility is named; the gas price caveat is stated', () => {
  const rec = byId('idle-to-best').result;
  const same = compareReplay(rec, structuredClone(rec));
  assert.equal(same.sameAction, true);
  assert.equal(same.sameNetGain, true);
  assert.equal(same.candidates.identical, same.candidates.compared);
  assert.match(same.note, /gas price and the PROS price are live/);
  const changed = structuredClone(rec);
  changed.recommendation.action = 'stay';
  changed.candidates[0].enter.eligible = false;
  const cmp = compareReplay(rec, changed);
  assert.equal(cmp.sameAction, false);
  assert.equal(cmp.candidates.differing.length, 1);
  assert.equal(cmp.candidates.differing[0].id, rec.candidates[0].id);
});

// ---- the API ---------------------------------------------------------------------------------------------------------------------------
test('?example and ?recorded are served', async () => {
  const ex = await run({ q: { example: '1' }, body: null });
  assert.equal(ex.cases.length, 5);
  assert.deepEqual(ex.defaults, { minHoldDays: 30, minNetGainUsd: 10 });
  assert.deepEqual(await readCases(), cases);
  const rec = await run({ q: { recorded: '1' }, body: null });
  assert.equal(rec.demo.cases.length, 5);
  assert.deepEqual(rec.fork, fork);
  assert.equal((await readDemo()).cases.length, 5);
  assert.equal((await readFork()).forkBlock, fork.forkBlock);
});

test('bad input is a UserError before any server is asked', async () => {
  const never = { callTool: async () => { throw new Error('the chain must not be asked'); } };
  await assert.rejects(run({ q: {}, body: null, chain: never }), /give a wallet/);
  await assert.rejects(run({ q: { wallet: '0x12' }, body: null, chain: never }), UserError);
  await assert.rejects(run({ q: { wallet: WALLET, block: 'abc' }, body: null, chain: never }), /block must be a whole number/);
  await assert.rejects(run({ q: { wallet: WALLET, minHoldDays: 'many' }, body: null, chain: never }), /minHoldDays must be a number/);
  await assert.rejects(run({ q: { wallet: WALLET, minNetGainUsd: 'x' }, body: null, chain: never }), /minNetGainUsd must be a number/);
  await assert.rejects(run({ q: { replay: 'nope' }, body: null, chain: never }), /unknown recorded case "nope"; known: idle-to-best/);
});

test('an optimisation arrives by query or by body and is worked out from the chain, with the gas from the fork run', async () => {
  const w = makeWorld({ usdc: 1_000_000_000_000n, shares: {} });
  for (const [q, body] of [[{ wallet: WALLET, from: 'idle', minHoldDays: '30' }, null], [{}, { wallet: WALLET, from: 'idle', minHoldDays: 30 }]]) {
    const out = await run({ q, body, chain: w.chain, rpc: w.rpc });
    assert.equal(out.optimizer.recommendation.action, 'move');
    assert.equal(out.optimizer.assumptions.minHoldDays, 30);
    assert.match(out.optimizer.assumptions.gasFrom, /measured by really doing the steps on a mainnet fork/);
  }
  await assert.rejects(run({ q: { wallet: WALLET, from: 'idle', minHoldDays: '9999' }, body: null, chain: w.chain, rpc: w.rpc }), /minHoldDays must be from 1 to 365/);
  await assert.rejects(run({ q: { wallet: WALLET, from: 'nowhere' }, body: null, chain: w.chain, rpc: w.rpc }), /from must be "auto", "idle" or one of/);
});

test('replay works the recorded case out again at the recorded block and compares it with the recording', async () => {
  const w = makeWorld({ head: 21_200_000, usdc: 1_000_000_000_000n, shares: {} });
  const out = await run({ q: { replay: 'idle-to-best' }, body: null, chain: w.chain, rpc: w.rpc });
  assert.equal(out.replayed.block.number, byId('idle-to-best').block);
  assert.equal(out.case.id, 'idle-to-best');
  assert.ok(out.comparison.candidates.compared === 4);
  assert.equal(typeof out.comparison.sameAction, 'boolean');
});

test('the figures the page quotes as its sample run are the ones in the recording (a stale sample would show numbers nobody recorded)', async () => {
  const page = await import('../public/js/tasks/yield-optimizer.js');
  const r = byId('idle-to-best').result;
  const sample = page.content.run.sample;
  const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  assert.ok(sample.includes(`net over 30 days ${usd(cand(byId('idle-to-best'), 'r25-weekly').net)}`), 'the weekly vault’s net gain');
  assert.ok(sample.includes(`net over 30 days ${usd(cand(byId('idle-to-best'), 'rockaway-usdc').net)}`), 'the Rockaway vault’s net gain');
  assert.ok(sample.includes(`expected net gain is ${usd(r.recommendation.netGainUsd)}`));
  for (const x of r.candidates) assert.ok(sample.includes(`pays ${(x.apy * 100).toFixed(2)}% a year`) || x.id === 'r25-semi-yearly', `${x.id}: its rate`);
  for (const t of r.prepared.transactions) assert.ok(sample.includes(`gas limit ${t.gasLimit.toLocaleString('en-US')}`), t.step);
  const verify = page.content.verify.map((v) => v.code ?? '').join('\n');
  assert.ok(verify.includes(`--block ${r.block.number} `) && verify.includes(`--block ${r.block.number - 400_000} `), 'the cast commands use the recorded block and the start of its window');
});

test('the page ships the same cases as the skill folder (a drifted copy would demo something else)', async () => {
  const page = await import('../public/js/tasks/yield-optimizer.js');
  assert.deepEqual(page.CASES, cases);
  assert.equal(page.content.evidence.length, 4);
  assert.deepEqual(page.content.tools, ['chain', 'rpc']);
});
