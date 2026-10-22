// Hand-maintained status for each Arena task. registry.json (scraped) holds the
// official wording; this file holds what WE have actually built.
//
// status: 'planned' | 'built' | 'submitted' | 'approved'
//   built      = works and is demoable here; not yet submitted to the Arena
//   submitted  = proof sent to the Arena, waiting for review
//   approved   = a reviewer approved it (only then do points count)

export const REPO = 'https://github.com/moltaphet/pharos-agent-kit';
export const EXPLORER_TX = 'https://www.pharosscan.xyz/tx/';

export const META = {
  'read-contract-state': {
    status: 'built',
    files: ['bin/pharos-read.js', 'lib/snapshot.js', 'api/read.js'],
    evidence: [
      'name, symbol, decimals, totalSupply and owner are read with eth_call through Chain MCP.',
      'The header shows the contract address and the block (with its time) that every read is pinned to.',
      'Decimals applied and thousands grouped with the raw value kept; addresses labelled from the Pharos registry, as wallet or contract, or with your own label.',
      'README documents the contract chosen, how to run it, and real sample output.',
    ],
  },
  'event-log-monitor': {
    status: 'built',
    files: ['bin/pharos-watch.js', 'lib/watch.js', 'api/logs.js'],
    evidence: [
      'Every poll calls get_logs filtered by the contract address and the event’s topic0.',
      'Only blocks after the last scanned one are read (windows of ≤ 1000 blocks) and each log is de-duplicated by txHash:logIndex.',
      'Each event is decoded into from, to, amount (decimals and symbol applied), tx hash and block.',
      'Busy mainnet contracts emit events within seconds, so you can watch live events arrive above. A CLI run is in the README.',
    ],
  },
  'doc-search-cli': {
    status: 'built',
    files: ['bin/pharos-docs.js', 'lib/docs.js', 'api/docs.js'],
    evidence: [
      'Takes a plain-English question, on the command line or in the box above.',
      'Returns a concise answer plus the doc pages it came from.',
      'Says “no good answer” when the answer admits it or the docs match nothing, and shows nearby pages labelled as not an answer.',
      'README has install and usage steps and three real example queries with output.',
    ],
  },
};

// Our assessment of what each remaining task needs. Not from the Arena.
export const PLAN = {
  'docs-mcp-onboarding': 'Doable now. A meta-task: onboard using only Docs MCP and log where it breaks down.',
  'threshold-guardian': 'Read-only logic. The task asks for a Skill, so the Skill Engine format needs confirming first.',
  'saga-executor': 'Needs a funded testnet wallet and signing. The hosted Chain MCP is read-only, so execution is yours to supply.',
  'arbitrage-scanner': 'Needs two real price sources on Pharos (pools or an oracle). Simulated execution is allowed by the task.',
  'dry-run-executor': 'Doable: eth_call and estimate_gas through Chain MCP. Skill format to confirm.',
  'trend-watcher': 'Needs persistent storage between runs, so it needs a small database or file store.',
  'batch-executor': 'Can prepare Multicall3 calldata and compare gas. Actually executing needs a wallet.',
  'policy-gatekeeper': 'Doable: policy rules, allow/deny with the deciding rule, and an audit log.',
  'skill-chain-mcp-flow': 'Needs the Skill Engine; the flow and diagram are doable.',
  'docs-chain-mcp-agent': 'Doable: Docs MCP explains a function, Chain MCP calls it.',
  'portfolio-assistant': 'Needs at least 2 real protocols or vaults on Pharos mainnet; those have to be found first.',
  'yield-optimizer': 'Needs at least 3 on-chain yield sources to compare.',
  'liquidation-watchdog': 'Needs a lending protocol on Pharos and an alert channel (Telegram, Discord or console).',
  'natural-language-payment-agent': 'Doable: prepares an unsigned transaction only, which is what the task asks for.',
  'recurring-payment-agent': 'Doable: schedule, state and unsigned transactions.',
  'invoice-to-payment-agent': 'Doable: parse two invoice formats and prepare an unsigned transaction.',
  'x402-paywalled-api': 'Needs a funded Atlantic testnet wallet with test USDC and a facilitator that settles on chain.',
  'x402-agent-buyer': 'Needs a funded Atlantic testnet wallet and x402 endpoints to pay.',
  'on-chain-alert-bot': 'Doable, but needs a Telegram bot token or a Discord webhook from you.',
  'whale-watching-agent': 'Doable: get_logs filtered by address topics for 5+ watched addresses.',
  'gas-fee-optimizer': 'Gas history is doable; submitting at the deadline needs a wallet.',
  'wallet-risk-checker': 'Doable with read-only signals (contract age, code, approvals, funding).',
  'audit-log-agent': 'Doable: topic-filtered logs per wallet, with a date range mapped to blocks.',
  'dapp-support-agent': 'Doable: needs 3 real failed transactions of different kinds to demonstrate.',
  'weekly-digest-agent': 'Needs a scheduler and a delivery channel, or a published page.',
  'doc-grounded-builder-agent': 'Doable with prepare-for-signature: Docs MCP plans, Chain MCP acts and verifies.',
  'multi-protocol-aggregator': 'Needs at least 2 protocols or vaults behind one interface.',
};
