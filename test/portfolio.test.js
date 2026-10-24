import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_QUESTIONS, askPortfolio, classify, findEntities } from '../lib/portfolio.js';
import { VAULT_LIST, fmtUnits, fmtUsd } from '../lib/defi.js';
import { UnstableReadError } from '../lib/stable.js';
import { UserError } from '../lib/snapshot.js';
import { WALLET, makeWorld } from './support/defi-world.js';

const ask = (w, question, o = {}) => askPortfolio({ chain: w.chain, rpc: w.rpc, wallet: WALLET, question, ...o });
const PINNED = (w) => w.world.head - 2;

// ---- understanding the question ------------------------------------------------------------------------------------------------------------------
test('eight question types are recognised, each in more than one wording', () => {
  const cases = {
    total: ['What is my total balance?', 'what is my net worth', 'how much do I have?', 'what is my portfolio worth in total'],
    holdings: ['What do I hold?', 'list my balances', 'which tokens do I have', 'show my positions'],
    where_token: ['Where is my USDC?', 'where are my stablecoins', 'where is the USDC I own'],
    token_value: ['How much is my WPROS worth?', 'how much USDC do I have', 'what is my PROS balance'],
    biggest: ["What's my biggest position?", 'what is my largest holding', 'my top position'],
    position_in: ['How much do I have in R25 Quarterly?', 'what is my position in rockaway', 'how much is in the weekly vault'],
    protocols: ['Which protocols am I using?', 'what vaults am I in', 'list the protocols I use'],
    earning: ['What am I earning?', "what's my yield", 'how much interest do I get per day', 'what is my APY'],
  };
  for (const [intent, qs] of Object.entries(cases)) for (const q of qs) assert.equal(classify(q).intent, intent, q);
});

test('every question the page suggests is classified as the question it is', () => {
  const expect = ['total', 'holdings', 'where_token', 'token_value', 'biggest', 'position_in', 'protocols', 'earning'];
  assert.deepEqual(SUPPORTED_QUESTIONS.map((q) => classify(q).intent), expect);
});

test('questions it cannot answer are named as such: another protocol, what you earned since depositing, and anything else', () => {
  assert.equal(classify('How much do I have on Aave?').intent, 'unsupported');
  assert.deepEqual(classify('What is my position on Uniswap and Curve?').unsupported.sort(), ['curve', 'uniswap']);
  for (const q of ['How much have I earned so far?', 'what is my profit since I deposited', 'what are my gains']) assert.equal(classify(q).intent, 'earned', q);
  for (const q of ['What will the price of PROS be tomorrow?', 'tell me a joke', 'should I buy more USDC']) assert.equal(classify(q).intent, 'unknown', q);
});

test('entities: token symbols, vaults by their names, protocols', () => {
  assert.deepEqual(findEntities('Where is my USDC and my wpros?').tokens, ['USDC', 'WPROS']);
  assert.deepEqual(findEntities('how much in R25 Quarterly').vaults, ['r25-quarterly']);
  assert.deepEqual(findEntities('my semi-yearly vault').vaults, ['r25-semi-yearly']);
  assert.deepEqual(findEntities('the RockawayX vault').vaults, ['rockaway-usdc']);
  assert.deepEqual(findEntities('what do I have in R25').protocols, ['R25']);
});

test('an empty or oversized question is refused before any server is asked', async () => {
  const w = makeWorld();
  for (const q of ['', '   ', 'x'.repeat(301)]) await assert.rejects(ask(w, q), UserError);
  assert.equal(w.calls.length, 0);
});

// ---- reading and answering --------------------------------------------------------------------------------------------------------------------------
test('the portfolio is read at one block behind the head, with every position and its value', async () => {
  const w = makeWorld();
  const r = await ask(w, 'What do I hold?');
  assert.equal(r.block.number, PINNED(w));
  assert.deepEqual(r.positions.map((p) => p.id), ['native', 'USDC', 'r25-weekly', 'r25-quarterly']);
  const weekly = r.positions.find((p) => p.id === 'r25-weekly');
  assert.equal(weekly.sharesText, '1,000');
  const expected = BigInt(Math.round(w.priceAt('r25-weekly', PINNED(w)) * 1e12)) * 1000n * 10n ** 6n / 10n ** 12n; // 1000 shares x price, in USDC base units
  assert.equal(weekly.amountRaw, expected.toString());
  assert.equal(weekly.liquidity, 'instant');
  assert.equal(r.positions.find((p) => p.id === 'r25-quarterly').liquidity, 'not-previewable');
});

