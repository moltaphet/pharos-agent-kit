// Wallet / contract risk checker for Pharos. A pre-transaction check that reads the chain (archive state through the public RPC) and flags red flags in plain language, with a
// low / medium / high level. Signals: age (first block of the contract's code, or of the wallet's first outgoing transaction), admin powers (owner and what the owner can do, read
// from the bytecode's function selectors), upgradeability (EIP-1967 / EIP-1167 proxies), dangerous opcodes (SELFDESTRUCT, DELEGATECALL), a freshly funded wallet, unlimited
// approvals still outstanding, and contact with addresses on a flag list you supply. No score is hidden: every flag carries its evidence.

import { isAddress } from './abi.js';
import { KNOWN, shortAddress } from './labels.js';
import { keccak256, selectorOf } from './keccak.js';
import { PHAROS_RPC, rpcCall } from './rpc.js';
import { ATLANTIC } from './rpc-chain.js';
import { TOKENS } from './payments.js';
import { MORPHO, VAULTS, FAROSWAP, MULTICALL3 } from './protocols.js';
import { UserError } from './snapshot.js';

const DAY = 86_400;
const hex = (n) => '0x' + n.toString(16);
const num = (h) => Number(BigInt(h));
const word = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const MAX_ALLOWANCE = 1n << 255n;
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
// older proxies (OpenZeppelin's pre-1967 "zos" proxy, used by Circle's USDC) keep the same two values in their own slots
const IMPLEMENTATION_SLOT_ZOS = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';
const ADMIN_SLOT_ZOS = '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b';

export const CHAINS = {
  mainnet: {
    key: 'mainnet', name: 'Pharos mainnet (1672)', rpc: PHAROS_RPC, explorer: 'https://www.pharosscan.xyz',
    tokens: TOKENS.filter((t) => !t.native).map((t) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals })),
    labels: { ...KNOWN, [MORPHO.address.toLowerCase()]: 'Morpho Blue', [FAROSWAP.v2Factory.toLowerCase()]: 'FaroSwap V2 factory', [FAROSWAP.v3Factory.toLowerCase()]: 'FaroSwap V3 factory', [MULTICALL3.toLowerCase()]: 'Multicall3', ...Object.fromEntries(VAULTS.map((v) => [v.address.toLowerCase(), `${v.name} (vault)`])) },
  },
  atlantic: {
    key: 'atlantic', name: 'Pharos Atlantic testnet (688689)', rpc: ATLANTIC.rpc, explorer: 'https://atlantic.pharosscan.xyz',
    tokens: [{ symbol: 'USDC (demo)', address: '0xa952d7f3dc17da87a71d1e33958139bcd5565eef', decimals: 6 }],
    labels: { '0x0000000000000000000000000000000000000000': 'Null address (mint/burn)', '0xa952d7f3dc17da87a71d1e33958139bcd5565eef': 'Demo USDC (task 20)' },
  },
};
// a check makes dozens of reads; one slow answer must not sink it, so each read is tried up to three times
export const chainRpc = (chain) => async (method, params = []) => {
  for (let i = 0; ; i++) {
    try { return await rpcCall(method, params, { url: chain.rpc, why: `risk checker: ${method}` }); } catch (err) { if (i >= 2) throw err; await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
};

// ---- bytecode -----------------------------------------------------------------------------------------------------------------------------

/** Walks the bytecode instruction by instruction (skipping the data of PUSH), so opcodes and 4-byte selectors are real instructions, not bytes inside constants. */
export function scanCode(code) {
  const raw = Buffer.from(String(code).replace(/^0x/, ''), 'hex');
  let end = raw.length;
  // the compiler appends CBOR metadata, whose length is in the last two bytes; it is data, not code
  if (end > 2) { const len = raw.readUInt16BE(end - 2); if (len > 0 && len + 2 < end && raw[end - 2 - len] >= 0xa1 && raw[end - 2 - len] <= 0xa6) end -= len + 2; }
  const ops = new Set(); const selectors = new Set();
  for (let i = 0; i < end; i++) {
    const op = raw[i];
    ops.add(op);
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      if (op === 0x63 && i + 4 < end) selectors.add('0x' + raw.subarray(i + 1, i + 5).toString('hex'));
      i += n;
    }
  }
  return { size: raw.length, selfdestruct: ops.has(0xff), delegatecall: ops.has(0xf4), selectors, cloneOf: /^363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3/i.test(raw.toString('hex')) ? '0x' + raw.toString('hex').slice(20, 60) : null };
}
const sel = (sig) => selectorOf(sig);
const POWERS = [
  { id: 'mint', plain: 'create new tokens out of thin air (dilute every holder)', sigs: ['mint(address,uint256)', 'mint(uint256)', 'issue(address,uint256)'] },
  { id: 'blacklist', plain: 'freeze or block specific addresses so they cannot move their tokens', sigs: ['blacklist(address)', 'addBlacklist(address)', 'addToBlacklist(address)', 'blockAddress(address)', 'setBlacklist(address,bool)', 'freeze(address)', 'ban(address)'] },
  { id: 'fee', plain: 'change the fee or tax taken on transfers', sigs: ['setFee(uint256)', 'setTax(uint256)', 'setTaxFee(uint256)', 'setFees(uint256,uint256)', 'setTransferFee(uint256)'] },
  { id: 'pause', plain: 'pause all transfers', sigs: ['pause()', 'unpause()'] },
  { id: 'upgrade', plain: 'swap the contract’s code for different code', sigs: ['upgradeTo(address)', 'upgradeToAndCall(address,bytes)', 'setImplementation(address)'] },
  { id: 'drain', plain: 'withdraw whatever the contract holds', sigs: ['withdrawAll()', 'drain()', 'sweep(address)', 'rescueTokens(address,uint256)', 'emergencyWithdraw()'] },
];
export const powersIn = (selectors) => POWERS.filter((p) => p.sigs.some((s) => selectors.has(sel(s)))).map(({ id, plain }) => ({ id, plain }));

// ---- reading ------------------------------------------------------------------------------------------------------------------------------

/** First block in [lo, hi] where `pred` holds, for a predicate that is false then true. */
async function firstBlock(pred, lo, hi) {
  if (!(await pred(hi))) return null;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (await pred(mid)) hi = mid; else lo = mid + 1; }
  return lo;
}
const call = async (rpc, to, data) => { try { const r = await rpc('eth_call', [{ to, data }, 'latest']); return r && r.length >= 66 ? r : null; } catch { return null; } };
const asAddress = (r) => (r ? '0x' + r.slice(26, 66) : null);

