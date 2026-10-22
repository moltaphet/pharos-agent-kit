// Historical reads can come back WRONG when several are in flight at once. We measured it:
// about 10% of parallel eth_calls that name different past blocks returned another block's
// value (4 of 40 on the public RPC, and the same bogus value showed up through Chain MCP), so
// the cause is the node, not the MCP layer. Reads at one pinned block, and sequential reads,
// were correct. So any series of historical reads goes one at a time, and a value is accepted
// only once two reads agree.

import { AsyncLocalStorage } from 'node:async_hooks';

export class UnstableReadError extends Error {}

// Set while a stableRead() is running, so the client wrapper (confirm.js) does not confirm those reads a second time.
export const insideStableRead = new AsyncLocalStorage();

// `read` is an async function returning a comparable value (use String/BigInt/number).
export async function stableRead(read, { attempts = 3, label = 'value' } = {}) {
  const seen = [];
  for (let i = 0; i < attempts; i++) {
    const v = await insideStableRead.run(true, read);
    seen.push(v);
    if (seen.filter((x) => x === v).length >= 2) return { value: v, reads: seen.length };
  }
  throw new UnstableReadError(`${label} gave ${attempts} different answers in a row (${seen.join(', ')}); the node is returning inconsistent historical state`);
}

// Same, for a block header: it must be the block we asked for.
export async function stableHeader(getHeader, block, opts = {}) {
  const { value } = await stableRead(async () => {
    const h = await getHeader(block);
    if (h.number !== block) return `wrong-block:${h.number}`; // an answer for another block is never accepted
    return `${h.number}:${h.timestamp}`;
  }, { label: `block ${block} header`, ...opts });
  if (value.startsWith('wrong-block:')) throw new UnstableReadError(`asked for block ${block} but the node keeps answering for block ${value.split(':')[1]}`);
  const [number, timestamp] = value.split(':').map(Number);
  return { number, timestamp };
}
