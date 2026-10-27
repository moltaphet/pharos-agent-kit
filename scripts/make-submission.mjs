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
const x402run = json('reports/x402-run.json');

// content.js imports browser modules; they only touch the DOM inside functions, so Node can load them.
const { liveOf } = await import('../public/js/content.js');

// What each task's proof is, in a sentence, and the real transaction worth opening (if there is one).
const PROOF = {
  'read-contract-state': { how: 'Live read of USDC (name, symbol, decimals, supply, owner, balances) at one pinned block, cross-checked against the public RPC.' },
  'event-log-monitor': { how: 'Live Transfer/Approval log watcher with block cursor, duplicate suppression and a run log.' },
  'docs-mcp-onboarding': { how: 'Ten onboarding questions asked to Docs MCP; every documentation gap is confirmed by a live check against the network.' },
  'doc-search-cli': { how: 'Concise sourced answers, and a refusal (not an invented answer) for questions the docs cannot answer.' },
  'threshold-guardian': { how: 'Several live conditions at one block against thresholds; FIRE or HOLD with the full working. Shown acting for real on Atlantic testnet: the FIRE run sent a transaction, the HOLD run sent nothing.', tx: () => guardian.runs.find((r) => r.id === 'fire').action.tx },
  'saga-executor': { how: 'Click to run a three-step vault saga as real EVM transactions on a mainnet fork (success, retry, forced failure with full undo, stuck undo). The retry and undo rules are also proved on the real Atlantic testnet: a step whose receipt times out is not sent twice, and a step that executed but failed its check is undone (the chain’s own ledger shows 1 instead of 3, and 0 instead of 1).' },
  'arbitrage-scanner': { how: 'Live scan of two real FaroSwap venues, plus the act path executed for real on a fork with predicted vs actual profit side by side.' },
  'dry-run-executor': { how: 'Simulation gate; the page re-verifies the real Atlantic testnet transactions that confirm its predictions.', tx: () => testnet.dryRun.cases.find((c) => c.sent?.status === 'success')?.sent },
  'trend-watcher': { how: 'Persistent multi-observation trend rule on real chain history; restarts lose nothing and duplicate nothing.' },
  'batch-executor': { how: 'Plans a Multicall3 batch with a gas comparison; real Atlantic testnet transactions show the plan against reality.', tx: () => testnet.batch.calls.batched.transaction },
  'skill-chain-mcp-flow': { how: 'One sentence runs Chain MCP and two Skills end to end on Pharos mainnet; the same request is READY at a Thursday block and STOP at a Saturday block because the chain’s clock decides. Five recorded runs pinned to blocks, replayable.' },
  'docs-chain-mcp-agent': { how: 'Explains a contract function from Developer Docs MCP (with sources), calls it on Pharos mainnet through Chain MCP, reads the value the way the docs say, cross-checked against decimals(), and confirms every read on the public RPC. Five recorded real cases pinned to a block, replayable.' },
  'portfolio-assistant': { how: 'Answers eight kinds of plain-English question about a wallet from native PROS, USDC, WPROS and the four R25 / RockawayX vaults at one pinned block; every figure carries its contract, call and block, every read is repeated on the public RPC, and what it cannot know (other protocols, earnings since depositing) is refused. Recorded real wallets pinned to a block, replayable.' },
  'yield-optimizer': { how: 'Compares the four USDC vaults on measured yield, tests with simulations whether the wallet can get in and out, counts gas measured by really executing the steps on a mainnet fork plus fees, and answers MOVE (with unsigned transactions) or STAY PUT with the reason. Recorded decisions pinned to a block, replayable.' },
  'liquidation-watchdog': { how: 'Watches a real borrower in Morpho Blue on Pharos mainnet (three of the four recent borrowers are within 3.5% of liquidation), grades it against warn and critical thresholds, alerts to the console with a timestamp (and Discord or Telegram if configured) with the exact amount to repay or add. The real Morpho contract, asked to liquidate on a fork, agrees with the health factor on both sides of 1.' },
  'natural-language-payment-agent': { how: 'Turns a sentence into questions, a refusal, or a checked summary and an unsigned transaction on Pharos mainnet (token, balance, checksum, simulation as the sender). Fifteen real requests pinned to a block, replayable; the output signed with a throwaway key on a mainnet fork moves the exact amount.' },
  'recurring-payment-agent': { how: 'A weekly or monthly schedule on Pharos mainnet: every period is upcoming, pending, submitted, paid or failed from the chain’s own receipts and Transfer logs, the next payment and the history are shown, and the whole lifecycle (sign, fail, retry, unreported payment found on chain, short balance) ran on a mainnet fork with exactly one payment per period.' },
  'invoice-to-payment-agent': { how: 'Reads an invoice (plain text, JSON or an ethereum: link), flags instead of guessing (missing reference, checksum, second address, totals that do not add up, look-alike token, no conversion), and prepares an unsigned payment carrying the invoice reference; ten sample invoices on real mainnet state, three paid on a fork with the reference read back from the chain.' },
  'x402-paywalled-api': { how: 'x402 on Pharos Atlantic testnet built from the protocol: two paid routes and one free, its own facilitator (/verify, /settle, /supported), a client that pays; the real run shows 402, a signed payment, 200 with PAYMENT-RESPONSE and the settlement on the explorer, and nine cheats all refused with 402.', tx: () => x402run.settlements[0] },
  'on-chain-alert-bot': { how: 'A bot that watches Pharos mainnet for a price crossing on the PROS/USD feed, large USDC/WPROS transfers, contract events and contract calls, and delivers each alert (what, value, explorer link) to Discord, Telegram, ntfy or a webhook. Each event goes to each channel once; a channel outage loses nothing. The recorded run scans 1,000 real mainnet blocks and delivers over real HTTP to local Discord-style, ntfy and webhook receivers (sending to Discord/Telegram itself needs the owner’s webhook or bot token).' },
  'whale-watching-agent': { how: 'An agent that follows a watchlist on Pharos mainnet and reports every token move above a per-token or dollar threshold, explained (what, how much, to whom, why it matters), plus new positions, exits and balance changes, and a summary across all addresses. The recorded run watches eight addresses over 2,000 real blocks: 205 significant moves at default thresholds, 3 at stricter ones, the biggest re-read from the chain.' },
  'gas-fee-optimizer': { how: 'An agent that reads the base fee, quoted gas price and tip, holds a transaction until the price is at or under a ceiling (or the history’s cheap quarter) or until the deadline, then submits it as an EIP-1559 transaction. Run for real on Atlantic testnet: four transfers, each read back from the chain; the optimized ones paid 1 gwei where the naive legacy transaction at the quoted price paid 10 gwei, the held one was submitted before its deadline, and Pharos mainnet is only read and prepared. Gas on both networks is flat, which the report states.' },
  'wallet-risk-checker': { how: 'A pre-transaction check that reads the chain and returns low, medium or high with every flag in plain language: contract age (binary search over history), proxy/upgradeability, owner and administrator powers read from the bytecode, dangerous instructions, wallet age and activity, outstanding unlimited approvals (judging the spender too), and contact with a flag list. Five recorded examples: WPROS and an established wallet are low, USDC (an upgradeable proxy) is medium, and a deliberately risky token and a brand-new wallet with an unlimited approval to it, both created on Atlantic testnet for the demo, are high.' },
  'audit-log-agent': { how: 'An agent that turns a wallet’s activity over a date range into a plain-language report: it finds the blocks for the dates, reads the wallet’s token transfers and approvals (the node’s only per-address index) and the transactions behind them in JSON-RPC batches, groups them into transfers in and out, swaps, approvals and contract interactions with totals and notable transactions, and exports Markdown, CSV and PDF. Recorded for three real wallets over one whole day on Pharos mainnet; what the node cannot list (plain PROS transfers) is counted and stated.' },
  'dapp-support-agent': { how: 'A support agent that takes a failed transaction hash, fetches the transaction and receipt through Chain MCP, replays the call on the block before it to get the contract’s own revert data, checks the numbers behind the usual causes (token balance, allowance, native value, gas used against the limit, the function selector) and explains the cause and the fix in plain words. Thirteen real failures of eleven kinds are recorded: four on Pharos mainnet and nine made on purpose on Atlantic testnet.' },
  'weekly-digest-agent': { how: 'An agent that builds a digest of the last N days (7 by default) of Pharos mainnet against the N before: PROS price, USDC supply, the Morpho syzUSD/USDC market, four USDC vaults, network activity and every Morpho event log, picks the three notable things, and delivers it to Discord, Telegram, ntfy or a webhook once per digest and channel, and as a published page. It runs on a schedule (a Vercel cron on Mondays, or --every on the CLI). Recorded for the real last week with delivery over real HTTP to local receivers; sending to Discord or Telegram needs the owner’s webhook or token.' },
  'doc-grounded-builder-agent': { how: 'An agent that answers “how do I do X on Pharos?” end to end: it asks Developer Docs MCP and keeps only an answer the docs support, with its sources; reads the facts it needs (chain ID, the price feed address and heartbeat) from the docs pages; does X through Chain MCP (a balance, a price, and transfers or deployments prepared unsigned for the user’s signature); and verifies the outcome on chain against the plan. Nine real requests are recorded, including a transfer and a deployment signed on Atlantic testnet and verified, a mainnet transfer left unsigned, and requests the docs do not cover, which it refuses to improvise.' },
  'x402-agent-buyer': { how: 'A plan-driven x402 buyer reads each endpoint’s price, compares it with an explicit value estimate, a per-call cap and a cumulative budget, and signs only offers that pass. Run for real on Pharos Atlantic against the task-20 server: 4 real settlements across three jobs (completed, stopped by the budget, skipped as not worth it), each read back from the chain, and the payer’s balance moved by exactly the ledger total.' },
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
  L.push(`**Arena task:** ${reg.category} · ${reg.tier} · [brief](${reg.url})<br>`);
  L.push(`**Try it:** ${SITE}/#/${t.slug}/try  ·  **Story, decisions and how to verify:** ${SITE}/#/${t.slug}`, '');
  L.push('## What it does', '', c.story[0], '');
  L.push('## What is real', '', proof.how, '');
  if (tx) L.push(`Real transaction to open: ${EXPLORER}/tx/${tx.hash}`, '');
  L.push('## Requirements and how each is met', '', '| # | The Arena requires | How it is met |', '|---|---|---|');
  reg.requirements.forEach((r, i) => L.push(`| ${i + 1} | ${cell(r)} | ${cell(c.evidence[i])} |`));
  L.push('', '## Run it', '', 'From the repository root (Node.js 20 or newer):', '', '```bash', ...c.run.commands.map((x) => x.replace(/\s+#.*$/, '').trim()), '```', '');
  if (c.run.sample) L.push('## Sample output', '', c.run.sampleLabel ?? 'Real output, as recorded when the task was built (the live page and your own run will show newer numbers):', '', '```text', c.run.sample.trim(), '```', '');
  L.push('## What is in this folder', '', ...dep.folder.map((f) => `- ${link(f, f.slice(t.folder.length + 1))}`), '');
  L.push('## Part of this task that lives elsewhere', '', 'The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).', '');
  for (const f of dep.outside) L.push(`- ${link(f)}`);
  for (const f of t.page) L.push(`- ${link(f)} (page in the web hub)`);
  L.push('');
  if (t.data.length) L.push('## Recorded data, contracts and config it uses', '', ...t.data.map((f) => `- ${link(f)}`), '');
  L.push('## Code it imports from `lib/`', '', 'Found by following the imports from this folder and the files above, so the list cannot go stale.', '');
  if (own.length) L.push('**Only this task uses:** ' + own.map((d) => link(d.file)).join(', '), '');
  L.push('**Shared with other tasks:** ' + shared.map((d) => `${link(d.file)} (${d.usedBy.length === TASK_MAP.length - 1 ? 'all tasks' : `also ${d.usedBy.length === 1 ? 'task' : 'tasks'} ${d.usedBy.join(', ')}`})`).join(', '), '');
  L.push('## Tests', '', `${plural(tests.length, 'test file')} ${tests.length === 1 ? 'covers' : 'cover'} this task (run all of them with \`npm test\`):`, '', '```bash', `node --test ${tests.join(' ')}`, '```', '');
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
