# Submission folder

One page per task with the fields for the Arena's submit form. Repository: https://github.com/moltaphet/pharos-agent-kit (public, MIT). Site: https://pharos-agent-kit.vercel.app

Each task has its own folder in the repository, with a README that maps every Arena requirement to where it is met. The repo links below open exactly that folder. Code shared by several tasks stays in `lib/` and is listed in each folder’s README, so every task still runs from a plain clone.

| # | Task | Proof link (demo) | Repo link (folder) | Form fields |
|---|---|---|---|---|
| 1 | Read Contract State | [demo](https://pharos-agent-kit.vercel.app/#/read-contract-state/try) | [agents/read-contract-state](https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/read-contract-state) | [01-read-contract-state.md](01-read-contract-state.md) |
| 2 | Event/Log Monitor | [demo](https://pharos-agent-kit.vercel.app/#/event-log-monitor/try) | [agents/event-log-monitor](https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/event-log-monitor) | [02-event-log-monitor.md](02-event-log-monitor.md) |
| 3 | Docs MCP Onboarding | [demo](https://pharos-agent-kit.vercel.app/#/docs-mcp-onboarding/try) | [agents/docs-mcp-onboarding](https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/docs-mcp-onboarding) | [03-docs-mcp-onboarding.md](03-docs-mcp-onboarding.md) |
| 4 | Doc-Search CLI | [demo](https://pharos-agent-kit.vercel.app/#/doc-search-cli/try) | [agents/doc-search-cli](https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/doc-search-cli) | [04-doc-search-cli.md](04-doc-search-cli.md) |
| 5 | Threshold Guardian | [demo](https://pharos-agent-kit.vercel.app/#/threshold-guardian/try) | [skills/pharos-threshold-guardian](https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-threshold-guardian) | [05-threshold-guardian.md](05-threshold-guardian.md) |
| 6 | Saga Executor | [demo](https://pharos-agent-kit.vercel.app/#/saga-executor/try) | [skills/pharos-saga-executor](https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-saga-executor) | [06-saga-executor.md](06-saga-executor.md) |
| 7 | Arbitrage Scanner | [demo](https://pharos-agent-kit.vercel.app/#/arbitrage-scanner/try) | [skills/pharos-arbitrage-scanner](https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-arbitrage-scanner) | [07-arbitrage-scanner.md](07-arbitrage-scanner.md) |
| 8 | Dry-Run Executor | [demo](https://pharos-agent-kit.vercel.app/#/dry-run-executor/try) | [skills/pharos-dry-run-executor](https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-dry-run-executor) | [08-dry-run-executor.md](08-dry-run-executor.md) |
| 9 | Trend Watcher | [demo](https://pharos-agent-kit.vercel.app/#/trend-watcher/try) | [skills/pharos-trend-watcher](https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-trend-watcher) | [09-trend-watcher.md](09-trend-watcher.md) |
| 10 | Batch Executor | [demo](https://pharos-agent-kit.vercel.app/#/batch-executor/try) | [skills/pharos-batch-executor](https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-batch-executor) | [10-batch-executor.md](10-batch-executor.md) |
| 11 | Policy Gatekeeper | [demo](https://pharos-agent-kit.vercel.app/#/policy-gatekeeper/try) | [skills/pharos-policy-gatekeeper](https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-policy-gatekeeper) | [11-policy-gatekeeper.md](11-policy-gatekeeper.md) |
| 12 | Skill + Chain MCP Flow | [demo](https://pharos-agent-kit.vercel.app/#/skill-chain-mcp-flow/try) | [skills/pharos-transfer-preflight](https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-transfer-preflight) | [12-skill-chain-mcp-flow.md](12-skill-chain-mcp-flow.md) |

## Tests of the shared platform

These cover code every task stands on (MCP client, rate limiting, request tracing, the testnet report check, the forms):

- [test/abi.test.js](../test/abi.test.js)
- [test/limit.test.js](../test/limit.test.js)
- [test/mcp-timeout.test.js](../test/mcp-timeout.test.js)
- [test/md.test.js](../test/md.test.js)
- [test/rpc-chain.test.js](../test/rpc-chain.test.js)
- [test/server.test.js](../test/server.test.js)
- [test/submission.test.js](../test/submission.test.js)
- [test/testnet-report.test.js](../test/testnet-report.test.js)
- [test/trace.test.js](../test/trace.test.js)
- [test/ui-css.test.js](../test/ui-css.test.js)
- [test/ui-forms.test.js](../test/ui-forms.test.js)

Run everything with `npm test`.

---

Not included: the optional walkthrough video. Record one per task if you want it.
