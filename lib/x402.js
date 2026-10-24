// x402 on Pharos Atlantic testnet (eip155:688689), written from the protocol and with no dependency: a resource server that answers 402 until it is paid, a facilitator that
// verifies and settles payments (/verify, /settle, /supported), and a client that signs a payment and retries. The scheme is "exact" on an EVM chain: the payer signs an EIP-712
// TransferWithAuthorization (EIP-3009) for the exact price, and the facilitator submits it to the token contract and pays the gas, so the payer needs tokens and no PHRS.
//
// Wire format (x402 v2): a 402 carries the requirements in a PAYMENT-REQUIRED header (base64 JSON) and in its body; the client retries with a PAYMENT-SIGNATURE header (base64 JSON
// payload); the 200 carries a PAYMENT-RESPONSE header (base64 JSON, with the settlement transaction hash). Private keys are only ever read from the environment or from a file:
// loadPrivateKey().

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { keccak256, selectorOf } from './keccak.js';
import { addressFromPrivateKey, parseSignature, recoverAddress, sign } from './secp256k1.js';
import { signedLegacyTx } from './rlp.js';
import { isAddress } from './abi.js';
import { checksumStatus } from './address.js';
import { UserError } from './snapshot.js';

export const X402_VERSION = 2;
export const NETWORK = 'eip155:688689';
export const CHAIN_ID = 688689;
export const EXPLORER = 'https://atlantic.pharosscan.xyz';
export const HEADERS = { required: 'PAYMENT-REQUIRED', signature: 'PAYMENT-SIGNATURE', response: 'PAYMENT-RESPONSE' };
export const VALID_BEFORE_BUFFER = 6; // seconds: a payment that expires in the next few seconds cannot be settled in time

export const b64 = {
  enc: (obj) => Buffer.from(JSON.stringify(obj)).toString('base64'),
  dec: (text) => { try { return JSON.parse(Buffer.from(String(text), 'base64').toString('utf8')); } catch { return null; } },
};
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const hex = (b) => Buffer.from(b).toString('hex');
const sel = {
  transferWithAuthorization: selectorOf('transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'),
  authorizationState: selectorOf('authorizationState(address,bytes32)'),
  balanceOf: selectorOf('balanceOf(address)'),
};
export const explorerTx = (hash) => `${EXPLORER}/tx/${hash}`;

// ---- keys: environment or file, never code ------------------------------------------------------------------------------------------------------

export function loadPrivateKey({ env = process.env, name, file = null, fileEnv = `${name}_FILE` } = {}) {
  let key = env[name];
  if (!key && (env[fileEnv] || file)) {
    const path = env[fileEnv] ?? file;
    try { const text = readFileSync(path, 'utf8').trim(); key = text.startsWith('{') ? JSON.parse(text).privateKey : text; } catch (err) { throw new UserError(`${name}: could not read the key file ${path} (${err.code ?? err.message})`); }
  }
  if (!key) throw new UserError(`${name} is not set: put the private key in the ${name} environment variable, or in a file named by ${fileEnv}. It is never taken from code or from a prompt.`);
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) throw new UserError(`${name} does not look like a private key (64 hex characters)`);
  return key.startsWith('0x') ? key : `0x${key}`;
}

// ---- prices and requirements ------------------------------------------------------------------------------------------------------------------

export function priceToAmount(price, decimals) {
  const t = String(price).trim().replace(/^\$/, '');
  if (!/^\d+(\.\d+)?$/.test(t)) throw new UserError(`a price must be a decimal like 0.01, not "${price}"`);
  const [w, f = ''] = t.split('.');
  if (f.length > decimals) throw new UserError(`price ${t} has more decimals than the token (${decimals})`);
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0')).toString();
}

