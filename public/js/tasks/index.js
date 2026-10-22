// Frontend module per task built outside the original three:
//   slug -> { content, mount }
// `content` has the same shape as LIVE[slug] in content.js; `mount` is a panel.
// Add a line here when you add public/js/tasks/<slug>.js.

import * as docsMcpOnboarding from './docs-mcp-onboarding.js';
import * as thresholdGuardian from './threshold-guardian.js';
import * as sagaExecutor from './saga-executor.js';
import * as arbitrageScanner from './arbitrage-scanner.js';

export const TASK_MODULES = {
  'docs-mcp-onboarding': docsMcpOnboarding,
  'threshold-guardian': thresholdGuardian,
  'saga-executor': sagaExecutor,
  'arbitrage-scanner': arbitrageScanner,
};
