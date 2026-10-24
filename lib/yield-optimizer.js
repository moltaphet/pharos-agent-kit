// The Yield Optimizer: should this wallet move its USDC to a better vault, once everything it costs and everything that can stop it is counted?
//
// For one bucket of USDC (idle in the wallet, or in a vault) and each other vault, from live chain data at one pinned block:
//   rate     what the vault actually paid (share price at three blocks), both halves of the window, and whether the two agree
//   enter    does the vault let THIS wallet in? (the deposit is simulated from the wallet), and what does it skim (previewDeposit against the share price)
//   exit     can the source vault be redeemed by this wallet (simulated), at what skim, and can the target be redeemed later (previewRedeem)
//   gas      the gas of redeem + approve + deposit, as measured by really doing them on a mainnet fork (reports/yield-fork-run.json), at the live gas price
//   net      gain over the holding period you ask for, minus gas and fees; MOVE only if it clears your minimum, otherwise STAY PUT and say why
// Read-only. A MOVE comes with the transactions to sign, unsigned; the agent holds no key and sends nothing.

import { SEL, VAULT_LIST, enc, fmtUnits, fmtUsd, toMicroUsd, usdcStateDiff } from './defi.js';
import { decodeRevert, parseMcpRevert } from './revert.js';
import { asUint, publicRpc } from './onchain.js';
import { jsonSafe, readPortfolio } from './portfolio.js';
import { DEFAULT_LOOKBACK } from './yields.js';
import { selectorOf } from './keccak.js';
import { UserError } from './snapshot.js';
import { USDC } from './protocols.js';
import { tracer } from './steps.js';
import { parseUnits } from './policy.js';
import { UnstableReadError } from './stable.js';

const APPROVE = selectorOf(`approve(address,uint256)`);
const DEPOSIT = selectorOf(`deposit(uint256,address)`);
const REDEEM = selectorOf(`redeem(uint256,address,address)`);
export const HEADROOM = 1.3;
export const DEFAULTS = { minHoldDays: 30, minNetGainUsd: 10 };

// The gas of each step, from the recorded fork run: only what really succeeded there is used.
export function gasTableFrom(report) {
  const approve = Math.max(...Object.values(report.vaults).map((v) => v.deposit?.approveGasUsed ?? 0));
  const deposit = {};
  const redeem = {};
  for (const [id, v] of Object.entries(report.vaults)) {
    if (v.deposit?.status === 'success') deposit[id] = v.deposit.gasUsed;
    if (v.redeem?.status === 'success') redeem[id] = v.redeem.gasUsed;
  }
  return { approve, deposit, redeem, forkBlock: report.forkBlock, recordedAt: report.recordedAt, wallet: report.wallet };
}

// What a failed simulation means. A deposit that dies on the USDC allowance got past the vault's own checks: the vault let the wallet in.
const ALLOWANCE = /allowance|insufficient|exceeds balance|transfer amount|ERC20/i;
// "custom error 0x…" says nothing by itself; what the error carries sometimes does.
export function describeRevert(rev, wallet, amountRaw) {
  if (!rev.selector) return rev.message;
  const raw = (rev.raw ?? '').toLowerCase();
  const hint = raw.includes(wallet.slice(2).toLowerCase()) ? 'it carries this wallet’s address, which suggests an access check' : amountRaw != null && raw.includes(amountRaw.toString(16).padStart(8, '0')) ? 'it carries the amount to deposit, which suggests a limit' : null;
  return `custom error ${rev.selector}${hint ? ` (${hint}; the vault does not say which)` : ' (the vault does not say why)'}`;
}
export function classifyDeposit(rev) {
  if (!rev) return { eligible: true, why: 'the simulated deposit succeeded' };
  if (ALLOWANCE.test(rev.message)) return { eligible: true, why: 'the vault accepted the wallet; the simulation stops only at the USDC allowance, which the approval in the plan fixes' };
  const names = rev.selector && rev.walletInError ? ' (the error carries this wallet’s address, which suggests an access check, but the vault does not say why)' : rev.selector ? ' (the vault does not say why)' : '';
  return { eligible: false, why: `the vault refuses this wallet: ${rev.selector ? `custom error ${rev.selector}` : rev.message}${names}` };
}

