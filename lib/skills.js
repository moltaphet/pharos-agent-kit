// Pharos Skill packages shipped in this repo (skills/<dir>/SKILL.md + references/ + scripts/ ...),
// and a reader the site uses to show them. Only text files below a size cap are returned.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../skills/', import.meta.url));
export const SKILL_DIRS = {
  'threshold-guardian': 'pharos-threshold-guardian',
  'saga-executor': 'pharos-saga-executor',
  'arbitrage-scanner': 'pharos-arbitrage-scanner',
  'dry-run-executor': 'pharos-dry-run-executor',
  'trend-watcher': 'pharos-trend-watcher',
  'batch-executor': 'pharos-batch-executor',
};

const TEXT = /\.(md|json|mjs|js|sol|txt)$/;
const ORDER = (p) => (p === 'SKILL.md' ? 0 : p.startsWith('references/') ? 1 : p.startsWith('scripts/') ? 2 : p.startsWith('examples/') ? 3 : 4);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (TEXT.test(e.name)) out.push(full);
  }
  return out;
}

export async function readSkill(task) {
  const dir = SKILL_DIRS[task];
  if (!dir) return null;
  const base = join(ROOT, dir);
  const files = [];
  for (const full of await walk(base)) {
    const text = await readFile(full, 'utf8');
    if (text.length <= 80_000) files.push({ path: relative(base, full), text });
  }
  files.sort((a, b) => ORDER(a.path) - ORDER(b.path) || a.path.localeCompare(b.path));
  return { name: dir, files };
}
