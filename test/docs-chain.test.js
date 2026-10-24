import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseExplanation, isHedged, runAgent } from '../lib/docs-chain.js';
import { UserError } from '../lib/snapshot.js';

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const FEED = '0x8b5db228fbccf588f08b073c235254acb6791d36';
const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const WPROS = '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0';
const PAIR = '0xb7d5d299c671e4a4c7c0c5a33b812185182fc417';
const MON = Date.UTC(2026, 9, 26, 10, 0) / 1000;

// Real Docs MCP wording, recorded 2026-10-23/24 (the server's answers are generated, so each case below is one real variant).
const FEED_ANSWER = '`latestAnswer()` returns the latest **BTC/USD price** as an `int256`. The feed uses **18 decimals**, so divide the raw answer by `10^18` to get USD per BTC.\n\nBefore using it, check freshness separately: `latestAnswer()` returns no timestamp. Call `latestTimestamp()` and compare it with the current block time against your maximum staleness limit.\n\nSee [Chainlink Push Engine Feeds](/tooling-and-infrastructure/oracles/chainlink-pe).\n\n# Sources\n\n- [Chainlink Push Engine Feeds](https://docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe)';
const USDC_SCALE_ANSWER = 'The function takes **no parameters** and returns a `uint256`; USDC amounts use **6 decimal places**, so divide the raw result by `1,000,000` for USDC.\n\nThe address is listed in the [Token Registry](/getting-started/token-registry).\n\n# Sources\n\n- [Token Registry](https://docs.pharos.xyz/getting-started/token-registry)';
const USDC_DECIMALS_ANSWER = 'Its `totalSupply()` returns the token’s total supply as a `uint256` raw integer.\n\nBefore interpreting it, call `decimals()` on this same contract, then divide the raw result by `10^decimals` for human-readable units. The registry doesn’t list decimals for this entry.\n\nSee the [Token Registry](/getting-started/token-registry).\n\n# Sources\n\n- [Token Registry](https://docs.pharos.xyz/getting-started/token-registry)';
const BALANCE_ANSWER = '`balanceOf(address)` reads the token balance for the supplied wallet address. It returns a `uint256` in the token’s smallest units.\n\nSee the [Token Registry](/getting-started/token-registry).\n\n# Sources\n\n- [Token Registry](https://docs.pharos.xyz/getting-started/token-registry)';
const HEDGED_ANSWER = 'If this is a **Uniswap V2-compatible pair**, `token0()` returns the address of the first token.\n\nI can’t confirm this contract’s ABI from the available docs. See [JSON-RPC API Methods](/api-and-sdk/json-rpc-methods).\n\n# Sources\n\n- [JSON-RPC API Methods](https://docs.pharos.xyz/api-and-sdk/json-rpc-methods)';
const REFUSAL = 'I cannot find information about this function in the docs.\n\n# Sources\n\n- [About Pharos](https://docs.pharos.xyz/introduction/readme)';

// ---- reading an explanation ---------------------------------------------------------------------------------------------------
test('the scale, unit and follow-up calls are read from real Docs MCP wording', () => {
  const a = analyseExplanation(FEED_ANSWER);
  assert.equal(a.scale.exp, 18);
  assert.match(a.scale.quote, /divide the raw answer by 10\^18/);
  assert.equal(a.pair, 'BTC/USD');
  assert.deepEqual(a.followUps.map((f) => f.fn), ['decimals()(uint8)', 'latestTimestamp()(uint256)']);
  assert.equal(a.scaleConflict, null);

  const b = analyseExplanation(USDC_SCALE_ANSWER);
  assert.equal(b.scale.exp, 6, '"divide by 1,000,000" and "6 decimal places" are the same scale');
  assert.deepEqual(b.followUps.map((f) => f.fn), ['decimals()(uint8)']);
});

test('the unit: "X/Y price", or the only pair the text names; two different pairs name none', () => {
  assert.equal(analyseExplanation('It returns the BTC/USD price.').pair, 'BTC/USD');
  assert.equal(analyseExplanation('`latestAnswer()` reads the latest **BTC/USD** value from this feed.').pair, 'BTC/USD');
  assert.equal(analyseExplanation('Feeds exist for BTC/USD and ETH/USD.').pair, null);
  assert.equal(analyseExplanation('It returns a value in USD per token.').pair, null);
});

