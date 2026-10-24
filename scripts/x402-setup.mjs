#!/usr/bin/env node
// One-time setup of the x402 demo on Pharos Atlantic testnet: deploys the test USDC (contracts/TestUSDC.sol, EIP-3009), creates a payer key in the git-ignored .wallet/ folder,
// mints the payer some test USDC, and writes config/x402.json (public: the token, the receiving address, the EIP-712 domain). Keys never go into a file that is committed.
//   node scripts/x402-setup.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { ATLANTIC } from '../lib/rpc-chain.js';
import { makeSigner, phrs } from '../lib/testnet-signer.js';
import { testUsdcBytecode } from '../lib/testnet-contracts.js';
import { addressFromPrivateKey } from '../lib/secp256k1.js';
import { toChecksumAddress } from '../lib/address.js';
import { selectorOf } from '../lib/keccak.js';

const CONFIG = new URL('../config/x402.json', import.meta.url);
const PAYER_FILE = new URL('../.wallet/x402-payer.json', import.meta.url);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const signer = makeSigner({ rpcUrl: ATLANTIC.rpc, budgetWei: 4n * 10n ** 15n, log: (s) => console.error(s) });
if (existsSync(CONFIG)) { console.log('config/x402.json already exists: nothing to do'); process.exit(0); }
mkdirSync(new URL('../.wallet/', import.meta.url), { recursive: true });
if (!existsSync(PAYER_FILE)) {
  const key = '0x' + randomBytes(32).toString('hex');
  writeFileSync(PAYER_FILE, JSON.stringify({ note: 'x402 demo payer: a throwaway Atlantic testnet key, test tokens only. Never commit.', address: toChecksumAddress(addressFromPrivateKey(key)), privateKey: key }, null, 2) + '\n', { mode: 0o600 });
}
const payer = JSON.parse(readFileSync(PAYER_FILE, 'utf8'));
console.error(`facilitator/deployer ${signer.wallet.address} holds ${phrs(await signer.balance())}; payer ${payer.address}`);
const deploy = await signer.send({ label: 'deploy the test USDC (EIP-3009)', to: null, create: testUsdcBytecode(), gas: 1_200_000 });
const token = deploy.contractAddress;
await new Promise((r) => setTimeout(r, 4000));
const mint = await signer.send({ label: 'mint 2 test USDC to the payer', to: token, data: selectorOf('mint(address,uint256)') + payer.address.slice(2).toLowerCase().padStart(64, '0') + word(2_000_000), gas: 120_000 });
const payTo = toChecksumAddress(signer.fresh('x402-payto'));
writeFileSync(CONFIG, JSON.stringify({ network: 'eip155:688689', asset: token, name: 'USDC', version: '2', decimals: 6, payTo, payer: payer.address, deployedAtBlock: deploy.blockNumber, deployTx: deploy.hash, mintTx: mint.hash, note: 'asset is a test USDC deployed for this demo (contracts/TestUSDC.sol): it is not an official token and has no value. payTo receives the payments; payer is the demo client.' }, null, 2) + '\n');
console.log(`token ${token}\npayTo ${payTo}\npayer ${payer.address}\nspent ${phrs(signer.spent())}`);
