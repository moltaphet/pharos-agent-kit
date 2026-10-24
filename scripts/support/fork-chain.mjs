// The Chain MCP tools the agents use, answered by a local fork (anvil) so an agent can be run unchanged against throwaway state. Results have the shapes the
// hosted Chain MCP returns; a revert is thrown as the JSON text the hosted server puts in its error, so lib/revert.js reads both the same way.
export function forkChain(rpc) {
  const hex = (n) => '0x' + BigInt(n).toString(16);
  const fail = (e) => {
    const data = e.rpc?.data ?? e.data ?? '0x';
    throw Object.assign(new Error(`eth_call: ${JSON.stringify({ error: { message: e.message.replace(/^.*?(execution reverted)/, '$1'), code: 3, data: typeof data === 'string' ? data : '0x' } })}`), { tool: 'eth_call' });
  };
  return {
    async callTool(name, args) {
      switch (name) {
        case 'get_block_number': return { blockNumber: String(Number(BigInt(await rpc('eth_blockNumber', [])))) };
        case 'get_block': { const b = await rpc('eth_getBlockByNumber', [hex(args.block), false]); return { number: b.number, timestamp: b.timestamp, hash: b.hash }; }
        case 'get_balance': return { balanceWei: BigInt(await rpc('eth_getBalance', [args.address, args.block != null ? hex(args.block) : 'latest'])).toString() };
        case 'get_code': return { code: await rpc('eth_getCode', [args.address, args.block != null ? hex(args.block) : 'latest']) };
        case 'get_gas_price': { const w = BigInt(await rpc('eth_gasPrice', [])); return { gasPriceWei: w.toString(), gasPriceGwei: String(Number(w) / 1e9) }; }
        case 'eth_call': try { return { result: await rpc('eth_call', [args.transaction, args.block != null ? hex(args.block) : 'latest']) }; } catch (e) { return fail(e); }
        case 'estimate_gas': try { return { gas: String(BigInt(await rpc('eth_estimateGas', [args.transaction, args.block != null ? hex(args.block) : 'latest']))) }; } catch (e) { return fail(e); }
        default: throw new Error(`the fork adapter does not serve ${name}`);
      }
    },
  };
}
