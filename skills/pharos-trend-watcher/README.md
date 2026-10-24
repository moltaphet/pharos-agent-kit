# 9. Trend Watcher

> A watcher with memory: it acts only when a trend holds over several readings, never on one noisy blip.

**Arena task:** SkillEngine · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/trend-watcher)  
**Try it:** https://pharos-agent-kit.vercel.app/#/trend-watcher/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/trend-watcher

## What it does

One reading proves nothing. A lending pool’s liquidity can drop and come back; a supply figure can spike once. A bot that reacts to a single reading cries wolf. The Trend Watcher is a Pharos Skill that remembers: it stores every observation, and fires only when the last N of them all move the same way (at least three, and you set how many and how big each step must be).

## What is real

Persistent multi-observation trend rule on real chain history; restarts lose nothing and duplicate nothing.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Stores state between runs: persistent storage, not just in-memory. | State is persistent: the CLI writes a JSON file atomically; this page keeps it in localStorage. Reload the page and the history is still here. |
| 2 | Trend rule needs at least 3 observations to trigger and is configurable. | The trend rule is configurable (direction, number of consecutive observations, minimum step) and refuses fewer than 3 observations. |
| 3 | Handles restarts without losing or duplicating history. | A restart never loses or duplicates history: observations are keyed by block, the back-fill grid is fixed, and a second back-fill adds nothing. This is unit-tested and was run live. |
| 4 | Shows the stored history and the exact moment the trend condition was met. | The stored history is shown with the exact observation where the trend condition was met, and the cleared moments. |
| 5 | Demonstrates that a single spike does not trigger it. | A single spike or dip does not trigger it (unit-tested on scripted series, and shown on real data) by Morpho’s liquidity stepping down once (1.39M to 1.32M) and then holding flat, which did not fire either. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --metric usdc-supply --backfill 8 --step 20000
node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --metric usdc-supply --observe
node skills/pharos-trend-watcher/scripts/watch.mjs --state trend.json --show
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
USDC total supply on Pharos: 8 new observation(s), 0 already stored.   (run it again:)
USDC total supply on Pharos: 0 new observation(s), 8 already stored (skipped, never duplicated).

  block   20820000  2026-10-21 08:37:46 UTC           54643459.47 USDC
  block   20840000  2026-10-21 13:48:22 UTC           52802700.41 USDC
  block   20860000  2026-10-21 18:43:32 UTC           50158018.66 USDC   ◀ TREND MET HERE
  block   20880000  2026-10-22 00:14:42 UTC           48259972.84 USDC
status: TREND ACTIVE (3 consecutive observations falling)
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [references/trend-watcher.md](references/trend-watcher.md)
- [scripts/watch.mjs](scripts/watch.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/tasks/trend-watcher.js](../../lib/tasks/trend-watcher.js)
- [public/js/tasks/trend-watcher.js](../../public/js/tasks/trend-watcher.js) (page in the web hub)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Only this task uses:** [lib/trend.js](../../lib/trend.js)

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/trace.js](../../lib/trace.js) (all tasks)

## Tests

2 test files cover this task (run all of them with `npm test`):

```bash
node --test test/trend-watcher.test.js test/trend.test.js
```

## Verify it yourself

- **Check a stored value yourself.** USDC total supply at a fixed past block never changes. These are the values behind the trend above (divide by 10^6). Because the node can occasionally answer wrongly, run a command twice and trust the value that repeats.
- **See the node’s inconsistency for yourself.** Repeat one historical read a few times. Most answers agree; occasionally one is wildly different.
- **Read the skill itself.** SKILL.md, the reference, the engine and the script are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
