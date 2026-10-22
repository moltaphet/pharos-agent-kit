#!/usr/bin/env node
// Run the vault saga on a local fork of Pharos mainnet (real contracts, no real funds).
//   node skills/pharos-saga-executor/scripts/saga.mjs [--scenario success|failure|both] [--out file.json]
// Needs Foundry (anvil) installed. Run it from the repository root.
import { writeFile } from 'node:fs/promises';
import { runSaga, withInjectedFault } from '../../../lib/saga.js';
import { VAULT, ZERO, vaultSaga } from '../../../lib/saga-scenario.js';
import { forkIO, startFork } from '../../../lib/saga-fork.js';
import { USDC } from '../../../lib/protocols.js';
import { SELECTORS, encodeAddress } from '../../../lib/abi.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const scenarioArg = arg('scenario', 'both');
const out = arg('out');
const AMOUNT = 100_000_000n; // 100 USDC (6 decimals)
const MORPHO = '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb'; // holds USDC; impersonated on the fork only

const runs = [];
let port = 8590;
try {
  for (const scenario of scenarioArg === 'both' ? ['success', 'failure'] : [scenarioArg]) {
    // Every scenario starts from a fresh fork, so each begins from identical state.
    const fork = await startFork({ port: port++ });
    try {
      const io = forkIO(fork.url);
      const [account, treasury] = await io.accounts();
      await io.setBalance(MORPHO, 10n ** 18n);
      await io.impersonate(MORPHO);
      await io.send({ from: MORPHO, to: USDC, data: '0xa9059cbb' + encodeAddress(account) + (1_000_000_000n).toString(16).padStart(64, '0') }); // 1,000 USDC for the test account
      const failStep3 = scenario === 'failure';
      const saga = vaultSaga({ io, account, treasury, amount: AMOUNT, failStep3 });
      // The success run also shows the retry policy: step 2's first send hits an (injected) transient error.
      const exec = scenario === 'success' ? withInjectedFault(io, { match: (tx) => tx.to === VAULT && tx.data.startsWith('0x6e553f65'), times: 1 }) : io;
      const result = await runSaga({ name: `vault-saga:${scenario}`, steps: saga.steps, exec, policy: { baseDelayMs: 300 } });
      result.finalCheck = await saga.finalCheck(result.status);
      result.injectedFault = scenario === 'success' ? 'the first deposit send fails with "replacement transaction underpriced (injected fault)"' : null;
      result.forced = failStep3 ? `step 3 sends the shares to ${ZERO}` : null;
      runs.push(result);
      const flat = (e) => `${String(e.t).padStart(5)} ms  ${e.event.padEnd(26)} ${[e.step, e.attempt && `attempt ${e.attempt}`, e.error, e.txHash && e.txHash.slice(0, 14) + '…', e.why].filter(Boolean).join('  ')}`;
      console.log(`\n=== ${result.name} → ${result.status.toUpperCase()} ===`);
      result.log.forEach((e) => console.log(flat(e)));
      const f = result.finalCheck;
      console.log(`final state: USDC ${f.usdc} (started ${f.usdcBefore}, spent ${f.spent}), account shares ${f.accountShares}, allowance ${f.allowance}, treasury shares ${f.treasuryShares}\nexpected: ${f.expected} → ${f.clean ? 'AS EXPECTED' : 'NOT AS EXPECTED'}`);
    } finally {
      fork.stop();
    }
  }
  const record = { recordedAt: new Date().toISOString(), network: 'local anvil fork of Pharos mainnet (chain 1672)', vault: VAULT, runs: JSON.parse(JSON.stringify(runs, (k, v) => (typeof v === 'bigint' ? v.toString() : v))) };
  if (out) await writeFile(out, JSON.stringify(record, null, 2) + '\n');
  process.exitCode = runs.every((r) => r.finalCheck.clean) ? 0 : 1;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
