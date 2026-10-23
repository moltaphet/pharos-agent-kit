// The Skill + Chain MCP flow: one request in, one verdict out, with Chain MCP and two Pharos Skills woven together.
//
//   "send 1 USDC from 0x… to 0x…"
//     skill   parse-request          words -> amount, symbol, sender, recipient
//     chain   get_block_number       the head; the flow pins everything to one block behind it
//     chain   get_block              that block's timestamp: the policy's CLOCK
//     chain   eth_call symbol()/decimals()   what the token is, and how many decimals to turn "1" into units
//     skill   build-transaction      the call data, from the decimals the chain just answered
//     skill   policy-gate            Policy Gatekeeper: allow or deny by a named rule, at the BLOCK's time
//     chain   eth_call, estimate_gas, get_gas_price, balances   Dry-Run Executor, only if the gate said allow
//     skill   verdict                READY (an unsigned transaction) or STOP (which rule, or which revert)
//
// The tools are composed, not side by side: what the Skill asks Chain MCP for depends on what the Skill decided earlier (a deny
// means the simulation is never requested), and what the Skill decides depends on what Chain MCP answered (the block's time picks
// the time window, the decimals set the amount, the sender's balance decides the simulation). Nothing is sent: the end of a
// successful flow is a prepared, unsigned transaction.

import { MemoryLog, guardedExecute, verifyLog } from './audit-log.js';
import { DAYS, parseUnits, parsePolicy } from './policy.js';
import { SELECTORS, decodeString, decodeUint, encodeAddress } from './abi.js';
import { blockNumber, getBlock, optionalCall } from './chain.js';
import { USDC, WPROS } from './protocols.js';
import { shortAddress } from './labels.js';
import { UserError } from './snapshot.js';
import { dryRun } from './tasks/dry-run-executor.js';

export const TOKENS = { USDC, WPROS };
const REQUEST = /^\s*(?:send|transfer)\s+(\d+(?:\.\d+)?)\s+([A-Za-z][A-Za-z0-9]{1,9})\s+from\s+(0x[0-9a-fA-F]{40})\s+to\s+(0x[0-9a-fA-F]{40})\s*\.?\s*$/i;
const TRANSFER = '0xa9059cbb';
export const HEADROOM = 1.3; // eth_call/estimate_gas can undershoot on nested calls (we saw it on testnet), so the prepared limit has 30% on top

// "send 1 USDC from 0x… to 0x…" -> { amount, symbol, from, to }. Strict on purpose: a request this flow cannot read is refused.
export function parseRequest(text) {
  if (typeof text !== 'string') throw new UserError('the request must be a sentence like: send 1 USDC from 0x… to 0x…');
  const m = text.match(REQUEST);
  if (!m) throw new UserError(`could not read the request. Say it like: send 1 USDC from 0x… to 0x… (a plain amount, a token symbol, and two 0x addresses); got ${JSON.stringify(text.slice(0, 120))}`);
  const symbol = m[2].toUpperCase();
  if (symbol !== 'PROS' && !TOKENS[symbol]) throw new UserError(`unknown token ${symbol}: this flow knows PROS (native), ${Object.keys(TOKENS).join(' and ')}`);
  return { amount: m[1], symbol, from: m[3].toLowerCase(), to: m[4].toLowerCase() };
}

const brief = (v, max = 260) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  return s.length > max ? s.slice(0, max) + '…' : s;
};
const utc = (sec) => new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
const weekday = (sec) => DAYS[new Date(sec * 1000).getUTCDay()];

// Records every step in order, whoever takes it: the numbers are how a later step says what it used.
function recorder(chain) {
  const steps = [];
  let seq = 0;
  const callTool = async (tool, args, opts = {}) => {
    const n = ++seq;
    const t0 = performance.now();
    try {
      const out = await chain.callTool(tool, args, opts);
      // A block header is long and the flow uses three fields of it; show those, so the clock it used is visible in the step.
      const shown = tool === 'get_block' && out && typeof out === 'object' ? { number: out.number, hash: out.hash, timestamp: out.timestamp, '…': 'rest of the header omitted' } : out;
      steps.push({ n, actor: 'chain-mcp', name: tool, why: opts.why ?? null, input: brief(args), output: brief(shown), ms: Math.round(performance.now() - t0) });
      return out;
    } catch (err) {
      steps.push({ n, actor: 'chain-mcp', name: tool, why: opts.why ?? null, input: brief(args), error: String(err.message ?? err).slice(0, 200), ms: Math.round(performance.now() - t0) });
      throw err;
    }
  };
  const skill = (name, summary, { uses = [], output = null } = {}) => {
    const n = ++seq;
    steps.push({ n, actor: 'skill', name, summary, uses: [...new Set(uses)].sort((a, b) => a - b), output });
    return n;
  };
  return { steps, client: { callTool }, skill, mark: () => seq, chainStepsSince: (mark) => steps.filter((s) => s.n > mark && s.actor === 'chain-mcp').map((s) => s.n), last: () => seq };
}

