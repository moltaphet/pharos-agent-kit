import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())).filter((s) => s.includes('.steps-list'));

// A step list is a grid of numbered items. An answer pasted into a step has bullets of its own, and a descendant selector like
// ".steps-list li" turns every one of them into a grid item, so a bullet's bold label and each code span were laid out in separate
// narrow columns (the Task 3 page looked broken). Step styles must reach only the list's own items.
test('step-list styles apply to the list’s own items, never to every li or p below it', () => {
  const loose = selectors.filter((s) => /\.steps-list\s+(li|p|\.si)\b/.test(s) && !s.includes('.answer'));
  assert.deepEqual(loose, [], 'use ".steps-list > li", ".steps-list > li > .si" and ".steps-list > li > div > p"');
  assert.ok(selectors.some((s) => s === '.steps-list > li'), 'the item rule exists');
});

test('an answer inside a step restores ordinary list items', () => {
  assert.match(css, /\.steps-list \.answer li \{[^}]*display: list-item/);
});
