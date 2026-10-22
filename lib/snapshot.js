// Shared by the pharos-read CLI and the web API: one pinned-block snapshot of a contract.

import { balanceOf, blockNumber, getBlock, getCode, readToken } from './chain.js';
import { formatInt, formatUnits } from './abi.js';
import { makeLabeler } from './labels.js';

export class UserError extends Error {}

export async function readSnapshot(client, { address, holders = [], block, labels = {} }) {
  const label = makeLabeler(labels);
  // Pin every read to one block so all values describe the same moment.
  block ??= await blockNumber(client);
  const [chain, header, code, token] = await Promise.all([
    client.callTool('get_chain_info'),
    getBlock(client, block),
    getCode(client, address, block),
    readToken(client, address, block),
  ]);
  if (!code) throw new UserError(`no contract code at ${address} on block ${formatInt(block)} (it's a wallet, or doesn't exist yet)`);

  // Describe any address: our own label if we have one, else wallet vs. contract.
  const describe = async (a) => label(a) ?? ((await getCode(client, a, block)) ? 'unlabelled contract' : 'wallet (no contract code)');
  const fmt = (raw) => (raw == null ? null : token.decimals != null ? formatUnits(raw, token.decimals) : String(raw));

  const [balances, owner] = await Promise.all([
    Promise.all(
      holders.map(async (h) => {
        const raw = await balanceOf(client, address, h, block);
        return { address: h, description: await describe(h), raw: raw?.toString() ?? null, formatted: fmt(raw) };
      }),
    ),
    token.owner ? describe(token.owner).then((description) => ({ address: token.owner, description })) : null,
  ]);

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
  };
}
