import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanWhales, validateConfig, TRANSFER_TOPIC } from '../lib/whales.js';
import { decodeAggregate3Input, encodeAggregate3Output } from '../lib/multicall.js';
import { MULTICALL3 } from '../lib/protocols.js';
import { content } from '../public/js/tasks/whale-watching-agent.js';

const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const WPROS = '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0';
const ADDR = (n) => '0x' + n.toString(16).padStart(40, '0');
const [W1, W2, W3, W4, W5, OUT, CONTRACT] = [1, 2, 3, 4, 5, 99, 100].map(ADDR);
const topic = (a) => '0x' + a.slice(2).padStart(64, '0');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const hash = (n) => '0x' + n.toString(16).padStart(64, '0');
const log = (token, block, n, from, to, value) => ({ address: token, topics: [TRANSFER_TOPIC, topic(from), topic(to)], data: '0x' + word(value), blockNumber: '0x' + block.toString(16), transactionHash: hash(n), logIndex: '0x' + n.toString(16) });
const usdc = (n) => BigInt(n) * 10n ** 6n;
const wpros = (n) => BigInt(n) * 10n ** 18n;

// balances[block-or-'*'][token][address]
function world({ logs = [], before = {}, after = {}, boundary = 1000 } = {}) {
  const rpc = async (method, params) => {
    if (method === 'eth_blockNumber') return '0x' + (5000).toString(16);
    if (method === 'eth_getCode') return params[0] === CONTRACT ? '0x6080' : '0x';
    if (method === 'eth_getLogs') {
      const [f] = params; const from = Number(f.fromBlock); const to = Number(f.toBlock);
      assert.ok(to - from + 1 <= 1000);
      const idx = f.topics[1] === null || (Array.isArray(f.topics[2])) ? 2 : 1; // [T, null, [..]] is "to"; [T, [..]] is "from"
      const set = new Set((f.topics[idx] ?? []).map((t) => '0x' + t.slice(26)));
      return logs.filter((l) => l.address === f.address && Number(l.blockNumber) >= from && Number(l.blockNumber) <= to && set.has('0x' + l.topics[idx].slice(26)));
    }
    if (method === 'eth_call') {
      const [tx, block] = params;
      if (tx.data === '0x50d25bcd') return '0x' + word(5n * 10n ** 17n); // PROS = $0.50
      assert.equal(tx.to, MULTICALL3);
      const table = Number(block) < boundary ? before : after;
      return encodeAggregate3Output(decodeAggregate3Input(tx.data).map((c) => {
        const who = '0x' + c.data.slice(-40);
        const sym = c.target.toLowerCase() === USDC ? 'USDC' : c.target.toLowerCase() === WPROS ? 'WPROS' : 'PROS';
        return { success: true, data: '0x' + word(table[sym]?.[who] ?? 0n) };
      }));
    }
    throw new Error(method);
  };
  return rpc;
}
const cfg = (extra = {}) => validateConfig({ watch: [W1, W2, W3, W4, W5].map((a, i) => ({ address: a, label: `W${i + 1}` })), thresholds: { USDC: '1000', WPROS: '1000' }, ...extra });

test('config: at least one address, thresholds required, bad input refused', () => {
  for (const bad of [null, { watch: [], thresholds: { USDC: '1' } }, { watch: [W1], thresholds: {} }, { watch: ['0x1'], thresholds: { USDC: '1' } }, { watch: [W1, W1], thresholds: { USDC: '1' } },
    { watch: [W1], thresholds: { DOGE: '1' } }, { watch: [W1], thresholds: { USDC: '0' } }, { watch: [W1], thresholds: { USDC: '1.0000001' } }, { watch: [W1], thresholds: { USDC: '1' }, usdThreshold: '0' },
    { watch: Array.from({ length: 26 }, (_, i) => ADDR(i + 1)), thresholds: { USDC: '1' } }]) assert.throws(() => validateConfig(bad));
  assert.equal(cfg().watch.length, 5);
});

test('moves must cross the per-token threshold, or the dollar value', async () => {
  const logs = [log(USDC, 100, 1, W1, OUT, usdc(999)), log(USDC, 101, 2, W1, OUT, usdc(1000)), log(WPROS, 102, 3, W2, OUT, wpros(900)), log(WPROS, 103, 4, OUT, ADDR(98), wpros(5000))];
  const rpc = world({ logs });
  const a = await scanWhales({ rpc, config: cfg(), from: 10, to: 2000 });
  assert.deepEqual(a.moves.map((m) => m.key), [`${hash(2)}:2`], '999 USDC is below 1,000; 900 WPROS is below 1,000; an unwatched pair is never reported');
  const b = await scanWhales({ rpc, config: cfg({ usdThreshold: '400' }), from: 10, to: 2000 });
  assert.deepEqual(b.moves.map((m) => m.key), [`${hash(1)}:1`, `${hash(2)}:2`, `${hash(3)}:3`], 'with a $400 rule, 900 WPROS (= $450) and 999 USDC qualify');
  assert.equal(b.moves.find((m) => m.token === 'WPROS').trigger, 'usd');
});

