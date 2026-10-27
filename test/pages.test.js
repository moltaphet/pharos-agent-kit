import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_MODULES } from '../public/js/tasks/index.js';

// The task pages are rendered by the hub, which only knows these tool badges and server chips. An unknown one throws in the browser and leaves the page blank.
const TOOLS = ['chain', 'docs', 'rpc'];
const SERVERS = ['chain', 'docs', 'rpc', 'local'];

test('every task page uses only the tool badges and server chips the hub can draw', () => {
  assert.ok(Object.keys(TASK_MODULES).length >= 20);
  for (const [slug, { content }] of Object.entries(TASK_MODULES)) {
    for (const t of content.tools ?? []) assert.ok(TOOLS.includes(t), `${slug}: unknown tool badge "${t}"`);
    for (const h of content.how ?? []) assert.ok(SERVERS.includes(h.server), `${slug}: unknown server chip "${h.server}" in how`);
  }
});

test('a recorded fact is not called a mismatch on one miss: it is read again, and only a repeated miss is reported', async () => {
  const { confirmed } = await import('../lib/retry.js');
  let calls = 0;
  const good = await confirmed(async () => (++calls < 3 ? null : { ok: 1 }), (v) => v?.ok === 1, { pause: 1 });
  assert.equal(good.ok, true); assert.equal(calls, 3);
  calls = 0;
  const bad = await confirmed(async () => { calls++; return null; }, (v) => v != null, { pause: 1 });
  assert.equal(bad.ok, false); assert.equal(calls, 3);
  const thrown = await confirmed(async () => { throw new Error('boom'); }, () => true, { pause: 1 });
  assert.equal(thrown.ok, false); assert.equal(thrown.value.error, 'boom');
});
