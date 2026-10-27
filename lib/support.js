// dApp support agent: takes the hash of a failed transaction and says, in plain language, why it failed and what to do. It reads the transaction and its receipt, replays the call on the
// state just before its block to get the contract's own answer (Error(string), Panic, a custom error, or nothing), checks the numbers behind the common causes (token balance,
// allowance, native balance, gas), and explains the result. Reads only; the transaction and receipt come through Chain MCP on mainnet, or the RPC on Atlantic testnet.

import { formatUnits, isAddress } from './abi.js';
import { selectorOf } from './keccak.js';
import { decodeRevert, parseMcpRevert } from './revert.js';
import { scanCode } from './risk.js';
import { shortAddress } from './labels.js';
import { UserError } from './snapshot.js';

const hex = (n) => '0x' + BigInt(n).toString(16);
const big = (h) => BigInt(h ?? '0x0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const SEL = { transfer: selectorOf('transfer(address,uint256)'), transferFrom: selectorOf('transferFrom(address,address,uint256)'), approve: selectorOf('approve(address,uint256)'), balanceOf: selectorOf('balanceOf(address)'), allowance: selectorOf('allowance(address,address)'), symbol: selectorOf('symbol()'), decimals: selectorOf('decimals()') };
const PANIC_TEXT = {
  '0x01': 'an internal safety check (an assert) failed', '0x11': 'a calculation overflowed or went below zero', '0x12': 'the contract divided a number by zero', '0x21': 'a value that is not allowed was used', '0x31': 'the contract tried to remove from an empty list',
  '0x32': 'the contract looked up a list position that does not exist', '0x41': 'the contract asked for too much memory', '0x51': 'the contract called something that was never set up',
};

// ---- the data tools ----------------------------------------------------------------------------------------------------------------------

/** Tools backed by Chain MCP (mainnet): the same questions, asked through the MCP server. */
export function mcpTools(client) {
  const call = (name, args, why) => client.callTool(name, args, { why });
  return {
    via: 'Chain MCP',
    getTx: async (hash) => { try { return await call('get_transaction', { hash }, 'Fetch the failed transaction'); } catch (e) { if (/not found|null/i.test(e.message)) return null; throw e; } },
    getReceipt: async (hash) => { try { return await call('get_transaction_receipt', { hash }, 'Fetch the receipt of the failed transaction'); } catch (e) { if (/not found|null/i.test(e.message)) return null; throw e; } },
    replay: async (tx, block) => {
      try { const r = await call('eth_call', { transaction: tx, block }, `Replay the failed call on block ${block}, just before it`); return { ok: true, data: r.result ?? '0x' }; }
      catch (err) { const r = parseMcpRevert(err); if (r) return { ok: false, data: r.data ?? '0x', message: r.message }; return { ok: false, data: '0x', message: String(err.message), unreadable: true }; }
    },
    read: async (to, data, block) => { try { return (await call('eth_call', { transaction: { to, data }, block }, 'Read a value on the block before the failure')).result; } catch { return null; } },
    balance: async (address, block) => { try { const r = await call('get_balance', { address, block }, 'Read the sender’s PROS balance'); return BigInt(r.balanceWei ?? r.balance ?? r.wei ?? r.result ?? 0); } catch { return null; } },
    code: async (address) => { try { const r = await call('get_code', { address }, 'Check that the target is a contract'); return r.code ?? r.result ?? '0x'; } catch { return null; } },
  };
}

/** Tools backed by a JSON-RPC function (Atlantic testnet). `rpc(method, params)` may throw an error carrying the node's revert data. */
export function rpcTools(rpc, via = 'RPC') {
  const revertOf = (err) => { const e = err?.rpc ?? err?.data ?? null; const m = String(err?.message ?? ''); const data = typeof e === 'object' ? e?.data : typeof e === 'string' ? e : null; return { data: typeof data === 'string' && data.startsWith('0x') ? data : (m.match(/0x[0-9a-fA-F]{8,}/)?.[0] ?? '0x'), message: m }; };
  return {
    via,
    getTx: async (hash) => rpc('eth_getTransactionByHash', [hash]),
    getReceipt: async (hash) => rpc('eth_getTransactionReceipt', [hash]),
    replay: async (tx, block) => { try { return { ok: true, data: await rpc('eth_call', [tx, hex(block)]) }; } catch (err) { return { ok: false, ...revertOf(err) }; } },
    read: async (to, data, block) => { try { return await rpc('eth_call', [{ to, data }, hex(block)]); } catch { return null; } },
    balance: async (address, block) => { try { return big(await rpc('eth_getBalance', [address, hex(block)])); } catch { return null; } },
    code: async (address) => { try { return await rpc('eth_getCode', [address, 'latest']); } catch { return null; } },
  };
}

const norm = (v) => (v == null ? null : typeof v === 'string' ? v : v);
const txFields = (tx) => ({ hash: tx.hash, from: tx.from?.toLowerCase(), to: tx.to?.toLowerCase() ?? null, value: big(tx.value), gas: big(tx.gas ?? tx.gasLimit), gasPrice: big(tx.gasPrice ?? tx.effectiveGasPrice ?? 0), input: tx.input ?? tx.data ?? '0x', blockNumber: tx.blockNumber != null ? Number(big(tx.blockNumber)) : null, nonce: tx.nonce });

// ---- diagnosis ----------------------------------------------------------------------------------------------------------------------------

const word = (hexData, i) => BigInt('0x' + hexData.slice(10 + i * 64, 10 + (i + 1) * 64));
const wordAddr = (hexData, i) => '0x' + hexData.slice(10 + i * 64 + 24, 10 + (i + 1) * 64);

async function tokenInfo(tools, token, block) {
  const [s, d] = await Promise.all([tools.read(token, SEL.symbol, block), tools.read(token, SEL.decimals, block)]);
  let symbol = shortAddress(token);
  if (s && s.length >= 130) { const len = Number(BigInt('0x' + s.slice(66, 130))); if (len > 0 && len < 32) symbol = Buffer.from(s.slice(130, 130 + len * 2), 'hex').toString('utf8').replace(/[^\x20-\x7e]/g, '') || symbol; }
  else if (s && s.length === 66) symbol = Buffer.from(s.slice(2), 'hex').toString('utf8').replace(/\0+$/, '').replace(/[^\x20-\x7e]/g, '') || symbol;
  return { symbol, decimals: d && d.length >= 66 ? Number(BigInt(d.slice(0, 66))) : 18 };
}
const fmt = (raw, info) => `${formatUnits(raw, info.decimals)} ${info.symbol}`;

// custom errors of widely used contracts (Uniswap's Universal Router and Permit2, common patterns), by signature; the 4-byte selector is computed here
const KNOWN_ERRORS = Object.fromEntries([
  ['V3TooLittleReceived()', 'slippage'], ['V2TooLittleReceived()', 'slippage'], ['V3TooMuchRequested()', 'slippage'], ['V2TooMuchRequested()', 'slippage'], ['SlippageExceeded()', 'slippage'], ['InsufficientOutputAmount()', 'slippage'], ['TooLittleReceived()', 'slippage'],
  ['TransactionDeadlinePassed()', 'deadline'], ['DeadlineExpired()', 'deadline'], ['DeadlinePassed()', 'deadline'], ['SignatureExpired(uint256)', 'deadline'], ['AllowanceExpired(uint256)', 'insufficient-allowance'], ['InsufficientAllowance(uint256)', 'insufficient-allowance'],
  ['BalanceTooLow()', 'insufficient-token-balance'], ['InsufficientBalance()', 'insufficient-token-balance'], ['NotEnoughBalance()', 'insufficient-token-balance'], ['InsufficientETH()', 'insufficient-token-balance'],
  ['Unauthorized()', 'not-authorized'], ['NotAuthorized()', 'not-authorized'], ['NotOwner()', 'not-authorized'], ['OnlyOwner()', 'not-authorized'], ['InvalidCaller()', 'not-authorized'], ['NotWhitelisted()', 'not-authorized'],
  ['Paused()', 'paused-or-blocked'], ['TransferFailed()', 'transfer-failed'], ['InvalidNonce()', 'deadline'],
].map(([sig, cat]) => [selectorOf(sig), { name: sig.replace(/\(.*/, ''), cat }]));

const RULES = [
  { id: 'insufficient-token-balance', test: /exceeds balance|insufficient balance|balance too low|not enough balance|InsufficientBalance|burn amount exceeds|transfer amount exceeds/i },
  { id: 'insufficient-allowance', test: /allowance|InsufficientAllowance/i },
  { id: 'not-authorized', test: /owner only|only ?owner|only ?admin|not the owner|caller is not|not authori[sz]ed|unauthori[sz]ed|access ?control|OwnableUnauthorizedAccount|forbidden|permission/i },
  { id: 'paused-or-blocked', test: /paused|EnforcedPause|blocked|blacklist|frozen|banned/i },
  { id: 'slippage', test: /INSUFFICIENT_OUTPUT_AMOUNT|slippage|too little received|insufficient output|min(imum)? ?(amount|return|out)|price impact|excessive input|\bSPL\d?\b|price slippage check/i },
  { id: 'deadline', test: /expired|deadline|too late|too old|timeout/i },
  { id: 'zero-address', test: /zero address|ZeroAddress|invalid (sender|receiver|spender|address)/i },
  { id: 'transfer-failed', test: /transfer ?failed|safe ?transfer|STF|TRANSFER_FAILED|SafeERC20/i },
];

const EXPLAIN = {
  'insufficient-token-balance': { cause: 'The account did not hold enough of the token for this transaction.', fix: ['Check the token balance of the sending account and lower the amount, or add more of the token first.', 'Remember that amounts are in the token’s smallest unit: 1 USDC is 1,000,000 units.'] },
  'insufficient-allowance': { cause: 'The contract was not allowed to spend that many tokens on the account’s behalf.', fix: ['Approve the contract (the spender) for at least the amount first, then repeat the transaction.', 'Approve only what you need; an unlimited approval stays open until you revoke it.'] },
  'not-authorized': { cause: 'The account is not allowed to do this: the function is restricted to an owner or administrator.', fix: ['Use the account that owns or administers the contract, or ask its owner to do it.', 'If you are not meant to call this function, you picked the wrong action or the wrong contract.'] },
  'paused-or-blocked': { cause: 'The contract is paused, or this account is blocked from using it.', fix: ['Wait until the owner unpauses the contract, or ask the project why the account is blocked.', 'Check the project’s announcements before trying again: repeating the transaction will fail the same way.'] },
  slippage: { cause: 'The price moved against the swap: it would have returned less than the minimum you asked for.', fix: ['Try again with a higher slippage tolerance, or a smaller amount, if you accept a worse price.', 'Check the pool’s liquidity: a thin pool moves a lot on a large trade.'] },
  deadline: { cause: 'The transaction waited too long and its deadline had passed when it was mined.', fix: ['Submit it again; the app will set a fresh deadline.', 'Pay a slightly higher fee so it is mined sooner, and avoid very short deadlines.'] },
  'zero-address': { cause: 'An address in the transaction was empty (all zeros), which the contract does not accept.', fix: ['Check the recipient or spender address you typed or pasted, and try again with the right one.'] },
  'transfer-failed': { cause: 'A token transfer inside the transaction was refused by the token.', fix: ['Check that the account holds enough of the token, has approved the contract, and that the token is not paused or blocking this account.'] },
};

/**
 * Diagnose a failed transaction. `tools` come from mcpTools() or rpcTools().
 * Returns { status, category, headline, plain, fix[], evidence, facts, links, steps[] }.
 */
export async function diagnose({ hash, tools, explorer = 'https://www.pharosscan.xyz' }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) throw new UserError('a transaction hash is 0x followed by 64 hexadecimal digits');
  const steps = [];
  const link = `${explorer}/tx/${hash}`;
  const rawTx = await tools.getTx(hash);
  if (!rawTx) return { status: 'not-found', category: 'not-found', headline: 'This network has no transaction with that hash', plain: 'No transaction with that hash exists on this network. It may have been dropped before it was mined, sent on a different network, or the hash has a typo.', fix: ['Check that you are looking at the right network (Pharos mainnet and Atlantic testnet are separate).', 'If your wallet shows it as pending for a long time, it was probably never mined: speed it up or cancel it from the wallet.'], steps: [{ tool: tools.via, what: 'Looked the hash up', result: 'not found' }], links: { explorer: link } };
  const tx = txFields(rawTx);
  const rc = await tools.getReceipt(hash);
  steps.push({ tool: tools.via, what: 'Fetched the transaction and its receipt', result: rc ? `mined in block ${Number(big(rc.blockNumber)).toLocaleString('en-US')}` : 'no receipt yet' });
  if (!rc) return { status: 'pending', category: 'pending', headline: 'The transaction has not been mined yet', plain: 'It was sent but is not in a block. It is waiting, or it was dropped.', fix: ['Wait a few minutes. If it stays pending, speed it up or cancel it from your wallet.'], steps, links: { explorer: link }, facts: { from: tx.from, to: tx.to } };
  const used = big(rc.gasUsed); const block = Number(big(rc.blockNumber));
  const facts = { from: tx.from, to: tx.to, valueWei: tx.value.toString(), gasLimit: tx.gas.toString(), gasUsed: used.toString(), block, selector: tx.input.length >= 10 ? tx.input.slice(0, 10) : null, creation: tx.to == null };
  if (big(rc.status) === 1n) return { status: 'succeeded', category: 'succeeded', headline: 'This transaction did not fail', plain: `It succeeded in block ${block.toLocaleString('en-US')}. If something looks wrong, the issue is not a failure: check the transaction’s logs and token transfers on the explorer.`, fix: [], steps, facts, links: { explorer: link } };

  const evidence = {};
  const outOfGasShape = used * 100n >= tx.gas * 98n;
  // replay on the state just before the block, with the same sender, target, data, value and gas
  const call = { from: tx.from, data: tx.input, value: hex(tx.value), gas: hex(tx.gas) };
  if (tx.to) call.to = tx.to;
  const replay = await tools.replay(call, block - 1);
  steps.push({ tool: tools.via, what: `Replayed the call on block ${(block - 1).toLocaleString('en-US')}, the state just before the failure`, result: replay.ok ? 'it succeeded on that state' : replay.data && replay.data !== '0x' ? `the contract answered ${replay.data.slice(0, 74)}${replay.data.length > 74 ? '…' : ''}` : 'it reverted with no message' });
  const dec = replay.ok ? null : decodeRevert(replay.data, replay.message ?? '');
  const known = dec?.kind === 'custom' && !dec.name ? KNOWN_ERRORS[dec.selector] : null;
  const reason = known ? known.name : dec?.kind === 'empty' ? '' : dec?.message ?? ''; // an empty revert has no words of the contract's own
  const sel = facts.selector;
  const token = tx.to && [SEL.transfer, SEL.transferFrom, SEL.approve].includes(sel) ? tx.to : null;
  const done = (category, headline, plain, fix, extra = {}) => ({ status: 'failed', category, headline, plain, fix, reason: reason || null, revertKind: dec?.kind ?? null, evidence, facts, steps, links: { explorer: link }, ...extra });

  // 1. out of gas: the transaction used (almost) all the gas it was given and the contract gave no reason
  if (outOfGasShape && (!dec || dec.kind === 'empty')) {
    evidence.gas = { limit: tx.gas.toString(), used: used.toString(), percent: Number((used * 10000n) / tx.gas) / 100 };
    return done('out-of-gas', 'It ran out of gas', `The transaction was given ${tx.gas.toLocaleString('en-US')} units of gas and used ${used.toLocaleString('en-US')} of them (${evidence.gas.percent}%) before the work was finished, so the network stopped it and undid everything. The fee for the gas used was still paid.`,
      ['Send it again with a higher gas limit: most wallets let you edit it, or use “estimate” instead of a fixed number.', 'Do not set the gas limit by hand to a round number; let the wallet estimate it, then add 20% of margin.']);
  }
  // 2. the replay succeeded: the situation changed between the node’s view and the block
  if (replay.ok) {
    return done('state-changed', 'It would work now: something changed just before it was mined', 'Replayed on the state just before its block, the same call succeeds. So it failed because of something that happened in the same block before it, most often another transaction that changed a price, a balance or a limit it depended on.',
      ['Try the transaction again; it will probably go through.', 'If it is a swap or a mint, raise the slippage tolerance or the price limit, since a busy block moves prices.']);
  }
  // 3. a reason from the contract
  const rule = known ? { id: known.cat } : RULES.find((r) => r.test.test(reason));
  if (dec && dec.kind === 'Panic') {
    const code = replay.data.slice(2 + 8 + 56, 2 + 8 + 64); // last byte of the panic code word
    const text = PANIC_TEXT['0x' + code.replace(/^0+/, '').padStart(2, '0')] ?? 'the contract hit a built-in error';
    return done('panic', 'The contract hit a bug-like error', `The contract stopped because ${text}. This is not a problem with your account or your fee: the input you sent made the contract’s own code fail in a way its authors did not guard against.`,
      ['Check the values you entered: a zero where a number is expected, or an index that is too large, are common triggers.', 'If the app’s inputs were valid, tell the app’s team: this is a bug in the contract.']);
  }
  if (rule) {
    const info = EXPLAIN[rule.id];
    // the numbers behind a balance or allowance failure
    if (token && rule.id.startsWith('insufficient')) {
      const t = await tokenInfo(tools, token, block - 1);
      const owner = sel === SEL.transferFrom ? wordAddr(tx.input, 0) : tx.from;
      const amount = sel === SEL.transferFrom ? word(tx.input, 2) : sel === SEL.transfer ? word(tx.input, 1) : null;
      const bal = await tools.read(token, SEL.balanceOf + addrWord(owner), block - 1);
      if (bal) evidence.balance = { holder: owner, balance: BigInt(bal).toString(), formatted: fmt(BigInt(bal), t), needed: amount?.toString() ?? null, neededFormatted: amount != null ? fmt(amount, t) : null, token };
      if (sel === SEL.transferFrom) {
        const al = await tools.read(token, SEL.allowance + addrWord(owner) + addrWord(tx.from), block - 1);
        if (al) evidence.allowance = { owner, spender: tx.from, allowance: BigInt(al).toString(), formatted: fmt(BigInt(al), t), needed: amount?.toString() ?? null, neededFormatted: amount != null ? fmt(amount, t) : null };
      }
      // the numbers decide which one it really was
      let id = rule.id;
      if (sel === SEL.transferFrom && evidence.allowance && amount != null) id = BigInt(evidence.allowance.allowance) < amount ? 'insufficient-allowance' : evidence.balance && BigInt(evidence.balance.balance) < amount ? 'insufficient-token-balance' : id;
      const e = EXPLAIN[id];
      const numbers = id === 'insufficient-allowance' && evidence.allowance ? ` The spender was approved for ${evidence.allowance.formatted} and needed ${evidence.allowance.neededFormatted}.` : evidence.balance ? ` The account held ${evidence.balance.formatted}${evidence.balance.neededFormatted ? ` and the transaction needed ${evidence.balance.neededFormatted}` : ''}.` : '';
      return done(id, id === 'insufficient-allowance' ? 'The contract was not approved to spend enough' : 'Not enough tokens', `${e.cause}${numbers}`, e.fix, { reason });
    }
    return done(rule.id, ({ 'not-authorized': 'This account is not allowed to do that', 'paused-or-blocked': 'The contract is paused or the account is blocked', slippage: 'The price moved too much', deadline: 'The deadline passed', 'zero-address': 'An address was empty', 'transfer-failed': 'A token transfer was refused', 'insufficient-token-balance': 'Not enough tokens', 'insufficient-allowance': 'The contract was not approved to spend enough' })[rule.id], `${info.cause} The contract’s own message was “${reason}”.`, info.fix);
  }
  if (dec && dec.kind !== 'empty') {
    const custom = dec.kind === 'custom' && !dec.name;
    return done(custom ? 'custom-error' : 'revert-reason', custom ? 'The contract refused with an error code' : 'The contract refused with a message', custom ? `The contract rejected the call with a custom error (${dec.selector}) that this tool does not know by name. That means the contract’s own rules were not met; the error’s name will be in the contract’s source or its ABI.` : `The contract refused the transaction and gave this reason: “${reason}”. That is the contract’s own rule, so the fix depends on what the rule means.`,
      [custom ? `Look the code ${dec.selector} up in the contract’s verified source or on a signature database such as 4byte.directory.` : `Read the message “${reason}” against what you were doing: it names the rule that was broken.`, 'If you did not intend to do what the contract expected (the wrong function, or the wrong value), start again from the app rather than repeating the same transaction.']);
  }
  // 4. no reason at all: look for the usual causes
  const causes = [];
  if (tx.value > 0n && tx.input !== '0x') {
    const noValue = await tools.replay({ ...call, value: '0x0' }, block - 1);
    if (noValue.ok) { evidence.valueRejected = true; return done('not-payable', 'This action does not accept PROS', 'The same call works when no PROS is attached, so the function is not meant to receive money and rejected it. The fee was still paid.', ['Send the transaction without any PROS value.', 'If you meant to pay with PROS, you are calling the wrong function: use the one marked as payable (often called deposit or buy).']); }
  }
  if (tx.to) {
    const code = await tools.code(tx.to);
    if (code && code !== '0x' && tx.input.length >= 10) {
      const has = scanCode(code).selectors.has(sel);
      if (!has) { evidence.selectorMissing = sel; return done('wrong-function', 'The contract has no such function', `The contract has no function matching ${sel}, and it has no fallback that accepts the call, so it rejected it. That usually means the wrong contract address, the wrong network, or an app that is out of date.`, ['Check that the address is the contract you meant to use, on the right network.', 'Refresh the app or reconnect the wallet, then repeat the action from the beginning.']); }
    }
    if (code === '0x') causes.push('the address is not a contract');
  }
  return done('revert-no-reason', 'The contract refused, without saying why', 'The contract rejected the call without a message. Common reasons are a rule written without an error text, or a condition on the amount, the time or the account that was not met.', ['Check the amount, the recipient and the approvals before repeating it.', 'Use the app or the contract’s source to see which rule has no message; repeating the same transaction will fail again.', ...causes]);
}
