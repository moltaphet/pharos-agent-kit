// Registry of server-side task handlers: slug -> async ({ q, body, chain, docs }) => data.
// Add a line here when you add lib/tasks/<slug>.js.

import docsMcpOnboarding from './docs-mcp-onboarding.js';

export const TASKS = {
  'docs-mcp-onboarding': docsMcpOnboarding,
};
