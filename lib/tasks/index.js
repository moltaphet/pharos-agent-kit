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
import skillChainMcpFlow from './skill-chain-mcp-flow.js';
import docsChainMcpAgent from './docs-chain-mcp-agent.js';
import portfolioAssistant from './portfolio-assistant.js';
import yieldOptimizer from './yield-optimizer.js';
import liquidationWatchdog from './liquidation-watchdog.js';
import naturalLanguagePaymentAgent from './natural-language-payment-agent.js';
import recurringPaymentAgent from './recurring-payment-agent.js';
import invoiceToPaymentAgent from './invoice-to-payment-agent.js';
import x402PaywalledApi from './x402-paywalled-api.js';
import x402AgentBuyer from './x402-agent-buyer.js';
import onChainAlertBot from './on-chain-alert-bot.js';
import whaleWatchingAgent from './whale-watching-agent.js';
import gasFeeOptimizer from './gas-fee-optimizer.js';
import walletRiskChecker from './wallet-risk-checker.js';
import auditLogAgent from './audit-log-agent.js';
import dappSupportAgent from './dapp-support-agent.js';
import weeklyDigestAgent from './weekly-digest-agent.js';

export const TASKS = {
  'docs-mcp-onboarding': docsMcpOnboarding,
  'threshold-guardian': thresholdGuardian,
  'saga-executor': sagaExecutor,
  'arbitrage-scanner': arbitrageScanner,
  'dry-run-executor': dryRunExecutor,
  'trend-watcher': trendWatcher,
  'batch-executor': batchExecutor,
  'policy-gatekeeper': policyGatekeeper,
  'skill-chain-mcp-flow': skillChainMcpFlow,
  'docs-chain-mcp-agent': docsChainMcpAgent,
  'portfolio-assistant': portfolioAssistant,
  'yield-optimizer': yieldOptimizer,
  'liquidation-watchdog': liquidationWatchdog,
  'natural-language-payment-agent': naturalLanguagePaymentAgent,
  'recurring-payment-agent': recurringPaymentAgent,
  'invoice-to-payment-agent': invoiceToPaymentAgent,
  'x402-paywalled-api': x402PaywalledApi,
  'x402-agent-buyer': x402AgentBuyer,
  'on-chain-alert-bot': onChainAlertBot,
  'whale-watching-agent': whaleWatchingAgent,
  'gas-fee-optimizer': gasFeeOptimizer,
  'wallet-risk-checker': walletRiskChecker,
  'audit-log-agent': auditLogAgent,
  'dapp-support-agent': dappSupportAgent,
  'weekly-digest-agent': weeklyDigestAgent,
};