// config = { asset, name, version, decimals, payTo, maxTimeoutSeconds, network }. Routes: a price (or null for free).
export function parseConfig(c = {}) {
  if (!isAddress(c.asset)) throw new UserError('config.asset must be the token contract address');
  if (!isAddress(c.payTo)) throw new UserError('config.payTo must be the address that receives the payments');
  if (checksumStatus(c.payTo) === 'invalid' || checksumStatus(c.asset) === 'invalid') throw new UserError('config.asset or config.payTo has a wrong EIP-55 checksum');
  return { network: c.network ?? NETWORK, asset: c.asset.toLowerCase(), payTo: c.payTo.toLowerCase(), name: c.name ?? 'USDC', version: c.version ?? '2', decimals: c.decimals ?? 6, maxTimeoutSeconds: c.maxTimeoutSeconds ?? 300 };
}
export const ROUTES = [
  { method: 'GET', path: '/health', price: null, description: 'Free: is the server up' },
  { method: 'GET', path: '/api/info', price: '0.005', description: 'Low-cost info endpoint' },
  { method: 'GET', path: '/data', price: '0.01', description: 'Paid data endpoint' },
];
export function requirementsFor(config, route) {
  return { scheme: 'exact', network: config.network, amount: priceToAmount(route.price, config.decimals), asset: config.asset, payTo: config.payTo, maxTimeoutSeconds: config.maxTimeoutSeconds, extra: { name: config.name, version: config.version } };
}

// ---- EIP-712 ------------------------------------------------------------------------------------------------------------------------------------

