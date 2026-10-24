import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A browser silently refuses to submit a form whose number field breaks its own min/step ("Please enter a valid value"), so the
// Run button seems to do nothing. The example chips bypass that check, which is how a bad default can survive manual testing.
const dir = fileURLToPath(new URL('../public/js/tasks/', import.meta.url));

test('every number field on every task page has a default its own min/step accepts', () => {
  let checked = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(dir + file, 'utf8');
    for (const m of src.matchAll(/\{\s*name:\s*'(\w+)'[^{}]*type:\s*'number'[^{}]*\}/g)) {
      const get = (k) => m[0].match(new RegExp(`${k}:\\s*'?(-?[\\d.]+|any)'?`))?.[1];
      const [value, min, step] = [get('value'), get('min'), get('step')];
      checked++;
      if (value == null || step == null || step === 'any') continue;
      const q = (Number(value) - (min == null ? 0 : Number(min))) / Number(step);
      assert.ok(Math.abs(q - Math.round(q)) < 1e-9, `${file}: field "${m[1]}" defaults to ${value}, which min=${min} step=${step} rejects`);
    }
  }
  assert.ok(checked >= 5, `only ${checked} number fields found: the pattern probably stopped matching`);
});

test('the check can fail: a default that breaks its step is caught', () => {
  const field = "{ name: 'step', type: 'number', value: '20000', min: 100, step: 1000 }";
  const get = (k) => field.match(new RegExp(`${k}:\\s*'?(-?[\\d.]+|any)'?`))?.[1];
  const q = (Number(get('value')) - Number(get('min'))) / Number(get('step'));
  assert.ok(Math.abs(q - Math.round(q)) > 1e-9);
});

test('examples that are meant to be refused say so (rejected: true), so the page shows the refusal as the result rather than as a red error', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['policy-gatekeeper', 'batch-executor']) {
    const src = readFileSync(new URL(`../public/js/tasks/${f}.js`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\{ label: '([^']*\((?:rejected|refused)\))',([^\n]*)/g)) assert.match(m[2], /rejected: true/, `${f}: "${m[1]}"`);
  }
  assert.match(readFileSync(new URL('../public/js/panels/factory.js', import.meta.url), 'utf8'), /refusalExpected && err\.status === 400/);
});
