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
