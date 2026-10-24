import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run, { compareReplay, fingerprint, readDemo, readExamples, readFork } from '../lib/tasks/natural-language-payment-agent.js';
import { readReference } from '../lib/payments.js';
import { unsignedLegacyTx } from '../lib/rlp.js';
import { USDC } from '../lib/protocols.js';
import { PAYER, payWorld } from './support/pay-world.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const demo = JSON.parse(file('../reports/payments-demo.json'));
const fork = JSON.parse(file('../reports/payments-fork-run.json'));
const examples = JSON.parse(file('../agents/natural-language-payment-agent/examples/requests.json'));
const byId = (id) => demo.payments.find((c) => c.id === id);

test('the recording has the fifteen example requests, all pinned to one real mainnet block', () => {
  assert.deepEqual(demo.payments.map((c) => c.id), examples.map((e) => e.id));
  assert.equal(new Set(demo.payments.map((c) => c.block)).size, 1);
  assert.deepEqual(demo.payments.map((c) => c.result.status), ['ready', 'ready', 'ready', 'blocked', 'blocked', 'needs-info', 'ready', 'needs-info', 'needs-info', 'needs-info', 'needs-info', 'blocked', 'blocked', 'blocked', 'refused']);
  for (const c of demo.payments.filter((x) => x.result.block)) assert.equal(c.result.block.number, c.block, c.id);
});

test('what it asks, and what it refuses, is for a stated reason', () => {
  const q = (id) => byId(id).result.questions.map((x) => `${x.field}:${x.problem}`);
  assert.deepEqual(q('name'), ['recipient:name', 'token:missing']);
  assert.deepEqual(q('dollars'), ['token:dollars']);
  assert.deepEqual(q('short-address'), ['recipient:bad-address']);
  assert.deepEqual(q('all'), ['amount:all']);
  assert.deepEqual(q('two-amounts'), ['amount:several-payments']);
  assert.match(byId('typo').result.reason, /checksum does not match/);
  assert.match(byId('to-token').result.reason, /their own contract are usually lost/);
  assert.match(byId('too-precise').result.reason, /has 7 decimals but this token only has 6/);
  assert.match(byId('no-link').result.reason, /holds 0 LINK but 25 LINK was asked|transfer amount exceeds balance/);
  assert.match(byId('no-pros').result.reason, /holds 0 PROS but needs/);
  assert.equal(byId('not-a-payment').result.status, 'refused');
  assert.deepEqual(byId('name-answered').answers, { recipient: '0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A', token: 'USDC' });
  assert.equal(byId('name-answered').result.status, 'ready', 'the answers to its questions complete the request');
  for (const id of ['name', 'dollars', 'short-address', 'all', 'two-amounts', 'not-a-payment']) assert.equal(byId(id).result.chainCalls, 0, `${id}: nothing was read from the chain`);
});

test('a ready request has a summary, every check passing, and an unsigned transaction that is exactly an ERC-20 transfer', () => {
  for (const id of ['usdc', 'thousand', 'sender-in-text', 'name-answered']) {
    const r = byId(id).result;
    assert.equal(r.status, 'ready', id);
    assert.ok(r.checks.every((c) => c.ok || c.level === 'note' || c.level === 'warn'), id);
    assert.equal(r.transaction.to, USDC, id);
    assert.equal(r.transaction.chainId, 1672, id);
    assert.equal(r.transaction.value, '0', id);
    assert.match(r.transaction.data, /^0xa9059cbb[0-9a-f]{128}$/, id);
    assert.match(r.summaryText, /^Send [\d,.]+ USDC from 0x8ecdf4…24ab9f to 0x5a5A5a…5A5A5A on Pharos Pacific Mainnet\./, id);
    assert.match(r.neverSent, /Nothing was signed or sent/, id);
    const u = r.transaction.unsignedRaw;
    assert.equal(u.hex, unsignedLegacyTx({ nonce: u.nonce, gasPrice: BigInt(u.gasPriceWei), gasLimit: r.transaction.gas, to: r.transaction.to, value: 0n, data: r.transaction.data, chainId: 1672 }).raw, `${id}: the bytes are the EIP-155 serialization of the fields`);
  }
  assert.equal(BigInt('0x' + byId('thousand').result.transaction.data.slice(-64)), 1_500_000_000n, '1.5k USDC is 1,500 USDC');
  assert.equal(byId('sender-in-text').result.understood.from, '0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f');
});

test('every read in the recording was confirmed on the public RPC, and only reads were asked of Chain MCP', () => {
  for (const c of demo.payments.filter((x) => x.result.chainCalls)) {
    const tools = new Set(c.result.steps.filter((s) => s.actor === 'chain-mcp').map((s) => s.name));
    for (const t of tools) assert.ok(['eth_call', 'get_block', 'get_block_number', 'get_code', 'get_gas_price', 'estimate_gas', 'get_balance'].includes(t), `${c.id}: ${t}`);
    assert.ok(c.result.steps.some((s) => s.actor === 'public-rpc'), c.id);
  }
});

