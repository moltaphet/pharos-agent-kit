// What the portfolio and yield agents know about, and nothing else: the tokens, the price feeds and the ERC-4626 vaults on Pharos mainnet that were
// verified on chain (code present, interface answered). Anything outside this list is reported as "not read", never guessed.

import { keccak256, selectorOf } from './keccak.js';
import { USDC, VAULTS, WPROS } from './protocols.js';

export const NATIVE = { symbol: 'PROS', name: 'PROS (native)', decimals: 18, priceFeed: 'PROS/USD' };

export const TOKENS = [
  { symbol: 'USDC', name: 'USD Coin', address: USDC, decimals: 6, priceFeed: 'USDC/USD' },
  { symbol: 'WPROS', name: 'Wrapped PROS', address: WPROS, decimals: 18, priceFeed: 'PROS/USD', note: 'wrapped PROS, valued at the PROS/USD price' },
];

// Chainlink-style feeds on Pacific Mainnet, listed on the "Chainlink Push Engine Feeds" page of the Pharos docs. latestAnswer() has 18 decimals.
export const FEEDS = {
  'USDC/USD': { address: '0x3f882c4f2836b1e5c5278ff2b9fcce2502a35c5d', decimals: 18 },
  'PROS/USD': { address: '0x371ed36aee5bffbed1a2aa9b7ded7f4eb30f5466', decimals: 18 },
};

// The four ERC-4626 vaults, all holding USDC. `aliases` are what a person might call them.
const EXTRA = {
  [VAULTS[0].address.toLowerCase()]: { id: 'r25-weekly', shareDecimals: 6, aliases: ['weekly', 'vrpc weekly', 'vrpcw', 'r25 weekly'] },
  [VAULTS[1].address.toLowerCase()]: { id: 'r25-quarterly', shareDecimals: 6, aliases: ['quarterly', 'vrpc quarterly', 'vrpcq', 'r25 quarterly'] },
  [VAULTS[2].address.toLowerCase()]: { id: 'r25-semi-yearly', shareDecimals: 6, aliases: ['semi-yearly', 'semi yearly', 'semiyearly', 'semi', 'vrpcs', 'r25 semi'] },
  [VAULTS[3].address.toLowerCase()]: { id: 'rockaway-usdc', shareDecimals: 18, aliases: ['rockaway', 'rockawayx', 'roxusdc', 'morpho vault', 'morpho'] },
};
export const VAULT_LIST = VAULTS.map((v) => ({ ...v, address: v.address.toLowerCase(), asset: USDC, protocolLabel: v.protocol === 'Morpho' ? 'Morpho (RockawayX vault)' : v.protocol, ...EXTRA[v.address.toLowerCase()] }));

export const PROTOCOL_NAMES = [...new Set(VAULT_LIST.map((v) => v.protocolLabel))];
export const UNSUPPORTED_PROTOCOLS = ['aave', 'compound', 'uniswap', 'sushiswap', 'curve', 'lido', 'maker', 'sky', 'pendle', 'balancer', 'convex', 'yearn', 'gmx', 'faroswap'];

export const FN = {
  balanceOf: 'balanceOf(address)',
  decimals: 'decimals()',
  asset: 'asset()',
  convertToAssets: 'convertToAssets(uint256)',
  convertToShares: 'convertToShares(uint256)',
  approve: 'approve(address,uint256)',
  deposit: 'deposit(uint256,address)',
  redeem: 'redeem(uint256,address,address)',
  previewRedeem: 'previewRedeem(uint256)',
  previewDeposit: 'previewDeposit(uint256)',
  maxDeposit: 'maxDeposit(address)',
  maxRedeem: 'maxRedeem(address)',
  totalAssets: 'totalAssets()',
  latestAnswer: 'latestAnswer()',
  latestTimestamp: 'latestTimestamp()',
  getEthBalance: 'getEthBalance(address)',
};
export const SEL = Object.fromEntries(Object.entries(FN).map(([k, sig]) => [k, selectorOf(sig)]));

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
export const enc = {
  address: (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0'),
  uint: (n) => word(n),
};
// Where Pharos USDC keeps its balances and allowances (both are mappings): found by overriding each candidate slot in an eth_call and watching the result
// change, then checked on every run before it is relied on. They let the optimizer ask "would this deposit work if the wallet had approved it?".
export const USDC_SLOTS = { balance: 9, allowance: 10 };
export function usdcStateDiff({ owner, spender, allowance, balance = null }) {
  const pad = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const slotKey = (a, slot) => '0x' + keccak256(Buffer.from(pad(a) + pad(slot.toString(16)), 'hex'));
  const nested = (a, b, slot) => '0x' + keccak256(Buffer.from(pad(b) + keccak256(Buffer.from(pad(a) + pad(slot.toString(16)), 'hex')), 'hex'));
  const val = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
  const diff = { [nested(owner, spender, USDC_SLOTS.allowance)]: val(allowance) };
  if (balance != null) diff[slotKey(owner, USDC_SLOTS.balance)] = val(balance);
  return { [USDC]: { stateDiff: diff } };
}

export const EXPLORER = 'https://www.pharosscan.xyz';
export const explorerAddress = (a) => `${EXPLORER}/address/${a}`;

// USD in micro-dollars (integer), from an amount in base units and a price with `priceDecimals` decimals. Exact: no floating point.
export const toMicroUsd = (amountRaw, tokenDecimals, priceRaw, priceDecimals = 18) => (amountRaw * priceRaw * 1_000_000n) / (10n ** BigInt(tokenDecimals) * 10n ** BigInt(priceDecimals));
export const fmtUsd = (micro) => {
  const neg = micro < 0n;
  const m = neg ? -micro : micro;
  const cents = (m + 5_000n) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${whole}.${(cents % 100n).toString().padStart(2, '0')}`;
};
export const fmtUnits = (raw, decimals, maxFrac = 6) => {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
};
