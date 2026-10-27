// Compiled bytecode of the tiny contracts the testnet run deploys (contracts/*.sol), built with `forge build` on demand.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../contracts/', import.meta.url));
function bytecode(name) {
  const artifact = `${DIR}out/${name}.sol/${name}.json`;
  if (!existsSync(artifact)) execFileSync('forge', ['build'], { cwd: DIR, stdio: 'ignore' });
  return JSON.parse(readFileSync(artifact, 'utf8')).bytecode.object;
}
export const counterBytecode = () => bytecode('Counter');
export const ledgerBytecode = () => bytecode('Ledger');
export const testUsdcBytecode = () => bytecode('TestUSDC');
export const failLabBytecode = () => bytecode('FailLab');
export const riskyTokenBytecode = () => bytecode('RiskyToken');
