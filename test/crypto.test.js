import test from 'node:test';
import assert from 'node:assert/strict';
import { addressFromPrivateKey, parseSignature, recover, recoverAddress, sign } from '../lib/secp256k1.js';
import { rlp, signedLegacyTx, unsignedLegacyTx } from '../lib/rlp.js';
import { checksumStatus, toChecksumAddress } from '../lib/address.js';
import { keccak256 } from '../lib/keccak.js';

const DEV = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // gitleaks:allow (anvil's public dev account #0, worth nothing) // anvil's public dev key #0

test('secp256k1: the address of a private key, and a signature that matches cast byte for byte (RFC 6979)', () => {
  assert.equal(addressFromPrivateKey(DEV), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  const hash = '0xb5573faee542b724001e83eaf5e3fc2cf79185db71075553d2ed62ff72d23d05'; // sha256("hello pharos")
  const s = sign(hash, DEV);
  assert.equal(s.signature, '0x88c22adb74c4e8cef174d88131a0f5c2b5df5b0b6100f3adba9ed5dca01e241a1921a3b9de587d4ff872f4276d7432c0b531798aee97c5388678f10835d891d51c', 'produced by `cast wallet sign --no-hash`');
  assert.equal(sign(hash, DEV).signature, s.signature, 'deterministic');
});

test('secp256k1: the signer is recovered from a signature, and a different message recovers someone else', () => {
  const hash = '0x' + '11'.repeat(32);
  const s = sign(hash, DEV);
  assert.equal(recoverAddress(hash, s), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  assert.notEqual(recoverAddress('0x' + '22'.repeat(32), s), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  assert.deepEqual(parseSignature(s.signature), { r: s.r, s: s.s, recoveryId: s.recoveryId });
  assert.equal(s.s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n, true, 'low-s, as Ethereum requires');
  assert.equal(recover(hash, { r: 0n, s: 1n, recoveryId: 0 }), null);
  assert.throws(() => sign(hash, '0x' + '00'.repeat(32)), /not a valid private key/);
  assert.throws(() => parseSignature('0x1234'), /65 bytes/);
});

test('RLP encoding: the vectors of the specification', () => {
  const hex = (x) => rlp(x).toString('hex');
  assert.equal(hex('0x'), '80');
  assert.equal(hex(0n), '80');
  assert.equal(hex('0x7f'), '7f');
  assert.equal(hex('0x80'), '8180');
  assert.equal(hex(1024n), '820400');
  assert.equal(hex(['0xcc', '0xdd']), 'c481cc81dd');
  assert.equal(hex([]), 'c0');
  assert.equal(hex('0x' + 'ab'.repeat(56)).slice(0, 6), 'b838ab', 'a 56-byte string takes a length of length');
  assert.throws(() => rlp(-1n), /negative/);
});

test('an EIP-155 transaction: the example in the specification, unsigned and signed', () => {
  const fields = { nonce: 9n, gasPrice: 20_000_000_000n, gasLimit: 21_000n, to: '0x3535353535353535353535353535353535353535', value: 10n ** 18n, data: '0x', chainId: 1 };
  const u = unsignedLegacyTx(fields);
  assert.equal(u.raw, '0xec098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a764000080018080');
  assert.equal(u.signingHash, '0xdaf5a779ae972f972197303d7b574746c7ef83eadac0f2791ad23db92e4c8e53');
  const key = '0x' + '46'.repeat(32);
  const signed = signedLegacyTx(fields, sign(u.signingHash, key));
  assert.equal(signed.raw, '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83');
  assert.equal(signed.hash, '0x' + keccak256(Buffer.from(signed.raw.slice(2), 'hex')));
});

test('EIP-55: the specification’s own test addresses are valid, a changed case is not, and all one case carries no checksum', () => {
  for (const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb']) {
    assert.equal(checksumStatus(a), 'valid', a);
    assert.equal(toChecksumAddress(a.toLowerCase()), a);
  }
  assert.equal(checksumStatus('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAEd'), 'invalid');
  assert.equal(checksumStatus('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), 'unchecked');
  assert.equal(checksumStatus('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'), 'unchecked');
  assert.equal(checksumStatus('0x12'), 'malformed');
  assert.throws(() => toChecksumAddress('0x12'), /not an address/);
});
