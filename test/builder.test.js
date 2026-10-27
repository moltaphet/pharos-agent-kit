import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factsFromFeedsPage, factsFromNetworkPage, parseRequest, runRequest, verifyOutcome } from '../lib/builder.js';
import { counterArtifact } from '../lib/builder-artifacts.js';
import { selectorOf } from '../lib/keccak.js';
import { content } from '../public/js/tasks/doc-grounded-builder-agent.js';

const A = '0x' + '11'.repeat(20); const B = '0x' + '22'.repeat(20); const FEED = '0x371Ed36aEe5bFFbED1A2aa9b7deD7F4EB30F5466';
const NETWORK = (id, rpc) => `# Network\n\n| Parameter | Value |\n| --- | --- |\n| ChainID | ${id} |\n| RPC URL | <${rpc}> |\n| Block Explorer | <https://scan.example/> |\n`;
const FEEDS = `# Feeds\n\n## Common Settings\n\n| Parameter | Value |\n| --- | --- |\n| Decimals | 18 |\n| PriceFeed Heartbeat | 3600 seconds |\n\n## Pacific Mainnet\n\n| Pair | Feed ID | Contract Address |\n| --- | --- | --- |\n| PROS/USD | 0x01 | ${FEED} |\n| BTC/USD | 0x02 | 0x8b5DB228fBccf588F08b073C235254acB6791D36 |\n\n## Atlantic\n\n| PROS/USD | 0x03 | 0x000000000000000000000000000000000000dEaD |\n`;
const ANSWER = 'Call `latestAnswer()`.\n\nSee [Feeds](/tooling-and-infrastructure/oracles/chainlink-pe).\n\n# Sources\n\n- [Feeds](https://docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe)';
const SEARCH = 'Title: Feeds\nLink: https://docs.pharos.xyz/tooling-and-infrastructure/oracles/chainlink-pe\nContent: read price feed Chainlink latestAnswer check native balance address send transfer another address deploy smart contract testnet run validator node Pharos PROS PROS/USD BTC/USD DOGE/USD\n';

// a fake Docs MCP and a fake Chain MCP that count what they are asked
function clients({ answer = ANSWER, search = SEARCH, chainId = 1672, balance = 5n * 10n ** 18n, pages = {}, twin = null, price = 6n * 10n ** 17n, age = 100, nonce = 7, gas = 21000n, receipts = {} } = {}) {
  const log = { docs: [], chain: [] };
  const docs = { callTool: async (tool, args) => { log.docs.push(tool); if (tool === 'askQuestion') return answer; if (tool === 'searchDocumentation') return search; if (tool === 'getPage') return pages[args.url] ?? (/network/.test(args.url) ? NETWORK(1672, 'https://rpc.example') : FEEDS); throw new Error(tool); } };
  const chain = { callTool: async (tool, args) => {
    log.chain.push(tool);
    switch (tool) {
      case 'get_chain_info': return { chainId };
      case 'get_block_number': return { blockNumber: '1000' };
      case 'get_balance': return { balanceWei: String(balance), balance: String(Number(balance) / 1e18) };
      case 'get_block': return { timestamp: '0x' + (1_000_000).toString(16) };
      case 'eth_call': return args.transaction.data === selectorOf('latestTimestamp()') ? { result: '0x' + (1_000_000 - age).toString(16).padStart(64, '0') } : args.transaction.data === selectorOf('latestAnswer()') ? { result: '0x' + price.toString(16).padStart(64, '0') } : { result: '0x' + '0'.repeat(64) };
      case 'get_transaction_count': return { nonce: String(nonce) };
      case 'get_gas_price': return { gasPriceWei: '10000000000', gasPriceGwei: '10' };
      case 'estimate_gas': return { gas: String(gas) };
      case 'get_transaction': return receipts.tx ?? null;
      case 'get_transaction_receipt': return receipts.receipt ?? null;
      case 'get_code': return { result: receipts.code ?? '0x' };
      default: throw new Error(`unexpected ${tool}`);
    }
  } };
  return { log, docs, chain, atlantic: chain, rpc: async (m, p) => (m === 'eth_getBalance' ? '0x' + (twin ?? balance).toString(16) : m === 'eth_call' ? '0x' + (twin ?? price).toString(16).padStart(64, '0') : null) };
}
const run = (question, c) => runRequest({ question, clients: c, rpc: c.rpc, atlanticRpc: c.rpc });

