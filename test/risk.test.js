import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAINS, checkAddress, levelOf, powersIn, scanCode } from '../lib/risk.js';
import { selectorOf } from '../lib/keccak.js';
import { content } from '../public/js/tasks/wallet-risk-checker.js';

const DAY = 86_400;
const HEAD = 1_000_000;
const NOW = 1_800_000_000;
const A = (n) => '0x' + n.toString(16).padStart(40, '0');
const word = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const push4 = (sig) => '63' + selectorOf(sig).slice(2) + '14'; // PUSH4 selector; EQ
const code = (...parts) => '0x' + parts.join('') + '00';
const blockTime = (n) => NOW - (HEAD - n) * 10;
const ago = (seconds) => Math.max(1, HEAD - Math.round(seconds / 10)); // the block that was `seconds` ago

// a tiny fake chain: accounts by address, with the block at which their code / first transaction appeared
function chainOf(accounts, { logs = [], allowances = {} } = {}) {
  return async (method, params) => {
    const acc = (a) => accounts[a.toLowerCase()] ?? {};
    switch (method) {
      case 'eth_blockNumber': return '0x' + (HEAD + 2).toString(16);
      case 'eth_getBlockByNumber': { const n = parseInt(params[0], 16); return { number: params[0], timestamp: '0x' + blockTime(n).toString(16) }; }
      case 'eth_getCode': { const a = acc(params[0]); if (!a.code) return '0x'; const at = params[1] === 'latest' ? HEAD : parseInt(params[1], 16); return at >= (a.createdBlock ?? 1) ? a.code : '0x'; }
      case 'eth_getStorageAt': { const a = acc(params[0]); return '0x' + word(a.slots?.[params[1]] ?? '0x0'); }
      case 'eth_getTransactionCount': { const a = acc(params[0]); const at = params[1] === 'latest' ? HEAD : parseInt(params[1], 16); return '0x' + (at >= (a.firstTxBlock ?? Infinity) ? (a.nonce ?? 0) : 0).toString(16); }
      case 'eth_getBalance': return '0x' + BigInt(acc(params[0]).balance ?? 0).toString(16);
      case 'eth_getLogs': return logs.filter((l) => (params[0].topics[0] === l.topics[0]) && (!params[0].topics[1] || params[0].topics[1] === l.topics[1]));
      case 'eth_call': {
        const { to, data } = params[0]; const a = acc(to);
        if (data.startsWith(selectorOf('owner()'))) return a.owner ? '0x' + word(a.owner) : '0x';
        if (data.startsWith(selectorOf('admin()'))) return '0x';
        if (data.startsWith(selectorOf('paused()'))) return a.paused ? '0x' + word('0x1') : '0x';
        if (data.startsWith(selectorOf('allowance(address,address)'))) return '0x' + BigInt(allowances[`${to.toLowerCase()}:${'0x' + data.slice(-40)}`] ?? 0n).toString(16).padStart(64, '0');
        return '0x';
      }
      default: throw new Error(method);
    }
  };
}
const chain = { ...CHAINS.mainnet, tokens: [{ symbol: 'USDC', address: A(0xaa), decimals: 6 }], labels: { [A(0xbb)]: 'Known Router' } };
const check = (address, accounts, extra = {}, opts = {}) => checkAddress({ chain, address, rpc: chainOf(accounts, extra), window: 1000, ...opts });

test('scanCode reads instructions, not data: a 0xff inside a PUSH32 is not SELFDESTRUCT', () => {
  const noise = '7f' + 'ff'.repeat(32); // PUSH32 of 0xff…ff
  assert.equal(scanCode(code(noise)).selfdestruct, false);
  assert.equal(scanCode(code('ff')).selfdestruct, true);
  assert.equal(scanCode(code('f4')).delegatecall, true);
  const s = scanCode(code(push4('mint(address,uint256)'), push4('pause()')));
  assert.ok(s.selectors.has(selectorOf('mint(address,uint256)')));
  assert.deepEqual(powersIn(s.selectors).map((p) => p.id), ['mint', 'pause']);
  assert.equal(scanCode(code(noise)).selectors.size, 0);
  const clone = scanCode('0x363d3d373d3d3d363d73' + 'ab'.repeat(20) + '5af43d82803e903d91602b57fd5bf3');
  assert.equal(clone.cloneOf, '0x' + 'ab'.repeat(20));
});

test('the compiler’s metadata trailer is data, not code', () => {
  const meta = 'a2646970667358' + '22'.repeat(10) + 'ff' + '00'.repeat(2); // contains 0xff but is CBOR
  const len = (meta.length / 2).toString(16).padStart(4, '0');
  assert.equal(scanCode('0x6001' + meta + len).selfdestruct, false);
});

test('level rules: a high flag or enough smaller ones make it high; a medium makes it medium', () => {
  const f = (severity) => ({ severity });
  assert.equal(levelOf([]).level, 'low');
  assert.equal(levelOf([f('low')]).level, 'low');
  assert.equal(levelOf([f('low'), f('low')]).level, 'medium');
  assert.equal(levelOf([f('medium')]).level, 'medium');
  assert.equal(levelOf([f('high')]).level, 'high');
  assert.equal(levelOf([f('medium'), f('medium'), f('medium')]).level, 'high');
});

