import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResult, cleanMarkdown, parseSearch, splitAnswer } from '../lib/docs.js';

// Shapes captured from the live Developer Docs MCP server.
const GOOD_ASK = `Deploy with Foundry. See [Write Your First Token](/developer-guide/foundry/write-your-first-token).

# Sources

- [Write Your First Token](https://docs.pharos.xyz/developer-guide/foundry/write-your-first-token)
- [Validator Node Deployment](https://docs.pharos.xyz/node-and-validator-guide/validator-node-deployment)
`;

const GOOD_SEARCH = `Title: Write Your First Uniswap Contract
Link: https://docs.pharos.xyz/developer-guide/foundry/write-your-first-uniswap-contract
Content: Deploy the contract...
Title: Write Your First Token
Link: https://docs.pharos.xyz/developer-guide/foundry/write-your-first-token
Content: forge script ...`;

const BAD_ASK = `I cannot find information about this in the docs. [Broken mention](broken://spaces/abc/pages/def) covers the blockchain network, not swallow airspeed.

# Sources

- [About Pharos](https://docs.pharos.xyz/introduction/readme)
`;

test('cleanMarkdown absolutises relative links and unwraps broken mentions', () => {
  const out = cleanMarkdown('See [A](/x/y) and [Broken mention](broken://spaces/1/pages/2).');
  assert.equal(out, 'See [A](https://docs.pharos.xyz/x/y) and Broken mention.');
});

test('splitAnswer separates the answer from its Sources list', () => {
  const { answer, listed } = splitAnswer(GOOD_ASK);
  assert.ok(!answer.includes('# Sources'));
  assert.equal(listed.length, 2);
});

test('parseSearch reads Title/Link blocks', () => {
  const hits = parseSearch(GOOD_SEARCH);
  assert.equal(hits.length, 2);
  assert.equal(hits[1].title, 'Write Your First Token');
});

test('a real answer is found; pages it links to are listed first and not duplicated', () => {
  const r = buildResult({ question: 'deploy?', askText: GOOD_ASK, searchText: GOOD_SEARCH });
  assert.equal(r.found, true);
  assert.equal(r.sources[0].url, 'https://docs.pharos.xyz/developer-guide/foundry/write-your-first-token');
  const urls = r.sources.map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length);
});

test('"I cannot find…" is reported as no answer, even though sources were listed', () => {
  const r = buildResult({ question: 'swallow?', askText: BAD_ASK, searchText: GOOD_SEARCH });
  assert.equal(r.found, false);
  assert.equal(r.answer, null);
  assert.deepEqual(r.sources, []);
  assert.ok(r.related.length > 0); // offered separately, labelled as not an answer
});

test('other refusal wordings are caught too, including curly apostrophes', () => {
  // Captured from the live server: same question, different phrasing on another run.
  const refusal = 'I can help with building on Pharos, but I can’t answer that from the available docs.\n\n# Sources\n\n- [Pharos Skill Engine](https://docs.pharos.xyz/tooling-and-infrastructure/pharos-skill-engine-guide)';
  const r = buildResult({ question: 'swallow?', askText: refusal, searchText: GOOD_SEARCH });
  assert.equal(r.found, false);
});

test('a real answer that mentions a missing detail is still an answer', () => {
  const ask = 'Get testnet PHRS from the faucet or the team. The docs don’t provide a faucet URL.\n\n# Sources\n\n- [Atlantic Testnet](https://docs.pharos.xyz/getting-started/network/atlantic-testnet)';
  assert.equal(buildResult({ question: 'gas?', askText: ask, searchText: GOOD_SEARCH }).found, true);
});

test('an answer with no supporting search hits or doc links is not trusted', () => {
  const r = buildResult({ question: 'q', askText: 'Probably yes.\n\n# Sources\n\n- [X](https://docs.pharos.xyz/x)', searchText: '' });
  assert.equal(r.found, false);
});

test('empty responses do not throw', () => {
  assert.equal(buildResult({ question: 'q', askText: '', searchText: '' }).found, false);
  assert.equal(buildResult({ question: 'q' }).found, false);
});

test('maxSources caps the list', () => {
  const r = buildResult({ question: 'q', askText: GOOD_ASK, searchText: GOOD_SEARCH, maxSources: 1 });
  assert.equal(r.sources.length, 1);
});
