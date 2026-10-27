// Frontend module per task built outside the original three:
//   slug -> { content, mount }
// `content` has the same shape as LIVE[slug] in content.js; `mount` is a panel.
// Add a line here when you add public/js/tasks/<slug>.js.

import * as docsMcpOnboarding from './docs-mcp-onboarding.js';
import * as thresholdGuardian from './threshold-guardian.js';
import * as sagaExecutor from './saga-executor.js';
import * as arbitrageScanner from './arbitrage-scanner.js';
import * as dryRunExecutor from './dry-run-executor.js';
import * as trendWatcher from './trend-watcher.js';
import * as batchExecutor from './batch-executor.js';
import * as policyGatekeeper from './policy-gatekeeper.js';
import * as skillChainMcpFlow from './skill-chain-mcp-flow.js';
import * as docsChainMcpAgent from './docs-chain-mcp-agent.js';
import * as portfolioAssistant from './portfolio-assistant.js';
import * as yieldOptimizer from './yield-optimizer.js';
import * as liquidationWatchdog from './liquidation-watchdog.js';
import * as naturalLanguagePaymentAgent from './natural-language-payment-agent.js';
import * as recurringPaymentAgent from './recurring-payment-agent.js';
import * as invoiceToPaymentAgent from './invoice-to-payment-agent.js';
import * as x402PaywalledApi from './x402-paywalled-api.js';
import * as x402AgentBuyer from './x402-agent-buyer.js';
import * as onChainAlertBot from './on-chain-alert-bot.js';
import * as whaleWatchingAgent from './whale-watching-agent.js';
import * as gasFeeOptimizer from './gas-fee-optimizer.js';
import * as walletRiskChecker from './wallet-risk-checker.js';

export const TASK_MODULES = {
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
};
