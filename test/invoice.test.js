import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, interpretInvoice, parseMoney, prepareInvoicePayment } from '../lib/invoice.js';
import { readReference } from '../lib/payments.js';
import { toChecksumAddress } from '../lib/address.js';
import { USDC } from '../lib/protocols.js';
import { UserError } from '../lib/snapshot.js';
import { PAYER, payWorld } from './support/pay-world.js';

const P = toChecksumAddress('0x' + '5a'.repeat(20));
const NOW = Date.parse('2026-10-25');
const TEXT = (extra = {}) => ['INVOICE #INV-7', 'Date: 2026-10-20', 'Due: 2027-11-19', 'From: Harbor Studio', `Pay to: ${P}`, 'Design – 2 x 100.00 USDC', 'Hosting – 40.00 USDC', 'Subtotal: 240.00 USDC', 'Tax: 10.00 USDC', extra.total ?? 'Total due: 250.00 USDC'].filter(Boolean).join('\n');
const read = (text, o = {}) => interpretInvoice(text, { now: NOW, ...o });
const codes = (r) => r.flags.map((f) => `${f.severity}:${f.code}`);

test('three formats are told apart', () => {
  assert.equal(detectFormat('{"id":1}'), 'json');
  assert.equal(detectFormat('  [1]'), 'json');
  assert.equal(detectFormat('ethereum:0xabc@1672/transfer?address=0x1'), 'link');
  assert.equal(detectFormat('INVOICE 1\nTotal: 5 USDC'), 'text');
  assert.throws(() => detectFormat(''), /paste an invoice/);
  assert.throws(() => detectFormat('x'.repeat(6001)), /too long/);
});

test('money: "250.00 USDC", "$1,250.00", "€480", "1.5" and what is not money', () => {
  assert.deepEqual(parseMoney('250.00 USDC'), { text: '250.00', unit: 'USDC' });
  assert.deepEqual(parseMoney('$1,250.00'), { text: '1250.00', unit: 'USD' });
  assert.deepEqual(parseMoney('€480'), { text: '480', unit: 'EUR' });
  assert.deepEqual(parseMoney('1.5'), { text: '1.5', unit: null });
  assert.equal(parseMoney('nothing'), null);
});

test('a plain-text invoice is read completely and raises no flag', () => {
  const { out, flags } = read(TEXT());
  assert.deepEqual(flags, []);
  assert.equal(out.format, 'text');
  assert.equal(out.reference, 'INV-7');
  assert.equal(out.payee.address, P);
  assert.equal(out.payee.name, 'Harbor Studio');
  assert.deepEqual(out.amount, { text: '250.00' });
  assert.equal(out.token.symbol, 'USDC');
  assert.equal(out.due, '2027-11-19');
  assert.equal(out.items.length, 2);
});

test('a JSON invoice is read, with the payment details beside it or inside it', () => {
  const doc = { invoice: { id: '2026-117', due: '2027-12-01', payee: { name: 'Nova', address: P }, currency: 'USDC', items: [{ description: 'Mixing', quantity: 3, unitPrice: '300.00' }, { description: 'Mastering', quantity: 1, unitPrice: '300.50' }], total: '1200.50' }, payment: { chainId: 1672, token: USDC } };
  const a = read(JSON.stringify(doc));
  assert.deepEqual(a.flags, []);
  assert.equal(a.out.reference, '2026-117');
  assert.equal(a.out.chainId, 1672);
  const inside = read(JSON.stringify({ invoice: { ...doc.invoice, payment: doc.payment } }));
  assert.deepEqual(inside.flags, []);
  assert.throws(() => read('{ nope'), /not valid JSON/);
  assert.throws(() => read('[1,2]'), /must be an object/);
  const flat = read(JSON.stringify({ number: 'A-1', payTo: P, currency: 'USDC', amountDue: 5 }));
  assert.equal(flat.out.reference, 'A-1');
  assert.deepEqual(flat.out.amount, { text: '5' });
});

