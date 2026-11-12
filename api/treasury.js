import { readFile } from 'node:fs/promises';
import { handle } from '../lib/server.js';
import { UserError } from '../lib/snapshot.js';
import { selectorOf } from '../lib/keccak.js';
import { readConfig, planInvoice, verifyInvoice } from '../lib/treasury/agent.js';

export default function route(req, res) {
  return handle(async () => {
    const action = req.body?.action ?? req.query?.action ?? 'config';
    if (action === 'config') {
      const config = await readConfig();
      return { ...config, faucetAmount: '100', faucetTransaction: config.token.address ? { to: config.token.address, data: selectorOf('faucet()'), value: '0x0', gas: '0x186a0' } : null };
    }
    if (action === 'proof') {
      const config = await readConfig();
      if (!config.demo?.hash) return { demo: null, verification: { status: 'unavailable', message: 'A real Atlantic proof has not been recorded yet.' } };
      const verification = await verifyInvoice({ payer: config.demo.payer, invoice: config.demo, hash: config.demo.hash }, { config });
      const report = await readFile(new URL('../reports/treasury-run.json', import.meta.url), 'utf8').then(JSON.parse).catch(() => null);
      return { demo: config.demo, verification, report };
    }
    if (req.method !== 'POST') throw Object.assign(new UserError('Use POST for invoice planning or verification.'), { httpStatus: 405 });
    if (action === 'plan') return planInvoice(req.body);
    if (action === 'verify') return verifyInvoice(req.body);
    throw new UserError('Unknown Treasury action.');
  })(req, res);
}
