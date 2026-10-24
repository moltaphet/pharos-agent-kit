// A small fake Pharos mainnet for the payment agents' tests: a Chain MCP and a public RPC that answer from one table of state (balances, token contracts, mined transfers),
// so a test can change one fact and see what an agent does. Multicall3 batches are decoded and answered call by call; reverts come back as the JSON the hosted server uses.
import { decodeAggregate3Input, encodeAggregate3Output } from '../../lib/multicall.js';
import { MULTICALL3, USDC } from '../../lib/protocols.js';
import { selectorOf } from '../../lib/keccak.js';
import { TOKENS, referenceHex } from '../../lib/payments.js';
import { TRANSFER_TOPIC } from '../../lib/recurring.js';

export const PAYER = '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f';
export const PAYEE = '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const strWord = (s) => word(0x20) + word(s.length) + Buffer.from(s).toString('hex').padEnd(Math.ceil(s.length / 32) * 64, '0');
const SEL = Object.fromEntries(['symbol()', 'decimals()', 'balanceOf(address)', 'transfer(address,uint256)', 'getEthBalance(address)'].map((s) => [s, selectorOf(s)]));
const errorString = (m) => '0x08c379a0' + word(0x20) + word(m.length) + Buffer.from(m).toString('hex').padEnd(Math.ceil(m.length / 32) * 64, '0');
const revert = (message, data = '0x') => Object.assign(new Error(`eth_call: ${JSON.stringify({ error: { message: `execution reverted: ${message}`, code: 3, data } })}`), { tool: 'eth_call' });

