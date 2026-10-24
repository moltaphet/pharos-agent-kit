import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKENS, assessTransfer, buildTransfer, eip681, parseDecimal, parsePaymentText, preparePayment, readReference, referenceHex, tokenByAddress, tokenBySymbol } from '../lib/payments.js';
import { unsignedLegacyTx } from '../lib/rlp.js';
import { toChecksumAddress } from '../lib/address.js';
import { USDC } from '../lib/protocols.js';
import { UserError } from '../lib/snapshot.js';
import { PAYER, PAYEE, payWorld } from './support/pay-world.js';

const R = toChecksumAddress(PAYEE);
const parse = (text, o = {}) => parsePaymentText(text, { defaults: { from: PAYER }, ...o });
const fields = (r) => r.questions.map((q) => q.field);

// ---- amounts ---------------------------------------------------------------------------------------------------------------------------
test('amounts are exact decimals in the token’s base units, and more decimals than the token has is refused, not rounded', () => {
  assert.equal(parseDecimal('100', 6), 100_000_000n);
  assert.equal(parseDecimal('1,250.50', 6), 1_250_500_000n);
  assert.equal(parseDecimal('.5', 18), 5n * 10n ** 17n);
  assert.equal(parseDecimal('0.000001', 6), 1n);
  assert.throws(() => parseDecimal('1.1234567', 6), /has 7 decimals but this token only has 6/);
  for (const bad of ['', 'abc', '-1', '1e6', '1.2.3', '0x10']) assert.throws(() => parseDecimal(bad, 6), /plain number/, bad);
});

// ---- reading a sentence --------------------------------------------------------------------------------------------------------------
test('a complete request is understood without a question', () => {
  const r = parse(`send 100 USDC to ${R}`);
  assert.equal(r.intent, 'payment');
  assert.deepEqual(r.questions, []);
  assert.equal(r.understood.amount, '100');
  assert.equal(r.understood.token.symbol, 'USDC');
  assert.equal(r.understood.recipient, R);
  assert.equal(r.understood.from, PAYER);
});

test('verbs, case and word order do not matter', () => {
  for (const t of [`pay 100 usdc to ${R}`, `Transfer 100 USDC to ${R}`, `please wire ${R} 100 USDC`.replace(R, `to ${R}`), `give 100 USDC to ${R}`]) assert.deepEqual(fields(parse(t)), [], t);
});

test('amounts: 1.5k, 2m, thousands separators, a dollar sign', () => {
  const amount = (t) => parse(`send ${t} to ${R}`).understood.amount;
  assert.equal(amount('1.5k USDC'), '1500');
  assert.equal(amount('2m USDC'), '2000000');
  assert.equal(amount('1,250.50 USDC'), '1250.50');
  assert.equal(amount('0.25 PROS'), '0.25');
  assert.equal(amount('3 thousand USDC'), '3000');
});

test('the sender can be written in the sentence', () => {
  const other = '0x' + '77'.repeat(20);
  const r = parsePaymentText(`transfer 25 USDC from ${other} to ${R}`);
  assert.equal(r.understood.from, other);
  assert.equal(r.understood.recipient, R);
  assert.deepEqual(r.questions, []);
});

test('a token can be named by its contract address, and a known address is recognised', () => {
  const r = parse(`send 5 to ${R} token ${USDC}`);
  assert.equal(r.understood.token.symbol, 'USDC');
  const unlisted = '0x' + '99'.repeat(20);
  assert.equal(parse(`send 5 to ${R} token ${unlisted}`).understood.token.custom, true);
});