test('"divide by 10^decimals" states no scale (it names the call to make), and the agent is told to call decimals()', () => {
  const a = analyseExplanation(USDC_DECIMALS_ANSWER);
  assert.equal(a.scale, null);
  assert.deepEqual(a.followUps.map((f) => f.fn), ['decimals()(uint8)']);
  assert.match(a.followUps[0].why, /says to call decimals\(\)/);
});

test('"10 ** decimals" (spaces, double star) is the call to make, not two bogus scales (real wording that once produced "10^1 vs 10^10")', () => {
  const real = 'It returns a `uint256` in **base units**. Check the network, then read `decimals()` before converting. The registry doesn’t specify decimals for this Pacific token, so don’t assume them. Divide the raw result by `10 ** decimals` for the display amount.';
  const a = analyseExplanation(real);
  assert.equal(a.scale, null);
  assert.equal(a.scaleConflict, null);
  assert.deepEqual(a.followUps.map((f) => f.fn), ['decimals()(uint8)']);
  assert.equal(analyseExplanation('Divide the raw value by `10 ** 6`.').scale.exp, 6);
});

test('"smallest units" asks for decimals(); an explanation that asks for nothing asks for nothing', () => {
  assert.deepEqual(analyseExplanation(BALANCE_ANSWER).followUps.map((f) => f.fn), ['decimals()(uint8)']);
  const none = analyseExplanation('It returns the address of the pair’s first token. See [Pools](/pools).');
  assert.deepEqual([none.scale, none.pair, none.followUps], [null, null, []]);
});

test('scale notations: 10^N, 10**N, 1eN, a power of ten with commas, N decimals', () => {
  for (const [text, exp] of [['Divide the value by 10^8.', 8], ['Divide the value by `10**6`.', 6], ['divide by 1e9', 9], ['Divide it by 1,000,000,000,000,000,000.', 18], ['The token has 4 decimals.', 4]]) assert.equal(analyseExplanation(text).scale?.exp, exp, text);
  assert.equal(analyseExplanation('Divide by 10^decimals.').scale, null);
  assert.equal(analyseExplanation('Divide by 1234.').scale, null, 'a number that is not a power of ten is not a scale');
});

test('two different scales in one explanation are reported as a contradiction, not guessed', () => {
  const a = analyseExplanation('It has 6 decimals. Divide the value by 10^18.');
  assert.equal(a.scale, null);
  assert.deepEqual(a.scaleConflict.sort(), [18, 6]);
});

test('a documented heartbeat is read, in seconds, minutes or hours', () => {
  assert.equal(analyseExplanation('This feed has a 3600-second heartbeat.').heartbeat.sec, 3600);
  assert.equal(analyseExplanation('It updates with a heartbeat of 900 seconds.').heartbeat.sec, 900);
  assert.equal(analyseExplanation('A 1-hour heartbeat applies.').heartbeat.sec, 3600);
  assert.equal(analyseExplanation('It uses a 15 minute heartbeat.').heartbeat.sec, 900);
  assert.equal(analyseExplanation('No staleness is documented.').heartbeat, null);
});

test('freshness: latestTimestamp() is followed only when the explanation names it AND talks about freshness', () => {
  assert.ok(analyseExplanation(FEED_ANSWER).followUps.some((f) => f.fn.startsWith('latestTimestamp')));
  assert.equal(analyseExplanation('Call `latestTimestamp()` to see the time.').followUps.some((f) => f.fn.startsWith('latestTimestamp')), false);
  assert.equal(analyseExplanation('Check freshness using the documented timestamp method.').followUps.some((f) => f.fn.startsWith('latestTimestamp')), false);
});

test('an answer that cannot confirm the contract is general knowledge, but "the docs do not list decimals" is documentation', () => {
  assert.equal(isHedged(HEDGED_ANSWER), true);
  assert.equal(isHedged(USDC_DECIMALS_ANSWER), false);
  assert.equal(isHedged(FEED_ANSWER), false);
});

