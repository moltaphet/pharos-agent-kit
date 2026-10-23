# 9. Trend Watcher

- **Proof link (deployed demo):** https://pharos-agent-kit.vercel.app/#/trend-watcher/try
- **Task page (story, decisions, how to verify):** https://pharos-agent-kit.vercel.app/#/trend-watcher
- **Repo link (this task’s folder):** https://github.com/moltaphet/pharos-agent-kit/tree/main/skills/pharos-trend-watcher
- **What the proof shows:** Persistent multi-observation trend rule on real chain history; restarts lose nothing and duplicate nothing.

## Requirements it was built against (the Arena’s own list)

1. Stores state between runs: persistent storage, not just in-memory.
   - Met by: State is persistent: the CLI writes a JSON file atomically; this page keeps it in localStorage. Reload the page and the history is still here.
2. Trend rule needs at least 3 observations to trigger and is configurable.
   - Met by: The trend rule is configurable (direction, number of consecutive observations, minimum step) and refuses fewer than 3 observations.
3. Handles restarts without losing or duplicating history.
   - Met by: A restart never loses or duplicates history: observations are keyed by block, the back-fill grid is fixed, and a second back-fill adds nothing. This is unit-tested and was run live.
4. Shows the stored history and the exact moment the trend condition was met.
   - Met by: The stored history is shown with the exact observation where the trend condition was met, and the cleared moments.
5. Demonstrates that a single spike does not trigger it.
   - Met by: A single spike or dip does not trigger it (unit-tested on scripted series, and shown on real data) by Morpho’s liquidity stepping down once (1.39M to 1.32M) and then holding flat, which did not fire either.

Code and notes: [skills/pharos-trend-watcher/README.md](../skills/pharos-trend-watcher/README.md)
