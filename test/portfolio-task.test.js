import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run, { compareReplay, readDemo, readExamples } from '../lib/tasks/portfolio-assistant.js';
import { UserError } from '../lib/snapshot.js';
import { WALLET, makeWorld } from './support/defi-world.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const demo = JSON.parse(file('../reports/portfolio-demo.json'));
const byId = (id) => demo.cases.find((c) => c.id === id);
const questions = JSON.parse(file('../skills/pharos-portfolio-assistant/examples/questions.json'));
const wallets = JSON.parse(file('../skills/pharos-portfolio-assistant/examples/wallets.json'));

// ---- the recorded demo: real wallets on Pharos mainnet, pinned to one block ------------------------------------------------------------
test('the recording covers every kind of question, each pinned to a real mainnet block behind the head', () => {
  assert.deepEqual(demo.cases.map((c) => c.id), questions.map((q) => q.id));
  const intents = new Set(demo.cases.map((c) => c.result.answer.intent));
  for (const i of ['total', 'holdings', 'where_token', 'token_value', 'biggest', 'position_in', 'protocols', 'earning', 'earned', 'unsupported']) assert.ok(intents.has(i), `a recorded ${i} question`);
  for (const c of demo.cases) {
    if (c.result.block) { // a refusal reads nothing, so it has no block
      assert.equal(c.result.block.historical, true, c.id);
      assert.ok(c.result.block.number < c.result.block.head, c.id);
      assert.equal(c.result.block.number, c.block, c.id);
    } else assert.ok(['earned', 'aave'].includes(c.id), `${c.id} read nothing but is not a refusal`);
    assert.equal(c.result.wallet, c.wallet, c.id);
    assert.equal(c.result.answer.question, c.question, c.id);
  }
  assert.equal(new Set(demo.cases.map((c) => c.wallet)).size, 2, 'two different real wallets');
});

test('every figure in the recording has a source with a contract, a call, a block and a way it was read, and an explorer link', () => {
  for (const c of demo.cases) {
    for (const s of c.result.answer.sources) {
      assert.match(s.contract, /^0x[0-9a-fA-F]{40}$/, c.id);
      assert.ok(s.call && s.tool && s.integrity, c.id);
      assert.equal(typeof s.block, 'number', c.id);
      if (s.call.startsWith('getEthBalance')) assert.equal(s.explorer, null, `${c.id}: a native balance is read through Multicall3, which is not a link to show`);
      else assert.match(s.explorer, /^https:\/\/www\.pharosscan\.xyz\/address\/0x/, c.id);
    }
    for (const f of c.result.answer.figures) assert.ok(f.sources?.length >= 1, `${c.id}: figure "${f.label}" cites a source`);
  }
});

test('the answers add up: the total is the sum of the positions, in exact dollars', () => {
  const total = byId('total').result;
  const sum = total.positions.reduce((s, p) => s + BigInt(p.usd), 0n);
  assert.equal(BigInt(total.totalUsd), sum);
  assert.match(total.answer.text, /^Your total is \$[\d,]+\.\d\d across 3 holdings/);
  const where = byId('where-usdc').result;
  const usdcRaw = where.positions.filter((p) => p.symbol === 'USDC' || p.underlying === 'USDC').reduce((s, p) => s + BigInt(p.amountRaw), 0n);
  assert.ok(where.answer.text.includes('3 places'));
  assert.ok(usdcRaw > 0n);
  const biggest = byId('biggest').result;
  const top = [...biggest.positions].sort((a, b) => (BigInt(b.usd) > BigInt(a.usd) ? 1 : -1))[0];
  assert.ok(biggest.answer.text.includes(top.label), 'the biggest position is the one with the most dollars');
});

