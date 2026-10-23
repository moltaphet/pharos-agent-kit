import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SELECTORS, SIGNATURES, addr, bool, calldata, int, priceFromSqrtX96, uint, v2InputToReach, v2Out } from '../lib/arb-fork.js';
import { forkChain } from '../lib/arb-fork.js';

const report = JSON.parse(readFileSync(new URL('../reports/arbitrage-runs.json', import.meta.url), 'utf8'));
const scenario = (id) => report.scenarios.find((s) => s.id === id);

let hasCast = true;
try { execFileSync('cast', ['--version'], { stdio: 'ignore' }); } catch { hasCast = false; }

test('every hard-coded selector matches `cast sig` of its signature', { skip: !hasCast && 'cast not installed' }, () => {
  for (const [name, sig] of Object.entries(SIGNATURES)) assert.equal(SELECTORS[name], execFileSync('cast', ['sig', sig], { encoding: 'utf8' }).trim(), name);
});

test('ABI word encoders: unsigned, negative ticks in two\'s complement, bool, address', () => {
  assert.equal(uint(255), 'ff'.padStart(64, '0'));
  assert.equal(int(-60), 'f'.repeat(62) + 'c4');
  assert.equal(int(-1), 'f'.repeat(64));
  assert.equal(bool(true), '1'.padStart(64, '0'));
  assert.equal(addr('0x52c48d4213107b20bc583832b0d951fb9ca8f0b0'), '000000000000000000000000' + '52c48d4213107b20bc583832b0d951fb9ca8f0b0');
  assert.equal(calldata('v2Swap', uint(1)), SELECTORS.v2Swap + uint(1));
});

test('v2Out is the pair\'s own 0.3% formula', () => {
  assert.equal(v2Out(10n ** 18n, 10n ** 21n, 10n ** 21n), 996006981039903216n); // same value amm.test.js checks independently
});

test('v2InputToReach lands the pool on the target price once the fee stays in the pool', () => {
  const rIn = 5000n * 10n ** 18n;
  const rOut = 2000n * 10n ** 18n;
  const target = 0.3; // out per in, below the current 0.4
  const a = v2InputToReach(rIn, rOut, target);
  const after = Number(rOut - v2Out(a, rIn, rOut)) / Number(rIn + a);
  assert.ok(Math.abs(after / target - 1) < 1e-9, `price after ${after}`);
  assert.equal(v2InputToReach(rIn, rOut, 0.5), 0n); // already below the target: nothing to do
});

test('priceFromSqrtX96', () => {
  assert.equal(priceFromSqrtX96(2n ** 96n), 1);
  assert.ok(Math.abs(priceFromSqrtX96(2n ** 97n) - 4) < 1e-12);
});

test('forkChain speaks the three tools the scanner needs and nothing else', async () => {
  const io = { rpc: async (m) => ({ eth_blockNumber: '0x10', eth_gasPrice: '0x3b9aca00' })[m] };
  const chain = forkChain(io);
  assert.equal((await chain.callTool('get_block_number')).blockNumber, 16);
  assert.deepEqual(await chain.callTool('get_gas_price'), { gasPriceWei: '1000000000', gasPriceGwei: '1' });
  await assert.rejects(chain.callTool('get_logs'), /does not implement/);
});

// ---- the recorded run ---------------------------------------------------------------------
test('recorded run: honest labels, both scenarios, fork provenance', () => {
  assert.equal(report.network.chainId, 1672);
  assert.ok(report.honesty.some((h) => /dust/.test(h)) && report.honesty.some((h) => /ourselves/.test(h)));
  assert.deepEqual(report.scenarios.map((s) => s.id), ['profitable', 'marginal']);
});

test('recorded run: baseline had no gap, so the scanner had nothing to find', () => {
  for (const s of report.scenarios) {
    assert.equal(s.baseline.decision, 'skip');
    assert.ok(Math.abs(s.baseline.grossSpreadPct) < 0.01, `baseline spread ${s.baseline.grossSpreadPct}%`);
  }
});

test('recorded run: the scanner acted on the real gap, and the real EVM paid out what it predicted', () => {
  const a = scenario('profitable');
  assert.equal(a.scan.decision, 'execute-simulated');
  assert.equal(a.execution.status, 'success');
  assert.ok(a.execution.actualGrossProfit > 1, 'a profit large enough to be unmistakable');
  assert.ok(a.execution.predictionErrorPct < 1e-4, `model vs EVM differ by ${a.execution.predictionErrorPct}%`);
  assert.ok(a.execution.actualNet > 0 && a.execution.actualNet < a.execution.actualGrossProfit, 'gas is subtracted');
  assert.equal(a.rescan.decision, 'skip'); // the trade used up the edge it could exploit
});

test('recorded run: the trade the scanner refused really lost money, as the model said', () => {
  const b = scenario('marginal');
  assert.equal(b.scan.decision, 'skip');
  assert.equal(b.execution.forced, true);
  assert.equal(b.execution.status, 'success');
  assert.ok(b.execution.actualGrossProfit < 0 && b.execution.actualNet < b.execution.actualGrossProfit);
  assert.ok(Math.abs(b.execution.actualGrossProfit - b.execution.predictedGrossProfit) / Math.abs(b.execution.predictedGrossProfit) < 1e-4);
});

test('recorded run: the gas assumption is reported against the measured gas', () => {
  for (const s of report.scenarios) assert.ok(s.execution.gasUsed > 100_000 && s.execution.gasUsed < s.execution.predictedGasUnits, `${s.id} used ${s.execution.gasUsed}`);
});

import { createHash } from 'node:crypto';
test('the committed ArbLab bytecode was built from the current source (so the Sandbox runs what the repository shows)', () => {
  const art = JSON.parse(readFileSync(new URL('../contracts/ArbLab.bytecode.json', import.meta.url), 'utf8'));
  const src = readFileSync(new URL('../contracts/ArbLab.sol', import.meta.url));
  assert.equal(art.sourceSha256, createHash('sha256').update(src).digest('hex'), 'contracts/ArbLab.sol changed: run node scripts/export-lab-bytecode.mjs');
  assert.match(art.bytecode, /^0x[0-9a-f]{1000,}$/);
});