test('a payment link: the token, the payee, the amount in base units and the reference', () => {
  const { out, flags } = read(`ethereum:${USDC}@1672/transfer?address=${P}&uint256=75000000&ref=ORD-88123`);
  assert.equal(out.reference, 'ORD-88123');
  assert.equal(out.payee.address, P);
  assert.equal(out.token.symbol, 'USDC');
  assert.deepEqual(out.amount, { text: '75000000', raw: '75000000', base: true });
  assert.deepEqual(codes({ flags }), ['info:no-due']);
  const native = read(`ethereum:${P}@1672?value=1000000000000000000&ref=R1`);
  assert.equal(native.out.token.native, true);
  assert.deepEqual(native.out.amount, { text: '1000000000000000000', raw: '1000000000000000000', base: true });
  assert.throws(() => read(`ethereum:${USDC}@1672/approve?address=${P}`), /only transfer is a payment/);
  assert.throws(() => read('ethereum:'), /does not look like/);
});

test('missing things are errors, not guesses: reference, payee, amount, currency', () => {
  assert.ok(codes(read(TEXT().replace('INVOICE #INV-7', 'INVOICE'))).includes('error:missing-reference'));
  assert.ok(codes(read(TEXT().replace(`Pay to: ${P}`, ''))).includes('error:missing-payee'));
  assert.ok(codes(read(TEXT().replace('Total due: 250.00 USDC', ''))).includes('error:missing-amount'));
  assert.ok(codes(read(['INVOICE #X-1', `Pay to: ${P}`, 'Total due: 250'].join('\n'))).includes('error:missing-currency'));
  assert.ok(codes(read(TEXT().replace(`Pay to: ${P}`, 'Pay to: account 4471 0902'))).includes('error:payee-not-address'));
});

test('a heading that merely starts like a label is not a reference: a bare INVOICE has none, and "Referral" is not "Ref"', () => {
  const bare = read(TEXT().replace('INVOICE #INV-7', 'INVOICE'));
  assert.equal(bare.out.reference, null);
  assert.ok(codes(bare).includes('error:missing-reference'));
  assert.equal(read(TEXT().replace('INVOICE #INV-7', 'Referral program\nINVOICE')).out.reference, null);
  assert.equal(read(TEXT().replace('INVOICE #INV-7', 'Invoice: AB-12')).out.reference, 'AB-12');
  assert.equal(read(TEXT().replace('INVOICE #INV-7', 'Reference: R-9')).out.reference, 'R-9');
  assert.equal(read(TEXT().replace('INVOICE #INV-7', 'INV No. 55')).out.reference, '55');
  assert.equal(read(TEXT().replace('INVOICE #INV-7', 'Invoice number: BX-5521')).out.reference, 'BX-5521');
});

test('addresses: the wrong length, a bad checksum, all one case, the zero address, a second address', () => {
  const short = codes(read(TEXT().replace(P, '0x12abc')));
  assert.ok(short.includes('error:bad-payee'));
  const i = [...P.slice(2)].findIndex((c) => /[a-f]/i.test(c)) + 2;
  const typo = P.slice(0, i) + (P[i] === P[i].toUpperCase() ? P[i].toLowerCase() : P[i].toUpperCase()) + P.slice(i + 1);
  const bad = read(TEXT().replace(P, typo));
  assert.ok(codes(bad).includes('error:checksum'));
  assert.match(bad.flags.find((f) => f.code === 'checksum').message, new RegExp(`should read ${P}`));
  assert.ok(codes(read(TEXT().replace(P, P.toLowerCase()))).includes('info:no-checksum'));
  assert.ok(codes(read(TEXT().replace(P, '0x' + '0'.repeat(40)))).includes('error:zero-payee'));
  const other = toChecksumAddress('0x' + '77'.repeat(20));
  assert.ok(codes(read(TEXT() + `\nRemit to: ${other}`)).includes('error:several-addresses'), 'a second address is how payments get redirected');
});

