// Audit-log agent for Pharos mainnet: a plain-language activity report for one wallet over a date range, in the four groups an accountant asks for: transfers in and out, swaps,
// approvals and contract interactions, with totals per group, notable transactions with explorer links, and exports as Markdown, CSV and PDF.
// Everything comes from the chain through the public RPC in batches: token Transfer and Approval logs filtered on the wallet (the only per-address index the node offers), then each
// transaction and receipt behind them. What the node cannot index (a plain PROS transfer, a call that touched none of the wallet's tokens) is reported as a count, not guessed.

import { formatUnits, isAddress, topicToAddress } from './abi.js';
import { FEEDS, EXPLORER } from './defi.js';
import { keccak256, selectorOf } from './keccak.js';
import { KNOWN, makeLabeler, shortAddress } from './labels.js';
import { MORPHO, VAULTS, FAROSWAP } from './protocols.js';
import { TOKENS } from './payments.js';
import { batchRpc, batchRpcStrict } from './rpc-batch.js';
import { PHAROS_RPC } from './rpc.js';
import { UserError } from './snapshot.js';

export const MAX_DAYS = 7;
export const MAX_TXS = 600;
const topic = (sig) => '0x' + keccak256(Buffer.from(sig));
const TRANSFER = topic('Transfer(address,address,uint256)');
const APPROVAL = topic('Approval(address,address,uint256)');
const SWAP_V2 = topic('Swap(address,uint256,uint256,uint256,uint256,address)');
const SWAP_V3 = topic('Swap(address,address,int256,int256,uint160,uint128,int24)');
const MAX_UINT_HALF = 1n << 255n;
const hex = (n) => '0x' + n.toString(16);
const word = (a) => '0x' + a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const num = (h) => Number(BigInt(h));
const iso = (t) => new Date(t * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
export const explorerTx = (h) => `${EXPLORER}/tx/${h}`;

const METHODS = Object.fromEntries([
  'transfer(address,uint256)', 'transferFrom(address,address,uint256)', 'approve(address,uint256)', 'deposit()', 'deposit(uint256)', 'deposit(uint256,address)', 'withdraw(uint256)', 'withdraw(uint256,address,address)', 'redeem(uint256,address,address)',
  'mint(address,uint256)', 'claim()', 'multicall(bytes[])', 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)', 'swapExactETHForTokens(uint256,address[],address,uint256)',
  'swapExactTokensForETH(uint256,uint256,address[],address,uint256)', 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', 'supply((address,address,address,address,uint256),uint256,uint256,address,bytes)',
  'withdraw((address,address,address,address,uint256),uint256,uint256,address,address)', 'borrow((address,address,address,address,uint256),uint256,uint256,address,address)', 'repay((address,address,address,address,uint256),uint256,uint256,address,bytes)',
  'supplyCollateral((address,address,address,address,uint256),uint256,address,bytes)', 'withdrawCollateral((address,address,address,address,uint256),uint256,address,address)', 'aggregate3((address,bool,bytes)[])', 'execute(bytes,bytes[],uint256)', 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
].map((s) => [selectorOf(s), s.split('(')[0]]));
const SWAP_METHODS = new Set(['swapExactTokensForTokens', 'swapTokensForExactTokens', 'swapExactETHForTokens', 'swapExactTokensForETH', 'exactInputSingle']);
const labelOf = makeLabeler({
  [MORPHO.address.toLowerCase()]: 'Morpho Blue', [FAROSWAP.v2Factory.toLowerCase()]: 'FaroSwap V2 factory', [FAROSWAP.v3Factory.toLowerCase()]: 'FaroSwap V3 factory',
  ...Object.fromEntries(VAULTS.map((v) => [v.address.toLowerCase(), v.name])),
});

// ---- dates and blocks ---------------------------------------------------------------------------------------------------------------------

