// Live audit against a deployed site. Every check is a statement about the brief or about
// correct error handling, with a PASS/FAIL. Sequential on purpose (the upstream node and MCP
// server are fragile under concurrency).
const BASE = process.argv[2] ?? 'https://pharos-agent-kit.vercel.app';
const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const MORPHO = '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb';
const results = [];
let section = '';
class Skip extends Error {}
const sec = (s) => { if (process.env.ONLY && !s.startsWith(process.env.ONLY)) throw new Skip(); section = s; console.log(`\n### ${s}`); };
async function get(path, init) {
  const t = Date.now();
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(170_000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ms: Date.now() - t };
}
const q = (o) => '?' + new URLSearchParams(o);
const run = (slug, o = {}, init) => get('/api/run' + q({ slug, ...o }), init);
function check(name, ok, detail = '') {
  results.push({ section, name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${String(detail).slice(0, 150)}]` : ''}`);
}
// The Docs server answers in 13-27 s, so Docs-heavy checks run in small concurrent batches, and an upstream 5xx (slowness, not a
// wrong answer) is retried before a check is judged.
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = async (items, n, fn) => {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i); }));
  return out;
};
const withRetry = async (call, tries = 3) => {
  let r;
  for (let i = 0; i < tries; i++) { r = await call(); if (r.status < 500) return r; await sleepMs(3000); }
  return r;
};
const docsData = async (question) => (await withRetry(() => get('/api/docs' + q({ q: question })))).body?.data;
const is400 = (r) => r.status === 400 && r.body?.ok === false && typeof r.body.error === 'string';
const guard = async (fn) => { try { await fn(); } catch (e) { if (!(e instanceof Skip)) check('(audit step did not crash)', false, e.message); } };

await guard(async () => {
  sec('1 Read Contract State');
  const r = await get('/api/read' + q({ address: USDC, holder: '0x768b959191ce5876cabbbc014a08d72615bdde54' }));
  const d = r.body?.data;
  check('answers ok with a trace', r.status === 200 && r.body.ok && r.body.trace.calls.length > 5, `${r.body?.trace?.calls?.length} calls`);
  check('>= 3 different values read (name, symbol, decimals, totalSupply, owner)', d && [d.name, d.symbol, d.decimals, d.totalSupply, d.owner].filter((x) => x != null).length >= 3);
  check('contract address and block number shown', d?.contract === USDC && Number.isInteger(d?.block?.number) && d?.block?.timestamp > 1.7e9);
  check('decimals applied: formatted equals raw / 10^decimals and shows a decimal point', d && d.totalSupply.formatted.includes('.') && Math.abs(Number(d.totalSupply.formatted.replace(/,/g, '')) - Number(d.totalSupply.raw) / 10 ** d.decimals) < 1e-3 && d.totalSupply.formatted !== d.totalSupply.raw);
  check('addresses labelled (owner described, holder described)', !!d?.owner?.description && !!d?.balances?.[0]?.description);
  check('cross-check against the public RPC: no mismatch', d?.crosscheck && d.crosscheck.mismatch === 0 && d.crosscheck.match >= 3 && d.crosscheck.match + d.crosscheck.inconclusive === d.crosscheck.total, // inconclusive = the public RPC did not answer; only a mismatch is a finding
   JSON.stringify({ m: d?.crosscheck?.match, i: d?.crosscheck?.inconclusive }));
  const hexBlock = '0x' + d.block.number.toString(16);
  const isLatestCheck = (c) => /latest block/i.test(c.why ?? ''); // the wallet double-check reads the latest block on purpose
  const mcpCalls = r.body.trace.calls.filter((c) => c.kind === 'mcp' && ['eth_call', 'get_code', 'get_block'].includes(c.tool));
  const pinnedCalls = mcpCalls.filter((c) => !isLatestCheck(c));
  check('every MCP eth_call/get_code/get_block is pinned to the displayed block (except labelled latest-block checks)', pinnedCalls.length >= 5 && pinnedCalls.every((c) => (c.args.block ?? c.args.transaction?.block) === d.block.number), `${pinnedCalls.length} pinned, ${mcpCalls.length - pinnedCalls.length} latest-block checks`);
  const headCall = r.body.trace.calls.find((c) => c.tool === 'get_block_number');
  const head = Number(JSON.parse(headCall?.result?.text ?? '{}').blockNumber);
  check('the displayed block is exactly 2 behind the head reported in the same trace', Number.isFinite(head) && d.block.number === head - 2, `head ${head}, shown ${d.block.number}`);
  const rpcCalls = r.body.trace.calls.filter((c) => c.kind === 'rpc' && c.tool === 'eth_call');
  check('the independent RPC replay is pinned to the same block (hex), batched into few requests', rpcCalls.length >= 1 && rpcCalls.length <= 3 && rpcCalls.every((c) => c.args[1] === hexBlock), `${rpcCalls.length} request(s)`);
  const w = await get('/api/read' + q({ address: '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0' }));
  check('a contract without owner() shows null, not an error', w.body?.ok && w.body.data.owner === null);
  check('rejects a short address with 400', is400(await get('/api/read' + q({ address: '0x12' }))));
  check('rejects 4 holders with 400', is400(await get('/api/read' + q({ address: USDC, holder: [1, 2, 3, 4].map((n) => '0x' + String(n).repeat(40)).join(',') }))));
  check('rejects a non-numeric block with 400', is400(await get('/api/read' + q({ address: USDC, block: 'abc' }))));
  const eoa = await get('/api/read' + q({ address: '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92' }));
  check('a wallet (no code) gives a clear 400, not a crash', is400(eoa) && /no contract code/.test(eoa.body.error), eoa.body?.error);
  check('missing address defaults safely or 400, never 500', [200, 400].includes((await get('/api/read')).status));
});

await guard(async () => {
  sec('2 Event/Log Monitor');
  const h = await get('/api/logs' + q({ address: USDC }));
  check('without from: reports head, no events', h.body?.ok && h.body.data.events.length === 0 && h.body.data.nextFrom === h.body.data.head + 1);
  const head = h.body.data.head;
  const a = await get('/api/logs' + q({ address: USDC, from: head - 300 }));
  const ev = a.body?.data?.events ?? [];
  check('backfill returns decoded events', ev.length > 0 && ev.every((e) => e.event === 'Transfer' && e.from && e.to && e.amount?.formatted && e.txHash && e.block));
  check('filtered by contract and event: every log is from this contract', a.body.trace.calls.filter((c) => c.tool === 'get_logs').every((c) => c.args.address === USDC && c.args.topics[0].startsWith('0xddf252ad')));
  const keys = ev.map((e) => `${e.txHash}:${e.logIndex}`);
  check('no duplicate (txHash, logIndex) in one scan', new Set(keys).size === keys.length);
  check('events sorted by block then log index', ev.every((e, i) => i === 0 || e.block > ev[i - 1].block || (e.block === ev[i - 1].block && e.logIndex > ev[i - 1].logIndex)));
  const b = await get('/api/logs' + q({ address: USDC, from: head - 300 }));
  const overlap = (b.body.data.events ?? []).filter((e) => keys.includes(`${e.txHash}:${e.logIndex}`)).length;
  check('re-scanning the same range returns the same logs (stable ids)', overlap >= Math.min(ev.length, 1) || ev.length === 0);
  check('windows never exceed 1000 blocks (server cap)', a.body.trace.calls.filter((c) => c.tool === 'get_logs').every((c) => c.args.toBlock - c.args.fromBlock + 1 <= 1000));
  check('rejects unknown event with 400', is400(await get('/api/logs' + q({ address: USDC, event: 'Nope' }))));
  check('rejects bad address with 400', is400(await get('/api/logs' + q({ address: 'x' }))));
  check('rejects non-numeric from with 400', is400(await get('/api/logs' + q({ address: USDC, from: 'abc' }))));
  const far = await get('/api/logs' + q({ address: USDC, from: 1 }));
  check('from=1 is clamped to 5,000 blocks behind (no huge scan)', far.body?.ok && far.body.data.clamped === true && far.body.data.scanned.from >= far.body.data.head - 5000);
  const fut = await get('/api/logs' + q({ address: USDC, from: head + 1_000_000 }));
  check('from in the future returns no events and does not crash', fut.status === 200 && fut.body.data.events.length === 0);
});

