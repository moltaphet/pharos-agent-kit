// The Liquidation Watchdog's engine: read one borrower's position in a Morpho Blue market on Pharos mainnet, work out its health factor the way Morpho
// itself does, grade it against the caller's thresholds and say what to do about it.
//
// What is read (all at one pinned block, every batch confirmed on the public RPC, see lib/onchain.js):
//   Morpho.idToMarketParams(id)      loan token, collateral token, oracle, interest rate model, LLTV
//   Morpho.market(id)                total borrow assets and shares, and when interest was last accrued
//   Morpho.position(id, borrower)    collateral, borrow shares
//   oracle.price()                   collateral price in loan token, scaled by 1e36
//   irm.borrowRateView(params, mkt)  the current per-second borrow rate (to carry the debt forward to the block's time)
//
// The health rule is Morpho's own (Morpho.sol `_isHealthy`): the position is healthy while
//     maxBorrow >= borrowed,   maxBorrow = collateral * price / 1e36 * lltv / 1e18,   borrowed = borrowShares.toAssetsUp(totalBorrowAssets, totalBorrowShares)
// and `liquidate` accrues interest before it checks, so the debt used here is carried forward to the block's timestamp the same way
// (Morpho.sol `_accrueInterest`: interest = totalBorrowAssets * wTaylorCompounded(borrowRate, elapsed)). Health factor = maxBorrow / borrowed.
// scripts/liquidation-fork-run.mjs checks this against the deployed Morpho by asking it to liquidate on a fork, on both sides of the boundary.

import { makeReader, asUint, asString } from './onchain.js';
import { SEL as DEFI_SEL, explorerAddress, fmtUnits } from './defi.js';
import { blockNumber, getBlock } from './chain.js';
import { keccak256, selectorOf } from './keccak.js';
import { isAddress } from './abi.js';
import { MORPHO } from './protocols.js';
import { tracer } from './steps.js';
import { UserError } from './snapshot.js';

export const WAD = 10n ** 18n;
export const ORACLE_PRICE_SCALE = 10n ** 36n;
export const VIRTUAL_SHARES = 10n ** 6n;
export const VIRTUAL_ASSETS = 1n;
export const MAX_LIQUIDATION_INCENTIVE_FACTOR = 115n * 10n ** 16n; // 1.15
export const LIQUIDATION_CURSOR = 3n * 10n ** 17n; // 0.3
export const DEFAULT_THRESHOLDS = { warn: 1.3, critical: 1.1 };
export const MARKET_ID = /^0x[0-9a-fA-F]{64}$/;

const SEL = {
  idToMarketParams: selectorOf('idToMarketParams(bytes32)'),
  market: selectorOf('market(bytes32)'),
  position: selectorOf('position(bytes32,address)'),
  price: selectorOf('price()'),
  borrowRateView: selectorOf('borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128))'),
};
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const words = (hex) => (hex.replace(/^0x/, '').match(/.{64}/g) ?? []).map((w) => BigInt('0x' + w));
const mulDivDown = (a, b, d) => (a * b) / d;
const mulDivUp = (a, b, d) => (a * b + (d - 1n)) / d;
const wMulDown = (a, b) => mulDivDown(a, b, WAD);
const wTaylorCompounded = (x, n) => {
  const first = x * n;
  const second = mulDivDown(first, first, 2n * WAD);
  const third = mulDivDown(second, first, 3n * WAD);
  return first + second + third;
};
const toAssetsUp = (shares, totalAssets, totalShares) => mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);

// ---- the pure maths -----------------------------------------------------------------------------------------------------------------------------

// raw = { lltv, collateral, borrowShares, price, market: { totalBorrowAssets, totalBorrowShares, lastUpdate }, borrowRate }, `now` = the block's timestamp.
export function computeHealth(raw, now) {
  const { market } = raw;
  const elapsed = BigInt(Math.max(0, now - Number(market.lastUpdate)));
  const interest = elapsed > 0n && raw.borrowRate > 0n ? wMulDown(market.totalBorrowAssets, wTaylorCompounded(raw.borrowRate, elapsed)) : 0n;
  const totalBorrowAssets = market.totalBorrowAssets + interest;
  const borrowed = raw.borrowShares === 0n ? 0n : toAssetsUp(raw.borrowShares, totalBorrowAssets, market.totalBorrowShares);
  const borrowedAtLastUpdate = raw.borrowShares === 0n ? 0n : toAssetsUp(raw.borrowShares, market.totalBorrowAssets, market.totalBorrowShares);
  const collateralValue = mulDivDown(raw.collateral, raw.price, ORACLE_PRICE_SCALE); // in loan-token units
  const maxBorrow = wMulDown(collateralValue, raw.lltv);
  const hfWad = borrowed === 0n ? null : (maxBorrow * WAD) / borrowed; // null: no debt, nothing to liquidate
  return {
    elapsedSeconds: Number(elapsed), interestAccrued: interest, borrowed, borrowedAtLastUpdate, collateralValue, maxBorrow, hfWad,
    hf: hfWad == null ? null : Number(hfWad) / 1e18,
    healthy: maxBorrow >= borrowed, // Morpho's own test
    ltv: borrowed === 0n || collateralValue === 0n ? 0 : Number((borrowed * WAD) / collateralValue) / 1e18,
  };
}

