import test from 'node:test';
import assert from 'node:assert/strict';
import { md } from '../public/js/util.js';

// Docs MCP answers are Markdown with lists that contain fenced code, so the small renderer has to cope with indented fences.
test('a fenced block inside a list item loses the list’s indent but keeps its own', () => {
  const html = md('Install:\n\n   ```bash\n   unzip a.zip\n   cd a\n\n   ls\n     indented\n   ```\nDone.');
  assert.match(html, /<pre><code>unzip a\.zip\ncd a\n\nls\n  indented<\/code><\/pre>/);
  assert.equal(html.includes('<p>   <pre>'), false, 'a code block is not wrapped in a paragraph');
  assert.equal(/<p>\s*<pre>/.test(html), false);
});

test('bullets, bold, inline code and links are rendered; HTML in the answer is escaped', () => {
  const html = md('* **Chain:** `get_block`, `get_gas_price`\n* See [docs](https://docs.pharos.xyz)\n\n<script>alert(1)</script>');
  assert.match(html, /<ul><li><b>Chain:<\/b> <code>get_block<\/code>, <code>get_gas_price<\/code><\/li><li>See <a href="https:\/\/docs\.pharos\.xyz"/);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('an unindented fence is unchanged', () => {
  assert.match(md('```sh\nplain\n  indented\n```'), /<pre><code>plain\n  indented<\/code><\/pre>/);
});
