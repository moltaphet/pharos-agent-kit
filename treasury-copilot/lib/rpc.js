// Direct JSON-RPC to the public Pharos RPC. Used only to cross-check what the MCP
// server told us, so a reviewer doesn't have to take the MCP layer on trust.

import { limiter } from './limit.js';
import { preview, record } from './trace.js';

export const PHAROS_RPC = 'https://rpc.pharos.xyz';

export class RpcError extends Error {
  constructor(message, { status, rpc } = {}) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
    this.rpc = rpc;
  }
}

// The public RPC rejects bursts ("cu limit exceeded; Request too fast per second"), so keep a few
// calls in flight at most and retry that specific answer after a short pause.
const slot = limiter(2);
const RATE_LIMITED = /cu limit|too fast|rate limit|too many requests|\b429\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const rpcCall = (method, params, opts = {}) => slot(() => rpcCallOnce(method, params, opts));

async function rpcCallOnce(method, params, { why, url = PHAROS_RPC, timeoutMs = 8000, retries = 2 } = {}) {
  const start = performance.now();
  let failure = null;
  let result;
  try {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
      } catch (err) {
        // a dropped connection (the socket reset before TLS finished, DNS hiccup): the request never reached the node, so asking again is safe
        if (err instanceof TypeError && /fetch failed/.test(err.message) && attempt < retries) { await sleep(600 * 2 ** attempt); continue; }
        throw err;
      }
      const body = await res.json().catch(() => null);
      const valid = body !== null && typeof body === 'object' && !Array.isArray(body);
      const httpError = res.status < 200 || res.status >= 300;
      const message = httpError ? `HTTP ${res.status}${valid && body.error?.message ? `: ${body.error.message}` : ''}`
        : valid && body.error != null ? (body.error.message || JSON.stringify(body.error) || 'JSON-RPC error')
        : !valid || !Object.hasOwn(body, 'result') ? 'Invalid JSON-RPC response: missing result'
        : null;
      if (message && RATE_LIMITED.test(message) && attempt < retries) {
        await sleep(1200 * 2 ** attempt);
        continue;
      }
      if (message) throw new RpcError(message, { status: res.status, rpc: body?.error ?? null }); // keeps code and revert data
      result = body.result;
      return result;
    }
  } catch (err) {
    failure = err.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : err.message;
    if (err instanceof RpcError) throw err;
    throw Object.assign(new RpcError(failure), { cause: err });
  } finally {
    record({
      kind: 'rpc',
      server: (() => { try { return new URL(url).hostname; } catch { return String(url); } })(),
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