/** "2026-10-20" or "2026-10-20T14:30" (UTC) → unix seconds. A date-only end means the end of that day. */
export function parseWhen(text, { endOfDay = false } = {}) {
  const s = String(text ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(s);
  if (!m) throw new UserError(`"${s}" is not a date: use YYYY-MM-DD or YYYY-MM-DDTHH:MM (UTC)`);
  const [, y, mo, d, h, mi] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +(h ?? 0) > 23 || +(mi ?? 0) > 59) throw new UserError(`"${s}" is not a real date`);
  let t = Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0)) / 1000;
  if (new Date(t * 1000).getUTCDate() !== +d) throw new UserError(`"${s}" is not a real date`);
  if (endOfDay && h == null) t += 86_400 - 1;
  return t;
}

async function headerAt(rpc, n) { const b = await rpc('eth_getBlockByNumber', [hex(n), false]); return { number: n, time: num(b.timestamp) }; }

/** The first block whose timestamp is >= `ts` (clamped to the chain head). */
export async function blockAtOrAfter(rpc, ts, head) {
  let lo = 1; let hi = head.number;
  if (ts >= head.time) return head.number;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if ((await headerAt(rpc, mid)).time >= ts) hi = mid; else lo = mid + 1; }
  return lo;
}

// one slow answer must not sink a search of dozens of reads
const retrying = (rpc) => async (m, p) => { for (let i = 0; ; i++) { try { return await rpc(m, p); } catch (err) { if (i >= 3) throw err; await new Promise((r) => setTimeout(r, 700 * (i + 1))); } } };

export async function resolveRange({ rpc: rawRpc, from, to, maxDays = MAX_DAYS }) {
  const rpc = retrying(rawRpc);
  const a = parseWhen(from); const b = parseWhen(to, { endOfDay: true });
  if (b <= a) throw new UserError('the end of the range must be after its start');
  if (b - a > maxDays * 86_400) throw new UserError(`a report covers at most ${maxDays} days; split a longer period into several`);
  const n = num(await rpc('eth_blockNumber', [])) - 2;
  const head = await headerAt(rpc, n);
  if (a > head.time) throw new UserError('the range starts in the future');
  const fromBlock = await blockAtOrAfter(rpc, a, head);
  const toBlock = b >= head.time ? head.number : (await blockAtOrAfter(rpc, b + 1, head)) - 1;
  if (toBlock < fromBlock) throw new UserError('no blocks in that range');
  const [f, t] = await Promise.all([headerAt(rpc, fromBlock), headerAt(rpc, toBlock)]);
  return { fromBlock, toBlock, fromTime: f.time, toTime: t.time, requested: { from: iso(a), to: iso(b) }, blocks: toBlock - fromBlock + 1, clamped: b > head.time };
}

// ---- collecting ---------------------------------------------------------------------------------------------------------------------------

async function tokenMeta(url, addresses) {
  const meta = new Map();
  for (const t of TOKENS.filter((x) => !x.native)) meta.set(t.address, { symbol: t.symbol, decimals: t.decimals });
  const unknown = [...new Set(addresses)].filter((a) => !meta.has(a));
  if (unknown.length) {
    const rows = await batchRpc(unknown.flatMap((a) => [{ method: 'eth_call', params: [{ to: a, data: selectorOf('symbol()') }, 'latest'] }, { method: 'eth_call', params: [{ to: a, data: selectorOf('decimals()') }, 'latest'] }]), { url });
    unknown.forEach((a, i) => {
      const s = rows[2 * i]; const d = rows[2 * i + 1];
      let symbol = shortAddress(a);
      if (s.ok && s.result.length > 130) { const len = Number(BigInt('0x' + s.result.slice(66, 130))); if (len > 0 && len < 32) symbol = Buffer.from(s.result.slice(130, 130 + len * 2), 'hex').toString('utf8').replace(/[^\x20-\x7e]/g, '') || symbol; }
      else if (s.ok && s.result.length === 66) symbol = Buffer.from(s.result.slice(2), 'hex').toString('utf8').replace(/\0+$/, '').replace(/[^\x20-\x7e]/g, '') || symbol;
      meta.set(a, { symbol: symbol.slice(0, 12), decimals: d.ok && d.result.length >= 66 ? Number(BigInt(d.result.slice(0, 66))) : 18, unverifiedToken: !TOKENS.some((t) => t.address === a) });
    });
  }
  return meta;
}

