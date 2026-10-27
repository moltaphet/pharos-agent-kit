// Whale-watching engine for Pharos mainnet (chain 1672). A watchlist of addresses, a "significant" threshold per token (and optionally in USD), and a scan of a block range that
// returns (1) the significant token moves that touch a watched address, each explained, (2) the position changes of every watched address (new, exit, bigger, smaller) from
// balances at the two ends of the range, and (3) a summary across the whole list. Reads only; public RPC (logs in windows of 1,000 blocks, balances through Multicall3).

import { formatUnits, isAddress, topicToAddress } from './abi.js';
import { FEEDS, EXPLORER } from './defi.js';
import { KNOWN, makeLabeler, shortAddress } from './labels.js';
import { MORPHO, FAROSWAP, MULTICALL3, VAULTS } from './protocols.js';
import { encodeAggregate3, decodeAggregate3 } from './multicall.js';
import { parseDecimal, TOKENS } from './payments.js';
import { publicRpc } from './onchain.js';
import { UserError } from './snapshot.js';
import { selectorOf } from './keccak.js';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const MAX_RANGE = 2000;
export const MAX_WATCH = 25;
const BALANCE_OF = selectorOf('balanceOf(address)');
const ETH_BALANCE = selectorOf('getEthBalance(address)'); // Multicall3 reports a native balance
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const hex = (n) => '0x' + n.toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const explorerTx = (h) => `${EXPLORER}/tx/${h}`;
export const explorerAddress = (a) => `${EXPLORER}/address/${a}`;

const PROTOCOL_LABELS = {
  [MORPHO.address.toLowerCase()]: 'Morpho Blue (lending core)',
  [FAROSWAP.v2Factory.toLowerCase()]: 'FaroSwap V2 factory',
  [FAROSWAP.v3Factory.toLowerCase()]: 'FaroSwap V3 factory',
  ...Object.fromEntries(VAULTS.map((v) => [v.address.toLowerCase(), `${v.name} (vault)`])),
};

// ---- configuration ------------------------------------------------------------------------------------------------------------------------

const SYMBOLS = [{ symbol: 'PROS', native: true, decimals: 18 }, ...TOKENS.filter((t) => !t.native)];
export function validateConfig(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new UserError('config must be an object with "watch" and "thresholds"');
  const watch = input.watch;
  if (!Array.isArray(watch) || watch.length < 1 || watch.length > MAX_WATCH) throw new UserError(`watch must list 1 to ${MAX_WATCH} addresses`);
  const seen = new Set();
  const list = watch.map((w, i) => {
    const address = typeof w === 'string' ? w : w?.address;
    if (!isAddress(address)) throw new UserError(`watch entry ${i + 1} is not an address`);
    const a = address.toLowerCase();
    if (seen.has(a)) throw new UserError(`watch entry ${i + 1} repeats ${shortAddress(a)}`);
    seen.add(a);
    return { address: a, label: String(w?.label ?? '').slice(0, 60) || shortAddress(a) };
  });
  const th = input.thresholds;
  if (th === null || typeof th !== 'object' || Array.isArray(th) || Object.keys(th).length === 0) throw new UserError('thresholds must set at least one token, like {"USDC": "10000"}');
  const thresholds = {};
  for (const [symbol, amount] of Object.entries(th)) {
    const t = SYMBOLS.find((s) => s.symbol === symbol.toUpperCase());
    if (!t) throw new UserError(`threshold token ${symbol} is not one of ${SYMBOLS.map((s) => s.symbol).join(', ')}`);
    const raw = parseDecimal(amount, t.decimals, `${symbol} threshold`);
    if (raw === 0n) throw new UserError(`${symbol} threshold must be above zero`);
    thresholds[t.symbol] = { token: t, raw, text: String(amount) };
  }
  let usd = null;
  if (input.usdThreshold != null) { usd = parseDecimal(input.usdThreshold, 6, 'usdThreshold'); if (usd === 0n) throw new UserError('usdThreshold must be above zero'); }
  const labels = {};
  for (const [a, name] of Object.entries(input.labels ?? {})) { if (!isAddress(a)) throw new UserError('labels must be keyed by address'); labels[a.toLowerCase()] = String(name).slice(0, 60); }
  return { watch: list, thresholds, usdThreshold: usd, usdText: input.usdThreshold == null ? null : String(input.usdThreshold), labels };
}