// 1 / (1 - cursor * (1 - lltv)), capped at 1.15: what a liquidator may seize per unit of debt repaid (Morpho's liquidation incentive).
export function liquidationIncentiveFactor(lltv) {
  const f = (WAD * WAD) / (WAD - wMulDown(LIQUIDATION_CURSOR, WAD - lltv));
  return f < MAX_LIQUIDATION_INCENTIVE_FACTOR ? f : MAX_LIQUIDATION_INCENTIVE_FACTOR;
}

// The numbers behind "what should I do": how much to repay, or how much collateral to add, to be back at `target`; how far the collateral price may fall
// before liquidation; how long interest alone takes to get there.
export function remedies(raw, health, target) {
  if (health.borrowed === 0n) return null;
  const targetWad = BigInt(Math.round(target * 1e6)) * 10n ** 12n;
  // repay R so that maxBorrow / (borrowed - R) >= target  =>  R >= borrowed - maxBorrow / target
  const keep = mulDivDown(health.maxBorrow, WAD, targetWad);
  const repayToTarget = health.borrowed > keep ? health.borrowed - keep : 0n;
  // collateral C so that C * price/1e36 * lltv >= target * borrowed
  const needMaxBorrow = mulDivUp(health.borrowed, targetWad, WAD);
  const needCollateralValue = mulDivUp(needMaxBorrow, WAD, raw.lltv);
  const needCollateral = mulDivUp(needCollateralValue, ORACLE_PRICE_SCALE, raw.price);
  const addCollateral = needCollateral > raw.collateral ? needCollateral - raw.collateral : 0n;
  // collateral price at which maxBorrow == borrowed
  const liqPrice = mulDivUp(mulDivUp(health.borrowed, WAD, raw.lltv) * ORACLE_PRICE_SCALE, 1n, raw.collateral === 0n ? 1n : raw.collateral);
  const priceDropPct = health.hf == null ? null : (1 - Number(liqPrice) / Number(raw.price)) * 100;
  const ratePerSecond = Number(raw.borrowRate) / 1e18;
  const ratePerYear = ratePerSecond * 31_557_600;
  // the debt grows by about e^(rate * t); the health factor falls from hf to 1 when that growth equals hf
  const daysByInterest = health.hf != null && health.hf > 1 && ratePerSecond > 0 ? Math.log(health.hf) / ratePerSecond / 86400 : null;
  return { target, repayToTarget, addCollateral, repayAll: health.borrowed, liquidationPrice: liqPrice, priceDropPct, borrowRatePerYear: ratePerYear, daysToLiquidationByInterest: daysByInterest, repayCoversAll: repayToTarget >= health.borrowed };
}

export function levelOf(hf, thresholds = DEFAULT_THRESHOLDS) {
  if (hf == null) return 'no-debt';
  if (hf < 1) return 'liquidatable';
  if (hf <= thresholds.critical) return 'critical';
  if (hf <= thresholds.warn) return 'warning';
  return 'ok';
}

export function parseThresholds(input = {}) {
  const warn = Number(input.warn ?? DEFAULT_THRESHOLDS.warn);
  const critical = Number(input.critical ?? DEFAULT_THRESHOLDS.critical);
  if (!Number.isFinite(warn) || !Number.isFinite(critical)) throw new UserError('warn and critical must be numbers, e.g. warn 1.3 and critical 1.1');
  if (critical <= 1) throw new UserError('critical must be above 1: at a health factor of 1 the position is already liquidatable');
  if (warn <= critical) throw new UserError('warn must be above critical (warn 1.3, critical 1.1 are the defaults): the warning is meant to come first');
  if (warn > 10) throw new UserError('warn must be at most 10');
  return { warn, critical };
}

