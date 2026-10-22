import test from 'node:test';
import assert from 'node:assert/strict';
import { Dedupe, decodeLog, logKey, pageRange } from '../lib/watch.js';

// A real USDC Transfer log from Pharos mainnet (block 0x13f0d55).
const transferLog = {
  address: '0xc879c018db60520f4355c26ed1a6d572cdac1815',
  blockNumber: '0x13f0d55',
  blockTimestamp: '0x6ad9bdf2',
  data: '0x0000000000000000000000000000000000000000000000000000000000e66860',
  logIndex: '0x4',
  removed: false,
  topics: [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0x000000000000000000000000768b959191ce5876cabbbc014a08d72615bdde54',
    '0x000000000000000000000000cf7b94e4b02e23286af7444ccea0c782da06ad50',
  ],
  transactionHash: '0x9b77d28808227fd5878f67e25515c9f852d2b8113631b6cb12836228021838ef',
};

test('decodeLog turns a Transfer into readable fields', () => {
  const ev = decodeLog(transferLog, { symbol: 'USDC', decimals: 6 });
  assert.equal(ev.event, 'Transfer');
  assert.equal(ev.from, '0x768b959191ce5876cabbbc014a08d72615bdde54');
  assert.equal(ev.to, '0xcf7b94e4b02e23286af7444ccea0c782da06ad50');
  assert.equal(ev.amount.raw, '15100000'); // 0xe66860
  assert.equal(ev.amount.formatted, '15.1'); // 6 decimals applied
  assert.equal(ev.amount.symbol, 'USDC');
  assert.equal(ev.block, 20909397); // 0x13f0d55
  assert.equal(ev.timestamp, 1792654834); // 0x6ad9bdf2
  assert.equal(ev.logIndex, 4);
  assert.equal(ev.txHash, transferLog.transactionHash);
});

test('decodeLog falls back to the raw amount when token decimals are unknown', () => {
  const ev = decodeLog(transferLog, null);
  assert.equal(ev.amount.formatted, '15100000');
  assert.equal(ev.amount.symbol, null);
});

test('decodeLog treats a 4-topic Transfer as an NFT transfer', () => {
  const nft = { ...transferLog, data: '0x', topics: [...transferLog.topics, '0x' + '0'.repeat(63) + '7'] };
  const ev = decodeLog(nft);
  assert.equal(ev.tokenId, '7');
  assert.equal(ev.amount, undefined);
});

test('decodeLog keeps unknown events raw instead of guessing', () => {
  const ev = decodeLog({ ...transferLog, topics: ['0x' + 'ab'.repeat(32)] });
  assert.equal(ev.event, 'Unknown');
  assert.equal(ev.data, transferLog.data);
});

test('Dedupe reports each log once, even if fetched again', () => {
  const d = new Dedupe();
  assert.equal(d.isNew(transferLog), true);
  assert.equal(d.isNew({ ...transferLog }), false);
  assert.equal(d.isNew({ ...transferLog, logIndex: '0x5' }), true);
  assert.notEqual(logKey(transferLog), logKey({ ...transferLog, logIndex: '0x5' }));
});

test('Dedupe.prune forgets only old entries', () => {
  const d = new Dedupe(100);
  d.isNew(transferLog); // block 20,909,397
  d.prune(20909397 + 50);
  assert.equal(d.isNew(transferLog), false);
  d.prune(20909397 + 500);
  assert.equal(d.isNew(transferLog), true);
});

test('pageRange splits ranges into windows of at most 1000 blocks', () => {
  assert.deepEqual([...pageRange(1, 2500)], [[1, 1000], [1001, 2000], [2001, 2500]]);
  assert.deepEqual([...pageRange(5, 5)], [[5, 5]]);
  assert.deepEqual([...pageRange(10, 9)], []);
});
