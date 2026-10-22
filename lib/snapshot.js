// Shared by the pharos-read CLI and the web API: one pinned-block snapshot of a contract.

import { balancesRaw, getBlock, getCode, pinnedBlock, readToken } from './chain.js';
import { SELECTORS, decodeUint, encodeAddress, formatInt, formatUnits } from './abi.js';
import { makeLabeler, shortAddress } from './labels.js';

export class UserError extends Error {}

export async function readSnapshot(client, { address, holders = [], block, labels = {} }) {
  const label = makeLabeler(labels);
  // Pin every read to one block so all values describe the same moment.
  block ??= await pinnedBlock(client, 'Ask for the latest block, then pin every read to a block just behind it (every backend node has it)');
  const [chain, header, code, token] = await Promise.all([
    client.callTool('get_chain_info', {}, { why: 'Confirm which network the server is talking to' }),
    getBlock(client, block, 'Get the pinned block’s timestamp'),
    getCode(client, address, block, 'Confirm the address is a contract (wallets have no code)'),
    readToken(client, address, block),
  ]);
  if (!code) throw new UserError(`no contract code at ${address} on block ${formatInt(block)} (it's a wallet, or doesn't exist yet)`);

  // Describe any address: our own label if we have one, else wallet vs. contract.
  const describe = async (a) => label(a) ?? ((await getCode(client, a, block, `Is ${shortAddress(a)} a contract or a wallet?`)) ? 'unlabelled contract' : 'wallet (no contract code)');
  const fmt = (raw) => (raw == null ? null : token.decimals != null ? formatUnits(raw, token.decimals) : String(raw));

  const balanceRaws = await balancesRaw(client, address, holders, block);
  const [balances, owner] = await Promise.all([
    Promise.all(
      holders.map(async (h, i) => {
        const raw = balanceRaws[i] ? decodeUint(balanceRaws[i]) : null;
        return { address: h, description: await describe(h), raw: raw?.toString() ?? null, formatted: fmt(raw) };
      }),
    ),
    token.owner ? describe(token.owner).then((description) => ({ address: token.owner, description })) : null,
  ]);

  // Each value next to the exact call that produced it, so the page can show the working.
  const shown = {
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    totalSupply: token.totalSupply == null ? null : `${token.totalSupply} (raw integer)`,
    owner: token.owner,
  };
  const evidence = [
    ...Object.keys(shown).map((f) => ({ field: `${f}()`, data: SELECTORS[f], raw: token.raw[f], decoded: shown[f] == null ? null : String(shown[f]) })),
    ...holders.map((h, i) => ({
      field: `balanceOf(${shortAddress(h)})`,
      data: SELECTORS.balanceOf + encodeAddress(h),
      raw: balanceRaws[i],
      decoded: balanceRaws[i] ? `${decodeUint(balanceRaws[i])} (raw integer)` : null,
    })),
  ];

  return {
    contract: address,
    network: { name: chain.name, chainId: chain.chainId },
    block: { number: block, timestamp: header.timestamp },
    codeBytes: (code.length - 2) / 2,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    totalSupply: token.totalSupply == null ? null : { raw: token.totalSupply.toString(), formatted: fmt(token.totalSupply) },
    owner,
    balances,
    evidence,
  };
}
