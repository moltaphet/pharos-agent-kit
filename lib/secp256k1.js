// secp256k1 for Ethereum accounts, with no dependency: sign a 32-byte hash (RFC 6979 deterministic nonce, low-s, with the recovery id), recover the signer from a
// signature, and derive an address from a private key. Used by the x402 facilitator to sign its settlement transactions and by the tests and proofs that sign with a
// throwaway key. It is not constant-time: it is meant for throwaway test keys and for checking signatures, not for guarding a valuable key.
import { createHmac } from 'node:crypto';
import { keccak256 } from './keccak.js';

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) {
  let [lm, hm, low, high] = [1n, 0n, mod(a, m), m];
  while (low > 1n) { const r = high / low; [lm, hm, low, high] = [hm - lm * r, lm, high - low * r, low]; }
  return mod(lm, m);
}
// Jacobian coordinates: (X, Y, Z) is the point (X/Z², Y/Z³); Z = 0 is the point at infinity.
const INF = [0n, 1n, 0n];
function double([X, Y, Z]) {
  if (Y === 0n || Z === 0n) return INF;
  const S = mod(4n * X * Y * Y);
  const M = mod(3n * X * X);
  const X2 = mod(M * M - 2n * S);
  return [X2, mod(M * (S - X2) - 8n * Y ** 4n), mod(2n * Y * Z)];
}
function add(p, q) {
  if (p[2] === 0n) return q;
  if (q[2] === 0n) return p;
  const [X1, Y1, Z1] = p;
  const [X2, Y2, Z2] = q;
  const U1 = mod(X1 * Z2 * Z2);
  const U2 = mod(X2 * Z1 * Z1);
  const S1 = mod(Y1 * Z2 ** 3n);
  const S2 = mod(Y2 * Z1 ** 3n);
  if (U1 === U2) return S1 === S2 ? double(p) : INF;
  const H = mod(U2 - U1);
  const R = mod(S2 - S1);
  const H2 = mod(H * H);
  const H3 = mod(H * H2);
  const X3 = mod(R * R - H3 - 2n * U1 * H2);
  return [X3, mod(R * (U1 * H2 - X3) - S1 * H3), mod(H * Z1 * Z2)];
}
function mul(point, k) {
  let result = INF;
  let addend = point;
  for (let n = k; n > 0n; n >>= 1n) { if (n & 1n) result = add(result, addend); addend = double(addend); }
  return result;
}
function toAffine([X, Y, Z]) {
  if (Z === 0n) throw new Error('point at infinity');
  const zi = inv(Z);
  return [mod(X * zi * zi), mod(Y * zi ** 3n)];
}
const G = [GX, GY, 1n];

const bytes32 = (n) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const toBig = (b) => BigInt('0x' + Buffer.from(b).toString('hex'));
const hex = (b) => (typeof b === 'string' ? b.replace(/^0x/, '') : Buffer.from(b).toString('hex'));
const hmac = (key, ...parts) => createHmac('sha256', key).update(Buffer.concat(parts)).digest();

export function publicKey(privateKey) {
  const d = toBig(Buffer.from(hex(privateKey), 'hex'));
  if (d <= 0n || d >= N) throw new Error('not a valid private key');
  const [x, y] = toAffine(mul(G, d));
  return Buffer.concat([bytes32(x), bytes32(y)]); // 64 bytes, no prefix
}
export const addressOf = (publicKeyBytes) => '0x' + keccak256(publicKeyBytes).slice(-40);
export const addressFromPrivateKey = (privateKey) => addressOf(publicKey(privateKey));

// RFC 6979 nonce for a 32-byte hash.
function nonce(d, h) {
  const x = bytes32(d);
  const z = bytes32(mod(toBig(h), N));
  let v = Buffer.alloc(32, 1);
  let k = Buffer.alloc(32, 0);
  k = hmac(k, v, Buffer.from([0]), x, z);
  v = hmac(k, v);
  k = hmac(k, v, Buffer.from([1]), x, z);
  v = hmac(k, v);
  for (;;) {
    v = hmac(k, v);
    const cand = toBig(v);
    if (cand >= 1n && cand < N) return cand;
    k = hmac(k, v, Buffer.from([0]));
    v = hmac(k, v);
  }
}

// → { r, s, recoveryId, v (27 or 28), signature: '0x' + r + s + v }
export function sign(hash, privateKey) {
  const h = Buffer.from(hex(hash), 'hex');
  if (h.length !== 32) throw new Error('sign needs a 32-byte hash');
  const d = toBig(Buffer.from(hex(privateKey), 'hex'));
  if (d <= 0n || d >= N) throw new Error('not a valid private key');
  const k = nonce(d, h);
  const [rx, ry] = toAffine(mul(G, k));
  const r = mod(rx, N);
  let s = mod(inv(k, N) * (toBig(h) + r * d), N);
  let recoveryId = (ry & 1n ? 1 : 0) | (rx >= N ? 2 : 0);
  if (s > N / 2n) { s = N - s; recoveryId ^= 1; } // low-s, as Ethereum requires
  if (r === 0n || s === 0n) throw new Error('bad nonce');
  return { r, s, recoveryId, v: 27 + recoveryId, signature: '0x' + bytes32(r).toString('hex') + bytes32(s).toString('hex') + (27 + recoveryId).toString(16) };
}

// The 64-byte public key that signed `hash`, or null when the signature is not valid.
export function recover(hash, { r, s, recoveryId }) {
  const h = toBig(Buffer.from(hex(hash), 'hex'));
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const x = r + (recoveryId & 2 ? N : 0n);
  if (x >= P) return null;
  const y2 = mod(x ** 3n + 7n);
  let y = (() => { let res = 1n; let b = y2; let e = (P + 1n) / 4n; while (e > 0n) { if (e & 1n) res = mod(res * b); b = mod(b * b); e >>= 1n; } return res; })();
  if (mod(y * y) !== y2) return null;
  if ((y & 1n) !== BigInt(recoveryId & 1)) y = P - y;
  const rinv = inv(r, N);
  const u1 = mod(-h * rinv, N);
  const u2 = mod(s * rinv, N);
  const point = add(mul(G, u1), mul([x, y, 1n], u2));
  if (point[2] === 0n) return null;
  const [qx, qy] = toAffine(point);
  return Buffer.concat([bytes32(qx), bytes32(qy)]);
}
export const recoverAddress = (hash, sig) => { const pub = recover(hash, sig); return pub ? addressOf(pub) : null; };
export function parseSignature(sigHex) {
  const h = hex(sigHex);
  if (h.length !== 130) throw new Error('a signature is 65 bytes (r, s, v)');
  let v = parseInt(h.slice(128), 16);
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error('v must be 27 or 28 (or 0 or 1)');
  return { r: BigInt('0x' + h.slice(0, 64)), s: BigInt('0x' + h.slice(64, 128)), recoveryId: v };
}