// ---- the agent, end to end, on scripted servers ----------------------------------------------------------------------------------
function servers({ rpcMode = 'mirror', answer = FEED_ANSWER, decimals = 18, timestamp = MON - 1500, balance = 80456378420027975000000n, hasDecimals = true, code = '0x6080', callFails = null, docsFails = false } = {}) {
  const calls = [];
  const chain = {
    calls,
    callTool: async (name, args) => {
      calls.push({ server: 'chain', name, args });
      if (name === 'get_block_number') return { blockNumber: '1000' };
      if (name === 'get_block') return { number: '0x' + args.block.toString(16), timestamp: '0x' + BigInt(MON).toString(16) };
      if (name === 'get_code') return { code };
      if (name === 'eth_call') {
        const d = args.transaction.data;
        if (d === '0x313ce567') {
          if (!hasDecimals) throw Object.assign(new Error('eth_call: ' + JSON.stringify({ error: { message: 'execution reverted', code: 3, data: '0x' } })), { tool: 'eth_call' });
          return { result: '0x' + word(decimals) };
        }
        if (d === '0x8205bf6a') return { result: '0x' + word(timestamp) };
        if (callFails) throw callFails;
        return { result: '0x' + word(balance) };
      }
      throw new Error(`unexpected chain tool ${name}`);
    },
  };
  const rpc = async (method, params) => {
    calls.push({ server: 'rpc', name: method, args: params });
    if (rpcMode === 'down') throw new Error('rate limited');
    if (typeof rpcMode === 'function') return rpcMode(method, params);
    const out = await chain.callTool('eth_call', { transaction: params[0], block: parseInt(params[1], 16) });
    calls.pop(); // the mirrored read is the RPC's, not a second Chain MCP call
    return out.result;
  };
  const docs = {
    calls,
    callTool: async (name, args) => {
      calls.push({ server: 'docs', name, args });
      if (docsFails) throw new Error('Docs MCP timed out');
      if (name === 'askQuestion') return answer;
      if (name === 'searchDocumentation') return 'Title: Chainlink Push Engine Feeds\nLink: https://docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe\nContent: feeds';
      throw new Error(`unexpected docs tool ${name}`);
    },
  };
  return { chain, docs, rpc, calls };
}
const run = (s, o = {}) => runAgent({ chain: s.chain, docs: s.docs, rpc: s.rpc, contract: FEED, signature: 'latestAnswer()(int256)', ...o });

test('EXPLAINED: the docs’ scale is applied, confirmed by decimals(), and freshness is reported', async () => {
  const s = servers();
  const r = await run(s);
  assert.equal(r.verdict.status, 'explained');
  assert.equal(r.explanation.kind, 'documented');
  assert.deepEqual(r.explanation.sources.map((x) => [x.title, x.cited]), [['Chainlink Push Engine Feeds', true]]);
  assert.equal(r.interpretation.value.scaled, '80,456.37842');
  assert.equal(r.interpretation.value.unit, 'BTC/USD');
  assert.equal(r.interpretation.scaleSource, 'docs and chain agree');
  assert.equal(r.interpretation.freshness.ageSec, 1500);
  assert.match(r.interpretation.summary, /last updated 25 min before this block/);
  assert.deepEqual(r.interpretation.checks.map((c) => [c.name, c.ok]), [['the documented scale matches the contract’s decimals()', true], ['Chain MCP’s answers match the public RPC', true], ['freshness, as the explanation asks', true]]);
});

test('the explanation decides which Chain MCP calls are made: docs first, then the call, then ONLY the follow-ups it asked for', async () => {
  const s = servers();
  const r = await run(s);
  const order = r.steps.map((x) => `${x.actor}:${x.name}`);
  assert.ok(order.indexOf('docs-mcp:askQuestion') < order.indexOf('agent:read-explanation'));
  assert.ok(order.indexOf('agent:read-explanation') < order.indexOf('agent:call-result'));
  assert.ok(order.indexOf('agent:call-result') < order.indexOf('agent:follow-up decimals'));
  assert.deepEqual(r.followUps.map((f) => f.fn), ['decimals()', 'latestTimestamp()']);
  // a plain explanation that asks for nothing produces no extra calls
  const plain = servers({ answer: 'It returns the pair’s first token address. See [Pools](https://docs.pharos.xyz/pools).\n\n# Sources\n\n- [Pools](https://docs.pharos.xyz/pools)' });
  const r2 = await run(plain, { contract: PAIR, signature: 'latestAnswer()(int256)' });
  assert.equal(r2.followUps.length, 0);
  assert.equal(plain.calls.filter((c) => c.server === 'chain' && c.name === 'eth_call').length, 1);
});

