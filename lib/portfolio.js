// The Portfolio Assistant: read what a wallet holds on Pharos mainnet, then answer a plain-English question about it, every number with its source.
//
//   wallet + "where is my USDC?"
//     chain  get_block_number · get_block         the block everything is read at, and its time
//     chain  Multicall3 eth_call (confirmed on the public RPC): native PROS, token balances, vault shares, price feeds
//     chain  Multicall3 eth_call: what each vault position is worth and whether it can be redeemed now
//     agent  classify the question                one of a fixed set of question types, or "I do not know how to answer that"
//     agent  answer                               text + figures, each figure pointing at the contract, the call and the block it came from
//
// Read-only: only eth_call and get_balance-style reads. The assistant has no key and cannot send anything. If it cannot read something, or the question is
// about something it does not read (a protocol it has no reader for, what you earned since you deposited), it says so instead of guessing.

import { asAddress, asInt, asUint, makeReader, publicRpc } from './onchain.js';
import { blockNumber, getBlock } from './chain.js';
import { FEEDS, NATIVE, PROTOCOL_NAMES, SEL, TOKENS, UNSUPPORTED_PROTOCOLS, VAULT_LIST, enc, explorerAddress, fmtUnits, fmtUsd, toMicroUsd } from './defi.js';
import { DEFAULT_LOOKBACK, measureYields } from './yields.js';
import { MULTICALL3 } from './protocols.js';
import { isAddress } from './abi.js';
import { tracer } from './steps.js';
import { UserError } from './snapshot.js';

const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const utc = (sec) => `${WEEK[new Date(sec * 1000).getUTCDay()]} ${new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`;

