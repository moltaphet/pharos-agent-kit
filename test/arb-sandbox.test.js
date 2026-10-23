import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCENARIOS, idPattern, runCommandLine, startRun, validate } from '../lib/arb-sandbox.js';
import { UserError } from '../lib/snapshot.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('two fixed scenarios; anything else is refused before a machine is started', () => {
  assert.deepEqual(Object.keys(SCENARIOS), ['profitable', 'marginal']);
  for (const bad of ['', 'live', 'profitable; id', '../x', undefined, 'synthetic']) assert.throws(() => validate({ scenario: bad }), UserError);
  assert.equal(validate({ scenario: 'marginal' }).scenario, 'marginal');
});

test('the command line is one fixed template with no visitor text in it', () => {
  const template = /^cd \/tmp\/demo-run\/app && PATH=\$HOME\/\.foundry\/bin:\$PATH node scripts\/arb-fork-run\.mjs --scenario (profitable|marginal) --stream > \/tmp\/demo-run\/run\.ndjson 2> \/tmp\/demo-run\/run\.err; echo \$\? > \/tmp\/demo-run\/run\.exit$/;
  for (const sc of Object.keys(SCENARIOS)) assert.match(runCommandLine(sc, null), template);
});

test('run ids carry the demo name, so an arbitrage id cannot address a saga machine and vice versa', () => {
  assert.ok(idPattern.test('arb-profitable-abcd1234'));
  assert.ok(!idPattern.test('saga-plain-abcd1234'));
  assert.ok(!idPattern.test('arb-plain-abcd1234'));
  assert.ok(!idPattern.test('arb-profitable-abcd123'));
});

test('everything the script imports is uploaded to the sandbox (a missing file would only show up as a failed live run)', async () => {
  // Recompute the import closure of the script and compare it with what startRun uploads.
  const seen = new Set();
  const queue = ['scripts/arb-fork-run.mjs'];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) queue.push(path.normalize(path.join(path.dirname(f), m[1])));
  }
  const uploaded = [];
  const sdk = {
    list: async () => [],
    create: async () => ({ name: 'x', writeFiles: async (f) => uploaded.push(...f.map((x) => x.path)), runCommand: async () => ({}), stop: async () => {} }),
  };
  await startRun({ scenario: 'profitable', ip: '7.7.7.7' }, { Sandbox: sdk });
  const rel = uploaded.map((p) => p.replace('/tmp/demo-run/app/', ''));
  for (const f of seen) assert.ok(rel.includes(f), `${f} is imported by the script but not uploaded`);
  assert.ok(rel.includes('contracts/ArbLab.bytecode.json'));
  for (const f of rel.filter((x) => x !== 'package.json')) assert.ok(existsSync(path.join(root, f)), `${f} does not exist`);
});

test('the saga demo and the arbitrage demo share one limit pool (a runner can not exceed it by switching demos)', async () => {
  const sdk = { list: async () => [{ name: 'saga-plain-aaaaaaaa', status: 'running', createdAt: 0, tags: {} }, { name: 'arb-marginal-bbbbbbbb', status: 'running', createdAt: 0, tags: {} }] };
  await assert.rejects(startRun({ scenario: 'profitable', ip: '8.8.8.8' }, { Sandbox: sdk }), /already in progress/);
});
