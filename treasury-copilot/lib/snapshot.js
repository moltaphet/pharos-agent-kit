// Shared by the pharos-read CLI and the web API: one pinned-block snapshot of a contract.

import { balancesRaw, getBlock, getCode, pinnedBlock, readToken } from './chain.js';
import { SELECTORS, decodeUint, encodeAddress, formatInt, formatUnits } from './abi.js';
import { makeLabeler, shortAddress } from './labels.js';
import { UnstableReadError } from './stable.js';

export class UserError extends Error {}
class NoCodeError extends UserError {}

// Pins to a block just behind the head, reads, and double-checks a "there is no contract here" answer: a
// backend node that lags answers get_code with an EMPTY result (not an error) for a contract it has not
// caught up to, and two reads from it agree. Only if the latest block has no code either is it a wallet.
export async function readSnapshot(client, opts) {
  if (opts.block != null) return snapshotAt(client, opts); // an explicit historical block is taken as given
  for (let attempt = 1; ; attempt++) {
    const block = await pinnedBlock(client, 'Ask for the latest block, then pin every read to a block just behind it (every backend node has it)');
    try {
      return await snapshotAt(client, { ...opts, block });
    } catch (err) {
      if (!(err instanceof NoCodeError)) throw err;
      const now = await getCode(client, opts.address, undefined, 'Is there code at the latest block? (the pinned block may be one a lagging node does not have yet)');
      if (!now) throw err; // no code at the latest block either: a wallet, for real
      if (attempt >= 3) throw new UnstableReadError(`the node says there is no code at block ${formatInt(block)} but there is at the latest block; it is returning inconsistent state, so no value is shown`);
    }
  }
}

async function snapshotAt(client, { address, holders = [], block, labels = {} }) {
  const label = makeLabeler(labels);
  const [chain, header, code, token] = await Promise.all([
    client.callTool('get_chain_info', {}, { why: 'Confirm which network the server is talking to' }),
    getBlock(client, block, 'Get the pinned block’s timestamp'),
    getCode(client, address, block, 'Confirm the address is a contract (wallets have no code)'),
    readToken(client, address, block),
  ]);
  if (!code) throw new NoCodeError(`no contract code at ${address} on block ${formatInt(block)} (it's a wallet, or doesn't exist yet)`);

  // Describe any address: our own label if we have one, else wallet vs. contract.
  // An empty answer at the pinned block is double-checked at the latest block before calling something a wallet.
  const hasCode = async (a) => (await getCode(client, a, block, `Is ${shortAddress(a)} a contract or a wallet?`)) || (await getCode(client, a, undefined, `No code at the pinned block: is ${shortAddress(a)} really a wallet? (check the latest block)`));
  const describe = async (a) => label(a) ?? ((await hasCode(a)) ? 'unlabelled contract' : 'wallet (no contract code)');
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