test('clean: an old contract with no owner and no powers is low, and every signal is shown', async () => {
  const r = await check(A(1), { [A(1)]: { code: code('6001'), createdBlock: 1000 } });
  assert.equal(r.level, 'low');
  assert.equal(r.flags.length, 0);
  assert.deepEqual(r.signals.map((s) => s.id), ['age', 'proxy', 'admin', 'opcodes']);
  assert.ok(r.signals.every((s) => s.status === 'ok'));
});

test('risky: a new contract whose single owner can mint and freeze, and that can self-destruct, is high with plain reasons', async () => {
  const r = await check(A(2), { [A(2)]: { code: code(push4('mint(address,uint256)'), push4('blacklist(address)'), 'ff', 'f4'), createdBlock: ago(3600), owner: A(9) } });
  assert.equal(r.level, 'high');
  const ids = r.flags.map((f) => f.id);
  for (const id of ['age', 'admin', 'selfdestruct', 'delegatecall']) assert.ok(ids.includes(id), id);
  assert.match(r.flags.find((f) => f.id === 'admin').plain, /create new tokens out of thin air/);
  assert.match(r.flags.find((f) => f.id === 'age').title, /1 hour ago/);
  assert.equal(r.facts.ownerKind, 'wallet');
  assert.ok(r.flags.every((f) => f.plain.length > 40), 'each flag is explained in a sentence or more');
});

test('powers held by a renounced owner are fine; held by a contract they are lower than a single key', async () => {
  const mint = code(push4('mint(address,uint256)'));
  const renounced = await check(A(3), { [A(3)]: { code: mint, createdBlock: 1000, owner: A(0) } });
  assert.equal(renounced.level, 'low');
  const multisig = await check(A(4), { [A(4)]: { code: mint, createdBlock: 1000, owner: A(5) }, [A(5)]: { code: code('6001'), createdBlock: 1000 } });
  assert.equal(multisig.flags.find((f) => f.id === 'admin').severity, 'low');
  const key = await check(A(6), { [A(6)]: { code: mint, createdBlock: 1000, owner: A(7) } });
  assert.equal(key.flags.find((f) => f.id === 'admin').severity, 'medium');
});

test('an upgradeable proxy is flagged, high when its implementation is new; a clone is not', async () => {
  const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
  const proxy = await check(A(10), { [A(10)]: { code: code('6001'), createdBlock: 1000, slots: { [slot]: A(11) } }, [A(11)]: { code: code('6002'), createdBlock: ago(3600) } });
  assert.equal(proxy.flags.find((f) => f.id === 'proxy').severity, 'high');
  const old = await check(A(10), { [A(10)]: { code: code('6001'), createdBlock: 1000, slots: { [slot]: A(11) } }, [A(11)]: { code: code('6002'), createdBlock: 900 } });
  assert.equal(old.flags.find((f) => f.id === 'proxy').severity, 'medium');
  const clone = await check(A(12), { [A(12)]: { code: '0x363d3d373d3d3d363d73' + 'ab'.repeat(20) + '5af43d82803e903d91602b57fd5bf3', createdBlock: 1000 } });
  assert.equal(clone.flags.length, 0);
});

test('wallets: never-used funded, brand new, thin history, and established', async () => {
  const fresh = await check(A(20), { [A(20)]: { balance: 10n ** 18n } });
  assert.deepEqual(fresh.flags.map((f) => f.id), ['fresh']);
  const novice = await check(A(21), { [A(21)]: { nonce: 2, firstTxBlock: ago(3 * 3600) } });
  assert.equal(novice.flags.find((f) => f.id === 'age').severity, 'medium');
  const week = await check(A(22), { [A(22)]: { nonce: 40, firstTxBlock: ago(3 * DAY) } });
  assert.equal(week.flags.find((f) => f.id === 'age').severity, 'medium');
  const month = await check(A(23), { [A(23)]: { nonce: 40, firstTxBlock: ago(20 * DAY) } });
  assert.equal(month.flags.find((f) => f.id === 'age').severity, 'low');
  const old = await check(A(24), { [A(24)]: { nonce: 500, firstTxBlock: 1000 } });
  assert.equal(old.level, 'low');
  assert.equal(old.facts.nonce, 500);
});