await guard(async () => {
  sec('3 Doc-Search');
  const g = await withRetry(() => get('/api/docs' + q({ q: 'How do I deploy a smart contract with Foundry?' })));
  check('a real question is found with sources', g.body?.data?.found === true && g.body.data.sources.length >= 1 && g.body.data.sources.every((s) => /^https:\/\/docs\.pharos\.xyz/.test(s.url)), `${g.body?.data?.sources?.length} sources`);
  check('answer is concise (< 1500 chars)', (g.body?.data?.answer ?? '').length < 1500, (g.body?.data?.answer ?? '').length);
  const verdicts = (await pool(Array.from({ length: 10 }), 4, () => docsData('What is the airspeed velocity of an unladen swallow in Pharos?'))).map((d) => d?.found);
  check('nonsense question refused 10/10 times (no invented answer)', verdicts.every((v) => v === false), JSON.stringify(verdicts));
  const offTopic = await pool(Array.from({ length: 6 }), 4, () => docsData('How do I bake sourdough bread?'));
  check('off-topic question #2 is also refused 6/6 times', offTopic.every((d) => d?.found === false), JSON.stringify(offTopic.map((d) => d?.found)));
  check('refusal shows no answer text, only related pages', offTopic.every((d) => d?.answer === null));
  const real = ['How do I deploy a smart contract with Foundry?', 'How do I become a validator?', 'What are the Atlantic testnet RPC and chain id?'];
  const realAns = (await pool(real, 3, docsData)).map((d) => d?.found);
  check('real questions are not refused by the new support check', realAns.every(Boolean), JSON.stringify(realAns));
  check('2-char question rejected with 400', is400(await get('/api/docs' + q({ q: 'hi' }))));
  check('301-char question rejected with 400', is400(await get('/api/docs' + q({ q: 'a'.repeat(301) }))));
  check('empty question rejected with 400', is400(await get('/api/docs')));
});

await guard(async () => {
  sec('4 Docs MCP Onboarding');
  const p = await run('docs-mcp-onboarding', { step: 'plan' });
  check('plan lists >= 8 questions', p.body?.data?.steps?.length >= 8);
  check('unknown step rejected with 400', is400(await run('docs-mcp-onboarding', { step: 'nope' })));
  const rp = await run('docs-mcp-onboarding', { step: 'report' }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ results: [{ goal: 'g', question: 'q?', answer: 'a', checks: [{ name: 'n', ok: false, detail: 'd' }], gap: { title: 'T', evidence: ['e'], fix: 'f' } }], finale: { built: ['b'], couldNot: ['c'] } }) });
  check('report built from POSTed results has gap, exact query, fix', /Gap 1: T/.test(rp.body?.data?.markdown ?? '') && /Exact query:\*\* `q\?`/.test(rp.body.data.markdown) && /should say:\*\* f/.test(rp.body.data.markdown));
  check('report without a body rejected with 400', is400(await run('docs-mcp-onboarding', { step: 'report' })));
  const f = await run('docs-mcp-onboarding', { step: 'finale' });
  check('finale reports what was run, chain 1672, and what could not be done', f.body?.data?.built?.length >= 3 && f.body.data.chainId === 1672 && f.body.data.couldNot.length >= 1);
  const all = [];
  all.push(...(await pool(p.body.data.steps, 3, async (s) => { const r = await withRetry(() => run('docs-mcp-onboarding', { step: s.id })); return { id: s.id, ok: r.status === 200, gap: r.body?.data?.gap?.title, checks: r.body?.data?.checks?.length }; })));
  check('every one of the steps answers without a server error', all.every((x) => x.ok), JSON.stringify(all.filter((x) => !x.ok)));
  const gaps = all.filter((x) => x.gap);
  check('at least 3 concrete gaps found in this live run', gaps.length >= 3, gaps.map((g) => g.id).join(','));
  check('every step ran at least one check', all.every((x) => x.checks >= 1));
});

await guard(async () => {
  sec('5 Threshold Guardian');
  const cfg = (gas, move) => JSON.stringify({ name: 't', action: 'a', require: 'all', conditions: [{ id: 'gas', type: 'gas-price', op: '<=', threshold: gas }, { id: 'liq', type: 'token-balance', token: USDC, holder: MORPHO, op: '>=', threshold: 1000 }, { id: 'mv', type: 'share-price-change', vault: '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268', blockWindow: 1500000, op: '>=', threshold: move }] });
  const fire = await run('threshold-guardian', { config: cfg(1000, 0.1) });
  check('lenient config FIRES', fire.body?.data?.decision === 'fire' && fire.body.data.passed === 3, JSON.stringify(fire.body?.data?.results?.map((r) => r.value)));
  const hold = await run('threshold-guardian', { config: cfg(1, 5) });
  check('strict config HOLDS', hold.body?.data?.decision === 'hold' && hold.body.data.passed === 1);
  check('trace has a line per condition + rule + decision', fire.body?.data?.trace?.length === 5 && /^DECISION/.test(fire.body.data.trace[4]));
  check('each result has value, op, threshold, pass', fire.body?.data?.results?.every((r) => typeof r.value === 'number' && r.op && typeof r.threshold === 'number' && typeof r.pass === 'boolean'));
  check('>= 3 independent conditions read from chain (3 distinct tools)', new Set(fire.body.trace.calls.filter((c) => c.kind === 'mcp').map((c) => c.tool)).size >= 3);
  const v = fire.body?.data?.results?.find((r) => r.id === 'mv')?.value;
  check('share-price change sane (0 .. 5 % over 1.5M blocks)', v >= 0 && v < 5, v);
  check('missing config rejected with 400', is400(await run('threshold-guardian')));
  check('invalid JSON rejected with 400', is400(await run('threshold-guardian', { config: '{nope' })));
  check('only 2 conditions rejected with 400', is400(await run('threshold-guardian', { config: JSON.stringify({ conditions: [{ type: 'gas-price', op: '<=', threshold: 1 }, { type: 'gas-price', op: '>', threshold: 0 }] }) })));
  check('string threshold rejected with 400', is400(await run('threshold-guardian', { config: JSON.stringify({ conditions: [{ type: 'gas-price', op: '<=', threshold: '5' }, { type: 'gas-price', op: '>', threshold: 0 }, { type: 'gas-price', op: '<', threshold: 99 }] }) })));
  const bad = await run('threshold-guardian', { config: JSON.stringify({ conditions: [{ id: 'x', type: 'token-balance', token: '0x1111111111111111111111111111111111111111', holder: MORPHO, op: '>=', threshold: 1 }, { type: 'gas-price', op: '<=', threshold: 99 }, { type: 'gas-price', op: '>', threshold: 0 }] }) });
  check('unreadable condition fails safe: marked ERROR, counts as not met', bad.body?.data?.results?.[0]?.pass === false && bad.body.data.decision === 'hold', bad.body?.data?.results?.[0]?.error);
});

await guard(async () => {
  sec('6 Saga Executor');
  const rec = (await run('saga-executor', { scenario: 'recorded' })).body?.data?.recorded;
  check('recorded runs: one completed, one compensated, both as expected, with provenance', rec?.runs?.length === 2 && rec.runs[0].status === 'completed' && rec.runs[1].status === 'compensated' && rec.runs.every((r) => r.finalCheck.clean) && rec.provenance?.forkBlocks?.success > 0 && /anvil/i.test(rec.provenance.anvil ?? ''));
  check('recorded failure shows the real revert reason', /ZeroAddress/.test(rec?.runs?.[1]?.failure?.error ?? ''));
  const bare = await run('saga-executor', { scenario: 'plain' });
  check('the demo has no simulated mode: a bare scenario is refused with a 400 that points to real=start', is400(bare) && /real=start/.test(bare.body?.error ?? ''), bare.body?.error?.slice(0, 60));
  check('unknown scenario rejected with 400', is400(await run('saga-executor', { real: 'start', scenario: 'x' })));
  check('a shell-injection attempt as the scenario is rejected with 400', is400(await run('saga-executor', { real: 'start', scenario: 'plain; id' })));
  check('maxAttempts 9 rejected with 400', is400(await run('saga-executor', { real: 'start', scenario: 'plain', maxAttempts: 9 })));
  check('non-numeric maxAttempts rejected with 400', is400(await run('saga-executor', { real: 'start', scenario: 'plain', maxAttempts: 'abc' })));
  check('a malformed or path-like run id is rejected with 400', is400(await run('saga-executor', { real: 'status', id: '../../etc/passwd' })));
  check('an unknown (well-formed) run id says the run is gone, not an error', (await run('saga-executor', { real: 'status', id: 'saga-plain-zzzzzzzz' })).body?.data?.status?.state === 'gone');

  // One real run, end to end: a throwaway machine forks Pharos mainnet and executes the saga as real transactions.
  const started = (await run('saga-executor', { real: 'start', scenario: 'retry', maxAttempts: 3 })).body;
  check('a real run starts and returns a machine id', /^saga-retry-[a-z0-9]{8}$/.test(started?.data?.started?.id ?? ''), started?.error);
  let st;
  let from = 0;
  const seen = [];
  for (let i = 0; i < 60 && started?.ok; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    st = (await run('saga-executor', { real: 'status', id: started.data.started.id, from })).body?.data?.status;
    if (!st) continue;
    seen.push(...st.events.map((e) => e.event));
    from = st.total;
    if (st.state !== 'running') break;
  }
  const real = st?.result?.runs?.[0];
  check('the real run finished (done) within 3 minutes', st?.state === 'done', st?.error ?? st?.state);
  check('real run: deposit retried twice (injected, labelled), then all three steps confirmed and completed', real?.status === 'completed' && real.steps.every((x) => x.state === 'confirmed') && real.steps[1].attempts === 3 && /injected fault/.test(real.injectedFault ?? ''));
  check('real run: final state as expected (USDC spent, shares with the treasury, allowance 0)', real?.finalCheck?.clean === true && real.finalCheck.allowance === '0' && BigInt(real.finalCheck.treasuryShares) > 0n);
  check('real run: events streamed in order and the stream matches the final log', seen[0] === 'saga:start' && seen.at(-1) === 'saga:completed' && seen.length === real?.log?.length, `${seen.length} streamed, ${real?.log?.length} in the result`);
  check('real run: provenance names the fork block and anvil 1.4.0', st?.result?.provenance?.forkBlocks?.retry > 0 && /1\.4\.0/.test(st.result.provenance.anvil ?? ''), st?.result?.provenance?.anvil);
  check('the machine is gone after the result was read', (await run('saga-executor', { real: 'status', id: started?.data?.started?.id ?? 'saga-plain-zzzzzzzz' })).body?.data?.status?.state === 'gone');
});

