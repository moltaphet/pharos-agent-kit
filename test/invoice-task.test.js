import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run, { compareReplay, readDemo, readExamples } from '../lib/tasks/invoice-to-payment-agent.js';
import { interpretInvoice } from '../lib/invoice.js';
import { readReference } from '../lib/payments.js';
import { PAYER, payWorld } from './support/pay-world.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const demo = JSON.parse(file('../reports/payments-demo.json'));
const fork = JSON.parse(file('../reports/payments-fork-run.json'));
const examples = JSON.parse(file('../agents/invoice-to-payment-agent/examples/invoices.json'));
const byId = (id) => demo.invoices.find((c) => c.id === id);
const errors = (r) => r.flags.filter((f) => f.severity === 'error').map((f) => f.code);

test('the recording has the ten sample invoices of three formats, judged against one stated day at one pinned block', () => {
  assert.deepEqual(demo.invoices.map((c) => c.id), examples.map((e) => e.id));
  assert.equal(new Set(demo.invoices.map((c) => c.block)).size, 1);
  assert.equal(new Set(demo.invoices.map((c) => c.now)).size, 1);
  assert.deepEqual(new Set(demo.invoices.map((c) => c.result.format)), new Set(['text', 'json', 'link']));
  assert.deepEqual(demo.invoices.map((c) => c.result.status), ['ready', 'ready', 'ready', 'blocked', 'blocked', 'blocked', 'blocked', 'ready-with-warnings', 'blocked', 'blocked']);
});

test('each refused invoice is refused for the reason it was written to show, and nothing is guessed', () => {
  assert.deepEqual(errors(byId('wrong-total').result), ['total-mismatch']);
  assert.deepEqual(errors(byId('no-address').result), ['payee-not-address']);
  assert.deepEqual(errors(byId('fake-usdc').result), ['token-mismatch']);
  assert.deepEqual(errors(byId('usd-no-token').result), ['currency-needs-token']);
  assert.deepEqual(errors(byId('euro').result), ['no-conversion']);
  assert.deepEqual(errors(byId('typo-address').result), ['checksum']);
  assert.match(byId('typo-address').result.flags.find((f) => f.code === 'checksum').message, /should read 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A/);
  for (const id of ['wrong-total', 'no-address', 'fake-usdc', 'usd-no-token', 'euro', 'typo-address']) {
    const r = byId(id).result;
    assert.equal(r.transaction, undefined, `${id}: no transaction for an invoice with an error`);
    assert.equal(r.chainCalls, 0, `${id}: the chain was not even asked`);
    assert.equal(r.summary, null, id);
  }
  assert.match(byId('wrong-total').result.reason, /subtotal 240\.00 \+ tax 10\.00 = 250\.00, but the total says 205\.00/);
});

test('the three payable invoices carry their reference in the transaction data; the dollar invoice is payable only when USDC is chosen, with a warning', () => {
  for (const [id, ref, amount] of [['text-usdc', 'INV-2026-0042', 250_000_000n], ['json-usdc', '2026-117', 1_200_500_000n], ['link-usdc', 'ORD-88123', 75_000_000n]]) {
    const r = byId(id).result;
    assert.equal(r.status, 'ready', id);
    assert.equal(r.invoice.reference, ref, id);
    assert.equal(readReference(r.transaction.data), ref, id);
    assert.equal(BigInt('0x' + r.transaction.data.slice(10 + 64, 10 + 128)), amount, id);
    assert.ok(r.summary[0].startsWith(`Pay invoice ${ref}`), id);
  }
  const usd = byId('usd-in-usdc').result;
  assert.equal(usd.status, 'ready-with-warnings');
  assert.deepEqual(usd.flags.filter((f) => f.severity === 'warn').map((f) => f.code), ['usd-as-usdc']);
  assert.equal(readReference(usd.transaction.data), 'BX-5521');
});

test('the recorded checks were made on real mainnet state and confirmed on the public RPC', () => {
  for (const c of demo.invoices.filter((x) => x.result.status.startsWith('ready'))) {
    assert.ok(c.result.checks.every((k) => k.ok || k.level === 'note' || k.level === 'warn'), c.id);
    assert.ok(c.result.steps.some((s) => s.actor === 'public-rpc'), c.id);
    assert.equal(c.result.block.number, c.block, c.id);
  }
});

