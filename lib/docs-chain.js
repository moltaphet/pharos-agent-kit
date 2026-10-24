// The Docs MCP + Chain MCP agent: it explains a contract function, then calls it, then reads the result in the light of the explanation.
//
//   "latestAnswer()(int256) on 0x8b5D…"
//     chain  get_block_number · get_block · get_code   the block to read at, its time, and that the address is a contract
//     docs   askQuestion + searchDocumentation        what the function does, its units, what to check (with sources)
//     agent  analyse the explanation                  the scale it states ("divide by 10^18"), the unit ("BTC/USD price"), the checks it asks for
//     chain  eth_call the function                    the real value, at the same block, confirmed against the public RPC
//     chain  follow-up calls THE EXPLANATION asked for  decimals() to verify the scale, latestTimestamp() because it says check freshness
//     agent  interpret                                the raw value scaled the way the docs say, cross-checked against the chain
//
// The two servers are composed, not run side by side: the explanation decides which extra Chain MCP calls are made and how the
// raw number is read, and the chain's answers can contradict the explanation (a stated scale that differs from decimals()).
// Everything is read-only (eth_call). Nothing is sent.

import { buildResult, DOCS_GOAL } from './docs.js';
import { decodeOutputs, encodeCall, parseSignature } from './abi-call.js';
import { blockNumber, getBlock, getCode } from './chain.js';
import { formatUnits, isAddress } from './abi.js';
import { decodeRevert, parseMcpRevert } from './revert.js';
import { UserError } from './snapshot.js';
import { rpcCall } from './rpc.js';
import { UnstableReadError } from './stable.js';

// Zero-argument view functions the agent may call because an explanation points at them. A fixed list: an explanation can name
// anything, and the agent only ever follows the ones it knows to be harmless reads.
export const FOLLOW_UPS = {
  decimals: 'decimals()(uint8)',
  latestTimestamp: 'latestTimestamp()(uint256)',
};

// Numbers that are not amounts: decimals() is a count of digits, a timestamp is a time, a round or nonce is a counter. Scaling one of them by the
// token's decimals would print nonsense (an early version turned decimals() = 6 into 0.000006), so a scale is applied only to a numeric return value
// of a function that is not on this list.
export const NOT_AMOUNTS = new Set(['decimals', 'latestTimestamp', 'latestRound', 'version', 'nonce', 'chainId', 'getChainId', 'blockNumber', 'latestRoundId']);

const brief = (v, max = 260) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  return s.length > max ? s.slice(0, max) + '…' : s;
};
const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const utc = (sec) => `${WEEK[new Date(sec * 1000).getUTCDay()]} ${new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`;