test('what it cannot know is refused and reads nothing: another protocol, and what was earned since depositing', () => {
  for (const id of ['earned', 'aave']) {
    const r = byId(id).result;
    assert.equal(r.answer.figures.length, 0, id);
    assert.equal(r.chainCalls, 0, `${id}: no chain call`);
    assert.equal(r.rpcCalls, 0, `${id}: no rpc call`);
    assert.equal(r.integrity.reads, 0, id);
  }
  assert.match(byId('aave').result.answer.text, /I do not read Aave positions/);
  assert.match(byId('earned').result.answer.text, /cannot tell what you have earned/);
});

test('earning is a measured rate from share prices at three blocks, from the past, not a promise', () => {
  const r = byId('earning').result;
  assert.match(r.answer.text, /about \d+\.\d\d% a year, roughly \$[\d,.]+ a day/);
  assert.ok(r.answer.caveats.some((c) => /paid|past|recent/i.test(c)), 'it says the rate is what the vault paid');
  assert.deepEqual(Object.keys(r.yields).sort(), ['r25-quarterly', 'r25-weekly'], 'only the vaults this wallet holds are measured');
  for (const y of Object.values(r.yields)) {
    assert.equal(y.ok, true);
    assert.ok(y.days > 4 && y.days < 5, 'measured over about four days');
    assert.ok(y.apy > 0 && y.apyEarly > 0 && y.apyLate > 0, 'the whole window and each half');
  }
});

test('every read in the recording was confirmed or resolved on the public RPC; none went unconfirmed', () => {
  for (const c of demo.cases) {
    const i = c.result.integrity;
    assert.equal(i.inconclusive, 0, c.id);
    assert.equal(i.confirmed + i.resolved, i.batches, c.id);
  }
  // Chain MCP is load-balanced and has once answered wrongly; when a recording caught that, the disagreement and its settlement are on record
  for (const c of demo.cases) assert.equal(c.result.steps.some((s) => s.name === 'read-resolved'), c.result.integrity.resolved > 0, `${c.id}: a resolved read is on record, and only then`);
});

test('steps are numbered in order and every "uses" points at an earlier step', () => {
  for (const c of demo.cases) {
    const r = c.result;
    assert.deepEqual(r.steps.map((s) => s.n), r.steps.map((_, i) => i + 1), c.id);
    for (const s of r.steps.filter((x) => x.actor === 'agent')) for (const u of s.uses) assert.ok(u < s.n, `${c.id}: step ${s.n}`);
  }
});