// ---- reads --------------------------------------------------------------------------------------------------------------------------------

// The public RPC is load-balanced and has once answered from a node with other state: every snapshot is read twice, and a third time when the two differ.
async function snapshot(rpc, calls, block) {
  const read = async () => {
    const out = await rpc('eth_call', [{ to: MULTICALL3, data: encodeAggregate3(calls) }, hex(block)]);
    return decodeAggregate3(out).map((r) => (r.success && r.data.length >= 66 ? BigInt('0x' + r.data.slice(2, 66)) : null)).map((v) => (v == null ? 'x' : v.toString()));
  };
  let last = await read();
  for (let i = 0; i < 4; i++) {
    const again = await read();
    if (again.join() === last.join()) return again.map((v) => (v === 'x' ? null : BigInt(v)));
    last = again;
    await sleep(600);
  }
  throw new Error(`balances at block ${block} differ between reads (a node behind the others); try again in a moment`);
}

async function balancesAt(rpc, config, block) {
  const calls = [];
  const index = [];
  for (const w of config.watch) {
    for (const sym of Object.keys(config.thresholds)) {
      const t = config.thresholds[sym].token;
      calls.push(t.native ? { target: MULTICALL3, data: ETH_BALANCE + addrWord(w.address) } : { target: t.address, data: BALANCE_OF + addrWord(w.address) });
      index.push([w.address, sym]);
    }
  }
  const out = {};
  for (let i = 0; i < calls.length; i += 100) {
    const values = await snapshot(rpc, calls.slice(i, i + 100), block);
    values.forEach((v, j) => { const [a, s] = index[i + j]; (out[a] ??= {})[s] = v; });
  }
  return out;
}

async function logsFor(rpc, token, watch, from, to) {
  const topics = watch.map((w) => '0x' + addrWord(w.address));
  const out = new Map();
  for (let a = from; a <= to; a += 1000) {
    const b = Math.min(a + 999, to);
    for (const filter of [[TRANSFER_TOPIC, null, topics], [TRANSFER_TOPIC, topics]]) {
      for (const l of await rpc('eth_getLogs', [{ address: token.address, topics: filter, fromBlock: hex(a), toBlock: hex(b) }])) if (!l.removed && l.topics.length === 3) out.set(`${l.transactionHash}:${Number(BigInt(l.logIndex))}`, l);
    }
  }
  return [...out.values()];
}

async function priceUsd(rpc, block) {
  const read = async (feed) => BigInt(await rpc('eth_call', [{ to: FEEDS[feed].address, data: '0x50d25bcd' }, hex(block)])); // latestAnswer(), 18 decimals
  return { PROS: await read('PROS/USD'), WPROS: null, USDC: 10n ** 18n };
}
const usdOf = (sym, raw, decimals, prices) => { const p = sym === 'WPROS' ? prices.PROS : prices[sym]; return p == null ? null : (raw * p * 1_000_000n) / (10n ** BigInt(decimals) * 10n ** 18n); }; // micro-USD
const fmtUsd = (micro) => `$${formatUnits(micro, 6, 2)}`;

// ---- the scan -----------------------------------------------------------------------------------------------------------------------------