// ---- reading the chain --------------------------------------------------------------------------------------------------------------------------

export async function readPosition({ chain, rpc, marketId, borrower, block = null, tr = tracer() }) {
  if (!MARKET_ID.test(String(marketId ?? ''))) throw new UserError('marketId must be a 0x… id of 32 bytes (64 hex characters)');
  if (!isAddress(borrower)) throw new UserError('borrower must be a 0x address');
  const head = await blockNumber(chain);
  const at = block ?? head - 2;
  if (!Number.isInteger(at) || at < 1 || at > head - 2) throw new UserError(`block must be a whole number from 1 to ${head - 2} (two behind the head, which every backend node has)`);
  const header = await getBlock(chain, at, 'Block header: the time the debt is carried forward to');
  const reader = makeReader({ chain, ...(rpc && { rpc }), tr, block: at });
  const id = marketId.toLowerCase();
  const m = MORPHO.address.toLowerCase();
  const call = (what, target, data, label) => ({ id: what, target, data, label });

  const first = await reader.batch([
    call('params', m, SEL.idToMarketParams + id.slice(2), 'idToMarketParams(bytes32)'),
    call('market', m, SEL.market + id.slice(2), 'market(bytes32)'),
    call('position', m, SEL.position + id.slice(2) + addrWord(borrower), 'position(bytes32,address)'),
  ], 'Morpho Blue: the market’s parameters and state, and the borrower’s position', at);
  const [pw, mw, posw] = first.map((r) => (r.ok ? words(r.data) : null));
  if (!pw || pw.length < 5 || pw[0] === 0n) throw new UserError('Morpho Blue has no market with this id on Pharos mainnet');
  if (!mw || !posw) throw new UserError('the market or the position could not be read at this block');
  const params = { loanToken: '0x' + pw[0].toString(16).padStart(40, '0'), collateralToken: '0x' + pw[1].toString(16).padStart(40, '0'), oracle: '0x' + pw[2].toString(16).padStart(40, '0'), irm: '0x' + pw[3].toString(16).padStart(40, '0'), lltv: pw[4] };
  const market = { totalSupplyAssets: mw[0], totalSupplyShares: mw[1], totalBorrowAssets: mw[2], totalBorrowShares: mw[3], lastUpdate: mw[4], fee: mw[5] };
  const position = { supplyShares: posw[0], borrowShares: posw[1], collateral: posw[2] };

  const marketTuple = [market.totalSupplyAssets, market.totalSupplyShares, market.totalBorrowAssets, market.totalBorrowShares, market.lastUpdate, market.fee].map(word).join('');
  const paramsTuple = [params.loanToken, params.collateralToken, params.oracle, params.irm].map(addrWord).join('') + word(params.lltv);
  const hasIrm = BigInt(params.irm) !== 0n;
  const second = await reader.batch([
    call('price', params.oracle, SEL.price, 'oracle.price()'),
    ...(hasIrm ? [call('rate', params.irm, SEL.borrowRateView + paramsTuple + marketTuple, 'irm.borrowRateView(marketParams, market)')] : []),
    call('loanSymbol', params.loanToken, selectorOf('symbol()'), 'symbol()'),
    call('loanDecimals', params.loanToken, DEFI_SEL.decimals, 'decimals()'),
    call('collSymbol', params.collateralToken, selectorOf('symbol()'), 'symbol()'),
    call('collDecimals', params.collateralToken, DEFI_SEL.decimals, 'decimals()'),
  ], 'The oracle price, the current borrow rate and the two tokens', at);
  const by = Object.fromEntries(second.map((r) => [r.id, r]));
  const price = asUint(by.price);
  if (price == null || price === 0n) throw new UserError('the market’s oracle did not give a price at this block, so a health factor cannot be worked out');
  const rate = hasIrm ? asUint(by.rate) : 0n;
  if (hasIrm && rate == null) throw new UserError('the market’s interest rate model did not answer, so the debt cannot be carried forward to this block');
  const token = (sym, dec, address) => ({ address, symbol: asString(by[sym]) ?? '?', decimals: Number(asUint(by[dec]) ?? 18n) });

  const sources = [...first, ...second].map((r) => r.source).filter(Boolean);
  return {
    marketId: id, borrower: borrower.toLowerCase(), block: { number: at, head, timestamp: header.timestamp, iso: new Date(header.timestamp * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'), historical: at < head - 2 },
    morpho: m, params, market, position, price, borrowRate: rate ?? 0n,
    loan: token('loanSymbol', 'loanDecimals', params.loanToken), collateral: token('collSymbol', 'collDecimals', params.collateralToken),
    sources, integrity: reader.integrity, tr,
  };
}

// ---- judging it ---------------------------------------------------------------------------------------------------------------------------------

const units = (raw, t, max = 4) => `${fmtUnits(raw, t.decimals, max)} ${t.symbol}`;

export function assess(read, thresholds = DEFAULT_THRESHOLDS) {
  const th = parseThresholds(thresholds);
  const raw = { lltv: read.params.lltv, collateral: read.position.collateral, borrowShares: read.position.borrowShares, price: read.price, market: read.market, borrowRate: read.borrowRate };
  const health = computeHealth(raw, read.block.timestamp);
  const level = levelOf(health.hf, th);
  const target = level === 'critical' || level === 'liquidatable' ? th.warn : Math.max(th.warn, 1.5);
  const fixes = level === 'ok' || level === 'no-debt' ? remedies(raw, health, th.warn) : remedies(raw, health, target);
  return { thresholds: th, health, level, raw, remedies: fixes, liquidationIncentive: Number(liquidationIncentiveFactor(read.params.lltv)) / 1e18 };
}

const LEVEL_TEXT = {
  'no-debt': 'NO DEBT',
  ok: 'OK',
  warning: 'WARNING',
  critical: 'CRITICAL',
  liquidatable: 'LIQUIDATABLE NOW',
};

// One alert: a severity, a headline with the numbers, and the concrete action. `at` is when it was raised (ISO).
export function buildAlert(read, a, { at = new Date().toISOString() } = {}) {
  const { health, level, remedies: r, thresholds: th } = a;
  const L = read.loan;
  const C = read.collateral;
  if (level === 'no-debt') {
    return { level, at, severity: 'info', headline: `${LEVEL_TEXT[level]}: ${short(read.borrower)} borrows nothing in this market.`, action: null, lines: [`Collateral posted: ${units(read.position.collateral, C)}.`] };
  }
  const hf = health.hf.toFixed(4);
  const head = `${LEVEL_TEXT[level]}: health factor ${hf} (${level === 'liquidatable' ? 'below 1' : `warn at ${th.warn}, critical at ${th.critical}`})`;
  const lines = [
    `Collateral ${units(read.position.collateral, C)} worth ${units(health.collateralValue, L)}; debt ${units(health.borrowed, L)}; liquidation threshold (LLTV) ${(Number(read.params.lltv) / 1e16).toFixed(1)}%; current loan-to-value ${(health.ltv * 100).toFixed(2)}%.`,
  ];
  if (r?.priceDropPct != null && level !== 'liquidatable') lines.push(`${C.symbol} would have to fall ${r.priceDropPct.toFixed(2)}% (to ${fmtPrice(r.liquidationPrice, read)} ${L.symbol} each) to reach liquidation.`);
  if (r?.daysToLiquidationByInterest != null && level !== 'liquidatable') lines.push(`Even at a flat price, interest at ${(r.borrowRatePerYear * 100).toFixed(2)}% a year takes about ${fmtDays(r.daysToLiquidationByInterest)} to get there.`);
  if (level === 'liquidatable') lines.push(`Anyone can repay part of this debt and seize its collateral at a bonus of ${((a.liquidationIncentive - 1) * 100).toFixed(2)}%.`);
  let action;
  if (level === 'ok') action = `No action needed. To keep a margin above ${th.warn}, nothing to repay.`;
  else {
    const repay = r.repayCoversAll ? `repay all ${units(health.borrowed, L)}` : `repay ${units(r.repayToTarget, L)}`;
    const add = r.addCollateral > 0n ? `add ${units(r.addCollateral, C)} of collateral` : null;
    action = `${level === 'liquidatable' ? 'Act now: ' : ''}${repay}${add ? ` or ${add}` : ''} to get back to a health factor of ${r.target.toFixed(2)}.`;
  }
  return { level, at, severity: level === 'warning' ? 'warning' : level === 'ok' ? 'info' : 'critical', headline: head, action, lines, healthFactor: health.hf, repay: r?.repayToTarget?.toString() ?? null, addCollateral: r?.addCollateral?.toString() ?? null };
}

const short = (a) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const fmtDays = (d) => (d < 1 ? `${(d * 24).toFixed(1)} hours` : d < 60 ? `${d.toFixed(1)} days` : d < 730 ? `${(d / 30.44).toFixed(1)} months` : `${(d / 365.25).toFixed(1)} years`);
function fmtPrice(p, read) {
  // price is loan raw per 1e18-scaled... express as loan-token units per whole collateral token
  const perToken = (p * 10n ** BigInt(read.collateral.decimals)) / ORACLE_PRICE_SCALE;
  return fmtUnits(perToken, read.loan.decimals, 4);
}

// The alert as the lines a console prints, with its timestamp.
export const consoleText = (alert, read) => [`[${alert.at}] ${alert.headline}`, `    position ${short(read.borrower)} in market ${read.marketId.slice(0, 10)}… (${read.collateral.symbol}/${read.loan.symbol})`, ...alert.lines.map((l) => `    ${l}`), ...(alert.action ? [`    → ${alert.action}`] : [])].join('\n');

// ---- channels -----------------------------------------------------------------------------------------------------------------------------------

export function consoleChannel(write = (s) => console.log(s)) {
  return { name: 'console', async send(alert, read) { write(consoleText(alert, read)); return { ok: true }; } };
}
export function discordChannel(url, fetchImpl = fetch) {
  if (!/^https:\/\/(discord(app)?\.com)\/api\/webhooks\//.test(String(url ?? ''))) throw new UserError('the Discord webhook URL must start with https://discord.com/api/webhooks/');
  return { name: 'discord', async send(alert, read) { const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '```\n' + consoleText(alert, read) + '\n```' }) }); return { ok: res.ok, status: res.status }; } };
}
export function telegramChannel(token, chatId, fetchImpl = fetch) {
  if (!/^\d+:[\w-]{20,}$/.test(String(token ?? ''))) throw new UserError('the Telegram bot token does not look like 123456:ABC… (keep it in TELEGRAM_BOT_TOKEN)');
  if (!/^-?\d+$/.test(String(chatId ?? ''))) throw new UserError('the Telegram chat id must be a number (keep it in TELEGRAM_CHAT_ID)');
  return { name: 'telegram', async send(alert, read) { const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: consoleText(alert, read) }) }); return { ok: res.ok, status: res.status }; } };
}
export function channelsFromEnv(env = process.env, write) {
  const out = [consoleChannel(write)];
  if (env.DISCORD_WEBHOOK_URL) out.push(discordChannel(env.DISCORD_WEBHOOK_URL));
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) out.push(telegramChannel(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID));
  return out;
}