test('approvals: unlimited to an unlabelled contract is flagged (high if that contract is risky); to a labelled protocol or limited is not', async () => {
  const topic = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
  const approval = (owner, spender) => ({ address: A(0xaa), topics: [topic, '0x' + word(owner), '0x' + word(spender)], data: '0x', blockNumber: '0x' + (HEAD - 5).toString(16) });
  const MAX = (1n << 256n) - 1n;
  const wallet = { [A(30)]: { nonce: 100, firstTxBlock: 1000 } };
  const risky = { ...wallet, [A(31)]: { code: code(push4('mint(address,uint256)')), createdBlock: ago(3600), owner: A(9) } };
  const r1 = await check(A(30), risky, { logs: [approval(A(30), A(31))], allowances: { [`${A(0xaa)}:${A(31)}`]: MAX } });
  assert.equal(r1.level, 'high');
  assert.equal(r1.flags.find((f) => f.id === 'approval').severity, 'high');
  assert.match(r1.flags.find((f) => f.id === 'approval').plain, /empty the wallet/);
  const r2 = await check(A(30), { ...wallet, [A(0xbb)]: { code: code('6001'), createdBlock: 1000 } }, { logs: [approval(A(30), A(0xbb))], allowances: { [`${A(0xaa)}:${A(0xbb)}`]: MAX } });
  assert.equal(r2.flags.length, 0, 'a labelled router is shown as a note, not a flag');
  assert.equal(r2.signals.find((s) => s.id === 'approvals').status, 'warn');
  const r3 = await check(A(30), risky, { logs: [approval(A(30), A(31))], allowances: { [`${A(0xaa)}:${A(31)}`]: 1000n } });
  assert.equal(r3.flags.length, 0, 'a limited allowance is not unlimited');
  const r4 = await check(A(30), risky, { logs: [approval(A(30), A(31))], allowances: {} });
  assert.equal(r4.flags.length, 0, 'an approval that was revoked since is not outstanding');
});

test('the flag list: the target, its owner, or a counterparty on your list is high', async () => {
  const plain = { [A(40)]: { code: code('6001'), createdBlock: 1000, owner: A(41) }, [A(41)]: {} };
  assert.equal((await check(A(40), plain)).level, 'low', 'without a flag list, an owner of a plain contract is nothing to worry about');
  const r1 = await check(A(40), plain, {}, { flagged: [A(41)] });
  assert.equal(r1.level, 'high', 'with the owner on your list it is high');
  const r2 = await check(A(42), { [A(42)]: { code: code(push4('mint(address,uint256)')), createdBlock: 1000, owner: A(41) } }, {}, { flagged: [A(41)] });
  assert.equal(r2.level, 'high');
  assert.ok(r2.flags.some((f) => f.id === 'flagged'));
  const r3 = await check(A(43), { [A(43)]: { nonce: 100, firstTxBlock: 1000 } }, {}, { flagged: [A(43)] });
  assert.ok(r3.flags.some((f) => f.id === 'self' && f.severity === 'high'));
});

test('input is validated', async () => {
  for (const address of [undefined, '0x123', 'hello', '0x' + 'g'.repeat(40)]) await assert.rejects(checkAddress({ chain, address, rpc: chainOf({}) }), /address/);
  await assert.rejects(checkAddress({ chain, address: A(1), rpc: chainOf({}), window: 10 }), /window/);
  await assert.rejects(checkAddress({ chain, address: A(1), rpc: chainOf({}), flagged: ['nope'] }), /flagged/);
});

test('the recorded examples: clean ones low, USDC medium, risky ones high; at least four signals', () => {
  const r = JSON.parse(readFileSync(new URL('../reports/risk-run.json', import.meta.url), 'utf8'));
  const by = Object.fromEntries(r.examples.map((e) => [e.id, e.result]));
  assert.equal(by.wpros.level, 'low');
  assert.equal(by['old-wallet'].level, 'low');
  assert.equal(by.usdc.level, 'medium');
  assert.equal(by['risky-token'].level, 'high');
  assert.equal(by['fresh-wallet'].level, 'high');
  assert.ok(r.summary.signalsChecked >= 4);
  for (const e of r.examples) for (const f of e.result.flags) assert.ok(f.plain && f.severity && f.title);
  assert.ok(by['risky-token'].flags.some((f) => /destroy/.test(f.title)));
});

test('a node that cannot give old state does not sink the check: the age is "unknown" and the other signals stand', async () => {
  const base = chainOf({ [A(60)]: { code: code('6001'), createdBlock: 1000 }, [A(61)]: { nonce: 50, firstTxBlock: 1000 } });
  const noOld = async (m, p) => { if ((m === 'eth_getCode' || m === 'eth_getTransactionCount') && p[1] !== 'latest' && parseInt(p[1], 16) < HEAD - 10) throw new Error('missing trie node'); return base(m, p); };
  const contract = await checkAddress({ chain, address: A(60), rpc: noOld, window: 1000 });
  assert.equal(contract.signals.find((s) => s.id === 'age').status, 'na');
  assert.ok(contract.signals.some((s) => s.id === 'admin'));
  const wallet = await checkAddress({ chain, address: A(61), rpc: noOld, window: 1000 });
  assert.equal(wallet.signals.find((s) => s.id === 'age').status, 'na');
  assert.match(wallet.signals.find((s) => s.id === 'age').detail, /could not give the date/);
});

test('the web handler refuses inherited chain names before any read', async () => {
  const handler = (await import('../lib/tasks/wallet-risk-checker.js')).default;
  for (const chain of ['__proto__', 'constructor', 'toString']) await assert.rejects(handler({ q: { check: '1', chain, address: A(1) } }), /chain must be mainnet or atlantic/, chain);
});

test('task page', () => {
  assert.equal(content.evidence.length, 4);
  assert.doesNotMatch(JSON.stringify(content), /simulated|mock/i);
});
