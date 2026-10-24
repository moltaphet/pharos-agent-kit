#!/usr/bin/env node
// Generates everything a reviewer or the Arena's submit form needs, from public/registry.json, the task pages' own content,
// scripts/task-map.mjs and the recorded testnet reports, so none of it can drift from the code:
//   <task folder>/README.md     one per built task: requirements and how each is met, what is real, run commands, files,
//                               the shared code it imports (found by following imports), the tests that cover it
//   submission/README.md        the index: one row per task with the links to paste
//   submission/NN-<slug>.md     one page per task: the form's fields, ready to paste
//   SUBMISSION.md               all of it in one file
//   node scripts/make-submission.mjs          write them
//   node scripts/make-submission.mjs --check  fail if any file is out of date (test/submission.test.js does this too)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_TESTS, TASK_MAP, ROOT, dependencies } from './task-map.mjs';

export const SITE = 'https://pharos-agent-kit.vercel.app';
export const REPO = 'https://github.com/moltaphet/pharos-agent-kit';
export const EXPLORER = 'https://atlantic.pharosscan.xyz';
const json = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const registry = json('public/registry.json');
const tasks = registry.tasks ?? registry;
const testnet = json('reports/testnet-runs.json');
const guardian = json('reports/testnet-guardian.json');
const gatekeeper = json('reports/testnet-gatekeeper.json');

// content.js imports browser modules; they only touch the DOM inside functions, so Node can load them.
const { liveOf } = await import('../public/js/content.js');

// What each task's proof is, in a sentence, and the real transaction worth opening (if there is one).
const PROOF = {
  'read-contract-state': { how: 'Live read of USDC (name, symbol, decimals, supply, owner, balances) at one pinned block, cross-checked against the public RPC.' },
  'event-log-monitor': { how: 'Live Transfer/Approval log watcher with block cursor, duplicate suppression and a run log.' },
  'docs-mcp-onboarding': { how: 'Ten onboarding questions asked to Docs MCP; every documentation gap is confirmed by a live check against the network.' },
  'doc-search-cli': { how: 'Concise sourced answers, and a refusal (not an invented answer) for questions the docs cannot answer.' },
  'threshold-guardian': { how: 'Several live conditions at one block against thresholds; FIRE or HOLD with the full working. Shown acting for real on Atlantic testnet: the FIRE run sent a transaction, the HOLD run sent nothing.', tx: () => guardian.runs.find((r) => r.id === 'fire').action.tx },
  'saga-executor': { how: 'Click to run a three-step vault saga as real EVM transactions on a mainnet fork (success, retry, forced failure with full undo, stuck undo).' },
  'arbitrage-scanner': { how: 'Live scan of two real FaroSwap venues, plus the act path executed for real on a fork with predicted vs actual profit side by side.' },
  'dry-run-executor': { how: 'Simulation gate; the page re-verifies the real Atlantic testnet transactions that confirm its predictions.', tx: () => testnet.dryRun.cases.find((c) => c.sent?.status === 'success')?.sent },
  'trend-watcher': { how: 'Persistent multi-observation trend rule on real chain history; restarts lose nothing and duplicate nothing.' },
  'batch-executor': { how: 'Plans a Multicall3 batch with a gas comparison; real Atlantic testnet transactions show the plan against reality.', tx: () => testnet.batch.calls.batched.transaction },
  'skill-chain-mcp-flow': { how: 'One sentence runs Chain MCP and two Skills end to end on Pharos mainnet; the same request is READY at a Thursday block and STOP at a Saturday block because the chain’s clock decides. Five recorded runs pinned to blocks, replayable.' },
  'docs-chain-mcp-agent': { how: 'Explains a contract function from Developer Docs MCP (with sources), calls it on Pharos mainnet through Chain MCP, reads the value the way the docs say, cross-checked against decimals(), and confirms every read on the public RPC. Five recorded real cases pinned to a block, replayable.' },
  'portfolio-assistant': { how: 'Answers eight kinds of plain-English question about a wallet from native PROS, USDC, WPROS and the four R25 / RockawayX vaults at one pinned block; every figure carries its contract, call and block, every read is repeated on the public RPC, and what it cannot know (other protocols, earnings since depositing) is refused. Recorded real wallets pinned to a block, replayable.' },
  'yield-optimizer': { how: 'Compares the four USDC vaults on measured yield, tests with simulations whether the wallet can get in and out, counts gas measured by really executing the steps on a mainnet fork plus fees, and answers MOVE (with unsigned transactions) or STAY PUT with the reason. Recorded decisions pinned to a block, replayable.' },
  'policy-gatekeeper': { how: 'Policy (spend limit, allowlist, time window) in front of a real wallet: 2 requests allowed and sent on Atlantic, 6 denied by named rules and never sent; the chain confirms it. Hash-chained audit log, re-verified on load.', tx: () => gatekeeper.transactions[0] },
};