await guard(async () => {
  const sv = (o) => run('saga-executor', { real: 'start', ...o });
  check('names every object has are not scenarios (400, not a crash)', is400(await sv({ scenario: '__proto__' })) && is400(await sv({ scenario: 'constructor' })));
});

await guard(async () => {
  sec('7 Arbitrage Scanner');
  const rec = (await run('arbitrage-scanner', { source: 'fork-recorded' })).body?.data?.recorded;
  check('recorded fork run is served: two scenarios with honesty notes', rec?.scenarios?.length === 2 && rec.honesty?.length >= 3);
  const [ra, rb] = rec?.scenarios ?? [];
  check('recorded: the scanner acted and the real EVM matched its prediction', ra?.scan.decision === 'execute-simulated' && ra.execution.status === 'success' && ra.execution.predictionErrorPct < 1e-4 && ra.execution.actualNet > 0);
  check('recorded: the refused trade really lost money', rb?.scan.decision === 'skip' && rb.execution.actualGrossProfit < 0);
  const live = (await run('arbitrage-scanner', { pair: 'WPROS/DLP', size: 1 })).body?.data?.scan;
  check('live scan reads both venues at one block', live?.block > 0 && live.sources.v2.price > 0 && live.sources.v3.price > 0);
  check('decomposition: gross - fees - impact = net before gas', live && Math.abs(live.gross - live.costs.fees - live.costs.priceImpact - live.netBeforeGas) < 1e-9 * Math.max(1, Math.abs(live.gross)));
  check('net = netBeforeGas - gas', live && Math.abs(live.net - (live.netBeforeGas - live.costs.gas)) < 1e-12);
  check('decision matches the threshold rule', live && ((live.decision === 'execute-simulated') === (live.net >= live.minNet && live.reasons.length === 0)));
  check('skip carries at least one reason', live?.decision !== 'skip' || live.reasons.length >= 1);
  check('synthetic data is no longer offered: source=profitable is refused with a 400', is400(await run('arbitrage-scanner', { source: 'profitable', size: 50 })));
  check('synthetic data is no longer offered: source=marginal is refused with a 400', is400(await run('arbitrage-scanner', { source: 'marginal', size: 50 })));
  const pd = (await run('arbitrage-scanner', { pair: 'UNI-V2/PDOG', size: 1 })).body?.data?.scan;
  check('second pair: scans and refuses to guess unpriced gas', pd?.decision === 'skip' && pd.costs.gas === null);
  check('bad pair rejected with 400', is400(await run('arbitrage-scanner', { pair: 'X/Y' })));
  check('negative size rejected with 400', is400(await run('arbitrage-scanner', { size: -1 })));
  check('bad source rejected with 400', is400(await run('arbitrage-scanner', { source: 'bogus' })));
  check('minNet=abc rejected with 400', is400(await run('arbitrage-scanner', { minNet: 'abc' })));
  check('a shell-injection attempt as the real-run scenario is rejected with 400', is400(await run('arbitrage-scanner', { real: 'start', scenario: 'profitable; id' })));
  check('a run id from another demo is rejected with 400', is400(await run('arbitrage-scanner', { real: 'status', id: 'saga-plain-abcd1234' })));
  // The act path, for real: a throwaway machine forks Pharos mainnet and executes both legs on the real FaroSwap contracts.
  const arbStart = (await run('arbitrage-scanner', { real: 'start', scenario: 'profitable' })).body;
  check('a real arbitrage run starts and returns a machine id', /^arb-profitable-[a-z0-9]{8}$/.test(arbStart?.data?.started?.id ?? ''), arbStart?.error);
  let arb;
  let arbFrom = 0;
  const arbSeen = [];
  for (let i = 0; i < 60 && arbStart?.ok; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    arb = (await run('arbitrage-scanner', { real: 'status', id: arbStart.data.started.id, from: arbFrom })).body?.data?.status;
    if (!arb) continue;
    arbSeen.push(...arb.events.map((e) => e.what));
    arbFrom = arb.total;
    if (arb.state !== 'running') break;
  }
  const arbRun = arb?.result?.scenarios?.[0];
  check('the real arbitrage run finished (done)', arb?.state === 'done', arb?.error ?? arb?.state);
  check('real arbitrage: both venues agreed first (no gap), then a real swap made one and the scanner acted', arbRun?.baseline?.decision === 'skip' && Math.abs(arbRun.baseline.grossSpreadPct) < 0.01 && arbRun.scan.decision === 'execute-simulated');
  check('real arbitrage: the EVM paid out what the scanner predicted (within a millionth of a percent) and gas was subtracted', arbRun?.execution?.status === 'success' && arbRun.execution.predictionErrorPct < 1e-4 && arbRun.execution.actualNet > 0 && arbRun.execution.actualNet < arbRun.execution.actualGrossProfit);
  check('real arbitrage: after the trade the scanner skips (the edge is used up); the steps streamed in order', arbRun?.rescan?.decision === 'skip' && arbSeen.length === arbRun.steps.length, `${arbSeen.length} streamed, ${arbRun?.steps?.length} in the result`);
});

await guard(async () => {
  const sc = (o) => run('arbitrage-scanner', o);
  check('pair __proto__ / constructor rejected with 400 (used to be a 500)', is400(await sc({ pair: '__proto__' })) && is400(await sc({ pair: 'constructor' })));
  check('size 1e300 and 1e10 rejected with 400 (used to be a 500: the arithmetic overflowed)', is400(await sc({ size: '1e300' })) && is400(await sc({ size: '1e10' })));
  check('a negative minNet is refused (it would accept a losing trade)', is400(await sc({ minNet: -1 })));
  check('free or negative gas is refused (it would inflate the profit)', is400(await sc({ gasUnitsV2: -100 })) && is400(await sc({ gasUnitsV3: 0 })) && is400(await sc({ gasUnitsV2: 1.5 })));
});

