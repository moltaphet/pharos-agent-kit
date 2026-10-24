#!/usr/bin/env node
// The x402 Paywalled API, run for real on Pharos Atlantic testnet (chain 688689), over real HTTP, with real settlement transactions.
//
// It starts the facilitator and the resource server as separate processes (agents/x402-paywalled-api/): the facilitator reads its key from a file named in the environment, the
// server talks to it over HTTP exactly as in the Pharos x402 guide. This script is the client: it GETs /health (free), GETs /data and gets a 402, signs a payment, retries and gets
// a 200 with a PAYMENT-RESPONSE header and the settlement transaction, which is then read back from the chain. Then it tries to cheat (underpay, wrong recipient, expired,
// forged signature, replay, no funds, garbage) and shows that every attempt is a 402 and that no token moved.
//
//   node scripts/x402-run.mjs        writes reports/x402-run.json and reports/x402-token-check.json   (needs scripts/x402-setup.mjs to have run)

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { rpcCall } from '../lib/rpc.js';
import { HEADERS, authorizationDigest, b64, createPayment, explorerTx, payAndFetch, priceToAmount } from '../lib/x402.js';
import { addressFromPrivateKey, sign } from '../lib/secp256k1.js';
import { selectorOf } from '../lib/keccak.js';

const config = JSON.parse(readFileSync(new URL('../config/x402.json', import.meta.url), 'utf8'));
const payerFile = fileURLToPath(new URL('../.wallet/x402-payer.json', import.meta.url));
const facilitatorKeyFile = fileURLToPath(new URL('../.wallet/atlantic-testnet.json', import.meta.url));
const payerKey = JSON.parse(readFileSync(payerFile, 'utf8')).privateKey;
const rpc = (method, params) => rpcCall(method, params, { url: ATLANTIC.rpc, why: `x402 run: ${method}` });
const say = (s) => process.stderr.write(s + '\n');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const balanceOf = async (who) => BigInt(await rpc('eth_call', [{ to: config.asset, data: selectorOf('balanceOf(address)') + addrWord(who) }, 'latest']));

// ---- the processes ---------------------------------------------------------------------------------------------------------------------------
const env = { ...process.env, FACILITATOR_PRIVATE_KEY_FILE: facilitatorKeyFile, FACILITATOR_URL: 'http://127.0.0.1:4122', PORT: '4122' };
delete env.FACILITATOR_PRIVATE_KEY;
const children = [];
const start = (script, port) => new Promise((resolve, reject) => {
  const p = spawn('node', [script], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(p);
  let out = '';
  p.stdout.on('data', (d) => { out += d; if (/ on http/.test(out)) resolve(out.trim()); });
  p.stderr.on('data', (d) => { out += d; });
  p.on('exit', (code) => reject(new Error(`${script} exited ${code}: ${out}`)));
  setTimeout(() => reject(new Error(`${script} did not start: ${out}`)), 15000);
});

const record = [];
const BASE = 'http://127.0.0.1:4121';
const trimHeaders = (h) => Object.fromEntries([...h.entries()].filter(([k]) => ['content-type', 'payment-required', 'payment-response', 'access-control-expose-headers'].includes(k.toLowerCase())));
async function call(label, path, { headers = {}, note = null } = {}) {
  const res = await fetch(BASE + path, { headers });
  const body = await res.json().catch(() => null);
  const row = { label, request: { method: 'GET', url: BASE + path, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, k.toLowerCase() === 'payment-signature' ? `${String(v).slice(0, 40)}… (${String(v).length} chars)` : v])) }, response: { status: res.status, headers: trimHeaders(res.headers), body }, note };
  if (res.headers.get(HEADERS.required)) row.response.paymentRequired = b64.dec(res.headers.get(HEADERS.required));
  if (res.headers.get(HEADERS.response)) row.response.paymentResponse = b64.dec(res.headers.get(HEADERS.response));
  record.push(row);
  say(`  ${label}: HTTP ${res.status}${body?.error ? ` · ${String(body.error).slice(0, 110)}` : ''}`);
  return { res, body, row };
}