test('total: the sum of every holding in exact dollars, with the price feeds as sources', async () => {
  const w = makeWorld();
  const r = await ask(w, 'What is my total balance?');
  const usdc = 1000_000_000n; // $1,000.00 at $1.00
  const pros = 2n * 10n ** 18n * 600_000_000_000_000_000n * 1_000_000n / (10n ** 18n * 10n ** 18n); // 2 PROS at $0.60
  const sum = r.positions.reduce((s, p) => s + BigInt(p.usd), 0n);
  assert.equal(BigInt(r.totalUsd), sum);
  assert.equal(BigInt(r.positions.find((p) => p.id === 'USDC').usd), usdc);
  assert.equal(BigInt(r.positions.find((p) => p.id === 'native').usd), pros);
  assert.match(r.answer.text, new RegExp(`^Your total is ${fmtUsd(sum).replace(/[$,.]/g, '\\$&')} across 4 holdings`));
  assert.ok(r.answer.figures.every((f) => f.sources.length >= 1));
});

test('where is my USDC: the wallet and each vault holding USDC, with units and a source for each', async () => {
  const w = makeWorld();
  const r = await ask(w, 'Where is my USDC?');
  assert.equal(r.answer.intent, 'where_token');
  assert.match(r.answer.text, /^Your USDC is in 3 places: 1,000 USDC in the wallet; .* USDC in R25 VRPC Weekly; .* USDC in R25 VRPC Quarterly\.$/);
  assert.equal(r.answer.figures.length, 3);
  const book = Object.fromEntries(r.answer.sources.map((s) => [s.n, s]));
  for (const f of r.answer.figures) for (const n of f.sources) assert.equal(book[n].block, PINNED(w));
});

test('how much WPROS: none held says so, and a wrapped balance is valued at the PROS price', async () => {
  const none = await ask(makeWorld(), 'How much is my WPROS worth?');
  assert.match(none.answer.text, /You have no WPROS that I can see/);
  const some = await ask(makeWorld({ wpros: 10n * 10n ** 18n }), 'How much is my WPROS worth?');
  assert.match(some.answer.text, /^You have 10 WPROS, worth \$6\.00\.$/);
  assert.ok(some.answer.caveats.some((c) => /wrapped PROS/.test(c)));
});

test('the biggest position is ranked by dollar value and says its share of the portfolio', async () => {
  const w = makeWorld({ shares: { 'r25-weekly': 1_000_000_000n, 'r25-quarterly': 9_000_000_000n } });
  const r = await ask(w, "What's my biggest position?");
  assert.match(r.answer.text, /^Your biggest position is R25 VRPC Quarterly \(R25\): .* USDC, \$.*, \d+\.\d% of your portfolio\.$/);
  assert.equal(r.answer.figures[0].label, 'R25 VRPC Quarterly');
});

test('a position in a named vault: its shares, its value, and what you hold in a vault you do not use', async () => {
  const w = makeWorld();
  const q = await ask(w, 'How much do I have in R25 Quarterly?');
  assert.match(q.answer.text, /^R25 VRPC Quarterly: 500 shares, worth .* USDC/);
  assert.doesNotMatch(q.answer.text, /Weekly/, 'naming one vault answers for that vault only, not for the whole protocol');
  assert.equal(q.answer.figures.length, 1);
  const two = await ask(w, 'How much do I have in R25 Weekly and Rockaway?');
  assert.match(two.answer.text, /^R25 VRPC Weekly: 1,000 shares.*RockawayX USDC \(Morpho Vault V2\): you hold no shares\.$/);
  assert.doesNotMatch(two.answer.text, /Quarterly/);
  const none = await ask(w, 'How much do I have in Rockaway?');
  assert.equal(none.answer.text, 'RockawayX USDC (Morpho Vault V2): you hold no shares.');
  const both = await ask(w, 'what do I have in R25');
  assert.match(both.answer.text, /^R25 VRPC Weekly: 1,000 shares.*R25 VRPC Quarterly: 500 shares/);
  assert.doesNotMatch(both.answer.text, /Rockaway/);
});

test('protocols: counted by protocol, not by token', async () => {
  const r = await ask(makeWorld({ shares: { 'r25-weekly': 1_000_000_000n, 'rockaway-usdc': 5n * 10n ** 20n } }), 'Which protocols am I using?');
  assert.match(r.answer.text, /You are using 2 protocols: R25 \(1 vault\) and Morpho \(RockawayX vault\) \(1 vault\)\. Tokens in your wallet are not a protocol\./);
});

