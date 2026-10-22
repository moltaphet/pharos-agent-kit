import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../lib/server.js';
import { McpError } from '../lib/mcp.js';
import { UserError } from '../lib/snapshot.js';
import { UnstableReadError } from '../lib/stable.js';

const call = async (fn, opts) => {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; } };
  await handle(fn, opts)({ query: {} }, res);
  return out;
};

test('handle answers 200 with data and a trace', async () => {
  const r = await call(async () => ({ x: 1 }));
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.ok, r.body.data], [true, { x: 1 }]);
  assert.ok(Array.isArray(r.body.trace.calls));
});

test('a handler that outlasts the deadline gets a readable 504 instead of hanging', async () => {
  const r = await call(() => new Promise(() => {}), { deadlineMs: 50 });
  assert.equal(r.status, 504);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /took longer than/);
});

test('errors map to the right status: user 400, upstream 502, inconsistent node 502, bug 500', async () => {
  assert.equal((await call(async () => { throw new UserError('bad input'); })).status, 400);
  assert.equal((await call(async () => { throw new McpError('HTTP 500'); })).status, 502);
  assert.equal((await call(async () => { throw new UnstableReadError('node inconsistent'); })).status, 502);
  assert.equal((await call(async () => { throw new Error('oops'); })).status, 500);
});

test('a rate-limited upstream (429/503) is reported as "busy", with the technical detail kept apart', async () => {
  const r = await call(async () => { throw new McpError('HTTP 429: slow down'); });
  assert.match(r.body.error, /busy right now/);
  assert.match(r.body.detail, /429/);
});
