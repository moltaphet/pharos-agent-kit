// Direct JSON-RPC to the public Pharos RPC. Used only to cross-check what the MCP
// server told us, so a reviewer doesn't have to take the MCP layer on trust.

import { preview, record } from './trace.js';

export const PHAROS_RPC = 'https://rpc.pharos.xyz';

export async function rpcCall(method, params, { why, url = PHAROS_RPC, timeoutMs = 8000 } = {}) {
  const start = performance.now();
  let failure = null;
  let result;
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
    result = body.result;
    return result;
  } catch (err) {
    failure = err.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : err.message;
    throw err;
  } finally {
    record({
      kind: 'rpc',
      server: new URL(url).hostname,
      tool: method,
      why,
      args: params,
      ms: Math.round(performance.now() - start),
      ok: !failure,
      ...(failure ? { error: failure } : { result: preview(result ?? null) }),
      start,
    });
  }
}