test('the recording is read-only, plain JSON, and holds no secrets', () => {
  const tools = new Set(demo.cases.flatMap((c) => c.result.steps.filter((s) => s.actor === 'chain-mcp').map((s) => s.name)));
  for (const t of tools) assert.ok(['eth_call', 'get_block', 'get_block_number'].includes(t), `read-only tool: ${t}`);
  const text = JSON.stringify(demo);
  assert.equal(/"privateKey"\s*:/i.test(text), false);
  try {
    const key = JSON.parse(file('../.wallet/atlantic-testnet.json')).privateKey;
    assert.equal(text.includes(key), false, 'the throwaway wallet key is not in the recording');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
});

// ---- replay ----------------------------------------------------------------------------------------------------------------------------
test('compareReplay: identical answers pass; a changed figure or raw amount is named', () => {
  const rec = byId('total').result;
  const same = compareReplay(rec, structuredClone(rec));
  assert.equal(same.sameText, true);
  assert.equal(same.figures.identical, same.figures.compared);
  assert.equal(same.positions.identical, same.positions.compared);
  assert.equal(same.sameBlock, true);
  const changed = structuredClone(rec);
  changed.answer.figures[0].value = '$1.00';
  changed.positions[1].amountRaw = '1';
  const cmp = compareReplay(rec, changed);
  assert.equal(cmp.figures.differing.length, 1);
  assert.equal(cmp.figures.differing[0].label, rec.answer.figures[0].label);
  assert.equal(cmp.positions.differing.length, 1);
  assert.equal(cmp.positions.differing[0].id, rec.positions[1].id);
});

// ---- the API ---------------------------------------------------------------------------------------------------------------------------
test('?example and ?recorded are served, and the examples match the recording', async () => {
  const ex = await run({ q: { example: '1' }, body: null });
  assert.equal(ex.questions.length, 11);
  assert.deepEqual(ex.wallets, wallets);
  assert.deepEqual((await readExamples()).questions, questions);
  assert.equal((await run({ q: { recorded: '1' }, body: null })).demo.cases.length, demo.cases.length);
  assert.equal((await readDemo()).cases.length, 11);
});

test('bad input is a UserError before any server is asked', async () => {
  const never = { callTool: async () => { throw new Error('the chain must not be asked'); } };
  await assert.rejects(run({ q: {}, body: null, chain: never }), /give a wallet and a question/);
  await assert.rejects(run({ q: { wallet: WALLET }, body: null, chain: never }), /give a wallet and a question/);
  await assert.rejects(run({ q: { wallet: '0x12', question: 'What do I hold?' }, body: null, chain: never }), UserError);
  await assert.rejects(run({ q: { wallet: WALLET, question: 'What do I hold?', block: 'abc' }, body: null, chain: never }), /block must be a whole number/);
  await assert.rejects(run({ q: { replay: 'nope' }, body: null, chain: never }), /unknown recorded case "nope"; known: total, holdings/);
});

test('a question arrives by query or by body, and is answered from the chain', async () => {
  const w = makeWorld({ usdc: 5_000_000n });
  for (const [q, body] of [[{ wallet: WALLET, question: 'Where is my USDC?' }, null], [{}, { wallet: WALLET, question: 'Where is my USDC?' }]]) {
    const out = await run({ q, body, chain: w.chain, rpc: w.rpc });
    assert.equal(out.portfolio.answer.intent, 'where_token');
    assert.ok(out.portfolio.answer.text.includes('5 USDC'));
  }
});

test('replay asks the chain the recorded question at the recorded block and compares the answers', async () => {
  const w = makeWorld({ head: 21_200_000 });
  const rec = byId('holdings');
  const out = await run({ q: { replay: 'holdings' }, body: null, chain: w.chain, rpc: w.rpc });
  assert.equal(out.replayed.block.number, rec.block);
  assert.equal(out.case.id, 'holdings');
  assert.equal(out.comparison.sameBlock, true);
  assert.ok(out.comparison.figures.compared >= 1);
  // a different (fake) chain gives different amounts, and the comparison says so rather than passing
  assert.ok(out.comparison.positions.differing.length >= 1 || out.comparison.figures.differing.length >= 1);
});

test('the sample run the page shows is the recorded "Where is my USDC?" answer (a stale sample would show numbers nobody recorded)', async () => {
  const page = await import('../public/js/tasks/portfolio-assistant.js');
  const c = byId('where-usdc');
  const sample = page.content.run.sample;
  assert.ok(sample.includes(c.result.answer.text), 'the answer sentence');
  assert.ok(sample.includes(`block ${c.block.toLocaleString('en-US')}`));
  for (const f of c.result.answer.figures) assert.ok(sample.includes(f.value), f.label);
  const verify = page.content.verify.map((v) => v.code ?? '').join('\n');
  assert.ok(verify.includes(`--block ${c.block}`), 'the cast commands use the recorded block');
  assert.ok(page.content.verify.some((v) => v.text.includes('942942429833')), 'the raw USDC balance quoted for the cast check');
  assert.equal(c.result.positions.find((p) => p.id === 'USDC').amountRaw, '942942429833');
});

test('the page ships the same wallets and questions as the skill folder (a drifted copy would demo something else)', async () => {
  const page = await import('../public/js/tasks/portfolio-assistant.js');
  assert.deepEqual(page.WALLETS, wallets);
  assert.deepEqual(page.QUESTIONS, questions);
  assert.equal(page.content.evidence.length, 5);
  assert.deepEqual(page.content.tools, ['chain', 'rpc']);
});