const usdValue = (symbol, raw, decimals, prosUsd) => {
  if (symbol === 'USDC') return Number(raw) / 10 ** decimals;
  if ((symbol === 'WPROS' || symbol === 'PROS') && prosUsd != null) return (Number(raw) / 10 ** decimals) * prosUsd;
  return null;
};

/**
 * Collect and classify a wallet's activity in [fromBlock, toBlock]. `rpcUrl` is a public RPC that answers JSON-RPC batches.
 */
export async function buildReport({ wallet, fromBlock, toBlock, fromTime = null, toTime = null, rpcUrl = PHAROS_RPC, labels = {}, now = () => new Date() }) {
  if (!isAddress(wallet)) throw new UserError('wallet must be a 0x… address of 40 hex digits');
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || toBlock < fromBlock) throw new UserError('fromBlock/toBlock must be block numbers with from <= to');
  if (toBlock - fromBlock + 1 > MAX_DAYS * 95_000) throw new UserError(`that is more than ${MAX_DAYS} days of blocks`);
  const w = wallet.toLowerCase();
  const label = (a) => labels[a.toLowerCase()] ?? labelOf(a) ?? KNOWN[a.toLowerCase()] ?? null;
  const who = (a) => (label(a) ? `${label(a)} (${shortAddress(a)})` : shortAddress(a));
  const batch = (reqs) => batchRpcStrict(reqs, { url: rpcUrl });

  // 1. the wallet's token logs, in windows of 1,000 blocks (the node's limit), all windows in a few batches
  const windows = [];
  for (let a = fromBlock; a <= toBlock; a += 1000) windows.push([a, Math.min(a + 999, toBlock)]);
  const filters = [[TRANSFER, word(w)], [TRANSFER, null, word(w)], [APPROVAL, word(w)]];
  const reqs = windows.flatMap(([a, b]) => filters.map((topics) => ({ method: 'eth_getLogs', params: [{ topics, fromBlock: hex(a), toBlock: hex(b) }] })));
  const logs = new Map();
  for (const l of (await batch(reqs)).flat()) if (!l.removed) logs.set(`${l.transactionHash}:${num(l.logIndex)}`, l);
  const byTx = new Map();
  for (const l of logs.values()) (byTx.get(l.transactionHash) ?? byTx.set(l.transactionHash, []).get(l.transactionHash)).push(l);
  const hashes = [...byTx.keys()];
  const notes = [];
  const tooMany = hashes.length > MAX_TXS;
  if (tooMany) notes.push(`The wallet touched ${hashes.length} transactions in this range; the ${MAX_TXS} most recent are classified in full. Narrow the range for the rest.`);
  const used = tooMany ? hashes.sort((x, y) => num(byTx.get(y)[0].blockNumber) - num(byTx.get(x)[0].blockNumber)).slice(0, MAX_TXS) : hashes;

  // 2. the transactions, their receipts, the block times, the token symbols, the price and the wallet's balances at both ends
  const [txs, receipts] = await Promise.all([
    batch(used.map((h) => ({ method: 'eth_getTransactionByHash', params: [h] }))),
    batch(used.map((h) => ({ method: 'eth_getTransactionReceipt', params: [h] }))),
  ]);
  const blockNums = [...new Set(used.map((h) => num(byTx.get(h)[0].blockNumber)))];
  const blocks = await batch(blockNums.map((n) => ({ method: 'eth_getBlockByNumber', params: [hex(n), false] })));
  const timeOf = new Map(blockNums.map((n, i) => [n, num(blocks[i].timestamp)]));
  const meta = await tokenMeta(rpcUrl, [...logs.values()].map((l) => l.address.toLowerCase()));
  const [price, balStart, balEnd, nonceStart, nonceEnd] = await batch([
    { method: 'eth_call', params: [{ to: FEEDS['PROS/USD'].address, data: '0x50d25bcd' }, hex(toBlock)] },
    { method: 'eth_getBalance', params: [w, hex(Math.max(0, fromBlock - 1))] }, { method: 'eth_getBalance', params: [w, hex(toBlock)] },
    { method: 'eth_getTransactionCount', params: [w, hex(Math.max(0, fromBlock - 1))] }, { method: 'eth_getTransactionCount', params: [w, hex(toBlock)] },
  ]);
  const prosUsd = Number(BigInt(price)) / 1e18;

  // 3. classify each transaction
  const events = [];
  let feesWei = 0n; let sentFound = 0;
  used.forEach((hash, i) => {
    const tx = txs[i]; const rc = receipts[i];
    if (!tx || !rc) { notes.push(`Transaction ${hash} could not be read and was left out.`); return; }
    const mine = byTx.get(hash);
    const block = num(rc.blockNumber); const time = timeOf.get(block);
    const sender = tx.from.toLowerCase(); const to = tx.to?.toLowerCase() ?? null;
    const selector = tx.input.slice(0, 10).toLowerCase();
    const method = METHODS[selector] ?? (tx.input === '0x' ? 'plain PROS transfer' : `unknown method ${selector}`);
    const outs = []; const ins = []; const approvals = [];
    for (const l of mine) {
      const token = l.address.toLowerCase(); const m = meta.get(token);
      if (l.topics[0] === APPROVAL) { const value = BigInt(l.data); approvals.push({ token, symbol: m.symbol, spender: topicToAddress(l.topics[2]), value, unlimited: value >= MAX_UINT_HALF, decimals: m.decimals }); continue; }
      if (l.topics.length !== 3) continue; // ERC-721 Transfer
      const value = BigInt(l.data); const from = topicToAddress(l.topics[1]); const toAddr = topicToAddress(l.topics[2]);
      const row = { token, symbol: m.symbol, decimals: m.decimals, value, usd: usdValue(m.symbol, value, m.decimals, prosUsd), counterparty: from === w ? toAddr : from, unverifiedToken: Boolean(m.unverifiedToken) };
      if (from === w && toAddr === w) continue;
      (from === w ? outs : ins).push(row);
    }
    const walletSent = sender === w;
    if (walletSent) { sentFound++; feesWei += BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice ?? 0); }
    const swapLog = rc.logs.some((l) => l.topics[0] === SWAP_V2 || l.topics[0] === SWAP_V3);
    const swapped = outs.length && ins.length && new Set([...outs, ...ins].map((x) => x.token)).size > 1;
    const base = { hash, block, time, link: explorerTx(hash), method, to, toLabel: to ? label(to) : null, failed: rc.status !== '0x1', initiatedByWallet: walletSent };
    const add = (category, direction, extra) => events.push({ ...base, category, direction, ...extra });
    if (swapped || (swapLog && (outs.length || ins.length) && (SWAP_METHODS.has(method) || swapped))) {
      const o = outs[0]; const n = ins[0];
      add('swap', null, { out: o ? { symbol: o.symbol, amount: formatUnits(o.value, o.decimals), raw: o.value.toString(), usd: o.usd } : null, in: n ? { symbol: n.symbol, amount: formatUnits(n.value, n.decimals), raw: n.value.toString(), usd: n.usd } : null, usd: o?.usd ?? n?.usd ?? null,
        summary: `Swapped ${o ? `${formatUnits(o.value, o.decimals)} ${o.symbol}` : '?'} for ${n ? `${formatUnits(n.value, n.decimals)} ${n.symbol}` : '?'} via ${to ? who(to) : 'a contract'}` });
    } else if (walletSent && !['transfer', 'transferFrom', 'approve'].includes(method) && to && !meta.has(to)) {
      const moved = [...outs.map((x) => `sent ${formatUnits(x.value, x.decimals)} ${x.symbol}`), ...ins.map((x) => `received ${formatUnits(x.value, x.decimals)} ${x.symbol}`)];
      add('contract interaction', null, { usd: [...outs, ...ins].map((x) => x.usd).filter((v) => v != null).sort((a, b) => b - a)[0] ?? null, summary: `Called ${method} on ${who(to)}${moved.length ? `: ${moved.join(', ')}` : ''}`, moved });
    } else {
      for (const x of outs) add('transfer', 'out', { token: x.symbol, amount: formatUnits(x.value, x.decimals), raw: x.value.toString(), decimals: x.decimals, usd: x.usd, counterparty: x.counterparty, summary: `Sent ${formatUnits(x.value, x.decimals)} ${x.symbol} to ${who(x.counterparty)}`, unverifiedToken: x.unverifiedToken });
      for (const x of ins) add('transfer', 'in', { token: x.symbol, amount: formatUnits(x.value, x.decimals), raw: x.value.toString(), decimals: x.decimals, usd: x.usd, counterparty: x.counterparty, summary: `Received ${formatUnits(x.value, x.decimals)} ${x.symbol} from ${who(x.counterparty)}`, unverifiedToken: x.unverifiedToken });
    }
    for (const a of approvals) add('approval', null, { token: a.symbol, spender: a.spender, amount: a.unlimited ? 'unlimited' : formatUnits(a.value, a.decimals), raw: a.value.toString(), unlimited: a.unlimited, summary: `${a.value === 0n ? 'Revoked' : 'Approved'} ${who(a.spender)} to spend ${a.unlimited ? 'an unlimited amount of' : a.value === 0n ? '' : `${formatUnits(a.value, a.decimals)}`} ${a.symbol}`.replace(/\s+/g, ' ').trim() });
  });
  events.sort((x, y) => x.block - y.block || x.hash.localeCompare(y.hash));

  // 4. totals and notable transactions
  const cats = ['transfer', 'swap', 'approval', 'contract interaction'];
  const totals = {};
  for (const c of cats) {
    const e = events.filter((x) => x.category === c);
    totals[c] = { count: e.length, transactions: new Set(e.map((x) => x.hash)).size };
  }
  const sum = (e) => e.reduce((s, x) => s + (x.usd ?? 0), 0);
  const tin = events.filter((x) => x.category === 'transfer' && x.direction === 'in'); const tout = events.filter((x) => x.category === 'transfer' && x.direction === 'out');
  totals.transfer.in = { count: tin.length, usd: sum(tin) }; totals.transfer.out = { count: tout.length, usd: sum(tout) };
  totals.swap.usd = sum(events.filter((x) => x.category === 'swap'));
  totals.approval.unlimited = events.filter((x) => x.category === 'approval' && x.unlimited).length;
  totals.approval.revoked = events.filter((x) => x.category === 'approval' && x.raw === '0').length;
  const perToken = {};
  for (const x of events.filter((e) => e.category === 'transfer')) { const t = (perToken[x.token] ??= { in: 0n, out: 0n, decimals: x.decimals }); t[x.direction] += BigInt(x.raw); }
  totals.transfer.perToken = Object.fromEntries(Object.entries(perToken).map(([s, t]) => [s, { in: formatUnits(t.in, t.decimals), out: formatUnits(t.out, t.decimals) }]));
  const notable = [];
  const byUsd = [...events].filter((x) => x.usd != null).sort((a, b) => b.usd - a.usd);
  const seen = new Set();
  for (const x of byUsd) { if (notable.length >= 5) break; if (seen.has(x.hash)) continue; seen.add(x.hash); notable.push({ ...x, why: `One of the largest movements of value in the period (about $${x.usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}).` }); }
  for (const x of events.filter((e) => e.unlimited && !seen.has(e.hash)).slice(0, 3)) { seen.add(x.hash); notable.push({ ...x, why: 'An unlimited approval: the spender can move any amount of this token until it is revoked.' }); }
  for (const x of events.filter((e) => e.unverifiedToken && !seen.has(e.hash)).slice(0, 2)) { seen.add(x.hash); notable.push({ ...x, why: 'A token that is not in the Pharos token registry; check what it is before relying on its value.' }); }
  for (const x of events.filter((e) => e.failed && !seen.has(e.hash)).slice(0, 3)) { seen.add(x.hash); notable.push({ ...x, why: 'The transaction failed on-chain; the fee was still paid.' }); }

  const sentTotal = num(nonceEnd) - num(nonceStart);
  if (sentTotal > sentFound) notes.push(`The wallet sent ${sentTotal} transaction${sentTotal === 1 ? '' : 's'} in this period; ${sentFound} of them involved its tokens and are listed. The other ${sentTotal - sentFound} (for example plain PROS transfers) leave no token log and cannot be listed from the node's indexes.`);
  if (hashes.length === 0) notes.push('No token transfers or approvals involving this wallet were found in the period.');
  const report = {
    wallet: w, walletLabel: label(w), chain: 'Pharos mainnet (1672)', generatedAt: now().toISOString(), fromBlock, toBlock, fromTime, toTime, blocks: toBlock - fromBlock + 1,
    native: { symbol: 'PROS', balanceStart: balStart, balanceEnd: balEnd, change: (BigInt(balEnd) - BigInt(balStart)).toString(), sentTransactions: sentTotal, sentWithTokenActivity: sentFound, feesPaidWei: feesWei.toString(), prosUsd },
    totals, events, notable, notes, source: 'Pharos mainnet public RPC: token Transfer/Approval logs filtered on the wallet, then each transaction and receipt',
  };
  return report;
}

