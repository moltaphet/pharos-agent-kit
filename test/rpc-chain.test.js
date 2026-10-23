import test from 'node:test';
import assert from 'node:assert/strict';
import { rpcChain } from '../lib/rpc-chain.js';
import { parseMcpRevert, decodeRevert } from '../lib/revert.js';

// A scripted JSON-RPC endpoint.
async function withRpc(handlers, fn) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_u, init) => {
    const { method, params } = JSON.parse(init.body);
    sent.push({ method, params });
    const h = handlers[method];
    if (!h) return { status: 200, json: async () => ({ error: { code: -32601, message: `no ${method}` } }) };
    try { const result = h(params); return { status: 200, json: async () => ({ result }) }; } catch (e) { return { status: 200, json: async () => ({ error: e.rpc }) }; }
  };
  try { return await fn(rpcChain({ url: 'http://rpc.test', name: 'Test', chainId: 7 }), sent); } finally { globalThis.fetch = real; }
}
const revert = (message, data = '0x') => Object.assign(new Error(message), { rpc: { code: 3, message, data } });

test('tools return the same fields Chain MCP does', () =>
  withRpc({ eth_blockNumber: () => '0x10', eth_gasPrice: () => '0x2540be400', eth_getBalance: () => '0xde0b6b3a7640000', eth_getCode: () => '0x6080', eth_estimateGas: () => '0x5208', eth_call: () => '0x01', eth_chainId: () => '0x7' }, async (c) => {
    assert.deepEqual(await c.callTool('get_block_number'), { blockNumber: '16', blockNumberHex: '0x10' });
    assert.deepEqual(await c.callTool('get_gas_price'), { gasPriceWei: '10000000000', gasPriceGwei: '10' });
    assert.deepEqual(await c.callTool('get_balance', { address: '0xabc' }), { address: '0xabc', balanceWei: '1000000000000000000', balance: '1' });
    assert.deepEqual(await c.callTool('get_code', { address: '0xabc' }), { result: '0x6080' });
    assert.deepEqual(await c.callTool('estimate_gas', { transaction: {} }), { gas: '21000' });
    assert.deepEqual(await c.callTool('eth_call', { transaction: {} }), { result: '0x01' });
    assert.deepEqual(await c.callTool('get_chain_info'), { name: 'Test', chainId: 7 });
  }));

test('a block argument becomes a hex tag, and no block means latest', () =>
  withRpc({ eth_call: () => '0x' }, async (c, sent) => {
    await c.callTool('eth_call', { transaction: { to: '0x1' }, block: 255 });
    await c.callTool('eth_call', { transaction: { to: '0x1' } });
    assert.deepEqual(sent.map((s) => s.params[1]), ['0xff', 'latest']);
  }));

test('a revert is thrown as an MCP-style tool error that the existing revert decoder understands', () =>
  withRpc({ eth_call: () => { throw revert('execution reverted: ERC20: transfer amount exceeds balance'); } }, async (c) => {
    await assert.rejects(c.callTool('eth_call', { transaction: {} }), (e) => {
      assert.equal(e.tool, true);
      const rv = parseMcpRevert(e);
      assert.equal(rv.code, 3);
      assert.match(decodeRevert(rv.data, rv.message).message, /transfer amount exceeds balance/);
      return true;
    });
  }));

test('a network failure is not turned into a revert', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED'); };
  try {
    await assert.rejects(rpcChain({ url: 'http://x' }).callTool('get_block_number'), (e) => !e.tool && /ECONNREFUSED/.test(e.message));
  } finally { globalThis.fetch = real; }
});

test('unknown tools are refused clearly', () => withRpc({}, async (c) => assert.rejects(c.callTool('get_logs'), /does not implement get_logs/)));
