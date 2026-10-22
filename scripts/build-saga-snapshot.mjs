#!/usr/bin/env node
// Builds the Vercel Sandbox snapshot the Saga Executor's live demo boots from: Ubuntu + Node + Foundry.
// Run once (and again if the snapshot expires or Foundry should be updated):
//   node --env-file=.env.local scripts/build-saga-snapshot.mjs
// Needs a VERCEL_OIDC_TOKEN (`vercel env pull .env.local`). Writes config/saga-snapshot.json.

import { mkdir, writeFile } from 'node:fs/promises';
import { Sandbox } from '@vercel/sandbox';

const FOUNDRY_VERSION = 'v1.4.0';

const sh = async (sandbox, script, { sudo = false } = {}) => {
  const r = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', script], sudo });
  const out = (await r.stdout()) + (await r.stderr());
  if (r.exitCode !== 0) throw new Error(`command failed (${r.exitCode}): ${script.slice(0, 80)}\n${out.slice(-800)}`);
  return out.trim();
};

const sandbox = await Sandbox.create({ timeout: 15 * 60_000, resources: { vcpus: 2 }, persistent: false });
try {
  console.log('sandbox', sandbox.name);
  console.log(await sh(sandbox, 'uname -sm; node --version; echo "HOME=$HOME"; whoami'));
  console.log('installing Foundry…');
  await sh(sandbox, 'curl -sSL https://foundry.paradigm.xyz | bash');
  // Pinned: anvil 1.8.6 cannot fork Pharos (the RPC rejects the block parameter it sends); 1.4.0 can.
  await sh(sandbox, `$HOME/.foundry/bin/foundryup --install ${FOUNDRY_VERSION}`);
  const versions = await sh(sandbox, '$HOME/.foundry/bin/anvil --version | head -1; $HOME/.foundry/bin/forge --version | head -1');
  console.log(versions);
  console.log('checking that anvil can fork Pharos from inside the sandbox…');
  const check = await sh(sandbox, `($HOME/.foundry/bin/anvil --fork-url https://rpc.pharos.xyz --port 8545 --silent & echo $! > /tmp/anvil.pid); for i in $(seq 1 60); do curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 && break; sleep 1; done; kill $(cat /tmp/anvil.pid)`);
  console.log('fork answered:', check);
  const snap = await sandbox.snapshot({ expiration: 0 }); // never expires; stops the sandbox
  console.log('snapshot', snap.snapshotId);
  await mkdir(new URL('../config/', import.meta.url), { recursive: true });
  await writeFile(new URL('../config/saga-snapshot.json', import.meta.url), JSON.stringify({ snapshotId: snap.snapshotId, builtAt: new Date().toISOString(), contents: versions.split('\n').map((l) => l.trim()), note: 'Ubuntu + Node + Foundry. Rebuild with scripts/build-saga-snapshot.mjs.' }, null, 2) + '\n');
  console.log('wrote config/saga-snapshot.json');
} catch (err) {
  await sandbox.stop().catch(() => {});
  throw err;
}
