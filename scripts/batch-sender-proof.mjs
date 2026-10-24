#!/usr/bin/env node
// Why the Batch Executor refuses a wrapped-token deposit(): on a real fork of Pharos mainnet, with the live WPROS contract and the live Multicall3, send
// one deposit() of 1 PROS through Multicall3 and look at who ends up holding the WPROS. The simulation of that batch SUCCEEDS; the wrapped tokens
// are credited to Multicall3, not to the sender, so the sender has paid and received nothing.
//   node scripts/batch-sender-proof.mjs      writes reports/batch-sender-proof.json (needs Foundry: anvil 1.4.0)
import { writeFileSync } from 'node:fs';
import { startFork, forkIO } from '../lib/saga-fork.js';
import { encodeAggregate3Value } from '../lib/multicall.js';
import { MULTICALL3, WPROS } from '../lib/protocols.js';

const fork = await startFork({ port: 8611 });
try {
  const io = forkIO(fork.url);
  const user = '0x00000000000000000000000000000000000000a1';
  await io.setBalance(user, 10n ** 19n);
  await io.impersonate(user);
  const bal = async (who) => BigInt(await io.call(WPROS, '0x70a08231' + who.slice(2).toLowerCase().padStart(64, '0')));
  const before = { sender: await bal(user), multicall3: await bal(MULTICALL3) };
  const value = 10n ** 18n;
  const hash = await io.send({ from: user, to: MULTICALL3, data: encodeAggregate3Value([{ target: WPROS, data: '0xd0e30db0', value, allowFailure: false }]), value: '0x' + value.toString(16) });
  const receipt = await io.receipt(hash);
  const after = { sender: await bal(user), multicall3: await bal(MULTICALL3) };
  const rec = {
    recordedAt: new Date().toISOString(),
    network: 'local anvil fork of Pharos mainnet (chain 1672): the live WPROS and Multicall3 contracts, fake funds',
    contracts: { wpros: WPROS, multicall3: MULTICALL3 },
    action: 'Multicall3.aggregate3Value([{ target: WPROS, data: deposit() (0xd0e30db0), value: 1 PROS }]) sent by an ordinary account',
    status: receipt.status,
    wprosBefore: { sender: before.sender.toString(), multicall3: before.multicall3.toString() },
    wprosAfter: { sender: after.sender.toString(), multicall3: after.multicall3.toString() },
    conclusion: after.multicall3 - before.multicall3 === value && after.sender === before.sender ? 'the wrapped tokens were credited to Multicall3, not to the sender' : 'unexpected: read the balances',
  };
  writeFileSync(new URL('../reports/batch-sender-proof.json', import.meta.url), JSON.stringify(rec, null, 1) + '\n');
  console.log(rec.conclusion);
  process.exitCode = rec.conclusion.startsWith('the wrapped') ? 0 : 1;
} finally {
  fork.proc?.kill?.();
  await fork.stop?.();
}
