// The compiled Counter contract (contracts/Counter.sol) the builder agent offers when asked how to deploy a contract: its creation code and the runtime code that must end up on chain.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../contracts/', import.meta.url));
export function counterArtifact() {
  const file = `${DIR}out/Counter.sol/Counter.json`;
  if (!existsSync(file)) execFileSync('forge', ['build'], { cwd: DIR, stdio: 'ignore' });
  const a = JSON.parse(readFileSync(file, 'utf8'));
  return { bytecode: a.bytecode.object, runtime: a.deployedBytecode.object };
}
