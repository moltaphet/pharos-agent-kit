// Real-EVM arbitrage on a local anvil fork of Pharos mainnet.
//
// The FaroSwap V2 pair and V3 pool are the live contracts, but their real liquidity is smaller
// than the gas for one swap, so no price move can ever make a live trade profitable. On the
// fork we therefore (1) re-price the dust V2 pair to the V3 price with a real swap, (2) deposit
// our own liquidity into both venues with real mint calls, (3) skew the V2 price with a real
// swap, (4) let the real scanner decide on the fork's state, and (5) execute both legs with a
// helper contract (contracts/ArbLab.sol) so predicted and actual profit can be compared.
// Nothing here touches a real network: transactions only change the fork.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeAddress } from './abi.js';

export const SELECTORS = {
  wrap: '0xbf376c7a',
  v2AddLiquidity: '0x8bb0acee',
  v2Swap: '0xcf73a334',
  v3AddLiquidity: '0xb68dbce7',
  v3Swap: '0x2f8983b3',
  arb: '0xe321c786',
  balanceOf: '0x70a08231',
};
export const SIGNATURES = {
  wrap: 'wrap(address,uint256)',
  v2AddLiquidity: 'v2AddLiquidity(address,uint256,uint256)',
  v2Swap: 'v2Swap(address,address,uint256)',
  v3AddLiquidity: 'v3AddLiquidity(address,int24,int24,uint128)',
  v3Swap: 'v3Swap(address,address,uint256)',
  arb: 'arb(address,address,address,uint256,bool,bool)',
  balanceOf: 'balanceOf(address)',
};

// ---- ABI encoding (static types only; negative ints in two's complement) -------------------
export const uint = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
export const int = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
export const bool = (b) => uint(b ? 1 : 0);
export const addr = (a) => encodeAddress(a);
export const calldata = (name, ...words) => SELECTORS[name] + words.join('');

// ---- the lab contract ---------------------------------------------------------------------------
const LAB_DIR = fileURLToPath(new URL('../contracts/', import.meta.url));
// Prefers a fresh local build; falls back to the committed bytecode (contracts/ArbLab.bytecode.json), which is what runs
// inside the Sandbox, where there is no Solidity compiler and no way to download one.
export function labBytecode() {
  const artifact = `${LAB_DIR}out/ArbLab.sol/ArbLab.json`;
  const committed = `${LAB_DIR}ArbLab.bytecode.json`;
  if (existsSync(artifact)) return JSON.parse(readFileSync(artifact, 'utf8')).bytecode.object;
  if (existsSync(committed)) return JSON.parse(readFileSync(committed, 'utf8')).bytecode;
  execFileSync('forge', ['build'], { cwd: LAB_DIR, stdio: 'ignore' });
  return JSON.parse(readFileSync(artifact, 'utf8')).bytecode.object;
}

// ---- a Chain-MCP-shaped client over the fork, so the real scanner runs unchanged ------------------
// Only the tools the scanner uses: get_block_number, eth_call, get_gas_price.
export function forkChain(io) {
  return {
    async callTool(name, args = {}) {
      if (name === 'get_block_number') return { blockNumber: Number(BigInt(await io.rpc('eth_blockNumber'))) };
      if (name === 'get_gas_price') {
        const wei = BigInt(await io.rpc('eth_gasPrice'));
        return { gasPriceWei: wei.toString(), gasPriceGwei: String(Number(wei) / 1e9) };
      }
      if (name === 'eth_call') {
        const block = args.block == null ? 'latest' : '0x' + BigInt(args.block).toString(16);
        try {
          return { result: await io.rpc('eth_call', [{ to: args.transaction.to, data: args.transaction.data }, block]) };
        } catch (err) {
          throw Object.assign(err, { tool: true });
        }
      }
      throw new Error(`the fork adapter does not implement ${name}`);
    },
  };
}

// ---- token balances: anvil cannot "deal", so find the balance mapping slot ----------------------------
const mappingSlot = (holder, slot) => execFileSync('cast', ['index', 'address', holder, slot], { encoding: 'utf8' }).trim();
// OpenZeppelin v5 keeps balances in ERC-7201 namespaced storage.
const OZ5_ERC20_BASE = '0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00';
const oz5Slot = (holder) => execFileSync('cast', ['keccak', '0x' + addr(holder) + OZ5_ERC20_BASE.slice(2)], { encoding: 'utf8' }).trim();

export async function setTokenBalance(io, token, holder, amount) {
  const probe = 123456789n;
  const candidates = [...Array.from({ length: 12 }, (_, i) => ({ how: `mapping slot ${i}`, key: mappingSlot(holder, i) })), { how: 'ERC-7201 (OpenZeppelin v5)', key: oz5Slot(holder) }];
  for (const c of candidates) {
    await io.rpc('anvil_setStorageAt', [token, c.key, '0x' + uint(probe)]);
    if (BigInt(await io.call(token, SELECTORS.balanceOf + addr(holder))) === probe) {
      await io.rpc('anvil_setStorageAt', [token, c.key, '0x' + uint(amount)]);
      return c.how;
    }
    await io.rpc('anvil_setStorageAt', [token, c.key, '0x' + uint(0)]);
  }
  throw new Error(`could not find the balance storage slot of ${token}`);
}

export const balanceOf = async (io, token, who) => BigInt(await io.call(token, SELECTORS.balanceOf + addr(who)));

// ---- math -------------------------------------------------------------------------------------------
// V2 swap output with the 0.3% fee (the same integer formula the pair enforces).
export const v2Out = (amountIn, rIn, rOut) => (amountIn * 997n * rOut) / (rIn * 1000n + amountIn * 997n);

// Input needed to push a V2 pair from reserves (rIn, rOut) to a price of `targetOutPerIn` (token out
// per token in, as a float) AFTER the swap. The fee stays in the pool, so the closed form for a
// fee-less pool lands about 0.3% off; this solves it exactly by bisection on the real formula.
export function v2InputToReach(rIn, rOut, targetOutPerIn) {
  const priceAfter = (a) => Number(rOut - v2Out(a, rIn, rOut)) / Number(rIn + a);
  if (priceAfter(0n) <= targetOutPerIn) return 0n;
  let lo = 0n;
  let hi = rIn * 1_000_000n;
  for (let i = 0; i < 200 && hi - lo > 1n; i++) {
    const mid = (lo + hi) / 2n;
    if (priceAfter(mid) > targetOutPerIn) lo = mid;
    else hi = mid;
  }
  return hi;
}

// Float price of the V3 pool (token1 per token0) from sqrtPriceX96.
export const priceFromSqrtX96 = (sqrtX96) => (Number(sqrtX96) / 2 ** 96) ** 2;
