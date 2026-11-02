#!/usr/bin/env node
// The Saga Executor's full vault saga, proved on the REAL Pharos Atlantic
// testnet (chain 688689) — this is the run the Arena reviewer asked for:
//
//   "The success and forced-failure sagas only run on a local mainnet fork,
//    so their transactions aren't on chain. Run one full success and one
//    forced-failure with recovery on Atlantic (deploy test contracts if
//    needed) and resubmit."
//
// What runs here, in order, on Atlantic and nowhere else:
//   success:  approve -> deposit -> transfer shares to a treasury
//   failure:  approve -> deposit -> transfer shares to the ZERO address,
//             which reverts on chain for real, then compensation in reverse:
//             redeem the shares, revoke the approval
//
// No injected faults. The only thing that is not a real vault is the vault
// itself, and that is the point of the reviewer's parenthesis: the mainnet
// vault (RockawayX USDC) does not exist on Atlantic, so this run deploys its
// stand-ins first — TestUSDC (contracts/TestUSDC.sol) and TestVault
// (contracts/TestVault.sol, a 1:1 deposit/redeem vault with ERC-20 shares).
// The engine (lib/saga.js), the step order, the state checks and the
// compensations are exactly the ones in lib/saga-scenario.js; only the
// token and vault addresses are passed in instead of the mainnet defaults.
//
// Every transaction is signed by the throwaway testnet wallet in the
// git-ignored .wallet/atlantic-testnet.json (test tokens only;
// lib/testnet-signer.js refuses any chain but 688689 and stops over budget),
// mined on Atlantic, and read back from the chain. The forced failure needs
// no treasury key: the transfer reverts before any shares move, so the
// compensation only has to redeem and revoke, both from the wallet itself.
//
//   node scripts/testnet-vault-saga.mjs
//   node scripts/testnet-vault-saga.mjs --scenario success --out reports/testnet-vault-saga.json
//
// Writes reports/testnet-vault-saga.json. Needs .wallet/atlantic-testnet.json
// with a little PHRS (faucet: https://testnet.pharosnetwork.xyz) and Foundry
// (cast for sending, forge for building the contracts on demand).

import { writeFileSync } from 'node:fs';
import { runSaga } from '../lib/saga.js';
import { vaultSaga, ZERO } from '../lib/saga-scenario.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { makeSigner, phrs } from '../lib/testnet-signer.js';
import { testUsdcBytecode, testVaultBytecode } from '../lib/testnet-contracts.js';
import { selectorOf } from '../lib/keccak.js';
import { encodeAddress } from '../lib/abi.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const scenarioArg = arg('scenario', 'both');
const outPath = arg('out', 'reports/testnet-vault-saga.json');
if (!['both', 'success', 'failure'].includes(scenarioArg)) {
  console.error('error: --scenario must be one of both, success, failure');
  process.exit(2);
}

const AMOUNT = 100_000_000n; // 100 USDC (6 decimals), the same amount as the fork run
const MINT = 1_000_000_000n; // 1,000 USDC minted to the wallet: enough for both runs
const BUDGET_WEI = 5n * 10n ** 16n; // 0.05 PHRS: a guard, not the expected spend
const startedAt = new Date().toISOString();
const log = (s) => process.stderr.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x)));

let signer;
try {
  signer = makeSigner({ rpcUrl: ATLANTIC.rpc, budgetWei: BUDGET_WEI, log, startedAt });
} catch (err) {
  console.error(`error: cannot read the Atlantic testnet wallet: ${err.message}`);
  console.error('Create a throwaway wallet at .wallet/atlantic-testnet.json (git-ignored, test tokens only) and fund it from https://testnet.pharosnetwork.xyz. Never put a real key there.');
  process.exit(1);
}
const wallet = signer.wallet.address.toLowerCase();

const head0 = Number(BigInt(await signer.rpc('eth_blockNumber')));
const balance0 = await signer.balance();
const nonce0 = Number(BigInt(await signer.rpc('eth_getTransactionCount', [signer.wallet.address, 'latest'])));
log(`Atlantic head ${head0}, wallet ${signer.wallet.address}, ${phrs(balance0)}`);

