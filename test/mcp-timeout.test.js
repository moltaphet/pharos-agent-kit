import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { McpClient, McpError } from '../lib/mcp.js';

// A server that accepts the request and never answers, like an overloaded upstream. It counts the requests it receives.
async function hangingServer() {
  let requests = 0;
  const server = http.createServer(() => { requests++; });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, requests: () => requests, close: () => server.closeAllConnections() || server.close() };
}

async function attempt(opts) {
  const s = await hangingServer();
  try {
    await assert.rejects(new McpClient(s.url, { retries: 1, timeoutMs: 300, ...opts }).listTools(), (e) => e instanceof McpError && /Timed out/.test(e.message));
    return s.requests();
  } finally {
    s.close();
  }
}

// Counting requests instead of measuring time: the count does not depend on how busy the machine is.
test('a timed-out call is not retried when retryTimeouts is false (the Docs client): one request reaches the server', async () => {
  assert.equal(await attempt({ retryTimeouts: false }), 1);
});

test('by default a timeout is retried once (the Chain client keeps this): two requests reach the server', async () => {
  assert.equal(await attempt({}), 2);
});