test('each move says what moved, how much, to whom (labelled), and why it matters', async () => {
  const logs = [log(USDC, 100, 1, W1, W2, usdc(5000)), log(USDC, 101, 2, W3, CONTRACT, usdc(2000)), log(USDC, 102, 3, '0x' + '0'.repeat(40), W4, usdc(3000)), log(USDC, 103, 4, W5, OUT, usdc(6000))];
  const before = { USDC: { [W1]: usdc(10000), [W2]: usdc(1), [W3]: usdc(20000), [W5]: usdc(12000) } };
  const r = await scanWhales({ rpc: world({ logs, before, boundary: 50 }), config: cfg(), from: 10, to: 2000 });
  const by = Object.fromEntries(r.moves.map((m) => [m.key.split(':')[1], m]));
  assert.match(by[1].what, /W1 sent 5,000 USDC \(about \$5,000\) to W2/);
  assert.match(by[1].why.join(' '), /Both sides are on your watchlist/);
  assert.match(by[1].why.join(' '), /50% of the USDC/);
  assert.equal(by[1].direction, 'between watched');
  assert.match(by[2].why.join(' '), /smart contract that is not labelled/);
  assert.match(by[3].why.join(' '), /minted/);
  assert.match(by[3].why.join(' '), /new position/);
  assert.match(by[4].why.join(' '), /50% of the USDC/);
  assert.match(by[4].why.join(' '), /ordinary unlabelled wallet/);
  assert.match(by[4].link, /pharosscan\.xyz\/tx\//);
});

test('positions: new, exit, increase, decrease from the balances at the two ends', async () => {
  const before = { USDC: { [W1]: 0n, [W2]: usdc(5000), [W3]: usdc(5000), [W4]: usdc(5000), [W5]: usdc(500) } };
  const after = { USDC: { [W1]: usdc(4000), [W2]: 0n, [W3]: usdc(9000), [W4]: usdc(1000), [W5]: usdc(600) } };
  const r = await scanWhales({ rpc: world({ before, after }), config: cfg(), from: 10, to: 2000 });
  const kind = Object.fromEntries(r.positions.filter((p) => p.token === 'USDC').map((p) => [p.label, [p.kind, p.significant]]));
  assert.deepEqual(kind, { W1: ['new position', true], W2: ['exit', true], W3: ['increase', true], W4: ['decrease', true], W5: ['increase', false] });
});

test('the summary covers every watched address and names the biggest move', async () => {
  const logs = [log(USDC, 100, 1, W1, OUT, usdc(5000)), log(USDC, 101, 2, OUT, W2, usdc(7000)), log(USDC, 102, 3, OUT, W2, usdc(2000))];
  const r = await scanWhales({ rpc: world({ logs }), config: cfg(), from: 10, to: 2000 });
  const s = r.summary;
  assert.equal(s.perWallet.length, 5);
  assert.equal(s.significantMoves, 3);
  assert.equal(s.walletsActive, 2);
  assert.equal(s.perWallet.find((w) => w.label === 'W2').inUsd, String(usdc(9000)));
  assert.equal(s.perWallet.find((w) => w.label === 'W1').outUsd, String(usdc(5000)));
  assert.match(s.biggest.what, /7,000 USDC/);
  assert.equal(s.perWallet.find((w) => w.label === 'W3').active, false);
});

test('ranges are bounded and checked; native PROS is a net balance change and says so', async () => {
  const rpc = world({ before: { PROS: { [W1]: wpros(10) } }, after: { PROS: { [W1]: wpros(5000) } }, boundary: 50 });
  const config = validateConfig({ watch: [{ address: W1, label: 'W1' }], thresholds: { PROS: '1000' } });
  const r = await scanWhales({ rpc, config, from: 10, to: 100 });
  const p = r.positions[0];
  assert.equal(p.kind, 'increase');
  assert.match(p.note, /includes gas/);
  for (const [from, to] of [[0, 5], [10, 5], [1, 3000], [10, 6000]]) await assert.rejects(scanWhales({ rpc, config, from, to }));
});

test('a long range is read in windows of at most 1,000 blocks', async () => {
  let windows = 0;
  const inner = world();
  const rpc = async (m, p) => { if (m === 'eth_getLogs') windows++; return inner(m, p); };
  await scanWhales({ rpc, config: cfg(), from: 1, to: 2000 });
  assert.equal(windows, 2 * 2 * 2, 'two windows × (from, to) × two tokens');
});

test('the recorded mainnet scan agrees with its own claims', () => {
  const r = JSON.parse(readFileSync(new URL('../reports/whales-run.json', import.meta.url), 'utf8'));
  assert.ok(r.watchlist.length >= 5);
  const [d, st] = r.runs;
  assert.ok(d.summary.significantMoves > st.summary.significantMoves, 'stricter thresholds report fewer moves');
  assert.equal(d.moves.length, d.summary.significantMoves);
  assert.equal(r.summary.defaultMoves, d.summary.significantMoves);
  assert.ok(d.moves.every((m) => m.what && m.why && m.link.startsWith('https://www.pharosscan.xyz/tx/')));
  assert.equal(d.summary.perWallet.length, r.watchlist.length);
});

test('task page', () => {
  assert.equal(content.evidence.length, 4);
  assert.doesNotMatch(JSON.stringify(content), /simulated|mock/i);
});
