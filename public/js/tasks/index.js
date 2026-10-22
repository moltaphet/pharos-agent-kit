// Frontend module per task built outside the original three:
//   slug -> { content, mount }
// `content` has the same shape as LIVE[slug] in content.js; `mount` is a panel.
// Add a line here when you add public/js/tasks/<slug>.js.

import * as docsMcpOnboarding from './docs-mcp-onboarding.js';

export const TASK_MODULES = {
  'docs-mcp-onboarding': docsMcpOnboarding,
};
