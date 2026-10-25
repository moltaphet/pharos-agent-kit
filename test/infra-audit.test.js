import test from 'node:test';
import assert from 'node:assert/strict';
import { limiter } from '../lib/limit.js';
import { confirmedCall } from '../lib/confirm.js';
import { McpClient, McpError } from '../lib/mcp.js';
import { rpcCall } from '../lib/rpc.js';
import { handle } from '../lib/server.js';
import logs from '../api/logs.js';
import { decodeAddress, decodeString, decodeUint } from '../lib/abi.js';
import { createDevServer } from '../dev-server.js';
import http from 'node:http';

const respond = async (handler, query = {}) => {
  const out = {};
  const res = { setHeader() {}, status(code) { out.status = code; return this; }, json(body) { out.body = body; } };
  await handler({ query }, res);
  return out;
};
const mockFetch = async (fn, run) => {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try { await run(); } finally { globalThis.fetch = original; }
};
const jsonReply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('limiter releases a slot after a synchronous throw and accepts ordinary return values', async () => {
  const run = limiter(1);
  await assert.rejects(run(() => { throw new Error('sync failure'); }), /sync failure/);
  const result = await Promise.race([run(() => 42), new Promise((resolve) => setTimeout(() => resolve('wedged'), 50))]);
  assert.equal(result, 42);
});

test('limiter rejects invalid concurrency instead of leaving jobs waiting forever', () => {
  for (const max of [0, -1, NaN, 1.5, '2']) assert.throws(() => limiter(max), /positive integer|Infinity/);
});

test('a majority of tool errors propagates an error rather than returning a fake value', async () => {
  const failures = [new McpError('reverted', { tool: true }), new McpError('reverted', { tool: true })];
  let call = 0;
  const client = { async callTool() { if (call++ === 0) return '0x01'; throw failures.shift(); } };
  await assert.rejects(confirmedCall(client, 'eth_call', { block: 10 }), (err) => err instanceof McpError && err.tool && err.message === 'reverted');
});

test('MCP initialization recovers on the next call after a network error', async () => {
  let calls = 0;
  await mockFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (calls++ === 0) throw new TypeError('fetch failed');
    if (body.method === 'initialize') return jsonReply({ id: body.id, result: { serverInfo: { name: 'test' } } });
    if (!body.id) return new Response(null, { status: 202 });
    return jsonReply({ id: body.id, result: { tools: [] } });
  }, async () => {
    const client = new McpClient('https://mcp.test', { retries: 0 });
    await assert.rejects(client.listTools(), /Network error/);
    assert.deepEqual(await client.listTools(), []);
  });
});

test('RPC refuses non-success HTTP statuses and malformed envelopes', async () => {
  for (const [body, status] of [[{ result: 'wrong' }, 500], [{}, 200], [null, 200], [[], 200], [{ result: 1, error: { message: 'bad' } }, 200], [{ result: 1, error: { message: '' } }, 200]]) {
    await mockFetch(async () => jsonReply(body, status), async () => {
      await assert.rejects(rpcCall('eth_blockNumber', [], { url: 'https://rpc.test', retries: 0 }));
    });
  }
  await mockFetch(async () => jsonReply({ result: null }), async () => {
    assert.equal(await rpcCall('eth_getTransactionByHash', [], { url: 'https://rpc.test' }), null);
  });
});

test('logs rejects inherited event names and nonstring addresses before contacting upstream', async () => {
  await mockFetch(async () => assert.fail('invalid input must not contact upstream'), async () => {
    assert.equal((await respond(logs, { address: {} })).status, 400);
    for (const event of ['constructor', '__proto__', 'toString']) {
      assert.equal((await respond(logs, { address: '0x' + 'a'.repeat(40), event })).status, 400);
    }
  });
});

test('API error handling serializes even non-Error thrown values', async () => {
  for (const failure of [null, undefined, 'bad', { httpStatus: 900 }]) {
    const out = await respond(handle(() => { throw failure; }));
    assert.equal(out.status, 500);
    assert.equal(typeof out.body.error, 'string');
  }
});

