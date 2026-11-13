# Treasury test run

Run on 2026-11-12 on a local machine without sandbox restrictions.

- JavaScript suite (`npm test`): 912 tests, 912 passed, 0 failed (includes the 20 Treasury tests: invoice intake, on-chain history, recipient inspection).
- Contract suite (`forge test`, `contracts/test/Treasury.t.sol`): 14 tests, including 256 fuzz inputs.
- Atlantic deployment and proof: `node scripts/treasury-deploy.mjs --live` passed 9 checks (`reports/treasury-run.json`).
- Planning endpoint exercised live against Developer Docs MCP and SkillEngine reads: valid invoice (needs-approval), already-paid invoice, and over-limit invoice (blocked).
- Not covered here: wallet signing in a browser and the production deployment.