test('the signed bytes were accepted by a real EVM (a fork of mainnet): exact amounts, the hash the bytes imply, signed by the throwaway key only', () => {
  const cases = fork.cases.filter((c) => c.task === 17);
  assert.equal(cases.length, 2);
  for (const c of cases) {
    assert.equal(c.sent.status, 'success', c.label);
    assert.equal(c.exact, true, c.label);
    assert.equal(c.hashMatches, true, c.label);
    assert.equal(c.signer, true, c.label);
    assert.equal(c.sent.input, c.data, `${c.label}: the chain holds the calldata the agent prepared`);
    assert.match(c.unsignedHex, /^0x[0-9a-f]+$/);
  }
  assert.equal(fork.summary.mined, fork.summary.cases);
  assert.match(fork.network, /signed with anvil's public dev key #0/);
});

test('the recordings hold no secret: no private key field, and not the throwaway testnet key', () => {
  const text = file('../reports/payments-demo.json') + file('../reports/payments-fork-run.json') + file('../reports/recurring-demo.json') + file('../reports/recurring-fork-run.json');
  assert.equal(/"privateKey"\s*:/i.test(text), false);
  try {
    const key = JSON.parse(file('../.wallet/atlantic-testnet.json')).privateKey;
    assert.equal(text.includes(key.replace(/^0x/, '')), false);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
});

test('compareReplay: the same answer passes; a different transaction, check or verdict is named; the fee is not compared', () => {
  const rec = byId('usdc').result;
  const same = compareReplay(rec, structuredClone(rec));
  assert.equal(same.identical, same.compared);
  assert.equal(same.sameBlock, true);
  const fee = structuredClone(rec);
  fee.gas.feeText = '9 PROS';
  assert.equal(compareReplay(rec, fee).identical, same.compared, 'the live gas price is not part of the comparison');
  const other = structuredClone(rec);
  other.transaction.data = '0x00';
  other.status = 'blocked';
  other.checks[0].ok = false;
  assert.deepEqual(compareReplay(rec, other).differing.map((d) => d.what), ['status', 'checks', 'transaction']);
  assert.deepEqual(Object.keys(fingerprint(rec)), ['status', 'understood', 'questions', 'checks', 'transaction']);
});

test('?example and ?recorded are served; bad input is a UserError; the sentence, the wallet, the answers and the contacts arrive by query or body', async () => {
  const ex = await run({ q: { example: '1' }, body: null });
  assert.deepEqual(ex.requests, examples);
  assert.deepEqual(ex.tokens.map((t) => t.symbol), ['PROS', 'WPROS', 'USDC', 'LINK', 'WETH']);
  const rec = await run({ q: { recorded: '1' }, body: null });
  assert.equal(rec.demo.payments.length, 15);
  assert.deepEqual(rec.fork, fork);
  assert.equal((await readExamples()).length, 15);
  assert.equal((await readDemo()).invoices.length, 10);
  assert.equal((await readFork()).cases.length, 5);
  const W = payWorld();
  await assert.rejects(run({ q: {}, body: null, chain: W.chain }), /write what to pay/);
  await assert.rejects(run({ q: { text: 'send 1 USDC', from: '0x12' }, body: null, chain: W.chain }), /from must be a 0x address/);
  await assert.rejects(run({ q: { text: 'send 1 USDC', answers: '[1]' }, body: null, chain: W.chain }), /answers must be a JSON object/);
  await assert.rejects(run({ q: { text: 'send 1 USDC', answers: '{bad' }, body: null, chain: W.chain }), /answers must be a JSON object/);
  await assert.rejects(run({ q: { text: 'send 1 USDC', block: 'abc' }, body: null, chain: W.chain }), /block must be a whole number/);
  await assert.rejects(run({ q: { replay: 'nope' }, body: null, chain: W.chain }), /unknown recorded case "nope"; known: usdc/);
  const R = '0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A';
  const byQuery = await run({ q: { text: `send 5 USDC to ${R}`, from: PAYER }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(byQuery.payment.status, 'ready');
  const byBody = await run({ q: {}, body: { text: 'send 5 to bob', from: PAYER, answers: { recipient: R, token: 'USDC' } }, chain: W.chain, rpc: W.rpc });
  assert.equal(byBody.payment.status, 'ready');
  const withContacts = await run({ q: { text: 'send 5 USDC to bob', from: PAYER, contacts: JSON.stringify({ bob: R }) }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(withContacts.payment.status, 'ready');
  assert.equal(readReference(withContacts.payment.transaction.data), null);
});

test('replay works the recorded request out again at the recorded block and compares it', async () => {
  const W = payWorld({ head: 21_200_000 });
  const out = await run({ q: { replay: 'usdc' }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(out.replayed.block.number, byId('usdc').block);
  assert.equal(out.comparison.sameBlock, true);
  assert.equal(out.comparison.compared, 5);
  assert.equal(out.comparison.differing.length, 0, 'the fake world agrees with the recorded request on everything it compares');
});

test('the page ships the same requests as the examples, and its sample is the recorded first request', async () => {
  const page = await import('../public/js/tasks/natural-language-payment-agent.js');
  assert.deepEqual(page.REQUESTS, examples);
  assert.equal(page.content.evidence.length, 4);
  const r = byId('usdc');
  for (const line of r.result.summary) assert.ok(page.content.run.sample.includes(line), line);
  assert.ok(page.content.run.sample.includes(`block ${r.block.toLocaleString('en-US')}`) || page.content.run.sample.includes(`block ${r.result.block.number.toLocaleString('en-US')}`));
  assert.ok(page.content.run.sample.includes(`gas ${r.result.transaction.gas}`));
});
