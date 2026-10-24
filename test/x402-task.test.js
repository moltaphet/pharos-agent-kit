import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import run, { readConfig, readRun, readTokenCheck } from '../lib/tasks/x402-paywalled-api.js';
import { ROUTES, b64, createPayment, requirementsFor, parseConfig } from '../lib/x402.js';
import { addressFromPrivateKey } from '../lib/secp256k1.js';

const file = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const rec = JSON.parse(file('../reports/x402-run.json'));
const tokenCheck = JSON.parse(file('../reports/x402-token-check.json'));
const config = JSON.parse(file('../config/x402.json'));
const label = (s) => rec.requests.find((r) => r.label.startsWith(s));

test('the run was on Pharos Atlantic testnet: the network, the test USDC and the prices', () => {
  assert.equal(rec.network.caip2, 'eip155:688689');
  assert.equal(rec.network.chainId, 688689);
  assert.deepEqual(rec.routes.map((r) => [r.route, r.amount ?? null]), [['GET /health', null], ['GET /api/info', '5000'], ['GET /data', '10000']]);
  assert.equal(rec.token.address, config.asset);
  assert.equal(rec.payTo, config.payTo);
  assert.equal(rec.challenge.accepts[0].network, 'eip155:688689');
  assert.equal(rec.challenge.accepts[0].asset, config.asset);
});

test('the flow over real HTTP: free route 200, then a 402, then a signed payment and a 200 with the PAYMENT-RESPONSE and its transaction', () => {
  assert.equal(label('GET /health').response.status, 200);
  const unpaid = label('GET /data with no payment');
  assert.equal(unpaid.response.status, 402);
  assert.ok(unpaid.response.headers['payment-required']);
  assert.deepEqual(b64.dec(unpaid.response.headers['payment-required']), unpaid.response.paymentRequired);
  for (const l of ['GET /data, paid', 'GET /api/info, paid']) {
    const r = label(l);
    assert.equal(r.response.status, 200, l);
    assert.equal(r.response.paymentResponse.success, true, l);
    assert.match(r.response.paymentResponse.transaction, /^0x[0-9a-f]{64}$/, l);
    assert.equal(r.response.paymentResponse.network, 'eip155:688689', l);
  }
  assert.deepEqual(label('GET /data, paid').response.body.message, 'Hello, paid user!');
});

test('every settlement is a real, successful Atlantic transaction sent by the facilitator, moving exactly the price from the payer to the recipient', () => {
  assert.equal(rec.settlements.length, 2);
  assert.deepEqual(rec.settlements.map((s) => s.transferValue), ['10000', '5000']);
  for (const s of rec.settlements) {
    assert.equal(s.status, 'success');
    assert.equal(s.from, rec.facilitator.toLowerCase(), 'the facilitator sends it: it pays the gas');
    assert.equal(s.to, config.asset);
    assert.equal(s.transferFrom, config.payer.toLowerCase());
    assert.equal(s.transferTo, config.payTo.toLowerCase());
    assert.equal(s.payerIsNotSender, true);
    assert.match(s.explorer, /^https:\/\/atlantic\.pharosscan\.xyz\/tx\/0x[0-9a-f]{64}$/);
    assert.equal(s.value, '0');
  }
  assert.equal(rec.summary.payToReceived, rec.summary.expectedPayTo);
  assert.equal(rec.summary.payerPaidNoGas, true);
});

test('nine ways of cheating were all answered 402, and not one token moved', () => {
  assert.equal(rec.cheats.length, 9);
  assert.ok(rec.cheats.every((c) => c.status === 402));
  assert.equal(rec.summary.cheatsRejectedWith402, 9);
  assert.equal(rec.summary.tokensMovedByCheats, '0');
  assert.equal(rec.summary.tokensMovedByVerify, '0');
  assert.equal(rec.balances.afterPaid.payTo, rec.balances.afterCheats.payTo);
  const reasons = rec.cheats.map((c) => c.reason ?? '');
  for (const re of [/authorization_value: underpaid/, /recipient_mismatch/, /valid_before/, /payload_signature/, /insufficient_balance/, /nonce_already_used/, /not base64 JSON/, /invalid_payment_requirements/]) assert.ok(reasons.some((r) => re.test(r)), String(re));
});

test('the facilitator’s three routes answered: supported kinds, a valid payment verified (and not settled), an underpaid one refused', () => {
  assert.deepEqual(rec.facilitatorRoutes.supported.kinds, [{ x402Version: 2, scheme: 'exact', network: 'eip155:688689' }]);
  assert.equal(rec.facilitatorRoutes.verifyValid.isValid, true);
  assert.equal(rec.facilitatorRoutes.verifyUnderpaid.isValid, false);
  assert.match(rec.facilitatorRoutes.verifyUnderpaid.invalidReason, /authorization_value/);
});