// ---- deploy the test contracts ------------------------------------------------
// The vault's constructor takes the asset address. cast's --create path in
// lib/testnet-signer.js takes a single creation-code argument, so the
// constructor argument is appended ABI-encoded to the creation code itself:
// one 32-byte word holding the token address. That is the standard EVM
// layout for a single-address constructor, not a shortcut.
const tokenDeploy = await signer.send({ label: 'deploy TestUSDC', to: null, create: testUsdcBytecode(), gas: 1_500_000 });
const token = tokenDeploy.contractAddress.toLowerCase();
await sleep(4000); // a new contract is invisible to a node a block or two behind the one that mined it
const vaultCode = testVaultBytecode().replace(/^0x/, '') + encodeAddress(token);
const vaultDeploy = await signer.send({ label: 'deploy TestVault', to: null, create: '0x' + vaultCode, gas: 1_000_000 });
const vault = vaultDeploy.contractAddress.toLowerCase();
await sleep(4000);
log(`TestUSDC ${token}, TestVault ${vault} (asset ${token})`);

const mintSel = selectorOf('mint(address,uint256)');
await signer.send({ label: 'mint TestUSDC to the wallet', to: token, data: mintSel + encodeAddress(wallet) + word(MINT), gas: 200_000 });

// ---- chain reads that wait for the chain to settle ----------------------------
// The Atlantic RPC can be a block or two behind the node that mined a
// transaction, so a single eth_call right after a receipt can still show the
// old state and make a correct step look failed. Read until two consecutive
// reads agree (or 12 s pass), then return the settled value.
async function settledCall(to, data) {
  let prev = null;
  for (let i = 0; i < 12; i++) {
    const cur = await signer.rpc('eth_call', [{ to, data }, 'latest']);
    if (prev !== null && cur === prev) return cur;
    prev = cur;
    await sleep(1000);
  }
  return prev;
}
const io = { call: (to, data) => settledCall(to, data) };

// ---- a real executor: no injected faults --------------------------------------
const SEL = { approve: '0x095ea7b3', transfer: '0xa9059cbb', deposit: '0x6e553f65', redeem: '0xba087652' };
function tagFor(tx) {
  const sel = tx.data.slice(0, 10);
  if (tx.to === token && sel === SEL.approve) return BigInt('0x' + tx.data.slice(-64)) === 0n ? 'revoke approval' : 'approve';
  if (tx.to === vault && sel === SEL.deposit) return 'deposit';
  if (tx.to === vault && sel === SEL.redeem) return 'redeem';
  if (tx.to === vault && sel === SEL.transfer) {
    const to = '0x' + tx.data.slice(10 + 24, 10 + 64);
    return to === ZERO ? 'transfer to zero address (forced failure)' : 'transfer to treasury';
  }
  return `tx to ${tx.to}`;
}
function realExec(scenario) {
  const sent = [];
  return {
    sent,
    async send(tx) {
      // +30% headroom on the estimate: the fork run taught us a vault redeem
      // can run out of gas on an exactly-estimated limit. A transaction that
      // is going to revert (the forced failure) cannot be estimated, so it
      // falls back to a fixed limit and is allowed to revert on chain.
      let gas = 300_000;
      try {
        const est = BigInt(await signer.rpc('eth_estimateGas', [{ from: wallet, to: tx.to, data: tx.data }, 'latest']));
        gas = Number((est * 130n) / 100n);
        if (gas < 100_000) gas = 100_000;
        if (gas > 1_000_000) gas = 1_000_000;
      } catch { log(`  estimate failed for ${tagFor(tx)}; using the ${gas.toLocaleString('en-US')} fallback so it can revert on chain`); }
      const t = await signer.send({ label: `${scenario}: ${tagFor(tx)}`, to: tx.to, data: tx.data, gas });
      sent.push({ tag: tagFor(tx), hash: t.hash, status: t.status, blockNumber: t.blockNumber, gasUsed: t.gasUsed, to: t.to });
      return t.hash;
    },
    async receipt(hash) {
      const r = await signer.rpc('eth_getTransactionReceipt', [hash]);
      if (!r) throw new Error('request timed out: no receipt yet');
      return { hash, status: r.status === '0x1' ? 'success' : 'reverted', blockNumber: Number(BigInt(r.blockNumber)), gasUsed: Number(BigInt(r.gasUsed)) };
    },
  };
}

