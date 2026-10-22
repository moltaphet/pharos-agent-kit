// Swap math for the two AMM styles FaroSwap uses on Pharos. Pure functions, unit-tested.
//
// V2 (constant product): exact integer maths, fee taken from the input.
// V3 (concentrated liquidity): exact while the price stays inside the current tick range,
// where the pool behaves like a constant-product pool with "virtual" reserves. We check the
// range and refuse to estimate when a trade would leave it (liquidity changes there).

const Q96 = 2 ** 96;

// ---- Uniswap V2 -----------------------------------------------------------------------
export function v2AmountOut(amountIn, reserveIn, reserveOut, feeBps = 30n) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inWithFee = amountIn * (10000n - feeBps);
  return (inWithFee * reserveOut) / (reserveIn * 10000n + inWithFee);
}

// ---- Uniswap V3 (within the active tick range) -----------------------------------------
export const sqrtPrice = (sqrtPriceX96) => Number(sqrtPriceX96) / Q96;
export const sqrtOfTick = (tick) => 1.0001 ** (tick / 2);
export const tickSpacingFor = (fee) => ({ 100: 1, 500: 10, 2500: 50, 3000: 60, 10000: 200 })[fee] ?? 60;

// Signed int24 from a 256-bit word as the node returns it (two's complement, sign-extended).
export const int24 = (hexWord) => {
  const n = BigInt.asIntN(256, BigInt('0x' + hexWord));
  return Number(n);
};

// state = { sqrtP, L, feeRate, tick, tickSpacing }. zeroForOne = selling token0 for token1.
// Returns { out, sqrtAfter, inRange }.
export function v3AmountOut(state, zeroForOne, amountIn) {
  const { sqrtP, L, feeRate } = state;
  const dIn = amountIn * (1 - feeRate);
  let sqrtAfter;
  let out;
  if (zeroForOne) {
    sqrtAfter = (L * sqrtP) / (L + dIn * sqrtP);
    out = L * (sqrtP - sqrtAfter);
  } else {
    sqrtAfter = sqrtP + dIn / L;
    out = L * (1 / sqrtP - 1 / sqrtAfter);
  }
  const lower = Math.floor(state.tick / state.tickSpacing) * state.tickSpacing;
  const upper = lower + state.tickSpacing;
  const inRange = sqrtAfter >= sqrtOfTick(lower) && sqrtAfter <= sqrtOfTick(upper);
  return { out: Math.max(out, 0), sqrtAfter, inRange };
}

// Spot price of token1 per token0 in raw units.
export const v2Spot = (r0, r1) => Number(r1) / Number(r0);
export const v3Spot = (sqrtP) => sqrtP * sqrtP;