const TYPEHASH = '0x' + keccak256(Buffer.from('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'));
const DOMAIN_TYPEHASH = '0x' + keccak256(Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
const h = (s) => Buffer.from(s.replace(/^0x/, ''), 'hex');
export function domainSeparator({ name, version, chainId, verifyingContract }) {
  return '0x' + keccak256(Buffer.concat([h(DOMAIN_TYPEHASH), h('0x' + keccak256(Buffer.from(name))), h('0x' + keccak256(Buffer.from(version))), h('0x' + word(chainId)), h('0x' + addrWord(verifyingContract))]));
}
export function authorizationDigest(domain, a) {
  const structHash = keccak256(Buffer.concat([h(TYPEHASH), h('0x' + addrWord(a.from)), h('0x' + addrWord(a.to)), h('0x' + word(a.value)), h('0x' + word(a.validAfter)), h('0x' + word(a.validBefore)), h(a.nonce)]));
  return '0x' + keccak256(Buffer.concat([Buffer.from([0x19, 0x01]), h(domainSeparator(domain)), h('0x' + structHash)]));
}
const domainOf = (req) => ({ name: req.extra?.name ?? 'USDC', version: req.extra?.version ?? '2', chainId: Number(String(req.network).split(':')[1]), verifyingContract: req.asset });

// ---- the client ---------------------------------------------------------------------------------------------------------------------------------

// Signs the payment for one requirement. The payer's key never leaves this function.
export function createPayment({ requirements, privateKey, resource = null, now = Math.floor(Date.now() / 1000), nonce = '0x' + randomBytes(32).toString('hex') }) {
  const from = addressFromPrivateKey(privateKey);
  const authorization = { from, to: requirements.payTo, value: String(requirements.amount), validAfter: String(now - 60), validBefore: String(now + (requirements.maxTimeoutSeconds ?? 300)), nonce };
  const s = sign(authorizationDigest(domainOf(requirements), authorization), privateKey);
  return { x402Version: X402_VERSION, ...(resource && { resource }), accepted: requirements, payload: { signature: s.signature, authorization } };
}

// GET a URL; if it answers 402, pay (up to `maxAmount` base units) and ask again.
export async function payAndFetch({ url, privateKey, maxAmount = null, fetchImpl = fetch, init = {}, now }) {
  const first = await fetchImpl(url, init);
  if (first.status !== 402) return { status: first.status, paid: false, body: await first.json().catch(() => null), headers: first.headers };
  const required = b64.dec(first.headers.get(HEADERS.required)) ?? (await first.json().catch(() => null));
  const accepts = required?.accepts?.filter((a) => a.scheme === 'exact' && a.network === NETWORK);
  if (!accepts?.length) throw new UserError('the server asks for a payment this client cannot make (it needs the exact scheme on eip155:688689)');
  const requirements = accepts[0];
  if (maxAmount != null && BigInt(requirements.amount) > BigInt(maxAmount)) throw new UserError(`the server asks for ${requirements.amount} base units, more than the ${maxAmount} this client was allowed to pay`);
  const payment = createPayment({ requirements, privateKey, resource: required.resource, now });
  const second = await fetchImpl(url, { ...init, headers: { ...(init.headers ?? {}), [HEADERS.signature]: b64.enc(payment) } });
  const body = await second.json().catch(() => null);
  const settlement = b64.dec(second.headers.get(HEADERS.response));
  return { status: second.status, paid: second.status === 200, body, settlement, requirements, payment, challenge: required, headers: second.headers };
}

// ---- the facilitator ----------------------------------------------------------------------------------------------------------------------------

export const INVALID = {
  version: 'invalid_x402_version', scheme: 'invalid_scheme', network: 'invalid_network', mismatch: 'invalid_payment_requirements',
  recipient: 'invalid_exact_evm_payload_recipient_mismatch', value: 'invalid_exact_evm_payload_authorization_value', validBefore: 'invalid_exact_evm_payload_authorization_valid_before',
  validAfter: 'invalid_exact_evm_payload_authorization_valid_after', signature: 'invalid_exact_evm_payload_signature', balance: 'invalid_exact_evm_insufficient_balance',
  nonce: 'invalid_exact_evm_nonce_already_used', simulation: 'invalid_transaction_state', malformed: 'invalid_payment_payload',
};

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
// rpc(method, params) → result. `key` is the facilitator's own key (only /settle needs it). `config` is the set of tokens it supports.
export function createFacilitator({ rpc, key = null, supportedAssets = [], now = () => Math.floor(Date.now() / 1000), pollMs = 700, receiptTimeoutMs = 45_000 }) {
  const address = key ? addressFromPrivateKey(key) : null;
  const supported = () => ({ kinds: [{ x402Version: X402_VERSION, scheme: 'exact', network: NETWORK }], extensions: [], signers: { 'eip155:*': address ? [address] : [] }, assets: supportedAssets, settles: Boolean(key) });

  async function verify(paymentPayload, requirements) {
    const bad = (invalidReason, invalidMessage, payer = paymentPayload?.payload?.authorization?.from ?? null) => ({ isValid: false, invalidReason, invalidMessage, payer });
    const a = paymentPayload?.payload?.authorization;
    const sigHex = paymentPayload?.payload?.signature;
    if (!paymentPayload || !requirements || !a || !sigHex) return bad(INVALID.malformed, 'the payment payload needs payload.authorization and payload.signature');
    if (paymentPayload.x402Version !== X402_VERSION) return bad(INVALID.version, `x402Version must be ${X402_VERSION}`);
    const accepted = paymentPayload.accepted ?? {};
    if (accepted.scheme !== 'exact' || requirements.scheme !== 'exact') return bad(INVALID.scheme, 'only the "exact" scheme is supported');
    if (requirements.network !== NETWORK || accepted.network !== NETWORK) return bad(INVALID.network, `only ${NETWORK} (Pharos Atlantic testnet) is supported`);
    for (const k of ['amount', 'asset', 'payTo']) if (String(accepted[k]).toLowerCase() !== String(requirements[k]).toLowerCase()) return bad(INVALID.mismatch, `the payment was made for a different ${k} than the one required`);
    if (!isAddress(a.from) || !isAddress(a.to) || !HEX32.test(a.nonce ?? '')) return bad(INVALID.malformed, 'authorization.from, .to and .nonce are not well-formed');
    if (!/^\d+$/.test(String(a.value)) || !/^\d+$/.test(String(a.validAfter)) || !/^\d+$/.test(String(a.validBefore))) return bad(INVALID.malformed, 'authorization.value, .validAfter and .validBefore must be whole numbers');
    if (a.to.toLowerCase() !== requirements.payTo.toLowerCase()) return bad(INVALID.recipient, `the payment goes to ${a.to}, not to ${requirements.payTo}`);
    if (BigInt(a.value) !== BigInt(requirements.amount)) return bad(INVALID.value, BigInt(a.value) < BigInt(requirements.amount) ? `underpaid: ${a.value} base units were signed but the price is ${requirements.amount}` : `overpaid: ${a.value} base units were signed but the price is ${requirements.amount}`);
    const t = now();
    if (BigInt(a.validBefore) < BigInt(t + VALID_BEFORE_BUFFER)) return bad(INVALID.validBefore, 'the authorization has expired (or expires in the next few seconds)');
    if (BigInt(a.validAfter) > BigInt(t)) return bad(INVALID.validAfter, 'the authorization is not valid yet');
    let sig;
    try { sig = parseSignature(sigHex); } catch (err) { return bad(INVALID.signature, err.message); }
    const signer = recoverAddress(authorizationDigest(domainOf(requirements), a), sig);
    if (!signer || signer.toLowerCase() !== a.from.toLowerCase()) return bad(INVALID.signature, 'the signature was not made by authorization.from for these exact terms');
    const token = requirements.asset;
    const [balance, used] = await Promise.all([
      rpc('eth_call', [{ to: token, data: sel.balanceOf + addrWord(a.from) }, 'latest']),
      rpc('eth_call', [{ to: token, data: sel.authorizationState + addrWord(a.from) + a.nonce.slice(2) }, 'latest']),
    ]);
    if (BigInt(balance) < BigInt(a.value)) return bad(INVALID.balance, `${a.from} holds ${BigInt(balance)} base units, less than the ${a.value} to pay`);
    if (BigInt(used) !== 0n) return bad(INVALID.nonce, 'this authorization (its nonce) was already used');
    try {
      await rpc('eth_call', [{ from: address ?? '0x0000000000000000000000000000000000000001', to: token, data: callData(a, sig) }, 'latest']);
    } catch (err) {
      return bad(INVALID.simulation, `the token contract would refuse it: ${err.message}`);
    }
    return { isValid: true, payer: a.from };
  }

  async function settle(paymentPayload, requirements) {
    const v = await verify(paymentPayload, requirements);
    if (!v.isValid) return { success: false, errorReason: v.invalidReason, errorMessage: v.invalidMessage, payer: v.payer, transaction: '', network: NETWORK };
    if (!key) return { success: false, errorReason: 'facilitator_cannot_settle', errorMessage: 'this facilitator holds no key, so it can verify payments but not submit them', payer: v.payer, transaction: '', network: NETWORK };
    const a = paymentPayload.payload.authorization;
    const sig = parseSignature(paymentPayload.payload.signature);
    const data = callData(a, sig);
    try {
      const [nonce, gasPrice, estimate] = await Promise.all([
        rpc('eth_getTransactionCount', [address, 'pending']),
        rpc('eth_gasPrice', []),
        rpc('eth_estimateGas', [{ from: address, to: requirements.asset, data }]),
      ]);
      const gasLimit = (BigInt(estimate) * 13n) / 10n;
      const fields = { nonce: BigInt(nonce), gasPrice: (BigInt(gasPrice) * 12n) / 10n, gasLimit, to: requirements.asset, value: 0n, data, chainId: CHAIN_ID };
      const { unsignedLegacyTx } = await import('./rlp.js');
      const signed = signedLegacyTx(fields, sign(unsignedLegacyTx(fields).signingHash, key));
      const hash = await rpc('eth_sendRawTransaction', [signed.raw]);
      const deadline = Date.now() + receiptTimeoutMs;
      let receipt = null;
      while (!receipt && Date.now() < deadline) { receipt = await rpc('eth_getTransactionReceipt', [hash]); if (!receipt) await new Promise((r) => setTimeout(r, pollMs)); }
      if (!receipt) return { success: false, errorReason: 'settlement_timeout', errorMessage: `no receipt for ${hash} yet: do not retry until you have looked at it on the explorer`, payer: v.payer, transaction: hash, network: NETWORK };
      if (receipt.status !== '0x1') return { success: false, errorReason: 'invalid_transaction_state', errorMessage: 'the settlement transaction was mined and reverted', payer: v.payer, transaction: hash, network: NETWORK };
      return { success: true, payer: v.payer, transaction: hash, network: NETWORK, blockNumber: Number(BigInt(receipt.blockNumber)), gasUsed: Number(BigInt(receipt.gasUsed)) };
    } catch (err) {
      return { success: false, errorReason: 'settlement_failed', errorMessage: err.message, payer: v.payer, transaction: '', network: NETWORK };
    }
  }
  return { address, supported, verify, settle };
}

function callData(a, sig) {
  return sel.transferWithAuthorization + addrWord(a.from) + addrWord(a.to) + word(a.value) + word(a.validAfter) + word(a.validBefore) + a.nonce.slice(2) + word(sig.recoveryId + 27) + word(sig.r) + word(sig.s);
}

// A facilitator that lives somewhere else, spoken to over HTTP exactly as the docs' resource server does: POST /verify and /settle with { paymentPayload, paymentRequirements }.
export function httpFacilitator(baseUrl, fetchImpl = fetch) {
  const post = async (path, body) => {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!json) throw new Error(`the facilitator answered HTTP ${res.status} without JSON`);
    return json;
  };
  return {
    verify: (paymentPayload, paymentRequirements) => post('/verify', { x402Version: X402_VERSION, paymentPayload, paymentRequirements }),
    settle: (paymentPayload, paymentRequirements) => post('/settle', { x402Version: X402_VERSION, paymentPayload, paymentRequirements }),
    supported: async () => (await fetchImpl(`${baseUrl.replace(/\/$/, '')}/supported`)).json(),
  };
}

