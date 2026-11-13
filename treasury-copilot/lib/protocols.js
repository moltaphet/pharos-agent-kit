// Real protocols on Pharos mainnet (chain 1672) that the DeFi-flavoured tasks read.
// Every address below was verified on-chain (contract code present, interface answered)
// before use. Sources: DefiLlama adapters for the addresses, then eth_call for proof.

export const USDC = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
export const WPROS = '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0';

// Morpho Blue (singleton lending core) and one market that had a live borrower.
export const MORPHO = {
  address: '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb',
  markets: {
    'syzUSD/USDC': '0xc79579a002dbc8c535d3a87198fcbbece1a664ad82a356b0447c5bff9e16fd86',
  },
  // A borrower seen in that market's Borrow events.
  sampleBorrower: '0x743d7b30661d65b41960bf6b5d1bb93cf7972a73',
};

// ERC-4626 style vaults whose share price can be read with convertToAssets().
export const VAULTS = [
  { name: 'R25 VRPC Weekly', address: '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268', protocol: 'R25' },
  { name: 'R25 VRPC Quarterly', address: '0x94f7ebc6ae0819a4b4e231ae6ddaaf9bfd2a1a86', protocol: 'R25' },
  { name: 'R25 VRPC Semi-yearly', address: '0xee26bb0989691735c997dfdc49a4a607f75e190b', protocol: 'R25' },
  { name: 'RockawayX USDC (Morpho Vault V2)', address: '0x047cD0a91E9B92ED979189a6C8A120bf280f02E5', protocol: 'Morpho' },
];

// FaroSwap: Uniswap V2 / V3 factories on Pharos.
export const FAROSWAP = {
  v2Factory: '0x18Fab7d7027E9FB33Fa90ca607439449209F7B09',
  v3Factory: '0x2c90CcB0b989afA2433F499698451a25744A552b',
};

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Token pairs that trade on BOTH FaroSwap V2 and V3 with real liquidity, found by walking
// the V2 factory's pairs and asking the V3 factory for a pool on each fee tier.
// `quote` is the index (0 or 1) of the token the scanner measures profit in.
export const ARB_PAIRS = {
  'WPROS/DLP': {
    tokens: [
      { address: '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0', symbol: 'WPROS', decimals: 18 },
      { address: '0xb98bd05255542404f68821065d2635da6ac80c87', symbol: 'DLP', decimals: 18 },
    ],
    v2: '0xb7d5d299c671e4a4c7c0c5a33b812185182fc417',
    v3: '0xed7359fd2e74ce8d7910307fea4c8b6cb4afd44c',
    v3fee: 3000,
    quote: 0, // WPROS: gas (paid in PROS) converts 1:1
  },
  'UNI-V2/PDOG': {
    tokens: [
      { address: '0x082d831155f76db12f858a8587ce07349f4e47b5', symbol: 'UNI-V2', decimals: 18 },
      { address: '0x0a764846f1721feb3fb1e7d79130eb82c324dd64', symbol: 'PDOG', decimals: 18 },
    ],
    v2: '0xb9f329a51837d27a20dff113679d47d673d5e45b',
    v3: '0xc86b1ad22260f3e8d8335390a872d498caf463e7',
    v3fee: 3000,
    quote: 0,
  },
};