test('understanding a request: the four things it can do, the words it needs, and nothing else', () => {
  assert.deepEqual(parseRequest(`How do I check the balance of ${A}?`), { recipe: 'balance', network: 'mainnet', address: A });
  assert.equal(parseRequest(`balance of ${A} on testnet`).network, 'atlantic');
  assert.deepEqual(parseRequest('How do I read the BTC/USD price?'), { recipe: 'price-feed', network: 'mainnet', pair: 'BTC/USD' });
  assert.equal(parseRequest('What is the oracle price of PROS?').pair, 'PROS/USD');
  assert.deepEqual(parseRequest(`How do I send 0.5 PROS to ${B} from ${A}?`), { recipe: 'send', network: 'mainnet', amount: '0.5', to: B, from: A });
  assert.equal(parseRequest(`send 2 PHRS to ${B} from ${A}`).network, 'atlantic');
  assert.equal(parseRequest(`How do I send 1 PROS to ${B}?`).from, null);
  assert.equal(parseRequest('How do I deploy a smart contract?').recipe, 'deploy');
  assert.equal(parseRequest('How do I run a validator node on Pharos?'), null);
  for (const bad of ['', 'hi', 'x'.repeat(401)]) assert.throws(() => parseRequest(bad), /question of 8 to 400/);
});

test('facts are read from the docs tables, not remembered', () => {
  assert.deepEqual(factsFromNetworkPage(NETWORK(1672, 'https://rpc.example')), { chainId: 1672, rpc: 'https://rpc.example', explorer: 'https://scan.example' });
  assert.equal(factsFromNetworkPage('# nothing here').chainId, null);
  const f = factsFromFeedsPage(FEEDS, 'PROS/USD');
  assert.equal(f.address, FEED); assert.equal(f.decimals, 18); assert.equal(f.heartbeat, 3600);
  assert.deepEqual(f.pairs, ['PROS/USD', 'BTC/USD'], 'only the Pacific Mainnet section is read');
  assert.equal(factsFromFeedsPage(FEEDS, 'DOGE/USD').address, null);
});

test('a request the docs do not cover: it says so and does nothing at all on the chain', async () => {
  const c = clients({ answer: "I couldn't find anything about that in the docs." });
  const r = await run(`How do I check the balance of ${A}?`, c);
  assert.equal(r.verdict.status, 'not-covered');
  assert.deepEqual(c.log.chain, [], 'no Chain MCP call was made');
  assert.ok(!c.log.docs.includes('getPage'));
  assert.match(r.verdict.reason, /improvise/);
  const c2 = clients({ search: 'Title: Unrelated\nLink: https://docs.pharos.xyz/x\nContent: nothing relevant' });
  assert.equal((await run('How do I bake sourdough bread with Pharos?', c2)).verdict.status, 'not-covered');
  assert.equal(c2.log.chain.length, 0);
});

test('a question the docs answer but the agent cannot act on is explained with sources, and left there', async () => {
  const c = clients();
  const r = await run('How do I run a validator node on Pharos?', c);
  assert.equal(r.verdict.status, 'explained-only');
  assert.ok(r.docs.sources.length > 0 && r.docs.sources.some((s) => s.cited));
  assert.equal(c.log.chain.length, 0);
});