// ---- reading an explanation -----------------------------------------------------------------------------------------------
const plainText = (md) => md.replace(/10\s*\*\*\s*(\w+)/g, '10^$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
const sentenceAround = (plain, index) => {
  const start = Math.max(plain.lastIndexOf('. ', index) + 2, 0);
  const end = plain.indexOf('. ', index);
  return plain.slice(start, end < 0 ? plain.length : end + 1).trim();
};
const powerOfTen = (digits) => {
  const n = digits.replace(/,/g, '');
  return /^10*$/.test(n) && n.length > 1 ? n.length - 1 : null;
};

// What an explanation says about scale, unit and checks. Pure and deterministic: the same text always gives the same reading.
export function analyseExplanation(markdown) {
  const plain = plainText(markdown ?? '');
  const found = [];
  const add = (exp, kind, index) => {
    if (Number.isInteger(exp) && exp >= 0 && exp <= 36) found.push({ exp, kind, quote: sentenceAround(plain, index) });
  };
  // "divide … by 10^18", "by 1e18", "by 1,000,000". The number must stand alone: "10^decimals" names no scale, and "10" in it is not one.
  for (const m of plain.matchAll(/\bdivide\b[^.]{0,80}?\bby\s+(?:10\^(\d{1,2})(?![\d\w])|1e(\d{1,2})(?![\d\w])|([\d,]{2,})(?![\d^*\w]))/gi)) {
    add(m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : powerOfTen(m[3]), 'divide', m.index);
  }
  for (const m of plain.matchAll(/\b(\d{1,2})\s+decimal(?:s| places?)\b/gi)) add(Number(m[1]), 'decimals', m.index);
  const exps = [...new Set(found.map((f) => f.exp))];
  const scale = exps.length === 1 ? { exp: exps[0], quote: (found.find((f) => f.kind === 'divide') ?? found[0]).quote } : null;
  // "the BTC/USD price", or any text that names exactly one pair (two different pairs would be ambiguous, so none is chosen)
  const pairs = [...new Set([...plain.matchAll(/\b([A-Z]{2,8}\/[A-Z]{2,8})\b/g)].map((m) => m[1]))];
  const pair = /\b([A-Z]{2,8}\/[A-Z]{2,8})\s+price\b/.exec(plain)?.[1] ?? (pairs.length === 1 ? pairs[0] : null);
  const smallestUnit = /\bsmallest (?:unit|denomination)s?\b/i.exec(plain);
  const followUps = [];
  const namesDecimals = /\bdecimals\(\)/.exec(plain);
  if (scale || smallestUnit || namesDecimals) {
    followUps.push({
      fn: FOLLOW_UPS.decimals,
      why: scale ? `the explanation states a scale (${scale.exp} decimals), so the contract's own decimals() is asked to confirm it`
        : namesDecimals ? 'the explanation says to call decimals() before reading the value, so the agent does'
        : 'the explanation says the value is in the smallest unit, so decimals() is asked for how many decimals that is',
      quote: scale ? scale.quote : sentenceAround(plain, (namesDecimals ?? smallestUnit).index),
    });
  }
  const ts = /\blatestTimestamp\b/.exec(markdown ?? '');
  const freshness = /\b(timestamp|stale|staleness|fresh(?:ness)?)\b/i.exec(plain);
  if (ts && freshness) followUps.push({ fn: FOLLOW_UPS.latestTimestamp, why: 'the explanation says to check freshness with latestTimestamp(), so the agent calls it', quote: sentenceAround(plain, freshness.index) });
  // "a 3600-second heartbeat", "heartbeat of 3600 seconds", "a 1-hour heartbeat": how often the feed must update, so an age can be judged against it.
  let heartbeat = null;
  const hb = /\b(\d+)[- ](second|minute|hour)s?[- ]heartbeat\b/i.exec(plain) ?? /\bheartbeat of (\d+)\s*(second|minute|hour)s?\b/i.exec(plain);
  if (hb) heartbeat = { sec: Number(hb[1]) * { second: 1, minute: 60, hour: 3600 }[hb[2].toLowerCase()], quote: sentenceAround(plain, hb.index) };
  return { scale, scaleConflict: exps.length > 1 ? exps : null, pair, smallestUnit: Boolean(smallestUnit), heartbeat, followUps };
}

// An answer that admits it cannot confirm the contract or says "if this is a …" describes the function in general. (A docs sentence like "the registry does not list decimals" is NOT a hedge: it is the documentation saying something.) It is shown, labelled
// as general, and nothing in it (a scale, a unit, a check) is applied to the value.
export const HEDGE = /\b(?:can(?:not|['’]t) (?:confirm|verify|say|determine)|could(?:n['’]t| not) (?:confirm|verify)|if this (?:is|contract)|typically returns|usual [a-z0-9]+ (?:pair )?getter|(?:docs|documentation) (?:do(?:es)?(?:n['’]t| not)) (?:list|document|mention|cover) (?:this|that) (?:contract|address|function))\b/i;
export const isHedged = (text) => HEDGE.test(String(text ?? '').replace(/\s+/g, ' '));

// ---- recording who called what -----------------------------------------------------------------------------------------------
function tracer() {
  const steps = [];
  let seq = 0;
  const wrap = (client, actor) => ({
    callTool: async (tool, args, opts = {}) => {
      const n = ++seq;
      const t0 = performance.now();
      try {
        const out = await client.callTool(tool, args, opts);
        const shown = tool === 'get_block' && out && typeof out === 'object' ? { number: out.number, hash: out.hash, timestamp: out.timestamp, '…': 'rest of the header omitted' } : out;
        steps.push({ n, actor, name: tool, why: opts.why ?? null, input: brief(args), output: brief(shown), ms: Math.round(performance.now() - t0) });
        return out;
      } catch (err) {
        steps.push({ n, actor, name: tool, why: opts.why ?? null, input: brief(args), error: String(err.message ?? err).slice(0, 200), ms: Math.round(performance.now() - t0) });
        throw err;
      }
    },
  });
  const agent = (name, summary, { uses = [], output = null } = {}) => {
    const n = ++seq;
    steps.push({ n, actor: 'agent', name, summary, uses: [...new Set(uses)].sort((a, b) => a - b), output });
    return n;
  };
  return { steps, wrap, agent, last: () => seq };
}

const question = (fn, address) => `What does ${fn.name}(${fn.inputs.join(', ')}) do on the Pharos contract ${address}? Explain what it returns, its units, and anything to check before using the value.`;

const sameHex = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
const publicRpc = (method, params) => rpcCall(method, params, { why: 'Independent check of a Chain MCP read' });

export async function runAgent({ chain, docs, rpc = publicRpc, contract, signature, args = [], block: wantBlock = null }) {
  const address = String(contract ?? '').trim().toLowerCase();
  if (!isAddress(address)) throw new UserError('contract must be a 0x address (40 hex characters)');
  const fn = parseSignature(signature);
  const calldata = encodeCall(fn, args);
  const tr = tracer();
  const c = tr.wrap(chain, 'chain-mcp');
  const d = tr.wrap(docs, 'docs-mcp');
  // The public RPC, wrapped like the other servers so its answer shows up as a step. Only ever asked to repeat an eth_call.
  const r = tr.wrap({ callTool: async (_t, a) => ({ result: await rpc('eth_call', [a.transaction, '0x' + a.block.toString(16)]) }) }, 'public-rpc');
  const integrity = { checked: 0, confirmed: 0, resolved: 0, inconclusive: 0 };
  const sParse = tr.agent('parse-request', `Function ${fn.signature} (selector ${fn.selector}) on ${address}${args.length ? `, arguments ${args.join(', ')}` : ''}; it should return ${fn.outputs.join(', ') || 'unknown'}.`, { output: { signature: fn.signature, selector: fn.selector, calldata } });

  // ---- Chain MCP: where, when, and is it a contract? ----
  const head = await blockNumber(c, 'The latest block, so the agent can pin everything to one block behind it');
  const pinned = wantBlock == null ? head - 2 : wantBlock;
  if (wantBlock != null && (!Number.isInteger(wantBlock) || wantBlock < 1 || wantBlock > head - 2)) throw new UserError(`block must be a whole number from 1 to ${(head - 2).toLocaleString('en-US')} (two behind the head)`);
  const header = await getBlock(c, pinned, 'The block header: its timestamp is "now" for any age the agent reports');
  const sHeader = tr.last();
  const code = await getCode(c, address, pinned, 'Is there a contract at this address? (the agent asks the docs only about contracts)');
  const sCode = tr.last();
  const blockInfo = { number: pinned, head, historical: wantBlock != null, timestamp: header.timestamp, iso: utc(header.timestamp) };
  const base = { request: { contract: address, signature: fn.signature, selector: fn.selector, args, outputs: fn.outputs }, block: blockInfo };
  const finish = (verdict, extra = {}) => ({ ...base, verdict, integrity, steps: tr.steps.sort((a, b) => a.n - b.n), chainCalls: tr.steps.filter((s) => s.actor === 'chain-mcp').length, docsCalls: tr.steps.filter((s) => s.actor === 'docs-mcp').length, rpcCalls: tr.steps.filter((s) => s.actor === 'public-rpc').length, ...extra });
  if (!code) {
    tr.agent('contract-check', `There is no contract code at ${address} on block ${pinned.toLocaleString('en-US')}: nothing to explain or call.`, { uses: [sCode] });
    return finish({ status: 'stop', stage: 'contract', headline: 'STOP: there is no contract at that address', reason: `no code at ${address} on block ${pinned.toLocaleString('en-US')} (a wallet, a wrong address, or not deployed yet)` });
  }
  tr.agent('contract-check', `${address} holds ${(code.length - 2) / 2} bytes of contract code at block ${pinned.toLocaleString('en-US')}.`, { uses: [sCode] });

  // One eth_call, confirmed. The hosted Chain MCP is load-balanced, and a backend node can answer a block-pinned call with the wrong state (a real
  // recording of this agent got 81,587 for a price that was 80,683 at that block). So every read is repeated on the public RPC; if they differ,
  // Chain MCP is asked again and the two that agree win. Three different answers, or no agreement, stop the run rather than guess.
  async function confirmedCall(data, why) {
    const tx = { to: address, data };
    const first = (await c.callTool('eth_call', { transaction: tx, block: pinned }, { why })).result;
    const chainStep = tr.last();
    integrity.checked++;
    let other = null;
    try {
      other = (await r.callTool('eth_call', { transaction: tx, block: pinned }, { why: 'Independent check: the same call on the public RPC' })).result;
    } catch {
      other = null; // the public RPC could not answer (rate limit, timeout, revert): the read stands, marked unconfirmed
    }
    if (other == null) { integrity.inconclusive++; return { result: first, chainStep, integrity: 'inconclusive' }; }
    if (sameHex(first, other)) { integrity.confirmed++; return { result: first, chainStep, integrity: 'confirmed' }; }
    const again = (await c.callTool('eth_call', { transaction: tx, block: pinned }, { why: 'The first answer differs from the public RPC: ask Chain MCP once more' })).result;
    const againStep = tr.last();
    if (sameHex(again, other)) { integrity.resolved++; tr.agent('read-resolved', `Chain MCP's first answer differed from the public RPC; its second answer agrees with the RPC, so the first was a backend inconsistency and is discarded.`, { uses: [chainStep, againStep] }); return { result: again, chainStep: againStep, integrity: 'resolved' }; }
    if (sameHex(again, first)) {
      const rpc2 = await r.callTool('eth_call', { transaction: tx, block: pinned }, { why: 'Chain MCP repeated its answer: read the public RPC once more' }).then((x) => x.result).catch(() => null);
      if (sameHex(rpc2, first)) { integrity.resolved++; tr.agent('read-resolved', `The public RPC's first answer was the odd one: its second answer agrees with Chain MCP.`, { uses: [chainStep, tr.last()] }); return { result: first, chainStep, integrity: 'resolved' }; }
    }
    throw new UnstableReadError(`Chain MCP and the public RPC disagree about ${fn.signature} at block ${pinned.toLocaleString('en-US')} and re-reading did not settle it, so no value is reported.`);
  }

  // ---- Docs MCP: what does it do? ----
  const q = question(fn, address);
  const mark = tr.last();
  const [askText, searchText] = await Promise.all([
    d.callTool('askQuestion', { question: q, goal: DOCS_GOAL }, { why: `Explain ${fn.name}() on ${address}` }),
    d.callTool('searchDocumentation', { query: `${fn.name} ${address}` }, { why: 'Does the documentation mention this function or contract at all?' }),
  ]);
  const docSteps = tr.steps.filter((s) => s.actor === 'docs-mcp' && s.n > mark).map((s) => s.n);
  // The explanation counts only if it names the function or the address AND links a docs page (see buildResult's `mentions`).
  const result = buildResult({ question: q, askText: String(askText), searchText: String(searchText), mentions: [fn.name, address] });
  const kind = !result.found ? 'none' : isHedged(result.answer) ? 'general' : 'documented';
  const text = result.found ? result.answer : result.partial;
  const explanation = { kind, found: result.found, text, partial: result.partial, sources: result.sources, related: result.related, reason: kind === 'general' ? 'The answer admits it cannot confirm this contract from the docs ("if this is a …"), so it is a general description and nothing in it is applied to the value.' : result.reason };
  const isAmount = fn.outputs.length === 1 && /^u?int/.test(fn.outputs[0]) && !NOT_AMOUNTS.has(fn.name);
  const analysis = kind === 'documented' ? analyseExplanation(result.answer) : { scale: null, scaleConflict: null, pair: null, smallestUnit: false, heartbeat: null, followUps: [] };
  // The follow-ups only make sense for what they are about: decimals() for an amount, latestTimestamp() for anything but the timestamp itself.
  analysis.followUps = analysis.followUps.filter((f) => (f.fn === FOLLOW_UPS.decimals ? isAmount : f.fn === FOLLOW_UPS.latestTimestamp ? fn.name !== 'latestTimestamp' : true));
  if (!isAmount) { analysis.scale = null; analysis.scaleConflict = null; }
  const cited = result.sources.filter((s) => s.cited).length;
  const sExplain = tr.agent('read-explanation', kind === 'documented'
    ? `The docs explain ${fn.name}() (${cited} cited page${cited === 1 ? '' : 's'}). Scale stated: ${analysis.scale ? `10^${analysis.scale.exp}` : analysis.scaleConflict ? `contradictory (${analysis.scaleConflict.join(' vs ')})` : 'none'}; unit: ${analysis.pair ?? 'none'}; follow-up calls it asks for: ${analysis.followUps.map((f) => f.fn.split('(')[0]).join(', ') || 'none'}.`
    : kind === 'general' ? `The docs answer only in general terms and say they cannot confirm this contract. The agent keeps the text but applies nothing from it, and shows the raw value.`
    : `The docs do not explain this function: ${result.reason} The agent will still call it, but can only show the raw value.`, { uses: docSteps, output: { kind, scale: analysis.scale?.exp ?? null, unit: analysis.pair, followUps: analysis.followUps.map((f) => f.fn) } });

  // ---- Chain MCP: call the function ----
  let raw;
  let sCall;
  let mainIntegrity;
  try {
    ({ result: raw, chainStep: sCall, integrity: mainIntegrity } = await confirmedCall(calldata, `Call ${fn.signature} on the chain at block ${pinned.toLocaleString('en-US')}`));
  } catch (err) {
    if (err instanceof UnstableReadError) throw err;
    const rv = parseMcpRevert(err);
    if (!rv) throw err;
    const reason = decodeRevert(rv.data, rv.message).message;
    tr.agent('call-result', `${fn.signature} reverted: ${reason}.`, { uses: [tr.last()] });
    return finish({ status: 'stop', stage: 'call', headline: 'STOP: the call reverted', reason }, { explanation, analysis });
  }
  let decoded;
  try {
    decoded = decodeOutputs(fn.outputs, raw);
  } catch (err) {
    if (!(err instanceof UserError)) throw err;
    tr.agent('call-result', `The call answered, but not as ${fn.outputs.join(', ')}: ${err.message}.`, { uses: [sCall] });
    return finish({ status: 'stop', stage: 'decode', headline: 'STOP: the answer is not the declared type', reason: err.message }, { explanation, analysis, call: { calldata, raw } });
  }
  tr.agent('call-result', `${fn.signature} returned ${decoded.map((x) => x.text).join(', ') || raw}.`, { uses: [sCall], output: { raw } });

  // ---- Chain MCP again: the calls the explanation asked for ----
  const followUps = [];
  for (const f of analysis.followUps) {
    const sig = parseSignature(f.fn);
    let value = null;
    let error = null;
    let stepOfFollow = null;
    try {
      const out = await confirmedCall(encodeCall(sig), `Follow-up asked for by the explanation: ${sig.signature}`);
      value = decodeOutputs(sig.outputs, out.result)[0].value;
      stepOfFollow = out.chainStep;
    } catch (err) {
      if (err instanceof UnstableReadError) throw err;
      if (err instanceof UserError || parseMcpRevert(err)) error = err instanceof UserError ? err.message : 'the contract has no such function';
      else throw err;
    }
    const n = stepOfFollow ?? tr.last();
    const agentStep = tr.agent(`follow-up ${sig.name}`, value != null ? `${f.why}. ${sig.signature} = ${value}.` : `${f.why}. The contract does not answer ${sig.signature} (${error}), so that check is skipped.`, { uses: [sExplain, n] });
    followUps.push({ fn: sig.signature, why: f.why, quote: f.quote, value: value == null ? null : value.toString(), step: n, agentStep, error });
  }

  // ---- interpret ----
  const checks = [];
  const dec = followUps.find((f) => f.fn === 'decimals()' && f.value != null);
  const stamp = followUps.find((f) => f.fn === 'latestTimestamp()' && f.value != null);
  let exp = null;
  let scaleSource = null;
  if (analysis.scaleConflict) checks.push({ name: 'the explanation states one scale', ok: false, detail: `it gives contradictory scales (10^${analysis.scaleConflict.join(' vs 10^')}), so none is applied` });
  if (analysis.scale && dec) {
    const same = BigInt(analysis.scale.exp) === BigInt(dec.value);
    checks.push({ name: 'the documented scale matches the contract’s decimals()', ok: same, detail: same ? `the docs say 10^${analysis.scale.exp} and the contract says decimals() = ${dec.value}` : `the docs say 10^${analysis.scale.exp} but the contract says decimals() = ${dec.value}: the documentation and the chain disagree` });
    exp = Number(dec.value); // the contract wins
    scaleSource = same ? 'docs and chain agree' : 'chain (decimals()); the docs disagree';
  } else if (analysis.scale) {
    exp = analysis.scale.exp;
    scaleSource = 'docs only (decimals() could not be checked)';
  } else if (dec) {
    exp = Number(dec.value);
    scaleSource = 'chain (decimals()), because the docs say the value is in the smallest unit';
  }
  if (integrity.checked) {
    const bad = integrity.inconclusive;
    checks.push({ name: 'Chain MCP’s answers match the public RPC', ok: true, detail: `${integrity.confirmed + integrity.resolved} of ${integrity.checked} read${integrity.checked === 1 ? '' : 's'} confirmed by the public RPC at the same block${integrity.resolved ? ` (${integrity.resolved} needed a second read after a disagreement)` : ''}${bad ? `; ${bad} could not be checked because the public RPC did not answer` : ''}` });
  }
  const numeric = isAmount;
  let value = null;
  if (numeric && exp != null) {
    const n = decoded[0].value;
    const abs = n < 0n ? -n : n;
    // 6 decimals for anything from 1 up (a price), 10 below 1 (a tiny balance would otherwise print as 0.000067 and lose its digits)
    const text = `${n < 0n ? '-' : ''}${formatUnits(abs, exp, abs >= 10n ** BigInt(exp) ? 6 : 10)}`;
    value = { raw: n.toString(), exp, scaled: text, unit: analysis.pair };
  }
  let freshness = null;
  if (stamp) {
    const age = Math.max(0, header.timestamp - Number(stamp.value));
    freshness = { timestamp: Number(stamp.value), iso: utc(Number(stamp.value)), ageSec: age, text: age < 120 ? `${age} s` : age < 7200 ? `${Math.round(age / 60)} min` : `${(age / 3600).toFixed(1)} h` };
    const hb = analysis.heartbeat;
    checks.push(hb
      ? { name: 'freshness against the documented heartbeat', ok: age <= hb.sec, detail: `latestTimestamp() is ${freshness.iso}, ${freshness.text} before the block it was read at; the docs say the feed updates at least every ${hb.sec} s, so it is ${age <= hb.sec ? 'within' : 'OVER'} that` }
      : { name: 'freshness, as the explanation asks', ok: true, detail: `latestTimestamp() is ${freshness.iso}, ${freshness.text} before the block it was read at; the docs name no staleness limit, so this is reported, not judged` });
  }
  const summary = value
    ? `${fn.signature} returned ${value.raw}. Read the way the docs say (${scaleSource}), that is ${value.scaled}${value.unit ? ` (${value.unit})` : ''}${freshness ? `, last updated ${freshness.text} before this block` : ''}.`
    : `${fn.signature} returned ${decoded.map((x) => x.text).join(', ') || raw}${kind === 'documented' && decoded.length === 1 && !isAmount && /^u?int/.test(decoded[0].type) ? ' (a count or a time, not an amount, so it is shown as it is)' : ''}.${kind === 'documented' ? '' : ' With no applicable explanation from the docs, the agent shows the value as the contract returned it and does not interpret it.'}`;
  tr.agent('interpret', summary, { uses: [sExplain, sCall, ...followUps.flatMap((f) => [f.step, f.agentStep])], output: value ?? { raw } });

  const verdicts = {
    documented: ['explained', 'EXPLAINED AND CALLED: the docs’ explanation was applied to the live value'],
    general: ['general-only', 'CALLED, BUT THE DOCS DO NOT COVER THIS CONTRACT: only a general description exists, and it was not applied'],
    none: ['unexplained', 'CALLED, BUT THE DOCS DO NOT EXPLAIN IT: only the raw value is shown'],
  };
  return finish({ status: verdicts[kind][0], stage: 'interpreted', headline: verdicts[kind][1], reason: summary }, { explanation, analysis, integrity, call: { calldata, raw, integrity: mainIntegrity, values: decoded.map((x) => ({ type: x.type, text: x.text })) }, followUps, interpretation: { value, scaleSource, freshness, checks, summary } });
}
