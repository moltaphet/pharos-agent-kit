import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { McpClient, McpError } from '../lib/mcp.js';

// A server that accepts the request and never answers, like an overloaded upstream.
async function hangingServer() {
  const server = http.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => server.closeAllConnections() || server.close() };
}

async function timeIt(opts) {
  const s = await hangingServer();
  const t0 = performance.now();
  try {
    await assert.rejects(new McpClient(s.url, { retries: 1, timeoutMs: 300, ...opts }).listTools(), (e) => e instanceof McpError && /Timed out/.test(e.message));
  } finally {
    s.close();
  }
  return performance.now() - t0;
}

test('a timed-out call is not retried when retryTimeouts is false (the Docs client)', async () => {
  const ms = await timeIt({ retryTimeouts: false });
  assert.ok(ms < 700, `took ${Math.round(ms)} ms: it should give up after one 300 ms attempt`);
});

test('by default a timeout is retried once (the Chain client keeps this)', async () => {
  const ms = await timeIt({});
  assert.ok(ms >= 1300, `took ${Math.round(ms)} ms: two 300 ms attempts plus a 1 s backoff`);
});