export async function scanWhales({ rpc = publicRpc, config, from, to, head = null }) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new UserError('from/to must be block numbers with 1 <= from <= to');
  if (to - from + 1 > MAX_RANGE) throw new UserError(`a scan covers at most ${MAX_RANGE.toLocaleString('en-US')} blocks (about ${Math.round(MAX_RANGE * 0.92 / 60)} minutes of chain time)`);
  const tip = head ?? Number(BigInt(await rpc('eth_blockNumber', [])));
  if (to > tip) throw new UserError(`block ${to} is beyond the chain head ${tip}`);
  const labelOf = makeLabeler({ ...PROTOCOL_LABELS, ...config.labels });
  const watched = new Map(config.watch.map((w) => [w.address, w.label]));
  const prices = await priceUsd(rpc, to);
  const before = await balancesAt(rpc, config, from - 1);
  const after = await balancesAt(rpc, config, to);

  // 1. moves: token transfers that touch a watched address and are significant
  const codeCache = new Map();
  const kindOf = async (a) => {
    if (!codeCache.has(a)) codeCache.set(a, rpc('eth_getCode', [a, 'latest']).then((c) => (c && c !== '0x' ? 'contract' : 'wallet')));
    return codeCache.get(a);
  };
  const moves = [];
  for (const [sym, { token, raw }] of Object.entries(config.thresholds)) {
    if (token.native) continue;
    for (const l of await logsFor(rpc, token, config.watch, from, to)) {
      const value = BigInt(l.data);
      const a = topicToAddress(l.topics[1]);
      const b = topicToAddress(l.topics[2]);
      const usd = usdOf(sym, value, token.decimals, prices);
      const bySize = value >= raw;
      const byUsd = config.usdThreshold != null && usd != null && usd >= config.usdThreshold;
      if (!bySize && !byUsd) continue;
      moves.push({ key: `${l.transactionHash}:${Number(BigInt(l.logIndex))}`, block: Number(BigInt(l.blockNumber)), txHash: l.transactionHash, token: sym, decimals: token.decimals, from: a, to: b, value, usd, trigger: bySize ? 'amount' : 'usd' });
    }
  }
  moves.sort((x, y) => x.block - y.block || x.key.localeCompare(y.key));

  // explain each move: who, how much, where to, and why it matters
  const explained = [];
  for (const m of moves) {
    const watchedSide = [m.from, m.to].filter((x) => watched.has(x));
    const outgoing = watched.has(m.from);
    const subject = outgoing ? m.from : m.to;
    const counter = outgoing ? m.to : m.from;
    const name = (a) => watched.get(a) ?? labelOf(a) ?? (KNOWN[a] ?? null);
    const counterName = watched.get(counter) ?? labelOf(counter) ?? null;
    const counterKind = counterName ? null : await kindOf(counter);
    const amountText = `${formatUnits(m.value, m.decimals)} ${m.token}`;
    const worth = m.usd != null ? ` (about ${fmtUsd(m.usd)})` : '';
    const subjectBefore = before[subject]?.[m.token];
    const heldBeforeMove = subjectBefore; // balance at the start of the scan; the share below is therefore approximate
    const why = [];
    if (watchedSide.length === 2) why.push('Both sides are on your watchlist: money moved between two watched wallets, so it does not leave the group.');
    if (outgoing && heldBeforeMove > 0n && m.value * 100n >= heldBeforeMove) why.push(`It is about ${Number((m.value * 10000n) / heldBeforeMove) / 100}% of the ${m.token} this wallet held at the start of the scan.`);
    if (!outgoing && heldBeforeMove === 0n) why.push(`The wallet held no ${m.token} before; this is a new position.`);
    if (counter === '0x0000000000000000000000000000000000000000') why.push(outgoing ? 'Sent to the null address: the tokens were burned.' : 'Came from the null address: the tokens were minted.');
    else if (counterName && !watched.has(counter) && PROTOCOL_LABELS[counter]) why.push(`${counterName} is a known protocol contract: this is ${outgoing ? 'a deposit into' : 'a withdrawal from'} it.`);
    else if (!counterName && counterKind === 'contract') why.push('The counterparty is a smart contract that is not labelled; it may be a protocol, a vault or a multisig.');
    else if (!counterName && counterKind === 'wallet') why.push('The counterparty is an ordinary unlabelled wallet.');
    explained.push({ ...m, value: m.value.toString(), usd: m.usd == null ? null : m.usd.toString(), direction: watchedSide.length === 2 ? 'between watched' : outgoing ? 'out' : 'in', subject, subjectLabel: watched.get(subject),
      counterparty: counter, counterpartyLabel: counterName, counterpartyKind: counterName ? (watched.has(counter) ? 'watched wallet' : PROTOCOL_LABELS[counter] ? 'protocol' : 'known address') : counterKind,
      what: `${name(subject) ?? shortAddress(subject)} ${outgoing ? 'sent' : 'received'} ${amountText}${worth} ${outgoing ? 'to' : 'from'} ${counterName ?? shortAddress(counter)}`,
      why, link: explorerTx(m.txHash) });
  }

  // 2. position changes from the balances at the two ends
  const positions = [];
  for (const w of config.watch) {
    for (const [sym, { token, raw }] of Object.entries(config.thresholds)) {
      const b0 = before[w.address]?.[sym]; const b1 = after[w.address]?.[sym];
      if (b0 == null || b1 == null) continue;
      const delta = b1 - b0;
      const abs = delta < 0n ? -delta : delta;
      const usd = usdOf(sym, abs, token.decimals, prices);
      const significant = abs >= raw || (config.usdThreshold != null && usd != null && usd >= config.usdThreshold);
      const kind = b0 === 0n && b1 > 0n ? 'new position' : b0 > 0n && b1 === 0n ? 'exit' : delta > 0n ? 'increase' : delta < 0n ? 'decrease' : 'unchanged';
      positions.push({ address: w.address, label: w.label, token: sym, decimals: token.decimals, before: b0.toString(), after: b1.toString(), delta: delta.toString(), usd: usd == null ? null : usd.toString(), kind, significant,
        pct: b0 > 0n ? Number((delta * 10000n) / b0) / 100 : null,
        what: `${w.label}: ${kind === 'unchanged' ? `${sym} unchanged` : `${sym} ${kind}, ${delta > 0n ? '+' : '−'}${formatUnits(abs, token.decimals)} ${sym}${usd != null ? ` (about ${fmtUsd(usd)})` : ''}`}`,
        ...(token.native && { note: 'native PROS is read as a balance change over the range: it includes gas, so it is a net figure, not a list of transfers' }) });
    }
  }

  // 3. the summary across the list
  const perWallet = config.watch.map((w) => {
    const mine = explained.filter((m) => m.subject === w.address || m.counterparty === w.address);
    const changes = positions.filter((p) => p.address === w.address && p.significant);
    let inUsd = 0n; let outUsd = 0n;
    for (const m of explained) {
      if (m.usd == null) continue;
      if (m.to === w.address) inUsd += BigInt(m.usd);
      if (m.from === w.address) outUsd += BigInt(m.usd);
    }
    return { address: w.address, label: w.label, significantMoves: mine.length, inUsd: inUsd.toString(), outUsd: outUsd.toString(), netUsd: (inUsd - outUsd).toString(), positionChanges: changes.map((p) => `${p.token} ${p.kind}`), active: mine.length > 0 || changes.length > 0 };
  });
  const biggest = [...explained].filter((m) => m.usd != null).sort((x, y) => (BigInt(y.usd) > BigInt(x.usd) ? 1 : -1))[0] ?? null;
  const summary = {
    window: [from, to], head: tip, watched: config.watch.length, significantMoves: explained.length, walletsActive: perWallet.filter((p) => p.active).length,
    positionChanges: positions.filter((p) => p.significant).length, biggest: biggest ? { what: biggest.what, link: biggest.link, usd: biggest.usd } : null,
    byToken: Object.fromEntries(Object.keys(config.thresholds).map((s) => [s, { moves: explained.filter((m) => m.token === s).length, positionChanges: positions.filter((p) => p.token === s && p.significant).length }])),
    perWallet,
  };
  return { window: [from, to], prices: { PROS: prices.PROS.toString() }, moves: explained, positions, summary };
}

export { sleep };
