// Shared plumbing for the web API routes (api/*.js).
//
// Every route answers { ok, data | error, trace }. `trace` lists each MCP/RPC call
// the request made (tool, arguments, raw response, timing), which is what the
// site's run log shows.

import { McpClient, McpError, PHAROS_CHAIN_MCP, PHAROS_DOCS_MCP } from './mcp.js';
import { UserError } from './snapshot.js';
import { confirmReads } from './confirm.js';
import { UnstableReadError } from './stable.js';
import { packTrace, startTrace, traceStore } from './trace.js';

// One client per warm server instance: MCP sessions live in the upstream server's
// memory, so reusing ours keeps the number of sessions (and requests) down.
// maxConcurrent: the Chain MCP allows 120 requests a minute per IP and answers a burst with 429 and a 27 s Retry-After.
const options = { retries: 1, timeoutMs: 15_000, maxConcurrent: 3 };
// The Docs server's askQuestion is an LLM call: 13-27 s in practice. Wait for it (50 s fits inside the
// 60 s function limit) and do not retry a timeout, which would restart the same slow call.
const docsOptions = { retries: 1, timeoutMs: 50_000, retryTimeouts: false, maxConcurrent: 2 };
const make = (url, label, opts = options) => Object.assign(new McpClient(url, { ...opts, label }), { onRetry: null });
let chain;
let docs;
export const chainClient = () => (chain ??= confirmReads(make(PHAROS_CHAIN_MCP, 'chain')));
export const docsClient = () => (docs ??= make(PHAROS_DOCS_MCP, 'docs', docsOptions));

// Wraps a handler so it always answers JSON, with a trace, and maps failures to readable errors.
export function handle(fn) {
  return (req, res) => {
    const store = startTrace();
    return traceStore.run(store, async () => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const data = await fn(req.query ?? {});
        res.status(200).json({ ok: true, data, trace: packTrace(store) });
      } catch (err) {
        const upstream = err instanceof McpError;
        const unstable = err instanceof UnstableReadError;
        const status = err instanceof UserError ? 400 : upstream || unstable ? 502 : 500;
        const busy = upstream && /\b(429|503)\b|capacity/i.test(err.message);
        const error = busy ? 'The Pharos MCP server is busy right now. Try again in a minute.' : err.message;
        res.status(status).json({ ok: false, error, detail: busy ? err.message : undefined, trace: packTrace(store) });
      }
    });
  };
}

export const one = (v) => (Array.isArray(v) ? v[0] : v);

export function need(condition, message) {
  if (!condition) throw new UserError(message);
}