// MCP streams may carry notifications before the matching response and JSON across data lines.
test('MCP parses multiline SSE events and selects the initialize response by id', async () => {
  await mockFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'initialize') return new Response(`data: {"method":"notice"}\n\ndata: {"id":${body.id},\ndata: "result":{"serverInfo":{"name":"test"}}}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    if (!body.id) return new Response(null, { status: 202 });
    return jsonReply({ id: body.id, result: { tools: [] } });
  }, async () => assert.deepEqual(await new McpClient('https://mcp.test').listTools(), []));
});

test('MCP malformed initialization and result envelopes fail as upstream errors', async () => {
  for (const bad of [null, {}, { result: {} }]) {
    await mockFetch(async (_url, opts) => jsonReply({ id: JSON.parse(opts.body).id, ...bad }), async () => {
      await assert.rejects(new McpClient('https://mcp.test', { retries: 0 }).listTools(), McpError);
    });
  }
  await mockFetch(async () => jsonReply({}, 500), async () => {
    const out = await respond(handle(async () => rpcCall('x', [], { url: 'https://rpc.test', retries: 0 })));
    assert.equal(out.status, 502);
  });
});

test('ABI decoders reject malformed hex and out-of-bounds dynamic strings without throwing', () => {
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  for (const raw of [null, {}, '0x' + 'z'.repeat(64), '0x' + word(64) + word(1), '0x' + 'f'.repeat(64) + word(1), '0x' + word(1) + word(0), '0x' + word(32) + word(100) + '61', '0x' + word(32) + word(1) + '61']) {
    assert.equal(decodeString(raw), null);
  }
  assert.equal(decodeString('0x' + word(32) + word(0)), '');
  assert.equal(decodeUint('0x' + 'z'.repeat(64)), null);
  assert.equal(decodeUint('0x' + word(1), -1), null);
  assert.equal(decodeAddress('0x' + 'z'.repeat(64)), null);
  assert.equal(decodeAddress('0x' + word(1n << 200n)), null);
});

test('dev HTTP server rejects malformed JSON, route aliases, oversize bodies and static writes', async () => {
  const server = createDevServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const request = (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    assert.equal((await request('/api/run', { method: 'POST', body: '{broken' })).status, 400);
    assert.equal((await request('/api/run', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1), headers: { 'content-length': 1024 * 1024 + 1 } })).status, 413);
    assert.equal((await request('/api/run', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1), headers: { 'transfer-encoding': 'chunked' } })).status, 413);
    assert.equal((await request('/api/r!un?slug=unknown')).status, 404);
    assert.equal((await request('/api/missing')).status, 404);
    assert.equal((await request('/', { method: 'POST' })).status, 405);
    assert.equal((await request('/%ZZ')).status, 400);
    assert.equal((await request('/..%2Fpackage.json')).status, 403);
    const head = await request('/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.text, '');
    const duplicate = await request('/api/run?slug=unknown&slug=constructor');
    assert.equal(duplicate.status, 400);
    assert.equal(JSON.parse(duplicate.text).error, 'unknown task "unknown"');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('confirmed object results compare by value regardless of JSON key order', async () => {
  let n = 0;
  const answers = [{ number: 5, timestamp: 10 }, { timestamp: 10, number: 5 }];
  const client = { callTool: async () => answers[n++] };
  assert.deepEqual(await confirmedCall(client, 'get_block', { block: 5 }), answers[0]);
  assert.equal(n, 2);
});

test('health shares cold probes across concurrent requests and marks invalid block data unhealthy', async () => {
  const { default: health } = await import('../api/health.js?infra-audit');
  const counts = { chain: 0, docs: 0, rpc: 0 };
  await mockFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_blockNumber') { counts.rpc++; return jsonReply({ result: 'garbage' }); }
    if (body.method === 'initialize') return jsonReply({ id: body.id, result: { serverInfo: { name: 'test' } } });
    if (!body.id) return new Response(null, { status: 202 });
    if (body.method === 'tools/list') { counts.docs++; return jsonReply({ id: body.id, result: { tools: [] } }); }
    counts.chain++;
    return jsonReply({ id: body.id, result: { content: [{ type: 'text', text: '{"blockNumber":"garbage"}' }] } });
  }, async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => respond(health)));
    assert.deepEqual(counts, { chain: 1, docs: 1, rpc: 1 });
    assert.equal(responses.filter((r) => !r.body.data.cached).length, 1);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.data.services.map((s) => s.ok), [false, true, false]);
    }
    assert.equal((await respond(health)).body.data.cached, true);
    assert.deepEqual(counts, { chain: 1, docs: 1, rpc: 1 });
  });
});

test('MCP response body timeouts are upstream errors and do not poison initialization', async () => {
  let failed = false;
  await mockFetch(async (_url, opts) => {
    if (!failed) {
      failed = true;
      return { text: async () => { throw new DOMException('body stalled', 'TimeoutError'); } };
    }
    const body = JSON.parse(opts.body);
    if (body.method === 'initialize') return jsonReply({ id: body.id, result: { serverInfo: { name: 'test' } } });
    if (!body.id) return new Response(null, { status: 202 });
    return jsonReply({ id: body.id, result: { tools: [] } });
  }, async () => {
    const client = new McpClient('https://mcp.test', { retries: 0 });
    await assert.rejects(client.listTools(), (err) => err instanceof McpError && /Timed out/.test(err.message));
    assert.deepEqual(await client.listTools(), []);
  });
});

test('RPC network timeouts map to 502 with a readable timeout message', async () => {
  await mockFetch(async () => { throw new DOMException('stalled', 'TimeoutError'); }, async () => {
    const out = await respond(handle(() => rpcCall('eth_blockNumber', [], { url: 'https://rpc.test', retries: 0, timeoutMs: 10 })));
    assert.equal(out.status, 502);
    assert.match(out.body.error, /timed out after 10 ms/);
  });
});
