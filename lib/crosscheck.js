// Replays each eth_call from a snapshot against the public RPC at the same block
// and compares the raw bytes, so the MCP layer's answers are independently checked.
//
// match         both returned the same bytes
// resolved      the first RPC answer differed, but a re-read of the RPC agreed with the MCP
//               server, so the first answer was the node's inconsistency, not a real difference
// mismatch      both returned data, and it differs even after re-reading the RPC
// inconclusive  the RPC couldn't answer (error, timeout, or an empty reply where
//               the MCP server had data, which is what a pruned old block looks like)

import { rpcCall } from './rpc.js';
import { decodeAggregate3, encodeAggregate3 } from './multicall.js';
import { MULTICALL3 } from './protocols.js';

const same = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

// The first answers from the public RPC. Batched: every replay in ONE Multicall3 request (the public RPC
// rejects bursts, and each request counts), falling back to one request per field if the batch fails.
async function firstAnswers(contract, evidence, blockHex, call, batch) {
  if (batch) {
    try {
      const out = await call('eth_call', [{ to: MULTICALL3, data: encodeAggregate3(evidence.map((e) => ({ target: contract, data: e.data }))) }, blockHex], { why: `Independent check: replay all ${evidence.length} calls in one Multicall3 request` });
      const rows = decodeAggregate3(out);
      if (rows.length === evidence.length) return rows.map((r) => ({ ok: true, raw: r.success && r.data !== '0x' ? r.data : null }));
    } catch {
      // fall through to one request per field
    }
  }
  return Promise.all(
    evidence.map(async (e) => {
      try {
        const out = await call('eth_call', [{ to: contract, data: e.data }, blockHex], { why: `Independent check of ${e.field}` });
        return { ok: true, raw: out && out !== '0x' ? out : null };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }),
  );
}

// `call` is injectable so the comparison logic can be tested without a network.
export async function crossCheck(contract, evidence, block, call = rpcCall, { batch = false } = {}) {
  const blockHex = '0x' + block.toString(16);
  const first = await firstAnswers(contract, evidence, blockHex, call, batch);
  const rows = await Promise.all(
    evidence.map(async (e, i) => {
      try {
        if (!first[i].ok) throw new Error(first[i].error);
        const rpcRaw = first[i].raw;
        if (same(rpcRaw, e.raw)) return { field: e.field, status: 'match', mcp: e.raw, rpc: rpcRaw };
        if (rpcRaw === null) return { field: e.field, status: 'inconclusive', mcp: e.raw, rpc: null, note: 'RPC returned empty (block may be pruned)' };
        // Differing answers: the node can contradict itself, so ask the RPC again (one after the other) before calling it a mismatch.
        for (let retry = 1; retry <= 2; retry++) {
          const again = await call('eth_call', [{ to: contract, data: e.data }, blockHex], { why: `Re-read ${e.field} (the first answer differed)` });
          if (same(again, e.raw)) return { field: e.field, status: 'resolved', mcp: e.raw, rpc: again, firstRpc: rpcRaw, note: `the RPC's first answer differed; read ${retry === 1 ? 'again' : 'a third time'} it agreed with Chain MCP` };
        }
        return { field: e.field, status: 'mismatch', mcp: e.raw, rpc: rpcRaw };
      } catch (err) {
        return { field: e.field, status: 'inconclusive', mcp: e.raw, rpc: null, note: err.message };
      }
    }),
  );
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { source: 'rpc.pharos.xyz', block, total: rows.length, match: count('match'), resolved: count('resolved'), mismatch: count('mismatch'), inconclusive: count('inconclusive'), rows };
}