test('totals: two different totals, line items that do not add up, a subtotal that is wrong', () => {
  assert.ok(codes(read(TEXT({ total: 'Total due: 250.00 USDC\nAmount due: 205.00 USDC' }))).includes('error:amount-mismatch'));
  const wrong = read(TEXT({ total: 'Total due: 205.00 USDC' }));
  assert.ok(codes(wrong).includes('error:total-mismatch'));
  assert.match(wrong.flags.find((f) => f.code === 'total-mismatch').message, /subtotal 240\.00 \+ tax 10\.00 = 250\.00, but the total says 205\.00/);
  assert.ok(codes(read(TEXT().replace('Subtotal: 240.00 USDC', 'Subtotal: 230.00 USDC'))).includes('error:subtotal-mismatch'));
  assert.deepEqual(codes(read(TEXT().replace('Tax: 10.00 USDC', 'Tax: 10.00 USDC\nDiscount: 0.00 USDC'))), []);
  // exact decimals: 0.1 + 0.2 is 0.3
  const exact = read(['INVOICE #E-1', `Pay to: ${P}`, 'A – 0.10 USDC', 'B – 0.20 USDC', 'Total due: 0.30 USDC'].join('\n'));
  assert.deepEqual(exact.flags.filter((f) => f.severity === 'error'), []);
});

test('currencies: dollars need a token to be chosen, a chosen USDC is a warning, euros cannot be converted, an unknown one is refused', () => {
  const usd = ['Invoice number: BX-1', `Wallet: ${P}`, 'Total due: $1,250.00'].join('\n');
  assert.ok(codes(read(usd)).includes('error:currency-needs-token'));
  const chosen = read(usd, { payIn: 'USDC' });
  assert.deepEqual(codes(chosen).filter((c) => c.startsWith('warn') || c.startsWith('error')), ['warn:usd-as-usdc']);
  assert.equal(chosen.out.token.symbol, 'USDC');
  assert.ok(codes(read(['INVOICE EU-1', `Pay to: ${P}`, 'Total due: 480.00 EUR'].join('\n'))).includes('error:no-conversion'));
  assert.ok(codes(read(['INVOICE Z-1', `Pay to: ${P}`, 'Total due: 5 XYZ'].join('\n'))).includes('error:unknown-currency'));
  assert.ok(codes(read(usd, { payIn: 'LINK' })).includes('error:currency-needs-token'), 'only USDC stands in for dollars');
});

test('tokens: a look-alike contract named USDC is refused, a different symbol is a mismatch, an unknown symbol is refused', () => {
  const fake = toChecksumAddress('0x' + 'de'.repeat(20));
  const j = (token, currency = 'USDC') => JSON.stringify({ invoice: { id: 'T-1', payee: { address: P }, currency, total: '5' }, payment: { chainId: 1672, token } });
  const a = read(j(fake));
  assert.ok(codes(a).includes('error:token-mismatch'));
  assert.match(a.flags.find((f) => f.code === 'token-mismatch').message, /look-alike token is worth nothing/);
  assert.ok(codes(read(j('0x51e2a24742db77604b881d6781ee16b5b8fcbe29'))).includes('error:token-mismatch'), 'it says USDC but names LINK');
  assert.ok(codes(read(j('FOO'))).includes('error:unknown-token'));
  assert.deepEqual(read(j(USDC)).flags.filter((f) => f.severity === 'error'), []);
});

test('the chain: another chain id or another network is refused', () => {
  const j = (network) => JSON.stringify({ invoice: { id: 'C-1', payee: { address: P }, currency: 'USDC', total: '5' }, payment: { chainId: network } });
  assert.ok(codes(read(j(1))).includes('error:wrong-chain'));
  assert.ok(codes(read(j('Ethereum'))).includes('error:wrong-chain'));
  assert.deepEqual(read(j(1672)).flags.filter((f) => f.severity === 'error'), []);
  assert.ok(codes(read(TEXT() + '\nNetwork: Pharos Atlantic Testnet')).includes('error:wrong-chain'));
});

