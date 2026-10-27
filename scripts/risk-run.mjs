#!/usr/bin/env node
// The Wallet Risk Checker, run on real chains. CLEAN and middle examples are on Pharos MAINNET (read-only): the WPROS contract, a long-established busy wallet, and USDC (an
// upgradeable proxy with an administrator: not a scam, but not "low" either). RISKY examples are on Pharos ATLANTIC testnet, where this script deploys a deliberately risky token
// (contracts/RiskyToken.sol: one key can mint, freeze, set a 100% fee, pause, delegatecall and self-destruct) and a freshly created wallet that gives that token's address an unlimited
// approval of the demo USDC. Everything is then checked from the chain alone. Funds: test PHRS from the throwaway wallet only.
//
//   node scripts/risk-run.mjs        writes reports/risk-run.json and config/risk-demo.json

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSigner } from '../lib/testnet-signer.js';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { rpcCall } from '../lib/rpc.js';
import { selectorOf } from '../lib/keccak.js';
import { CHAINS, checkAddress } from '../lib/risk.js';

const say = (s) => process.stderr.write(s + '\n');
const DIR = fileURLToPath(new URL('../', import.meta.url));
const demoFile = new URL('../config/risk-demo.json', import.meta.url);
const freshFile = DIR + '.wallet/risk-fresh.json';
const usdc = JSON.parse(readFileSync(new URL('../config/x402.json', import.meta.url), 'utf8')).asset;
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const rpcAtl = (m, p = []) => rpcCall(m, p, { url: ATLANTIC.rpc, why: `risk run: ${m}` });

let demo = existsSync(demoFile) ? JSON.parse(readFileSync(demoFile, 'utf8')) : null;
if (!demo) {
  const signer = makeSigner({ rpcUrl: ATLANTIC.rpc, log: say, budgetWei: 5n * 10n ** 15n });
  const artifact = JSON.parse(readFileSync(DIR + 'contracts/out/RiskyToken.sol/RiskyToken.json', 'utf8')).bytecode.object;
  say('deploying the deliberately risky token on Atlantic …');
  const dep = await signer.send({ label: 'deploy RiskyToken', to: null, create: artifact, gas: 1_500_000 });
  // a brand-new wallet (key kept in the git-ignored .wallet/ folder), funded with a little test PHRS
  mkdirSync(DIR + '.wallet', { recursive: true });
  const fresh = JSON.parse(execFileSync('cast', ['wallet', 'new', '--json'], { encoding: 'utf8' }))[0];
  writeFileSync(freshFile, JSON.stringify({ address: fresh.address, privateKey: fresh.private_key }), { mode: 0o600 });
  say('funding a brand-new wallet and giving the risky token an unlimited approval …');
  const fund = await signer.send({ label: 'fund the fresh wallet', to: fresh.address, value: 3n * 10n ** 15n, gas: 21000 });
  const freshSigner = makeSigner({ rpcUrl: ATLANTIC.rpc, log: say, walletFile: freshFile, budgetWei: 3n * 10n ** 15n });
  const approve = await freshSigner.send({ label: 'unlimited approval of the demo USDC to the risky token', to: usdc, data: selectorOf('approve(address,uint256)') + addrWord(dep.contractAddress) + word(2n ** 256n - 1n), gas: 80_000 });
  demo = { network: 'Pharos Atlantic testnet (688689)', riskyToken: dep.contractAddress, deployTx: dep.hash, deployer: signer.from, freshWallet: fresh.address, fundTx: fund.hash, approveTx: approve.hash, approvedToken: usdc, note: 'Created by scripts/risk-run.mjs for the Wallet Risk Checker. The token is deliberately risky (contracts/RiskyToken.sol); the wallet is brand new and holds a few thousandths of test PHRS.' };
  writeFileSync(demoFile, JSON.stringify(demo, null, 1) + '\n');
  await new Promise((r) => setTimeout(r, 4000));
}
say(`risky token ${demo.riskyToken}, fresh wallet ${demo.freshWallet}`);

const targets = [
  { id: 'wpros', chain: 'mainnet', address: '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0', title: 'WPROS, the wrapped PROS contract', expect: 'clean' },
  { id: 'old-wallet', chain: 'mainnet', address: '0x1f3546a29eec2102c8d52e21a45114124014c85c', title: 'A long-established, busy wallet', expect: 'clean' },
  { id: 'usdc', chain: 'mainnet', address: '0xc879c018db60520f4355c26ed1a6d572cdac1815', title: 'USDC: an upgradeable proxy with an administrator', expect: 'middle' },
  { id: 'risky-token', chain: 'atlantic', address: demo.riskyToken, title: 'The deliberately risky token (deployed for this demo)', expect: 'risky' },
  { id: 'fresh-wallet', chain: 'atlantic', address: demo.freshWallet, title: 'A brand-new wallet with an unlimited approval to the risky token', expect: 'risky' },
];
const results = [];
for (const t of targets) {
  say(`checking ${t.id} …`);
  const r = await checkAddress({ chain: CHAINS[t.chain], address: t.address, window: 20_000 });
  say(`  → ${r.level}: ${r.summary}`);
  results.push({ ...t, result: r });
}
// the flag list: the same risky token, "flagged" by the user, is found at once through the fresh wallet's contact with it
const withList = await checkAddress({ chain: CHAINS.atlantic, address: demo.riskyToken, flagged: [demo.deployer], window: 20_000 });
const report = {
  recordedAt: new Date().toISOString(),
  network: 'Mainnet examples are read-only (Pharos 1672). Risky examples are contracts and a wallet created on Pharos Atlantic testnet (688689) for this demo; every check reads the chain alone.',
  demo,
  examples: results,
  flagListExample: { flagged: [demo.deployer], note: 'the same risky token, with its deployer on a flag list supplied by the user', level: withList.level, flags: withList.flags.map((f) => f.title) },
  summary: {
    clean: results.filter((r) => r.expect === 'clean').map((r) => [r.id, r.result.level]),
    middle: results.filter((r) => r.expect === 'middle').map((r) => [r.id, r.result.level]),
    risky: results.filter((r) => r.expect === 'risky').map((r) => [r.id, r.result.level]),
    signalsChecked: Math.max(...results.map((r) => r.result.signals.filter((s) => s.status !== 'na').length)),
  },
};
writeFileSync(new URL('../reports/risk-run.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log(`wrote reports/risk-run.json: clean ${JSON.stringify(report.summary.clean)}, middle ${JSON.stringify(report.summary.middle)}, risky ${JSON.stringify(report.summary.risky)}`);
const ok = report.summary.clean.every(([, l]) => l === 'low') && report.summary.risky.every(([, l]) => l === 'high');
process.exitCode = ok ? 0 : 1;
