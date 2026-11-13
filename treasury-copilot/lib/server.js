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
import { RpcError } from './rpc.js';

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

// A request that waits on slow or rate-limiting upstream servers must still answer, with a readable error, before
// the platform's 60 s function limit kills it silently.
export class DeadlineError extends Error {}
const withDeadline = (promise, ms) => {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(`This took longer than ${Math.round(ms / 1000)} seconds. The Pharos servers are most likely rate-limiting or slow right now, so try again in a minute.`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};

// Wraps a handler so it always answers JSON, with a trace, and maps failures to readable errors.
export function handle(fn, { deadlineMs = 55_000 } = {}) {
  return (req, res) => {
    const store = startTrace();
    return traceStore.run(store, async () => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const data = await withDeadline(Promise.resolve().then(() => fn(req.query ?? {}, req)), deadlineMs);
        res.status(200).json({ ok: true, data, trace: packTrace(store) });
      } catch (err) {
        const upstream = err instanceof McpError || err instanceof RpcError;
        const unstable = err instanceof UnstableReadError;
        const message = typeof err?.message === 'string' ? err.message : typeof err === 'string' ? err : 'Unexpected server error';
        const status = Number.isInteger(err?.httpStatus) && err.httpStatus >= 400 && err.httpStatus <= 599 ? err.httpStatus : err instanceof UserError ? 400 : err instanceof DeadlineError ? 504 : upstream || unstable ? 502 : 500;
        const busy = upstream && /\b(429|503)\b|capacity/i.test(message);
        const error = busy ? 'The Pharos MCP server is busy right now. Try again in a minute.' : message;
        res.status(status).json({ ok: false, error, detail: busy ? message : undefined, trace: packTrace(store) });
      }
    });
  };
}

export const one = (v) => (Array.isArray(v) ? v[0] : v);

export function need(condition, message) {
  if (!condition) throw new UserError(message);
}
