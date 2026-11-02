import test from 'node:test';
import assert from 'node:assert/strict';
import { runSaga } from '../lib/saga.js';
import { vaultSaga, VAULT } from '../lib/saga-scenario.js';
import { USDC } from '../lib/protocols.js';
import { SELECTORS, encodeAddress } from '../lib/abi.js';

// The Atlantic run (scripts/testnet-vault-saga.mjs) passes deployed TestUSDC /
// TestVault addresses into vaultSaga. This test proves, without a chain, a
// wallet or Foundry, that those overrides actually change the addresses the
// saga talks to, and that the same steps still complete and still compensate.
// The fake below is a 1:1 TestUSDC + TestVault, like contracts/TestVault.sol:
// approve / deposit / transfer / redeem, and a transfer to the zero address
// that reverts instead of moving shares.

const TOKEN = '0x1111111111111111111111111111111111111111';
const VAULT_ADDR = '0x2222222222222222222222222222222222222222';
const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TREASURY = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ZERO = '0x0000000000000000000000000000000000000000';
const AMOUNT = 100_000_000n;
const SEL = { approve: '0x095ea7b3', transfer: '0xa9059cbb', deposit: '0x6e553f65', redeem: '0xba087652' };

function fakeWorld() {
  const tokenBal = new Map([[ACCOUNT, 1_000_000_000n]]);
  const tokenAllow = new Map();
  const shares = new Map();
  let n = 0;
  const receipts = new Map();
  const word = (data, i) => BigInt('0x' + data.slice(10 + i * 64, 10 + (i + 1) * 64));
  const addr = (data, i) => '0x' + data.slice(10 + i * 64 + 24, 10 + (i + 1) * 64);
  const hex = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');
  const io = {
    async call(to, data) {
      const sel = data.slice(0, 10);
      if (sel === SELECTORS.balanceOf) return hex(to === TOKEN ? (tokenBal.get(addr(data, 0)) ?? 0n) : (shares.get(addr(data, 0)) ?? 0n));
      if (sel === '0xdd62ed3e') return hex(tokenAllow.get(`${addr(data, 0)}:${addr(data, 1)}`) ?? 0n);
      throw new Error(`unexpected call ${sel}`);
    },
  };
  const exec = {
    async send(tx) {
      const hash = `0x${(++n).toString(16).padStart(64, '0')}`;
      const sel = tx.data.slice(0, 10);
      let status = 'success';
      if (tx.to === TOKEN && sel === SEL.approve) tokenAllow.set(`${tx.from}:${addr(tx.data, 0)}`, word(tx.data, 1));
      else if (tx.to === VAULT_ADDR && sel === SEL.deposit) {
        const amount = word(tx.data, 0);
        const receiver = addr(tx.data, 1);
        const key = `${tx.from}:${VAULT_ADDR}`;
        assert.ok((tokenAllow.get(key) ?? 0n) >= amount, 'deposit without allowance');
        tokenAllow.set(key, (tokenAllow.get(key) ?? 0n) - amount);
        tokenBal.set(tx.from, (tokenBal.get(tx.from) ?? 0n) - amount);
        shares.set(receiver, (shares.get(receiver) ?? 0n) + amount);
      } else if (tx.to === VAULT_ADDR && sel === SEL.redeem) {
        const amount = word(tx.data, 0);
        const receiver = addr(tx.data, 1);
        const owner = addr(tx.data, 2);
        shares.set(owner, (shares.get(owner) ?? 0n) - amount);
        tokenBal.set(receiver, (tokenBal.get(receiver) ?? 0n) + amount);
      } else if (tx.to === VAULT_ADDR && sel === SEL.transfer) {
        const to = addr(tx.data, 0);
        const amount = word(tx.data, 1);
        if (to === ZERO) status = 'reverted';
        else { shares.set(tx.from, (shares.get(tx.from) ?? 0n) - amount); shares.set(to, (shares.get(to) ?? 0n) + amount); }
      } else throw new Error(`unexpected send ${tx.to} ${sel}`);
      receipts.set(hash, status);
      return hash;
    },
    async receipt(hash) { return { hash, status: receipts.get(hash), blockNumber: 1, gasUsed: 50000 }; },
  };
  return { io, exec, tokenBal, shares, tokenAllow };
}

test('Atlantic override: the saga talks to the deployed test token and vault, and completes', async () => {
  const w = fakeWorld();
  const saga = vaultSaga({ io: w.io, account: ACCOUNT, treasury: TREASURY, amount: AMOUNT, usdc: TOKEN, vault: VAULT_ADDR });
  assert.equal(saga.steps[0].tx().to, TOKEN);
  assert.equal(saga.steps[1].tx().to, VAULT_ADDR);
  const result = await runSaga({ name: 'vault-saga:success', steps: saga.steps, exec: w.exec, policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 } });
  assert.equal(result.status, 'completed');
  const final = await saga.finalCheck('completed');
  assert.equal(final.clean, true);
  assert.equal(final.treasuryShares, AMOUNT);
  assert.equal(final.accountShares, 0n);
  assert.equal(final.allowance, 0n);
  assert.equal(final.spent, AMOUNT);
});

test('Atlantic override: a transfer to the zero address reverts and the saga compensates to a clean state', async () => {
  const w = fakeWorld();
  const saga = vaultSaga({ io: w.io, account: ACCOUNT, treasury: TREASURY, amount: AMOUNT, failStep3: true, usdc: TOKEN, vault: VAULT_ADDR });
  const result = await runSaga({ name: 'vault-saga:failure', steps: saga.steps, exec: w.exec, policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 } });
  assert.equal(result.status, 'compensated');
  assert.equal(result.failure.step, 'transfer');
  assert.equal(result.failure.kind, 'permanent');
  const final = await saga.finalCheck('compensated');
  assert.equal(final.clean, true);
  assert.equal(w.tokenBal.get(ACCOUNT), 1_000_000_000n, 'the deposit was redeemed back');
  assert.equal(w.shares.get(ACCOUNT) ?? 0n, 0n);
  assert.equal(w.shares.get(TREASURY) ?? 0n, 0n);
});

test('no override: the fork / demo path still uses the mainnet USDC and RockawayX vault', () => {
  const w = fakeWorld();
  const saga = vaultSaga({ io: w.io, account: ACCOUNT, treasury: TREASURY, amount: AMOUNT });
  assert.equal(saga.steps[0].tx().to, USDC);
  assert.equal(saga.steps[1].tx().to, VAULT);
});
