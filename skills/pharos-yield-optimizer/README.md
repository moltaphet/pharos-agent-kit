# 15. Yield Optimizer

> Compare the USDC vaults on Pharos with live data, count gas, fees and whether you can even get in and out, and say “move” or “stay put”.

**Arena task:** DeFi / Portfolio · Hard · [brief](https://pharos-agent-arena.vercel.app/tasks/yield-optimizer)<br>
**Try it:** https://pharos-agent-kit.vercel.app/#/yield-optimizer/try  ·  **Story, decisions and how to verify:** https://pharos-agent-kit.vercel.app/#/yield-optimizer

## What it does

The highest rate is not the best place for your money. On Pharos mainnet the R25 quarterly vault pays about 15% a year and the weekly one about 6%, but this wallet cannot deposit into the quarterly vault at all, and cannot redeem from it. The Yield Optimizer finds that out before recommending anything.

## What is real

Compares the four USDC vaults on measured yield, tests with simulations whether the wallet can get in and out, counts gas measured by really executing the steps on a mainnet fork plus fees, and answers MOVE (with unsigned transactions) or STAY PUT with the reason. Recorded decisions pinned to a block, replayable.

## Requirements and how each is met

| # | The Arena requires | How it is met |
|---|---|---|
| 1 | Compares at least 3 yield sources using live on-chain data. | It compares five yield sources from live on-chain data: the four vaults (R25 weekly, quarterly, semi-yearly and the RockawayX Morpho vault) and USDC left idle in the wallet, each rate measured from the vault’s share price at three blocks, confirmed on the public RPC. |
| 2 | Accounts for gas, entry/exit fees, and a minimum holding period before recommending a move. | It accounts for gas (units measured by really executing the steps on a mainnet fork, priced at the live gas price and PROS/USD), entry and exit fees (from previewDeposit and previewRedeem against the share price), and a minimum holding period you set, over which the net gain is worked out. |
| 3 | Outputs a clear recommendation with expected net gain, or "stay put" with the reason. | The output is a clear MOVE with the expected net gain split into extra yield, gas and fees and a break-even in days, or STAY PUT with the reason for every vault; a fork run of a real wallet checks the previews against what the vaults really paid. |
| 4 | If executing: prepares transactions for user signature only. The agent never holds keys. | A MOVE prepares unsigned transactions (redeem, approve, deposit) for the user to sign; the agent holds no key, sends nothing, and a test checks that only reads are asked of the chain. |

## Run it

From the repository root (Node.js 20 or newer):

```bash
node skills/pharos-yield-optimizer/scripts/optimize.mjs --wallet 0x8ecdf4245efddd2210f79517fbd9d12ff524ab9f --from idle
… --from r25-weekly --min-hold-days 90 --min-net-gain 100
… --from idle --amount 10000
node scripts/yield-fork-run.mjs
```

## Sample output

Real output, as recorded when the task was built (the live page and your own run will show newer numbers):

```text
from: USDC idle in the wallet, 942,942.429833 USDC, earning 0.00% a year

✓ R25 VRPC Weekly
    pays 5.82% a year · let in: yes · can be redeemed: yes · gas $0.0015 · fees – · net over 30 days $4,395.72
✗ R25 VRPC Quarterly
    pays 15.23% a year · let in: NO · can be redeemed: NO
    - the vault refuses this wallet even with the approval in place: custom error 0xe19a2672 (it carries this wallet’s address, which suggests an access check; the vault does not say which)
✗ R25 VRPC Semi-yearly
    - the vault caps this wallet's deposit at 8.203251 USDC, below the 942,942.429833 USDC to move
✓ RockawayX USDC (Morpho Vault V2)
    pays 4.22% a year · let in: yes · can be redeemed: yes · net over 30 days $3,208.43

MOVE 942,942.429833 USDC from USDC idle in the wallet to R25 VRPC Weekly
  … the expected net gain is $4,395.72: $4,395.72 extra yield, minus $0.0015 of gas, with no fee worth counting on entry or exit (under $0.0001: previewDeposit and previewRedeem match the share price) … It pays for itself after under a day.

Transactions to sign, in order (UNSIGNED; nothing was sent):
  1. Let R25 VRPC Weekly take 942,942.429833 USDC       gas limit 72,069
  2. Deposit into R25 VRPC Weekly                       gas limit 222,566
```

## What is in this folder

- [SKILL.md](SKILL.md)
- [assets/networks.json](assets/networks.json)
- [examples/cases.json](examples/cases.json)
- [references/yield-optimizer.md](references/yield-optimizer.md)
- [scripts/optimize.mjs](scripts/optimize.mjs)

## Part of this task that lives elsewhere

The platform needs these in fixed places (Vercel functions in `api/`, server handlers in `lib/tasks/`, the hub page in `public/`, real-run scripts in `scripts/`).

- [lib/yield-optimizer.js](../../lib/yield-optimizer.js)
- [lib/tasks/yield-optimizer.js](../../lib/tasks/yield-optimizer.js)
- [scripts/yield-fork-run.mjs](../../scripts/yield-fork-run.mjs)
- [scripts/yield-demo.mjs](../../scripts/yield-demo.mjs)
- [public/js/tasks/yield-optimizer.js](../../public/js/tasks/yield-optimizer.js) (page in the web hub)

## Recorded data, contracts and config it uses

- [reports/yield-fork-run.json](../../reports/yield-fork-run.json)
- [reports/yield-demo.json](../../reports/yield-demo.json)

## Code it imports from `lib/`

Found by following the imports from this folder and the files above, so the list cannot go stale.

**Shared with other tasks:** [lib/abi.js](../../lib/abi.js) (all tasks), [lib/chain.js](../../lib/chain.js) (all tasks), [lib/defi.js](../../lib/defi.js) (also tasks 14, 16, 17, 18, 19, 22, 23, 25, 26), [lib/keccak.js](../../lib/keccak.js) (also tasks 6, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26), [lib/labels.js](../../lib/labels.js) (all tasks), [lib/limit.js](../../lib/limit.js) (all tasks), [lib/mcp.js](../../lib/mcp.js) (also tasks 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19), [lib/multicall.js](../../lib/multicall.js) (all tasks), [lib/onchain.js](../../lib/onchain.js) (also tasks 14, 16, 17, 18, 19, 22, 23, 25, 26), [lib/policy.js](../../lib/policy.js) (also tasks 11, 12), [lib/portfolio.js](../../lib/portfolio.js) (also task 14), [lib/protocols.js](../../lib/protocols.js) (all tasks), [lib/revert.js](../../lib/revert.js) (also tasks 8, 10, 12, 13, 17, 18, 19, 22, 23, 25, 26), [lib/rpc.js](../../lib/rpc.js) (also tasks 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26), [lib/saga-fork.js](../../lib/saga-fork.js) (also tasks 5, 6, 7, 8, 10, 11, 16, 17, 18, 19), [lib/snapshot.js](../../lib/snapshot.js) (all tasks), [lib/stable.js](../../lib/stable.js) (all tasks), [lib/steps.js](../../lib/steps.js) (also tasks 13, 14, 16, 17, 18, 19, 22, 23, 25, 26), [lib/trace.js](../../lib/trace.js) (all tasks), [lib/yields.js](../../lib/yields.js) (also task 14)

## Tests

2 test files cover this task (run all of them with `npm test`):

```bash
node --test test/yield-optimizer.test.js test/yield-optimizer-task.test.js
```

## Verify it yourself

- **Check a rate yourself.** The weekly vault’s share price at two blocks four days apart, from the public RPC. The ratio is the growth the optimizer annualised.
- **See a vault refuse the wallet.** The quarterly vault’s own answer to a deposit from the demo wallet (with the allowance in place it still reverts with 0xe19a2672 followed by the wallet’s address).
- **Read the fork evidence.** The fork card above lists what really happened when approve, deposit and redeem were executed against each vault: gas used, shares received against previewDeposit, USDC received against previewRedeem.
- **Replay a recorded case.** In the recorded demo card press Replay: the decision is worked out again at the recorded block and compared with the recording.
- **Read the skill itself.** SKILL.md, the reference, the script and the example cases are in the repository.

---

Generated by `scripts/make-submission.mjs` from the task page, the Arena brief and the import graph; edit those, not this file. Index of all tasks: [submission/README.md](../../submission/README.md).
