// Transaction intent is durable before signing, so a reload never silently retries.
const PREFIX = 'pharos-treasury:v1:';
const PENDING = new Set(['awaiting-wallet', 'pending', 'uncertain', 'mismatch']);

export function createLedger(storage = globalThis.localStorage) {
  const key = (config) => `${PREFIX}${config.chainId}:${config.router.toLowerCase()}`;
  function read(config) {
    try {
      const rows = JSON.parse(storage.getItem(key(config)) ?? '[]');
      return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && typeof r.payer === 'string' && typeof r.status === 'string') : [];
    } catch { return []; }
  }
  function write(config, rows) {
    try { storage.setItem(key(config), JSON.stringify(rows)); }
    catch { throw new Error('Browser storage is unavailable. Enable storage for this site before signing so a pending payment can be recovered after reload.'); }
  }
  return {
    read,
    available(config) {
      try { const name = `${key(config)}:check`; storage.setItem(name, '1'); storage.removeItem(name); return true; }
      catch { return false; }
    },
    reserve(config, row) {
      const rows = read(config);
      if (rows.some((r) => r.payer.toLowerCase() === row.payer.toLowerCase() && PENDING.has(r.status))) throw new Error('A transaction from this wallet is still unresolved. Check its status in the receipt ledger before signing another.');
      const all = [row, ...rows];
      const unresolved = all.filter((r) => PENDING.has(r.status));
      const settled = all.filter((r) => !PENDING.has(r.status));
      write(config, [...unresolved, ...settled.slice(0, Math.max(0, 200 - unresolved.length))]);
      return row;
    },
    update(config, id, patch) {
      const rows = read(config).map((row) => row.id === id ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row);
      write(config, rows);
      return rows.find((r) => r.id === id);
    },
    remove(config, id) { write(config, read(config).filter((r) => r.id !== id)); },
    pending(config, payer) { return read(config).filter((row) => (!payer || row.payer.toLowerCase() === payer.toLowerCase()) && PENDING.has(row.status)); },
  };
}