await guard(async () => {
  sec('8 Dry-Run Executor');

  for (const [slug, reportName] of [['dry-run-executor', 'testnet-runs'], ['batch-executor', 'testnet-runs'], ['threshold-guardian', 'testnet-guardian'], ['policy-gatekeeper', 'testnet-gatekeeper']]) {
    const tn = (await run(slug, { real: 'testnet' })).body?.data?.testnet;
    check(`${slug}: the recorded Atlantic testnet run (${reportName}) is served and every transaction verifies on-chain right now`, tn?.report?.mode === 'live' && tn.verification?.total >= 1 && tn.verification.verifiedCount === tn.verification.total, `${tn?.verification?.verifiedCount}/${tn?.verification?.total}`);
    check(`${slug}: the testnet run names a wallet and stayed inside its gas budget`, /^0x[0-9a-fA-F]{40}$/.test(tn?.report?.wallet ?? '') && BigInt(tn?.report?.budget?.spentWei ?? '1') < BigInt(tn?.report?.budget?.limitWei ?? '0'));
  }
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  const dead = '000000000000000000000000000000000000dead';
  const xfer = '0xa9059cbb' + dead.padStart(64, '0') + word(1_000_000);
  const dr = (o) => run('dry-run-executor', { value: '0', ...o });
  const ok = (await dr({ from: MORPHO, to: USDC, data: xfer })).body?.data?.report;
  check('passing transfer: GO, gas cost, before/after, simulated at a block', ok?.verdict === 'go' && ok.gas.units > 20000 && ok.gas.costPros && ok.outcome.rows.length === 2 && ok.block > 0);
  check('prediction arithmetic: after = before - 1 USDC for the sender', ok && (() => { const num = (t) => Number(t.replace(/[^0-9.]/g, '')); return Math.abs(num(ok.outcome.rows[0].before) - num(ok.outcome.rows[0].after) - 1) < 1e-6; })());
  const bad = (await dr({ from: '0x0000000000000000000000000000000000000001', to: USDC, data: xfer })).body?.data?.report;
  check('reverting transfer: BLOCKED with the decoded reason and no gas figure', bad?.verdict === 'blocked' && /exceeds balance/.test(bad.revert.message) && bad.gas === null);
  const un = (await dr({ from: MORPHO, to: USDC, data: '0xdeadbeef' })).body?.data?.report;
  check('unknown selector: BLOCKED, reverted without a reason, outcome says not predictable', un?.verdict === 'blocked' && un.revert.kind === 'empty' && un.outcome.kind === 'unknown');
  const ap = (await dr({ from: MORPHO, to: USDC, data: '0x095ea7b3' + dead.padStart(64, '0') + word(5_000_000) })).body?.data?.report;
  check('approve: GO and allowance 0 -> 5', ap?.outcome?.kind === 'erc20-approve' && /^0 /.test(ap.outcome.rows[0].before) && /^5 /.test(ap.outcome.rows[0].after));
  const nv = (await dr({ from: '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92', to: USDC, data: '0x', value: '1000000000000000' })).body?.data?.report;
  check('PROS to a non-payable contract: BLOCKED', nv?.verdict === 'blocked');
  const eoa = (await dr({ from: '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92', to: '0x000000000000000000000000000000000000dEaD', data: '0x', value: '1000000000000000' })).body?.data?.report;
  check('PROS to a plain address: GO with native before/after', eoa?.verdict === 'go' && eoa.outcome.kind === 'native-transfer');
  check('missing from rejected with 400', is400(await run('dry-run-executor', { to: USDC })));
  check('odd-length data rejected with 400', is400(await dr({ from: MORPHO, to: USDC, data: '0xabc' })));
  check('negative/decimal value rejected with 400', is400(await dr({ from: MORPHO, to: USDC, data: '0x', value: '-1' })) && is400(await dr({ from: MORPHO, to: USDC, data: '0x', value: '1.5' })));
  check('huge value does not crash (0xffff..ff)', [200, 400].includes((await dr({ from: MORPHO, to: USDC, data: '0x', value: '0x' + 'f'.repeat(64) })).status));
});

await guard(async () => {
  const dr = (o) => run('dry-run-executor', { value: '0', ...o });
  check('value above 2^256 wei rejected with 400', is400(await dr({ from: MORPHO, to: USDC, data: '0x', value: '0x' + 'f'.repeat(70) })));
  const broke = await dr({ from: '0x00000000000000000000000000000000000000a1', to: USDC, data: '0x', value: '1' });
  const sum = broke.body?.data?.report?.summary ?? '';
  check('a blocked summary never ends in two full stops', /^The simulation failed: .*[^.]\.$/.test(sum), sum);
});

await guard(async () => {
  sec('9 Trend Watcher');
  const post = (o, state) => run('trend-watcher', o, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
  check('synthetic scenarios are no longer offered: action=scenario is refused with a 400', is400(await post({ action: 'scenario', scenario: 'decline', direction: 'down', observations: 3 }, null)));
  check('rule with 2 observations rejected with 400', is400(await post({ action: 'backfill', metric: 'usdc-supply', observations: 2 }, null)));
  const a = (await post({ action: 'backfill', metric: 'usdc-supply', count: 5, step: 20000, direction: 'down', observations: 3 }, null)).body?.data;
  check('live backfill stores 5 observations on a fixed grid', a?.state?.observations?.length === 5 && a.state.observations.every((o) => o.block % 20000 === 0));
  const b = (await post({ action: 'backfill', metric: 'usdc-supply', count: 5, step: 20000, direction: 'down', observations: 3 }, a.state)).body?.data;
  check('RESTART: same backfill again adds 0 and keeps 5 (nothing lost or duplicated)', b?.results?.every((r) => r.duplicate) && b.state.observations.length === 5);
  check('observations are in block order with timestamps', a?.state?.observations?.every((o, i, arr) => (i === 0 || o.block > arr[i - 1].block) && /UTC$/.test(o.time)));
  const vals = a?.state?.observations?.map((o) => o.value);
  // A node glitch looks like an isolated spike: one point far from BOTH neighbours in the same direction. A real level shift (supply fell 24% and stayed there, confirmed against the public RPC) is not one.
  check('no isolated spike in the series (a wrong-block value would show as one)', vals.every((v, i) => i === 0 || i === vals.length - 1 || !((v > vals[i - 1] * 1.3 && v > vals[i + 1] * 1.3) || (v < vals[i - 1] * 0.7 && v < vals[i + 1] * 0.7))), vals?.join(' '));
  check('count=99 rejected with 400', is400(await post({ action: 'backfill', metric: 'usdc-supply', count: 99 }, null)));
  check('unknown metric rejected with 400', is400(await post({ action: 'backfill', metric: 'nope' }, null)));
  const evil = await run('trend-watcher', { action: 'backfill', metric: 'usdc-supply', count: 3 }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: { version: 1, rule: { direction: 'down', observations: 3 }, observations: 'not-an-array', active: false, events: [] } }) });
  check('a malformed posted history is rejected with a clear 400 (never a 500) that says how to recover', is400(evil) && /Reset saved state/.test(evil.body?.error ?? ''), `${evil.status} ${evil.body?.error?.slice(0, 50)}`);
});

await guard(async () => {
  const tw = (o, init) => run('trend-watcher', o, init);
  check('metric __proto__ / constructor rejected with 400 (used to be a 500)', is400(await tw({ action: 'observe', metric: '__proto__' })) && is400(await tw({ action: 'observe', metric: 'constructor' })));
  check('a step larger than the chain is refused, not answered with nothing', is400(await tw({ action: 'backfill', step: '999999999', count: 3 })));
  const post = (state) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
  const base = { version: 1, rule: {}, active: false, events: [] };
  const o = (b, v = 1) => ({ id: `b${b}`, block: b, time: null, value: v });
  check('a posted history with a block twice, or out of order, is refused with a 400', is400(await tw({ action: 'observe' }, post({ ...base, observations: [o(5), o(5, 2)] }))) && is400(await tw({ action: 'observe' }, post({ ...base, observations: [o(9), o(5)] }))));
  const full = await tw({ action: 'observe' }, post({ ...base, observations: Array.from({ length: 200 }, (_, i) => o(i + 1, 100 - i * 0.1)) }));
  const back = await tw({ action: 'observe' }, post(full.body?.data?.state));
  check('the history is capped at 200: the state handed back after the 201st reading is accepted again', full.body?.data?.state?.observations?.length === 200 && back.body?.ok === true, back.body?.error);
});