async function blockInfo(rpc, n) { const b = await rpc('eth_getBlockByNumber', [hex(n), false]); return { number: n, time: num(b.timestamp) }; }
const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const ageText = (seconds) => (seconds < 3600 ? plural(Math.max(1, Math.round(seconds / 60)), 'minute') : seconds < 2 * DAY ? plural(Math.round(seconds / 3600), 'hour') : plural(Math.round(seconds / DAY), 'day'));

// ---- the checks ---------------------------------------------------------------------------------------------------------------------------

const sig = (id, title, status, detail, extra = {}) => ({ id, title, status, detail, ...extra });
const flag = (id, severity, title, plain, evidence = null) => ({ id, severity, title, plain, evidence });

async function contractChecks({ rpc, chain, address, head, code, headTime, flagged, depth }) {
  const signals = []; const flags = [];
  const info = scanCode(code);
  // 1. age
  const first = await firstBlock(async (n) => (await rpc('eth_getCode', [address, hex(n)])) !== '0x', 1, head);
  const created = first ? await blockInfo(rpc, first) : null;
  const age = created ? headTime - created.time : null;
  if (created) {
    const sev = age < DAY ? 'high' : age < 7 * DAY ? 'medium' : age < 30 * DAY ? 'low' : null;
    signals.push(sig('age', 'Contract age', sev ? (sev === 'low' ? 'warn' : 'bad') : 'ok', `Code first appears at block ${created.number.toLocaleString('en-US')}, ${ageText(age)} ago.`, { block: created.number, ageSeconds: age }));
    if (sev) flags.push(flag('age', sev, `Deployed ${ageText(age)} ago`, sev === 'low' ? 'This contract is less than a month old. Young contracts have had little time to be used and examined.' : 'This contract was deployed very recently. Most scams and mistakes are caught within days; this one has not had that time, so there is no track record to lean on.', { createdBlock: created.number }));
  } else signals.push(sig('age', 'Contract age', 'na', 'The first block with code could not be determined.'));

  // 2. proxy / upgradeability
  let impl = await rpc('eth_getStorageAt', [address, IMPLEMENTATION_SLOT, 'latest']).catch(() => '0x');
  let adminSlot = ADMIN_SLOT;
  if (!impl || BigInt(impl) === 0n) { impl = await rpc('eth_getStorageAt', [address, IMPLEMENTATION_SLOT_ZOS, 'latest']).catch(() => '0x'); adminSlot = ADMIN_SLOT_ZOS; }
  const implAddress = impl && BigInt(impl) !== 0n ? '0x' + impl.slice(-40) : null;
  if (implAddress || info.cloneOf) {
    const target = implAddress ?? info.cloneOf;
    let implAge = null;
    if (implAddress) { const f = await firstBlock(async (n) => (await rpc('eth_getCode', [target, hex(n)])) !== '0x', 1, head); if (f) implAge = headTime - (await blockInfo(rpc, f)).time; }
    const adminRaw = implAddress ? await rpc('eth_getStorageAt', [address, adminSlot, 'latest']).catch(() => '0x') : null;
    const admin = adminRaw && BigInt(adminRaw) !== 0n ? '0x' + adminRaw.slice(-40) : null;
    signals.push(sig('proxy', 'Upgradeability', implAddress ? 'warn' : 'ok', implAddress ? `A proxy: the code that runs is at ${shortAddress(target)}${admin ? `, and ${shortAddress(admin)} can change it` : ''}.` : `A minimal clone of ${shortAddress(target)}: the logic cannot be changed.`, { implementation: target, admin }));
    if (implAddress) {
      flags.push(flag('proxy', implAge != null && implAge < 7 * DAY ? 'high' : 'medium', 'Upgradeable proxy', `The address you would interact with is a shell that forwards to other code${admin ? `, and ${chain.labels[admin] ?? shortAddress(admin)} can swap that code at any time` : ''}. What the contract does today is not a promise of what it will do tomorrow.${implAge != null && implAge < 7 * DAY ? ` The current code was deployed only ${ageText(implAge)} ago.` : ''}`, { implementation: target, admin }));
    }
  } else signals.push(sig('proxy', 'Upgradeability', 'ok', 'Not a proxy: the code at this address is the code that runs, and it cannot be replaced.'));

  // 3. admin powers
  const ownerRaw = (await call(rpc, address, sel('owner()'))) ?? (await call(rpc, address, sel('admin()')));
  const owner = asAddress(ownerRaw);
  const powers = powersIn(info.selectors).filter((p) => !(implAddress && p.id === 'upgrade')); // for a proxy the upgrade power is the proxy flag above, not a second flag
  const paused = await call(rpc, address, sel('paused()'));
  let ownerKind = null;
  if (owner) ownerKind = BigInt(owner) === 0n ? 'renounced' : (await rpc('eth_getCode', [owner, 'latest'])) === '0x' ? 'wallet' : 'contract';
  if (owner || powers.length) {
    const who = owner ? (ownerKind === 'renounced' ? 'nobody (renounced)' : `${chain.labels[owner] ?? shortAddress(owner)}, ${ownerKind === 'wallet' ? 'a single ordinary wallet' : 'a contract'}`) : 'an unknown account';
    signals.push(sig('admin', 'Admin powers', powers.length && ownerKind !== 'renounced' ? 'bad' : 'ok', `Owner: ${who}. ${powers.length ? `Functions to ${powers.map((p) => p.id).join(', ')} are present.` : 'No special administrator functions found among the known ones.'}`, { owner, ownerKind, powers: powers.map((p) => p.id) }));
    if (powers.length && ownerKind !== 'renounced') {
      const severity = ownerKind === 'wallet' || ownerKind == null ? 'medium' : 'low';
      flags.push(flag('admin', severity, ownerKind === 'wallet' || ownerKind == null ? 'One key controls the contract' : 'An administrator contract controls this contract', `${ownerKind === 'wallet' || ownerKind == null ? 'A single wallet' : 'An administrator contract'} can ${powers.map((p) => p.plain).join('; ')}. ${ownerKind === 'wallet' || ownerKind == null ? 'If that key is lost, stolen or misused, holders have no protection.' : 'Check who controls that contract (a multisig or a timelock is safer than one key).'}`, { owner, powers: powers.map((p) => p.id) }));
    }
  } else signals.push(sig('admin', 'Admin powers', 'ok', 'No owner and none of the known administrator functions (mint, freeze, fee change, pause, upgrade, drain).'));
  if (paused && BigInt(paused) === 1n) flags.push(flag('paused', 'high', 'Currently paused', 'The contract reports that it is paused: transfers and most actions will fail right now.'));

  // 4. dangerous opcodes
  const risky = [];
  if (info.selfdestruct) risky.push('SELFDESTRUCT');
  if (info.delegatecall && !implAddress && !info.cloneOf) risky.push('DELEGATECALL');
  signals.push(sig('opcodes', 'Dangerous instructions', risky.length ? 'warn' : 'ok', risky.length ? `The code contains ${risky.join(' and ')}.` : 'No SELFDESTRUCT, and no DELEGATECALL outside a proxy.'));
  if (info.selfdestruct) flags.push(flag('selfdestruct', 'medium', 'The contract can destroy itself', 'The code contains the instruction that deletes a contract. Where the chain still honours it, whoever can call that path can remove the contract and take what it holds.'));
  if (info.delegatecall && !implAddress && !info.cloneOf) flags.push(flag('delegatecall', 'medium', 'Runs outside code as its own', 'The code can execute code from another address as if it were its own. If an administrator can choose that address, they can do anything the contract can do.'));

  // 5. flag list
  if (flagged.size) {
    const hits = [address, owner, ...(implAddress ? [implAddress] : [])].filter((a) => a && flagged.has(a.toLowerCase()));
    signals.push(sig('flagged', 'Flagged addresses', hits.length ? 'bad' : 'ok', hits.length ? `${hits.map(shortAddress).join(', ')} is on your flag list.` : `None of the contract, its owner or its implementation is on your list of ${flagged.size} flagged addresses.`));
    if (hits.length) flags.push(flag('flagged', 'high', 'Linked to a flagged address', `${hits.map((h) => chain.labels[h] ?? shortAddress(h)).join(', ')} is on the list of addresses you flagged as dangerous.`, { addresses: hits }));
  }
  return { signals, flags, facts: { size: info.size, owner, ownerKind, powers: powers.map((p) => p.id), proxyImplementation: implAddress, createdBlock: created?.number ?? null, ageSeconds: age } };
}