// ---- exports ------------------------------------------------------------------------------------------------------------------------------

const usd = (v) => (v == null ? '—' : `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const pros = (wei) => formatUnits(BigInt(wei < 0 ? -wei : wei), 18, 6);

export function toMarkdown(r) {
  const t = r.totals; const out = [];
  out.push(`# Activity report for ${r.walletLabel ? `${r.walletLabel} ` : ''}${r.wallet}`, '');
  out.push(`**Network:** ${r.chain}  `, `**Period:** ${r.fromTime ? iso(r.fromTime) : `block ${r.fromBlock}`} to ${r.toTime ? iso(r.toTime) : `block ${r.toBlock}`} (blocks ${r.fromBlock.toLocaleString('en-US')}–${r.toBlock.toLocaleString('en-US')})  `, `**Generated:** ${r.generatedAt}  `, `**Source:** ${r.source}`, '');
  out.push('## Summary', '');
  const nTx = new Set(r.events.map((e) => e.hash)).size;
  out.push(`In this period the wallet appears in ${nTx} transaction${nTx === 1 ? '' : 's'}: ${t.transfer.in.count} incoming and ${t.transfer.out.count} outgoing token transfer${t.transfer.in.count + t.transfer.out.count === 1 ? '' : 's'}, ${t.swap.count} swap${t.swap.count === 1 ? '' : 's'}, ${t.approval.count} approval${t.approval.count === 1 ? '' : 's'} and ${t['contract interaction'].count} other contract interaction${t['contract interaction'].count === 1 ? '' : 's'}. `
    + `Its native PROS balance went from ${pros(BigInt(r.native.balanceStart))} to ${pros(BigInt(r.native.balanceEnd))} PROS; fees paid on the transactions it sent and that are listed: ${pros(BigInt(r.native.feesPaidWei))} PROS.`, '');
  out.push('| Category | Events | Value (USD, where priced) |', '|---|---:|---:|');
  out.push(`| Transfers in | ${t.transfer.in.count} | ${usd(t.transfer.in.usd)} |`, `| Transfers out | ${t.transfer.out.count} | ${usd(t.transfer.out.usd)} |`, `| Swaps | ${t.swap.count} | ${usd(t.swap.usd)} |`);
  out.push(`| Approvals | ${t.approval.count} | ${t.approval.unlimited} unlimited, ${t.approval.revoked} revoked |`, `| Contract interactions | ${t['contract interaction'].count} | |`, '');
  if (Object.keys(t.transfer.perToken).length) { out.push('### Token transfers by token', '', '| Token | Received | Sent |', '|---|---:|---:|', ...Object.entries(t.transfer.perToken).map(([s, v]) => `| ${s} | ${v.in} | ${v.out} |`), ''); }
  if (r.notable.length) { out.push('## Notable transactions', '', ...r.notable.map((n) => `- **${n.summary}** — ${n.why} Block ${n.block.toLocaleString('en-US')}, ${n.time ? iso(n.time) : ''}. [Transaction](${n.link})`), ''); }
  const section = (title, cat) => {
    const e = r.events.filter((x) => x.category === cat);
    out.push(`## ${title}`, '');
    if (!e.length) { out.push('None in this period.', ''); return; }
    out.push('| Time (UTC) | What happened | Value | Transaction |', '|---|---|---:|---|', ...e.map((x) => `| ${x.time ? iso(x.time).replace(' UTC', '') : x.block} | ${x.summary}${x.failed ? ' (FAILED)' : ''} | ${usd(x.usd)} | [${x.hash.slice(0, 10)}…](${x.link}) |`), '');
  };
  section('Transfers', 'transfer'); section('Swaps', 'swap'); section('Approvals', 'approval'); section('Contract interactions', 'contract interaction');
  if (r.notes.length) out.push('## Notes and limits', '', ...r.notes.map((n) => `- ${n}`), '');
  out.push('_Values in USD use USDC at $1 and PROS/WPROS at the PROS/USD feed price at the end of the period (' + r.native.prosUsd.toFixed(4) + '); other tokens are not priced._', '');
  return out.join('\n');
}