const sendSigned = (payment) => ({ [HEADERS.signature]: b64.enc(payment) });
const requirementsFor = (route) => ({ scheme: 'exact', network: config.network, amount: priceToAmount(route === '/data' ? '0.01' : '0.005', 6), asset: config.asset, payTo: config.payTo, maxTimeoutSeconds: 300, extra: { name: config.name, version: config.version } });
// a payment built by hand with whatever terms we like, signed by `key`, so a cheat can be a correctly signed authorization for the wrong thing
function custom({ route = '/data', key = payerKey, as = null, value = null, to = null, validBefore = null, tamper = false }) {
  const req = requirementsFor(route);
  const now = Math.floor(Date.now() / 1000);
  const from = as ?? addressFromPrivateKey(key);
  const authorization = { from, to: to ?? req.payTo, value: String(value ?? req.amount), validAfter: String(now - 60), validBefore: String(validBefore ?? now + 300), nonce: '0x' + randomBytes(32).toString('hex') };
  const s = sign(authorizationDigest({ name: config.name, version: config.version, chainId: 688689, verifyingContract: config.asset }, authorization), key);
  return { x402Version: 2, accepted: req, payload: { signature: tamper ? s.signature.slice(0, -4) + (s.signature.slice(-4) === '1b1b' ? '1c1c' : '1b1b') : s.signature, authorization } };
}