async function walletChecks({ rpc, chain, address, head, headTime, flagged, window, depth, checkSpender }) {
  const signals = []; const flags = [];
  const nonce = num(await rpc('eth_getTransactionCount', [address, 'latest']));
  const balance = BigInt(await rpc('eth_getBalance', [address, 'latest']));
  // 1. age of the first outgoing transaction
  let first = null; let age = null;
  if (nonce > 0) { first = await firstBlock(async (n) => num(await rpc('eth_getTransactionCount', [address, hex(n)])) > 0, 1, head); if (first) age = headTime - (await blockInfo(rpc, first)).time; }
  if (nonce === 0) {
    signals.push(sig('age', 'Wallet age', balance > 0n ? 'warn' : 'na', balance > 0n ? 'This wallet has never sent a transaction, but holds funds.' : 'This address has never sent a transaction and holds no PROS.'));
    if (balance > 0n) flags.push(flag('fresh', 'medium', 'Funded but never used', 'The wallet holds money but has never sent a transaction. That is how brand-new throwaway wallets look, including ones made to receive funds for a short time.'));
  } else {
    const sev = age < DAY ? 'high' : age < 7 * DAY ? 'medium' : age < 30 * DAY ? 'low' : null;
    signals.push(sig('age', 'Wallet age', sev ? (sev === 'low' ? 'warn' : 'bad') : 'ok', `First outgoing transaction at block ${first?.toLocaleString('en-US')}, ${ageText(age)} ago; ${nonce.toLocaleString('en-US')} transaction${nonce === 1 ? '' : 's'} sent in all.`, { firstBlock: first, ageSeconds: age, nonce }));
    if (sev) flags.push(flag('age', sev === 'high' ? 'medium' : sev, `New wallet: first activity ${ageText(age)} ago`, 'A wallet with almost no history cannot be judged by its past. New wallets are normal, but they are also what an attacker uses, because abandoning one costs nothing.', { firstBlock: first }));
  }
  // 2. thin history
  const thin = nonce > 0 && nonce <= 3;
  signals.push(sig('activity', 'Activity', thin ? 'warn' : nonce === 0 ? 'na' : 'ok', nonce === 0 ? 'No outgoing transactions.' : thin ? `Only ${nonce} outgoing transaction${nonce === 1 ? '' : 's'}.` : `${nonce.toLocaleString('en-US')} outgoing transactions: an established pattern of use.`));
  if (thin && !flags.some((f) => f.id === 'age')) flags.push(flag('thin', 'low', 'Very little history', `The wallet has sent only ${nonce} transaction${nonce === 1 ? '' : 's'}. Too little to say what is normal for it.`));

  // 3. unlimited approvals still outstanding
  const from = Math.max(1, head - window + 1);
  const logs = [];
  for (let a = from; a <= head; a += 1000) logs.push(...await rpc('eth_getLogs', [{ address: chain.tokens.map((t) => t.address), topics: [APPROVAL_TOPIC, '0x' + word(address)], fromBlock: hex(a), toBlock: hex(Math.min(a + 999, head)) }]));
  const latest = new Map();
  for (const l of logs) latest.set(`${l.address.toLowerCase()}:${('0x' + l.topics[2].slice(26)).toLowerCase()}`, l);
  const live = [];
  for (const [k, l] of latest) {
    const [token, spender] = k.split(':');
    const allowance = BigInt(await call(rpc, token, sel('allowance(address,address)') + word(address) + word(spender)) ?? '0x0');
    if (allowance >= MAX_ALLOWANCE) live.push({ token, symbol: chain.tokens.find((t) => t.address === token)?.symbol ?? shortAddress(token), spender, label: chain.labels[spender] ?? null, block: num(l.blockNumber) });
  }
  const unknownSpenders = live.filter((a) => !a.label);
  const spenderRisks = [];
  if (checkSpender) for (const a of unknownSpenders.slice(0, 3)) spenderRisks.push({ ...a, risk: await checkSpender(a.spender) });
  signals.push(sig('approvals', 'Token approvals', unknownSpenders.length ? 'bad' : live.length ? 'warn' : 'ok', live.length ? `${live.length} unlimited approval${live.length === 1 ? '' : 's'} still in force from the last ${window.toLocaleString('en-US')} blocks${unknownSpenders.length ? `, ${unknownSpenders.length} to unlabelled contracts` : ' (all to labelled protocols)'}.` : `No unlimited approvals from the last ${window.toLocaleString('en-US')} blocks.`, { approvals: live, windowBlocks: window }));
  for (const a of unknownSpenders) {
    const spenderRisk = spenderRisks.find((s) => s.spender === a.spender)?.risk;
    const bad = spenderRisk && spenderRisk.level !== 'low';
    flags.push(flag('approval', bad ? 'high' : 'medium', `Unlimited ${a.symbol} approval to ${shortAddress(a.spender)}`, `The wallet gave ${shortAddress(a.spender)} permission to move any amount of its ${a.symbol}, and the permission is still active. If that contract is malicious or hacked it can empty the wallet's ${a.symbol} at any time.${bad ? ` That contract itself checks out as ${spenderRisk.level} risk: ${spenderRisk.flags.slice(0, 2).map((f) => f.title.toLowerCase()).join('; ')}.` : ''}`, { spender: a.spender, token: a.token, block: a.block }));
  }

  // 4. flag list: counterparties of recent transfers
  if (flagged.size) {
    const hits = new Set();
    if (flagged.has(address.toLowerCase())) hits.add(address.toLowerCase());
    for (let a = from; a <= head; a += 1000) for (const topics of [[TRANSFER_TOPIC, '0x' + word(address)], [TRANSFER_TOPIC, null, '0x' + word(address)]]) {
      for (const l of await rpc('eth_getLogs', [{ address: chain.tokens.map((t) => t.address), topics, fromBlock: hex(a), toBlock: hex(Math.min(a + 999, head)) }])) for (const t of l.topics.slice(1, 3)) { const x = '0x' + t.slice(26); if (flagged.has(x)) hits.add(x); }
    }
    signals.push(sig('flagged', 'Flagged addresses', hits.size ? 'bad' : 'ok', hits.size ? `Moved tokens with ${[...hits].map(shortAddress).join(', ')}, on your flag list.` : `No token transfers with the ${flagged.size} addresses on your flag list in the last ${window.toLocaleString('en-US')} blocks.`));
    if (hits.size) flags.push(flag('flagged', 'high', 'Contact with flagged addresses', `This wallet exchanged tokens with ${[...hits].map((h) => chain.labels[h] ?? shortAddress(h)).join(', ')}, which you flagged as dangerous.`, { addresses: [...hits] }));
  }
  return { signals, flags, facts: { nonce, balance: balance.toString(), firstBlock: first, ageSeconds: age, unlimitedApprovals: live } };
}

