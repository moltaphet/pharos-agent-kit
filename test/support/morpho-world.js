// A small fake Morpho Blue on Pharos mainnet for the Liquidation Watchdog's tests: one market, one borrower, an oracle, an interest rate model and two tokens, served as Chain MCP and as a
// public RPC from one table of state (so a test can change one fact, such as the collateral, and see what the watchdog does).
import { encodeAggregate3Output, decodeAggregate3Input } from '../../lib/multicall.js';
import { MULTICALL3, MORPHO } from '../../lib/protocols.js';
import { selectorOf } from '../../lib/keccak.js';

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const strWord = (s) => word(0x20) + word(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0');
export const ID = '0x' + 'ab'.repeat(32);
export const BORROWER = '0x743d7b30661d65b41960bf6b5d1bb93cf7972a73';
const LOAN = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const COLL = '0x54df79d8edf36d15cd83fbeddbd90807fc828934';
const ORACLE = '0x4eefc4c6e7216aedd5e809e4fc74fb8859b3fa46';
const IRM = '0xd5e02889c13230458506cc842347c4e62f8cdf3a';
const SEL = Object.fromEntries(['idToMarketParams(bytes32)', 'market(bytes32)', 'position(bytes32,address)', 'price()', 'symbol()', 'decimals()'].map((s) => [s, selectorOf(s)]));
const RATE_SEL = selectorOf('borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128))');

// A small Morpho Blue: one market, one borrower, an oracle, an IRM and two tokens, served as Chain MCP and as a public RPC (same table of state).
export function world(o = {}) {
  const w = {
    head: 21_000_000, timestamp: 1_790_000_000,
    lltv: 915n * 10n ** 15n, collateral: 22_500n * 10n ** 18n, borrowShares: 21_773_051_357_426_307n, price: 1_090_622_832_040_395_213_000_000n,
    totalBorrowAssets: 3_610_874_519_951n, totalBorrowShares: 3_571_851_701_318_780_599n, lastUpdate: 1_789_990_000, rate: 2_965_224_603n,
    noMarket: false, brokenOracle: false, wrong: null, ...o,
  };
  const calls = [];
  const answer = (to, data) => {
    const t = to.toLowerCase();
    const sel = data.slice(0, 10);
    if (t === MORPHO.address.toLowerCase()) {
      if (sel === SEL['idToMarketParams(bytes32)']) return w.noMarket ? '0x' + word(0).repeat(5) : '0x' + [LOAN, COLL, ORACLE, IRM].map(addrWord).join('') + word(w.lltv);
      if (sel === SEL['market(bytes32)']) return '0x' + [3_912_093_261_272n, 3_873_957_062_634_213_496n, w.totalBorrowAssets, w.totalBorrowShares, w.lastUpdate, 0n].map(word).join('');
      if (sel === SEL['position(bytes32,address)']) return '0x' + word(0) + word(w.borrowShares) + word(w.collateral);
    }
    if (t === ORACLE && sel === SEL['price()']) return '0x' + word(w.brokenOracle ? 0n : w.price);
    if (t === IRM && sel === RATE_SEL) return '0x' + word(w.rate);
    if (sel === SEL['symbol()']) return '0x' + strWord(t === LOAN ? 'USDC' : 'syzUSD');
    if (sel === SEL['decimals()']) return '0x' + word(t === LOAN ? 6 : 18);
    return null;
  };
  const multi = (data, who) => encodeAggregate3Output(decodeAggregate3Input(data).map((c) => {
    let r = answer(c.target, c.data);
    if (who === 'chain' && w.wrong) { const x = w.wrong(c.target, c.data, calls.filter((k) => k.who === 'chain').length); if (x !== undefined) r = x; }
    return r == null ? { success: false, data: '0x' } : { success: true, data: r };
  }));
  const chain = {
    callTool: async (name, args) => {
      calls.push({ who: 'chain', name, args });
      if (name === 'get_block_number') return { blockNumber: String(w.head) };
      if (name === 'get_block') return { number: '0x' + args.block.toString(16), timestamp: '0x' + w.timestamp.toString(16), hash: '0xabc' };
      if (name === 'eth_call') return { result: args.transaction.to.toLowerCase() === MULTICALL3.toLowerCase() ? multi(args.transaction.data, 'chain') : answer(args.transaction.to, args.transaction.data) };
      throw new Error(`unexpected ${name}`);
    },
  };
  const rpc = async (method, params) => {
    calls.push({ who: 'rpc', method, params });
    if (method === 'eth_call') return params[0].to.toLowerCase() === MULTICALL3.toLowerCase() ? multi(params[0].data, 'rpc') : answer(params[0].to, params[0].data);
    throw new Error(`unexpected rpc ${method}`);
  };
  return { w, chain, rpc, calls };
}

