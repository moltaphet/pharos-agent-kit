// A Chain-MCP-shaped client over any JSON-RPC endpoint, so the tasks written against Chain MCP's tools (Dry-Run, Batch,
// Threshold Guardian...) run unchanged against a network the hosted Chain MCP does not serve, such as Atlantic testnet.
// Results use the same field names as the MCP tools, and a revert is thrown as the MCP does: a tool error whose text is
// JSON { error: { message, code, data } }, which lib/revert.js already decodes.

import { rpcCall } from './rpc.js';

const hex = (n) => '0x' + BigInt(n).toString(16);
const tag = (block) => (block == null ? 'latest' : hex(block));
const ether = (wei) => {
  const s = BigInt(wei).toString().padStart(19, '0');
  return `${s.slice(0, -18)}.${s.slice(-18)}`.replace(/\.?0+$/, '') || '0';
};

export function rpcChain({ url, name = 'Pharos', chainId }) {
  const rpc = (method, params, why) => rpcCall(method, params, { url, why });
  const asToolError = (tool, err) => {
    const e = err.rpc;
    if (!e) return err; // a network failure is not a revert: surface it as it is
    return Object.assign(new Error(`${tool}: ${JSON.stringify({ error: { message: e.message, code: e.code, data: e.data ?? '0x' } })}`), { tool: true });
  };

  return {
    url,
    async callTool(tool, args = {}, meta = {}) {
      const why = meta.why;
      try {
        switch (tool) {
          case 'get_chain_info':
            return { name, chainId: chainId ?? Number(BigInt(await rpc('eth_chainId', [], why))) };
          case 'get_block_number': {
            const n = BigInt(await rpc('eth_blockNumber', [], why));
            return { blockNumber: n.toString(), blockNumberHex: hex(n) };
          }
          case 'get_gas_price': {
            const wei = BigInt(await rpc('eth_gasPrice', [], why));
            return { gasPriceWei: wei.toString(), gasPriceGwei: String(Number(wei) / 1e9) };
          }
          case 'get_balance': {
            const wei = BigInt(await rpc('eth_getBalance', [args.address, tag(args.block)], why));
            return { address: args.address, balanceWei: wei.toString(), balance: ether(wei) };
          }
          case 'get_code':
            return { result: await rpc('eth_getCode', [args.address, tag(args.block)], why) };
          case 'get_block': {
            const b = await rpc('eth_getBlockByNumber', [tag(args.block), false], why);
            return { number: b.number, timestamp: b.timestamp, hash: b.hash };
          }
          case 'eth_call':
            return { result: await rpc('eth_call', [args.transaction, tag(args.block)], why) };
          case 'estimate_gas':
            return { gas: BigInt(await rpc('eth_estimateGas', [args.transaction, tag(args.block)], why)).toString() };
          default:
            throw new Error(`rpcChain does not implement ${tool}`);
        }
      } catch (err) {
        throw asToolError(tool, err);
      }
    },
  };
}

export const ATLANTIC = {
  name: 'Pharos Atlantic Testnet',
  chainId: 688689,
  rpc: 'https://atlantic.dplabs-internal.com',
  explorer: 'https://atlantic.pharosscan.xyz',
  usdc: '0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
};
export const atlanticChain = () => rpcChain({ url: ATLANTIC.rpc, name: ATLANTIC.name, chainId: ATLANTIC.chainId });