// An alert is sent when the level changes (or the position gets worse by a whole step), not on every poll.
export const ORDER = { 'no-debt': 0, ok: 1, warning: 2, critical: 3, liquidatable: 4 };
export function shouldAlert(previous, level) {
  if (previous == null) return level !== 'ok' && level !== 'no-debt';
  return level !== previous && (ORDER[level] > ORDER[previous] || level === 'ok');
}

// One look at one position: read, assess, alert (through the channels, if the rule says so) and say what happened.
export async function checkPosition({ chain, rpc, marketId, borrower, block = null, thresholds = DEFAULT_THRESHOLDS, channels = [], previousLevel = null, now = () => new Date().toISOString(), tr = tracer() }) {
  const read = await readPosition({ chain, rpc, marketId, borrower, block, tr });
  const a = assess(read, thresholds);
  tr.agent('assess', `Health factor ${a.health.hf == null ? 'none (no debt)' : a.health.hf.toFixed(4)} → ${a.level}.`, { uses: read.sources.map((s) => s.step).filter(Boolean), output: { level: a.level, hf: a.health.hf } });
  const alert = buildAlert(read, a, { at: now() });
  const send = shouldAlert(previousLevel, a.level);
  const delivered = [];
  if (send) for (const ch of channels) delivered.push({ channel: ch.name, ...(await ch.send(alert, read).catch((e) => ({ ok: false, error: e.message }))) });
  tr.agent('alert', send ? `Alert raised and sent to ${channels.map((c) => c.name).join(', ') || 'no channel'}.` : `No new alert: the level is ${a.level}${previousLevel ? ` (it was ${previousLevel})` : ''}.`, { uses: [], output: { sent: send } });
  return { read, assessment: a, alert, alertSent: send, delivered, explorer: { borrower: explorerAddress(read.borrower), morpho: explorerAddress(read.morpho) } };
}