// ---- reading the wallet ----------------------------------------------------------------------------------------------------------------------
export async function readPortfolio({ chain, rpc = publicRpc, wallet, block: wantBlock = null, tr = tracer(), withYield = false, yieldAll = false, lookback = DEFAULT_LOOKBACK }) {
  const who = String(wallet ?? '').trim().toLowerCase();
  if (!isAddress(who)) throw new UserError('wallet must be a 0x address (40 hex characters)');
  const c = tr.wrap(chain, 'chain-mcp');
  tr.agent('parse-request', `Read the portfolio of ${who} on Pharos mainnet.`, { output: { wallet: who } });
  const head = await blockNumber(c, 'The latest block, so everything can be read at one block behind it');
  const pinned = wantBlock == null ? head - 2 : wantBlock;
  if (wantBlock != null && (!Number.isInteger(wantBlock) || wantBlock < 1 || wantBlock > head - 2)) throw new UserError(`block must be a whole number from 1 to ${(head - 2).toLocaleString('en-US')} (two behind the head)`);
  const header = await getBlock(c, pinned, 'The block header: its time is "now" for the age of every figure');
  const block = { number: pinned, head, historical: wantBlock != null, timestamp: header.timestamp, iso: utc(header.timestamp) };
  const reader = makeReader({ chain, rpc, tr, block: pinned });

  // ---- phase 1: balances, share balances, decimals, prices ----
  const feedNames = [...new Set([NATIVE.priceFeed, ...TOKENS.map((t) => t.priceFeed)])];
  const calls = [
    { id: 'native', target: MULTICALL3, data: SEL.getEthBalance + enc.address(who), label: 'getEthBalance(address)' },
    ...TOKENS.flatMap((t) => [
      { id: `bal:${t.symbol}`, target: t.address, data: SEL.balanceOf + enc.address(who), label: FN_LABEL.balanceOf },
      { id: `dec:${t.symbol}`, target: t.address, data: SEL.decimals, label: 'decimals()' },
    ]),
    ...VAULT_LIST.flatMap((v) => [
      { id: `bal:${v.id}`, target: v.address, data: SEL.balanceOf + enc.address(who), label: FN_LABEL.balanceOf },
      { id: `dec:${v.id}`, target: v.address, data: SEL.decimals, label: 'decimals()' },
      { id: `asset:${v.id}`, target: v.address, data: SEL.asset, label: 'asset()' },
    ]),
    ...feedNames.flatMap((f) => [
      { id: `feed:${f}`, target: FEEDS[f].address, data: SEL.latestAnswer, label: 'latestAnswer()' },
      { id: `feedts:${f}`, target: FEEDS[f].address, data: SEL.latestTimestamp, label: 'latestTimestamp()' },
    ]),
  ];
  const rows = Object.fromEntries((await reader.batch(calls, `Balances, share balances, decimals and prices for ${who.slice(0, 8)}…`)).map((r) => [r.id, r]));
  const unreadable = [];
  const prices = {};
  for (const f of feedNames) {
    const price = asInt(rows[`feed:${f}`]);
    const ts = asUint(rows[`feedts:${f}`]);
    if (price == null || price <= 0n) { unreadable.push({ what: `the ${f} price feed`, contract: FEEDS[f].address, reason: 'it did not answer latestAnswer() with a positive value, so values that need it have no dollar figure' }); continue; }
    prices[f] = { raw: price, decimals: FEEDS[f].decimals, timestamp: ts == null ? null : Number(ts), ageSec: ts == null ? null : Math.max(0, header.timestamp - Number(ts)), source: rows[`feed:${f}`].source, tsSource: rows[`feedts:${f}`]?.source };
  }
  const micro = (raw, decimals, feed) => (prices[feed] ? toMicroUsd(raw, decimals, prices[feed].raw, prices[feed].decimals) : null);

  const positions = [];
  const nativeBal = asUint(rows.native);
  if (nativeBal == null) unreadable.push({ what: 'the native PROS balance', contract: MULTICALL3, reason: 'getEthBalance did not answer' });
  else positions.push({ id: 'native', kind: 'native', protocol: null, symbol: NATIVE.symbol, label: NATIVE.name, contract: null, amount: nativeBal, decimals: 18, usd: micro(nativeBal, 18, NATIVE.priceFeed), priceFeed: NATIVE.priceFeed, sources: [{ figure: 'balance', ...rows.native.source }] });
  for (const t of TOKENS) {
    const bal = asUint(rows[`bal:${t.symbol}`]);
    const dec = asUint(rows[`dec:${t.symbol}`]);
    if (bal == null || dec == null) { unreadable.push({ what: `${t.symbol} balance`, contract: t.address, reason: 'balanceOf or decimals did not answer' }); continue; }
    if (Number(dec) !== t.decimals) { unreadable.push({ what: `${t.symbol} balance`, contract: t.address, reason: `the contract says decimals() = ${dec}, not the ${t.decimals} this assistant expects, so its amounts are not read` }); continue; }
    positions.push({ id: t.symbol, kind: 'token', protocol: null, symbol: t.symbol, label: t.name, contract: t.address, amount: bal, decimals: t.decimals, usd: micro(bal, t.decimals, t.priceFeed), priceFeed: t.priceFeed, note: t.note, sources: [{ figure: 'balance', ...rows[`bal:${t.symbol}`].source }, { figure: 'decimals', ...rows[`dec:${t.symbol}`].source }] });
  }

  const held = [];
  for (const v of VAULT_LIST) {
    const shares = asUint(rows[`bal:${v.id}`]);
    const dec = asUint(rows[`dec:${v.id}`]);
    if (shares == null || dec == null) { unreadable.push({ what: `${v.name} position`, contract: v.address, protocol: v.protocolLabel, reason: 'balanceOf or decimals did not answer, so this vault is not counted' }); continue; }
    if (Number(dec) !== v.shareDecimals || asAddress(rows[`asset:${v.id}`]) !== v.asset) { unreadable.push({ what: `${v.name} position`, contract: v.address, protocol: v.protocolLabel, reason: 'the vault’s decimals or asset are not what this assistant expects, so it is not counted' }); continue; }
    if (shares > 0n) held.push({ v, shares });
  }

  // ---- phase 2: what the vault shares are worth, and whether they can be redeemed ----
  if (held.length) {
    const calls2 = held.flatMap(({ v, shares }) => [
      { id: `assets:${v.id}`, target: v.address, data: SEL.convertToAssets + enc.uint(shares), label: 'convertToAssets(uint256): what these shares are worth' },
      { id: `redeem:${v.id}`, target: v.address, data: SEL.previewRedeem + enc.uint(shares), label: 'previewRedeem(uint256): what redeeming them would pay' },
      { id: `maxredeem:${v.id}`, target: v.address, data: SEL.maxRedeem + enc.address(who), label: 'maxRedeem(address): how many shares can be redeemed' },
    ]);
    const rows2 = Object.fromEntries((await reader.batch(calls2, 'What the vault shares are worth and whether they can be redeemed')).map((r) => [r.id, r]));
    for (const { v, shares } of held) {
      const assets = asUint(rows2[`assets:${v.id}`]);
      if (assets == null) { unreadable.push({ what: `${v.name} position`, contract: v.address, protocol: v.protocolLabel, reason: `you hold ${fmtUnits(shares, v.shareDecimals)} shares, but convertToAssets did not answer, so their value is not known` }); continue; }
      const preview = asUint(rows2[`redeem:${v.id}`]);
      const maxRedeem = asUint(rows2[`maxredeem:${v.id}`]);
      // Redemption is "available" only if the vault can preview it AND lets this wallet redeem every share it holds.
      const liquidity = preview == null ? 'not-previewable' : maxRedeem != null && maxRedeem < shares ? 'partial' : 'instant';
      positions.push({
        id: v.id, kind: 'vault', protocol: v.protocolLabel, symbol: v.symbol ?? v.name, label: v.name, contract: v.address, shares, shareDecimals: v.shareDecimals,
        amount: assets, decimals: 6, underlying: 'USDC', usd: micro(assets, 6, 'USDC/USD'), priceFeed: 'USDC/USD', vault: v,
        liquidity, redeemable: maxRedeem, redeemValue: preview,
        sources: [{ figure: 'shares held', ...rows[`bal:${v.id}`].source }, { figure: 'value in USDC', ...rows2[`assets:${v.id}`].source }, { figure: 'redemption preview', ...rows2[`redeem:${v.id}`].source }, { figure: 'redeemable shares', ...rows2[`maxredeem:${v.id}`].source }],
      });
    }
  }

  // ---- phase 3 (only when a question needs it): what the vaults paid recently ----
  let yields = null;
  if (withYield && (yieldAll || positions.some((p) => p.kind === 'vault'))) {
    yields = await measureYields({ reader, tr, chain: c, head: pinned, lookback, vaults: yieldAll ? VAULT_LIST : positions.filter((p) => p.kind === 'vault').map((p) => p.vault) });
  }
  const nonZero = positions.filter((p) => p.amount > 0n);
  const totalUsd = nonZero.every((p) => p.usd != null) ? nonZero.reduce((s, p) => s + p.usd, 0n) : null;
  return { wallet: who, block, positions: nonZero, empty: positions.filter((p) => p.amount === 0n).map((p) => p.symbol), prices, unreadable, yields, totalUsd, integrity: reader.integrity, steps: tr, lookback, reader, c, pinned };
}
const FN_LABEL = { balanceOf: 'balanceOf(address)' };

