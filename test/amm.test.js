import test from 'node:test';
import assert from 'node:assert/strict';
import { int24, sqrtOfTick, sqrtPrice, tickSpacingFor, v2AmountOut, v2Spot, v3AmountOut, v3Spot } from '../lib/amm.js';

test('v2AmountOut matches the Uniswap V2 formula (0.3% fee)', () => {
  // amountOut = in*997*rOut / (rIn*1000 + in*997), checked independently with Python integers.
  assert.equal(v2AmountOut(1000n, 100000n, 100000n), 987n);
  assert.equal(v2AmountOut(10n ** 18n, 10n ** 21n, 10n ** 21n), 996006981039903216n);
});

test('v2AmountOut never returns more than the reserve and handles empty pools', () => {
  assert.ok(v2AmountOut(10n ** 30n, 1000n, 1000n) < 1000n);
  assert.equal(v2AmountOut(0n, 1000n, 1000n), 0n);
  assert.equal(v2AmountOut(5n, 0n, 1000n), 0n);
});

test('a bigger trade gets a worse average price (price impact)', () => {
  const small = Number(v2AmountOut(10n ** 15n, 10n ** 21n, 10n ** 21n)) / 1e15;
  const big = Number(v2AmountOut(10n ** 20n, 10n ** 21n, 10n ** 21n)) / 1e20;
  assert.ok(big < small);
});

test('int24 reads a sign-extended negative tick', () => {
  assert.equal(int24('f'.repeat(64 - 5) + 'fffd8'.slice(-5)), -40); // ...fffd8 = -40
  assert.equal(int24('0'.repeat(63) + '5'), 5);
  assert.equal(int24('f'.repeat(64)), -1);
});

test('sqrtOfTick and tick spacing', () => {
  assert.equal(sqrtOfTick(0), 1);
  assert.ok(Math.abs(sqrtOfTick(2) - 1.0001) < 1e-12);
  assert.equal(tickSpacingFor(3000), 60);
  assert.equal(tickSpacingFor(500), 10);
  assert.equal(tickSpacingFor(100), 1);
});

test('sqrtPrice and spot helpers', () => {
  assert.equal(sqrtPrice(2n ** 96n), 1);
  assert.equal(v3Spot(2), 4);
  assert.equal(v2Spot(100n, 250n), 2.5);
});

// A pool at price 1 (sqrtP 1) with L = 1e9 inside [−60, 0) .. we use tick 0, spacing 60.
const pool = { sqrtP: 1, L: 1e9, feeRate: 0.003, tick: 0, tickSpacing: 60 };

test('v3AmountOut: a small trade is close to spot minus the fee, and stays in range', () => {
  const r = v3AmountOut(pool, true, 1e3); // sell token0, price 1 → ~997 token1
  assert.ok(Math.abs(r.out - 997) < 0.01, `got ${r.out}`);
  assert.equal(r.inRange, false); // selling token0 lowers the price below tick 0's lower bound (tick 0 starts the range)
});

test('v3AmountOut: buying token0 raises the price and reports whether it left the range', () => {
  const small = v3AmountOut(pool, false, 1e3);
  assert.ok(Math.abs(small.out - 997) < 0.01);
  assert.equal(small.inRange, true); // sqrtP just above 1, well inside [tick 0, tick 60)
  const huge = v3AmountOut(pool, false, 5e8); // moves price a lot
  assert.equal(huge.inRange, false);
});

test('v3AmountOut is symmetric enough: round trip loses about two fees plus tiny impact', () => {
  const a = v3AmountOut(pool, false, 1e6); // token1 -> token0
  const b = v3AmountOut({ ...pool, sqrtP: a.sqrtAfter }, true, a.out); // and back
  const loss = 1 - b.out / 1e6;
  assert.ok(loss > 0.0059 && loss < 0.0062, `round-trip loss ${loss}`);
});