// ---- finding borrowers --------------------------------------------------------------------------------------------------------------------------

const topicOf = (sig) => '0x' + keccak256(Buffer.from(sig));
export const TOPICS = {
  Borrow: topicOf('Borrow(bytes32,address,address,address,uint256,uint256)'),
  SupplyCollateral: topicOf('SupplyCollateral(bytes32,address,address,uint256)'),
};
// Who borrowed from Morpho Blue lately: Borrow events, windows of 1,000 blocks (the most the node answers), newest first. Returns unique (market, onBehalf).
export async function scanBorrowers({ rpc, head, windows = 20, size = 1000, concurrency = 4 }) {
  const seen = new Map();
  const ranges = Array.from({ length: windows }, (_, i) => [head - (i + 1) * size + 1, head - i * size]);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, windows) }, async () => {
    for (let i = next++; i < ranges.length; i = next++) {
      const [from, to] = ranges[i];
      const logs = await rpc('eth_getLogs', [{ address: MORPHO.address, topics: [TOPICS.Borrow], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]);
      for (const l of logs) {
        const marketId = l.topics[1];
        const onBehalf = '0x' + l.topics[3].slice(26);
        const key = `${marketId}:${onBehalf}`;
        if (!seen.has(key)) seen.set(key, { marketId, borrower: onBehalf, lastBorrowBlock: Number(BigInt(l.blockNumber)) });
      }
    }
  }));
  return { scanned: { from: head - windows * size + 1, to: head, windows }, borrowers: [...seen.values()].sort((a, b) => b.lastBorrowBlock - a.lastBorrowBlock) };
}

