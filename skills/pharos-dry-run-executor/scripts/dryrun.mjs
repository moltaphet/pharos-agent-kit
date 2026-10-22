#!/usr/bin/env node
// Simulate a transaction before sending it. Read-only unless --fork is used (then it runs on a
// throwaway local fork of Pharos mainnet, never on the real chain).
//   node skills/pharos-dry-run-executor/scripts/dryrun.mjs --from 0x… --to 0x… [--data 0x…] [--value <wei>]
//        [--execute] [--fork] [--watch 0xTOKEN,0xTOKEN] [--json]
// Exit code: 0 = simulation passed, 10 = blocked (simulation failed), 1 = error. Run from the repo root.
import { McpClient, PHAROS_CHAIN_MCP } from '../../../lib/mcp.js';
import { dryRun, guardedExecute } from '../../../lib/tasks/dry-run-executor.js';
import { forkIO, startFork } from '../../../lib/saga-fork.js';
import { SELECTORS, decodeUint, encodeAddress, formatUnits } from '../../../lib/abi.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const tx = { from: arg('from'), to: arg('to'), data: arg('data', '0x'), value: arg('value', '0') };
const watch = (arg('watch', '') || '').split(',').filter(Boolean);
if (!tx.from || !tx.to) {
  console.error('Usage: dryrun.mjs --from 0x… --to 0x… [--data 0x…] [--value wei] [--execute] [--fork] [--watch tokens] [--json]');
  process.exit(1);
}

const chain = new McpClient(PHAROS_CHAIN_MCP);
let fork;
try {
  let result;
  if (has('fork')) {
    fork = await startFork({ port: 8601 });
    const io = forkIO(fork.url);
    await io.setBalance(tx.from, 10n ** 18n);
    await io.impersonate(tx.from);
    const balances = async () => Object.fromEntries(await Promise.all(watch.map(async (t) => [t, decodeUint(await io.call(t, SELECTORS.balanceOf + encodeAddress(tx.from)))])));
    const before = await balances();
    // Simulate on the real chain first; only a passing simulation reaches the fork's executor.
    result = await guardedExecute({ chain, exec: { send: io.send } }, tx);
    if (result.executed) {
      result.receipt = await io.receipt(result.sent);
      const after = await balances();
      result.diff = Object.keys(before).map((t) => ({ token: t, before: before[t].toString(), after: after[t].toString(), change: (after[t] - before[t]).toString() }));
    }
  } else if (has('execute')) {
    result = await guardedExecute({ chain, exec: { send: async () => { throw new Error('no executor: this skill never holds a key; hand the transaction to your own signer'); } } }, tx).catch((e) => ({ executed: false, blocked: false, error: e.message, report: null }));
    result.report ??= await dryRun({ chain }, tx);
  } else {
    result = { report: await dryRun({ chain }, tx) };
  }
  const r = result.report;
  if (has('json')) console.log(JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  else {
    console.log(`\nDRY RUN  ·  block ${r.block.toLocaleString('en-US')}  ·  ${r.verdict.toUpperCase()}`);
    console.log(`  ${r.summary}`);
    if (r.revert) console.log(`  revert: ${r.revert.name ?? r.revert.kind}: ${r.revert.message}`);
    if (r.gas) console.log(`  gas: ${r.gas.units.toLocaleString('en-US')} units (suggest a limit of ${r.gas.suggestedLimit.toLocaleString('en-US')}) at ${r.gas.priceGwei} gwei = ${r.gas.costPros} PROS`);
    console.log(`  outcome: ${r.outcome.summary}`);
    for (const row of r.outcome.rows) console.log(`    ${row.label}: ${row.before}  →  ${row.after}`);
    if (result.blocked) console.log(`\n  EXECUTION BLOCKED: nothing was sent.`);
    if (result.executed) console.log(`\n  EXECUTED on the local fork: ${result.sent}  (${result.receipt.status}, gas used ${result.receipt.gasUsed})`);
    for (const d of result.diff ?? []) console.log(`    fork state diff ${d.token.slice(0, 8)}…: ${d.before} → ${d.after} (${d.change})`);
    if (result.error) console.log(`\n  ${result.error}`);
  }
  process.exitCode = r.verdict === 'go' ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  fork?.stop();
  await chain.close();
}