test('balance: planned from the docs, read through Chain MCP, confirmed by a second read', async () => {
  const c = clients();
  const r = await run(`How do I check the balance of ${A}?`, c);
  assert.equal(r.verdict.status, 'success');
  assert.equal(r.plan.length, 3);
  assert.ok(r.docs.sources[0].url.startsWith('https://docs.pharos.xyz'));
  assert.deepEqual(r.verification.map((v) => v.ok), [true, true]);
  assert.ok(c.log.docs.includes('getPage'), 'the chain ID came from a docs page');
  assert.equal(r.steps[0].actor, 'docs-mcp');
  const bad = await run(`How do I check the balance of ${A}?`, clients({ twin: 1n }));
  assert.equal(bad.verdict.status, 'failure', 'two reads that disagree are not success');
});

test('the chain is checked against the docs: a different chain ID stops the run before any action', async () => {
  const c = clients({ chainId: 999 });
  const r = await run(`How do I check the balance of ${A}?`, c);
  assert.equal(r.verdict.status, 'failure');
  assert.ok(!c.log.chain.includes('get_balance'));
});

test('price feed: the address and decimals come from the docs table; freshness uses the docs’ heartbeat', async () => {
  const c = clients();
  const r = await run('How do I read the PROS/USD price on Pharos?', c);
  assert.equal(r.verdict.status, 'success');
  assert.equal(r.result.feed, FEED);
  assert.equal(r.result.price, 0.6);
  assert.match(r.verification[2].what, /3600/);
  const stale = await run('How do I read the PROS/USD price on Pharos?', clients({ age: 9000 }));
  assert.equal(stale.verdict.status, 'failure');
  assert.equal(stale.verification[2].ok, false);
  const unlisted = await run('How do I read the DOGE/USD price on Pharos?', clients());
  assert.equal(unlisted.verdict.status, 'not-covered');
  assert.match(unlisted.verdict.reason, /PROS\/USD, BTC\/USD/);
});

test('sending funds: prepared for signature, never signed; affordability is checked; a missing sender is asked for', async () => {
  const c = clients();
  const r = await run(`How do I send 0.5 PROS to ${B} from ${A}?`, c);
  assert.equal(r.verdict.status, 'prepared');
  assert.equal(r.prepared.valueWei, String(5n * 10n ** 17n));
  assert.equal(r.prepared.nonce, 7); assert.equal(r.prepared.chainId, 1672); assert.equal(r.prepared.to, B);
  assert.ok(!c.log.chain.includes('send_raw_transaction'), 'nothing was sent');
  assert.equal(r.plan.at(-1).done, false, 'verification waits for the signed transaction');
  const poor = await run(`How do I send 9 PROS to ${B} from ${A}?`, clients({ balance: 10n ** 18n }));
  assert.equal(poor.verdict.status, 'failure');
  assert.match(poor.verdict.reason, /cannot afford|holds/);
  const anon = await run(`How do I send 1 PROS to ${B}?`, clients());
  assert.equal(anon.verdict.status, 'needs-input');
  await assert.rejects(run(`How do I send 0 PROS to ${B} from ${A}?`, clients()), /above zero/);
});

test('the signed transaction is verified against the plan: success, and each way it can differ', async () => {
  const c = clients();
  const r = await run(`How do I send 0.5 PROS to ${B} from ${A}?`, c);
  const hash = '0x' + 'ab'.repeat(32);
  const tx = (over = {}) => ({ from: A, to: B, value: '0x' + (5n * 10n ** 17n).toString(16), nonce: '0x7', chainId: '0x688', ...over });
  const good = await verifyOutcome({ prepared: r.prepared, hash, clients: clients({ receipts: { tx: tx(), receipt: { status: '0x1', blockNumber: '0x10', gasUsed: '0x5208' } } }) });
  assert.equal(good.status, 'success');
  for (const [name, over, status] of [['wrong amount', { value: '0x1' }, '0x1'], ['wrong recipient', { to: A }, '0x1'], ['wrong nonce', { nonce: '0x9' }, '0x1'], ['reverted', {}, '0x0']]) {
    const o = await verifyOutcome({ prepared: r.prepared, hash, clients: clients({ receipts: { tx: tx(over), receipt: { status, blockNumber: '0x10', gasUsed: '0x5208' } } }) });
    assert.equal(o.status, 'failure', name);
  }
  assert.equal((await verifyOutcome({ prepared: r.prepared, hash, clients: clients({ receipts: {} }) })).status, 'pending');
  await assert.rejects(verifyOutcome({ prepared: r.prepared, hash: '0x12', clients: clients() }), /64 hexadecimal/);
});

