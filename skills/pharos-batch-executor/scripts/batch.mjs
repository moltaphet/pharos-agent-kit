#!/usr/bin/env node
// Plan a batch against the live chain (read-only), or --fork to really execute it on a local
// fork of Pharos mainnet and compare with sending the actions one by one.
//   node skills/pharos-batch-executor/scripts/batch.mjs --from 0x… --actions actions.json [--on-failure exclude|abort] [--fork] [--out run.json] [--json]
// Run from the repository root. Exit code: 0 ready, 10 nothing to send, 1 error.
import { readFile, writeFile } from 'node:fs/promises';
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { parseActions, planBatch } from '../../../lib/tasks/batch-executor.js';
import { encodeAggregate3Value } from '../../../lib/multicall.js';
import { MULTICALL3 } from '../../../lib/protocols.js';
import { forkIO, startFork } from '../../../lib/saga-fork.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const from = arg('from');
const file = arg('actions');
if (!from || !file) { console.error('Usage: batch.mjs --from 0x… --actions actions.json [--on-failure exclude|abort] [--fork] [--out run.json]'); process.exit(1); }
const raw = JSON.parse(await readFile(file, 'utf8'));
const chain = new McpClient(PHAROS_CHAIN_MCP);
const hex = (v) => '0x' + v.toString(16);
const f = (n) => Number(n).toLocaleString('en-US');
let fork;
try {
  const plan = await planBatch({ chain }, { from, actions: raw, onFailure: arg('on-failure', 'exclude') });
  const record = { recordedAt: new Date().toISOString(), plan: { ...plan, batch: plan.batch && { ...plan.batch, data: plan.batch.data.slice(0, 74) + '…', tx: undefined } } };
  console.log(`\nPLAN @ block ${plan.block.toLocaleString('en-US')}  ·  ${plan.summary}`);
  for (const a of plan.actions) console.log(`  ${a.id}  ${a.status === 'ok' ? (a.included ? 'IN ' : 'out') : 'FAILS'}  ${a.valuePros.padStart(8)} PROS → ${a.to.slice(0, 10)}…  ${a.soloGas ? `solo gas ${f(a.soloGas)}` : a.reason}`);
  if (plan.comparison) console.log(`  1 transaction instead of ${plan.comparison.transactionsBefore}: estimated gas ${f(plan.comparison.soloGasTotal)} → ${f(plan.comparison.batchGas)} (saves ${f(plan.comparison.gasSaved)}, ${plan.comparison.gasSavedPct.toFixed(1)}%)`);
  for (const x of plan.excluded) console.log(`  left out ${x.id}: ${x.why}`);

  if (has('fork') && plan.batch?.tx) {
    fork = await startFork({ port: 8602 });
    const io = forkIO(fork.url);
    await io.setBalance(from, 10n ** 18n);
    await io.impersonate(from);
    const actions = parseActions(raw).filter((a) => plan.included.includes(a.id));
    const balances = async () => Object.fromEntries(await Promise.all(parseActions(raw).map(async (a) => [a.id, BigInt(await io.rpc('eth_getBalance', [a.to, 'latest']))])));
    const base = await balances();
    const snap = await io.rpc('evm_snapshot');
    // A: the actions one by one
    let soloGas = 0;
    for (const a of actions) soloGas += (await io.receipt(await io.send({ from, to: a.to, data: a.data, value: a.value }))).gasUsed;
    await io.rpc('evm_revert', [snap]);
    // B: the batch
    const r = await io.receipt(await io.send(plan.batch.tx));
    const after = await balances();
    const moved = Object.fromEntries(Object.keys(base).map((id) => [id, (after[id] - base[id]).toString()]));
    console.log(`\nFORK (real EVM, throwaway): one by one used ${f(soloGas)} gas; the batch used ${f(r.gasUsed)} gas (${r.status}); saved ${f(soloGas - r.gasUsed)} (${(((soloGas - r.gasUsed) / soloGas) * 100).toFixed(1)}%)`);
    for (const id of Object.keys(moved)) console.log(`  ${id} received ${moved[id]} wei${plan.included.includes(id) ? '' : '   (left out of the batch, as planned)'}`);
    // C: what if a failing action is forced into the batch? All or nothing: the whole batch reverts.
    const state = await io.rpc('evm_snapshot');
    const forced = parseActions(raw).map((a) => ({ target: a.to, data: a.data, value: a.value, allowFailure: false }));
    const forcedTotal = forced.reduce((s, c) => s + c.value, 0n);
    let atomic;
    const beforeForced = await balances();
    try {
      // Explicit gas, so the node runs it instead of failing at estimation: we want the revert to happen inside the EVM.
      const h = await io.send({ from, to: MULTICALL3, data: encodeAggregate3Value(forced), value: hex(forcedTotal), gas: 3_000_000 });
      const rc = await io.receipt(h);
      atomic = { reverted: rc.status !== 'success', reason: rc.reason ?? null };
    } catch (err) {
      atomic = { reverted: true, reason: err.message };
    }
    const afterForced = await balances();
    const unchanged = Object.keys(beforeForced).every((id) => afterForced[id] === beforeForced[id]);
    await io.rpc('evm_revert', [state]);
    console.log(`  forcing the failing action into the batch: ${atomic.reverted ? `the WHOLE batch reverts (${atomic.reason ?? 'no reason given'}); no recipient balance changed: ${unchanged ? 'yes' : 'NO'}` : 'it did not revert (unexpected)'}`);
    record.fork = { network: 'local anvil fork of Pharos mainnet', soloGasUsed: soloGas, batchGasUsed: r.gasUsed, status: r.status, saved: soloGas - r.gasUsed, savedPct: ((soloGas - r.gasUsed) / soloGas) * 100, received: moved, forcedFailingAction: { ...atomic, recipientsUnchanged: unchanged } };
  }
  if (arg('out')) await writeFile(arg('out'), JSON.stringify(record, null, 2) + '\n');
  if (has('json')) console.log(JSON.stringify(record, null, 2));
  process.exitCode = plan.verdict === 'ready' ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  fork?.stop();
  await chain.close();
}