test('what is unclear is asked, never guessed: a name, “dollars”, two addresses, two amounts, “all”, a short address, no token, no amount', () => {
  assert.deepEqual(fields(parse('send 50 to bob')), ['recipient', 'token']);
  assert.match(parse('send 50 to bob').questions[0].question, /names are not addresses/);
  assert.deepEqual(parse(`send 100 dollars to ${R}`).questions.map((q) => [q.field, q.options]), [['token', ['USDC']]]);
  assert.deepEqual(parse(`send 1 ETH to ${R}`).questions.map((q) => [q.field, q.options]), [['token', ['WETH']]], 'Pharos has no ETH of its own');
  const a = '0x' + '11'.repeat(20);
  const b = '0x' + '22'.repeat(20);
  assert.equal(parse(`send 5 USDC, ${a} and ${b}`).questions.find((q) => q.field === 'recipient').problem, 'two-addresses');
  assert.equal(parse(`send 5 or 7 USDC to ${R}`).questions[0].problem, 'several-amounts');
  assert.equal(parse(`send all my USDC to ${R}`).questions[0].problem, 'all');
  assert.equal(parse(`send half my USDC to ${R}`).questions[0].problem, 'half');
  assert.equal(parse('send 5 USDC to 0x12abc').questions[0].problem, 'bad-address');
  assert.match(parse('send 5 USDC to 0x12abc').questions[0].question, /has 5 hex characters, and an address has exactly 40/);
  assert.deepEqual(fields(parse(`send USDC to ${R}`)), ['amount']);
  assert.deepEqual(fields(parse(`send 5 to ${R}`)), ['token']);
  assert.deepEqual(fields(parse(`send 5 FOO to ${R}`)), ['token']);
  assert.match(parse(`send 5 FOO to ${R}`).questions[0].question, /do not know a token called FOO/);
});

test('a sentence that hides several payments is a question: installments, repeats, extra numbers; times and dates are not amounts', () => {
  assert.equal(parse(`send 100 USDC to ${R} in 2 installments of 50 and 50`).questions[0].problem, 'several-payments');
  assert.equal(parse(`pay 100 USDC to ${R} every month`).questions[0].problem, 'several-payments');
  assert.equal(parse(`send 100 USDC to ${R} for invoice 4471`).questions[0].problem, 'several-payments');
  assert.deepEqual(fields(parse(`send 100 USDC to ${R} in 2 days`)), [], 'a time is not an amount');
  assert.deepEqual(fields(parse(`send 100 USDC to ${R} within 30 minutes`)), []);
});

test('answers to earlier questions win over the sentence; a contact resolves a name', () => {
  const r = parse('send 50 to bob', { answers: { recipient: R, token: 'USDC' } });
  assert.deepEqual(r.questions, []);
  assert.equal(r.understood.recipient, R);
  assert.equal(r.understood.token.symbol, 'USDC');
  const c = parse('send 50 USDC to bob', { contacts: { Bob: R } });
  assert.deepEqual(c.questions, []);
  assert.match(c.notes[0], /address book/);
  assert.throws(() => parse('send 5 USDC to bob', { answers: { token: 'NOPE' } }), /do not know a token called "NOPE"/);
  assert.deepEqual(fields(parsePaymentText(`send 5 USDC to ${R}`)), ['from'], 'with no wallet it asks which one pays');
});

test('what is not a payment is said so; an empty or huge request is refused', () => {
  assert.equal(parse('what is the price of USDC?').intent, 'not-a-payment');
  assert.equal(parse('hello').intent, 'not-a-payment');
  assert.throws(() => parse(''), /write what to pay/);
  assert.throws(() => parse('x'.repeat(401)), /too long/);
});

// ---- the transaction -----------------------------------------------------------------------------------------------------------------
test('an ERC-20 transfer is transfer(to, amount) to the token; PROS is a plain value transfer', () => {
  const usdc = buildTransfer({ token: tokenBySymbol('USDC'), to: R, amountRaw: 100_000_000n });
  assert.equal(usdc.to, USDC);
  assert.equal(usdc.value, 0n);
  assert.equal(usdc.data, '0xa9059cbb' + PAYEE.slice(2).padStart(64, '0') + (100_000_000n).toString(16).padStart(64, '0'));
  const pros = buildTransfer({ token: tokenBySymbol('PROS'), to: R, amountRaw: 10n ** 18n });
  assert.deepEqual([pros.to, pros.value, pros.data], [PAYEE, 10n ** 18n, '0x']);
});

test('a reference rides after the transfer’s own data and reads back; it is bounded and plain', () => {
  const data = buildTransfer({ token: tokenBySymbol('USDC'), to: R, amountRaw: 5n, reference: 'INV-2026-0042' }).data;
  assert.equal(data.length, 2 + 8 + 128 + 'INV-2026-0042'.length * 2);
  assert.equal(readReference(data), 'INV-2026-0042');
  assert.equal(readReference(buildTransfer({ token: tokenBySymbol('USDC'), to: R, amountRaw: 5n }).data), null);
  assert.equal(readReference('0x' + Buffer.from('rent march').toString('hex'), { native: true }), 'rent march');
  assert.equal(referenceHex(null), '');
  assert.throws(() => referenceHex('x'.repeat(65)), /at most 64 bytes/);
  assert.throws(() => referenceHex('a\nb'), /control characters/);
});

