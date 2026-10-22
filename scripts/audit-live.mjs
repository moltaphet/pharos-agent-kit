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
  const mcpCalls = r.body.trace.calls.filter((c) => c.kind === 'mcp' && ['eth_call', 'get_code', 'get_block'].includes(c.tool));
  const rpcCalls = r.body.trace.calls.filter((c) => c.kind === 'rpc' && c.tool === 'eth_call');
  check('every MCP eth_call/get_code/get_block pinned to the displayed block', mcpCalls.length >= 6 && mcpCalls.every((c) => (c.args.block ?? c.args.transaction?.block) === d.block.number), `${mcpCalls.length} calls`);
  check('every independent RPC replay is pinned to the same block (hex)', rpcCalls.length >= 5 && rpcCalls.every((c) => c.args[1] === hexBlock), `${rpcCalls.length} calls`);
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
  const g = await get('/api/docs' + q({ q: 'How do I deploy a smart contract with Foundry?' }));
  check('a real question is found with sources', g.body?.data?.found === true && g.body.data.sources.length >= 1 && g.body.data.sources.every((s) => /^https:\/\/docs\.pharos\.xyz/.test(s.url)), `${g.body?.data?.sources?.length} sources`);
  check('answer is concise (< 1500 chars)', (g.body?.data?.answer ?? '').length < 1500, (g.body?.data?.answer ?? '').length);
  const verdicts = [];
  for (let i = 0; i < 10; i++) verdicts.push((await get('/api/docs' + q({ q: 'What is the airspeed velocity of an unladen swallow in Pharos?' }))).body?.data?.found);
  check('nonsense question refused 10/10 times (no invented answer)', verdicts.every((v) => v === false), JSON.stringify(verdicts));
  const offTopic = [];
  for (let i = 0; i < 6; i++) offTopic.push((await get('/api/docs' + q({ q: 'How do I bake sourdough bread?' }))).body?.data);
  check('off-topic question #2 is also refused 6/6 times', offTopic.every((d) => d?.found === false), JSON.stringify(offTopic.map((d) => d?.found)));
  check('refusal shows no answer text, only related pages', offTopic.every((d) => d?.answer === null));
  const real = ['How do I deploy a smart contract with Foundry?', 'How do I become a validator?', 'What are the Atlantic testnet RPC and chain id?'];
  const realAns = [];
  for (const rq of real) realAns.push((await get('/api/docs' + q({ q: rq }))).body?.data?.found);
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
  for (const s of p.body.data.steps) { const r = await run('docs-mcp-onboarding', { step: s.id }); all.push({ id: s.id, ok: r.status === 200, gap: r.body?.data?.gap?.title, checks: r.body?.data?.checks?.length }); }
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
  const s = (o) => run('saga-executor', o).then((r) => r.body?.data?.simulated);
  const recd = (await run('saga-executor', { scenario: 'recorded' })).body?.data?.recorded;
  check('recorded real-EVM runs: both finished as expected and carry provenance', recd?.runs?.length === 2 && recd.runs.every((r) => r.finalCheck.clean) && recd.provenance?.forkBlocks?.success > 0 && /anvil/i.test(recd.provenance.anvil ?? ''));
  check('the web simulator reproduces both recorded runs entry for entry', recd?.fidelity?.rows?.length === 2 && recd.fidelity.rows.every((r) => r.identical), JSON.stringify(recd?.fidelity?.rows?.map((r) => r.firstDifference)));
  const ok = await s({ scenario: 'success' });
  check('success: 3 steps confirmed, completed, final state as expected', ok?.status === 'completed' && ok.steps.every((x) => x.state === 'confirmed') && ok.finalCheck.clean);
  const rt = await s({ scenario: 'retry', maxAttempts: 3 });
  check('retry: deposit needed 3 attempts and completed', rt?.status === 'completed' && rt.steps[1].attempts === 3);
  const rt2 = await s({ scenario: 'retry', maxAttempts: 2 });
  check('retry with 2 attempts: gives up and rolls back (policy is respected)', rt2?.status === 'compensated' && rt2.failure.kind === 'transient');
  const fl = await s({ scenario: 'failure' });
  check('failure: ZeroAddress, undone newest first, nothing left behind', fl?.status === 'compensated' && /ZeroAddress/.test(fl.failure.error) && fl.finalCheck.clean && fl.finalCheck.allowance === '0');
  const order = fl?.log.filter((e) => e.event === 'compensation:confirmed').map((e) => e.step);
  check('compensation order is reverse (deposit, then approve)', JSON.stringify(order) === '["deposit","approve"]', JSON.stringify(order));
  const st = await s({ scenario: 'stuck' });
  check('stuck: reported as compensation-failed with stranded step, not "rolled back"', st?.status === 'compensation-failed' && st.stuck?.includes('deposit') && st.finalCheck.clean === false);
  check('state log times are non-decreasing', fl?.log.every((e, i) => i === 0 || e.t >= fl.log[i - 1].t));
  const rec = (await run('saga-executor', { scenario: 'recorded' })).body?.data?.recorded;
  check('recorded real-EVM runs: one completed, one compensated, both as expected', rec?.runs?.length === 2 && rec.runs[0].status === 'completed' && rec.runs[1].status === 'compensated' && rec.runs.every((r) => r.finalCheck.clean), rec?.network);
  check('recorded failure shows the real revert reason', /ZeroAddress/.test(rec?.runs?.[1]?.failure?.error ?? ''));
  check('bad scenario rejected with 400', is400(await run('saga-executor', { scenario: 'x' })));
  check('maxAttempts 9 rejected with 400', is400(await run('saga-executor', { scenario: 'success', maxAttempts: 9 })));
  check('non-numeric maxAttempts rejected with 400', is400(await run('saga-executor', { scenario: 'success', maxAttempts: 'abc' })));
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
  const pr = (await run('arbitrage-scanner', { source: 'profitable', size: 50 })).body?.data?.scan;
  check('synthetic profitable: acts, simulated, labelled synthetic', pr?.decision === 'execute-simulated' && pr.fill?.simulated === true && /Synthetic/.test(pr.sourceLabel));
  const mg = (await run('arbitrage-scanner', { source: 'marginal', size: 50 })).body?.data?.scan;
  check('synthetic marginal: skips (gap smaller than fees)', mg?.decision === 'skip');
  const hi = (await run('arbitrage-scanner', { source: 'profitable', size: 50, minNet: 100 })).body?.data?.scan;
  check('threshold is configurable: minNet=100 makes profitable skip', hi?.decision === 'skip');
  const pd = (await run('arbitrage-scanner', { pair: 'UNI-V2/PDOG', size: 1 })).body?.data?.scan;
  check('second pair: scans and refuses to guess unpriced gas', pd?.decision === 'skip' && pd.costs.gas === null);
  check('bad pair rejected with 400', is400(await run('arbitrage-scanner', { pair: 'X/Y' })));
  check('negative size rejected with 400', is400(await run('arbitrage-scanner', { source: 'profitable', size: -1 })));
  check('bad source rejected with 400', is400(await run('arbitrage-scanner', { source: 'bogus' })));
  check('minNet=abc rejected with 400', is400(await run('arbitrage-scanner', { source: 'profitable', minNet: 'abc' })));
});

