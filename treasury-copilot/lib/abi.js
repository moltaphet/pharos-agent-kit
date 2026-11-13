// Just enough ABI handling for ERC-20-style contracts. Selectors and event
// topics are the well-known keccak hashes, so no hashing dependency is needed.

export const SELECTORS = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  owner: '0x8da5cb5b',
  balanceOf: '0x70a08231',
};

// topic0 of the events the watcher understands.
export const EVENTS = {
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  Approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  Deposit: '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c',
  Withdrawal: '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65',
};

const strip = (hex) => typeof hex === 'string' ? (hex.startsWith('0x') ? hex.slice(2) : hex) : '';
const validHex = (hex) => hex.length % 2 === 0 && /^[0-9a-f]*$/i.test(hex);

export const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s ?? '');
export const isHash32 = (s) => /^0x[0-9a-fA-F]{64}$/.test(s ?? '');

export function encodeAddress(address) {
  return strip(address).toLowerCase().padStart(64, '0');
}

export function decodeUint(hex, wordIndex = 0) {
  const h = strip(hex);
  if (!validHex(h) || !Number.isSafeInteger(wordIndex) || wordIndex < 0) return null;
  const word = h.slice(wordIndex * 64, wordIndex * 64 + 64);
  return word.length === 64 ? BigInt('0x' + word) : null;
}

export function decodeAddress(hex) {
  const h = strip(hex);
  return validHex(h) && h.length >= 64 && /^0{24}/.test(h) ? '0x' + h.slice(24, 64) : null;
}

// Handles the standard dynamic `string` encoding and the legacy `bytes32`
// name/symbol some older tokens still return.
export function decodeString(hex) {
  const h = strip(hex);
  if (!h || !validHex(h)) return null;
  if (h.length >= 128) {
    const offsetBytes = BigInt('0x' + h.slice(0, 64));
    // Bounds-check as bigint before converting: adversarial words can exceed safe integers.
    if (offsetBytes < 32n || offsetBytes % 32n !== 0n || offsetBytes > BigInt(h.length / 2 - 32)) return null;
    const offset = Number(offsetBytes) * 2;
    const lengthBytes = BigInt('0x' + h.slice(offset, offset + 64));
    if (lengthBytes >= 4096n || lengthBytes > BigInt((h.length - offset - 64) / 2)) return null;
    const len = Number(lengthBytes);
    if (offset + 64 + Math.ceil(len / 32) * 64 > h.length) return null;
    const body = h.slice(offset + 64, offset + 64 + len * 2);
    if (body.length === len * 2 && len < 4096) return Buffer.from(body, 'hex').toString('utf8');
  }
  if (h.length === 64) return Buffer.from(h, 'hex').toString('utf8').replace(/\0+$/, '');
  return null;
}

// A 32-byte indexed topic holding an address.
export const topicToAddress = (topic) => '0x' + strip(topic).slice(24);

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function formatUnits(value, decimals, maxFraction = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, '0');
  const kept = frac.slice(0, maxFraction).replace(/0+$/, '');
  if (whole === 0n && value !== 0n && !kept) return `<0.${'0'.repeat(maxFraction - 1)}1`;
  return group(whole.toString()) + (kept ? '.' + kept : '');
}

export const formatInt = (n) => group(String(n));
