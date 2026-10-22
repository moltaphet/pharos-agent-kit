// Multicall3 aggregate3: many eth_calls in one request. Hand-encoded so there is no ABI
// dependency. Shared by the scanners that read many contracts at once, and by the batch
// executor (which prepares the same call shape as a transaction).

import { MULTICALL3 } from './protocols.js';

const SELECTOR_AGGREGATE3 = '0x82ad56cb'; // aggregate3((address,bool,bytes)[])
const pad = (hex) => hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const strip = (h) => (h.startsWith('0x') ? h.slice(2) : h);

// calls: [{ target, data, allowFailure? }] -> calldata for aggregate3
export function encodeAggregate3(calls) {
  const tuples = calls.map(({ target, data, allowFailure = true }) => {
    const bytes = strip(data);
    const len = bytes.length / 2;
    return word(0).slice(0, 24) + strip(target).toLowerCase().padStart(40, '0') + word(allowFailure ? 1 : 0) + word(0x60) + word(len) + pad(bytes);
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
  const h = strip(hex);
  const at = (i) => BigInt('0x' + h.slice(i * 2, i * 2 + 64));
  const arrayStart = Number(at(0)); // offset of the array
  const n = Number(at(arrayStart));
  const base = arrayStart + 32; // start of the offsets table
  const out = [];
  for (let i = 0; i < n; i++) {
    const tupleAt = base + Number(at(base + i * 32));
    const success = at(tupleAt) === 1n;
    const bytesAt = tupleAt + Number(at(tupleAt + 32));
    const len = Number(at(bytesAt));
    out.push({ success, data: '0x' + h.slice((bytesAt + 32) * 2, (bytesAt + 32 + len) * 2) });
  }
  return out;
}

// One eth_call through Chain MCP. `calls` are split into chunks so a request stays small.
export async function multicall(chain, calls, { block, why = 'Batch several reads in one Multicall3 call', chunk = 60 } = {}) {
  const out = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const part = calls.slice(i, i + chunk);
    const args = { transaction: { to: MULTICALL3, data: encodeAggregate3(part) } };
    if (block != null) args.block = block;
    const { result } = await chain.callTool('eth_call', args, { why: `${why} (${part.length} calls)` });
    out.push(...decodeAggregate3(result));
  }
  return out;
}

const SELECTOR_AGGREGATE3_VALUE = '0x174dea71'; // aggregate3Value((address,bool,uint256,bytes)[])

// calls: [{ target, data?, value?, allowFailure? }]. The caller's single payment (msg.value)
// must equal the sum of the values; Multicall3 forwards each share to its target.
export function encodeAggregate3Value(calls) {
  const tuples = calls.map(({ target, data = '0x', value = 0n, allowFailure = false }) => {
    const bytes = strip(data);
    return word(0).slice(0, 24) + strip(target).toLowerCase().padStart(40, '0') + word(allowFailure ? 1 : 0) + word(value) + word(0x80) + word(bytes.length / 2) + pad(bytes);
  });
  const offsets = [];
  let cursor = calls.length * 32;
  for (const t of tuples) {
    offsets.push(word(cursor));
    cursor += t.length / 2;
  }
  return SELECTOR_AGGREGATE3_VALUE + word(0x20) + word(calls.length) + offsets.join('') + tuples.join('');
}
