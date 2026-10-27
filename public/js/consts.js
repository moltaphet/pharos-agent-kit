// Constants shared by content and task modules (kept apart to avoid import cycles).
export const REPO = 'https://github.com/moltaphet/pharos-agent-kit';
export const EXPLORER = 'https://www.pharosscan.xyz';
export const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';

// Where each built task's code lives on GitHub (one folder per task). scripts/task-map.mjs reads this, so the site and the
// generated READMEs cannot disagree.
export const TASK_FOLDERS = {
  'read-contract-state': 'agents/read-contract-state',
  'event-log-monitor': 'agents/event-log-monitor',
  'docs-mcp-onboarding': 'agents/docs-mcp-onboarding',
  'doc-search-cli': 'agents/doc-search-cli',
  'threshold-guardian': 'skills/pharos-threshold-guardian',
  'saga-executor': 'skills/pharos-saga-executor',
  'arbitrage-scanner': 'skills/pharos-arbitrage-scanner',
  'dry-run-executor': 'skills/pharos-dry-run-executor',
  'trend-watcher': 'skills/pharos-trend-watcher',
  'batch-executor': 'skills/pharos-batch-executor',
  'policy-gatekeeper': 'skills/pharos-policy-gatekeeper',
  'skill-chain-mcp-flow': 'skills/pharos-transfer-preflight',
  'docs-chain-mcp-agent': 'agents/docs-chain-mcp-agent',
  'portfolio-assistant': 'skills/pharos-portfolio-assistant',
  'yield-optimizer': 'skills/pharos-yield-optimizer',
  'liquidation-watchdog': 'agents/liquidation-watchdog',
  'natural-language-payment-agent': 'agents/natural-language-payment-agent',
  'recurring-payment-agent': 'agents/recurring-payment-agent',
  'invoice-to-payment-agent': 'agents/invoice-to-payment-agent',
  'x402-paywalled-api': 'agents/x402-paywalled-api',
  'x402-agent-buyer': 'agents/x402-agent-buyer',
  'on-chain-alert-bot': 'agents/on-chain-alert-bot',
  'whale-watching-agent': 'agents/whale-watching-agent',
  'gas-fee-optimizer': 'agents/gas-fee-optimizer',
  'wallet-risk-checker': 'agents/wallet-risk-checker',
  'audit-log-agent': 'agents/audit-log-agent',
  'dapp-support-agent': 'agents/dapp-support-agent',
  'weekly-digest-agent': 'agents/weekly-digest-agent',
};
export const folderOf = (slug) => TASK_FOLDERS[slug] ?? null;
export const folderUrl = (slug) => (TASK_FOLDERS[slug] ? `${REPO}/tree/main/${TASK_FOLDERS[slug]}` : null);