// ---- the answer, as plain JSON -------------------------------------------------------------------------------------------------------------------

const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

// checkPosition() with everything a page or a recording needs, and no BigInt: amounts are strings in the token's base units, with a readable text beside them.
export async function runWatchdog(opts) {
  const tr = opts.tr ?? tracer();
  const out = await checkPosition({ ...opts, tr });
  const { read, assessment: a, alert } = out;
  const L = read.loan;
  const C = read.collateral;
  const r = a.remedies;
  return jsonSafe({
    block: read.block,
    market: { id: read.marketId, pair: `${C.symbol}/${L.symbol}`, loan: L, collateral: C, lltv: read.params.lltv, lltvText: `${(Number(read.params.lltv) / 1e16).toFixed(1)}%`, oracle: read.params.oracle, irm: read.params.irm, totalBorrowAssetsText: units(read.market.totalBorrowAssets, L, 0), explorer: explorerAddress(read.morpho) },
    borrower: { address: read.borrower, explorer: explorerAddress(read.borrower) },
    position: {
      collateral: read.position.collateral, collateralText: units(read.position.collateral, C),
      borrowShares: read.position.borrowShares, borrowed: a.health.borrowed, borrowedText: units(a.health.borrowed, L),
      collateralValue: a.health.collateralValue, collateralValueText: units(a.health.collateralValue, L),
      maxBorrow: a.health.maxBorrow, maxBorrowText: units(a.health.maxBorrow, L),
      interestCarriedForward: a.health.borrowed - a.health.borrowedAtLastUpdate, interestSeconds: a.health.elapsedSeconds,
      price: read.price, priceText: `${fmtPrice(read.price, read)} ${L.symbol} per ${C.symbol}`,
      ltv: a.health.ltv,
    },
    healthFactor: a.health.hf, level: a.level, thresholds: a.thresholds,
    remedies: r && { target: r.target, repayToTarget: r.repayToTarget, repayToTargetText: r.repayCoversAll ? `all ${units(a.health.borrowed, L)}` : units(r.repayToTarget, L), addCollateral: r.addCollateral, addCollateralText: units(r.addCollateral, C), liquidationPrice: r.liquidationPrice, liquidationPriceText: `${fmtPrice(r.liquidationPrice, read)} ${L.symbol}`, priceDropPct: r.priceDropPct, borrowRatePerYear: r.borrowRatePerYear, daysToLiquidationByInterest: r.daysToLiquidationByInterest },
    liquidationIncentive: a.liquidationIncentive,
    alert: { ...alert, text: consoleText(alert, read) }, alertSent: out.alertSent, delivered: out.delivered,
    sources: read.sources, integrity: read.integrity,
    steps: tr.steps.sort((x, y) => x.n - y.n),
    chainCalls: tr.steps.filter((s) => s.actor === 'chain-mcp').length,
    rpcCalls: tr.steps.filter((s) => s.actor === 'public-rpc').length,
  });
}
