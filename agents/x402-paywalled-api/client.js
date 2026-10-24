#!/usr/bin/env node
// Task: x402 Paywalled API: the client. Pays for a URL and prints the answer, the settlement and the explorer link.
//   EVM_PRIVATE_KEY=0x… node agents/x402-paywalled-api/client.js http://localhost:4021/data
// The key comes from EVM_PRIVATE_KEY, or from a file named by EVM_PRIVATE_KEY_FILE (default .wallet/x402-payer.json). It is never taken from the command line.
import { explorerTx, loadPrivateKey, payAndFetch } from '../../lib/x402.js';
import { fail } from '../../lib/cli.js';
import { fileURLToPath } from 'node:url';

const url = process.argv[2];
if (!url || url.startsWith('-')) fail('give the URL to fetch, e.g. http://localhost:4021/data', 'Usage: client.js <url> [--max <base units>]');
const max = process.argv.includes('--max') ? process.argv[process.argv.indexOf('--max') + 1] : null;
try {
  const privateKey = loadPrivateKey({ name: 'EVM_PRIVATE_KEY', file: fileURLToPath(new URL('../../.wallet/x402-payer.json', import.meta.url)) });
  const r = await payAndFetch({ url, privateKey, maxAmount: max });
  console.log(`HTTP ${r.status}${r.paid ? ' (paid)' : ''}`);
  console.log(JSON.stringify(r.body, null, 2));
  if (r.settlement) console.log(`settlement: ${r.settlement.success ? 'success' : 'FAILED'} · payer ${r.settlement.payer} · tx ${r.settlement.transaction}\n${explorerTx(r.settlement.transaction)}`);
  process.exitCode = r.status === 200 ? 0 : 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