await guard(async () => {
  sec('10 Batch Executor');
  const from = '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92';
  const sync = [0, 1, 2].map((i) => ({ to: ['0xb7d5d299c671e4a4c7c0c5a33b812185182fc417', '0xb9f329a51837d27a20dff113679d47d673d5e45b', '0x7F4A462FC320db1E26dd1366DcE9E276eE6c5930'][i], data: '0xfff6cae9' }));
  const bad = { to: USDC, data: '0xdeadbeef' };
  const plan = (actions, o = {}) => run('batch-executor', { from, actions: JSON.stringify(actions), ...o }).then((r) => r.body?.data?.plan);
  const p = await plan(sync);
  check('3 independent actions batched into 1 transaction with a gas comparison', p?.verdict === 'ready' && p.batch.calls === 3 && p.comparison.transactionsBefore === 3 && p.comparison.transactionsAfter === 1);
  check('batch targets Multicall3 and is unsigned (no signature fields)', p?.batch?.to?.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11' && !('r' in p.batch.tx) && !('privateKey' in p.batch.tx));
  check('gas saving figure is consistent with its parts', p?.comparison && p.comparison.gasSaved === p.comparison.soloGasTotal - p.comparison.batchGas);
  const ex = await plan([...sync, bad]);
  check('exclude policy: failing action named, rest batched', ex?.excluded?.length === 1 && ex.excluded[0].id === 'a4' && ex.included.length === 3);
  const ab = await plan([...sync, bad], { onFailure: 'abort' });
  check('abort policy: nothing prepared, all four reported', ab?.verdict === 'nothing-to-send' && ab.batch === null && ab.actions.length === 4);
  const nat = await plan([{ to: '0x1111111111111111111111111111111111111111', amountPros: '0.001' }, { to: '0x2222222222222222222222222222222222222222', amountPros: '0.002' }, { to: '0x3333333333333333333333333333333333333333', amountPros: '0.003' }]);
  check('native transfers: value summed, and the batch is reported as COSTING more', nat?.batch?.valuePros === '0.006' && nat.comparison.gasSaved < 0);
  const e20 = await run('batch-executor', { from, actions: JSON.stringify([{ to: USDC, data: '0xa9059cbb' + '0'.repeat(128) }, ...sync]) });
  check('ERC-20 transfer refused with the Multicall3 explanation (400)', is400(e20) && /Multicall3/.test(e20.body.error), e20.body?.error?.slice(0, 80));
  check('only 2 actions rejected with 400', is400(await run('batch-executor', { from, actions: JSON.stringify(sync.slice(0, 2)) })));
  check('26 actions rejected with 400', is400(await run('batch-executor', { from, actions: JSON.stringify(Array.from({ length: 26 }, () => sync[0])) })));
  check('invalid actions JSON rejected with 400', is400(await run('batch-executor', { from, actions: '{nope' })));
  check('bad onFailure rejected with 400', is400(await run('batch-executor', { from, actions: JSON.stringify(sync), onFailure: 'yolo' })));
  check('bad amount rejected with 400', is400(await plan2()));
  async function plan2() { return run('batch-executor', { from, actions: JSON.stringify([{ to: sync[0].to, amountPros: '1e3' }, sync[1], sync[2]]) }); }
});

await guard(async () => {
  const from = '0x9f8ea09770dc38fc61f5a62031b3be0526d54d92';
  const sync = ['0xb7d5d299c671e4a4c7c0c5a33b812185182fc417', '0xb9f329a51837d27a20dff113679d47d673d5e45b', '0x7F4A462FC320db1E26dd1366DcE9E276eE6c5930'].map((to) => ({ to, data: '0xfff6cae9' }));
  const bt = (actions) => run('batch-executor', { from, actions: JSON.stringify(actions) });
  const s0 = sync[0], s1 = sync[1], s2 = sync[2];
  check('a null or non-object action is a 400 (used to be a 500)', is400(await bt([null, s1, s2])) && is400(await bt([1, s1, s2])));
  check('non-string data is a 400 (used to be a 500)', is400(await bt([{ to: s0.to, data: 5 }, s1, s2])));
  check('two actions with the same id are refused', is400(await bt([{ id: 'x', to: s0.to }, { id: 'x', to: s1.to }, { id: 'y', to: s2.to }])));
  check('an id that is not a short plain label is refused (markup, objects, too long)', is400(await bt([{ id: '<img src=x onerror=alert(1)>', to: s0.to }, s1, s2])) && is400(await bt([{ id: { a: 1 }, to: s0.to }, s1, s2])));
  check('a wrapped-token deposit() is refused: the tokens would be credited to Multicall3', is400(await bt([{ to: s0.to, data: '0xd0e30db0' }, s1, s2])));
  check('an ERC-4626 vault deposit is refused for the same reason', is400(await bt([{ to: s0.to, data: '0x6e553f65' + '00'.repeat(64) }, s1, s2])));
});

await guard(async () => {
  sec('11 Policy Gatekeeper');
  const post = (body, o = {}) => run('policy-gatekeeper', o, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ex = (await run('policy-gatekeeper', { example: '1' })).body?.data;
  check('example policy and requests are served', ex?.policy?.rules?.length === 4 && ex.requests?.length === 8);
  const g = (await post({ policy: ex.policy, requests: ex.requests })).body?.data?.gate;
  check('example: 2 allowed, 6 denied; the executor ran for the 2 allowed and for no denied request', g?.summary?.allowed === 2 && g.summary.denied === 6 && g.summary.executorCalls === 2 && g.summary.deniedThatReachedTheExecutor === 0);
  check('example: a deny for each rule type, each naming its rule', ['native-spend', 'known-targets', 'known-functions', 'office-hours', 'request-shape'].every((id) => g?.summary?.deniedByRule?.[id] >= 1));
  check('example: audit log has a decision and an outcome per request and verifies', g?.log?.length === 16 && g.integrity?.ok === true);
  const t = (await post({ policy: ex.policy, requests: ex.requests, tamper: 2 })).body?.data?.tamper;
  check('tampering with entry 2 is detected', t?.integrity?.ok === false && /entry 2/.test(t.integrity.problems[0].problem));
  check('tamper index out of range rejected with 400', is400(await post({ policy: ex.policy, requests: ex.requests, tamper: 99 })));
  check('policy with only two rule types rejected with 400', is400(await post({ policy: { ...ex.policy, rules: ex.policy.rules.filter((r) => r.type !== 'time-window') }, requests: ex.requests })));
  check('empty request list rejected with 400', is400(await post({ policy: ex.policy, requests: [] })));
  check('bad "at" rejected with 400', is400(await post({ policy: ex.policy, requests: [{ ...ex.requests[0], at: 'soon' }] })));
  check('GET without a body rejected with 400', is400(await run('policy-gatekeeper')));
  const live = (await post({ policy: ex.policy, requests: [{ from: ex.requests[0].from, to: ex.requests[0].to, value: '1' }, { from: ex.requests[0].from, to: 'nope' }] })).body?.data?.gate;
  check('a request with no "at" is checked at the live chain block time', live?.results?.[0]?.clock === 'chain' && live.results[0].nowSec > 1.7e9 && live.results[1].decision.rule.id === 'request-shape', JSON.stringify(live?.results?.[0]?.nowSec));
  const tn = (await run('policy-gatekeeper', { real: 'testnet' })).body?.data?.testnet;
  check('testnet run: the audit log hash chain re-verifies now', tn?.auditNow?.ok === true && tn.auditNow.count === 16);
  check('testnet run: recipients still hold exactly what was recorded', tn?.balancesNow?.length === 3 && tn.balancesNow.every((b) => b.matchesRecorded), JSON.stringify(tn?.balancesNow?.map((b) => b.wei)));
});

await guard(async () => {
  sec('12 Skill + Chain MCP Flow');
  const SLUG = 'skill-chain-mcp-flow';
  const ex = (await run(SLUG, { example: '1' })).body?.data;
  check('example policy and six example requests are served', ex?.policy?.rules?.length === 6 && ex.requests?.length === 6);
  const flow = (text, block, extra = {}) => run(SLUG, {}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...(block != null && { block }), ...extra }) });
  const [ready, weekend] = [ex.requests.find((r) => r.id === 'ready'), ex.requests.find((r) => r.id === 'weekend')];
  const r1 = (await flow(ready.text, ready.block)).body?.data?.flow;
  check('READY at the Thursday block: unsigned ERC-20 transfer, 13 Chain MCP calls, gas limit = estimate + 30%', r1?.verdict?.status === 'ready' && r1.chainCalls === 13 && r1.verdict.prepared?.data?.startsWith('0xa9059cbb') && r1.verdict.prepared.gasLimit === Math.ceil(r1.verdict.gas.units * 1.3), JSON.stringify(r1?.verdict?.headline));
  check('READY: the block time came from the chain (Thursday 2026-10-22 10:00:01 UTC), the balance from the chain (1,242,441.562141 USDC)', r1?.block?.iso === '2026-10-22 10:00:01 UTC' && r1.dependsOn?.some((d) => /1,242,441\.562141 USDC/.test(d.value)));
  check('READY: steps alternate Skill and Chain MCP, numbered 1..n, and the simulation comes after the policy gate', r1?.steps?.every((s, i) => s.n === i + 1) && r1.steps.findIndex((s) => s.name === 'policy-gate') < r1.steps.findIndex((s) => s.name === 'estimate_gas'));
  const r2 = (await flow(weekend.text, weekend.block)).body?.data?.flow;
  check('the SAME request at the Saturday block is STOP by office-hours (the chain’s clock decided)', r2?.verdict?.status === 'stop' && r2.verdict.rule?.id === 'office-hours' && r2.block.weekday === 'sat' && ready.text === weekend.text);
  check('a deny never asks Chain MCP to simulate: 4 calls, none of estimate_gas / get_gas_price', r2?.chainCalls === 4 && !r2.steps.some((s) => ['estimate_gas', 'get_gas_price'].includes(s.name)) && r2.skippedChainCalls?.includes('estimate_gas'));
  const r3 = (await flow(ex.requests.find((r) => r.id === 'over-limit').text, ready.block)).body?.data?.flow;
  check('150 USDC is denied by the per-request spend limit', r3?.verdict?.rule?.id === 'usdc-cap' && /over the per-request limit/.test(r3.verdict.reason));
  const r4 = (await flow(ex.requests.find((r) => r.id === 'stranger').text, ready.block)).body?.data?.flow;
  check('a recipient off the allowlist is denied by known-recipients', r4?.verdict?.rule?.id === 'known-recipients');
  const r5 = (await flow(ex.requests.find((r) => r.id === 'no-balance').text, ready.block)).body?.data?.flow;
  check('the policy allows it but the chain stops it: STOP at the simulation with the decoded revert', r5?.verdict?.stage === 'simulation' && r5.decision?.decision === 'allow' && r5.verdict.reason === 'ERC20: transfer amount exceeds balance');
  const live = (await flow(ready.text, null)).body?.data?.flow;
  check('with no block given the flow reads the latest block (two behind the head) and its time', live?.block?.historical === false && live.block.number > 21_000_000 && live.block.timestamp > 1.79e9 && live.block.head - live.block.number === 2, JSON.stringify(live?.block));
  const rec = (await run(SLUG, { recorded: '1' })).body?.data?.demo;
  check('recorded demo: five cases pinned to mainnet blocks', rec?.cases?.length === 5 && rec.cases.every((c) => Number.isInteger(c.block)));
  for (const id of ['ready', 'weekend']) {
    const rp = (await withRetry(() => run(SLUG, { replay: id }))).body?.data;
    const c = rp?.comparison;
    check(`replay "${id}": same verdict, and every pinned Chain MCP answer identical to the recording`, c?.sameVerdict === true && c.chainAnswers.compared >= 3 && c.chainAnswers.identical === c.chainAnswers.compared && c.sameStepCount, `${c?.chainAnswers?.identical}/${c?.chainAnswers?.compared}`);
  }
  check('native PROS requests are read too (no token lookups)', (await flow(`send 0.5 PROS from ${ready.text.split(' ')[4]} to ${ready.text.split(' ')[6]}`, ready.block)).body?.data?.flow?.steps?.every((s) => s.name !== 'token-check'));
  check('garbage request rejected with 400', is400(await flow('hello world')));
  check('unknown token rejected with 400', is400(await flow(ready.text.replace('USDC', 'DOGE'), ready.block)));
  check('block beyond the head rejected with 400', is400(await flow(ready.text, 999999999)));
  check('non-numeric block rejected with 400', is400(await run(SLUG, { text: ready.text, block: 'abc' })));
  check('invalid policy rejected with 400', is400(await flow(ready.text, ready.block, { policy: { version: 1, rules: [] } })));
  check('unknown replay case rejected with 400', is400(await run(SLUG, { replay: 'nope' })));
  check('GET without a request rejected with 400', is400(await run(SLUG)));
});