let result;
try {
  say('starting the facilitator and the server as separate processes …');
  const facilitatorSays = await start('agents/x402-paywalled-api/facilitator.js', 4122);
  const serverSays = await start('agents/x402-paywalled-api/server.js', 4121);
  say(`  ${facilitatorSays}\n  ${serverSays}`);

  // 0. the token the docs name, and ours
  const check = async (token) => {
    const code = await rpc('eth_getCode', [token, 'latest']);
    const has = (sig) => code.toLowerCase().includes(selectorOf(sig).slice(2));
    let mint = null;
    try { await rpc('eth_call', [{ from: '0x0eC197b8A30543c93e521a6C3F2DB5d110e60850', to: token, data: selectorOf('mint(address,uint256)') + addrWord('0x0eC197b8A30543c93e521a6C3F2DB5d110e60850') + word(1_000_000) }, 'latest']); mint = 'a caller with no special role could mint'; } catch (e) { mint = `a plain caller cannot mint: ${e.rpc?.data ? `reverted with ${String(e.rpc.data).slice(0, 10)}${String(e.rpc.data).startsWith('0xe2517d3f') ? ' (AccessControlUnauthorizedAccount)' : ''}` : e.message}`; }
    return { token, codeBytes: (code.length - 2) / 2, transferWithAuthorization: has('transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'), authorizationState: has('authorizationState(address,bytes32)'), DOMAIN_SEPARATOR: has('DOMAIN_SEPARATOR()'), permit: has('permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'), mint: has('mint(address,uint256)'), mintAttempt: mint };
  };
  const tokenCheck = { checkedAt: new Date().toISOString(), network: 'Pharos Atlantic testnet (688689)', why: 'The exact x402 scheme needs EIP-3009 transferWithAuthorization. The Pharos x402 guide names a test token; this checks whether it can be used.', docsToken: await check('0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8'), registryToken: await check('0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B'), ourToken: await check(config.asset) };
  writeFileSync(new URL('../reports/x402-token-check.json', import.meta.url), JSON.stringify(tokenCheck, null, 1) + '\n');
  say(`  docs token supports transferWithAuthorization: ${tokenCheck.docsToken.transferWithAuthorization}; ours: ${tokenCheck.ourToken.transferWithAuthorization}`);

  const before = { payer: await balanceOf(config.payer), payTo: await balanceOf(config.payTo) };
  say(`balances before: payer ${before.payer}, payTo ${before.payTo} (base units)`);

  // 1. the free route, and the 402
  await call('GET /health (free)', '/health');
  const unpaid = await call('GET /data with no payment', '/data');

  // 2. pay for /data and /api/info, with the client
  const settlements = [];
  for (const [label, path] of [['GET /data, paid by the client', '/data'], ['GET /api/info, paid by the client', '/api/info']]) {
    const r = await payAndFetch({ url: BASE + path, privateKey: payerKey, maxAmount: '20000' });
    record.push({ label, request: { method: 'GET', url: BASE + path, steps: ['GET → 402 with PAYMENT-REQUIRED', 'sign an EIP-3009 authorization for exactly the price', 'GET again with PAYMENT-SIGNATURE'] }, response: { status: r.status, body: r.body, paymentResponse: r.settlement, paymentRequired: r.challenge } });
    say(`  ${label}: HTTP ${r.status} · tx ${r.settlement?.transaction}`);
    settlements.push({ path, price: r.requirements.amount, status: r.status, settlement: r.settlement, payment: r.payment, body: r.body });
  }

  // 3. the settlements, read back from the chain
  const chainProof = [];
  for (const s of settlements) {
    const receipt = await rpc('eth_getTransactionReceipt', [s.settlement.transaction]);
    const tx = await rpc('eth_getTransactionByHash', [s.settlement.transaction]);
    const transfer = receipt.logs.find((l) => l.address.toLowerCase() === config.asset && l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
    chainProof.push({ path: s.path, hash: s.settlement.transaction, explorer: explorerTx(s.settlement.transaction), status: receipt.status === '0x1' ? 'success' : 'reverted', blockNumber: Number(BigInt(receipt.blockNumber)), gasUsed: Number(BigInt(receipt.gasUsed)), from: tx.from.toLowerCase(), to: tx.to.toLowerCase(), value: BigInt(tx.value).toString(), gasPaidBy: 'the facilitator (the transaction’s sender)', transferFrom: transfer && '0x' + transfer.topics[1].slice(26), transferTo: transfer && '0x' + transfer.topics[2].slice(26), transferValue: transfer && BigInt(transfer.data).toString(), payerIsNotSender: tx.from.toLowerCase() !== config.payer.toLowerCase() });
  }
  const afterPaid = { payer: await balanceOf(config.payer), payTo: await balanceOf(config.payTo) };

  // 4. cheats
  say('trying to cheat …');
  const tries = [];
  const cheat = async (label, headers, note) => { const r = await call(label, '/data', { headers, note }); tries.push({ label, status: r.res.status, reason: r.body?.error ?? null }); };
  await cheat('underpaid: signed for 0.005, the price is 0.01', sendSigned(custom({ value: 5000 })), 'a correctly signed authorization for half the price');
  await cheat('wrong recipient', sendSigned(custom({ to: '0x000000000000000000000000000000000000dEaD' })), 'a correctly signed authorization that pays someone else');
  await cheat('expired authorization', sendSigned(custom({ validBefore: Math.floor(Date.now() / 1000) - 10 })), 'valid until ten seconds ago');
  const otherKey = '0x' + randomBytes(32).toString('hex');
  await cheat('forged signature: signed by another key, claiming to be the payer', sendSigned(custom({ key: otherKey, as: config.payer })), 'authorization.from is the payer; the signature is not the payer’s');
  await cheat('tampered signature', sendSigned(custom({ tamper: true })), 'the last bytes of a good signature changed');
  await cheat('no funds: a new key that holds no tokens', sendSigned(custom({ key: otherKey })), 'a correctly signed payment from an account with no USDC');
  const replayed = settlements[0].payment;
  await cheat('replay: the payment that was already settled, sent again', sendSigned(replayed), 'the same PAYMENT-SIGNATURE as the successful /data call');
  await cheat('garbage in the payment header', { [HEADERS.signature]: 'not-base64-json!!' }, 'not a payment at all');
  await cheat('a payment for the cheaper route sent to the dearer one', sendSigned(custom({ route: '/api/info' })), 'the requirements it names (0.005) are not this route’s (0.01)');
  const afterCheats = { payer: await balanceOf(config.payer), payTo: await balanceOf(config.payTo) };

  // 5. the facilitator's own routes, straight
  const supported = await (await fetch('http://127.0.0.1:4122/supported')).json();
  const goodPayment = createPayment({ requirements: requirementsFor('/data'), privateKey: payerKey });
  const verifyOnly = await (await fetch('http://127.0.0.1:4122/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentPayload: goodPayment, paymentRequirements: requirementsFor('/data') }) })).json();
  const verifyBad = await (await fetch('http://127.0.0.1:4122/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentPayload: custom({ value: 1 }), paymentRequirements: requirementsFor('/data') }) })).json();
  const afterVerify = { payer: await balanceOf(config.payer), payTo: await balanceOf(config.payTo) };

  result = {
    recordedAt: new Date().toISOString(),
    network: { name: ATLANTIC.name, chainId: ATLANTIC.chainId, caip2: 'eip155:688689', rpc: ATLANTIC.rpc, explorer: ATLANTIC.explorer },
    token: { address: config.asset, explorer: `${ATLANTIC.explorer}/address/${config.asset}`, note: config.note },
    payTo: config.payTo, payer: config.payer, facilitator: supported.signers['eip155:*'][0],
    routes: [{ route: 'GET /health', price: null }, { route: 'GET /api/info', price: '0.005 USDC', amount: '5000' }, { route: 'GET /data', price: '0.01 USDC', amount: '10000' }],
    processes: { facilitator: facilitatorSays, server: serverSays, keys: 'the facilitator read its key from the file named by FACILITATOR_PRIVATE_KEY_FILE; the client read the payer key from .wallet/ (EVM_PRIVATE_KEY_FILE style); no key is in code, in a command line, or in this report' },
    challenge: unpaid.row.response.paymentRequired,
    settlements: chainProof,
    balances: { before, afterPaid, afterCheats, afterVerifyOnly: afterVerify },
    cheats: tries,
    facilitatorRoutes: { supported, verifyValid: verifyOnly, verifyUnderpaid: verifyBad },
    requests: record,
    summary: {
      paidRoutes: 2, freeRoutes: 1, settlements: chainProof.length, settledOnChain: chainProof.filter((c) => c.status === 'success').length,
      payToReceived: (afterPaid.payTo - before.payTo).toString(), expectedPayTo: (settlements.reduce((s, x) => s + BigInt(x.price), 0n)).toString(),
      cheatsAttempted: tries.length, cheatsRejectedWith402: tries.filter((t) => t.status === 402).length,
      tokensMovedByCheats: (afterCheats.payTo - afterPaid.payTo).toString(), tokensMovedByVerify: (afterVerify.payTo - afterCheats.payTo).toString(),
      payerPaidNoGas: chainProof.every((c) => c.payerIsNotSender),
    },
  };
  writeFileSync(new URL('../reports/x402-run.json', import.meta.url), JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1) + '\n');
  const s = result.summary;
  console.log(`wrote reports/x402-run.json: ${s.settledOnChain}/${s.settlements} settlements on chain, payTo +${s.payToReceived} (expected ${s.expectedPayTo}), ${s.cheatsRejectedWith402}/${s.cheatsAttempted} cheats answered 402, tokens moved by cheats: ${s.tokensMovedByCheats}`);
  process.exitCode = s.settledOnChain === 2 && s.payToReceived === s.expectedPayTo && s.cheatsRejectedWith402 === s.cheatsAttempted && s.tokensMovedByCheats === '0' ? 0 : 1;
} finally {
  for (const c of children) c.kill();
}
