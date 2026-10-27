// The one place that says which files belong to which task. scripts/make-submission.mjs generates every task folder's README.md,
// the submission/ folder and SUBMISSION.md from this and from public/registry.json, and test/submission.test.js checks that
// everything it names exists, that every test file is claimed exactly once, and that the generated files are up to date.
//
//   folder   the task's own folder (code lives here; its README.md is generated)
//   entries  code that belongs to the task but lives elsewhere because the platform needs it there
//            (a Vercel function in api/, the task's server handler in lib/tasks/, the script that does its real testnet/fork run)
//   data     recorded reports, contracts and config the task reads
//   page     the task's page in the web hub
//   tests    the test files that cover this task
// The shared infrastructure a task imports (lib/mcp.js, lib/chain.js, …) is NOT listed by hand: it is found by following the
// imports from the folder's scripts and the entries, so it cannot be forgotten or go stale.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_FOLDERS } from '../public/js/consts.js';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

export const TASK_MAP = [
  { n: 1, slug: 'read-contract-state', folder: TASK_FOLDERS['read-contract-state'], entries: ['api/read.js'], data: [], page: ['public/js/content.js', 'public/js/panels/read.js'],
    tests: ['snapshot.test.js', 'confirm.test.js', 'crosscheck.test.js', 'stable.test.js'] },
  { n: 2, slug: 'event-log-monitor', folder: TASK_FOLDERS['event-log-monitor'], entries: ['api/logs.js'], data: [], page: ['public/js/content.js', 'public/js/panels/watch.js'],
    tests: ['watch.test.js'] },
  { n: 3, slug: 'docs-mcp-onboarding', folder: TASK_FOLDERS['docs-mcp-onboarding'], entries: ['lib/tasks/docs-mcp-onboarding.js'], data: ['reports/docs-mcp-onboarding.md'], page: ['public/js/tasks/docs-mcp-onboarding.js'],
    tests: ['onboarding.test.js'] },
  { n: 4, slug: 'doc-search-cli', folder: TASK_FOLDERS['doc-search-cli'], entries: ['api/docs.js'], data: [], page: ['public/js/content.js', 'public/js/panels/docs.js'],
    tests: ['docs.test.js'] },
  { n: 5, slug: 'threshold-guardian', folder: TASK_FOLDERS['threshold-guardian'], entries: ['lib/tasks/threshold-guardian.js', 'scripts/testnet-guardian.mjs'], data: ['reports/testnet-guardian.json', 'reports/testnet-runs.json'], page: ['public/js/tasks/threshold-guardian.js'],
    tests: ['guardian.test.js'] },
  { n: 6, slug: 'saga-executor', folder: TASK_FOLDERS['saga-executor'], entries: ['lib/tasks/saga-executor.js', 'lib/saga-sandbox.js', 'scripts/testnet-saga.mjs'], data: ['reports/saga-runs.json', 'reports/testnet-saga.json', 'contracts/Ledger.sol', 'config/saga-snapshot.json', 'scripts/build-saga-snapshot.mjs'], page: ['public/js/tasks/saga-executor.js'],
    tests: ['saga.test.js', 'saga-fidelity.test.js', 'saga-fork.test.js', 'saga-sandbox.test.js', 'start-fork.test.js', 'saga-testnet.test.js'] },
  { n: 7, slug: 'arbitrage-scanner', folder: TASK_FOLDERS['arbitrage-scanner'], entries: ['lib/tasks/arbitrage-scanner.js', 'lib/arb-sandbox.js', 'scripts/arb-fork-run.mjs'], data: ['reports/arbitrage-runs.json', 'contracts/ArbLab.sol', 'contracts/ArbLab.bytecode.json'], page: ['public/js/tasks/arbitrage-scanner.js'],
    tests: ['arbitrage.test.js', 'amm.test.js', 'arb-fork.test.js', 'arb-sandbox.test.js'] },
  { n: 8, slug: 'dry-run-executor', folder: TASK_FOLDERS['dry-run-executor'], entries: ['lib/tasks/dry-run-executor.js', 'scripts/testnet-run.mjs'], data: ['reports/testnet-runs.json', 'contracts/Counter.sol'], page: ['public/js/tasks/dry-run-executor.js'],
    tests: ['dryrun.test.js', 'revert.test.js'] },
  { n: 9, slug: 'trend-watcher', folder: TASK_FOLDERS['trend-watcher'], entries: ['lib/tasks/trend-watcher.js'], data: [], page: ['public/js/tasks/trend-watcher.js'],
    tests: ['trend-watcher.test.js', 'trend.test.js'] },
  { n: 10, slug: 'batch-executor', folder: TASK_FOLDERS['batch-executor'], entries: ['lib/tasks/batch-executor.js', 'scripts/testnet-run.mjs', 'scripts/batch-sender-proof.mjs'], data: ['reports/batch-runs.json', 'reports/batch-sender-proof.json', 'reports/testnet-runs.json', 'contracts/Counter.sol'], page: ['public/js/tasks/batch-executor.js'],
    tests: ['batch.test.js', 'multicall.test.js'] },
  { n: 11, slug: 'policy-gatekeeper', folder: TASK_FOLDERS['policy-gatekeeper'], entries: ['lib/tasks/policy-gatekeeper.js', 'scripts/testnet-gatekeeper.mjs'], data: ['reports/testnet-gatekeeper.json'], page: ['public/js/tasks/policy-gatekeeper.js'],
    tests: ['policy.test.js', 'audit-log.test.js', 'gatekeeper-task.test.js'] },
  { n: 12, slug: 'skill-chain-mcp-flow', folder: TASK_FOLDERS['skill-chain-mcp-flow'], entries: ['lib/flow.js', 'lib/tasks/skill-chain-mcp-flow.js', 'scripts/flow-demo.mjs'], data: ['reports/flow-demo.json'], page: ['public/js/tasks/skill-chain-mcp-flow.js'],
    tests: ['flow.test.js', 'flow-task.test.js'] },
  { n: 13, slug: 'docs-chain-mcp-agent', folder: TASK_FOLDERS['docs-chain-mcp-agent'], entries: ['lib/docs-chain.js', 'lib/tasks/docs-chain-mcp-agent.js', 'scripts/docs-chain-demo.mjs'], data: ['reports/docs-chain-demo.json'], page: ['public/js/tasks/docs-chain-mcp-agent.js'],
    tests: ['abi-call.test.js', 'docs-chain.test.js', 'docs-chain-task.test.js'] },
  { n: 14, slug: 'portfolio-assistant', folder: TASK_FOLDERS['portfolio-assistant'], entries: ['lib/portfolio.js', 'lib/tasks/portfolio-assistant.js', 'scripts/portfolio-demo.mjs'], data: ['reports/portfolio-demo.json'], page: ['public/js/tasks/portfolio-assistant.js'],
    tests: ['portfolio.test.js', 'portfolio-task.test.js'] },
  { n: 15, slug: 'yield-optimizer', folder: TASK_FOLDERS['yield-optimizer'], entries: ['lib/yield-optimizer.js', 'lib/tasks/yield-optimizer.js', 'scripts/yield-fork-run.mjs', 'scripts/yield-demo.mjs'], data: ['reports/yield-fork-run.json', 'reports/yield-demo.json'], page: ['public/js/tasks/yield-optimizer.js'],
    tests: ['yield-optimizer.test.js', 'yield-optimizer-task.test.js'] },
  { n: 16, slug: 'liquidation-watchdog', folder: TASK_FOLDERS['liquidation-watchdog'], entries: ['lib/liquidation.js', 'lib/tasks/liquidation-watchdog.js', 'agents/liquidation-watchdog/pharos-watchdog.js', 'scripts/liquidation-demo.mjs', 'scripts/liquidation-fork-run.mjs'], data: ['reports/liquidation-demo.json', 'reports/liquidation-fork-run.json'], page: ['public/js/tasks/liquidation-watchdog.js'],
    tests: ['liquidation.test.js', 'liquidation-task.test.js'] },
  { n: 17, slug: 'natural-language-payment-agent', folder: TASK_FOLDERS['natural-language-payment-agent'], entries: ['lib/payments.js', 'lib/tasks/natural-language-payment-agent.js', 'agents/natural-language-payment-agent/pharos-pay.js', 'scripts/payments-demo.mjs', 'scripts/payments-fork-run.mjs'], data: ['reports/payments-demo.json', 'reports/payments-fork-run.json'], page: ['public/js/tasks/natural-language-payment-agent.js'],
    tests: ['payments.test.js', 'payments-task.test.js', 'payment-audit.test.js'] },
  { n: 18, slug: 'recurring-payment-agent', folder: TASK_FOLDERS['recurring-payment-agent'], entries: ['lib/recurring.js', 'lib/tasks/recurring-payment-agent.js', 'agents/recurring-payment-agent/pharos-recurring.js', 'scripts/payments-demo.mjs', 'scripts/recurring-fork-run.mjs'], data: ['reports/recurring-demo.json', 'reports/recurring-fork-run.json'], page: ['public/js/tasks/recurring-payment-agent.js'],
    tests: ['recurring.test.js', 'recurring-task.test.js', 'recurring-audit.test.js'] },
  { n: 19, slug: 'invoice-to-payment-agent', folder: TASK_FOLDERS['invoice-to-payment-agent'], entries: ['lib/invoice.js', 'lib/tasks/invoice-to-payment-agent.js', 'agents/invoice-to-payment-agent/pharos-invoice.js', 'scripts/payments-demo.mjs', 'scripts/payments-fork-run.mjs'], data: ['reports/payments-demo.json', 'reports/payments-fork-run.json'], page: ['public/js/tasks/invoice-to-payment-agent.js'],
    tests: ['invoice.test.js', 'invoice-task.test.js'] },
  { n: 20, slug: 'x402-paywalled-api', folder: TASK_FOLDERS['x402-paywalled-api'], entries: ['lib/x402.js', 'lib/tasks/x402-paywalled-api.js', 'api/x402.js', 'agents/x402-paywalled-api/server.js', 'agents/x402-paywalled-api/facilitator.js', 'agents/x402-paywalled-api/client.js', 'scripts/x402-setup.mjs', 'scripts/x402-run.mjs'], data: ['reports/x402-run.json', 'reports/x402-token-check.json', 'config/x402.json', 'contracts/TestUSDC.sol'], page: ['public/js/tasks/x402-paywalled-api.js'],
    tests: ['x402.test.js', 'x402-task.test.js', 'x402-audit.test.js'] },
  { n: 21, slug: 'x402-agent-buyer', folder: TASK_FOLDERS['x402-agent-buyer'], entries: ['lib/x402-buyer.js', 'lib/tasks/x402-agent-buyer.js', 'scripts/x402-buyer-run.mjs'], data: ['agents/x402-agent-buyer/plan.example.json', 'reports/x402-buyer-run.json'], page: ['public/js/tasks/x402-agent-buyer.js'],
    tests: ['x402-buyer.test.js'] },
  { n: 22, slug: 'on-chain-alert-bot', folder: TASK_FOLDERS['on-chain-alert-bot'], entries: ['lib/alerts.js', 'lib/tasks/on-chain-alert-bot.js', 'scripts/alerts-run.mjs'], data: ['agents/on-chain-alert-bot/alerts.example.json', 'reports/alerts-run.json'], page: ['public/js/tasks/on-chain-alert-bot.js'],
    tests: ['alerts.test.js'] },
];

