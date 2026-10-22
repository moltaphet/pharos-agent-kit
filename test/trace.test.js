import test from 'node:test';
import assert from 'node:assert/strict';
import { McpClient } from '../lib/mcp.js';
import { packTrace, preview, record, startTrace, traceStore } from '../lib/trace.js';

test('record is a no-op outside a trace (the CLIs never start one)', () => {
  assert.doesNotThrow(() => record({ kind: 'mcp', start: performance.now() }));
});

test('entries land in the active trace with an offset from its start', async () => {
  const store = startTrace();
  await traceStore.run(store, async () => {
    record({ kind: 'mcp', tool: 'a', start: performance.now() });
    await new Promise((r) => setTimeout(r, 15));
    record({ kind: 'mcp', tool: 'b', start: performance.now() });
  });
  const t = packTrace(store);
  assert.deepEqual(t.calls.map((c) => c.tool), ['a', 'b']);
  assert.ok(t.calls[1].at >= t.calls[0].at + 10);
  assert.ok(t.ms >= t.calls[1].at);
  assert.equal('start' in t.calls[0], false);
});

test('concurrent requests never see each other’s entries', async () => {
  const run = (name, delay) => {
    const store = startTrace();
    return traceStore.run(store, async () => {
      await new Promise((r) => setTimeout(r, delay));
      record({ kind: 'mcp', tool: name, start: performance.now() });
      await new Promise((r) => setTimeout(r, delay));
      return packTrace(store).calls.map((c) => c.tool);
    });
  };
  const [a, b] = await Promise.all([run('A', 5), run('B', 12)]);
  assert.deepEqual(a, ['A']);
  assert.deepEqual(b, ['B']);
});

test('preview pretty-prints JSON and truncates long responses with a note', () => {
  assert.equal(preview('{"a":1}').text, '{\n "a": 1\n}');
  const long = preview('x'.repeat(5000), 100);
  assert.equal(long.truncated, true);
  assert.equal(long.size, 5000);
  assert.match(long.text, /4900 more characters/);
  assert.equal(preview('plain text').truncated, false);
});

test('a failing tool call is recorded with its error, then still throws', async () => {
  const client = new McpClient('https://example.invalid/mcp', { label: 'chain' });
  client.request = async () => ({ isError: true, content: [{ type: 'text', text: 'execution reverted' }] }); // no network
  const store = startTrace();
  await traceStore.run(store, async () => {
    await assert.rejects(client.callTool('eth_call', { a: 1 }, { why: 'test' }), /execution reverted/);
  });
  const [entry] = packTrace(store).calls;
  assert.equal(entry.kind, 'mcp');
  assert.equal(entry.server, 'chain');
  assert.equal(entry.tool, 'eth_call');
  assert.equal(entry.why, 'test');
  assert.equal(entry.ok, false);
  assert.match(entry.error, /execution reverted/);
  assert.deepEqual(entry.args, { a: 1 });
});

test('a successful tool call records the raw response, parsed result is returned', async () => {
  const client = new McpClient('https://example.invalid/mcp', { label: 'docs' });
  client.request = async () => ({ content: [{ type: 'text', text: '{"blockNumber":"7"}' }] });
  const store = startTrace();
  const out = await traceStore.run(store, () => client.callTool('get_block_number'));
  assert.deepEqual(out, { blockNumber: '7' });
  const [entry] = packTrace(store).calls;
  assert.equal(entry.ok, true);
  assert.match(entry.result.text, /blockNumber/);
});
