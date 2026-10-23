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

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

export const TASK_MAP = [
  { n: 1, slug: 'read-contract-state', folder: 'agents/read-contract-state', entries: ['api/read.js'], data: [], page: ['public/js/content.js', 'public/js/panels/read.js'],
    tests: ['snapshot.test.js', 'confirm.test.js', 'crosscheck.test.js', 'stable.test.js'] },
  { n: 2, slug: 'event-log-monitor', folder: 'agents/event-log-monitor', entries: ['api/logs.js'], data: [], page: ['public/js/content.js', 'public/js/panels/watch.js'],
    tests: ['watch.test.js'] },
  { n: 3, slug: 'docs-mcp-onboarding', folder: 'agents/docs-mcp-onboarding', entries: ['lib/tasks/docs-mcp-onboarding.js'], data: ['reports/docs-mcp-onboarding.md'], page: ['public/js/tasks/docs-mcp-onboarding.js'],
    tests: ['onboarding.test.js'] },
  { n: 4, slug: 'doc-search-cli', folder: 'agents/doc-search-cli', entries: ['api/docs.js'], data: [], page: ['public/js/content.js', 'public/js/panels/docs.js'],
    tests: ['docs.test.js'] },
  { n: 5, slug: 'threshold-guardian', folder: 'skills/pharos-threshold-guardian', entries: ['lib/tasks/threshold-guardian.js', 'scripts/testnet-guardian.mjs'], data: ['reports/testnet-guardian.json', 'reports/testnet-runs.json'], page: ['public/js/tasks/threshold-guardian.js'],
    tests: ['guardian.test.js'] },
  { n: 6, slug: 'saga-executor', folder: 'skills/pharos-saga-executor', entries: ['lib/tasks/saga-executor.js', 'lib/saga-sandbox.js'], data: ['reports/saga-runs.json', 'config/saga-snapshot.json', 'scripts/build-saga-snapshot.mjs'], page: ['public/js/tasks/saga-executor.js'],
    tests: ['saga.test.js', 'saga-fidelity.test.js', 'saga-fork.test.js', 'saga-sandbox.test.js', 'start-fork.test.js'] },
  { n: 7, slug: 'arbitrage-scanner', folder: 'skills/pharos-arbitrage-scanner', entries: ['lib/tasks/arbitrage-scanner.js', 'lib/arb-sandbox.js', 'scripts/arb-fork-run.mjs'], data: ['reports/arbitrage-runs.json', 'contracts/ArbLab.sol', 'contracts/ArbLab.bytecode.json'], page: ['public/js/tasks/arbitrage-scanner.js'],
    tests: ['arbitrage.test.js', 'amm.test.js', 'arb-fork.test.js', 'arb-sandbox.test.js'] },
  { n: 8, slug: 'dry-run-executor', folder: 'skills/pharos-dry-run-executor', entries: ['lib/tasks/dry-run-executor.js', 'scripts/testnet-run.mjs'], data: ['reports/testnet-runs.json', 'contracts/Counter.sol'], page: ['public/js/tasks/dry-run-executor.js'],
    tests: ['dryrun.test.js', 'revert.test.js'] },
  { n: 9, slug: 'trend-watcher', folder: 'skills/pharos-trend-watcher', entries: ['lib/tasks/trend-watcher.js'], data: [], page: ['public/js/tasks/trend-watcher.js'],
    tests: ['trend-watcher.test.js', 'trend.test.js'] },
  { n: 10, slug: 'batch-executor', folder: 'skills/pharos-batch-executor', entries: ['lib/tasks/batch-executor.js', 'scripts/testnet-run.mjs'], data: ['reports/batch-runs.json', 'reports/testnet-runs.json', 'contracts/Counter.sol'], page: ['public/js/tasks/batch-executor.js'],
    tests: ['batch.test.js', 'multicall.test.js'] },
  { n: 11, slug: 'policy-gatekeeper', folder: 'skills/pharos-policy-gatekeeper', entries: ['lib/tasks/policy-gatekeeper.js', 'scripts/testnet-gatekeeper.mjs'], data: ['reports/testnet-gatekeeper.json'], page: ['public/js/tasks/policy-gatekeeper.js'],
    tests: ['policy.test.js', 'audit-log.test.js', 'gatekeeper-task.test.js'] },
];

// Tests of the platform every task stands on, not of one task.
export const SHARED_TESTS = ['abi.test.js', 'limit.test.js', 'mcp-timeout.test.js', 'rpc-chain.test.js', 'server.test.js', 'submission.test.js', 'testnet-report.test.js', 'trace.test.js', 'ui-forms.test.js'];

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
