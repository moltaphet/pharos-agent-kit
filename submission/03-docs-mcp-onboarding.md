# 3. Docs MCP Onboarding

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/docs-mcp-onboarding/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/docs-mcp-onboarding
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/docs-mcp-onboarding
- **What the proof shows:** Ten onboarding questions asked to Docs MCP; every documentation gap is confirmed by a live check against the network.

## Requirements it was built against (the Arena’s own list)

1. A step-by-step log of what you tried to do, the questions you asked Docs MCP, and the answers you got.
   - Met by: Every question, its exact wording and the docs’ answer appear in the log below, and in the downloadable report.
2. At least 3 concrete gaps or breakdowns (wrong, missing, or confusing answers), each with the exact query.
   - Met by: Gaps come from checks against the live network or the real URL, each listed with the exact query that exposed it. The recorded report (reports/docs-mcp-onboarding.md) lists 6; the count can change because Docs MCP answers are generated.
3. A suggested fix for each gap: what the docs should have said.
   - Met by: Each gap carries a written suggestion of what the docs should have said.
4. Ends with what you managed to build or run by the end.
   - Met by: The report ends with what the onboarding actually ran (MCP connection, both RPCs, live reads) and what it could not do, and why.

Code and notes: [agents/docs-mcp-onboarding/README.md](../agents/docs-mcp-onboarding/README.md)