test('earning: the rate each vault paid over the window, from its share price at three blocks, and idle USDC earns nothing', async () => {
  const w = makeWorld();
  const r = await ask(w, 'What am I earning?');
  const weekly = r.yields['r25-weekly'];
  // the fake price grows 0.0000002 per block; over 400,000 blocks (one second each) that is a known annual rate
  const p1 = w.priceAt('r25-weekly', PINNED(w));
  const p0 = w.priceAt('r25-weekly', PINNED(w) - 400_000);
  const expected = (p1 / p0) ** (31_557_600 / 400_000) - 1;
  assert.ok(Math.abs(weekly.apy - expected) / expected < 0.001, `${weekly.apy} vs ${expected}`);
  assert.equal(weekly.steady, true);
  assert.match(r.answer.text, /1,000 USDC sitting in the wallet earns nothing/);
  assert.match(r.answer.text, /R25 VRPC Weekly: about \d+\.\d+% a year/);
  assert.ok(r.answer.caveats.some((c) => /what it paid, not what it will pay/.test(c)));
  assert.equal(r.answer.figures.filter((f) => /rate over the last/.test(f.label)).length, 2);
});

test('"what have I earned" is answered with why it cannot be, and what can be answered instead', async () => {
  const r = await ask(makeWorld(), 'How much have I earned so far?');
  assert.equal(r.answer.known, false);
  assert.match(r.answer.text, /I cannot tell what you have earned so far.*deposit history/);
  assert.equal(r.answer.figures.length, 0);
});

test('a protocol it does not read is refused by name, and a question it does not understand lists what it can answer', async () => {
  const aave = await ask(makeWorld(), 'How much do I have on Aave?');
  assert.match(aave.answer.text, /^I do not read Aave positions, so I cannot tell you anything about them and I will not guess\./);
  const odd = await ask(makeWorld(), 'Should I buy more PROS?');
  assert.match(odd.answer.text, /^I do not know how to answer that\. I can answer questions like: “What is my total balance\?”/);
  assert.equal(odd.answer.known, false);
});

test('a vault that cannot be read is said so, not counted, and the answer names the reason', async () => {
  const q = VAULT_LIST.find((v) => v.id === 'r25-quarterly');
  const w = makeWorld({ broken: [q.address] });
  const r = await ask(w, 'How much do I have in R25 Quarterly?');
  assert.match(r.answer.text, /R25 VRPC Quarterly: I could not read it \(.*not counted\)\./);
  assert.ok(r.unreadable.some((u) => u.contract === q.address));
  const total = await ask(w, 'What is my total balance?');
  assert.match(total.answer.caveats[0], /^I could not read R25 VRPC Quarterly position/);
  assert.ok(!total.positions.some((p) => p.id === 'r25-quarterly'));
});

test('a missing price means no dollar figure and no total, rather than a total with a hole in it', async () => {
  const w = makeWorld({ feeds: { 'USDC/USD': 10n ** 18n, 'PROS/USD': 0n } });
  const r = await ask(w, 'What is my total balance?');
  assert.equal(r.totalUsd, null);
  assert.match(r.answer.text, /at least one has no price, so I will not state a total/);
  assert.ok(r.unreadable.some((u) => /PROS\/USD price feed/.test(u.what)));
});

test('an old price is flagged', async () => {
  const r = await ask(makeWorld({ feedAge: 5 * 3600 }), 'What is my total balance?');
  assert.ok(r.answer.caveats.some((c) => /price is 5\.0 hours old/.test(c)));
});

