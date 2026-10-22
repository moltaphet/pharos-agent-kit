#!/usr/bin/env node
// Run the vault saga on a local fork of Pharos mainnet (real contracts, real EVM, no real funds).
//   node skills/pharos-saga-executor/scripts/saga.mjs [--scenario success|failure|both|plain|retry|stuck]
//        [--max-attempts 1..5] [--out file.json] [--stream]
// Needs Foundry (anvil) installed. Run it from the repository root.
//
//   both     success + failure, the recorded pair (reports/saga-runs.json). `success` includes one injected
//            transient deposit error, to show the retry policy.
//   plain    all three steps succeed, nothing injected
//   retry    the deposit is dropped twice (injected), then lands
//   failure  step 3 sends the shares to the zero address: a real revert, then the undo steps run
//   stuck    step 3 reverts for real, and the undo of the deposit is blocked (an injected "vault paused")
// Injected faults are always labelled; everything else is the real vault, real USDC and a real EVM.
//
// --stream prints one JSON object per line as the run happens: {type:'phase'|'event'|'result'|'error', ...}.
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runSaga, withInjectedFault } from '../../../lib/saga.js';
import { SEL, VAULT, ZERO, vaultSaga } from '../../../lib/saga-scenario.js';
import { forkIO, startFork } from '../../../lib/saga-fork.js';
import { USDC } from '../../../lib/protocols.js';
import { SELECTORS, encodeAddress } from '../../../lib/abi.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const scenarioArg = arg('scenario', 'both');
const out = arg('out');
const stream = process.argv.includes('--stream');
const maxAttempts = Number(arg('max-attempts', 3));
const AMOUNT = 100_000_000n; // 100 USDC (6 decimals)
const MORPHO = '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb'; // holds USDC; impersonated on the fork only

const SCENARIOS = ['success', 'failure', 'plain', 'retry', 'stuck'];
const emitLine = (o) => stream && console.log(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
const say = (...a) => !stream && console.log(...a);

if (scenarioArg !== 'both' && !SCENARIOS.includes(scenarioArg)) {
  console.error(`error: --scenario must be one of both, ${SCENARIOS.join(', ')}`);
  process.exit(2);
}
if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
  console.error('error: --max-attempts must be 1 to 5');
  process.exit(2);
}

const FAULT_TEXT = {
  success: 'the first deposit send fails with "replacement transaction underpriced (injected fault)"',
  retry: 'the first two deposit sends fail with "replacement transaction underpriced (injected fault)"',
  stuck: 'the undo of the deposit (redeem) is blocked with "execution reverted: vault is paused (injected fault)"',
};

