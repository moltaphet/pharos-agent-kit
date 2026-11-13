import { readFile } from 'node:fs/promises';
import { handle } from '../lib/server.js';
import { UserError } from '../lib/snapshot.js';
import { selectorOf } from '../lib/keccak.js';
import { readConfig, planInvoice, verifyInvoice } from '../lib/treasury/agent.js';
import { readInvoiceText } from '../lib/treasury/intake.js';
import { readHistory } from '../lib/treasury/history.js';
import { treasuryRpc } from '../lib/treasury/chain.js';

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
    if (action === 'history') {
      const config = await readConfig();
      if (!config.router) throw new UserError('The Treasury contracts are not configured yet.');
      res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
      return readHistory(config, { rpc: treasuryRpc(config), payer: req.query?.payer || null, activity: true, kinds: req.query?.all === '1' ? null : ['payment'], limit: 10 });
    }
    if (req.method !== 'POST') throw Object.assign(new UserError('Use POST for invoice planning or verification.'), { httpStatus: 405 });
    if (action === 'parse') return readInvoiceText(req.body?.text);
    if (action === 'plan') return planInvoice(req.body);
    if (action === 'verify') return verifyInvoice(req.body);
    throw new UserError('Unknown Treasury action.');
  })(req, res);
}
