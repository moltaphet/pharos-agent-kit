// EIP-55 checksummed addresses. A mixed-case address carries a checksum that catches a mistyped character; an all-lower or all-upper one carries none.
import { keccak256 } from './keccak.js';

const HEX40 = /^0x[0-9a-fA-F]{40}$/;
export function toChecksumAddress(address) {
  if (!HEX40.test(address)) throw new Error(`not an address: ${address}`);
  const lower = address.slice(2).toLowerCase();
  const hash = keccak256(Buffer.from(lower, 'ascii'));
  return '0x' + [...lower].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}
// 'valid' (mixed case and the checksum matches), 'unchecked' (all lower or all upper: nothing to check), 'invalid' (mixed case, wrong checksum), 'malformed'.
export function checksumStatus(address) {
  if (!HEX40.test(address ?? '')) return 'malformed';
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return 'unchecked';
  return toChecksumAddress(address) === address ? 'valid' : 'invalid';
}