await guard(async () => {
  sec('13 Docs MCP + Chain MCP Agent');
  const SLUG = 'docs-chain-mcp-agent';
  const ex = (await run(SLUG, { example: '1' })).body?.data?.cases;
  check('five example cases are served', ex?.length === 5);
  const agent = (c, extra = {}) => run(SLUG, { contract: c.contract, function: c.function, args: (c.args ?? []).join(','), ...(c.block != null && { block: c.block }), ...extra }).then((r) => r.body?.data?.agent);
  const publicCall = async (to, data, block) => (await (await fetch('https://rpc.pharos.xyz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, '0x' + block.toString(16)] }) })).json()).result;
  const btc = ex.find((c) => c.id === 'btc-feed');
  const a = await agent(btc);
  const rpcRaw = BigInt(await publicCall(btc.contract, '0x50d25bcd', btc.block)).toString();
  check('BTC/USD feed: EXPLAINED, the docs are cited, and the raw value equals the public RPC at the same block', a?.verdict?.status === 'explained' && a.explanation?.sources?.some((x) => x.cited) && a.explanation.listedIn?.length >= 1 && a.call?.values?.[0]?.text === rpcRaw, `${a?.call?.values?.[0]?.text} vs ${rpcRaw}`);
  check('BTC/USD feed: read the way the docs say (18 decimals, BTC/USD), confirmed by decimals(), freshness asked for by the explanation', a?.interpretation?.value?.scaled === '80,683.130407' && a.interpretation.value.unit === 'BTC/USD' && a.interpretation.checks.every((c) => c.ok) && a.followUps?.some((f) => f.fn === 'decimals()' && f.value === '18'), JSON.stringify(a?.interpretation?.value));
  check('the explanation came before the call and decided the follow-ups: docs step < call < follow-ups, steps numbered 1..n', a?.steps?.every((s, i) => s.n === i + 1) && a.steps.findIndex((s) => s.actor === 'docs-mcp') < a.steps.findIndex((s) => s.actor === 'chain-mcp' && s.name === 'eth_call') && a.steps.findIndex((s) => s.name === 'eth_call') < a.steps.findIndex((s) => /^follow-up/.test(s.name)));
  check('every read was repeated on the public RPC and confirmed at the same block', a?.integrity?.checked >= 2 && a.integrity.inconclusive === 0 && a.integrity.confirmed + a.integrity.resolved === a.integrity.checked, JSON.stringify(a?.integrity));
  const pros = await agent(ex.find((c) => c.id === 'pros-feed'));
  check('the SAME function on another contract (PROS/USD) is explained too', pros?.verdict?.status === 'explained' && pros.interpretation?.value?.scaled === '0.65401925' && pros.request.contract !== a.request.contract);
  const usdc = await agent(ex.find((c) => c.id === 'usdc-supply'));
  check('a DIFFERENT function (USDC totalSupply) is explained, the scale confirmed by decimals() = 6', usdc?.verdict?.status === 'explained' && usdc.interpretation?.value?.scaled === '25,285,059.533609' && usdc.followUps?.some((f) => f.fn === 'decimals()' && f.value === '6'));
  const wp = await agent(ex.find((c) => c.id === 'wpros-balance'));
  check('a function with an argument (WPROS balanceOf(pair)) is encoded and called', wp?.verdict?.status === 'explained' && wp.call?.values?.[0]?.text === '67631379885632' && wp.request.args.length === 1);
  const t0 = await agent(ex.find((c) => c.id === 'pair-token0'));
  check('a function the docs do not specifically cover shows its raw value and invents no number (the generated explanation may be general or absent)', t0?.verdict?.status !== 'stop' && t0.interpretation?.value === null && t0.explanation?.listedIn?.length === 0 && t0.call?.values?.[0]?.text === '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0', t0?.verdict?.status);
  const rec = (await run(SLUG, { recorded: '1' })).body?.data?.demo;
  check('recorded demo: five cases pinned to block 21,100,000', rec?.cases?.length === 5 && rec.cases.every((c) => c.block === 21100000));
  for (const id of ['btc-feed', 'wpros-balance']) {
    const rp = (await withRetry(() => run(SLUG, { replay: id }))).body?.data;
    const c = rp?.comparison;
    check(`replay "${id}": same raw value, every chain answer both runs made identical to the recording`, c?.sameRawValue === true && c.chainAnswers.compared >= 3 && c.chainAnswers.identical === c.chainAnswers.compared, `${c?.chainAnswers?.identical}/${c?.chainAnswers?.compared}`);
  }
  const noCode = await agent({ contract: '0x0000000000000000000000000000000000000001', function: 'latestAnswer()(int256)', args: [] });
  check('an address with no contract: STOP before the docs are asked', noCode?.verdict?.stage === 'contract' && noCode.docsCalls === 0);
  check('a function the contract does not have: STOP at the call (the explanation was still fetched)', (await agent({ contract: btc.contract, function: 'nothingHere()(uint256)', args: [], block: btc.block }))?.verdict?.status === 'stop');
  check('bad address rejected with 400', is400(await run(SLUG, { contract: '0x12', function: 'latestAnswer()(int256)' })));
  check('bad signature rejected with 400', is400(await run(SLUG, { contract: btc.contract, function: 'latestAnswer(' })));
  check('unsupported type rejected with 400', is400(await run(SLUG, { contract: btc.contract, function: 'f(uint256[])(uint256)' })));
  check('wrong number of arguments rejected with 400', is400(await run(SLUG, { contract: btc.contract, function: 'balanceOf(address)(uint256)' })));
  check('block beyond the head rejected with 400', is400(await run(SLUG, { contract: btc.contract, function: 'latestAnswer()(int256)', block: 999999999 })));
  check('non-numeric block rejected with 400', is400(await run(SLUG, { contract: btc.contract, function: 'latestAnswer()(int256)', block: 'abc' })));
  check('unknown replay case rejected with 400', is400(await run(SLUG, { replay: 'nope' })));
  check('GET without a contract rejected with 400', is400(await run(SLUG)));
});

await guard(async () => {
  sec('14 Portfolio Assistant');
  const SLUG = 'portfolio-assistant';
  const W = '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f';
  const WEEKLY = '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268';
  const rpcCall = async (to, data, block) => (await (await fetch('https://rpc.pharos.xyz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, '0x' + block.toString(16)] }) })).json()).result;
  const ex = (await run(SLUG, { example: '1' })).body?.data;
  check('eleven example questions and two example wallets are served', ex?.questions?.length === 11 && ex.wallets?.length === 2);
  const rec = (await run(SLUG, { recorded: '1' })).body?.data?.demo;
  check('recorded demo: eleven questions all pinned to one block, two real wallets', rec?.cases?.length === 11 && new Set(rec.cases.map((c) => c.block)).size === 1 && new Set(rec.cases.map((c) => c.wallet)).size === 2);
  const ask = async (question, wallet = W, extra = {}) => (await withRetry(() => run(SLUG, { wallet, question, ...extra }))).body?.data?.portfolio;
  const total = await ask('What is my total balance?');
  check('total: the sum of the positions in exact dollars, three holdings, every figure sourced', total?.answer?.intent === 'total' && BigInt(total.totalUsd) === total.positions.reduce((s, p) => s + BigInt(p.usd), 0n) && total.positions.length === 3 && total.answer.figures.every((f) => f.sources?.length >= 1), total?.answer?.text);
  const usdcPos = total?.positions?.find((p) => p.symbol === 'USDC');
  check('the USDC balance equals the public RPC at the same pinned block (independent read)', usdcPos && BigInt(await rpcCall(USDC, '0x70a08231' + W.slice(2).padStart(64, '0'), total.block.number)).toString() === usdcPos.amountRaw, usdcPos?.amountRaw);
  const weekly = total?.positions?.find((p) => p.id === 'r25-weekly');
  const sharesRaw = BigInt(await rpcCall(WEEKLY, '0x70a08231' + W.slice(2).padStart(64, '0'), total.block.number));
  const assetsRaw = BigInt(await rpcCall(WEEKLY, '0x07a2d13a' + sharesRaw.toString(16).padStart(64, '0'), total.block.number));
  check('the weekly-vault position equals the public RPC (shares held, then convertToAssets of them)', weekly && weekly.shares === sharesRaw.toString() && weekly.amountRaw === assetsRaw.toString(), weekly?.amountRaw);
  check('integrity: every batch confirmed on the public RPC, none unconfirmed, read at a block behind the head', total?.integrity?.inconclusive === 0 && total.integrity.confirmed + total.integrity.resolved === total.integrity.batches && total.block.number < total.block.head && total.chainCalls > 0 && total.rpcCalls > 0, JSON.stringify(total?.integrity));
  const where = await ask('Where is my USDC?');
  check('where is my USDC: three places, from the wallet and two vaults', where?.answer?.intent === 'where_token' && /3 places/.test(where.answer.text) && where.answer.figures.length === 3);
  const big = await ask('What is my biggest position?');
  check('biggest position: the quarterly vault, with its share of the portfolio', big?.answer?.intent === 'biggest' && /R25 VRPC Quarterly/.test(big.answer.text) && /%/.test(big.answer.text));
  const tvRec = rec?.cases?.find((c) => c.id === 'token-value');
  const tv = await ask('How much is my PROS worth?', tvRec?.wallet, { block: tvRec?.block });
  check('token value: native PROS valued at the PROS/USD feed (this wallet, pinned to the recorded block, gives the recorded answer)', tv?.answer?.intent === 'token_value' && tv.answer.text === tvRec.result.answer.text && /PROS, worth \$/.test(tv.answer.text), tv?.answer?.text);
  const prot = await ask('Which protocols am I using?');
  check('protocols: counted by protocol, not token (R25, two vaults)', prot?.answer?.intent === 'protocols' && /R25 \(2 vaults\)/.test(prot.answer.text));
  const rk = await ask('How much do I have in Rockaway?', ex?.wallets?.[1]?.wallet);
  check('a position in a named vault on the other wallet: the RockawayX vault', rk?.answer?.intent === 'position_in' && /RockawayX/.test(rk.answer.text) && rk.positions.some((x) => x.id === 'rockaway-usdc'), rk?.answer?.text);
  const earn = await ask('What am I earning?');
  check('earning: a measured rate per vault from share prices at three blocks, with a caveat that it is from the past', earn?.answer?.intent === 'earning' && /about \d+\.\d\d% a year/.test(earn.answer.text) && earn.answer.caveats?.some((c) => /paid|past|recent/i.test(c)) && earn.integrity.inconclusive === 0, earn?.answer?.text?.slice(0, 120));
  const earned = await ask('How much have I earned so far?');
  check('"earned so far" is refused and reads nothing from the chain', earned?.answer?.intent === 'earned' && earned.chainCalls === 0 && earned.rpcCalls === 0 && earned.answer.figures.length === 0);
  const aave = await ask('How much do I have on Aave?');
  check('another protocol is refused by name and reads nothing', aave?.answer?.intent === 'unsupported' && /Aave/.test(aave.answer.text) && aave.chainCalls === 0 && aave.answer.figures.length === 0);
  const unk = await ask('Should I buy more PROS?');
  check('an unknown question lists what can be answered and reads nothing', unk?.answer?.intent === 'unknown' && unk.chainCalls === 0);
  const empty = await ask('What do I hold?', '0x00000000000000000000000000000000000000a1');
  check('a wallet with nothing says so, without inventing positions', empty && /holds nothing/i.test(empty.answer.text) && empty.positions.length === 0, empty?.answer?.text);
  const pinned = await ask('What do I hold?', W, { block: rec?.cases?.[0]?.block });
  check('?block pins the read: the same block, the same amounts as the recording', pinned?.block?.number === rec?.cases?.[0]?.block && pinned.positions.every((x) => rec.cases[0].result.positions.find((y) => y.id === x.id)?.amountRaw === x.amountRaw));
  for (const id of ['total', 'earning']) {
    const rp = (await withRetry(() => run(SLUG, { replay: id }))).body?.data;
    const c = rp?.comparison;
    check(`replay "${id}": same block, every figure and every raw amount identical to the recording`, c?.sameBlock === true && c.sameText === true && c.figures.identical === c.figures.compared && c.positions.identical === c.positions.compared && c.positions.compared >= 1, `${c?.figures?.identical}/${c?.figures?.compared} figures, ${c?.positions?.identical}/${c?.positions?.compared} positions`);
  }
  check('bad wallet rejected with 400', is400(await run(SLUG, { wallet: '0x12', question: 'What do I hold?' })));
  check('missing question rejected with 400', is400(await run(SLUG, { wallet: W })));
  check('oversized question rejected with 400', is400(await run(SLUG, { wallet: W, question: 'x'.repeat(400) })));
  check('block beyond the head rejected with 400', is400(await run(SLUG, { wallet: W, question: 'What do I hold?', block: 999999999 })));
  check('non-numeric block rejected with 400', is400(await run(SLUG, { wallet: W, question: 'What do I hold?', block: 'abc' })));
  check('unknown replay case rejected with 400', is400(await run(SLUG, { replay: 'nope' })));
  check('GET without a wallet rejected with 400', is400(await run(SLUG)));
});

await guard(async () => {
  sec('15 Yield Optimizer');
  const SLUG = 'yield-optimizer';
  const W = '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f';
  const WEEKLY = '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268';
  const QUARTERLY = '0x94f7ebc6ae0819a4b4e231ae6ddaaf9bfd2a1a86';
  const { usdcStateDiff } = await import('../lib/defi.js');
  const rpc = async (params) => (await (await fetch('https://rpc.pharos.xyz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params }) })).json());
  const ex = (await run(SLUG, { example: '1' })).body?.data;
  check('five example cases and the defaults (30 days, $10) are served', ex?.cases?.length === 5 && ex.defaults?.minHoldDays === 30 && ex.defaults?.minNetGainUsd === 10);
  const recd = (await run(SLUG, { recorded: '1' })).body?.data;
  check('recorded demo: five decisions at one block, plus the fork evidence', recd?.demo?.cases?.length === 5 && new Set(recd.demo.cases.map((c) => c.block)).size === 1 && recd.fork?.vaults && Object.keys(recd.fork.vaults).length === 4);
  check('fork evidence: weekly and Rockaway really succeeded (approve, deposit, redeem), the quarterly vault really reverted', recd?.fork?.vaults?.['r25-weekly']?.deposit?.status === 'success' && recd.fork.vaults['rockaway-usdc'].redeem.status === 'success' && recd.fork.vaults['r25-quarterly'].deposit.status === 'reverted');
  const opt = async (o) => (await withRetry(() => run(SLUG, { wallet: W, ...o }))).body?.data?.optimizer;
  const idle = await opt({ from: 'idle' });
  const cand = (r, id) => r?.candidates?.find((x) => x.id === id);
  check('idle USDC: MOVE to the weekly vault, not the highest-paying (quarterly) one', idle?.recommendation?.action === 'move' && idle.recommendation.to === 'r25-weekly' && cand(idle, 'r25-quarterly')?.apy > cand(idle, 'r25-weekly')?.apy, idle?.recommendation?.headline);
  check('the quarterly vault is rejected: not let in, cannot be redeemed, no invented explanation', cand(idle, 'r25-quarterly')?.viable === false && cand(idle, 'r25-quarterly').enter.eligible === false && cand(idle, 'r25-quarterly').rejected.some((r) => /0xe19a2672/.test(r)) && !cand(idle, 'r25-quarterly').rejected.some((r) => /whitelist|KYC|permissioned/i.test(r)));
  check('the semi-yearly vault is rejected because its deposit cap is below the amount', cand(idle, 'r25-semi-yearly')?.viable === false && cand(idle, 'r25-semi-yearly').rejected.some((r) => /caps this wallet's deposit/.test(r)));
  const rec = idle?.recommendation;
  check('net = extra yield − gas − fees; the gas comes from the fork run; the plan is unsigned approve then deposit', rec && Math.abs(rec.grossGainUsd - rec.gasUsd - rec.feesUsd - rec.netGainUsd) < 0.01 && idle.prepared?.transactions?.map((t) => t.step).join() === 'approve,deposit' && idle.prepared.transactions.every((t) => t.gasLimit === Math.ceil(t.gasUnits * 1.3)) && idle.prepared.transactions[1].gasUnits === recd?.fork?.vaults?.['r25-weekly']?.deposit?.gasUsed && /Unsigned/.test(idle.prepared.note), JSON.stringify(idle?.prepared?.transactions?.map((t) => t.gasLimit)));
  check('integrity: every batch confirmed on the public RPC, none unconfirmed', idle?.integrity?.inconclusive === 0 && idle.integrity.confirmed + idle.integrity.resolved === idle.integrity.batches && idle.rpcCalls > 0, JSON.stringify(idle?.integrity));
  // the weekly rate, recomputed from the public RPC alone at the recorded window
  const head = idle?.block?.number;
  const price = async (b) => BigInt((await rpc([{ to: WEEKLY, data: '0x07a2d13a' + (10n ** 12n).toString(16).padStart(64, '0') }, '0x' + b.toString(16)])).result);
  const blk = async (b) => parseInt((await (await fetch('https://rpc.pharos.xyz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['0x' + b.toString(16), false] }) })).json()).result.timestamp, 16);
  const [p0, p1, t0, t1] = await Promise.all([price(head - 400000), price(head), blk(head - 400000), blk(head)]);
  const apy = (1 + Number(p1 * 10n ** 12n / p0) / 1e12 - 1) ** (31557600 / (t1 - t0)) - 1;
  check('the weekly vault’s yearly rate equals one recomputed from the public RPC alone (within 0.01 points)', Math.abs(apy - cand(idle, 'r25-weekly')?.apy) < 0.0001, `${(apy * 100).toFixed(3)}% vs ${(cand(idle, 'r25-weekly')?.apy * 100).toFixed(3)}%`);
  // the refusal reproduced independently: a deposit from the wallet into the quarterly vault with the allowance in place
  const dep = '0x6e553f65' + (10n ** 6n).toString(16).padStart(64, '0') + W.slice(2).padStart(64, '0');
  const refusal = await rpc([{ from: W, to: QUARTERLY, data: dep }, 'latest', usdcStateDiff({ owner: W, spender: QUARTERLY, allowance: 10n ** 12n })]);
  check('independent check: the public RPC makes the quarterly vault refuse this wallet’s deposit with 0xe19a2672 even with the allowance in place', JSON.stringify(refusal.error ?? {}).includes('e19a2672'), JSON.stringify(refusal.error ?? refusal.result).slice(0, 100));
  const okDep = await rpc([{ from: W, to: WEEKLY, data: dep }, 'latest', usdcStateDiff({ owner: W, spender: WEEKLY, allowance: 10n ** 12n })]);
  check('independent check: the same deposit into the weekly vault succeeds', typeof okDep.result === 'string' && okDep.result.startsWith('0x') && !okDep.error, JSON.stringify(okDep.error ?? '').slice(0, 100));
  const stuck = await opt({ from: 'r25-quarterly' });
  check('money in the quarterly vault: STAY PUT because it cannot be redeemed, nothing to sign', stuck?.recommendation?.action === 'stay' && /cannot be redeemed/.test(stuck.recommendation.reason) && stuck.prepared === null, stuck?.recommendation?.reason?.slice(0, 100));
  const wk = await opt({ from: 'r25-weekly' });
  check('money in the weekly vault: STAY PUT with a reason for every other vault', wk?.recommendation?.action === 'stay' && /^No vault is worth moving/.test(wk.recommendation.reason) && wk.candidates.every((c) => c.viable === false));
  const strict = await opt({ from: 'idle', minNetGainUsd: 1e9 });
  check('a minimum net gain nothing can reach: STAY PUT (the threshold is respected)', strict?.recommendation?.action === 'stay' && strict.prepared === null);
  const part = await opt({ from: 'idle', amount: '10000' });
  check('only 10,000 USDC: MOVE of exactly that amount, a smaller net gain', part?.recommendation?.action === 'move' && /^MOVE 10,000 USDC/.test(part.recommendation.headline) && part.recommendation.netGainUsd < rec.netGainUsd / 50);
  const rk = await run(SLUG, { wallet: ex?.cases?.[4]?.wallet, from: 'auto' });
  const rko = rk.body?.data?.optimizer;
  check('a wallet with its money in the Rockaway vault: auto picks that bucket and the plan starts with a redeem', rko?.source?.id === 'rockaway-usdc' && rko.recommendation.action === 'move' && rko.prepared.transactions.map((t) => t.step).join() === 'redeem,approve,deposit', rko?.recommendation?.headline);
  const pinned = await opt({ from: 'idle', block: recd?.demo?.cases?.[0]?.block });
  check('?block pins the read: the same block, the same decision and the same rates as the recording', pinned?.block?.number === recd?.demo?.cases?.[0]?.block && pinned.recommendation.action === recd.demo.cases[0].result.recommendation.action && pinned.candidates.every((c) => c.apy === recd.demo.cases[0].result.candidates.find((x) => x.id === c.id)?.apy));
  for (const id of ['idle-to-best', 'quarterly-stuck']) {
    const rp = (await withRetry(() => run(SLUG, { replay: id }))).body?.data;
    const c = rp?.comparison;
    check(`replay "${id}": same action, eligibility, redeemability and rates as the recording`, c?.sameAction === true && c.candidates.identical === c.candidates.compared && c.candidates.compared >= 3, `${c?.candidates?.identical}/${c?.candidates?.compared}`);
  }
  check('amount larger than the bucket rejected with 400', is400(await run(SLUG, { wallet: W, from: 'idle', amount: '999999999999' })));
  check('unknown source rejected with 400', is400(await run(SLUG, { wallet: W, from: 'nowhere' })));
  check('holding period out of range rejected with 400', is400(await run(SLUG, { wallet: W, from: 'idle', minHoldDays: 9999 })));
  check('non-numeric minimum gain rejected with 400', is400(await run(SLUG, { wallet: W, from: 'idle', minNetGainUsd: 'lots' })));
  check('bad wallet rejected with 400', is400(await run(SLUG, { wallet: '0x12', from: 'idle' })));
  check('block beyond the head rejected with 400', is400(await run(SLUG, { wallet: W, from: 'idle', block: 999999999 })));
  check('unknown replay case rejected with 400', is400(await run(SLUG, { replay: 'nope' })));
  check('GET without a wallet rejected with 400', is400(await run(SLUG)));
});

await guard(async () => {
  sec('Cross-cutting');
  check('unknown task slug rejected with 400', is400(await run('nope')));
  check('prototype-pollution slug rejected with 400', is400(await run('__proto__')) && is400(await run('constructor')));
  check('missing slug rejected with 400', is400(await get('/api/run')));
  check('skill files served for all 10 skills', (await Promise.all(['threshold-guardian', 'saga-executor', 'arbitrage-scanner', 'dry-run-executor', 'trend-watcher', 'batch-executor', 'policy-gatekeeper', 'skill-chain-mcp-flow', 'portfolio-assistant', 'yield-optimizer'].map((t) => get('/api/run' + q({ slug: '_skill', task: t }))))).every((r) => r.body?.ok && r.body.data.files.some((f) => f.path === 'SKILL.md')));
  check('skill request for a non-skill task rejected with 400', is400(await get('/api/run' + q({ slug: '_skill', task: 'doc-search-cli' }))));
  check('path traversal in skill task rejected', [400].includes((await get('/api/run' + q({ slug: '_skill', task: '../../etc/passwd' }))).status));
  const h = await get('/api/health');
  check('health: all three upstreams up', h.body?.data?.services?.every((s) => s.ok), JSON.stringify(h.body?.data?.services?.map((s) => `${s.id}:${s.ok}`)));
  const reg = await (await fetch(BASE + '/registry.json')).json();
  check('registry has 30 tasks and no points anywhere', reg.tasks.length === 30 && !JSON.stringify(reg).includes('"points"'));
  const html = await (await fetch(BASE + '/')).text();
  check('home page has no "points" wording', !/\bpoints?\b|\bpts\b/i.test(html));
});

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(`  - [${f.section}] ${f.name}`)); }
process.exitCode = failed.length ? 1 : 0;
