// Runtime for the official Pharos SkillEngine's read-command templates.
// Commands come from the pinned skill, use Foundry, and never accept a key.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { validAddress } from './validation.js';

const exec = promisify(execFile);
export const SKILL_COMMIT = 'a873387c9e34e9ae8e71360d43dc33329a335a24';
export const SKILL_SOURCE = `https://github.com/PharosNetwork/pharos-skill-engine/blob/${SKILL_COMMIT}/references/query.md`;
const forbidden = ['--private-key', 'send', 'wallet', '--mnemonic', '--keystore'];

export function createTreasuryTools(config, { execute, Sandbox } = {}) {
  let sandbox;
  let castPath;
  const call = async (args) => {
    if (args.some((arg) => forbidden.includes(arg))) throw new Error('Treasury tools support public reads only.');
    if (execute) return String(await execute(args)).trim();
    if (!process.env.VERCEL) {
      const result = await exec('cast', args, { timeout: 12000, maxBuffer: 64000 });
      return result.stdout.trim();
    }
    if (!sandbox) {
      Sandbox ??= (await import('@vercel/sandbox')).Sandbox;
      const recent = [];
      for await (const item of await Sandbox.list({ tags: { app: 'pharos-treasury-tools' } })) recent.push(item);
      if (recent.filter((item) => ['pending', 'running'].includes(item.status)).length >= 2 || recent.filter((item) => Date.now() - item.createdAt < 3600000).length >= 60) throw new Error('Treasury read tools are at capacity. Retry shortly.');
      const { snapshotId } = JSON.parse(await readFile(new URL('../../config/saga-snapshot.json', import.meta.url), 'utf8'));
      sandbox = await Sandbox.create({ source: { type: 'snapshot', snapshotId }, timeout: 60000, persistent: false, resources: { vcpus: 2 }, tags: { app: 'pharos-treasury-tools' }, networkPolicy: { allow: [new URL(config.rpc).hostname] } });
      const pathResult = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', 'command -v cast || command -v "$HOME/.foundry/bin/cast"'] });
      castPath = (await pathResult.stdout()).trim();
      if (pathResult.exitCode !== 0 || !/^\/[A-Za-z0-9_./-]+$/.test(castPath)) throw new Error('Foundry is unavailable in the read-tool runtime.');
    }
    const result = await sandbox.runCommand({ cmd: castPath, args });
    if (result.exitCode !== 0) throw new Error(`Pharos SkillEngine read failed: ${(await result.stderr()).slice(0, 240)}`);
    return (await result.stdout()).trim();
  };
  const rpcArgs = ['--rpc-url', config.rpc];
  const number = (result) => BigInt(String(result).trim().split(/\s/)[0]).toString();
  return {
    async readWallet({ payer, invoiceId }) {
      validAddress(payer, 'Payer');
      validAddress(config.router, 'Router');
      validAddress(config.token.address, 'Token');
      if (!/^0x[0-9a-f]{64}$/.test(invoiceId)) throw new Error('Invalid invoice ID for public read.');
      const chainId = Number(await call(['chain-id', ...rpcArgs]));
      if (chainId !== 688689) throw new Error('SkillEngine network differs from Atlantic Testnet.');
      const block = Math.max(1, Number(await call(['block-number', ...rpcArgs])) - 2);
      const pinned = [...rpcArgs, '--block', String(block)];
      // Sequential reads respect Atlantic's low public RPC rate limits.
      const nativeBalanceRaw = number(await call(['balance', payer, ...pinned]));
      const tokenBalanceRaw = number(await call(['call', config.token.address, 'balanceOf(address)(uint256)', payer, ...pinned]));
      const decimals = Number(await call(['call', config.token.address, 'decimals()(uint8)', ...pinned]));
      const symbol = (await call(['call', config.token.address, 'symbol()(string)', ...pinned])).replace(/^"|"$/g, '');
      if (decimals !== config.token.decimals || symbol !== config.token.symbol) throw new Error('Live token metadata does not match the configured demo token.');
      const allowanceRaw = number(await call(['call', config.token.address, 'allowance(address,address)(uint256)', payer, config.router, ...pinned]));
      const paidText = await call(['call', config.router, 'paid(address,bytes32)(bool)', payer, invoiceId, ...pinned]);
      if (!['true', 'false'].includes(paidText)) throw new Error('SkillEngine returned an invalid invoice-registry value.');
      const paid = paidText === 'true';
      const routerToken = await call(['call', config.router, 'token()(address)', ...pinned]);
      const tokenCode = await call(['code', config.token.address, ...pinned]);
      const routerCode = await call(['code', config.router, ...pinned]);
      return { chainId, block, nativeBalanceRaw, tokenBalanceRaw, allowanceRaw, paid, routerToken, tokenCode, routerCode };
    },
    async close() { if (sandbox) await sandbox.stop(); },
  };
}