test('a restricted vault is flagged wherever it is counted (the redemption cannot be previewed)', async () => {
  const r = await ask(makeWorld(), 'Where is my USDC?');
  assert.ok(r.answer.caveats.some((c) => /R25 VRPC Quarterly \(the vault will not preview a redemption/.test(c)));
  const partial = await ask(makeWorld({ locked: [], maxRedeem: { 'r25-quarterly': 100_000_000n } }), 'What do I hold?');
  assert.ok(partial.answer.caveats.some((c) => /only part of the shares can be redeemed/.test(c)));
});

test('a wallet that holds nothing gets an honest empty answer', async () => {
  const r = await askPortfolio({ chain: makeWorld().chain, rpc: makeWorld().rpc, wallet: '0x000000000000000000000000000000000000dead', question: 'What do I hold?' });
  assert.equal(r.positions.length, 0);
  assert.equal(r.answer.text, 'This wallet holds nothing I read.');
});

// ---- read integrity and safety --------------------------------------------------------------------------------------------------------------------------------
test('every batch of reads is repeated on the public RPC and the answer reports how many matched', async () => {
  const w = makeWorld();
  const r = await ask(w, 'What do I hold?');
  assert.deepEqual([r.integrity.batches, r.integrity.confirmed, r.integrity.resolved, r.integrity.inconclusive], [2, 2, 0, 0]);
  assert.equal(r.rpcCalls, 2);
  assert.ok(r.answer.sources.every((s) => s.integrity === 'confirmed'));
});

test('a Chain MCP backend that answers with wrong state is caught, and the figure comes from the agreeing answers', async () => {
  let hit = 0;
  const wrongUsdc = (target, data) => (target.toLowerCase() === '0xc879c018db60520f4355c26ed1a6d572cdac1815' && data.startsWith('0x70a08231') && hit++ === 0 ? '0x' + (123n).toString(16).padStart(64, '0') : undefined);
  const w = makeWorld({ wrong: wrongUsdc });
  const r = await ask(w, 'Where is my USDC?');
  assert.match(r.answer.text, /^Your USDC is in 3 places: 1,000 USDC in the wallet/);
  assert.equal(r.integrity.resolved, 1);
  assert.ok(r.steps.some((s) => s.name === 'read-resolved'));
});

test('a disagreement that re-reading cannot settle stops the run: no figure is reported', async () => {
  let n = 0;
  const w = makeWorld({ wrong: (target, data) => (data.startsWith('0x70a08231') ? '0x' + BigInt(1000 + n++).toString(16).padStart(64, '0') : undefined) });
  await assert.rejects(ask(w, 'What do I hold?'), UnstableReadError);
});

test('if the public RPC cannot answer, the figures stand but are marked unconfirmed', async () => {
  const r = await ask(makeWorld({ rpcDown: true }), 'What do I hold?');
  assert.equal(r.integrity.inconclusive, 2);
  assert.ok(r.answer.caveats.some((c) => /2 of 2 batches of reads could not be repeated on the public RPC/.test(c)));
  assert.ok(r.answer.sources.every((s) => s.integrity === 'inconclusive'));
});

test('read-only: the assistant only ever asks the chain to read', async () => {
  const w = makeWorld();
  await ask(w, 'What am I earning?');
  const tools = new Set(w.calls.filter((c) => c.server === 'chain').map((c) => c.name));
  assert.deepEqual([...tools].sort(), ['eth_call', 'get_block', 'get_block_number']);
  assert.ok(w.calls.filter((c) => c.server === 'rpc').every((c) => c.name === 'eth_call'));
});

test('bad wallet and bad block are UserErrors', async () => {
  const w = makeWorld();
  await assert.rejects(askPortfolio({ chain: w.chain, rpc: w.rpc, wallet: '0x12', question: 'What do I hold?' }), /wallet must be a 0x address/);
  for (const block of [0, -1, 1.5, w.world.head - 1, w.world.head + 10]) await assert.rejects(ask(w, 'What do I hold?', { block }), /block must be a whole number from 1 to/);
});

test('the result is plain JSON (no BigInt), with amounts as strings', async () => {
  const r = await ask(makeWorld(), 'What do I hold?');
  const text = JSON.stringify(r);
  assert.ok(text.length > 1000);
  assert.equal(typeof r.positions[0].amountRaw, 'string');
});

test('every figure in every answer has a source with a contract (or the multicall for a native balance), a call and the block', async () => {
  for (const q of SUPPORTED_QUESTIONS) {
    const r = await ask(makeWorld(), q);
    for (const f of r.answer.figures) {
      assert.ok(f.sources.length >= 1, `${q}: ${f.label} has no source`);
      for (const n of f.sources) {
        const s = r.answer.sources.find((x) => x.n === n);
        assert.ok(s.call && s.block && s.tool, `${q}: source ${n}`);
      }
    }
  }
});

test('the vault share count and value formatting are exact', () => {
  assert.equal(fmtUnits(1736877466879n, 6), '1,736,877.466879');
  assert.equal(fmtUsd(1736544913000n), '$1,736,544.91');
  assert.equal(fmtUsd(-5_000_000n), '-$5.00');
});

test('a refusal reads nothing from the chain: the question is answered without a single call', async () => {
  for (const q of ['How much do I have on Aave?', 'How much have I earned so far?', 'Should I buy more PROS?']) {
    const w = makeWorld();
    const r = await ask(w, q);
    assert.equal(w.calls.length, 0, q);
    assert.equal(r.chainCalls, 0);
    assert.equal(r.block, null);
    assert.equal(r.answer.known, false);
  }
  await assert.rejects(askPortfolio({ chain: makeWorld().chain, rpc: makeWorld().rpc, wallet: '0x12', question: 'How much do I have on Aave?' }), /wallet must be a 0x address/);
});
