// Human labels for addresses. Known Pharos mainnet addresses come from the
// official token registry and canonical-contracts docs; callers can add more
// with --label 0xabc…=Name.

export const KNOWN = {
  '0x0000000000000000000000000000000000000000': 'Null address (mint/burn)',
  '0x000000000000000000000000000000000000dead': 'Burn address',
  '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0': 'WPROS (Wrapped PROS)',
  '0xc879c018db60520f4355c26ed1a6d572cdac1815': 'USDC (Circle)',
  '0x51e2a24742db77604b881d6781ee16b5b8fcbe29': 'LINK (Chainlink)',
  '0x1f4b7011ee3d53969bb67f59428a9ec0477856e9': 'WETH',
  '0xca11bde05977b3631167028862be2a173976ca11': 'Multicall3',
  '0x000000000022d473030f116ddee9f6b43ac78ba3': 'Permit2',
  '0x0000000071727de22e5e9d8baf0edac6f37da032': 'ERC-4337 EntryPoint v0.7',
  '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789': 'ERC-4337 EntryPoint v0.6',
  '0x13b0d85ccb8bf860b6b79af3029fca081ae9bef2': 'Create2Deployer',
  '0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed': 'CreateX',
};

export const shortAddress = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function parseLabelFlags(flags = []) {
  const out = {};
  for (const f of flags) {
    const i = f.indexOf('=');
    if (i < 0) throw new Error(`--label expects 0xADDRESS=Name, got "${f}"`);
    out[f.slice(0, i).toLowerCase()] = f.slice(i + 1);
  }
  return out;
}

// Returns a function address -> label (or undefined when we don't know it).
export function makeLabeler(extra = {}) {
  const table = { ...KNOWN, ...extra };
  return (address) => table[address.toLowerCase()];
}