const treeUrl = (p) => `${REPO}/tree/main/${p}`;
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function pieces(t) {
  const reg = tasks.find((x) => x.slug === t.slug);
  if (!reg) throw new Error(`task ${t.slug} is not in public/registry.json`);
  const c = liveOf(t.slug);
  if (!c) throw new Error(`task ${t.slug} has no page content`);
  if (c.evidence.length !== reg.requirements.length) throw new Error(`${t.slug}: ${reg.requirements.length} requirements but ${c.evidence.length} evidence lines`);
  const proof = PROOF[t.slug];
  if (!proof) throw new Error(`no PROOF entry for ${t.slug}`);
  return { reg, c, proof, tx: proof.tx?.() };
}

// ---- the README inside each task folder ----------------------------------------------------------------------------------------
function folderReadme(t) {
  const { reg, c, proof, tx } = pieces(t);
  const from = `${t.folder}/README.md`;
  const link = (p, text = p) => `[${text}](${relative(dirname(from), p) || '.'})`;
  const dep = dependencies(t);
  const own = dep.infra.filter((d) => d.usedBy.length === 0);
  const shared = dep.infra.filter((d) => d.usedBy.length > 0);
  const tests = t.tests.map((f) => `test/${f}`);
  const L = [];
  L.push(`# ${t.n}. ${reg.title}`, '');
  L.push(`> ${c.tagline}`, '');
  L.push(`**Arena task:** ${reg.category} · ${reg.tier} · [brief](${reg.url})  `);
  L.push(`**Try it:** ${SITE}/#/${t.slug}/try  ·  **Story, decisions and how to verify:** ${SITE}/#/${t.slug}`, '');
  L.push('## What it does', '', c.story[0], '');
  L.push('## What is real', '', proof.how, '');
  if (tx) L.push(`Real transaction to open: ${EXPLORER}/tx/${tx.hash}`, '');
  L.push('## Requirements and how each is met', '', '| # | The Arena requires | How it is met |', '|---|---|---|');
  reg.requirements.forEach((r, i) => L.push(`| ${i + 1} | ${cell(r)} | ${cell(c.evidence[i])} |`));
  L.push('', '## Run it', '', 'From the repository root (Node.js 20 or newer):', '', '```bash', ...c.run.commands.map((x) => x.replace(/\s+#.*$/, '').trim()), '```', '');
  if (c.run.sample) L.push('## Sample output', '', 'Real output, as recorded when the task was built (the live page and your own run will show newer numbers):', '', '```text', c.run.sample.trim(), '```', '');
  L.push('## What is in this folder', '', ...dep.folder.map((f) => `- ${link(f, f.slice(t.folder.length + 1))}`), '');
  L.push('## Part of this task that lives elsewhere', '', 'The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).', '');
  for (const f of dep.outside) L.push(`- ${link(f)}`);
  for (const f of t.page) L.push(`- ${link(f)} (page in the web hub)`);
  L.push('');
  if (t.data.length) L.push('## Recorded data, contracts and config it uses', '', ...t.data.map((f) => `- ${link(f)}`), '');
  L.push('## Code it imports from `lib/`', '', 'Found by following the imports from this folder and the files above, so the list cannot go stale.', '');
  if (own.length) L.push('**Only this task uses:** ' + own.map((d) => link(d.file)).join(', '), '');
  L.push('**Shared with other tasks:** ' + shared.map((d) => `${link(d.file)} (${d.usedBy.length === TASK_MAP.length - 1 ? 'all tasks' : `also ${d.usedBy.length === 1 ? 'task' : 'tasks'} ${d.usedBy.join(', ')}`})`).join(', '), '');
  L.push('## Tests', '', `${plural(tests.length, 'test file')} cover this task (run all of them with \`npm test\`):`, '', '```bash', `node --test ${tests.join(' ')}`, '```', '');
  if (c.verify?.length) L.push('## Verify it yourself', '', ...c.verify.map((v) => `- **${v.title}.** ${v.text}`), '');
  L.push('---', '', `Generated by \`scripts/make-submission.mjs\` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](${relative(dirname(from), 'submission/README.md')}).`, '');
  return L.join('\n');
}

// ---- submission/ ---------------------------------------------------------------------------------------------------------------
const pageName = (t) => `${String(t.n).padStart(2, '0')}-${t.slug}.md`;

function fields(t) {
  const { reg, c, proof, tx } = pieces(t);
  const rows = [
    ['Proof link (deployed demo)', `${SITE}/#/${t.slug}/try`],
    ['Task page (story, decisions, how to verify)', `${SITE}/#/${t.slug}`],
    ['Repo link (this task’s folder)', treeUrl(t.folder)],
  ];
  if (tx) rows.push(['Explorer proof (real testnet transaction)', `${EXPLORER}/tx/${tx.hash}`]);
  return { reg, c, proof, rows };
}

function taskPage(t) {
  const { reg, c, proof, rows } = fields(t);
  const L = [`# ${t.n}. ${reg.title}`, '', ...rows.map(([k, v]) => `- **${k}:** ${v}`), `- **What the proof shows:** ${proof.how}`, ''];
  L.push('## Requirements it was built against (the Arena’s own list)', '');
  reg.requirements.forEach((r, i) => L.push(`${i + 1}. ${r}`, `   - Met by: ${c.evidence[i]}`));
  L.push('', `Code and notes: [${t.folder}/README.md](../${t.folder}/README.md)`, '');
  return L.join('\n');
}

function indexPage() {
  const L = ['# Submission folder', '', `One page per task with the fields for the Arena's submit form. Repository: ${REPO} (public, MIT). Site: ${SITE}`, '',
    'Each task has its own folder in the repository, with a README that maps every Arena requirement to where it is met. The repo links below open exactly that folder. Code shared by several tasks stays in `lib/` and is listed in each folder’s README, so every task still runs from a plain clone.', '',
    '| # | Task | Proof link (demo) | Repo link (folder) | Form fields |', '|---|---|---|---|---|'];
  for (const t of TASK_MAP) {
    const reg = tasks.find((x) => x.slug === t.slug);
    L.push(`| ${t.n} | ${reg.title} | [demo](${SITE}/#/${t.slug}/try) | [${t.folder}](${treeUrl(t.folder)}) | [${pageName(t)}](${pageName(t)}) |`);
  }
  L.push('', '## Tests of the shared platform', '', 'These cover code every task stands on (MCP client, rate limiting, request tracing, the testnet report check, the forms):', '', ...SHARED_TESTS.map((f) => `- [test/${f}](../test/${f})`), '',
    'Run everything with `npm test`.', '', '---', '', 'Not included: the optional walkthrough video. Record one per task if you want it.', '');
  return L.join('\n');
}

function wholePack() {
  const L = ['# Submission pack', '',
    `Everything to paste into the Arena's submit form, per task. Repository: ${REPO} (public, MIT). Site: ${SITE}`, '',
    'The same content is split per task in [submission/](submission/README.md). Every task has its own folder with a README (requirements, how each is met, run commands, dependencies, tests).', '',
    'For every task the proof is the **deployed demo link** below (it runs against Pharos, or against a real mainnet fork or Atlantic testnet, and shows an exact run log), plus the **repo link** to the task’s folder. Where real testnet transactions exist, an explorer link is listed too.', '',
    `The testnet transactions were sent from \`${testnet.wallet}\` (a throwaway wallet that only holds test tokens) on ${testnet.recordedAt.slice(0, 10)}; the pages re-read each one from the chain every time they load.`, ''];
  for (const t of TASK_MAP) {
    const { reg, proof, rows } = fields(t);
    L.push(`## ${t.n}. ${reg.title}`, '', ...rows.map(([k, v]) => `- **${k}:** ${v}`), `- **What the proof shows:** ${proof.how}`, '', 'Requirements it was built against (the Arena\'s own list):', '');
    reg.requirements.forEach((r, i) => L.push(`${i + 1}. ${r}`));
    L.push('');
  }
  L.push('---', '', 'Not included: the optional walkthrough video. Record one per task if you want it.', '');
  return L.join('\n');
}

export function buildAll() {
  const files = new Map();
  for (const t of TASK_MAP) {
    files.set(`${t.folder}/README.md`, folderReadme(t));
    files.set(`submission/${pageName(t)}`, taskPage(t));
  }
  files.set('submission/README.md', indexPage());
  files.set('SUBMISSION.md', wholePack());
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildAll();
  if (process.argv.includes('--check')) {
    const stale = [...files].filter(([p, text]) => !existsSync(ROOT + p) || readFileSync(ROOT + p, 'utf8') !== text).map(([p]) => p);
    if (stale.length) { console.error(`out of date: ${stale.join(', ')}\nrun: node scripts/make-submission.mjs`); process.exit(1); }
    console.log(`${files.size} generated files are up to date`);
  } else {
    for (const [p, text] of files) { mkdirSync(dirname(ROOT + p), { recursive: true }); writeFileSync(ROOT + p, text); }
    console.log(`wrote ${files.size} files: ${TASK_MAP.length} task folder READMEs, submission/ (${TASK_MAP.length + 1} files) and SUBMISSION.md`);
  }
}
