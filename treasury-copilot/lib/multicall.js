// Multicall3 aggregate3: many eth_calls in one request. Hand-encoded so there is no ABI
// dependency. Shared by the scanners that read many contracts at once, and by the batch
// executor (which prepares the same call shape as a transaction).

import { MULTICALL3 } from './protocols.js';

const SELECTOR_AGGREGATE3 = '0x82ad56cb'; // aggregate3((address,bool,bytes)[])
const pad = (hex) => hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
const word = (n) => {
  if (typeof n === 'number' && !Number.isSafeInteger(n)) throw new Error('multicall integer must be exact');
  let value;
  try { value = BigInt(n); } catch { throw new Error('multicall integer is invalid'); }
  if (value < 0n || value >= 1n << 256n) throw new Error('multicall integer exceeds uint256');
  return value.toString(16).padStart(64, '0');
};
const strip = (h) => {
  if (typeof h !== 'string' || !/^(?:0x)?(?:[0-9a-fA-F]{2})*$/.test(h)) throw new Error('multicall bytes must contain whole hex bytes');
  return h.startsWith('0x') ? h.slice(2) : h;
};
const addressWord = (target) => {
  if (typeof target !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(target)) throw new Error('multicall target must be a 20-byte address');
  return '0'.repeat(24) + target.slice(2).toLowerCase();
};
const boolWord = (value) => {
  if (typeof value !== 'boolean') throw new Error('multicall flag must be boolean');
  return word(value ? 1 : 0);
};

// Validate every word and offset before converting to Number or walking the array.
// Counts are bounded by the actual bytes supplied, never by an untrusted uint256.
function reader(hex) {
  const h = strip(hex);
  const size = h.length / 2;
  const fail = () => { throw new Error('malformed multicall ABI response'); };
  const fits = (offset, length) => Number.isSafeInteger(offset) && offset >= 0 && length >= 0 && offset <= size - length;
  const at = (offset) => {
    if (!fits(offset, 32)) fail();
    return BigInt('0x' + h.slice(offset * 2, offset * 2 + 64));
  };
  const bounded = (value) => { if (value > BigInt(size)) fail(); return Number(value); };
  const offsetAt = (offset, minimum) => {
    const value = bounded(at(offset));
    if (value < minimum || value % 32) fail();
    return value;
  };
  const flag = (offset) => { const n = at(offset); if (n > 1n) fail(); return n === 1n; };
  const bytes = (tuple, field, head) => {
    const start = tuple + offsetAt(tuple + field, head);
    const length = bounded(at(start));
    if (!fits(start + 32, Math.ceil(length / 32) * 32)) fail();
    return '0x' + h.slice((start + 32) * 2, (start + 32 + length) * 2);
  };
  const arrayStart = offsetAt(0, 32);
  const count = bounded(at(arrayStart));
  const base = arrayStart + 32;
  if (!fits(base, count * 32)) fail();
  const tuple = (i) => base + offsetAt(base + i * 32, count * 32);
  return { h, at, flag, bytes, count, tuple, fail };
}

// calls: [{ target, data, allowFailure? }] -> calldata for aggregate3
export function encodeAggregate3(calls) {
  const tuples = calls.map(({ target, data, allowFailure = true }) => {
    const bytes = strip(data);
    const len = bytes.length / 2;
    return addressWord(target) + boolWord(allowFailure) + word(0x60) + word(len) + pad(bytes);
  });
  // offsets of each tuple are relative to the start of the array contents (after the length word)
  const offsets = [];
  let cursor = calls.length * 32;
  for (const t of tuples) {
    offsets.push(word(cursor));
    cursor += t.length / 2;
  }
  return SELECTOR_AGGREGATE3 + word(0x20) + word(calls.length) + offsets.join('') + tuples.join('');
}

// returns [{ success, data }] from the aggregate3 return value
export function decodeAggregate3(hex) {
  const r = reader(hex);
  return Array.from({ length: r.count }, (_, i) => {
    const tuple = r.tuple(i);
    return { success: r.flag(tuple), data: r.bytes(tuple, 32, 64) };
  });
}

// One eth_call through Chain MCP. `calls` are split into chunks so a request stays small.
export async function multicall(chain, calls, { block, why = 'Batch several reads in one Multicall3 call', chunk = 60 } = {}) {
  if (!Number.isSafeInteger(chunk) || chunk < 1) throw new Error('multicall chunk must be a positive whole number');
  const out = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const part = calls.slice(i, i + chunk);
    const args = { transaction: { to: MULTICALL3, data: encodeAggregate3(part) } };
    if (block != null) args.block = block;
    const { result } = await chain.callTool('eth_call', args, { why: `${why} (${part.length} calls)` });
    const rows = decodeAggregate3(result);
    if (rows.length !== part.length) throw new Error(`multicall result count ${rows.length} does not match ${part.length} calls`);
    out.push(...rows);
  }
  return out;
}

const SELECTOR_AGGREGATE3_VALUE = '0x174dea71'; // aggregate3Value((address,bool,uint256,bytes)[])

// calls: [{ target, data?, value?, allowFailure? }]. The caller's single payment (msg.value)
// must equal the sum of the values; Multicall3 forwards each share to its target.
export function encodeAggregate3Value(calls) {
  const tuples = calls.map(({ target, data = '0x', value = 0n, allowFailure = false }) => {
    const bytes = strip(data);
    return addressWord(target) + boolWord(allowFailure) + word(value) + word(0x80) + word(bytes.length / 2) + pad(bytes);
  });
  const offsets = [];
  let cursor = calls.length * 32;
  for (const t of tuples) {
    offsets.push(word(cursor));
    cursor += t.length / 2;
  }
  return SELECTOR_AGGREGATE3_VALUE + word(0x20) + word(calls.length) + offsets.join('') + tuples.join('');
}

// ---- the inverse directions, so a test (or a fake node) can read a request and answer it ----------------------------------------------------------

// calldata of aggregate3 -> [{ target, allowFailure, data }]
export function decodeAggregate3Input(calldata) {
  if (typeof calldata !== 'string' || calldata.slice(0, 10).toLowerCase() !== SELECTOR_AGGREGATE3) throw new Error('invalid multicall aggregate3 selector');
  const r = reader('0x' + strip(calldata).slice(8));
  return Array.from({ length: r.count }, (_, i) => {
    const tuple = r.tuple(i);
    const target = r.at(tuple);
    if (target >= 1n << 160n) r.fail();
    return { target: '0x' + target.toString(16).padStart(40, '0'), allowFailure: r.flag(tuple + 32), data: r.bytes(tuple, 64, 96) };
  });
}

// [{ success, data }] -> the return value of aggregate3 (what decodeAggregate3 reads)
export function encodeAggregate3Output(rows) {
  const tuples = rows.map(({ success, data }) => {
    const bytes = strip(data ?? '0x');
    return boolWord(success) + word(0x40) + word(bytes.length / 2) + pad(bytes);
  });
  const offsets = [];
  let cursor = rows.length * 32;
  for (const t of tuples) {
    offsets.push(word(cursor));
    cursor += t.length / 2;
  }
  return '0x' + word(0x20) + word(rows.length) + offsets.join('') + tuples.join('');
}