test('every "uses" points at an earlier step, and the interpretation cites the explanation, the call and the follow-ups', async () => {
  const r = await run(servers());
  for (const s of r.steps.filter((x) => x.actor === 'agent')) for (const u of s.uses) assert.ok(u < s.n, `${s.name} uses ${u}`);
  const interp = r.steps.find((x) => x.name === 'interpret');
  const names = interp.uses.map((u) => r.steps.find((x) => x.n === u).name);
  assert.ok(names.includes('read-explanation') && names.includes('eth_call') && names.some((n) => n.startsWith('follow-up')));
  assert.deepEqual(r.steps.map((x) => x.n), r.steps.map((_, i) => i + 1));
});

test('with a documented heartbeat the age is judged against it: within it passes, past it is flagged', async () => {
  const ans = FEED_ANSWER.replace('Before using it,', 'This feed has a 3600-second heartbeat. Before using it,');
  const ok = await run(servers({ answer: ans, timestamp: MON - 1500 }));
  const c1 = ok.interpretation.checks.find((c) => /heartbeat/.test(c.name));
  assert.equal(c1.ok, true);
  assert.match(c1.detail, /within that/);
  const stale = await run(servers({ answer: ans, timestamp: MON - 7200 }));
  const c2 = stale.interpretation.checks.find((c) => /heartbeat/.test(c.name));
  assert.equal(c2.ok, false);
  assert.match(c2.detail, /OVER that/);
});

test('CONFLICT: when the docs state a scale the contract’s decimals() contradicts, the chain wins and the disagreement is reported', async () => {
  const r = await run(servers({ decimals: 8, balance: 8045637842002n }));
  const check = r.interpretation.checks.find((c) => /matches/.test(c.name));
  assert.equal(check.ok, false);
  assert.match(check.detail, /the docs say 10\^18 but the contract says decimals\(\) = 8/);
  assert.equal(r.interpretation.value.exp, 8);
  assert.equal(r.interpretation.value.scaled, '80,456.37842');
  assert.match(r.interpretation.scaleSource, /chain \(decimals\(\)\); the docs disagree/);
});

test('"call decimals()" explanations use the chain’s decimals; a contract with no decimals() skips that check and says so', async () => {
  const s = servers({ answer: USDC_DECIMALS_ANSWER, decimals: 6, balance: 25022804975936n });
  const r = await run(s, { contract: USDC, signature: 'totalSupply()(uint256)' });
  assert.equal(r.interpretation.value.scaled, '25,022,804.975936');
  assert.match(r.interpretation.scaleSource, /chain \(decimals\(\)\)/);
  const none = await run(servers({ answer: USDC_DECIMALS_ANSWER, hasDecimals: false }), { contract: USDC, signature: 'totalSupply()(uint256)' });
  assert.equal(none.interpretation.value, null, 'no scale known: the raw value is shown, not a guess');
  assert.match(none.steps.find((x) => x.name === 'follow-up decimals').summary, /does not answer decimals\(\)/);
});

test('small values keep their digits (a 0.0000676 balance is not printed as 0.000067)', async () => {
  const r = await run(servers({ answer: BALANCE_ANSWER, decimals: 18, balance: 67631379885632n }), { contract: WPROS, signature: 'balanceOf(address)(uint256)', args: [PAIR] });
  assert.equal(r.interpretation.value.scaled, '0.0000676313');
});

test('negative numbers are scaled with their sign', async () => {
  const r = await run(servers({ balance: (1n << 256n) - 5000000000000000000n }));
  assert.equal(r.interpretation.value.scaled, '-5');
});