const apyKnown = (y) => Boolean(y?.ok && y.apy != null);
const revertOf = (err, wallet) => {
  const m = parseMcpRevert(err);
  const data = m?.data ?? err?.rpc?.data ?? '0x';
  const msg = m?.message ?? err?.rpc?.message ?? String(err?.message ?? err);
  if (!m && !err?.rpc) return null; // a network failure, not a revert
  const d = decodeRevert(data, msg);
  return { message: d.message, selector: d.selector ?? null, kind: d.kind, raw: d.raw, walletInError: Boolean(d.raw) && d.raw.toLowerCase().includes(String(wallet ?? '').slice(2).toLowerCase()) && String(wallet ?? '').length === 42 };
};

export async function optimize({ chain, rpc = publicRpc, wallet, from = 'auto', amount = null, minHoldDays = DEFAULTS.minHoldDays, minNetGainUsd = DEFAULTS.minNetGainUsd, lookback = DEFAULT_LOOKBACK, block = null, gas }) {
  if (!gas) throw new Error('optimize needs the measured gas table (gasTableFrom of reports/yield-fork-run.json)');
  if (!Number.isFinite(minHoldDays) || minHoldDays < 1 || minHoldDays > 365) throw new UserError('minHoldDays must be from 1 to 365');
  if (!Number.isFinite(minNetGainUsd) || minNetGainUsd < 0) throw new UserError('minNetGainUsd must be zero or more');
  const tr = tracer();
  const P = await readPortfolio({ chain, rpc, wallet, block, tr, withYield: true, yieldAll: true, lookback });
  const { reader, c, pinned } = P;
  const r = tr.wrap({ callTool: async (_t, a) => ({ result: await rpc('eth_call', [a.transaction, '0x' + a.block.toString(16), ...(a.overrides ? [a.overrides] : [])]) }) }, 'public-rpc');
  const who = P.wallet;
  // Can the public RPC override storage in an eth_call? Ask it to pretend an allowance and read it back. If not, deposit eligibility falls back to a plain simulation.
  const probe = usdcStateDiff({ owner: who, spender: '0x0000000000000000000000000000000000000001', allowance: 123_456_789n });
  const overrideWorks = await r.callTool('eth_call', { transaction: { to: USDC, data: '0xdd62ed3e' + enc.address(who) + enc.address('0x0000000000000000000000000000000000000001') }, block: pinned, overrides: probe }, { why: 'Can the public RPC simulate with a pretend allowance? (a read-back test)' }).then((x) => BigInt(x.result) === 123_456_789n, () => false);
  tr.agent('check-override', overrideWorks ? 'The public RPC can simulate with a pretend USDC allowance, so each deposit is tested as if the wallet had approved it.' : 'The public RPC cannot simulate with a pretend allowance, so deposits are tested as they stand, and a refusal other than the allowance is read as "not allowed".');

  // ---- which USDC, and how much ----
  const buckets = P.positions.filter((p) => (p.kind === 'token' && p.symbol === 'USDC') || p.kind === 'vault');
  let src;
  if (from === 'auto') src = [...buckets].filter((b) => b.usd != null).sort((a, b) => (b.usd > a.usd ? 1 : -1))[0];
  else if (from === 'idle') src = buckets.find((b) => b.kind === 'token');
  else {
    if (!VAULT_LIST.some((v) => v.id === from)) throw new UserError(`from must be "auto", "idle" or one of ${VAULT_LIST.map((v) => v.id).join(', ')}`);
    src = buckets.find((b) => b.id === from);
  }
  const usdcPrice = P.prices['USDC/USD'];
  const prosPrice = P.prices['PROS/USD'];
  const base = { wallet: who, block: P.block, assumptions: { minHoldDays, minNetGainUsd, lookbackBlocks: lookback, gasFrom: `measured by really doing the steps on a mainnet fork at block ${gas.forkBlock.toLocaleString('en-US')}` } };
  const finish = (extra) => jsonSafe({ ...base, ...extra, positions: undefined, steps: tr.steps.sort((a, b) => a.n - b.n), chainCalls: tr.steps.filter((s) => s.actor === 'chain-mcp').length, rpcCalls: tr.steps.filter((s) => s.actor === 'public-rpc').length, integrity: reader.integrity, unreadable: P.unreadable });
  if (!src) {
    const reason = from === 'auto' ? 'this wallet holds no USDC, in the wallet or in a vault I read' : from === 'idle' ? 'this wallet holds no USDC outside a vault' : `this wallet holds no shares of ${from}`;
    tr.agent('recommendation', `STAY PUT: ${reason}.`);
    return finish({ recommendation: { action: 'stay', headline: 'STAY PUT: there is nothing to move', reason }, source: null, candidates: [] });
  }
  if (!usdcPrice) throw new UserError('the USDC/USD price feed could not be read, so the dollar value of the move cannot be worked out');
  let amountRaw = amount == null || amount === '' ? src.amount : parseUnits(amount, 6, 'amount');
  if (amountRaw <= 0n) throw new UserError('amount must be more than zero');
  if (amountRaw > src.amount) throw new UserError(`amount is more than the ${fmtUnits(src.amount, 6)} USDC this wallet has in ${src.label}`);
  const srcVault = src.kind === 'vault' ? src.vault : null;
  const amountUsd = Number(toMicroUsd(amountRaw, 6, usdcPrice.raw, usdcPrice.decimals)) / 1e6;
  const source = { id: src.id, label: src.kind === 'token' ? 'USDC idle in the wallet' : src.label, kind: src.kind, amountRaw, amountText: `${fmtUnits(amountRaw, 6)} USDC`, amountUsd, apy: srcVault ? P.yields[srcVault.id]?.apy ?? null : 0, steady: srcVault ? P.yields[srcVault.id]?.steady ?? false : true };
  tr.agent('choose-source', `Moving ${source.amountText} (about ${fmtUsd(BigInt(Math.round(amountUsd * 1e6)))}) out of ${source.label}${srcVault ? '' : ', where it earns nothing'}.`, { uses: [], output: { from: src.id, amountRaw } });

  // ---- the source: can this wallet take it out, and what does that skim? ----
  let exit = { ok: true, why: 'USDC in the wallet needs no redemption', feeFrac: 0, sharesToRedeem: null, simulated: false };
  if (srcVault) {
    const [sh] = await reader.batch([{ id: 'toShares', target: srcVault.address, data: SEL.convertToShares + enc.uint(amountRaw), label: 'convertToShares(uint256): shares worth this much USDC' }], 'How many shares are this much USDC');
    const needed = asUint(sh);
    const sharesToRedeem = needed == null ? null : needed + 1n > src.shares ? src.shares : needed + 1n; // one more than the exact count, so rounding cannot pay out a unit too little
    if (sharesToRedeem == null) exit = { ok: false, why: 'the vault would not price its shares, so a redemption cannot be sized', feeFrac: 0, sharesToRedeem: null, simulated: false };
    else {
      const rows = await reader.batch([
        { id: 'prev', target: srcVault.address, data: SEL.previewRedeem + enc.uint(sharesToRedeem), label: 'previewRedeem(uint256): what redeeming pays' },
        { id: 'conv', target: srcVault.address, data: SEL.convertToAssets + enc.uint(sharesToRedeem), label: 'convertToAssets(uint256): the share price value' },
      ], 'What redeeming the source shares pays, against their value');
      const prev = asUint(rows[0]);
      const conv = asUint(rows[1]);
      const sim = await simulate({ c, r, tr, pinned, tx: { from: who, to: srcVault.address, data: REDEEM + enc.uint(sharesToRedeem) + enc.address(who) + enc.address(who) }, why: `Simulate redeeming from ${srcVault.name} as the wallet` });
      const fee = prev != null && conv != null && conv > 0n ? Math.max(0, Number(conv - prev) / Number(conv)) : 0;
      exit = sim.revert
        ? { ok: false, why: `the vault will not let this wallet redeem: ${sim.revert.selector ? `custom error ${sim.revert.selector}` : sim.revert.message}`, feeFrac: fee, sharesToRedeem, simulated: true, revert: sim.revert }
        : { ok: true, why: `the simulated redeem succeeds (pays ${fmtUnits(prev ?? 0n, 6)} USDC for ${fmtUnits(sharesToRedeem, srcVault.shareDecimals)} shares)`, feeFrac: fee, sharesToRedeem, simulated: true, payout: prev };
    }
    tr.agent('check-exit', `${src.label}: ${exit.ok ? 'can be redeemed by this wallet' : 'CANNOT be redeemed by this wallet'}. ${exit.why}.`, { uses: [] });
  }

  // ---- gas price and what it costs in dollars ----
  const gp = await c.callTool('get_gas_price', {}, { why: 'The live gas price, to cost the transactions' });
  const gasPriceWei = BigInt(gp.gasPriceWei);
  const gasUsd = (units) => (prosPrice ? Number(toMicroUsd(BigInt(units) * gasPriceWei, 18, prosPrice.raw, prosPrice.decimals)) / 1e6 : null);

  // ---- every other vault ----
  const candidates = [];
  for (const T of VAULT_LIST.filter((v) => v.id !== src.id)) {
    const y = P.yields[T.id];
    const why = [];
    const unit = 10n ** BigInt(T.shareDecimals);
    const rows = await reader.batch([
      { id: 'prevDep', target: T.address, data: SEL.previewDeposit + enc.uint(amountRaw), label: 'previewDeposit(uint256): shares for this deposit' },
      { id: 'prevRed', target: T.address, data: SEL.previewRedeem + enc.uint(unit), label: 'previewRedeem(uint256): can this vault be redeemed at all' },
      { id: 'maxDep', target: T.address, data: SEL.maxDeposit + enc.address(who), label: 'maxDeposit(address): how much this wallet may deposit' },
    ], `Entry terms of ${T.name}`);
    const sharesOut = asUint(rows[0]);
    const redeemable = asUint(rows[1]) != null;
    const maxDep = asUint(rows[2]);
    let entryFee = 0;
    if (sharesOut != null && sharesOut > 0n) {
      const [back] = await reader.batch([{ id: 'back', target: T.address, data: SEL.convertToAssets + enc.uint(sharesOut), label: 'convertToAssets(uint256): what those shares are worth' }], `Entry fee check of ${T.name}`);
      const worth = asUint(back);
      if (worth != null) entryFee = Math.max(0, Number(amountRaw - worth) / Number(amountRaw));
    }
    const depositTx = { from: who, to: T.address, data: DEPOSIT + enc.uint(amountRaw) + enc.address(who) };
    const have = P.positions.find((p) => p.kind === 'token' && p.symbol === 'USDC')?.amount ?? 0n;
    let enter;
    if (overrideWorks) {
      // As if the wallet had approved the vault (and, when the money first comes out of a vault, already held it): does the vault itself accept the deposit?
      const approved = await simulateWith({ r, pinned, tx: depositTx, overrides: usdcStateDiff({ owner: who, spender: T.address, allowance: amountRaw * 2n, balance: srcVault ? have + amountRaw : null }), why: `Simulate depositing into ${T.name} as the wallet, as if it had approved the vault` });
      const plain = await simulate({ c, r, tr, pinned, tx: depositTx, why: `Simulate depositing into ${T.name} as the wallet, exactly as things stand` }).catch(() => null);
      enter = approved.revert
        ? { eligible: false, why: `the vault refuses this wallet even with the approval in place: ${describeRevert(approved.revert, who, amountRaw)}` }
        : { eligible: true, why: `the simulated deposit succeeds once the wallet has approved the vault${plain?.revert ? ` (as things stand it stops at the USDC allowance: ${plain.revert.message})` : ''}` };
    } else {
      const plain = await simulate({ c, r, tr, pinned, tx: depositTx, why: `Simulate depositing into ${T.name} as the wallet` });
      enter = classifyDeposit(plain.revert);
    }
    if (maxDep != null && maxDep > 0n && maxDep < amountRaw) { enter.eligible = false; enter.why = `the vault caps this wallet's deposit at ${fmtUnits(maxDep, 6)} USDC, below the ${source.amountText} to move`; }
    const gasUnits = (srcVault ? gas.redeem[srcVault.id] ?? null : 0) == null || gas.deposit[T.id] == null ? null : (srcVault ? gas.redeem[srcVault.id] : 0) + gas.approve + gas.deposit[T.id];
    const gUsd = gasUnits == null ? null : gasUsd(gasUnits);
    if (apyKnown(y) && y.apy <= source.apy) why.push(`it pays no more than where the money is now (${(y.apy * 100).toFixed(2)}% against ${(source.apy * 100).toFixed(2)}%)`);
    if (!enter.eligible) why.push(enter.why);
    if (!exit.ok) why.push(`the source cannot be redeemed: ${exit.why}`);
    if (!redeemable) why.push('the vault will not preview a redemption, so getting out again is not assured (funds may be locked)');
    if (!y?.ok || y.apy == null) why.push('its yield could not be measured');
    else if (!y.steady) why.push(`its yield is uneven (${(y.apyEarly * 100).toFixed(1)}% in the first half of the window, ${(y.apyLate * 100).toFixed(1)}% in the second), so the rate is not a reliable guide`);
    if (gasUnits == null) why.push(srcVault && gas.redeem[srcVault.id] == null ? 'no measured gas exists for redeeming the source' : 'no measured gas exists for depositing into this vault (it did not succeed in the fork run), so the move cannot be priced');
    const apy = y?.apy ?? null;
    const years = minHoldDays / 365;
    const grossGain = apy == null ? null : amountUsd * ((1 + apy) ** years - (1 + source.apy) ** years);
    const feeUsd = amountUsd * (entryFee + exit.feeFrac);
    const net = grossGain == null || gUsd == null ? null : grossGain - gUsd - feeUsd;
    const dailyExtra = apy == null ? 0 : (amountUsd * (apy - source.apy)) / 365;
    const costs = gUsd == null ? null : gUsd + feeUsd;
    const breakEvenDays = costs == null ? null : dailyExtra > 0 ? costs / dailyExtra : null;
    if (net != null && net < minNetGainUsd && why.length === 0) why.push(`the net gain over ${minHoldDays} days (${fmtUsd(BigInt(Math.round(net * 1e6)))}) is below your minimum of ${fmtUsd(BigInt(Math.round(minNetGainUsd * 1e6)))}`);
    candidates.push({
      id: T.id, name: T.name, protocol: T.protocolLabel, apy, apyEarly: y?.apyEarly ?? null, apyLate: y?.apyLate ?? null, steady: y?.steady ?? false, days: y?.days ?? null,
      enter: { eligible: enter.eligible, why: enter.why, simulated: true, sharesOut: sharesOut?.toString() ?? null, maxDeposit: maxDep?.toString() ?? null },
      redeemable, entryFee, gasUnits, gasUsd: gUsd, feeUsd, grossGain, net, breakEvenDays,
      viable: why.length === 0 && net != null && net >= minNetGainUsd, rejected: why,
      sources: y?.sources ?? [],
    });
  }
  tr.agent('compare', `Compared ${candidates.length} vaults against ${source.label} (${source.apy == null ? 'rate unknown' : `${(source.apy * 100).toFixed(2)}%`} a year): ${candidates.map((x) => `${x.name} ${x.apy == null ? '?' : (x.apy * 100).toFixed(1) + '%'} ${x.viable ? 'viable' : 'rejected'}`).join('; ')}.`, { uses: [] });

  // ---- the decision ----
  const viable = candidates.filter((x) => x.viable).sort((a, b) => b.net - a.net);
  let recommendation;
  let prepared = null;
  const money = (n) => (Math.abs(n) > 0 && Math.abs(n) < 0.01 ? `$${n.toFixed(4)}` : fmtUsd(BigInt(Math.round(n * 1e6))));
  if (viable.length) {
    const best = viable[0];
    recommendation = { action: 'move', to: best.id, toName: best.name, headline: `MOVE ${source.amountText} from ${source.label} to ${best.name}`, netGainUsd: best.net, grossGainUsd: best.grossGain, gasUsd: best.gasUsd, feesUsd: best.feeUsd, holdDays: minHoldDays, breakEvenDays: best.breakEvenDays,
      reason: `If you keep it there for at least ${minHoldDays} days at the rate it has paid (${(best.apy * 100).toFixed(2)}% against ${(source.apy * 100).toFixed(2)}%), the expected net gain is ${money(best.net)}: ${money(best.grossGain)} extra yield, minus ${money(best.gasUsd)} of gas${best.feeUsd >= 0.0001 ? ` and ${money(best.feeUsd)} of vault fees` : ', with no fee worth counting on entry or exit (under $0.0001: previewDeposit and previewRedeem match the share price)'}. It pays for itself after ${best.breakEvenDays < 1 ? 'under a day' : `${best.breakEvenDays.toFixed(1)} days`}.` };
    const T = VAULT_LIST.find((v) => v.id === best.id);
    const steps = [];
    if (srcVault) steps.push({ step: 'redeem', label: `Redeem from ${srcVault.name}`, to: srcVault.address, data: REDEEM + enc.uint(exit.sharesToRedeem) + enc.address(who) + enc.address(who), gasUnits: gas.redeem[srcVault.id], simulated: 'succeeds as this wallet at the pinned block' });
    steps.push({ step: 'approve', label: `Let ${T.name} take ${source.amountText}`, to: USDC, data: APPROVE + enc.address(T.address) + enc.uint(amountRaw), gasUnits: gas.approve, simulated: 'an approval always succeeds' });
    steps.push({ step: 'deposit', label: `Deposit into ${T.name}`, to: T.address, data: DEPOSIT + enc.uint(amountRaw) + enc.address(who), gasUnits: gas.deposit[T.id], simulated: 'the vault accepted this wallet; the simulation stops only at the allowance the approval above provides' });
    prepared = { note: 'Unsigned. Nothing was sent and the agent holds no key. Sign them in this order from the wallet; run the optimizer again just before, since rates and the share price move.', from: who, network: 'Pharos mainnet (chain 1672)', transactions: steps.map((s) => ({ ...s, value: '0', gasLimit: Math.ceil(s.gasUnits * HEADROOM) })) };
  } else {
    const closest = [...candidates].filter((x) => x.net != null).sort((a, b) => b.net - a.net)[0];
    recommendation = {
      action: 'stay', headline: `STAY PUT in ${source.label}`,
      reason: !exit.ok
        ? `${source.label} cannot be redeemed by this wallet right now (${exit.why}), so ${source.amountText} cannot be moved out of it, whatever the other vaults pay.`
        : `No vault is worth moving ${source.amountText} to right now. ${candidates.map((x) => `${x.name}: ${x.rejected.length ? x.rejected[0] : 'not better'}.`).join(' ')}`,
      closest: closest ? { id: closest.id, name: closest.name, netGainUsd: closest.net } : null,
    };
  }
  tr.agent('recommendation', `${recommendation.headline}. ${recommendation.reason}`, { uses: [] });
  return finish({ recommendation, source, candidates, prepared, prices: { gasPriceGwei: Number(gasPriceWei) / 1e9, pros: prosPrice ? Number(prosPrice.raw) / 10 ** prosPrice.decimals : null, usdc: Number(usdcPrice.raw) / 10 ** usdcPrice.decimals }, gasTable: { approve: gas.approve, deposit: gas.deposit, redeem: gas.redeem, forkBlock: gas.forkBlock }, yields: Object.fromEntries(Object.entries(P.yields).map(([k, y]) => [k, { apy: y.apy, apyEarly: y.apyEarly, apyLate: y.apyLate, steady: y.steady, days: y.days, growth: y.growth }])) });
}

