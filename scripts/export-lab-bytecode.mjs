#!/usr/bin/env node
// Compiles contracts/ArbLab.sol and commits its bytecode as contracts/ArbLab.bytecode.json, with the SHA-256 of the source
// it came from. The live Arbitrage demo runs in a Sandbox whose network is locked to rpc.pharos.xyz, so it cannot download a
// Solidity compiler; it loads this file instead. test/arb-fork.test.js fails if the file and the source ever disagree.
//   node scripts/export-lab-bytecode.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../contracts/', import.meta.url));
execFileSync('forge', ['build'], { cwd: dir, stdio: 'inherit' });
const artifact = JSON.parse(readFileSync(`${dir}out/ArbLab.sol/ArbLab.json`, 'utf8'));
const source = readFileSync(`${dir}ArbLab.sol`);
const out = {
  contract: 'ArbLab',
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  compiler: JSON.parse(readFileSync(`${dir}foundry.toml`.replace('foundry.toml', 'out/ArbLab.sol/ArbLab.json'), 'utf8')).metadata?.compiler?.version ?? 'solc 0.8.24',
  bytecode: artifact.bytecode.object,
};
writeFileSync(`${dir}ArbLab.bytecode.json`, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote contracts/ArbLab.bytecode.json (${(out.bytecode.length - 2) / 2} bytes of bytecode, source sha256 ${out.sourceSha256.slice(0, 12)}…)`);
