// Registry of server-side task handlers: slug -> async ({ q, body, chain, docs }) => data.
// Add a line here when you add lib/tasks/<slug>.js.

import docsMcpOnboarding from './docs-mcp-onboarding.js';
import thresholdGuardian from './threshold-guardian.js';

export const TASKS = {
  'docs-mcp-onboarding': docsMcpOnboarding,
  'threshold-guardian': thresholdGuardian,
};
