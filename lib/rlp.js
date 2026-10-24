// RLP encoding and the unsigned legacy (EIP-155) transaction, with no dependency. Used to hand a wallet or a hardware signer the exact bytes to sign
// (lib/payments.js) and to sign and send the facilitator's settlement transaction (lib/x402.js).
import { keccak256 } from './keccak.js';

const hexToBytes = (hex) => {
  const h = hex.replace(/^0x/, '');
  if (h.length % 2) throw new Error(`odd-length hex: ${hex}`);
  return Buffer.from(h, 'hex');
};
const lengthPrefix = (len, offset) => {
  if (len < 56) return Buffer.from([offset + len]);
  const lenBytes = Buffer.from(len.toString(16).padStart(Math.ceil(len.toString(16).length / 2) * 2, '0'), 'hex');
  return Buffer.concat([Buffer.from([offset + 55 + lenBytes.length]), lenBytes]);
};

// item: a Buffer, a hex string ("0x…"), a non-negative bigint or number, or a (nested) array of those.
export function rlp(item) {
  if (Array.isArray(item)) {
    const body = Buffer.concat(item.map(rlp));
    return Buffer.concat([lengthPrefix(body.length, 0xc0), body]);
  }
  let bytes;
  if (Buffer.isBuffer(item)) bytes = item;
  else if (typeof item === 'bigint' || typeof item === 'number') {
    const n = BigInt(item);
    if (n < 0n) throw new Error('RLP cannot encode a negative number');
    bytes = n === 0n ? Buffer.alloc(0) : hexToBytes(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0'));
  } else if (typeof item === 'string') bytes = hexToBytes(item);
  else throw new Error(`RLP cannot encode ${typeof item}`);
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return Buffer.concat([lengthPrefix(bytes.length, 0x80), bytes]);
}

// The bytes a signer signs for a legacy transaction with replay protection: rlp([nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0]).
export function unsignedLegacyTx({ nonce, gasPrice, gasLimit, to, value = 0n, data = '0x', chainId }) {
  const raw = rlp([BigInt(nonce), BigInt(gasPrice), BigInt(gasLimit), to ?? '0x', BigInt(value), data, BigInt(chainId), 0n, 0n]);
  return { raw: '0x' + raw.toString('hex'), signingHash: '0x' + keccak256(raw) };
}

// The signed transaction ready for eth_sendRawTransaction: rlp([nonce, gasPrice, gasLimit, to, value, data, v, r, s]) with v = chainId * 2 + 35 + recoveryId.
export function signedLegacyTx({ nonce, gasPrice, gasLimit, to, value = 0n, data = '0x', chainId }, { r, s, recoveryId }) {
  const v = BigInt(chainId) * 2n + 35n + BigInt(recoveryId);
  const raw = rlp([BigInt(nonce), BigInt(gasPrice), BigInt(gasLimit), to ?? '0x', BigInt(value), data, v, r, s]);
  return { raw: '0x' + raw.toString('hex'), hash: '0x' + keccak256(raw) };
}