// One call as the wallet, on Chain MCP and then on the public RPC. They must agree on succeed-or-revert; if they do not, the answer is "not known", never "fine".
async function simulate({ c, r, tr, pinned, tx, why }) {
  const attempt = async (client) => {
    try {
      await client.callTool('eth_call', { transaction: tx, block: pinned }, { why });
      return { revert: null };
    } catch (err) {
      const rv = revertOf(err, tx.from);
      if (!rv) throw err;
      return { revert: rv };
    }
  };
  const a = await attempt(c);
  const b = await attempt(r).catch(() => null);
  if (b == null) return a; // the public RPC could not answer: Chain MCP's answer stands
  if (Boolean(a.revert) !== Boolean(b.revert)) throw new UnstableReadError(`Chain MCP and the public RPC disagree on whether ${why.toLowerCase()} succeeds, so the move is not assessed.`);
  return a;
}

// A call through the public RPC with storage overrides. Chain MCP's eth_call takes none, so this one answer has a single source; the plain simulation next to it is the cross-check.
async function simulateWith({ r, pinned, tx, overrides, why }) {
  try {
    await r.callTool('eth_call', { transaction: tx, block: pinned, overrides }, { why });
    return { revert: null };
  } catch (err) {
    const rv = revertOf(err, tx.from);
    if (!rv) throw err;
    return { revert: rv };
  }
}