test('GENERAL-ONLY: a hedged answer is shown but nothing from it is applied; the raw value is still read from the chain', async () => {
  const hedged = 'If this is a Chainlink-style feed, `latestAnswer()` returns the latest price. I can’t confirm this contract’s ABI from the available docs. See [JSON-RPC API Methods](/api-and-sdk/json-rpc-methods).\n\n# Sources\n\n- [JSON-RPC API Methods](https://docs.pharos.xyz/api-and-sdk/json-rpc-methods)';
  const r = await run(servers({ answer: hedged, balance: 5n }));
  assert.equal(r.verdict.status, 'general-only');
  assert.equal(r.explanation.kind, 'general');
  assert.equal(r.interpretation.value, null);
  assert.equal(r.followUps.length, 0, 'a general answer triggers no follow-up calls');
  assert.match(r.verdict.headline, /DO NOT COVER THIS CONTRACT/);
  assert.ok(r.explanation.text.includes('Chainlink-style'), 'the text is kept for the reader');
  assert.equal(r.call.values[0].text, '5');
});

test('NONE: a refusal means no explanation; the agent still calls the function and shows the raw value', async () => {
  const r = await run(servers({ answer: REFUSAL, balance: 7n }));
  assert.equal(r.verdict.status, 'unexplained');
  assert.equal(r.explanation.kind, 'none');
  assert.equal(r.call.values[0].text, '7');
  assert.equal(r.interpretation.value, null);
});

test('an answer that never names the function or the address is not an explanation of it', async () => {
  const r = await run(servers({ answer: 'Pharos is a Layer 1. See [About](https://docs.pharos.xyz/introduction/readme).\n\n# Sources\n\n- [About](https://docs.pharos.xyz/introduction/readme)' }));
  assert.equal(r.explanation.kind, 'none');
  assert.match(r.explanation.reason, /mentions none of/);
});

test('STOP: no contract at the address means the docs are not even asked', async () => {
  const s = servers({ code: '0x' });
  const r = await run(s);
  assert.equal(r.verdict.status, 'stop');
  assert.equal(r.verdict.stage, 'contract');
  assert.equal(s.calls.filter((c) => c.server === 'docs').length, 0);
  assert.equal(s.calls.filter((c) => c.name === 'eth_call').length, 0);
});

test('STOP: a reverting function is reported with the decoded reason, after the explanation was fetched', async () => {
  const errorString = (t) => '0x08c379a0' + word(0x20) + word(t.length) + Buffer.from(t).toString('hex').padEnd(64, '0');
  const revert = new Error('eth_call: ' + JSON.stringify({ error: { message: 'execution reverted: no data present', code: 3, data: errorString('no data present') } }));
  const r = await run(servers({ callFails: revert }));
  assert.equal(r.verdict.stage, 'call');
  assert.equal(r.verdict.reason, 'no data present');
  assert.equal(r.explanation.kind, 'documented');
});

test('STOP: an answer that is not the declared type is refused, not printed as nonsense', async () => {
  const s = servers({ balance: 300n });
  const r = await run(s, { signature: 'latestAnswer()(uint8)' });
  assert.equal(r.verdict.stage, 'decode');
  assert.match(r.verdict.reason, /does not fit in uint8/);
});

test('arguments are encoded into the call, and a wrong argument count is a UserError before any server is asked', async () => {
  const s = servers({ answer: BALANCE_ANSWER, decimals: 18, balance: 5n });
  await run(s, { contract: WPROS, signature: 'balanceOf(address)(uint256)', args: [PAIR] });
  const call = s.calls.find((c) => c.server === 'chain' && c.name === 'eth_call' && c.args.transaction.data.startsWith('0x70a08231'));
  assert.equal(call.args.transaction.data, '0x70a08231' + PAIR.slice(2).padStart(64, '0'));
  const s2 = servers();
  await assert.rejects(run(s2, { contract: WPROS, signature: 'balanceOf(address)(uint256)', args: [] }), UserError);
  await assert.rejects(run(s2, { contract: '0x12' }), /contract must be a 0x address/);
  assert.equal(s2.calls.length, 0);
});

