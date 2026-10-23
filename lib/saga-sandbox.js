// The Saga Executor's live demo: the vault saga executed as real EVM transactions on an anvil fork of Pharos mainnet, inside a
// throwaway Vercel Sandbox (see lib/sandbox-run.js for how and for the guardrails).
import { BusyError, LIMITS, createSandboxRunner, visitorId } from './sandbox-run.js';

export const SCENARIOS = {
  plain: 'Success: all three steps',
  retry: 'Retry: the deposit is dropped twice, then lands',
  failure: 'Forced failure: step 3 reverts, undo steps 2 and 1',
  stuck: 'Stuck: step 3 fails and the undo of the deposit is blocked',
};

// The engine and its script, uploaded fresh on every run so the demo always runs the deployed code.
export const FILES = [
  'lib/saga.js', 'lib/saga-scenario.js', 'lib/saga-fork.js', 'lib/abi.js', 'lib/protocols.js', 'lib/rpc.js', 'lib/trace.js', 'lib/limit.js',
  'skills/pharos-saga-executor/scripts/saga.mjs',
];

const runner = createSandboxRunner({ demo: 'saga', scenarios: SCENARIOS, files: FILES, script: 'skills/pharos-saga-executor/scripts/saga.mjs', takesAttempts: true });
export const { startRun, runStatus, validate, runCommandLine } = runner;
export { BusyError, LIMITS, visitorId };