test('dates: overdue is a warning judged against the day given, a missing date is information; a bad reference is an error', () => {
  assert.ok(codes(read(TEXT().replace('2027-11-19', '2026-09-01'))).includes('warn:overdue'));
  assert.ok(!codes(read(TEXT().replace('2027-11-19', '2026-09-01'), { now: Date.parse('2026-08-01') })).includes('warn:overdue'));
  assert.ok(codes(read(TEXT().replace('Due: 2027-11-19\n', ''))).includes('info:no-due'));
  assert.ok(codes(read(TEXT().replace('INVOICE #INV-7', 'INVOICE #' + 'X'.repeat(50)))).includes('error:bad-reference'));
});

// ---- against the chain --------------------------------------------------------------------------------------------------------------------
test('a good invoice becomes a READY payment whose calldata carries the reference, and whose summary names the invoice', async () => {
  const W = payWorld();
  const r = await prepareInvoicePayment({ chain: W.chain, rpc: W.rpc, invoice: TEXT(), from: PAYER, now: NOW });
  assert.equal(r.status, 'ready');
  assert.equal(r.transaction.to, USDC);
  assert.equal(readReference(r.transaction.data), 'INV-7');
  assert.match(r.summary[0], /^Pay invoice INV-7 from Harbor Studio: 250 USDC to 0x5a5A5a5a5A5a5a5a5a5A5a5A5A5a5a5A5A5A5A5A, due 2027-11-19\./);
  assert.match(r.summary.join(' '), /Reference "INV-7" is written into the transaction data/);
  assert.match(r.eip681, /^ethereum:0xc879c018db60520f4355c26ed1a6d572cdac1815@1672\/transfer\?address=/);
  assert.match(r.neverSent, /Nothing was signed or sent/);
});

test('a link in base units, and a USD invoice paid in USDC (with its warning), are prepared; the warning is carried', async () => {
  const W = payWorld();
  const link = await prepareInvoicePayment({ chain: W.chain, rpc: W.rpc, invoice: `ethereum:${USDC}@1672/transfer?address=${P}&uint256=75000000&ref=ORD-1`, from: PAYER, now: NOW });
  assert.equal(link.status, 'ready');
  assert.equal(link.amountText, '75 USDC');
  const usd = await prepareInvoicePayment({ chain: W.chain, rpc: W.rpc, invoice: ['Invoice number: BX-1', `Wallet: ${P}`, 'Total due: $250.00'].join('\n'), from: PAYER, payIn: 'USDC', now: NOW });
  assert.equal(usd.status, 'ready-with-warnings');
  assert.ok(usd.flags.some((f) => f.code === 'usd-as-usdc'));
  assert.ok(usd.transaction);
});

test('an invoice with an error flag is blocked before the chain is read at all', async () => {
  const W = payWorld();
  const r = await prepareInvoicePayment({ chain: W.chain, rpc: W.rpc, invoice: TEXT({ total: 'Total due: 205.00 USDC' }), from: PAYER, now: NOW });
  assert.equal(r.status, 'blocked');
  assert.match(r.reason, /does not add up/);
  assert.equal(r.transaction, undefined);
  assert.equal(W.calls.length, 0);
});

test('a good invoice with no paying wallet asks for one; a bad wallet is an error; not enough USDC is blocked on the chain', async () => {
  const W = payWorld();
  const ask = await prepareInvoicePayment({ chain: W.chain, rpc: W.rpc, invoice: TEXT(), now: NOW });
  assert.equal(ask.status, 'needs-info');
  assert.equal(ask.questions[0].field, 'from');
  await assert.rejects(prepareInvoicePayment({ chain: W.chain, rpc: W.rpc, invoice: TEXT(), from: '0x12', now: NOW }), UserError);
  const poor = payWorld({ usdc: { [PAYER]: 100_000_000n } });
  const r = await prepareInvoicePayment({ chain: poor.chain, rpc: poor.rpc, invoice: TEXT(), from: PAYER, now: NOW });
  assert.equal(r.status, 'blocked');
  assert.match(r.reason, /holds 100 USDC but 250 USDC was asked|transfer amount exceeds balance/);
});
