// Thin helpers over the Pharos Chain MCP tools.

import { SELECTORS, decodeAddress, decodeString, decodeUint, encodeAddress } from './abi.js';

export async function blockNumber(client) {
  return Number((await client.callTool('get_block_number')).blockNumber);
}

// eth_call that treats "tool error" and an empty `0x` result as "this contract
// doesn't answer that" (e.g. no owner()) and returns null. Network and protocol
// failures still throw.
export async function optionalCall(client, to, data, block) {
  try {
    const args = { transaction: { to, data } };
    if (block != null) args.block = block;
    const { result } = await client.callTool('eth_call', args);
    return result && result !== '0x' ? result : null;
  } catch (err) {
    if (err.tool) return null;
    throw err;
  }
}

export async function getCode(client, address, block) {
  const r = await client.callTool('get_code', { address, ...(block != null && { block }) });
  const hex = typeof r === 'string' ? r : r.result ?? r.code ?? '0x';
  return hex === '0x' ? '' : hex;
}

export async function getBlock(client, block) {
  const b = await client.callTool('get_block', { block });
  return { number: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)) };
}

// name / symbol / decimals / totalSupply / owner, each null when the contract
// doesn't implement it. All reads are pinned to one block so they agree.
export async function readToken(client, address, block) {
  const call = (sel, arg = '') => optionalCall(client, address, sel + arg, block);
  const [name, symbol, decimals, totalSupply, owner] = await Promise.all([
    call(SELECTORS.name),
    call(SELECTORS.symbol),
    call(SELECTORS.decimals),
    call(SELECTORS.totalSupply),
    call(SELECTORS.owner),
  ]);
  return {
    name: name && decodeString(name),
    symbol: symbol && decodeString(symbol),
    decimals: decimals ? Number(decodeUint(decimals)) : null,
    totalSupply: totalSupply ? decodeUint(totalSupply) : null,
    owner: owner ? decodeAddress(owner) : null,
  };
}

export async function balanceOf(client, token, holder, block) {
  const raw = await optionalCall(client, token, SELECTORS.balanceOf + encodeAddress(holder), block);
  return raw ? decodeUint(raw) : null;
}