// ---- understanding the question ------------------------------------------------------------------------------------------------------------------
const has = (q, re) => re.test(q);
export const INTENTS = ['total', 'holdings', 'where_token', 'token_value', 'biggest', 'position_in', 'protocols', 'earning', 'earned'];

export function findEntities(question) {
  const q = ` ${String(question).toLowerCase().replace(/[^a-z0-9$%\-\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const tokens = [];
  for (const sym of ['usdc', 'wpros', 'pros']) if (new RegExp(`[^a-z0-9]${sym}[^a-z0-9]`).test(q)) tokens.push(sym.toUpperCase());
  const vaults = VAULT_LIST.filter((v) => v.aliases.some((a) => q.includes(` ${a} `)) || q.includes(` ${v.name.toLowerCase()} `)).map((v) => v.id);
  const protocols = [];
  if (/[^a-z0-9]r25[^a-z0-9]/.test(q)) protocols.push('R25');
  if (/[^a-z0-9](morpho|rockaway|rockawayx)[^a-z0-9]/.test(q)) protocols.push('Morpho (RockawayX vault)');
  const unsupported = UNSUPPORTED_PROTOCOLS.filter((p) => new RegExp(`[^a-z0-9]${p}[^a-z0-9]`).test(q));
  return { tokens, vaults, protocols, unsupported, q };
}

// A fixed set of question types, recognised by their words. No model: the same question always gets the same classification, and a question that fits
// none of them is refused with the list of what can be answered.
export function classify(question) {
  const text = String(question ?? '').trim();
  if (!text) throw new UserError('ask a question, e.g. "where is my USDC?"');
  if (text.length > 300) throw new UserError('the question is too long (300 characters at most)');
  const e = findEntities(text);
  const q = e.q;
  if (e.unsupported.length) return { intent: 'unsupported', ...e };
  if (has(q, /\b(have i earned|did i earn|earned so far|profit|pnl|p&l|since i deposited|since i bought|my gains?|my return|returns? so far|cost basis)\b/)) return { intent: 'earned', ...e };
  if (has(q, /\b(earning|earn|yield|apy|apr|interest|returns?|income|per day|per month|per year|daily|monthly|annual)\b/)) return { intent: 'earning', ...e };
  if (has(q, /\bwhere (is|are|do|did)\b.*\b(my|the)\b/) && (e.tokens.length || has(q, /\b(money|funds|stablecoins?|dollars?)\b/))) return { intent: 'where_token', ...e, tokens: e.tokens.length ? e.tokens : ['USDC'] };
  if (has(q, /\b(biggest|largest|top|main|most valuable|greatest)\b/)) return { intent: 'biggest', ...e };
  if (has(q, /\b(which|what|list|show)\b.*\b(protocols?|platforms?|vaults?|apps?|dapps?)\b/) || has(q, /\b(protocols?|vaults?)\b.*\b(am i|do i|i am|i use|using)\b/)) return { intent: 'protocols', ...e };
  if (e.vaults.length && has(q, /\b(how much|what|show|balance|position|have|hold|shares?|deposit|invested|worth)\b/)) return { intent: 'position_in', ...e };
  if (e.protocols.length && has(q, /\b(how much|what|show|balance|position|have|hold|deposit|invested|worth)\b/)) return { intent: 'position_in', ...e };
  if (e.tokens.length && has(q, /\b(how much|worth|value|balance|do i have|have i got|holding)\b/)) return { intent: 'token_value', ...e };
  if (has(q, /\b(total|net worth|overall|in all|all together|altogether|combined|how much (do i have|am i worth|is my portfolio)|portfolio value|portfolio worth|everything)\b/)) return { intent: 'total', ...e };
  if (has(q, /\b(what|which|list|show)\b.*\b(hold|have|own|tokens?|coins?|assets?|balances?|wallet|positions?)\b/) || has(q, /\b(my )?(balances?|holdings|positions|portfolio|wallet)\b/)) return { intent: 'holdings', ...e };
  return { intent: 'unknown', ...e };
}

// ---- answering --------------------------------------------------------------------------------------------------------------------------------
const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
const unitsOf = (p) => (p.kind === 'vault' ? `${fmtUnits(p.amount, p.decimals)} USDC` : `${fmtUnits(p.amount, p.decimals)} ${p.symbol}`);
const usdOf = (p) => (p.usd == null ? 'no dollar value (price not read)' : fmtUsd(p.usd));

export const SUPPORTED_QUESTIONS = [
  'What is my total balance?',
  'What do I hold?',
  'Where is my USDC?',
  'How much is my WPROS worth?',
  "What's my biggest position?",
  'How much do I have in R25 Quarterly?',
  'Which protocols am I using?',
  'What am I earning?',
];

// Numbered sources for the figures an answer used. The same contract+call+block is one source, however many figures it backs.
function sourceBook() {
  const list = [];
  const ref = (s) => {
    const key = `${s.contract}|${s.call}|${s.block}`;
    let i = list.findIndex((x) => x.key === key);
    if (i < 0) { list.push({ key, n: list.length + 1, contract: s.contract, call: s.call, block: s.block, tool: s.tool, integrity: s.integrity, step: s.step, explorer: s.contract && s.contract !== MULTICALL3 ? explorerAddress(s.contract) : null }); i = list.length - 1; }
    return list[i].n;
  };
  return { ref, list };
}

export async function answerQuestion({ question, portfolio: P, classification: cl = classify(question), chain, rpc, tr }) {
  const sb = sourceBook();
  const figures = [];
  const caveats = [];
  const fig = (label, value, srcs, extra = {}) => { figures.push({ label, value, sources: [...new Set(srcs.map((s) => sb.ref(s)))], ...extra }); return figures.at(-1); };
  const srcOf = (p, ...names) => p.sources.filter((s) => names.includes(s.figure));
  const priceSrc = (p) => (P.prices[p.priceFeed] ? [P.prices[p.priceFeed].source] : []);
  let text;
  const positions = P.positions;
  const total = P.totalUsd;
  const unread = P.unreadable;

  if (P.unreadable.length) caveats.push(`I could not read ${P.unreadable.map((u) => u.what).join(', ')}; ${P.unreadable.length === 1 ? 'it is' : 'they are'} not in the numbers below. ${P.unreadable.map((u) => `${u.what}: ${u.reason}.`).join(' ')}`);
  const stale = Object.entries(P.prices).filter(([, p]) => p.ageSec != null && p.ageSec > 3 * 3600);
  if (stale.length) caveats.push(`The ${stale.map(([f, p]) => `${f} price is ${(p.ageSec / 3600).toFixed(1)} hours old`).join(' and the ')}, so dollar values may lag the market.`);

  switch (cl.intent) {
    case 'unsupported': {
      text = `I do not read ${cl.unsupported.map((x) => x[0].toUpperCase() + x.slice(1)).join(' or ')} positions, so I cannot tell you anything about them and I will not guess. I read native PROS, USDC, WPROS and the ${VAULT_LIST.length} vaults of ${PROTOCOL_NAMES.join(' and ')}.`;
      break;
    }
    case 'earned': {
      text = 'I cannot tell what you have earned so far. That needs the price you paid for each position (your deposit history), which I do not read, and a balance on its own does not contain it. What I can tell you is what your vault positions are earning at the current rate: ask “what am I earning?”.';
      break;
    }
    case 'total': {
      for (const p of positions) fig(`${p.label}`, usdOf(p), [...srcOf(p, 'balance', 'value in USDC'), ...priceSrc(p)], { usd: p.usd });
      text = positions.length === 0 ? `This wallet holds nothing I read (native PROS, USDC, WPROS or the ${VAULT_LIST.length} vaults) at block ${P.block.number.toLocaleString('en-US')}.` : total == null ? `I could add up ${positions.filter((p) => p.usd != null).length} of ${positions.length} holdings, but at least one has no price, so I will not state a total.` : `Your total is ${fmtUsd(total)} across ${positions.length} holding${positions.length === 1 ? '' : 's'}, at block ${P.block.number.toLocaleString('en-US')}.`;
      break;
    }
    case 'holdings': {
      for (const p of positions) fig(p.label, unitsOf(p), srcOf(p, 'balance', 'value in USDC'), { usd: p.usd });
      text = positions.length === 0 ? 'This wallet holds nothing I read.' : `You hold ${positions.map((p) => `${unitsOf(p)}${p.kind === 'vault' ? ` in ${p.label}` : ''}`).join(', ')}.`;
      break;
    }
    case 'where_token':
    case 'token_value': {
      const symbol = cl.tokens[0] ?? 'USDC';
      const hits = positions.filter((p) => (p.kind !== 'vault' && p.symbol === symbol) || (p.kind === 'vault' && p.underlying === symbol));
      for (const p of hits) fig(p.kind === 'vault' ? `${p.label} (${p.protocol})` : `${p.label} in the wallet`, unitsOf(p), srcOf(p, 'balance', 'value in USDC'), { usd: p.usd });
      const sum = hits.reduce((s, p) => s + p.amount, 0n);
      if (hits.length === 0) text = `You have no ${symbol} that I can see: not in the wallet and not in any vault I read.`;
      else if (cl.intent === 'where_token') text = `Your ${symbol} is in ${hits.length} place${hits.length === 1 ? '' : 's'}: ${hits.map((p) => `${unitsOf(p)} ${p.kind === 'vault' ? `in ${p.label}` : 'in the wallet'}`).join('; ')}.`;
      else {
        const usd = hits.every((p) => p.usd != null) ? hits.reduce((s, p) => s + p.usd, 0n) : null;
        text = `You have ${fmtUnits(sum, hits[0].decimals)} ${symbol}${hits.length > 1 ? ' counting vault positions' : ''}${usd == null ? ', with no dollar value because the price was not read' : `, worth ${fmtUsd(usd)}`}.`;
      }
      if (symbol === 'WPROS') caveats.push('WPROS is wrapped PROS, so it is valued at the PROS/USD price.');
      break;
    }
    case 'biggest': {
      const ranked = [...positions].filter((p) => p.usd != null).sort((a, b) => (b.usd > a.usd ? 1 : -1));
      for (const p of ranked.slice(0, 3)) fig(p.label, usdOf(p), [...srcOf(p, 'balance', 'value in USDC'), ...priceSrc(p)], { usd: p.usd });
      text = ranked.length === 0 ? 'I found nothing with a dollar value to rank.' : `Your biggest position is ${ranked[0].label}${ranked[0].protocol ? ` (${ranked[0].protocol})` : ''}: ${unitsOf(ranked[0])}, ${fmtUsd(ranked[0].usd)}${total && total > 0n ? `, ${pct(Number((ranked[0].usd * 10_000n) / total) / 10_000, 1)} of your portfolio` : ''}.`;
      if (positions.some((p) => p.usd == null)) caveats.push('Some holdings have no price and could not be ranked.');
      break;
    }
    case 'position_in': {
      // A vault named outright wins over its protocol ("R25 Quarterly" is one vault, not all of R25); a protocol alone means all of its vaults.
      const namedProtocols = new Set(cl.vaults.map((id) => VAULT_LIST.find((v) => v.id === id).protocolLabel));
      const wanted = VAULT_LIST.filter((v) => cl.vaults.includes(v.id) || (cl.protocols.includes(v.protocolLabel) && !namedProtocols.has(v.protocolLabel)));
      const lines = [];
      for (const v of wanted) {
        const p = positions.find((x) => x.id === v.id);
        const bad = unread.find((u) => u.contract === v.address);
        if (bad) lines.push(`${v.name}: I could not read it (${bad.reason}).`);
        else if (!p) lines.push(`${v.name}: you hold no shares.`);
        else { lines.push(`${v.name}: ${fmtUnits(p.shares, p.shareDecimals)} shares, worth ${fmtUnits(p.amount, 6)} USDC (${usdOf(p)}).`); fig(v.name, `${fmtUnits(p.amount, 6)} USDC`, srcOf(p, 'shares held', 'value in USDC'), { usd: p.usd }); }
      }
      text = lines.join(' ');
      break;
    }
    case 'protocols': {
      const by = new Map();
      for (const p of positions.filter((x) => x.kind === 'vault')) by.set(p.protocol, [...(by.get(p.protocol) ?? []), p]);
      for (const [name, ps] of by) fig(name, ps.map((p) => `${p.label}: ${unitsOf(p)}`).join('; '), ps.flatMap((p) => srcOf(p, 'shares held', 'value in USDC')));
      text = by.size === 0 ? `You have no positions in the protocols I read (${PROTOCOL_NAMES.join(', ')}).` : `You are using ${by.size} protocol${by.size === 1 ? '' : 's'}: ${[...by].map(([n, ps]) => `${n} (${ps.length} vault${ps.length === 1 ? '' : 's'})`).join(' and ')}. Tokens in your wallet are not a protocol.`;
      break;
    }
    case 'earning': {
      const vs = positions.filter((p) => p.kind === 'vault');
      const idle = positions.filter((p) => p.kind !== 'vault' && p.symbol === 'USDC');
      if (!P.yields && vs.length) throw new Error('the earning question needs the yield measurement (readPortfolio withYield)');
      let perYear = 0n;
      const lines = [];
      for (const p of vs) {
        const y = P.yields[p.id];
        if (!y?.ok || y.apy == null) { lines.push(`${p.label}: I could not measure its yield.`); continue; }
        const yearlyUsd = p.usd == null ? null : BigInt(Math.round(Number(p.usd) * y.apy));
        if (yearlyUsd != null) perYear += yearlyUsd;
        fig(`${p.label}: rate over the last ${y.days.toFixed(1)} days`, `${pct(y.apy)} a year${yearlyUsd == null ? '' : `, about ${fmtUsd(yearlyUsd / 365n)} a day`}`, y.sources, { apy: y.apy });
        lines.push(`${p.label}: about ${pct(y.apy)} a year${yearlyUsd == null ? '' : `, roughly ${fmtUsd(yearlyUsd / 365n)} a day`}${y.steady ? '' : ' (uneven: the two halves of the window differ a lot)'}`);
      }
      for (const p of idle) if (p.amount > 0n) lines.push(`${unitsOf(p)} sitting in the wallet earns nothing`);
      text = vs.length === 0 ? `None of your holdings is in a yield-bearing vault I read${idle.some((p) => p.amount > 0n) ? `; your ${unitsOf(idle.find((p) => p.amount > 0n))} in the wallet earns nothing` : ''}.` : `${lines.join('. ')}.${perYear > 0n ? ` Together that is about ${fmtUsd(perYear / 365n)} a day, ${fmtUsd(perYear)} a year, if the recent rate held.` : ''}`;
      caveats.push('These rates come from how much each vault’s share price grew over the last few days. They describe what it paid, not what it will pay, and the vault’s own fees are already inside them.');
      break;
    }
    default: {
      text = `I do not know how to answer that. I can answer questions like: ${SUPPORTED_QUESTIONS.map((x) => `“${x}”`).join(', ')}.`;
    }
  }
  const heldVaults = positions.filter((p) => p.kind === 'vault' && p.liquidity !== 'instant');
  if (heldVaults.length && ['total', 'holdings', 'where_token', 'token_value', 'biggest', 'position_in', 'protocols', 'earning'].includes(cl.intent)) {
    caveats.push(`Not all of this can be taken out at will: ${heldVaults.map((p) => `${p.label} (${p.liquidity === 'partial' ? 'only part of the shares can be redeemed right now' : 'the vault will not preview a redemption, so exits may be restricted'})`).join('; ')}.`);
  }
  if (P.integrity.inconclusive) caveats.push(`${P.integrity.inconclusive} of ${P.integrity.batches} batches of reads could not be repeated on the public RPC, so those figures are not independently confirmed.`);
  return { question, intent: cl.intent, entities: { tokens: cl.tokens, vaults: cl.vaults, protocols: cl.protocols, unsupported: cl.unsupported }, text, figures, sources: sb.list.map(({ key, ...s }) => s), caveats, known: !['unknown', 'unsupported', 'earned'].includes(cl.intent) };
}

// ---- the whole thing ---------------------------------------------------------------------------------------------------------------------------
export async function askPortfolio({ chain, rpc = publicRpc, wallet, question, block = null, lookback = DEFAULT_LOOKBACK }) {
  const classification = classify(question); // refuses an empty or oversized question before any server is asked
  const tr = tracer();
  const needsYield = classification.intent === 'earning';
  // Questions it will not answer from the chain (another protocol, "what did I earn since depositing", anything it does not understand) read nothing: a refusal needs no data.
  const needsChain = !['unsupported', 'earned', 'unknown'].includes(classification.intent);
  if (!needsChain && !isAddress(String(wallet ?? '').trim().toLowerCase())) throw new UserError('wallet must be a 0x address (40 hex characters)');
  const portfolio = needsChain
    ? await readPortfolio({ chain, rpc, wallet, block, tr, withYield: needsYield, lookback })
    : { wallet: String(wallet).trim().toLowerCase(), block: null, positions: [], empty: [], prices: {}, unreadable: [], yields: null, totalUsd: 0n, integrity: { batches: 0, confirmed: 0, resolved: 0, inconclusive: 0, reads: 0 }, steps: tr, lookback };
  tr.agent('classify-question', `“${question}” is a ${classification.intent.replace('_', ' ')} question${classification.tokens.length ? ` about ${classification.tokens.join(', ')}` : ''}${classification.vaults.length ? ` about ${classification.vaults.join(', ')}` : ''}.`, { output: { intent: classification.intent } });
  const answer = await answerQuestion({ question, portfolio, classification, chain, rpc, tr });
  const used = answer.sources.map((s) => s.step).filter(Boolean);
  tr.agent('answer', answer.text, { uses: used, output: { figures: answer.figures.length } });
  const { yields, steps, reader: _r, c: _c, pinned: _p, ...rest } = portfolio;
  return jsonSafe({
    ...rest,
    positions: rest.positions.map(describePosition),
    prices: Object.fromEntries(Object.entries(rest.prices).map(([f, p]) => [f, { price: Number(p.raw) / 10 ** p.decimals, timestamp: p.timestamp, ageSec: p.ageSec, source: p.source }])),
    yields: yields ? Object.fromEntries(Object.entries(yields).map(([k, y]) => [k, { ok: y.ok, apy: y.apy, apyEarly: y.apyEarly, apyLate: y.apyLate, steady: y.steady, days: y.days, growth: y.growth }])) : null,
    answer,
    steps: steps.steps.sort((a, b) => a.n - b.n),
    chainCalls: steps.steps.filter((s) => s.actor === 'chain-mcp').length,
    rpcCalls: steps.steps.filter((s) => s.actor === 'public-rpc').length,
    totalUsd: portfolio.totalUsd,
    totalUsdText: portfolio.totalUsd == null ? null : fmtUsd(portfolio.totalUsd),
  });
}

// What a position looks like on the wire: base units as strings, with the human text next to them.
export function describePosition(p) {
  return {
    id: p.id, kind: p.kind, protocol: p.protocol, symbol: p.symbol, label: p.label, contract: p.contract, decimals: p.decimals, underlying: p.underlying ?? null,
    amountRaw: p.amount, units: unitsOf(p), usd: p.usd, usdText: p.usd == null ? null : fmtUsd(p.usd),
    shares: p.shares ?? null, sharesText: p.shares == null ? null : fmtUnits(p.shares, p.shareDecimals), liquidity: p.liquidity ?? null, note: p.note ?? null, priceFeed: p.priceFeed, sources: p.sources,
  };
}

export const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