export function payWorld(o = {}) {
  const w = {
    head: o.head ?? 1_000_000, t0: o.t0 ?? 1_790_000_000, gasPriceWei: o.gasPriceWei ?? 10_000_000_000n,
    native: { [PAYER]: 0n, ...(o.native ?? {}) }, // PROS
    tokens: { [USDC]: { symbol: 'USDC', decimals: 6, balances: { [PAYER]: 1_000_000_000n, ...(o.usdc ?? {}) } }, ...(o.tokens ?? {}) },
    contractWallets: new Set([PAYER, ...(o.contractWallets ?? [])]), // addresses that hold code
    txs: new Map(), logs: [], failTransfers: Boolean(o.failTransfers), wrong: o.wrong ?? null, rpcDown: Boolean(o.rpcDown),
  };
  const calls = [];
  const blockTime = (b) => w.t0 + b;
  const tokenOf = (a) => w.tokens[a.toLowerCase()];
  const balanceOfToken = (t, who) => tokenOf(t).balances[who.toLowerCase()] ?? 0n;
  const answer = (to, data) => {
    const t = to.toLowerCase();
    const sel = data.slice(0, 10);
    const arg = (i) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
    if (t === MULTICALL3.toLowerCase() && sel === SEL['getEthBalance(address)']) return '0x' + word(w.native[('0x' + arg(0).slice(24)).toLowerCase()] ?? 0n);
    const tok = tokenOf(t);
    if (!tok) return null;
    if (sel === SEL['symbol()']) return '0x' + strWord(tok.symbol);
    if (sel === SEL['decimals()']) return '0x' + word(tok.decimals);
    if (sel === SEL['balanceOf(address)']) return '0x' + word(balanceOfToken(t, '0x' + arg(0).slice(24)));
    return null;
  };
  const multi = (data, who) => encodeAggregate3Output(decodeAggregate3Input(data).map((c) => {
    let r = answer(c.target, c.data);
    if (who === 'chain' && w.wrong) { const x = w.wrong(c.target, c.data); if (x !== undefined) r = x; }
    return r == null ? { success: false, data: '0x' } : { success: true, data: r };
  }));
  function simulate(tx) {
    const to = tx.to.toLowerCase();
    const from = (tx.from ?? '0x').toLowerCase();
    const tok = tokenOf(to);
    if (tok && tx.data?.startsWith(SEL['transfer(address,uint256)'])) {
      const amount = BigInt('0x' + tx.data.slice(74, 138));
      if (w.failTransfers) throw revert('paused');
      if (balanceOfToken(to, from) < amount) throw revert('ERC20: transfer amount exceeds balance', errorString('ERC20: transfer amount exceeds balance'));
      return '0x' + word(1);
    }
    if (tx.value && BigInt(tx.value) > (w.native[from] ?? 0n)) throw revert('The caller does not have enough funds for value transfer.');
    return '0x';
  }
  const chain = {
    callTool: async (name, args) => {
      calls.push({ who: 'chain', name, args });
      if (name === 'get_block_number') return { blockNumber: String(w.head) };
      if (name === 'get_block') return { number: '0x' + args.block.toString(16), timestamp: '0x' + blockTime(args.block).toString(16), hash: '0xabc' };
      if (name === 'get_gas_price') return { gasPriceWei: w.gasPriceWei.toString(), gasPriceGwei: String(Number(w.gasPriceWei) / 1e9) };
      if (name === 'get_code') return { code: w.contractWallets.has(args.address.toLowerCase()) || tokenOf(args.address) ? '0x6080' : '0x' };
      if (name === 'get_balance') return { balanceWei: (w.native[args.address.toLowerCase()] ?? 0n).toString() };
      if (name === 'estimate_gas') { simulate(args.transaction); return { gas: String(args.transaction.data?.length > 10 ? 80_000 : 21_000) }; }
      if (name === 'eth_call') {
        const tx = args.transaction;
        if (tx.to.toLowerCase() === MULTICALL3.toLowerCase()) return { result: multi(tx.data, 'chain') };
        return { result: simulate(tx) };
      }
      throw new Error(`unexpected chain tool ${name}`);
    },
  };
  const rpc = async (method, params) => {
    calls.push({ who: 'rpc', method, params });
    if (w.rpcDown) throw new Error('rate limited');
    if (method === 'eth_call') return params[0].to.toLowerCase() === MULTICALL3.toLowerCase() ? multi(params[0].data, 'rpc') : simulate(params[0]);
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_getLogs') {
      const f = params[0];
      const from = Number(BigInt(f.fromBlock));
      const to = Number(BigInt(f.toBlock));
      if (to - from + 1 > 1000) throw Object.assign(new Error('param error; The block range is too large. Consider narrowing it down to within 1,000 blocks.'), { rpc: { code: -32602 } });
      return w.logs.filter((l) => l.address === f.address.toLowerCase() && Number(BigInt(l.blockNumber)) >= from && Number(BigInt(l.blockNumber)) <= to && l.topics[1] === f.topics[1] && l.topics[2] === f.topics[2]);
    }
    if (method === 'eth_getTransactionByHash') return w.txs.get(params[0])?.tx ?? null;
    if (method === 'eth_getTransactionReceipt') return w.txs.get(params[0])?.receipt ?? null;
    throw new Error(`unexpected rpc ${method}`);
  };
  // a mined transfer (or a reverted one) from the payer to the payee, with the reference in its data
  let n = 0;
  const addTransfer = ({ block, token = USDC, from = PAYER, to = PAYEE, amount, reference = null, status = 'success', hash = null }) => {
    const h = hash ?? '0x' + (++n).toString(16).padStart(64, '0');
    const input = '0x' + SEL['transfer(address,uint256)'].slice(2) + addrWord(to) + word(amount) + referenceHex(reference);
    const log = { address: token, topics: [TRANSFER_TOPIC, '0x' + addrWord(from), '0x' + addrWord(to)], data: '0x' + word(amount), blockNumber: '0x' + block.toString(16), transactionHash: h, logIndex: '0x0' };
    w.txs.set(h, { tx: { hash: h, from, to: token, value: '0x0', input }, receipt: { transactionHash: h, status: status === 'success' ? '0x1' : '0x0', blockNumber: '0x' + block.toString(16), gasUsed: '0x13880', logs: status === 'success' ? [log] : [] } });
    if (status === 'success') w.logs.push(log);
    return h;
  };
  return { w, chain, rpc, calls, addTransfer, blockTime, tokens: TOKENS };
}