const WEIGHT = { low: 1, medium: 3, high: 6 };
export function levelOf(flags) {
  const score = flags.reduce((s, f) => s + WEIGHT[f.severity], 0);
  const level = flags.some((f) => f.severity === 'high') || score >= 9 ? 'high' : flags.some((f) => f.severity === 'medium') || score >= 2 ? 'medium' : 'low';
  return { level, score };
}
const ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Check one address on one chain. `flagged` is your own list of dangerous addresses. `window` is how many recent blocks of approvals and transfers a wallet check reads.
 */
export async function checkAddress({ chain = CHAINS.mainnet, address, flagged = [], window = 20_000, rpc = chainRpc(chain), depth = 0 } = {}) {
  if (!isAddress(address)) throw new UserError('address must be a 0x… address of 40 hex digits');
  if (!Number.isInteger(window) || window < 1000 || window > 100_000) throw new UserError('window must be 1,000 to 100,000 blocks');
  const a = address.toLowerCase();
  const list = new Set(flagged.map((x) => { if (!isAddress(x)) throw new UserError('every flagged entry must be an address'); return x.toLowerCase(); }));
  const head = num(await rpc('eth_blockNumber', [])) - 2;
  const headTime = (await blockInfo(rpc, head)).time;
  const code = await rpc('eth_getCode', [a, hex(head)]);
  const isContract = code && code !== '0x';
  const checkSpender = depth === 0 ? async (s) => { const r = await checkAddress({ chain, address: s, flagged, window, rpc, depth: 1 }); return { level: r.level, flags: r.flags }; } : null;
  const part = isContract ? await contractChecks({ rpc, chain, address: a, head, code, headTime, flagged: list, depth }) : await walletChecks({ rpc, chain, address: a, head, headTime, flagged: list, window, depth, checkSpender });
  if (!isContract && list.has(a)) part.flags.push(flag('self', 'high', 'On your flag list', 'This address is on the list of addresses you flagged as dangerous.'));
  const flags = part.flags.sort((x, y) => ORDER[x.severity] - ORDER[y.severity]);
  const { level, score } = levelOf(flags);
  const label = chain.labels[a] ?? null;
  return {
    address: a, label, chain: chain.key, chainName: chain.name, kind: isContract ? 'contract' : 'wallet', level, score, flags, signals: part.signals, facts: part.facts, checkedBlock: head, checkedAt: new Date().toISOString(),
    summary: flags.length ? `${level.toUpperCase()} risk: ${flags.map((f) => f.title).join('; ')}.` : `LOW risk: none of the ${part.signals.filter((s) => s.status !== 'na').length} signals checked raised a flag.`,
    explorer: `${chain.explorer}/address/${a}`,
  };
}
export { keccak256 };
