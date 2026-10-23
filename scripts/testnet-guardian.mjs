#!/usr/bin/env node
// The Threshold Guardian acting for real on Pharos Atlantic testnet.
//
//   node scripts/testnet-guardian.mjs            rehearsal on a free local fork of Atlantic (no real spend)
//   node scripts/testnet-guardian.mjs --live     the real testnet; writes reports/testnet-guardian.json
//
// Two runs of the SAME guardian code (lib/tasks/threshold-guardian.js), reading three independent conditions from the testnet:
//   - FIRE: every condition is met, so the configured action is really sent: Counter.ping(id), a real transaction.
//   - HOLD: one condition is not met (the wallet is asked to hold 1 PHRS and holds far less), so nothing is sent.
// Afterwards the chain is asked whether the action happened: the counter for the FIRE id must read 1, the one for the HOLD id 0.
// Sending goes through lib/testnet-signer.js (chain id guard, spending budget, key never printed).

import { readFileSync, writeFileSync } from 'node:fs';
import { ATLANTIC, rpcChain } from '../lib/rpc-chain.js';
import { startFork } from '../lib/saga-fork.js';
import { makeSigner, phrs } from '../lib/testnet-signer.js';
import { evaluate } from '../lib/tasks/threshold-guardian.js';

const live = process.argv.includes('--live');
const outArg = process.argv.indexOf('--out');
const out = outArg > -1 ? process.argv[outArg + 1] : live ? 'reports/testnet-guardian.json' : '/tmp/testnet-guardian-rehearsal.json';
const log = (...a) => console.error(...a);
const BUDGET_WEI = 10n ** 15n; // 0.001 PHRS: one ping costs a twentieth of that

const counter = JSON.parse(readFileSync(new URL('../reports/testnet-runs.json', import.meta.url), 'utf8')).batch.calls.contract;
const HOLDER = '0x43a40934a22261b3d2b1e41aab56c37a0e6cb269'; // an address that holds testnet USDC (found by reading Transfer logs)
const PING = '0x773acdef';
const COUNT = '0x3b3546c8';

let fork = null;
let RPC = ATLANTIC.rpc;
if (!live) {
  fork = await startFork({ port: 8710, forkUrl: ATLANTIC.rpc });
  RPC = fork.url;
}
const startedAt = new Date().toISOString();
const signer = makeSigner({ rpcUrl: RPC, budgetWei: BUDGET_WEI, log, startedAt });
const chain = rpcChain({ url: RPC, name: ATLANTIC.name, chainId: ATLANTIC.chainId, nativeSymbol: 'PHRS' });
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const countOf = async (id) => BigInt(await signer.rpc('eth_call', [{ to: counter, data: COUNT + word(id) }, 'latest']));

// Conditions are read from the testnet itself. Only the wallet's threshold differs between the two runs.
const config = (name, walletMinPhrs) => ({
  name,
  action: `send Counter.ping(id) on Atlantic testnet`,
  require: 'all',
  conditions: [
    { id: 'gas', type: 'gas-price', op: '<=', threshold: 100 },
    { id: 'wallet-phrs', type: 'native-balance', address: signer.from, op: '>=', threshold: walletMinPhrs },
    { id: 'usdc-holder', type: 'token-balance', token: ATLANTIC.usdc, holder: HOLDER, op: '>=', threshold: 0.1 },
  ],
});

// Fresh ids per run, so a re-run never sees an old counter value.
const base = Number(BigInt(Date.now()) % 900_000_000n) + 1000;
const ids = { fire: base, hold: base + 1 };

try {
  const startBalance = await signer.balance();
  log(`${live ? 'LIVE on Pharos Atlantic testnet' : 'REHEARSAL on a local fork of Atlantic'}; wallet ${signer.wallet.address}, balance ${phrs(startBalance)}`);
  if (startBalance < 5n * BUDGET_WEI) throw new Error(`the wallet needs at least ${phrs(5n * BUDGET_WEI)}; it has ${phrs(startBalance)}`);

  const runs = [];
  for (const [key, title, cfg] of [
    ['fire', 'Every condition is met: the guardian FIRES and the action is really sent', config('testnet-guardian (fire)', 0.01)],
    ['hold', 'One condition is not met (the wallet is asked to hold 1 PHRS): the guardian HOLDS and sends nothing', config('testnet-guardian (hold)', 1)],
  ]) {
    log(`\n${title}`);
    const result = await evaluate({ chain }, cfg);
    result.trace.forEach((l) => log('  ' + l));
    const expected = key === 'fire' ? 'fire' : 'hold';
    let action = null;
    if (result.decision === 'fire') {
      const tx = await signer.send({ label: `guardian ${key}: Counter.ping(${ids[key]})`, to: counter, data: PING + word(ids[key]), gas: 120_000 });
      action = { kind: 'Counter.ping', counter, id: ids[key], tx };
    }
    const after = await countOf(ids[key]);
    runs.push({
      id: key, title, config: cfg, expected,
      decision: result.decision, block: result.block, passed: result.passed, total: result.total, trace: result.trace, conditions: result.results,
      action, counterAfter: after.toString(),
      matched: result.decision === expected && (result.decision === 'fire' ? after === 1n && action.tx.status === 'success' : after === 0n && action === null),
    });
  }

  const endBalance = await signer.balance();
  const record = {
    recordedAt: startedAt,
    mode: live ? 'live' : 'rehearsal on a local anvil fork of Atlantic (not real, not for the site)',
    network: { name: ATLANTIC.name, chainId: ATLANTIC.chainId, rpc: ATLANTIC.rpc, explorer: ATLANTIC.explorer },
    wallet: signer.wallet.address,
    counter,
    budget: { startWei: startBalance.toString(), endWei: endBalance.toString(), spentWei: (startBalance - endBalance).toString(), limitWei: BUDGET_WEI.toString() },
    runs,
    transactions: signer.txs,
  };
  writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
  log(`\nwrote ${out}; spent ${phrs(startBalance - endBalance)}; balance now ${phrs(endBalance)}`);
  console.log(JSON.stringify({ mode: record.mode, txs: signer.txs.length, runs: runs.map((r) => `${r.id}: ${r.decision} (${r.passed}/${r.total}) counter=${r.counterAfter} matched=${r.matched}`) }, null, 1));
  process.exitCode = runs.every((r) => r.matched) ? 0 : 1;
} finally {
  fork?.stop();
}