const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // a leading = + - @ would run as a formula in a spreadsheet: it is made text first, then quoted if needed
export function toCsv(r) {
  const head = ['time_utc', 'block', 'category', 'direction', 'what_happened', 'token', 'amount', 'usd_estimate', 'counterparty_or_spender', 'method', 'failed', 'transaction', 'link'];
  const rows = r.events.map((x) => [x.time ? iso(x.time).replace(' UTC', '') : '', x.block, x.category, x.direction ?? '', x.summary, x.token ?? x.out?.symbol ?? '', x.amount ?? '', x.usd == null ? '' : x.usd.toFixed(2), x.counterparty ?? x.spender ?? x.to ?? '', x.method, x.failed ? 'yes' : 'no', x.hash, x.link]);
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A small, valid PDF (Helvetica text only) made from the Markdown: no library. */
export function toPdf(r) {
  const lines = toMarkdown(r).split('\n').flatMap((l) => {
    const text = l.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\|/g, '  ').replace(/_/g, '').replace(/[^\x20-\x7e]/g, '?');
    const out = []; let s = text;
    while (s.length > 96) { let cut = s.lastIndexOf(' ', 96); if (cut < 40) cut = 96; out.push(s.slice(0, cut)); s = s.slice(cut).trimStart(); }
    out.push(s); return out;
  });
  const perPage = 58; const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'];
  const kids = [];
  pages.forEach((p, i) => {
    const content = `BT /F1 8 Tf 10 TL 36 806 Td ${p.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
    const pageNo = objs.length + 1;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    kids.push(pageNo);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