test('deployment: prepared with the compiled Counter; verified by the receipt, the code and a call', async () => {
  const art = counterArtifact();
  assert.ok(art.bytecode.startsWith('0x') && art.runtime.length > 100 && art.bytecode.length > art.runtime.length);
  const r = await run(`How do I deploy a smart contract to the Pharos Atlantic testnet from ${A}?`, clients({ gas: 120_000n }));
  assert.equal(r.verdict.status, 'prepared');
  assert.equal(r.prepared.to, null); assert.equal(r.prepared.data, art.bytecode);
  const hash = '0x' + 'cd'.repeat(32);
  const base = { tx: { from: A, to: null, value: '0x0', nonce: '0x7', chainId: '0x688' }, receipt: { status: '0x1', blockNumber: '0x10', gasUsed: '0x1', contractAddress: B } };
  assert.equal((await verifyOutcome({ prepared: { ...r.prepared, chainId: 1672 }, hash, network: 'atlantic', clients: clients({ receipts: { ...base, code: art.runtime } }) })).status, 'success');
  const wrongCode = await verifyOutcome({ prepared: { ...r.prepared, chainId: 1672 }, hash, network: 'atlantic', clients: clients({ receipts: { ...base, code: '0x6080' } }) });
  assert.equal(wrongCode.status, 'failure');
  assert.ok(wrongCode.verification.some((v) => /compiled Counter code/.test(v.what) && !v.ok));
  assert.equal((await run('How do I deploy a smart contract to the Pharos Atlantic testnet?', clients())).verdict.status, 'needs-input');
});

test('the recorded runs: nine requests, six done or prepared, three the docs cannot support, a mainnet transfer never signed', () => {
  const rec = JSON.parse(readFileSync(new URL('../reports/builder-run.json', import.meta.url), 'utf8'));
  const by = Object.fromEntries(rec.cases.map((c) => [c.id, c]));
  assert.equal(rec.cases.length, 9);
  for (const id of ['balance', 'price-pros', 'price-btc']) assert.equal(by[id].run.verdict.status, 'success', id);
  assert.equal(by['send-mainnet'].run.verdict.status, 'prepared');
  assert.equal(by['send-mainnet'].afterSigning, undefined, 'the mainnet transfer was never signed');
  for (const id of ['send-atlantic', 'deploy']) { assert.equal(by[id].run.verdict.status, 'prepared', id); assert.equal(by[id].afterSigning.status, 'success', id); assert.ok(by[id].afterSigning.verification.every((v) => v.ok), id); }
  assert.equal(by['not-covered-1'].run.verdict.status, 'not-covered'); assert.equal(by['not-covered-2'].run.verdict.status, 'not-covered');
  assert.equal(by['explained-only'].run.verdict.status, 'explained-only');
  for (const c of rec.cases) assert.ok(c.run.docs.answer || c.run.verdict.status === 'not-covered', c.id);
  for (const id of ['balance', 'price-pros', 'send-mainnet']) assert.ok(by[id].run.docs.sources.some((s) => s.cited), `${id} cites a docs page`);
});

test('task page', () => {
  assert.equal(content.evidence.length, 5);
  assert.doesNotMatch(JSON.stringify(content), /simulated|mock/i);
});
