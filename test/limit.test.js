import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { limiter } from '../lib/limit.js';
import { McpClient } from '../lib/mcp.js';
import { rpcCall } from '../lib/rpc.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('limiter never runs more than max jobs at once and finishes them all', async () => {
  const run = limiter(3);
  let active = 0;
  let peak = 0;
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      run(async () => {
        peak = Math.max(peak, ++active);
        await sleep(10);
        active--;
        return i;
      }),
    ),
  );
  assert.equal(peak, 3);
  assert.deepEqual(results, Array.from({ length: 12 }, (_, i) => i));
});

test('limiter: a failing job rejects its own caller and frees its slot', async () => {
  const run = limiter(1);
  await assert.rejects(run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await run(async () => 'next'), 'next');
});

test('limiter keeps each job in the async context of whoever queued it (per-request traces)', async () => {
  const als = new AsyncLocalStorage();
  const run = limiter(1);
  const seen = [];
  await Promise.all(['A', 'B', 'C'].map((id) => als.run(id, () => run(async () => { await sleep(5); seen.push([id, als.getStore()]); }))));
  assert.deepEqual(seen, [['A', 'A'], ['B', 'B'], ['C', 'C']]); // B and C start from A's callback, yet still see their own context
});

// ---- McpClient.maxConcurrent against a local MCP server --------------------------------------
async function mcpServer() {
  let inFlight = 0;
  const stats = { peak: 0, calls: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const m = JSON.parse(body);
      const reply = (result) => { res.setHeader('content-type', 'application/json'); res.setHeader('mcp-session-id', 's1'); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result })); };
      if (m.method === 'initialize') return reply({ serverInfo: { name: 'test' }, protocolVersion: '2025-03-26' });
      if (m.id === undefined) { res.statusCode = 202; return res.end(); }
      stats.calls++;
      stats.peak = Math.max(stats.peak, ++inFlight);
      await sleep(40);
      inFlight--;
      reply({ content: [{ type: 'text', text: '"ok"' }] });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, stats, close: () => server.closeAllConnections() || server.close() };
}

test('McpClient with maxConcurrent 2 never has more than 2 tool calls in flight', async () => {
  const s = await mcpServer();
  try {
    const c = new McpClient(s.url, { maxConcurrent: 2, retries: 0 });
    await Promise.all(Array.from({ length: 8 }, () => c.callTool('t', {})));
    assert.equal(s.stats.calls, 8);
    assert.equal(s.stats.peak, 2);
  } finally { s.close(); }
});

test('McpClient without a limit still allows parallel calls', async () => {
  const s = await mcpServer();
  try {
    const c = new McpClient(s.url, { retries: 0 });
    await Promise.all(Array.from({ length: 6 }, () => c.callTool('t', {})));
    assert.ok(s.stats.peak > 2);
  } finally { s.close(); }
});

// ---- public RPC pacing and retry ----------------------------------------------------------------
test('rpcCall retries the public RPC’s "too fast" answer and then succeeds', async () => {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => ({ status: 200, json: async () => (++n < 3 ? { error: { message: 'cu limit exceeded; Request too fast per second' } } : { result: '0x1' }) });
  try {
    assert.equal(await rpcCall('eth_blockNumber', [], { url: 'http://rpc.test' }), '0x1');
    assert.equal(n, 3);
  } finally { globalThis.fetch = real; }
});

test('rpcCall gives up after its retries and does not retry real errors at all', async () => {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => ({ status: 200, json: async () => { n++; return { error: { message: 'execution reverted' } }; } });
  try {
    await assert.rejects(rpcCall('eth_call', [], { url: 'http://rpc.test' }), /execution reverted/);
    assert.equal(n, 1);
  } finally { globalThis.fetch = real; }
});

// ---- "block is not available" is retried ------------------------------------------------------------
async function flakyBlockServer(failures) {
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = JSON.parse(body);
      const reply = (result) => { res.setHeader('content-type', 'application/json'); res.setHeader('mcp-session-id', 's1'); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result })); };
      if (m.method === 'initialize') return reply({ serverInfo: { name: 'test' }, protocolVersion: '2025-03-26' });
      if (m.id === undefined) { res.statusCode = 202; return res.end(); }
      n++;
      const msg = m.params.name === 'other' ? 'execution reverted' : 'block is not available';
      if (n <= failures || m.params.name === 'other') return reply({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message: msg, code: -32602 } }) }] });
      reply({ content: [{ type: 'text', text: '"ok"' }] });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, count: () => n, close: () => server.closeAllConnections() || server.close() };
}

test('"block is not available" is retried and the call then succeeds', async () => {
  const s = await flakyBlockServer(2);
  try {
    assert.equal(await new McpClient(s.url, { retries: 0 }).callTool('get_code', {}), 'ok');
    assert.equal(s.count(), 3);
  } finally { s.close(); }
});

test('"block is not available" gives up after a few tries and surfaces the error', async () => {
  const s = await flakyBlockServer(99);
  try {
    await assert.rejects(new McpClient(s.url, { retries: 0 }).callTool('get_code', {}), (e) => e.tool === true && /block is not available/.test(e.message));
    assert.equal(s.count(), 4); // 1 + 3 retries
  } finally { s.close(); }
});

test('other tool errors (a revert) are never retried', async () => {
  const s = await flakyBlockServer(0);
  try {
    await assert.rejects(new McpClient(s.url, { retries: 0 }).callTool('other', {}), (e) => e.tool === true);
    assert.equal(s.count(), 1);
  } finally { s.close(); }
});
