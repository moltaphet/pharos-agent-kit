#!/usr/bin/env node
// Task 21: buy a bounded set of x402 resources. The payer key is read only from the environment or a file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, parseCli } from '../../lib/cli.js';
import { loadPrivateKey } from '../../lib/x402.js';
import { runBuyerJob } from '../../lib/x402-buyer.js';

const usage = 'Usage: pharos-x402-buy --plan <plan.json> --budget <base units> --max-call <base units> [--asset <token address>]';
const { values } = parseCli({ usage, allowPositionals: false, options: {
  plan: { type: 'string' }, budget: { type: 'string' }, 'max-call': { type: 'string' }, asset: { type: 'string' },
} });
if (!values.plan || !values.budget || !values['max-call']) fail('provide --plan, --budget and --max-call', usage);

try {
  const planPath = resolve(values.plan);
  const text = readFileSync(planPath, 'utf8');
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error('plan is larger than 64 KiB');
  const plan = JSON.parse(text);
  const privateKey = loadPrivateKey({ name: 'EVM_PRIVATE_KEY', file: fileURLToPath(new URL('../../.wallet/x402-payer.json', import.meta.url)) });
  const result = await runBuyerJob({ tasks: plan.tasks, budget: values.budget, maxPerCall: values['max-call'], expectedAsset: values.asset ?? null, privateKey });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'unresolved') process.exitCode = 11;
  else if (result.status === 'stopped') process.exitCode = 10;
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
