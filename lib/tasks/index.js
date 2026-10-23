// Registry of server-side task handlers: slug -> async ({ q, body, chain, docs }) => data.
// Add a line here when you add lib/tasks/<slug>.js.

import docsMcpOnboarding from './docs-mcp-onboarding.js';
import thresholdGuardian from './threshold-guardian.js';
import sagaExecutor from './saga-executor.js';
import arbitrageScanner from './arbitrage-scanner.js';
import dryRunExecutor from './dry-run-executor.js';
import trendWatcher from './trend-watcher.js';
import batchExecutor from './batch-executor.js';
import policyGatekeeper from './policy-gatekeeper.js';

export const TASKS = {
  'docs-mcp-onboarding': docsMcpOnboarding,
  'threshold-guardian': thresholdGuardian,
  'saga-executor': sagaExecutor,
  'arbitrage-scanner': arbitrageScanner,
  'dry-run-executor': dryRunExecutor,
  'trend-watcher': trendWatcher,
  'batch-executor': batchExecutor,
  'policy-gatekeeper': policyGatekeeper,
};