// The call the request means, once the chain has said how many decimals the token has.
export const callOf = (parsed, decimals) => {
  const raw = parseUnits(parsed.amount, decimals, 'the amount');
  if (parsed.symbol === 'PROS') return { raw, request: { from: parsed.from, to: parsed.to, value: raw.toString() } };
  return { raw, request: { from: parsed.from, to: TOKENS[parsed.symbol], data: TRANSFER + encodeAddress(parsed.to) + raw.toString(16).padStart(64, '0') } };
};

export async function runFlow({ chain, text, policy: policySource, block: wantBlock = null, log = new MemoryLog() }) {
  const parsed = parseRequest(text);
  const policy = parsePolicy(policySource);
  const rec = recorder(chain);
  const dependsOn = [];
  const s0 = rec.skill('parse-request', `Read the request: ${parsed.amount} ${parsed.symbol} from ${shortAddress(parsed.from)} to ${shortAddress(parsed.to)}.`, { output: parsed });

  // ---- Chain MCP: where are we, and what time is it on the chain? ----
  const head = await blockNumber(rec.client, 'The latest block, so the flow can pin everything to one block behind it');
  const sHead = rec.last();
  let pinned = head - 2; // two blocks behind the head: every backend node of the hosted MCP has it
  const historical = wantBlock != null;
  if (historical) {
    if (!Number.isInteger(wantBlock) || wantBlock < 1 || wantBlock > pinned) throw new UserError(`block must be a whole number from 1 to ${pinned.toLocaleString('en-US')} (two behind the head)`);
    pinned = wantBlock;
  }
  const header = await getBlock(rec.client, pinned, 'The block header: its timestamp is the clock the policy’s time window is checked against');
  const sClock = rec.last();
  const nowSec = header.timestamp;
  const blockInfo = { number: pinned, head, historical, timestamp: nowSec, iso: utc(nowSec), weekday: weekday(nowSec) };

  const finish = (verdict, extra = {}) => {
    return log.all().then((entries) => ({
      request: { text, parsed },
      block: blockInfo,
      policy: { name: policy.name, hash: policy.hash, rules: policy.rules.map((r) => ({ id: r.id, type: r.type })) },
      verdict,
      steps: rec.steps.sort((a, b) => a.n - b.n),
      dependsOn,
      chainCalls: rec.steps.filter((s) => s.actor === 'chain-mcp').length,
      log: entries,
      integrity: verifyLog(entries),
      ...extra,
    }));
  };

  // ---- Chain MCP: what is the token? (native PROS has 18 decimals by definition) ----
  let decimals = 18;
  let symbol = 'PROS';
  let sToken = null;
  if (parsed.symbol !== 'PROS') {
    const token = TOKENS[parsed.symbol];
    const [symHex, decHex] = await Promise.all([
      optionalCall(rec.client, token, SELECTORS.symbol, pinned, 'symbol(): is this contract really the token the request names?'),
      optionalCall(rec.client, token, SELECTORS.decimals, pinned, 'decimals(): how many units make one token'),
    ]);
    sToken = rec.last();
    symbol = symHex ? decodeString(symHex) : null;
    decimals = decHex ? Number(decodeUint(decHex)) : null;
    if (symbol !== parsed.symbol || !Number.isInteger(decimals)) {
      const why = `the contract at ${token} answers symbol ${JSON.stringify(symbol)} and decimals ${decimals}, not the ${parsed.symbol} that was asked for, so nothing is built`;
      rec.skill('token-check', `STOP: ${why}.`, { uses: [sToken - 1, sToken] });
      return finish({ status: 'stop', stage: 'token-check', headline: `STOP: the chain disagrees about which token this is`, reason: why });
    }
    // A limit written for another number of decimals would be off by a power of ten; refuse rather than apply it.
    const clash = policy.rules.find((r) => r.type === 'spend-limit' && r.asset === token && r.decimals !== decimals);
    if (clash) {
      const why = `the policy rule “${clash.id}” counts ${symbol} with ${clash.decimals} decimals, but the chain says the token has ${decimals}: its limits would be off by a factor of ${10n ** BigInt(Math.abs(clash.decimals - decimals))}, so nothing is decided`;
      rec.skill('token-check', `STOP: ${why}.`, { uses: [sToken - 1, sToken] });
      return finish({ status: 'stop', stage: 'token-check', headline: 'STOP: the policy and the chain disagree about the token’s decimals', reason: why });
    }
    rec.skill('token-check', `The chain confirms ${token} is ${symbol} with ${decimals} decimals (the policy agrees).`, { uses: [sToken - 1, sToken] });
    dependsOn.push({ what: `${symbol} decimals`, value: String(decimals), step: sToken, effect: `turned “${parsed.amount} ${symbol}” into the integer the contract understands` });
  }

  // ---- Skill: build the call from what the chain said ----
  const { raw, request } = callOf(parsed, decimals);
  const sBuild = rec.skill('build-transaction', parsed.symbol === 'PROS'
    ? `A native transfer of ${raw} wei (${parsed.amount} PROS).`
    : `transfer(${shortAddress(parsed.to)}, ${raw}) on ${shortAddress(request.to)}: ${parsed.amount} ${symbol} is ${raw} units at ${decimals} decimals.`, { uses: sToken ? [sToken] : [], output: { to: request.to, data: request.data ?? '0x', value: request.value ?? '0' } });

  // ---- Skill: the Policy Gatekeeper decides, at the BLOCK's time. The simulation (Chain MCP again) is its executor. ----
  let simulation = null;
  let simSteps = [];
  let gateNoted = false;
  const noteGate = (d) => {
    if (gateNoted) return;
    gateNoted = true;
    rec.skill('policy-gate', `Policy Gatekeeper: ${d.decision.toUpperCase()} by ${d.rule.id} (${d.rule.type}). ${d.reason}`, { uses: [sClock, sBuild], output: { decision: d.decision, rule: d.rule, checks: d.checks.map((c) => `${c.rule}: ${!c.applies ? 'n/a' : c.pass ? 'pass' : 'FAIL'}`) } });
  };
  const out = await guardedExecute({
    policy, log, request, nowSec,
    execute: async (_req, decision) => {
      noteGate(decision); // written before the simulation is requested, so the order of the steps is the order of events
      const mark = rec.mark();
      simulation = await dryRun({ chain: rec.client }, request, { block: pinned });
      simSteps = rec.chainStepsSince(mark);
      return { verdict: simulation.verdict };
    },
  });
  const d = out.decision;
  const failedChecks = d.checks.filter((c) => c.applies && !c.pass);
  const clockCheck = d.checks.find((c) => c.type === 'time-window');
  noteGate(d);
  dependsOn.push({ what: 'the block’s time', value: `${blockInfo.weekday} ${blockInfo.iso}`, step: sClock, effect: clockCheck ? `the time-window rule “${clockCheck.rule}” ${clockCheck.pass ? 'passed' : 'FAILED'}: ${clockCheck.detail}` : 'the policy has no time window, so the clock was not used' });

  if (d.decision !== 'allow') {
    const skipped = ['eth_call (simulate)', 'estimate_gas', 'get_gas_price', 'balance reads'];
    rec.skill('simulation-skipped', `Denied, so Chain MCP was never asked to simulate it: ${skipped.join(', ')} were not called.`, { uses: [], output: { skipped } });
    return finish({ status: 'stop', stage: 'policy', headline: `STOP: the policy denies it (rule ${d.rule.id})`, rule: d.rule, reason: d.reason, failedRules: failedChecks.map((c) => c.rule) }, { decision: d, skippedChainCalls: skipped });
  }

  // ---- allowed: the simulation (Chain MCP data) decides whether it would really work ----
  const rep = simulation;
  const bal = rep.outcome?.rows?.[0];
  rec.skill('dry-run-verdict', `Dry-Run Executor: ${rep.verdict.toUpperCase()}. ${rep.summary}${bal ? ` ${bal.label}: ${bal.before} → ${bal.after}.` : ''}`, { uses: simSteps, output: { verdict: rep.verdict, gas: rep.gas?.units ?? null } });
  const balanceStep = rec.steps.find((x) => simSteps.includes(x.n) && x.name === 'eth_call' && x.input.includes(SELECTORS.balanceOf + encodeAddress(parsed.from)))?.n ?? rec.steps.find((x) => simSteps.includes(x.n) && x.name === 'get_balance')?.n ?? simSteps[0] ?? null;
  dependsOn.push({ what: 'the sender’s balance and the simulation', value: bal ? `${bal.label} ${bal.before}` : 'n/a', step: balanceStep, effect: rep.verdict === 'go' ? `the transfer would succeed (${rep.gas.units.toLocaleString('en-US')} gas)` : `the transfer would fail: ${rep.revert?.message ?? rep.summary}` });
  if (rep.verdict !== 'go') {
    return finish({ status: 'stop', stage: 'simulation', headline: 'STOP: the policy allows it, but the chain says it would fail', reason: rep.revert?.message ?? rep.summary, outcome: rep.outcome }, { decision: d, simulation: rep });
  }
  const limit = Math.ceil(rep.gas.units * HEADROOM);
  const prepared = { to: request.to, data: request.data ?? '0x', value: request.value ?? '0', gasLimit: limit, network: 'Pharos mainnet (chain 1672)', note: 'unsigned: nothing was sent' };
  rec.skill('verdict', `READY: allowed by the policy and the simulation succeeds. Prepared an unsigned transaction with gas limit ${limit.toLocaleString('en-US')} (estimate ${rep.gas.units.toLocaleString('en-US')} + 30%). Cost about ${rep.gas.costPros} PROS.`, { uses: [sClock, sBuild, ...simSteps], output: prepared });
  return finish({ status: 'ready', stage: 'prepared', headline: 'READY: allowed, simulated, prepared (unsigned)', reason: rep.summary, prepared, gas: rep.gas, outcome: rep.outcome }, { decision: d, simulation: rep });
}

