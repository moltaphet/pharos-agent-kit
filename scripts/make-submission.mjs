#!/usr/bin/env node
// Writes SUBMISSION.md: for each built task, the links to paste into the Arena's submit form (proof link, repo link, task page),
// the official requirements it was built against, and where each is met. Generated from public/registry.json and the recorded
// testnet run, so it cannot drift from them.   node scripts/make-submission.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://pharos-agent-kit.vercel.app';
const REPO = 'https://github.com/moltaphet/pharos-agent-kit';
const EXPLORER = 'https://atlantic.pharosscan.xyz';
const registry = JSON.parse(readFileSync(new URL('../public/registry.json', import.meta.url), 'utf8'));
const tasks = registry.tasks ?? registry;
const testnet = JSON.parse(readFileSync(new URL('../reports/testnet-runs.json', import.meta.url), 'utf8'));
const guardian = JSON.parse(readFileSync(new URL('../reports/testnet-guardian.json', import.meta.url), 'utf8'));

// The ten built tasks, in the Arena's order, with where their code lives and what makes the proof link worth opening.
const BUILT = {
  'read-contract-state': { code: 'bin/pharos-read.js', how: 'Live read of USDC (name, symbol, decimals, supply, owner, balances) at one pinned block, cross-checked against the public RPC.' },
  'event-log-monitor': { code: 'bin/pharos-watch.js', how: 'Live Transfer/Approval log watcher with block cursor, duplicate suppression and a run log.' },
  'docs-mcp-onboarding': { code: 'bin/pharos-onboard.js', how: 'Ten onboarding questions asked to Docs MCP; every documentation gap is confirmed by a live check against the network.' },
  'doc-search-cli': { code: 'bin/pharos-docs.js', how: 'Concise sourced answers, and a refusal (not an invented answer) for questions the docs cannot answer.' },
  'threshold-guardian': { code: 'skills/pharos-threshold-guardian/', how: 'Several live conditions at one block against thresholds; FIRE or HOLD with the full working. Shown acting for real on Atlantic testnet: the FIRE run sent a transaction, the HOLD run sent nothing.', tx: () => guardian.runs.find((r) => r.id === 'fire').action.tx },
  'saga-executor': { code: 'skills/pharos-saga-executor/', how: 'Click to run a three-step vault saga as real EVM transactions on a mainnet fork (success, retry, forced failure with full undo, stuck undo).' },
  'arbitrage-scanner': { code: 'skills/pharos-arbitrage-scanner/', how: 'Live scan of two real FaroSwap venues, plus the act path executed for real on a fork with predicted vs actual profit side by side.' },
  'dry-run-executor': { code: 'skills/pharos-dry-run-executor/', how: 'Simulation gate; the page re-verifies the real Atlantic testnet transactions that confirm its predictions.', tx: () => testnet.dryRun.cases.find((c) => c.sent?.status === 'success')?.sent },
  'trend-watcher': { code: 'skills/pharos-trend-watcher/', how: 'Persistent multi-observation trend rule on real chain history; restarts lose nothing and duplicate nothing.' },
  'batch-executor': { code: 'skills/pharos-batch-executor/', how: 'Plans a Multicall3 batch with a gas comparison; real Atlantic testnet transactions show the plan against reality.', tx: () => testnet.batch.calls.batched.transaction },
};

const out = [];
out.push('# Submission pack', '');
out.push(`Everything to paste into the Arena's submit form, per task. Repository: ${REPO} (public, MIT). Site: ${SITE}`, '');
out.push('For every task the proof is the **deployed demo link** below (it runs against Pharos, or against a real mainnet fork or Atlantic testnet, and shows an exact run log), plus the **repo link**. Where real testnet transactions exist, an explorer link is listed too.', '');
out.push(`The testnet transactions were sent from \`${testnet.wallet}\` (a throwaway wallet that only holds test tokens) on ${testnet.recordedAt.slice(0, 10)}; the page re-reads each one from the chain every time it loads.`, '');

let n = 0;
for (const t of tasks) {
  const b = BUILT[t.slug];
  if (!b) continue;
  n++;
  out.push(`## ${n}. ${t.title}`, '');
  out.push(`- **Proof link (deployed demo):** ${SITE}/#/${t.slug}/try`);
  out.push(`- **Task page, with the story, decisions and how to verify:** ${SITE}/#/${t.slug}`);
  out.push(`- **Repo link:** ${REPO}  (code: \`${b.code}\`)`);
  const tx = b.tx?.();
  if (tx) out.push(`- **Explorer proof (real testnet transaction):** ${EXPLORER}/tx/${tx.hash}`);
  out.push(`- **What the proof shows:** ${b.how}`, '');
  out.push('Requirements it was built against (the Arena\'s own list):', '');
  for (const [i, r] of t.requirements.entries()) out.push(`${i + 1}. ${r}`);
  out.push('');
}
out.push('---', '', 'Not included: the optional walkthrough video. Record one per task if you want it.', '');
writeFileSync(new URL('../SUBMISSION.md', import.meta.url), out.join('\n'));
console.log(`wrote SUBMISSION.md for ${n} tasks`);
