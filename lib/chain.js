// Thin helpers over the Pharos Chain MCP tools. Each call carries a `why` that
// shows up next to it in the web trace.

import { SELECTORS, decodeAddress, decodeString, decodeUint, encodeAddress } from './abi.js';

export async function blockNumber(client, why = 'Ask which block is the latest') {
  return Number((await client.callTool('get_block_number', {}, { why })).blockNumber);
}

// eth_call that treats "tool error" and an empty `0x` result as "this contract
// doesn't answer that" (e.g. no owner()) and returns null. Network and protocol
// failures still throw.
export async function optionalCall(client, to, data, block, why) {
  try {
    const args = { transaction: { to, data } };
    if (block != null) args.block = block;
    const { result } = await client.callTool('eth_call', args, { why });
    return result && result !== '0x' ? result : null;
  } catch (err) {
    if (err.tool) return null;
    throw err;
  }
}

export async function getCode(client, address, block, why = 'Check whether the address holds contract code') {
  const r = await client.callTool('get_code', { address, ...(block != null && { block }) }, { why });
  const hex = typeof r === 'string' ? r : r.result ?? r.code ?? '0x';
  return hex === '0x' ? '' : hex;
}

export async function getBlock(client, block, why = 'Get the block header for its timestamp') {
  const b = await client.callTool('get_block', { block }, { why });
  return { number: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)) };
}

const READS = {
  name: 'name(): the token’s name',
  symbol: 'symbol(): the ticker',
  decimals: 'decimals(): how many decimal places the integer amounts have',
  totalSupply: 'totalSupply(): everything in circulation, as an integer',
  owner: 'owner(): optional, the contract may not have one',
};

// name / symbol / decimals / totalSupply / owner, each null when the contract
// doesn't implement it. All reads are pinned to one block so they agree. `raw`
// keeps the hex each call returned, as evidence for the decoded values.
export async function readToken(client, address, block) {
  const fields = Object.keys(READS);
  const raws = await Promise.all(fields.map((f) => optionalCall(client, address, SELECTORS[f], block, READS[f])));
  const raw = Object.fromEntries(fields.map((f, i) => [f, raws[i]]));
  return {
    name: raw.name && decodeString(raw.name),
    symbol: raw.symbol && decodeString(raw.symbol),
    decimals: raw.decimals ? Number(decodeUint(raw.decimals)) : null,
    totalSupply: raw.totalSupply ? decodeUint(raw.totalSupply) : null,
    owner: raw.owner ? decodeAddress(raw.owner) : null,
    raw,
  };
}

// Returns the raw hex of balanceOf(holder), or null if the contract has none.
export function balanceOfRaw(client, token, holder, block) {
  return optionalCall(client, token, SELECTORS.balanceOf + encodeAddress(holder), block, `balanceOf(${holder.slice(0, 8)}…): the wallet’s token balance`);
}

export const balanceOf = async (client, token, holder, block) => {
  const raw = await balanceOfRaw(client, token, holder, block);
  return raw ? decodeUint(raw) : null;
};
