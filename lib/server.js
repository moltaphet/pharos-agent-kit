// Shared plumbing for the web API routes (api/*.js).

import { McpClient, McpError, PHAROS_CHAIN_MCP, PHAROS_DOCS_MCP } from './mcp.js';
import { UserError } from './snapshot.js';

// One client per warm server instance: MCP sessions live in the upstream server's
// memory, so reusing ours keeps the number of sessions (and requests) down.
const options = { retries: 1, timeoutMs: 15_000 };
const make = (url) => Object.assign(new McpClient(url, options), { onRetry: null });
let chain;
let docs;
export const chainClient = () => (chain ??= make(PHAROS_CHAIN_MCP));
export const docsClient = () => (docs ??= make(PHAROS_DOCS_MCP));

// Wraps a handler so it always answers JSON and maps failures to readable errors.
export function handle(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.status(200).json(await fn(req.query ?? {}));
    } catch (err) {
      const upstream = err instanceof McpError;
      const status = err instanceof UserError ? 400 : upstream ? 502 : 500;
      const busy = upstream && /\b(429|503)\b|capacity/i.test(err.message);
      res.status(status).json({ error: busy ? 'The Pharos MCP server is busy right now. Try again in a minute.' : err.message });
    }
  };
}

export const one = (v) => (Array.isArray(v) ? v[0] : v);

export function need(condition, message) {
  if (!condition) throw new UserError(message);
}