// Tests of the platform every task stands on, not of one task.
export const SHARED_TESTS = ['abi.test.js', 'limit.test.js', 'mcp-timeout.test.js', 'md.test.js', 'rpc-chain.test.js', 'server.test.js', 'submission.test.js', 'testnet-report.test.js', 'trace.test.js', 'ui-css.test.js', 'ui-forms.test.js', 'crypto.test.js', 'infra-audit.test.js'];

// ---- import closure ----------------------------------------------------------------------------------------------------------
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
const rel = (p) => normalize(p).replace(/^\.\//, '');

// Every repository file reachable from `files` through relative imports (the files themselves included).
export function closure(files, read = (p) => readFileSync(ROOT + p, 'utf8')) {
  const seen = new Set();
  const todo = files.map(rel);
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(m?js)$/.test(f)) continue;
    let src;
    try { src = read(f); } catch { continue; }
    for (const m of src.matchAll(IMPORT)) {
      const target = rel(join(dirname(f), m[1]));
      if (!seen.has(target)) todo.push(target);
    }
  }
  return [...seen].sort();
}

export function folderFiles(folder) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(ROOT + d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}/${e.name}`);
      else if (e.name !== 'README.md') out.push(`${d}/${e.name}`);
    }
  };
  walk(folder);
  return out.sort();
}

// Which of a task's own scripts to start the walk from: every .js/.mjs in its folder.
export const scriptsOf = (t) => folderFiles(t.folder).filter((f) => /\.m?js$/.test(f));

// For one task: what is in its folder, what belongs to it elsewhere, and which shared files it imports (and who else uses them).
export function dependencies(t, all = TASK_MAP) {
  const mine = new Set([...scriptsOf(t), ...t.entries]);
  const reach = (task) => closure([...scriptsOf(task), ...task.entries]);
  const own = new Set(t.entries);
  const infra = reach(t).filter((f) => !f.startsWith(t.folder + '/') && !own.has(f));
  const others = all.filter((x) => x.n !== t.n).map((x) => ({ n: x.n, files: new Set(reach(x)) }));
  return {
    folder: folderFiles(t.folder),
    outside: t.entries,
    infra: infra.map((f) => ({ file: f, usedBy: others.filter((o) => o.files.has(f)).map((o) => o.n) })),
    mine,
  };
}

export const allTestFiles = () => readdirSync(ROOT + 'test').filter((f) => f.endsWith('.test.js')).sort();
export const pathExists = (p) => existsSync(ROOT + p);