// ---- the two runs the reviewer asked for --------------------------------------
async function scenario(key) {
  const failStep3 = key === 'failure';
  const title = failStep3
    ? 'forced failure: step 3 sends the shares to the zero address, then the saga undoes steps 2 and 1'
    : 'full success: approve, deposit, transfer the shares to the treasury';
  log(`\n== vault-saga:${key}: ${title}`);
  const treasury = signer.fresh(`vault-saga-${key}-treasury`);
  const exec = realExec(`vault-saga:${key}`);
  const saga = vaultSaga({ io, account: wallet, treasury, amount: AMOUNT, failStep3, usdc: token, vault });
  const result = await runSaga({ name: `vault-saga:${key}`, steps: saga.steps, exec, policy: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 4000 } });
  const finalCheck = await saga.finalCheck(result.status === 'completed' ? 'completed' : 'compensated');
  const tags = exec.sent.map((t) => t.tag);
  const checks = failStep3 ? [
    { what: 'the saga ended compensated, not stuck', ok: result.status === 'compensated' },
    { what: 'step 3 failed for good with a revert', ok: result.failure?.step === 'transfer' && result.failure?.kind === 'permanent' },
    { what: 'the saga ran approve, deposit, the reverting transfer, then redeem and revoke, in that order', ok: tags.join(' > ') === 'approve > deposit > transfer to zero address (forced failure) > redeem > revoke approval' },
    { what: 'the final check is clean: nothing left behind', ok: finalCheck.clean === true },
    { what: 'account shares 0, allowance 0, treasury shares 0, USDC spent 0', ok: finalCheck.accountShares === 0n && finalCheck.allowance === 0n && finalCheck.treasuryShares === 0n && finalCheck.spent === 0n },
  ] : [
    { what: 'the saga completed', ok: result.status === 'completed' },
    { what: 'the saga ran approve, deposit, transfer, in that order', ok: tags.join(' > ') === 'approve > deposit > transfer to treasury' },
    { what: 'the final check is clean', ok: finalCheck.clean === true },
    { what: 'treasury holds the shares, account shares 0, allowance 0, USDC spent exactly the deposit', ok: finalCheck.treasuryShares === AMOUNT && finalCheck.accountShares === 0n && finalCheck.allowance === 0n && finalCheck.spent === AMOUNT },
  ];
  for (const c of checks) log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.what}`);
  return {
    key, title, status: result.status, failure: result.failure, treasury,
    steps: result.steps.map((s) => ({ id: s.id, state: s.state, attempts: s.attempts, txHash: s.txHash ?? null, compensationTx: s.compensationTx ?? null, error: s.error ?? null })),
    log: result.log.map(({ t, event, step, attempt, error, why, txHash, mined }) => ({ t, event, step, attempt, error, why, txHash, mined })),
    transactions: exec.sent,
    finalCheck: plain(finalCheck),
    checks,
  };
}

const out = [];
for (const key of scenarioArg === 'both' ? ['success', 'failure'] : [scenarioArg]) out.push(await scenario(key));

const nonce1 = Number(BigInt(await signer.rpc('eth_getTransactionCount', [signer.wallet.address, 'latest'])));
const balance1 = await signer.balance();
const allChecks = out.flatMap((s) => s.checks);
const report = {
  recordedAt: new Date().toISOString(),
  mode: 'live',
  network: { name: ATLANTIC.name, chainId: ATLANTIC.chainId, rpc: ATLANTIC.rpc, explorer: ATLANTIC.explorer, headAtStart: head0 },
  wallet: signer.wallet.address,
  token: { address: token, source: 'contracts/TestUSDC.sol', minted: MINT.toString(), mintedTo: wallet },
  vault: { address: vault, source: 'contracts/TestVault.sol', asset: token },
  note: 'Real transactions on Pharos Atlantic testnet. No injected faults: the forced failure is a real ERC-20 revert (transfer to the zero address) and the recovery is the saga\'s own compensation (redeem, then revoke). The vault is a test contract deployed for this run because the mainnet vault does not exist on Atlantic; the engine, step order, state checks and compensations are the same as the fork run.',
  budget: { startWei: balance0.toString(), endWei: balance1.toString(), spentWei: (balance0 - balance1).toString(), limitWei: BUDGET_WEI.toString() },
  transactionsSent: nonce1 - nonce0,
  summary: { checks: allChecks.length, passed: allChecks.filter((c) => c.ok).length },
  scenarios: out,
  transactions: signer.txs.map((t) => ({ ...t, from: signer.wallet.address.toLowerCase(), to: t.to ?? undefined })),
};
writeFileSync(new URL(`../${outPath}`, import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log(`wrote ${outPath}: ${report.summary.passed}/${report.summary.checks} checks, ${report.transactions.length} real transactions, spent ${phrs(balance0 - balance1)}`);
console.log(`token ${token}  vault ${vault}  explorer: ${ATLANTIC.explorer}/address/${vault}`);
process.exitCode = report.summary.passed === report.summary.checks ? 0 : 1;
