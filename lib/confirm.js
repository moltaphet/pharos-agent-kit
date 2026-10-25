// Wraps a Chain MCP client so every read of past state is confirmed before it is trusted.
//
// The node behind the Pharos RPC sometimes answers a historical read with another block's
// value (see stable.js). A single read therefore cannot be trusted on its own. For any
// deterministic read (a call, balance, code, header or gas estimate pinned to a block number)
// we read twice, one after the other. Two equal answers are accepted. If they differ we read a
// third time and take the majority. With no majority we refuse to answer, because an honest
// "the node is inconsistent right now" is better than a confident wrong number.
//
// Reads of "latest" are not confirmed: they legitimately change between two calls.
// Reads that already run inside stableRead() are not confirmed twice.

import { record } from './trace.js';
import { UnstableReadError, insideStableRead } from './stable.js';

const CONFIRMED_TOOLS = new Set(['eth_call', 'get_balance', 'get_code', 'get_block', 'estimate_gas']);

export const isConfirmable = (name, args) => CONFIRMED_TOOLS.has(name) && Number.isInteger(args?.block) && !insideStableRead.getStore();

const keyOf = (sample) => JSON.stringify(sample.error ? ['error', sample.error.message] : ['value', sample.value], (_key, value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return value;
});
const label = (meta, suffix) => ({ ...meta, why: `${meta.why ?? 'Read'} (${suffix})` });

// Reads the same thing again. A tool error on a later read counts as a different answer.
const again = async (client, name, args, meta) => {
  try {
    return { value: await client.callTool(name, args, meta) };
  } catch (err) {
    if (err?.tool) return { error: err };
    throw err;
  }
};

export async function confirmedCall(client, name, args = {}, meta = {}) {
  if (!isConfirmable(name, args)) return client.callTool(name, args, meta);
  const first = { value: await client.callTool(name, args, meta) }; // a tool error on the initial read propagates
  const second = await again(client, name, args, label(meta, 'confirming read'));
  if (keyOf(first) === keyOf(second)) return first.value;

  const third = await again(client, name, args, label(meta, 'tie-break read'));
  const samples = [first, second, third];
  const votes = new Map();
  for (const s of samples) votes.set(keyOf(s), (votes.get(keyOf(s)) ?? 0) + 1);
  const [winnerKey, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const where = `${name} at block ${args.block.toLocaleString('en-US')}`;
  if (count < 2) {
    record({ kind: 'decision', ok: false, title: `Node inconsistent: ${where}`, detail: 'Three reads of the same block gave three different answers, so no value is trusted.' });
    throw new UnstableReadError(`${where} gave three different answers in a row; the node is returning inconsistent historical state, so no value is shown`);
  }
  record({
    kind: 'decision',
    ok: !samples.find((s) => keyOf(s) === winnerKey).error,
    title: `Node disagreed with itself, majority used: ${where}`,
    detail: `Reads 1, 2 and 3 of the same call gave ${[...votes.values()].sort().reverse().join(' / ')} matching answers. The answer ${count} of 3 reads agreed on is the one returned; the other was discarded.`,
  });
  const winner = samples.find((s) => keyOf(s) === winnerKey);
  if (winner.error) throw winner.error;
  return winner.value;
}

// Returns a client whose callTool confirms reads; everything else is the original client's.
export function confirmReads(client) {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'callTool') return (name, args, meta) => confirmedCall(target, name, args, meta);
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
