// A small fake Pharos mainnet for the portfolio and yield tests: a Chain MCP and a public RPC that answer the same eth_calls from one table of state,
// so a test can change one fact (a balance, a share price at a block, a revert) and see what an agent does. Multicall3 batches are decoded and answered
// call by call, exactly as the real contract would.
import { decodeAggregate3Input, encodeAggregate3Output } from '../../lib/multicall.js';
import { FEEDS, SEL, TOKENS, VAULT_LIST } from '../../lib/defi.js';
import { MULTICALL3, USDC } from '../../lib/protocols.js';
import { selectorOf } from '../../lib/keccak.js';
const DEPOSIT = selectorOf('deposit(uint256,address)');
const REDEEM = selectorOf('redeem(uint256,address,address)');
const errString = (m) => '0x08c379a0' + (0x20).toString(16).padStart(64, '0') + m.length.toString(16).padStart(64, '0') + Buffer.from(m).toString('hex').padEnd(Math.ceil(m.length / 32) * 64, '0');

export const WALLET = '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f';
export const T0 = 1_790_000_000; // block time of block 0 in the fake chain: one second per block
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const str = (s) => word(0x20) + word(s.length) + Buffer.from(s).toString('hex').padEnd(Math.ceil(s.length / 32) * 64, '0');

