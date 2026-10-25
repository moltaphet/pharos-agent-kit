import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecimal, parsePaymentText, assessTransfer, readReference, referenceHex, TOKENS, TRANSFER } from '../lib/payments.js';
import { interpretInvoice } from '../lib/invoice.js';
import { dryRun } from '../lib/tasks/dry-run-executor.js';
import { UserError } from '../lib/snapshot.js';
import { PAYEE, PAYER, payWorld } from './support/pay-world.js';

const parse = (text, opts = {}) => parsePaymentText(text, { defaults: { from: PAYER }, ...opts });
test('audit: transaction references are read only from valid canonical transfer calldata or valid native input', () => {
  const good = TRANSFER + '0'.repeat(24) + PAYEE.slice(2) + '0'.repeat(64) + referenceHex('rp:rent:0');
  assert.equal(readReference(good), 'rp:rent:0');
  assert.equal(readReference('0x12345678' + good.slice(10)), null);
  assert.equal(readReference('0x' + 'zz'), null);
  assert.equal(readReference('0xff', { native: true }), null);
  assert.equal(readReference('0x' + referenceHex('rp:rent:0'), { native: true }), 'rp:rent:0');
});
test('audit: a negative or signed amount is never silently made positive', () => {
  for (const amount of ['-5', '−5', '+5', '1e3', '1,5', '1.234,56']) {
    const p = parse(`send ${amount} USDC to ${PAYEE}`);
    assert.ok(p.questions.some((q) => q.field === 'amount'), amount);
  }
});
test('audit: negated and conditional instructions do not prepare a payment', () => {
  for (const prefix of ['do not send', "don't send", 'never send', 'if approved send', 'send only if approved']) {
    const p = parse(`${prefix} 5 USDC to ${PAYEE}`);
    assert.ok(p.intent === 'not-a-payment' || p.questions.length > 0, prefix);
  }
});
test('audit: an explicit to does not hide a second recipient or conflicting token address', () => {
  const p = parse(`send 5 USDC to ${PAYEE} and ${PAYER}`);
  assert.ok(p.questions.some((q) => q.field === 'recipient'));
  const token = '0x' + '99'.repeat(20);
  const c = parse(`send 5 USDC to ${PAYEE} token ${token}`);
  assert.ok(c.questions.some((q) => q.field === 'token'));
});
test('audit: decimal input accepts proper grouping and bounds the ABI amount and token scale', () => {
  assert.equal(parseDecimal('1,234.50', 6), 1234500000n);
  for (const s of ['1,5', '1,,000', ',1', '1,000,00', '1 2']) assert.throws(() => parseDecimal(s, 6));
  for (const decimals of [-1, 1.5, 256, Infinity]) assert.throws(() => parseDecimal('1', decimals));
  assert.throws(() => parseDecimal((2n ** 256n).toString(), 0), /uint256|too large/i);
});
test('audit: dry run and payment gate reject an ERC-20 transfer that returns false', async () => {
  const W = payWorld();
  const base = W.chain.callTool;
  W.chain.callTool = async (tool, args) => tool === 'eth_call' && args.transaction.data.startsWith('0xa9059cbb')
    ? { result: '0x' + '0'.repeat(64) } : base(tool, args);
  const r = await assessTransfer({ chain: W.chain, rpc: W.rpc, from: PAYER, to: PAYEE, token: TOKENS[2], amountText: '5' });
  assert.equal(r.ok, false);
  assert.equal(r.transaction, undefined);
  const sim = await dryRun({ chain: W.chain }, { from: PAYER, to: TOKENS[2].address, data: '0xa9059cbb' + PAYEE.slice(2).padStart(64, '0') + '5'.padStart(64, '0') });
  assert.equal(sim.verdict, 'blocked');
  assert.match(sim.summary, /false|refus/i);
});
test('audit: invalid on-chain decimals fail closed before formatting or serialization', async () => {
  const custom = '0x' + '99'.repeat(20);
  const W = payWorld({ tokens: { [custom]: { symbol: 'BAD', decimals: 256, balances: { [PAYER]: 100n } } } });
  const r = await assessTransfer({ chain: W.chain, rpc: W.rpc, from: PAYER, to: PAYEE, token: { address: custom, decimals: null }, amountText: '1' });
  assert.equal(r.ok, false);
  assert.equal(r.transaction, undefined);
});

const invoice = (overrides = {}) => ({ id: 'INV-5', payee: PAYEE, currency: 'USDC', total: '25', ...overrides });
test('audit: explicit token never bypasses invoice currency or token conflicts', () => {
  for (const overrides of [{ currency: 'EUR', token: 'USDC' }, { currency: 'WETH', token: 'USDC' }, { currency: 'USD', token: 'WPROS' }]) {
    const r = interpretInvoice(JSON.stringify(invoice(overrides)));
    assert.equal(r.hasErrors, true, JSON.stringify(overrides));
  }
});
test('audit: conflicting currency fields and same-number totals are refused', () => {
  const text = `Invoice: INV-5\nPay to: ${PAYEE}\nCurrency: USDC\nTotal: 25 WETH`;
  assert.equal(interpretInvoice(text).hasErrors, true);
  assert.equal(interpretInvoice(`Invoice: INV-5\nPay to: ${PAYEE}\nTotal: 25 USDC\nAmount due: 25 WETH`).hasErrors, true);
});
test('audit: malformed invoice arithmetic is a user error or flag, never an internal BigInt exception', () => {
  for (const overrides of [{ items: [{ quantity: 1, unitPrice: 'oops' }] }, { items: [{ quantity: 'bad', unitPrice: '25' }] }, { items: [{ amount: 'oops' }] }, { total: 'oops', subtotal: 'oops' }]) {
    try { assert.equal(interpretInvoice(JSON.stringify(invoice(overrides))).hasErrors, true); }
    catch (err) { assert.ok(err instanceof UserError, err.message); }
  }
});
test('audit: zero or fractional EIP-681 base units are refused before BigInt conversion', () => {
  for (const value of ['0', '-1', '1.5', '1e18', (2n ** 256n).toString()]) {
    const r = interpretInvoice(`ethereum:${TOKENS[2].address}@1672/transfer?address=${PAYEE}&uint256=${value}&ref=INV-5`);
    assert.equal(r.hasErrors, true, value);
  }
});
test('audit: a line total must agree with quantity times unit price', () => {
  const r = interpretInvoice(JSON.stringify(invoice({ items: [{ quantity: 2, unitPrice: '25', amount: '25' }] })));
  assert.equal(r.hasErrors, true);
});
test('audit: malformed grouped money and contradictory duplicate invoice fields are refused', () => {
  assert.throws(() => interpretInvoice(JSON.stringify(invoice({ total: '1,5' }))), UserError);
  const text = `Invoice: INV-5\nReference: INV-6\nPay to: ${PAYEE}\nTotal: 25 USDC`;
  assert.equal(interpretInvoice(text).hasErrors, true);
});
