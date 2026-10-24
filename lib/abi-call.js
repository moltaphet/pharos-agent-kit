// Enough ABI to call and read any simple view function from a signature written the way `cast` writes it:
//   latestAnswer()(int256)        balanceOf(address)(uint256)        symbol()(string)
// Inputs: address, bool, uintN, intN, bytesN. Outputs: those, or exactly one string / bytes.
// Anything else is refused with a clear message instead of being guessed.

import { keccak256, selectorOf } from './keccak.js';
import { isAddress } from './abi.js';
import { UserError } from './snapshot.js';

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SHAPE = /^([A-Za-z_][A-Za-z0-9_]*)\(([^()]*)\)(?:\(([^()]*)\))?$/;
const MAX_IN = 4;
const MAX_OUT = 6;

function normType(t, where, { dynamicOk = false } = {}) {
  let s = t.trim();
  if (s === 'uint') s = 'uint256';
  if (s === 'int') s = 'int256';
  if (s === 'address' || s === 'bool') return s;
  let m = /^(uint|int)(\d{1,3})$/.exec(s);
  if (m) {
    const bits = Number(m[2]);
    if (bits < 8 || bits > 256 || bits % 8) throw new UserError(`${where}: ${s} is not a valid integer type (8 to 256 bits, a multiple of 8)`);
    return s;
  }
  m = /^bytes(\d{1,2})$/.exec(s);
  if (m) {
    if (Number(m[1]) < 1 || Number(m[1]) > 32) throw new UserError(`${where}: ${s} is not a valid type (bytes1 to bytes32)`);
    return s;
  }
  if ((s === 'string' || s === 'bytes') && dynamicOk) return s;
  if (s === 'string' || s === 'bytes') throw new UserError(`${where}: ${s} is only supported as the single return value`);
  throw new UserError(`${where}: type "${s}" is not supported (use address, bool, uintN, intN, bytesN, or string/bytes as the return value)`);
}

// "balanceOf(address)(uint256)" -> { name, inputs: ['address'], outputs: ['uint256'], signature: 'balanceOf(address)', selector }
export function parseSignature(text) {
  const m = SHAPE.exec(String(text ?? '').replace(/\s+/g, ''));
  if (!m) throw new UserError('the function must be written like latestAnswer()(int256) or balanceOf(address)(uint256)');
  const [, name, ins, outs] = m;
  if (!NAME.test(name)) throw new UserError(`"${name}" is not a valid function name`);
  const list = (s) => (s === '' || s == null ? [] : s.split(','));
  const inputs = list(ins).map((t, i) => normType(t, `input ${i + 1}`));
  const rawOut = list(outs);
  if (inputs.length > MAX_IN) throw new UserError(`at most ${MAX_IN} inputs are supported`);
  if (rawOut.length > MAX_OUT) throw new UserError(`at most ${MAX_OUT} return values are supported`);
  const outputs = rawOut.map((t, i) => normType(t, `return value ${i + 1}`, { dynamicOk: rawOut.length === 1 }));
  const signature = `${name}(${inputs.join(',')})`;
  return { name, inputs, outputs, signature, selector: selectorOf(signature) };
}

const word = (n) => n.toString(16).padStart(64, '0');

export function encodeArg(type, value) {
  const v = typeof value === 'string' ? value.trim() : value;
  if (type === 'address') {
    if (!isAddress(v)) throw new UserError(`${JSON.stringify(value)} is not a 0x address`);
    return v.slice(2).toLowerCase().padStart(64, '0');
  }
  if (type === 'bool') {
    if (v === true || v === 'true') return word(1n);
    if (v === false || v === 'false') return word(0n);
    throw new UserError(`${JSON.stringify(value)} is not true or false`);
  }
  let m = /^(uint|int)(\d+)$/.exec(type);
  if (m) {
    const bits = BigInt(m[2]);
    if (!/^-?\d+$|^0x[0-9a-fA-F]+$/.test(String(v))) throw new UserError(`${JSON.stringify(value)} is not a whole number`);
    const n = BigInt(v);
    if (m[1] === 'uint') {
      if (n < 0n || n >= 1n << bits) throw new UserError(`${n} does not fit in ${type}`);
      return word(n);
    }
    if (n < -(1n << (bits - 1n)) || n >= 1n << (bits - 1n)) throw new UserError(`${n} does not fit in ${type}`);
    return word(BigInt.asUintN(256, n));
  }
  m = /^bytes(\d+)$/.exec(type);
  if (m) {
    const len = Number(m[1]);
    if (!new RegExp(`^0x[0-9a-fA-F]{${len * 2}}$`).test(String(v))) throw new UserError(`${JSON.stringify(value)} is not ${len} bytes of 0x hex`);
    return v.slice(2).toLowerCase().padEnd(64, '0');
  }
  throw new UserError(`cannot encode type ${type}`);
}