export function makeWorld(o = {}) {
  const head = o.head ?? 1_000_000;
  const world = {
    head,
    pros: o.pros ?? 2n * 10n ** 18n,
    usdc: o.usdc ?? 1_000_000_000n, // 1,000 USDC in the wallet
    wpros: o.wpros ?? 0n,
    shares: o.shares ?? { 'r25-weekly': 1_000_000_000n, 'r25-quarterly': 500_000_000n }, // base units of the share
    // price of one whole share in USDC, at a block, as a number (1.02 means 1 share = 1.02 USDC). Grows linearly: perBlock per block from `base` at block 0
    base: o.base ?? { 'r25-weekly': 1.0, 'r25-quarterly': 1.0, 'r25-semi-yearly': 1.0, 'rockaway-usdc': 1.0 },
    perBlock: o.perBlock ?? { 'r25-weekly': 0.0000002, 'r25-quarterly': 0.0000006, 'r25-semi-yearly': 0.0000005, 'rockaway-usdc': 0.00000018 },
    locked: new Set(o.locked ?? ['r25-quarterly']), // previewRedeem reverts
    maxRedeem: o.maxRedeem ?? {},
    feeds: o.feeds ?? { 'USDC/USD': 10n ** 18n, 'PROS/USD': 600_000_000_000_000_000n },
    feedAge: o.feedAge ?? 600,
    gated: new Set(o.gated ?? ['r25-quarterly']), // deposits refused for this wallet with a custom error that carries its address, even when approved
    caps: o.caps ?? { 'r25-semi-yearly': 8_203_251n }, // maxDeposit(wallet): a positive cap; a vault missing here reports 0 like Morpho Vault V2 (which still accepts deposits)
    redeemBlocked: new Set(o.redeemBlocked ?? ['r25-quarterly']),
    gasPriceWei: o.gasPriceWei ?? 10_000_000_000n,
    approved: o.approved ?? false, // the wallet already approved every vault for any amount
    broken: new Set(o.broken ?? []), // targets (lowercase) whose every call reverts
    wrong: o.wrong ?? null, // (target, data, block, nth) => hex | undefined : makes one backend answer wrongly
  };
  const calls = [];
  const priceAt = (id, block) => o.priceAt?.(id, block) ?? world.base[id] + world.perBlock[id] * block;
  const vault = (addr) => VAULT_LIST.find((v) => v.address === addr.toLowerCase());
  const token = (addr) => TOKENS.find((t) => t.address === addr.toLowerCase());
  const feed = (addr) => Object.entries(FEEDS).find(([, f]) => f.address === addr.toLowerCase())?.[0];
  const REVERT = Symbol('revert');

  function answer(target, data, block) {
    const t = target.toLowerCase();
    const sel = data.slice(0, 10);
    const arg = (i) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
    if (world.broken.has(t)) return REVERT;
    if (t === MULTICALL3.toLowerCase() && sel === SEL.getEthBalance) return '0x' + word(arg(0).endsWith(WALLET.slice(2)) ? world.pros : 0n);
    const tk = token(t);
    if (tk) {
      if (sel === SEL.decimals) return '0x' + word(tk.decimals);
      if (sel === SEL.balanceOf) return '0x' + word(arg(0).endsWith(WALLET.slice(2)) ? (tk.symbol === 'USDC' ? world.usdc : world.wpros) : 0n);
    }
    const v = vault(t);
    if (v) {
      const ratioE12 = BigInt(Math.round(priceAt(v.id, block) * 1e12));
      const toAssets = (shares) => (shares * ratioE12 * 10n ** 6n) / (10n ** 12n * 10n ** BigInt(v.shareDecimals));
      if (sel === SEL.decimals) return '0x' + word(v.shareDecimals);
      if (sel === SEL.asset) return '0x' + addrWord(USDC);
      if (sel === SEL.balanceOf) return '0x' + word(arg(0).endsWith(WALLET.slice(2)) ? BigInt(world.shares[v.id] ?? 0) : 0n);
      if (sel === SEL.convertToAssets) return '0x' + word(toAssets(BigInt('0x' + arg(0))));
      if (sel === SEL.previewRedeem) return world.locked.has(v.id) ? REVERT : '0x' + word(toAssets(BigInt('0x' + arg(0))));
      if (sel === SEL.maxRedeem) return '0x' + word(world.maxRedeem[v.id] ?? BigInt(world.shares[v.id] ?? 0));
      if (sel === SEL.maxDeposit) return '0x' + word(world.caps[v.id] ?? 0n);
      const toShares = (assets) => (assets * 10n ** 12n * 10n ** BigInt(v.shareDecimals)) / (ratioE12 * 10n ** 6n);
      if (sel === SEL.previewDeposit || sel === SEL.convertToShares) return '0x' + word(toShares(BigInt('0x' + arg(0))));
    }
    const f = feed(t);
    if (f) {
      if (sel === SEL.latestAnswer) return '0x' + word(world.feeds[f]);
      if (sel === SEL.latestTimestamp) return '0x' + word(T0 + block - world.feedAge);
    }
    return REVERT;
  }

  let nth = 0;
  function ethCall(tx, block, who, overrides = null) {
    approved = Boolean(overrides);
    const to = tx.to.toLowerCase();
    if (to === MULTICALL3.toLowerCase() && tx.data.startsWith('0x82ad56cb')) {
      const rows = decodeAggregate3Input(tx.data).map((c) => {
        let r = answer(c.target, c.data, block);
        if (who === 'chain' && world.wrong) { const w = world.wrong(c.target, c.data, block, nth++); if (w !== undefined) r = w; }
        return r === REVERT ? { success: false, data: '0x' } : { success: true, data: r };
      });
      return encodeAggregate3Output(rows);
    }
    const v = vault(to);
    if (v && tx.from && tx.data.startsWith(DEPOSIT)) {
      const amount = BigInt('0x' + tx.data.slice(10, 74));
      if (world.gated.has(v.id)) throw revertWith('0xe19a2672' + addrWord(tx.from));
      if (world.caps[v.id] && amount > world.caps[v.id]) throw revertWith('0x0267cc62' + word(amount));
      if (!approved && !world.approved) throw revertWith(errString('ERC20: transfer amount exceeds allowance'), 'ERC20: transfer amount exceeds allowance');
      return '0x' + word(amount);
    }
    if (v && tx.from && tx.data.startsWith(REDEEM)) {
      if (world.redeemBlocked.has(v.id)) throw revertWith('0xa0387940');
      return '0x' + word(BigInt('0x' + tx.data.slice(10, 74)));
    }
    const r = answer(to, tx.data, block);
    if (r === REVERT) throw revertWith('0x');
    return r;
  }
  let approved = false;
  function revertWith(data, message = '') {
    return Object.assign(new Error(`eth_call: ${JSON.stringify({ error: { message: `execution reverted: ${message}`, code: 3, data } })}`), { tool: 'eth_call', rpc: { message: `execution reverted: ${message}`, data } });
  }

  const chain = {
    callTool: async (name, args) => {
      calls.push({ server: 'chain', name, args });
      if (name === 'get_block_number') return { blockNumber: String(world.head) };
      if (name === 'get_block') return { number: '0x' + args.block.toString(16), hash: '0xabc', timestamp: '0x' + (T0 + args.block).toString(16) };
      if (name === 'get_gas_price') return { gasPriceWei: world.gasPriceWei.toString(), gasPriceGwei: String(Number(world.gasPriceWei) / 1e9) };
      if (name === 'eth_call') return { result: ethCall(args.transaction, args.block, 'chain') };
      throw new Error(`unexpected chain tool ${name}`);
    },
  };
  const rpc = async (method, params) => {
    calls.push({ server: 'rpc', name: method, args: params });
    if (o.rpcDown) throw new Error('rate limited');
    if (method !== 'eth_call') throw new Error(`unexpected rpc ${method}`);
    if (params[2] && o.overridesUnsupported) throw new Error('state overrides are not supported');
    // a probe of the USDC allowance with an override reads back the value that was set
    if (params[2] && params[0].data.startsWith('0xdd62ed3e') && params[0].to.toLowerCase() === USDC) return '0x' + word(Object.values(params[2][USDC].stateDiff)[0] ? BigInt(Object.values(params[2][USDC].stateDiff)[0]) : 0n);
    return ethCall(params[0], parseInt(params[1], 16), 'rpc', params[2] ?? null);
  };
  return { world, chain, rpc, calls, priceAt };
}
