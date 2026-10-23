// The Arbitrage Scanner's live demo: the scanner's act path executed on an anvil fork of Pharos mainnet with the real
// FaroSwap contracts, inside a throwaway Vercel Sandbox (see lib/sandbox-run.js for how and for the guardrails).
import { createSandboxRunner } from './sandbox-run.js';

export const SCENARIOS = {
  profitable: 'A real 6% price gap: the scanner acts, both legs execute',
  marginal: 'A 0.3% price gap: the scanner skips, and forcing the trade loses',
};

// scripts/arb-fork-run.mjs and everything it imports. The helper contract is uploaded precompiled: the sandbox cannot download a compiler.
export const FILES = [
  'scripts/arb-fork-run.mjs',
  'lib/abi.js', 'lib/amm.js', 'lib/arb-fork.js', 'lib/chain.js', 'lib/labels.js', 'lib/limit.js', 'lib/multicall.js', 'lib/protocols.js',
  'lib/rpc.js', 'lib/saga-fork.js', 'lib/snapshot.js', 'lib/stable.js', 'lib/tasks/arbitrage-scanner.js', 'lib/trace.js',
  'lib/arb-sandbox.js', 'lib/sandbox-run.js', // imported by the scanner module (it also serves the web API); never executed in the sandbox
  'contracts/ArbLab.bytecode.json',
];

export const { startRun, runStatus, validate, runCommandLine, idPattern } = createSandboxRunner({ demo: 'arb', scenarios: SCENARIOS, files: FILES, script: 'scripts/arb-fork-run.mjs' });