// The facilitator's three routes as a plain request handler: used by the local server and by the hosted one.
export async function facilitatorHandler(facilitator, { method, path, body }) {
  if (method === 'GET' && path === '/supported') return { status: 200, body: facilitator.supported() };
  if (method === 'POST' && (path === '/verify' || path === '/settle')) {
    const { paymentPayload, paymentRequirements } = body ?? {};
    if (!paymentPayload || !paymentRequirements) return { status: 400, body: { error: 'the body needs paymentPayload and paymentRequirements' } };
    return { status: 200, body: await facilitator[path.slice(1)](paymentPayload, paymentRequirements) };
  }
  return { status: 404, body: { error: 'the facilitator serves GET /supported, POST /verify and POST /settle' } };
}

// ---- the resource server -----------------------------------------------------------------------------------------------------------------------

// handle({ method, path, headers, baseUrl }) → { status, headers, body }. `facilitator` is createFacilitator(...) or httpFacilitator(...).
export function createResourceServer({ config: rawConfig, facilitator, routes = ROUTES, handlers = {} }) {
  const config = parseConfig(rawConfig);
  const challenge = (route, baseUrl, error) => {
    const required = { x402Version: X402_VERSION, ...(error && { error }), resource: { url: `${baseUrl}${route.path}`, description: route.description, mimeType: 'application/json' }, accepts: [requirementsFor(config, route)] };
    return { status: 402, headers: { [HEADERS.required]: b64.enc(required), 'content-type': 'application/json' }, body: required };
  };
  return {
    config,
    async handle({ method = 'GET', path, headers = {}, baseUrl = '' }) {
      const route = routes.find((r) => r.method === method && r.path === path);
      if (!route) return { status: 404, headers: {}, body: { error: `no route ${method} ${path}`, routes: routes.map((r) => `${r.method} ${r.path}${r.price ? ` ($${r.price})` : ' (free)'}`) } };
      const handler = handlers[route.path] ?? (() => ({ ok: true }));
      if (route.price == null) return { status: 200, headers: { 'content-type': 'application/json' }, body: await handler() };
      const raw = headers[HEADERS.signature.toLowerCase()] ?? headers[HEADERS.signature];
      if (!raw) return challenge(route, baseUrl, `${HEADERS.signature} header is required`);
      const payment = b64.dec(raw);
      if (!payment) return challenge(route, baseUrl, `${HEADERS.signature} is not base64 JSON`);
      const requirements = requirementsFor(config, route);
      let verdict;
      try { verdict = await facilitator.verify(payment, requirements); } catch (err) { return { status: 502, headers: {}, body: { error: `the facilitator could not be reached: ${err.message}` } }; }
      if (!verdict.isValid) return { ...challenge(route, baseUrl, `${verdict.invalidReason}: ${verdict.invalidMessage ?? ''}`.trim()), verdict };
      let settlement;
      try { settlement = await facilitator.settle(payment, requirements); } catch (err) { return { status: 502, headers: {}, body: { error: `the facilitator could not settle: ${err.message}` } }; }
      if (!settlement.success && settlement.errorReason === 'facilitator_cannot_settle') return { status: 503, headers: { 'content-type': 'application/json' }, body: { error: `your payment is valid, but this deployment’s facilitator holds no key and cannot submit it, so nothing was charged and nothing is served. ${settlement.errorMessage}`, verified: true }, settlement };
      if (!settlement.success) return { ...challenge(route, baseUrl, `settlement failed: ${settlement.errorReason}: ${settlement.errorMessage ?? ''}`.trim()), settlement };
      return { status: 200, headers: { 'content-type': 'application/json', [HEADERS.response]: b64.enc(settlement), 'access-control-expose-headers': HEADERS.response }, body: await handler(), settlement };
    },
  };
}
