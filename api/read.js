// GET /api/read?address=0x…&holder=0x…,0x…&block=123
import { chainClient, handle, need, one } from '../lib/server.js';
import { isAddress } from '../lib/abi.js';
import { readSnapshot } from '../lib/snapshot.js';

export default handle(async (q) => {
  const address = (one(q.address) || '').toLowerCase();
  need(isAddress(address), 'address must be a 0x contract address');
  const holders = (one(q.holder) || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  need(holders.length <= 3, 'at most 3 holder addresses');
  need(holders.every(isAddress), 'every holder must be a 0x address');
  const block = one(q.block);
  need(!block || /^\d{1,12}$/.test(block), 'block must be a block number');

  return readSnapshot(chainClient(), { address, holders, block: block ? Number(block) : undefined });
});
