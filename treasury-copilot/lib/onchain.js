// Confirmed on-chain reads for the agents that report numbers (the Portfolio Assistant, the Yield Optimizer).
//
// A batch of reads goes to Chain MCP as ONE Multicall3 eth_call at a pinned block, then the very same call is repeated on the public RPC and the two
// raw answers are compared. They match: every figure in the batch is confirmed. They differ: Chain MCP is asked again and the two that agree win
// (a real Chain MCP backend once answered a block-pinned call with the wrong state); no agreement means no number at all. If the public RPC cannot
// answer, the batch stands but is marked unconfirmed, never silently trusted. Every row carries its provenance: contract, call, block, how it was read.

import { decodeAggregate3, encodeAggregate3 } from './multicall.js';
import { MULTICALL3 } from './protocols.js';
import { rpcCall } from './rpc.js';
import { UnstableReadError } from './stable.js';

export const publicRpc = (method, params) => rpcCall(method, params, { why: 'Independent check of a Chain MCP read' });
const same = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

// A call description: { id, target, data, label } (label is what the figure is called in a source line, e.g. "balanceOf(address)").
export function makeReader({ chain, rpc = publicRpc, tr, block, chunk = 40 }) {
  const c = tr.wrap(chain, 'chain-mcp');
  const r = tr.wrap({ callTool: async (_t, a) => ({ result: await rpc('eth_call', [a.transaction, '0x' + a.block.toString(16)]) }) }, 'public-rpc');
  const integrity = { batches: 0, confirmed: 0, resolved: 0, inconclusive: 0, reads: 0 };

  async function rawBatch(calls, why, atBlock) {
    const tx = { to: MULTICALL3, data: encodeAggregate3(calls.map(({ target, data }) => ({ target, data, allowFailure: true }))) };
    const first = (await c.callTool('eth_call', { transaction: tx, block: atBlock }, { why })).result;
    const firstStep = tr.last();
    integrity.batches++;
    let other = null;
    try {
      other = (await r.callTool('eth_call', { transaction: tx, block: atBlock }, { why: 'Independent check: the same batch on the public RPC' })).result;
    } catch {
      other = null;
    }
    if (other == null) { integrity.inconclusive++; return { result: first, step: firstStep, state: 'inconclusive' }; }
    if (same(first, other)) { integrity.confirmed++; return { result: first, step: firstStep, state: 'confirmed' }; }
    const again = (await c.callTool('eth_call', { transaction: tx, block: atBlock }, { why: 'The first answer differs from the public RPC: ask Chain MCP once more' })).result;
    const againStep = tr.last();
    if (same(again, other)) {
      integrity.resolved++;
      tr.agent('read-resolved', 'Chain MCP’s first answer differed from the public RPC; its second answer agrees with the RPC, so the first was a backend inconsistency and is discarded.', { uses: [firstStep, againStep] });
      return { result: again, step: againStep, state: 'resolved' };
    }
    if (same(again, first)) {
      const rpc2 = await r.callTool('eth_call', { transaction: tx, block: atBlock }, { why: 'Chain MCP repeated its answer: read the public RPC once more' }).then((x) => x.result).catch(() => null);
      if (same(rpc2, first)) {
        integrity.resolved++;
        tr.agent('read-resolved', 'The public RPC’s first answer was the odd one: its second answer agrees with Chain MCP.', { uses: [firstStep, tr.last()] });
        return { result: first, step: firstStep, state: 'resolved' };
      }
    }
    throw new UnstableReadError(`Chain MCP and the public RPC disagree about a batch of ${calls.length} reads at block ${atBlock.toLocaleString('en-US')} and re-reading did not settle it, so no figure from it is reported.`);
  }

  // Reads every call at `atBlock` (default: the reader's block). Returns rows aligned with `calls`:
  // { id, ok, data, source: { contract, call, block, tool, integrity, step } }. A call that reverts inside the batch is ok:false (it is not a failure of the read).
  async function batch(calls, why, atBlock = block) {
    const rows = [];
    for (let i = 0; i < calls.length; i += chunk) {
      const part = calls.slice(i, i + chunk);
      const { result, step, state } = await rawBatch(part, `${why} (${part.length} reads in one Multicall3 call)`, atBlock);
      const decoded = decodeAggregate3(result);
      if (decoded.length !== part.length) throw new UnstableReadError(`Multicall3 answered ${decoded.length} results for ${part.length} reads`);
      part.forEach((call, j) => {
        integrity.reads++;
        rows.push({ id: call.id, ok: decoded[j].success && decoded[j].data !== '0x', data: decoded[j].data, source: { contract: call.target, call: call.label, block: atBlock, tool: 'Chain MCP eth_call via Multicall3', integrity: state, step } });
      });
    }
    return rows;
  }
  return { batch, integrity };
}

// Decoders for the static values these agents read.
const w = (hex, i = 0) => hex.slice(2 + i * 64, 2 + i * 64 + 64);
export const asUint = (row) => (row?.ok && row.data.length >= 66 ? BigInt('0x' + w(row.data)) : null);
export const asInt = (row) => (row?.ok && row.data.length >= 66 ? BigInt.asIntN(256, BigInt('0x' + w(row.data))) : null);
export const asAddress = (row) => (row?.ok && row.data.length >= 66 ? '0x' + w(row.data).slice(24) : null);
export const asBool = (row) => (row?.ok && row.data.length >= 66 ? BigInt('0x' + w(row.data)) === 1n : null);
export const asString = (row) => {
  if (!row?.ok || row.data.length < 130) return null;
  const h = row.data.slice(2);
  const off = Number(BigInt('0x' + h.slice(0, 64))) * 2;
  const len = Number(BigInt('0x' + h.slice(off, off + 64)));
  const body = h.slice(off + 64, off + 64 + len * 2);
  return body.length === len * 2 && len < 512 ? Buffer.from(body, 'hex').toString('utf8') : null;
};