export function encodeCall(fn, args = []) {
  if (args.length !== fn.inputs.length) throw new UserError(`${fn.signature} takes ${fn.inputs.length} argument${fn.inputs.length === 1 ? '' : 's'}, ${args.length} given`);
  return fn.selector + fn.inputs.map((t, i) => encodeArg(t, args[i])).join('');
}

// Decodes the eth_call result. Each value: { type, value (BigInt | string | boolean), text (how to print it) }.
export function decodeOutputs(types, hex) {
  const h = String(hex ?? '').replace(/^0x/, '');
  if (types.length === 0) return [];
  if (h === '') throw new UserError('the contract returned no data (it has no such function, or it is not that kind of contract)');
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2) throw new UserError('the contract returned data that is not valid hex');
  if (types.length === 1 && (types[0] === 'string' || types[0] === 'bytes')) {
    if (h.length < 128) throw new UserError(`the return value is too short for a ${types[0]}`);
    const off = Number(BigInt('0x' + h.slice(0, 64)));
    const len = Number(BigInt('0x' + h.slice(off * 2, off * 2 + 64)));
    const body = h.slice(off * 2 + 64, off * 2 + 64 + len * 2);
    if (!Number.isSafeInteger(off) || body.length !== len * 2 || len > 8192) throw new UserError(`the ${types[0]} return value is malformed`);
    const value = types[0] === 'string' ? Buffer.from(body, 'hex').toString('utf8') : '0x' + body;
    return [{ type: types[0], value, text: types[0] === 'string' ? JSON.stringify(value) : value }];
  }
  if (h.length < types.length * 64) throw new UserError(`the contract returned ${h.length / 2} bytes, but ${types.join(', ')} needs ${types.length * 32}`);
  return types.map((type, i) => {
    const w = h.slice(i * 64, i * 64 + 64);
    const big = BigInt('0x' + w);
    if (type === 'address') {
      if (!/^0{24}/.test(w)) throw new UserError('an address return value has non-zero high bytes: the data is not an address');
      return { type, value: '0x' + w.slice(24), text: '0x' + w.slice(24) };
    }
    if (type === 'bool') {
      if (big > 1n) throw new UserError('a bool return value is neither 0 nor 1');
      return { type, value: big === 1n, text: String(big === 1n) };
    }
    let m = /^uint(\d+)$/.exec(type);
    if (m) {
      if (big >= 1n << BigInt(m[1])) throw new UserError(`the value does not fit in ${type}: the data is not that type`);
      return { type, value: big, text: big.toString() };
    }
    m = /^int(\d+)$/.exec(type);
    if (m) {
      const n = BigInt.asIntN(256, big);
      const bits = BigInt(m[1]);
      if (n < -(1n << (bits - 1n)) || n >= 1n << (bits - 1n)) throw new UserError(`the value does not fit in ${type}: the data is not that type`);
      return { type, value: n, text: n.toString() };
    }
    m = /^bytes(\d+)$/.exec(type);
    if (m) return { type, value: '0x' + w.slice(0, Number(m[1]) * 2), text: '0x' + w.slice(0, Number(m[1]) * 2) };
    throw new UserError(`cannot decode type ${type}`);
  });
}

export { keccak256, selectorOf };