test('EIP-681 links, for a token and for PROS', () => {
  assert.equal(eip681({ token: { address: USDC }, to: R, amountRaw: 5n }), `ethereum:${USDC}@1672/transfer?address=${R}&uint256=5`);
  assert.equal(eip681({ token: { native: true }, to: R, amountRaw: 7n }), `ethereum:${R}@1672?value=7`);
});

test('the registry is the Pacific Mainnet one: PROS and four tokens, found by symbol or address', () => {
  assert.deepEqual(TOKENS.map((t) => t.symbol), ['PROS', 'WPROS', 'USDC', 'LINK', 'WETH']);
  assert.equal(tokenByAddress(USDC.toUpperCase().replace('0X', '0x')).symbol, 'USDC');
  assert.equal(tokenBySymbol('usdc').decimals, 6);
  assert.equal(tokenBySymbol('nope'), null);
});

// ---- checking against the chain ----------------------------------------------------------------------------------------------------------
test('a payment that holds up is READY, with the checks, a summary and an unsigned transaction whose bytes are the EIP-155 serialization', async () => {
  const W = payWorld();
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 100 USDC to ${R}`, from: PAYER });
  assert.equal(r.status, 'ready');
  assert.equal(r.block.number, W.w.head - 2);
  assert.deepEqual(r.checks.filter((c) => c.level === 'fail'), []);
  assert.equal(r.transaction.to, USDC);
  assert.equal(r.transaction.chainId, 1672);
  assert.equal(r.transaction.gas, Math.ceil(80_000 * 1.2));
  const u = r.transaction.unsignedRaw;
  assert.equal(u.nonce, 7);
  assert.equal(u.hex, unsignedLegacyTx({ nonce: 7, gasPrice: 10_000_000_000n, gasLimit: r.transaction.gas, to: USDC, value: 0n, data: r.transaction.data, chainId: 1672 }).raw);
  assert.match(r.summaryText, /^Send 100 USDC from 0x8ecdf4…24ab9f to 0x5a5A5a…5A5A5A on Pharos Pacific Mainnet\./);
  assert.match(r.summaryText, /Balance after: 900 USDC\./);
  assert.match(r.neverSent, /Nothing was signed or sent/);
  assert.deepEqual([...new Set(W.calls.filter((c) => c.who === 'chain').map((c) => c.name))].sort(), ['estimate_gas', 'eth_call', 'get_block', 'get_block_number', 'get_code', 'get_gas_price']);
  assert.ok(W.calls.some((c) => c.who === 'rpc' && c.method === 'eth_call'), 'the balance batch is repeated on the public RPC');
});

test('not enough tokens: blocked, with how much is short, and no transaction', async () => {
  const W = payWorld({ usdc: { [PAYER]: 50_000_000n } });
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 100 USDC to ${R}`, from: PAYER });
  assert.equal(r.status, 'blocked');
  assert.match(r.reason, /holds 50 USDC but 100 USDC was asked: 50 USDC short|transfer amount exceeds balance/);
  assert.equal(r.transaction, undefined);
  assert.ok(r.checks.some((c) => c.id === 'balance' && !c.ok));
});

test('PROS needs the amount and the gas: a wallet with exactly the amount is blocked', async () => {
  const W = payWorld({ native: { [PAYER]: 10n ** 18n } });
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 PROS to ${R}`, from: PAYER });
  assert.equal(r.status, 'blocked');
  assert.match(r.checks.find((c) => c.id === 'balance').detail, /needs 1\.0002\d* PROS \(1 PROS plus about 0\.0002\d* PROS of gas\)/);
  const ok = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 0.5 PROS to ${R}`, from: PAYER });
  assert.equal(ok.status, 'ready');
  assert.equal(ok.transaction.value, (5n * 10n ** 17n).toString());
  assert.equal(ok.transaction.to, PAYEE);
});

