import test from 'node:test';
import assert from 'node:assert/strict';
import run, { STEPS, addressesIn, buildReport, numbersIn, toolNamesIn, urlsIn } from '../lib/tasks/docs-mcp-onboarding.js';

// Answers captured from the live Developer Docs MCP server.
const RPC_ANSWER = '* **RPC URL:** `https://atlantic.dplabs-internal.com`\n* **Chain ID:** `688689`\n\nSee [Atlantic Testnet](https://docs.pharos.xyz/getting-started/network/atlantic-testnet).';
const USDC_ANSWER = 'The [Token Registry](/getting-started/token-registry) lists Atlantic Testnet USDC as `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B`.\n\nFor x402, it specifies `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8` and notes that it is **not an official address**.';
const TOOLS_ANSWER = 'It exposes **14 tools**:\n* `get_chain_info`, `get_block_number`, `get_block`\n* `eth_call`, `estimate_gas`, `get_logs`\n* `send_raw_transaction`';

test('urlsIn finds links and trims trailing punctuation', () => {
  assert.deepEqual(urlsIn(RPC_ANSWER), ['https://atlantic.dplabs-internal.com', 'https://docs.pharos.xyz/getting-started/network/atlantic-testnet']);
  assert.deepEqual(urlsIn('See https://example.com/a.'), ['https://example.com/a']);
  assert.deepEqual(urlsIn('no links here'), []);
});

test('addressesIn finds distinct 0x addresses only', () => {
  const a = addressesIn(USDC_ANSWER);
  assert.equal(a.length, 2);
  assert.ok(a.every((x) => /^0x[0-9a-fA-F]{40}$/.test(x)));
  assert.deepEqual(addressesIn('0x1234 is too short'), []);
});

test('numbersIn reads thousands separators', () => {
  assert.deepEqual(numbersIn('up to 100 blocks, or 10,000 and 1,000'), [100, 10000, 1000]);
  assert.ok(numbersIn(RPC_ANSWER).includes(688689));
});

test('toolNamesIn keeps only tool-shaped identifiers', () => {
  assert.deepEqual(toolNamesIn(TOOLS_ANSWER), ['get_chain_info', 'get_block_number', 'get_block', 'eth_call', 'estimate_gas', 'get_logs', 'send_raw_transaction']);
  assert.deepEqual(toolNamesIn('use `npx` and `mcp-remote`'), []);
});

test('every step has an id, a goal and a question, and ids are unique', () => {
  assert.ok(STEPS.length >= 8);
  assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
  for (const s of STEPS) assert.ok(s.id && s.goal && s.question && typeof s.verify === 'function');
});

test('steps that can expose a gap carry a title and a suggested fix', () => {
  const withGap = STEPS.filter((s) => s.gapTitle);
  assert.ok(withGap.length >= 3, 'at least 3 gap-capable steps');
  for (const s of withGap) assert.ok(s.fix.length > 30, `${s.id} has a real suggested fix`);
});

test('plan lists the questions without running them', async () => {
  const { steps } = await run({ q: { step: 'plan' } });
  assert.equal(steps.length, STEPS.length);
  assert.equal(steps[0].question, STEPS[0].question);
});

test('an unknown step and a report without results are rejected', async () => {
  await assert.rejects(run({ q: { step: 'nope' } }), /unknown step/);
  await assert.rejects(run({ q: { step: 'report' }, body: null }), /POST the step results/);
});

test('the report lists the exact query, the evidence and the fix for each gap', () => {
  const results = [
    { goal: 'Find the RPC', question: 'What is the RPC URL?', answer: 'RPC is X', checks: [{ name: 'Answer gives an RPC URL', ok: true, detail: 'x' }], gap: null },
    {
      goal: 'Get gas', question: 'Faucet URL?', answer: 'No URL.\nSecond line.', checks: [{ name: 'Contains a faucet URL', ok: false, detail: 'none' }],
      gap: { title: 'No faucet URL', evidence: ['Expected: a faucet URL. Found: none.'], fix: 'Publish the faucet URL.' },
    },
  ];
  const md = buildReport({ results, finale: { built: ['Did a thing'], couldNot: ['Could not send'] }, generatedAt: 'now' });
  assert.match(md, /2 questions asked, 1 gaps found/);
  assert.match(md, /\*\*Question asked:\*\* Faucet URL\?/);
  assert.match(md, /### Gap 1: No faucet URL/);
  assert.match(md, /Exact query:\*\* `Faucet URL\?`/);
  assert.match(md, /What the docs should say:\*\* Publish the faucet URL\./);
  assert.match(md, /- ✓ Answer gives an RPC URL: x/);
  assert.match(md, /- ✗ Contains a faucet URL: none/);
  assert.match(md, /## What I built or ran by the end\n\n- Did a thing/);
  assert.match(md, /## What I could not do\n\n- Could not send/);
});

test('a clean run reports no gaps', () => {
  const md = buildReport({ results: [{ goal: 'g', question: 'q', answer: 'a', checks: [], gap: null }], finale: null, generatedAt: 'now' });
  assert.match(md, /No gaps found in this run/);
});