test('three invoices were paid on a fork: the exact amount moved, the hash is the one the bytes imply, and the reference was read back from the mined transaction', () => {
  const cases = fork.cases.filter((c) => c.task === 19);
  assert.deepEqual(cases.map((c) => c.invoiceId), ['text-usdc', 'json-usdc', 'link-usdc']);
  for (const c of cases) {
    assert.equal(c.sent.status, 'success', c.invoiceId);
    assert.equal(c.exact, true, c.invoiceId);
    assert.equal(c.hashMatches, true, c.invoiceId);
    assert.equal(c.referenceMatches, true, c.invoiceId);
    assert.equal(c.referenceOnChain, byId(c.invoiceId).result.invoice.reference, c.invoiceId);
    assert.equal(c.data, byId(c.invoiceId).result.transaction.data, `${c.invoiceId}: the fork got the very calldata the recording shows`);
  }
  assert.equal(fork.summary.referencesRead, 3);
});

test('compareReplay: the same answer passes; a different flag, verdict or transaction is named', () => {
  const rec = byId('wrong-total').result;
  assert.equal(compareReplay(rec, structuredClone(rec)).identical, 5);
  const other = structuredClone(rec);
  other.status = 'ready';
  other.flags = [];
  assert.deepEqual(compareReplay(rec, other).differing.map((d) => d.what), ['status', 'flags']);
});

test('?example and ?recorded are served; bad input is a UserError; an invoice arrives by query or body', async () => {
  assert.deepEqual((await run({ q: { example: '1' }, body: null })).invoices, examples);
  assert.equal((await run({ q: { recorded: '1' }, body: null })).demo.invoices.length, 10);
  assert.equal((await readExamples()).length, 10);
  assert.equal((await readDemo()).payments.length, 15);
  const W = payWorld();
  await assert.rejects(run({ q: {}, body: null, chain: W.chain }), /paste an invoice/);
  await assert.rejects(run({ q: { invoice: 'INVOICE #1\nTotal: 5 USDC', from: '0x12' }, body: null, chain: W.chain }), /from must be a 0x address/);
  await assert.rejects(run({ q: { invoice: 'x', block: 'abc' }, body: null, chain: W.chain }), /block must be a whole number/);
  await assert.rejects(run({ q: { replay: 'nope' }, body: null, chain: W.chain }), /unknown recorded case "nope"; known: text-usdc/);
  const text = examples[0].text;
  const viaBody = await run({ q: {}, body: { invoice: text, from: PAYER }, chain: W.chain, rpc: W.rpc });
  assert.equal(viaBody.payment.status, 'ready');
  const viaQuery = await run({ q: { invoice: examples[3].text, from: PAYER }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(viaQuery.payment.status, 'blocked');
  const noWallet = await run({ q: { invoice: text }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(noWallet.payment.status, 'needs-info');
});

test('replay reads the recorded invoice again at its block, with its day, and compares', async () => {
  const W = payWorld({ head: 21_200_000 });
  const out = await run({ q: { replay: 'text-usdc' }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(out.replayed.block.number, byId('text-usdc').block);
  assert.equal(out.comparison.sameBlock, true);
  assert.equal(out.comparison.differing.length, 0);
  const flagged = await run({ q: { replay: 'euro' }, body: null, chain: W.chain, rpc: W.rpc });
  assert.equal(flagged.comparison.differing.length, 0, 'a refused invoice is refused the same way, without reading the chain');
});

test('the page ships the same invoices as the examples; the sample is the recorded flagged invoice; every example reads as the recording says', async () => {
  const page = await import('../public/js/tasks/invoice-to-payment-agent.js');
  assert.deepEqual(page.INVOICES, examples);
  assert.equal(page.content.evidence.length, 4);
  const r = byId('wrong-total');
  assert.ok(page.content.run.sample.startsWith(r.text));
  assert.ok(page.content.run.sample.includes(r.result.flags[0].message));
  for (const e of examples) assert.deepEqual(interpretInvoice(e.text, { payIn: e.payIn, now: demo.invoices[0].now }).flags, byId(e.id).result.flags, e.id);
});