test('a pinned block is used for every Chain MCP call and must be in range', async () => {
  const s = servers();
  const r = await run(s, { block: 777 });
  assert.equal(r.block.number, 777);
  assert.ok(s.calls.filter((c) => c.server === 'chain' && (c.name === 'eth_call' || c.name === 'get_code' || c.name === 'get_block')).every((c) => (c.args.block ?? c.args.transaction?.block) === 777 || c.args.block === 777));
  for (const bad of [0, -3, 1.5, 999]) await assert.rejects(run(servers(), { block: bad }), /block must be a whole number from 1 to 998/, String(bad));
});

test('read-only: the agent only ever asks the chain to read', async () => {
  const s = servers();
  await run(s);
  const tools = new Set(s.calls.filter((c) => c.server === 'chain').map((c) => c.name));
  assert.deepEqual([...tools].sort(), ['eth_call', 'get_block', 'get_block_number', 'get_code']);
  assert.equal([...tools].some((t) => /send|sign|raw/i.test(t)), false);
});

test('a Docs MCP failure is an error, never a quiet "no explanation"', async () => {
  await assert.rejects(run(servers({ docsFails: true })), /Docs MCP timed out/);
});

// ---- read integrity: every Chain MCP read is repeated on the public RPC -----------------------------------------------------------------
import { UnstableReadError } from '../lib/stable.js';

test('every eth_call is confirmed by the public RPC, and the run says how many were', async () => {
  const s = servers();
  const r = await run(s);
  assert.equal(r.integrity.checked, 3);
  assert.equal(r.integrity.confirmed, 3);
  assert.equal(s.calls.filter((c) => c.server === 'rpc').length, 3);
  assert.equal(r.rpcCalls, 3);
  assert.equal(r.call.integrity, 'confirmed');
  assert.match(r.interpretation.checks.find((c) => /public RPC/.test(c.name)).detail, /3 of 3 reads confirmed by the public RPC/);
  assert.ok(r.steps.some((x) => x.actor === 'public-rpc'));
});

test('a Chain MCP backend that answers with the wrong state is caught: the second read agrees with the RPC and the first is discarded', async () => {
  const s = servers();
  let n = 0;
  const realChain = s.chain.callTool;
  const WRONG = '0x' + word(81_587_269_156_493_475_000_000n);
  s.chain.callTool = async (name, args) => {
    const out = await realChain(name, args);
    if (name === 'eth_call' && args.transaction.data === '0x50d25bcd' && n++ === 0) return { result: WRONG }; // only the very first latestAnswer() read is wrong
    return out;
  };
  const r = await run(s);
  assert.equal(r.call.integrity, 'resolved');
  assert.equal(r.interpretation.value.scaled, '80,456.37842', 'the value from the agreeing reads is used, not the wrong one');
  assert.ok(r.steps.some((x) => x.name === 'read-resolved'));
  assert.equal(r.integrity.resolved, 1);
});

test('the public RPC being the odd one out is also caught', async () => {
  const s = servers();
  let n = 0;
  const mirror = s.rpc;
  const rpc = async (method, params) => {
    const out = await mirror(method, params);
    return params[0].data === '0x50d25bcd' && n++ === 0 ? '0x' + word(1n) : out;
  };
  const r = await runAgent({ chain: s.chain, docs: s.docs, rpc, contract: FEED, signature: 'latestAnswer()(int256)' });
  assert.equal(r.call.integrity, 'resolved');
  assert.equal(r.interpretation.value.scaled, '80,456.37842');
});

test('a disagreement that re-reading cannot settle stops the run: no value is reported', async () => {
  const s = servers();
  let n = 1;
  const realChain = s.chain.callTool;
  s.chain.callTool = async (name, args) => {
    const out = await realChain(name, args);
    return name === 'eth_call' && args.transaction.data === '0x50d25bcd' ? { result: '0x' + word(BigInt(100 + n++)) } : out; // a different answer every time
  };
  await assert.rejects(run(s), UnstableReadError);
});

test('if the public RPC cannot answer, the read stands and is marked unconfirmed, not silently trusted', async () => {
  const s = servers({ rpcMode: 'down' });
  const r = await run(s);
  assert.equal(r.verdict.status, 'explained');
  assert.equal(r.call.integrity, 'inconclusive');
  assert.equal(r.integrity.inconclusive, 3);
  assert.match(r.interpretation.checks.find((c) => /public RPC/.test(c.name)).detail, /3 could not be checked/);
});
