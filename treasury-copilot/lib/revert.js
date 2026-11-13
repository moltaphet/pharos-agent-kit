// Turn the bytes a reverted call returns into something a person can read.
// Selectors below were checked with `cast sig`.

import { decodeAddress, decodeUint } from './abi.js';

const PANIC = {
  0x01: 'an assert failed',
  0x11: 'arithmetic overflow or underflow',
  0x12: 'division or modulo by zero',
  0x21: 'invalid enum value',
  0x22: 'corrupted storage byte array',
  0x31: 'pop on an empty array',
  0x32: 'array index out of bounds',
  0x41: 'out of memory',
  0x51: 'call to an uninitialised function pointer',
};

const strip = (h) => (h?.startsWith('0x') ? h.slice(2) : h ?? '');
const fmtUnits = (n) => n.toString();

// name + how to describe the decoded arguments
const CUSTOM = {
  '0xe450d38c': ['ERC20InsufficientBalance', (a) => `the sender ${a.addr(0)} holds ${fmtUnits(a.uint(1))} but needs ${fmtUnits(a.uint(2))}`],
  '0xfb8f41b2': ['ERC20InsufficientAllowance', (a) => `the spender ${a.addr(0)} is approved for ${fmtUnits(a.uint(1))} but needs ${fmtUnits(a.uint(2))}`],
  '0x96c6fd1e': ['ERC20InvalidSender', (a) => `invalid sender ${a.addr(0)}`],
  '0xec442f05': ['ERC20InvalidReceiver', (a) => `invalid receiver ${a.addr(0)}`],
  '0x94280d62': ['ERC20InvalidSpender', (a) => `invalid spender ${a.addr(0)}`],
  '0x118cdaa7': ['OwnableUnauthorizedAccount', (a) => `${a.addr(0)} is not the owner`],
  '0xe2517d3f': ['AccessControlUnauthorizedAccount', (a) => `${a.addr(0)} lacks the required role`],
  '0xd93c0665': ['EnforcedPause', () => 'the contract is paused'],
  '0xd92e233d': ['ZeroAddress', () => 'a zero address was passed'],
  '0x5274afe7': ['SafeERC20FailedOperation', (a) => `the token ${a.addr(0)} failed a safe transfer`],
  '0xcd786059': ['AddressInsufficientBalance', (a) => `${a.addr(0)} does not hold enough native balance`],
};

// `data` is the raw revert data; `message` is the node's text ("execution reverted: …").
export function decodeRevert(data, message = '') {
  const hex = strip(data);
  const text = message.replace(/^.*?execution reverted:?\s*/i, '').trim();
  if (!hex) return { kind: 'empty', name: null, message: text || 'the call reverted without a reason', raw: '0x' };
  const sel = '0x' + hex.slice(0, 8);
  const body = '0x' + hex.slice(8);
  if (sel === '0x08c379a0') {
    const len = Number(decodeUint(body, 1) ?? 0n);
    const reason = Buffer.from(hex.slice(8 + 128, 8 + 128 + len * 2), 'hex').toString('utf8');
    return { kind: 'Error', name: 'Error', message: reason, raw: '0x' + hex };
  }
  if (sel === '0x4e487b71') {
    const code = Number(decodeUint(body, 0));
    return { kind: 'Panic', name: 'Panic', message: `${PANIC[code] ?? 'panic'} (code 0x${code.toString(16)})`, raw: '0x' + hex };
  }
  if (CUSTOM[sel]) {
    const [name, describe] = CUSTOM[sel];
    const args = { addr: (i) => decodeAddress('0x' + hex.slice(8 + i * 64, 8 + i * 64 + 64)), uint: (i) => decodeUint(body, i) };
    return { kind: 'custom', name, message: `${name}: ${describe(args)}`, raw: '0x' + hex };
  }
  return { kind: 'custom', name: null, message: text || `custom error ${sel}`, selector: sel, raw: '0x' + hex };
}

// Chain MCP reports a revert as a tool error whose text is JSON: { error: { message, code, data } }.
export function parseMcpRevert(err) {
  const m = String(err?.message ?? err).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const e = JSON.parse(m[0]).error;
    return e ? { message: e.message ?? '', data: e.data ?? '0x', code: e.code } : null;
  } catch {
    return null;
  }
}
