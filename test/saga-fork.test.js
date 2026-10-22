import test from 'node:test';
import assert from 'node:assert/strict';
import { forkIO } from '../lib/saga-fork.js';

// A scripted JSON-RPC endpoint: handlers[method](params) -> result, or throws { message }.
function withRpc(handlers, fn) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    sent.push({ method, params });
    try {
      const result = await handlers[method]?.(params);
      return { json: async () => ({ jsonrpc: '2.0', id, result }) };
    } catch (err) {
      return { json: async () => ({ jsonrpc: '2.0', id, error: { message: err.message } }) };
    }
  };
  return fn(sent).finally(() => (globalThis.fetch = real));
}

const tx = { from: '0x1', to: '0x2', data: '0xdeadbeef' };

test('send adds 30% headroom to the estimated gas', () =>
  withRpc({ eth_estimateGas: () => '0x186a0' /* 100,000 */, eth_sendTransaction: () => '0xhash' }, async (sent) => {
    await forkIO('http://x').send(tx);
    const out = sent.find((s) => s.method === 'eth_sendTransaction').params[0];
    assert.equal(BigInt(out.gas), 130_000n);
  }));

test('an explicit gas limit is used as given', () =>
  withRpc({ eth_sendTransaction: () => '0xhash' }, async (sent) => {
    await forkIO('http://x').send({ ...tx, gas: 500_000 });
    assert.equal(BigInt(sent.find((s) => s.method === 'eth_sendTransaction').params[0].gas), 500_000n);
    assert.ok(!sent.some((s) => s.method === 'eth_estimateGas'));
  }));

test('when the estimate itself reverts the transaction is still sent, so the revert is mined and reported', () =>
  withRpc({ eth_estimateGas: () => { throw new Error('execution reverted: ZeroAddress'); }, eth_sendTransaction: () => '0xhash' }, async (sent) => {
    await forkIO('http://x').send(tx);
    assert.equal(BigInt(sent.find((s) => s.method === 'eth_sendTransaction').params[0].gas), 3_000_000n);
  }));

const revertedReceipt = (gasUsed) => ({
  eth_getTransactionReceipt: () => ({ status: '0x0', blockNumber: '0x64', gasUsed: '0x' + gasUsed.toString(16) }),
  eth_getTransactionByHash: () => ({ from: '0x1', to: '0x2', input: '0xdead', gas: '0x' + (263_262).toString(16) }),
});

test('a revert with no reason that used its whole gas limit is reported as out of gas', () =>
  withRpc({ ...revertedReceipt(263_262), eth_call: () => '0x' /* a plain call succeeds */ }, async () => {
    const r = await forkIO('http://x').receipt('0xhash');
    assert.equal(r.status, 'reverted');
    assert.match(r.reason, /out of gas \(used 263,262 of a 263,262 limit\)/);
  }));

test('a revert with a real reason keeps that reason, even when it used a lot of gas', () =>
  withRpc({ ...revertedReceipt(263_262), eth_call: () => { throw new Error('execution reverted: ZeroAddress'); } }, async () => {
    assert.match((await forkIO('http://x').receipt('0xhash')).reason, /ZeroAddress/);
  }));

test('a revert that stopped well below its limit is not called out of gas', () =>
  withRpc({ ...revertedReceipt(60_000), eth_call: () => '0x' }, async () => {
    assert.equal((await forkIO('http://x').receipt('0xhash')).reason, undefined);
  }));