test('an ordinary account with no PROS cannot send; a smart-contract wallet only gets a warning', async () => {
  const eoa = '0x' + '12'.repeat(20);
  const W = payWorld({ usdc: { [eoa]: 5_000_000n } });
  const bad = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 USDC to ${R}`, from: eoa });
  assert.equal(bad.status, 'blocked');
  assert.match(bad.reason, /an ordinary account with no PROS cannot send anything/);
  const wallet = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 USDC to ${R}`, from: PAYER });
  assert.equal(wallet.status, 'ready');
  assert.equal(wallet.checks.find((c) => c.id === 'gas-balance').level, 'warn');
});

test('a mistyped address is blocked by its own checksum, naming the correct spelling', async () => {
  const W = payWorld();
  const flipped = R.slice(0, 3) + (R[3] === R[3].toUpperCase() ? R[3].toLowerCase() : R[3].toUpperCase()) + R.slice(4);
  const typo = [...R.slice(2)].findIndex((c) => /[a-f]/i.test(c)) + 2;
  const mistyped = R.slice(0, typo) + (R[typo] === R[typo].toUpperCase() ? R[typo].toLowerCase() : R[typo].toUpperCase()) + R.slice(typo + 1);
  assert.notEqual(mistyped, R);
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 USDC to ${mistyped}`, from: PAYER });
  assert.equal(r.status, 'blocked');
  assert.match(r.reason, new RegExp(`checksum does not match.*should read ${R}`));
  void flipped;
});

test('the zero address, the token contract itself and too many decimals are refused', async () => {
  const W = payWorld();
  const zero = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 USDC to 0x${'0'.repeat(40)}`, from: PAYER });
  assert.equal(zero.status, 'blocked');
  assert.match(zero.reason, /burned/);
  const self = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 USDC to ${USDC}`, from: PAYER });
  assert.equal(self.status, 'blocked');
  assert.match(self.reason, /tokens sent to their own contract are usually lost/);
  const fine = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1.1234567 USDC to ${R}`, from: PAYER });
  assert.equal(fine.status, 'blocked');
  assert.match(fine.reason, /has 7 decimals but this token only has 6/);
});

test('a transfer the token would refuse is blocked with its reason, even though the balance is fine', async () => {
  const W = payWorld({ failTransfers: true });
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 USDC to ${R}`, from: PAYER });
  assert.equal(r.status, 'blocked');
  assert.match(r.reason, /it would fail: paused/);
});

test('a token contract that is not there, or does not answer like a token, is refused', async () => {
  const W = payWorld();
  const none = '0x' + '98'.repeat(20);
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 to ${R} token ${none}`, from: PAYER });
  assert.equal(r.status, 'blocked');
  assert.match(r.reason, /no contract code at 0x9898/);
});

test('a Chain MCP backend that answers with the wrong balance is caught by the public RPC', async () => {
  let lied = false;
  const W = payWorld({ wrong: (target, data) => { if (lied || target.toLowerCase() !== USDC || !data.startsWith('0x70a08231')) return undefined; lied = true; return '0x' + (10n ** 30n).toString(16).padStart(64, '0'); } });
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 100 USDC to ${R}`, from: PAYER });
  assert.equal(r.status, 'ready');
  assert.match(r.summaryText, /Balance after: 900 USDC/, 'the true balance, not the lie');
});

test('questions are answered before anything is read from the chain', async () => {
  const W = payWorld();
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: 'send 50 to bob', from: PAYER });
  assert.equal(r.status, 'needs-info');
  assert.deepEqual(W.calls.filter((c) => c.name === 'eth_call' || c.method === 'eth_call'), []);
  assert.equal((await preparePayment({ chain: W.chain, rpc: W.rpc, text: 'what is the price of USDC?', from: PAYER })).status, 'refused');
});

test('bad wallets are refused with a clear message', async () => {
  const W = payWorld();
  const r = await preparePayment({ chain: W.chain, rpc: W.rpc, text: `send 1 USDC to ${R}`, from: '0x12' });
  assert.equal(r.status, 'needs-info');
  await assert.rejects(assessTransfer({ chain: W.chain, rpc: W.rpc, from: '0x12', to: R, token: tokenBySymbol('USDC'), amountText: '1' }), UserError);
  await assert.rejects(assessTransfer({ chain: W.chain, rpc: W.rpc, from: PAYER, to: R, token: tokenBySymbol('USDC'), amountText: '1', block: W.w.head }), /block must be a whole number/);
});
