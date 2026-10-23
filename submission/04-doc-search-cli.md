# 4. Doc-Search CLI

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/doc-search-cli/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/doc-search-cli
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/agents/doc-search-cli
- **What the proof shows:** Concise sourced answers, and a refusal (not an invented answer) for questions the docs cannot answer.

## Requirements it was built against (the Arena’s own list)

1. Accepts a natural-language question as input, e.g. `pharos-docs "how do I deploy a contract?"`.
   - Met by: Takes a plain-English question, on the command line or in the box above.
2. Returns a concise answer plus links or references to the source doc sections.
   - Met by: Returns a concise answer plus the doc pages it came from.
3. Handles "no good answer found" gracefully instead of inventing one.
   - Met by: Says “no good answer” when the answer admits it, or when the question’s key words appear in none of the pages the docs search returns, and shows nearby pages labelled as not an answer.
4. README with install and usage instructions and 3 example queries with outputs.
   - Met by: README has install and usage steps and three real example queries with output.

Code and notes: [agents/doc-search-cli/README.md](../agents/doc-search-cli/README.md)