test('the token in the Pharos x402 guide has no EIP-3009 and a restricted mint; ours has it', () => {
  assert.equal(tokenCheck.docsToken.token, '0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8');
  assert.equal(tokenCheck.docsToken.transferWithAuthorization, false);
  assert.equal(tokenCheck.docsToken.authorizationState, false);
  assert.equal(tokenCheck.docsToken.permit, false);
  assert.match(tokenCheck.docsToken.mintAttempt, /cannot mint.*AccessControlUnauthorizedAccount/);
  assert.equal(tokenCheck.registryToken.transferWithAuthorization, false);
  assert.equal(tokenCheck.ourToken.transferWithAuthorization, true);
  assert.equal(tokenCheck.ourToken.authorizationState, true);
  assert.equal(tokenCheck.ourToken.token, config.asset);
});

test('keys: none in the recording, none in the committed config, and the processes were started with only a file path', () => {
  const text = file('../reports/x402-run.json') + file('../config/x402.json') + file('../reports/x402-token-check.json');
  assert.equal(/"privateKey"\s*:/i.test(text), false);
  assert.equal(/FACILITATOR_PRIVATE_KEY"?\s*[:=]\s*"?0x[0-9a-f]{64}/i.test(text), false);
  assert.match(rec.processes.keys, /read its key from the file named by FACILITATOR_PRIVATE_KEY_FILE/);
  for (const f of ['lib/x402.js', 'agents/x402-paywalled-api/server.js', 'agents/x402-paywalled-api/facilitator.js', 'agents/x402-paywalled-api/client.js', 'api/x402.js']) {
    const src = file(`../${f}`);
    assert.equal(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(src.replace(/0x\[0-9a-fA-F\]\{64\}/g, '')), false, `${f} holds no 32-byte hex literal`);
    assert.equal(/privateKey\s*[:=]\s*['"]0x/.test(src), false, f);
  }
  try {
    const wallet = JSON.parse(file('../.wallet/atlantic-testnet.json')).privateKey.replace(/^0x/, '');
    const payer = JSON.parse(file('../.wallet/x402-payer.json')).privateKey.replace(/^0x/, '');
    for (const t of [text, file('../lib/x402.js'), file('../README.md'), file('../public/js/tasks/x402-paywalled-api.js')]) { assert.equal(t.includes(wallet), false); assert.equal(t.includes(payer), false); }
    assert.equal(addressFromPrivateKey('0x' + payer).toLowerCase(), config.payer.toLowerCase(), 'the payer key file belongs to the configured payer');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
});

test('?example, ?challenge, ?supported and ?verify answer from the real config; bad input is a UserError', async () => {
  const ex = await run({ q: { example: '1' } });
  assert.deepEqual(ex.routes.map((r) => [r.path, r.price]), [['/health', null], ['/api/info', '0.005'], ['/data', '0.01']]);
  assert.equal(ex.routes[2].requirements.amount, '10000');
  assert.equal(ex.config.asset, config.asset);
  assert.equal('privateKey' in ex.config, false);
  const ch = await run({ q: { challenge: '/data' } });
  assert.equal(ch.status, 402);
  assert.deepEqual(b64.dec(ch.headers['PAYMENT-REQUIRED']), ch.body);
  await assert.rejects(run({ q: { challenge: '/health' } }), /challenge must be one of the paid routes: \/api\/info, \/data/);
  await assert.rejects(run({ q: {}, body: null }), /use \?example=1/);
  await assert.rejects(run({ q: { verify: '1' }, body: {} }), /POST \{ "route": "\/data", "paymentPayload"/);
  assert.equal((await readConfig()).network, 'eip155:688689');
  assert.equal((await readRun()).summary.settlements, 2);
  assert.equal((await readTokenCheck()).ourToken.token, config.asset);
});

test('the paywall’s payments are checked against the requirements the config produces', () => {
  const requirements = requirementsFor(parseConfig(config), ROUTES.find((r) => r.path === '/data'));
  const payment = createPayment({ requirements, privateKey: '0x' + '11'.repeat(32) });
  assert.equal(payment.accepted.amount, '10000');
  assert.equal(payment.payload.authorization.to, config.payTo.toLowerCase());
});

test('the page ships the six requirements, the real run’s tools, and a sample taken from the recording', async () => {
  const page = await import('../public/js/tasks/x402-paywalled-api.js');
  assert.equal(page.content.evidence.length, 6);
  assert.deepEqual(page.content.tools, ['chain', 'rpc']);
  assert.ok(page.content.run.sample.includes(rec.settlements[0].hash.slice(0, 10)) || page.content.run.sample.includes('PAYMENT-RESPONSE'));
  assert.ok(page.content.run.sample.includes(rec.cheats[0].reason.split(':')[0]));
  assert.ok(page.content.verify.some((v) => v.code?.includes(config.asset)));
});