const runs = [];
const forkBlocks = {};
let port = Number(arg('port', 8590));
try {
  for (const scenario of scenarioArg === 'both' ? ['success', 'failure'] : [scenarioArg]) {
    // Every scenario starts from a fresh fork, so each begins from identical state.
    emitLine({ type: 'phase', phase: 'fork', message: 'Starting a local fork of Pharos mainnet (anvil)…' });
    const fork = await startFork({ port: port++ });
    try {
      const io = forkIO(fork.url);
      forkBlocks[scenario] = Number(BigInt(await io.rpc('eth_blockNumber')));
      emitLine({ type: 'phase', phase: 'funding', message: `Fork ready at mainnet block ${forkBlocks[scenario].toLocaleString('en-US')}. Funding the test account with 1,000 USDC (impersonating a holder, on the fork only)…`, forkBlock: forkBlocks[scenario] });
      const [account, treasury] = await io.accounts();
      await io.setBalance(MORPHO, 10n ** 18n);
      await io.impersonate(MORPHO);
      await io.send({ from: MORPHO, to: USDC, data: '0xa9059cbb' + encodeAddress(account) + (1_000_000_000n).toString(16).padStart(64, '0') });
      const failStep3 = scenario === 'failure' || scenario === 'stuck';
      const saga = vaultSaga({ io, account, treasury, amount: AMOUNT, failStep3 });
      const depositMatch = (tx) => tx.to === VAULT && tx.data.startsWith(SEL.deposit);
      let exec = io;
      if (scenario === 'success') exec = withInjectedFault(io, { match: depositMatch, times: 1 });
      if (scenario === 'retry') exec = withInjectedFault(io, { match: depositMatch, times: 2 });
      if (scenario === 'stuck') exec = { ...io, send: (tx) => (tx.data.startsWith(SEL.redeem) ? Promise.reject(new Error('execution reverted: vault is paused (injected fault)')) : io.send(tx)) };
      emitLine({ type: 'phase', phase: 'saga', message: 'Running the saga: every step is a real transaction on the fork.' });
      const result = await runSaga({ name: `vault-saga:${scenario}`, steps: saga.steps, exec, policy: { baseDelayMs: 300, maxAttempts }, onEvent: (e) => emitLine({ type: 'event', event: e }) });
      result.finalCheck = await saga.finalCheck(result.status === 'completed' ? 'completed' : 'compensated');
      if (scenario === 'stuck') {
        // The right outcome here is an honest report: stuck, shares still held by the account, approval revoked.
        const f = result.finalCheck;
        f.expected = 'the saga reports it is stuck, the deposit shares are still held by the account, and the approval was revoked';
        f.clean = result.status === 'compensation-failed' && BigInt(f.accountShares) > 0n && BigInt(f.allowance) === 0n && BigInt(f.treasuryShares) === 0n;
      }
      result.injectedFault = FAULT_TEXT[scenario] ?? null;
      result.forced = failStep3 ? `step 3 sends the shares to ${ZERO}` : null;
      runs.push(result);
      const flat = (e) => `${String(e.t).padStart(5)} ms  ${e.event.padEnd(26)} ${[e.step, e.attempt && `attempt ${e.attempt}`, e.error, e.txHash && e.txHash.slice(0, 14) + '…', e.why].filter(Boolean).join('  ')}`;
      say(`\n=== ${result.name} → ${result.status.toUpperCase()} ===`);
      if (!stream) result.log.forEach((e) => console.log(flat(e)));
      const f = result.finalCheck;
      say(`final state: USDC ${f.usdc} (started ${f.usdcBefore}, spent ${f.spent}), account shares ${f.accountShares}, allowance ${f.allowance}, treasury shares ${f.treasuryShares}\nexpected: ${f.expected} → ${f.clean ? 'AS EXPECTED' : 'NOT AS EXPECTED'}`);
    } finally {
      fork.stop();
    }
  }
  const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x)));
  const record = {
    recordedAt: new Date().toISOString(),
    network: 'local anvil fork of Pharos mainnet (chain 1672)',
    vault: VAULT,
    // Where the numbers came from, so a reviewer can reproduce or challenge them.
    provenance: {
      command: `node skills/pharos-saga-executor/scripts/saga.mjs --scenario ${scenarioArg} --out reports/saga-runs.json`,
      forkRpc: 'https://rpc.pharos.xyz',
      forkBlocks,
      anvil: execFileSync('anvil', ['--version'], { encoding: 'utf8' }).split('\n')[0].trim(),
      contracts: { vault: VAULT, usdc: USDC, usdcSource: `${MORPHO} (impersonated on the fork only, to give the test account 1,000 USDC)` },
      accounts: 'anvil dev accounts 0 (sender) and 1 (treasury); no private key is read or stored',
      note: 'Transaction hashes exist only on that local fork and will not appear on the explorer.',
    },
    runs: plain(runs),
  };
  if (out) await writeFile(out, JSON.stringify(record, null, 2) + '\n');
  emitLine({ type: 'result', record });
  process.exitCode = runs.every((r) => r.finalCheck.clean) ? 0 : 1;
} catch (err) {
  emitLine({ type: 'error', message: err.message });
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
