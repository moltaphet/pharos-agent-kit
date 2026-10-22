// Thin helpers over the Pharos Chain MCP tools. Each call carries a `why` that
// shows up next to it in the web trace.

import { SELECTORS, decodeAddress, decodeString, decodeUint, encodeAddress } from './abi.js';
import { multicall } from './multicall.js';

export async function blockNumber(client, why = 'Ask which block is the latest') {
  return Number((await client.callTool('get_block_number', {}, { why })).blockNumber);
}

// The block to pin a set of reads to. The hosted Chain MCP is load-balanced and a backend node that is a
// block behind answers "block is not available" for the very latest block (we saw get_code fail at the head
// that get_block_number had just reported, while get_block at the same block worked). Two blocks back every
// node has it, and for a reader the difference is about two seconds.
export const PIN_LAG = 2;
export async function pinnedBlock(client, why = 'Pick the block to read at', lag = PIN_LAG) {
  return Math.max(0, (await blockNumber(client, why)) - lag);
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
// The batch call itself cannot be used (the tool refused it, or its reply does not decode): single calls can still work.
const batchUnusable = (err) => Boolean(err.tool) || err instanceof TypeError || err instanceof RangeError || err instanceof SyntaxError;

export async function readToken(client, address, block) {
  const fields = Object.keys(READS);
  // One Multicall3 call instead of five requests: the hosted server allows 120 requests a minute per IP.
  // A call that fails inside the batch (no owner(), say) comes back as success:false, which is "null" here too.
  let raws;
  try {
    const rows = await multicall(client, fields.map((f) => ({ target: address, data: SELECTORS[f] })), { block, why: `Read ${fields.map((f) => `${f}()`).join(', ')} in one Multicall3 call` });
    raws = rows.map((r) => (r.success && r.data && r.data !== '0x' ? r.data : null));
  } catch (err) {
    if (!batchUnusable(err)) throw err; // network errors and an inconsistent node must surface, not be retried as single calls
    raws = await Promise.all(fields.map((f) => optionalCall(client, address, SELECTORS[f], block, READS[f])));
  }
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

// balanceOf for several holders of one token in a single Multicall3 call. Same result shape as
// balanceOfRaw: the raw hex, or null where the contract has no balanceOf.
export async function balancesRaw(client, token, holders, block) {
  if (!holders.length) return [];
  const rows = await multicall(client, holders.map((h) => ({ target: token, data: SELECTORS.balanceOf + encodeAddress(h) })), { block, why: `balanceOf for ${holders.length} holder${holders.length === 1 ? '' : 's'} in one Multicall3 call` });
  return rows.map((r) => (r.success && r.data && r.data !== '0x' ? r.data : null));
}

// Returns the raw hex of balanceOf(holder), or null if the contract has none.
export function balanceOfRaw(client, token, holder, block) {
  return optionalCall(client, token, SELECTORS.balanceOf + encodeAddress(holder), block, `balanceOf(${holder.slice(0, 8)}…): the wallet’s token balance`);
}

export const balanceOf = async (client, token, holder, block) => {
  const raw = await balanceOfRaw(client, token, holder, block);
  return raw ? decodeUint(raw) : null;
};