await guard(async () => {
  sec('8 Dry-Run Executor');
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
  sec('9 Trend Watcher');
  const post = (o, state) => run('trend-watcher', o, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
  const dec = (await post({ action: 'scenario', scenario: 'decline', direction: 'down', observations: 3 }, null)).body?.data;
  check('decline fires exactly once, at the 3rd observation', dec?.results?.map((r) => r.fired).join() === 'false,false,true,false,false' && dec.state.events.length === 1);
  for (const sc of ['spike', 'dip']) { const r = (await post({ action: 'scenario', scenario: sc, direction: sc === 'spike' ? 'up' : 'down', observations: 3 }, null)).body?.data; check(`single ${sc} never triggers`, r?.state?.events?.length === 0 && !r.state.active); }
  const rec = (await post({ action: 'scenario', scenario: 'recovery', direction: 'down', observations: 3 }, null)).body?.data;
  check('recovery: triggered, cleared, triggered', rec?.state?.events?.map((e) => e.type).join() === 'triggered,cleared,triggered');
  check('rule with 2 observations rejected with 400', is400(await post({ action: 'scenario', scenario: 'decline', observations: 2 }, null)));
  const a = (await post({ action: 'backfill', metric: 'usdc-supply', count: 5, step: 20000, direction: 'down', observations: 3 }, null)).body?.data;
  check('live backfill stores 5 observations on a fixed grid', a?.state?.observations?.length === 5 && a.state.observations.every((o) => o.block % 20000 === 0));
  const b = (await post({ action: 'backfill', metric: 'usdc-supply', count: 5, step: 20000, direction: 'down', observations: 3 }, a.state)).body?.data;
  check('RESTART: same backfill again adds 0 and keeps 5 (nothing lost or duplicated)', b?.results?.every((r) => r.duplicate) && b.state.observations.length === 5);
  check('observations are in block order with timestamps', a?.state?.observations?.every((o, i, arr) => (i === 0 || o.block > arr[i - 1].block) && /UTC$/.test(o.time)));
  const vals = a?.state?.observations?.map((o) => o.value);
  check('values are plausible (no wild outlier: each within 40% of the median)', (() => { const m = [...vals].sort((x, y) => x - y)[2]; return vals.every((v) => Math.abs(v - m) / m < 0.4); })(), vals?.join(' '));
  check('count=99 rejected with 400', is400(await post({ action: 'backfill', metric: 'usdc-supply', count: 99 }, null)));
  check('unknown metric rejected with 400', is400(await post({ action: 'backfill', metric: 'nope' }, null)));
  const evil = await run('trend-watcher', { action: 'scenario', scenario: 'decline' }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: { version: 1, rule: { direction: 'down', observations: 3 }, observations: 'not-an-array', active: false, events: [] } }) });
  check('a malformed posted state does not cause a 500', evil.status !== 500, evil.status);
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
  sec('Cross-cutting');
  check('unknown task slug rejected with 400', is400(await run('nope')));
  check('prototype-pollution slug rejected with 400', is400(await run('__proto__')) && is400(await run('constructor')));
  check('missing slug rejected with 400', is400(await get('/api/run')));
  check('skill files served for all 6 skills', (await Promise.all(['threshold-guardian', 'saga-executor', 'arbitrage-scanner', 'dry-run-executor', 'trend-watcher', 'batch-executor'].map((t) => get('/api/run' + q({ slug: '_skill', task: t }))))).every((r) => r.body?.ok && r.body.data.files.some((f) => f.path === 'SKILL.md')));
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
