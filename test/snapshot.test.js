import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot, UserError } from '../lib/snapshot.js';
import { UnstableReadError } from '../lib/stable.js';

const CODE = '0x6080604052';
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

// Count of calls in an aggregate3 request, so the fake can answer with the right number of rows.
const callsIn = (data) => Number(BigInt('0x' + data.slice(2 + 8 + 64, 2 + 8 + 128)));
const aggregateFailures = (n) => {
  const row = word(0) + word(0x40) + word(0); // success=false, data=0x
  let cursor = n * 32;
  const offsets = Array.from({ length: n }, () => { const o = word(cursor); cursor += row.length / 2; return o; });
  return '0x' + word(0x20) + word(n) + offsets.join('') + row.repeat(n);
};

// heads: the block numbers get_block_number reports in turn. codeAt(block|'latest') -> hex.
function fake({ heads, codeAt }) {
  const calls = [];
  let h = 0;
  return {
    calls,
    async callTool(name, args = {}) {
      calls.push({ name, block: args.block });
      if (name === 'get_block_number') return { blockNumber: String(heads[Math.min(h++, heads.length - 1)]) };
      if (name === 'get_chain_info') return { name: 'Pharos', chainId: 1672 };
      if (name === 'get_block') return { number: '0x' + args.block.toString(16), timestamp: '0x65' };
      if (name === 'get_code') return { result: codeAt(args.block ?? 'latest') };
      if (name === 'eth_call') return { result: aggregateFailures(callsIn(args.transaction.data)) };
      throw new Error(`unexpected ${name}`);
    },
  };
}
const latestChecks = (c) => c.calls.filter((x) => x.name === 'get_code' && x.block === undefined).length;

test('a lagging node says "no code" for a real contract: re-pin and read again instead of calling it a wallet', async () => {
  const c = fake({ heads: [1000, 1010], codeAt: (b) => (b === 998 ? '0x' : CODE) });
  const s = await readSnapshot(c, { address: '0xabc0000000000000000000000000000000000001' });
  assert.equal(s.block.number, 1008); // the second pin, two behind the new head
  assert.equal(latestChecks(c) >= 1, true);
});

test('a real wallet (no code at the pinned block and none at the latest) is still reported as one', async () => {
  const c = fake({ heads: [1000], codeAt: () => '0x' });
  await assert.rejects(readSnapshot(c, { address: '0xabc0000000000000000000000000000000000001' }), (e) => e instanceof UserError && /no contract code/.test(e.message));
  assert.equal(latestChecks(c), 1);
});

test('a node that keeps saying "no code" at every pinned block while the latest has code: refuses, never guesses', async () => {
  const c = fake({ heads: [1000, 1010, 1020], codeAt: (b) => (b === 'latest' ? CODE : '0x') });
  await assert.rejects(readSnapshot(c, { address: '0xabc0000000000000000000000000000000000001' }), UnstableReadError);
});

test('an explicit historical block is taken as given: empty code there is a plain answer, with no latest-block check', async () => {
  const c = fake({ heads: [1000], codeAt: () => '0x' });
  await assert.rejects(readSnapshot(c, { address: '0xabc0000000000000000000000000000000000001', block: 500 }), /no contract code/);
  assert.equal(latestChecks(c), 0);
});

test('owner/holder labelled "wallet" only after the latest block also has no code', async () => {
  const holder = '0xdef0000000000000000000000000000000000002';
  const c = fake({ heads: [1000], codeAt: (b) => (b === 'latest' ? CODE : b === 998 ? '0x' : CODE) });
  // contract has code at 998 only for itself? make the holder the one with empty code at 998 but code at latest
  const c2 = {
    ...c,
    async callTool(name, args = {}) {
      if (name === 'get_code') return { result: args.address === holder ? (args.block === undefined ? CODE : '0x') : CODE };
      return c.callTool(name, args);
    },
  };
  const s = await readSnapshot(c2, { address: '0xabc0000000000000000000000000000000000001', holders: [holder] });
  assert.equal(s.balances[0].description, 'unlabelled contract');
});
