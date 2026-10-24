import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { ROOT, SHARED_TESTS, TASK_MAP, allTestFiles, closure, dependencies, scriptsOf } from '../scripts/task-map.mjs';
import { REPO, buildAll } from '../scripts/make-submission.mjs';

const files = buildAll();

test('there is a folder for each of the 15 built tasks, each with its own README', () => {
  assert.equal(TASK_MAP.length, 15);
  assert.deepEqual(TASK_MAP.map((t) => t.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(new Set(TASK_MAP.map((t) => t.folder)).size, 15, 'no two tasks share a folder');
  for (const t of TASK_MAP) {
    assert.ok(existsSync(ROOT + t.folder), t.folder);
    assert.ok(scriptsOf(t).length >= 1, `${t.folder} has no script of its own`);
    assert.ok(files.has(`${t.folder}/README.md`), t.folder);
  }
});

test('every file the map names exists', () => {
  for (const t of TASK_MAP) for (const f of [...t.entries, ...t.data, ...t.page, ...t.tests.map((x) => `test/${x}`)]) assert.ok(existsSync(ROOT + f), `${t.slug}: ${f}`);
});

test('every test file is claimed by exactly one task or by the shared platform', () => {
  const claimed = [...TASK_MAP.flatMap((t) => t.tests), ...SHARED_TESTS];
  assert.deepEqual(claimed.filter((f, i) => claimed.indexOf(f) !== i), [], 'claimed twice');
  assert.deepEqual(allTestFiles().filter((f) => !claimed.includes(f)), [], 'a test file that no task claims: add it to scripts/task-map.mjs');
  assert.deepEqual(claimed.filter((f) => !allTestFiles().includes(f)), [], 'claimed but missing');
});

test('every relative import reachable from a task resolves to a file that exists (a moved file cannot break a task silently)', () => {
  for (const t of TASK_MAP) {
    for (const f of closure([...scriptsOf(t), ...t.entries])) {
      if (!/\.m?js$/.test(f)) continue;
      const src = readFileSync(ROOT + f, 'utf8');
      for (const m of src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        assert.ok(existsSync(ROOT + normalize(join(dirname(f), m[1]))), `${t.slug}: ${f} imports ${m[1]}, which does not exist`);
      }
    }
  }
});

test('the four CLIs start from their new folders', () => {
  for (const [t, usage] of [[TASK_MAP[0], 'pharos-read'], [TASK_MAP[1], 'pharos-watch'], [TASK_MAP[2], 'pharos-onboard'], [TASK_MAP[3], 'pharos-docs']]) {
    const script = scriptsOf(t)[0];
    const out = execFileSync('node', [ROOT + script, '--help'], { encoding: 'utf8' });
    assert.match(out, new RegExp(`Usage: ${usage}`), script);
  }
  const pkg = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'));
  for (const p of Object.values(pkg.bin)) assert.ok(existsSync(ROOT + p), `package.json bin points at ${p}`);
});

test('the generated files are up to date (run: node scripts/make-submission.mjs)', () => {
  for (const [p, text] of files) {
    assert.ok(existsSync(ROOT + p), `${p} is missing`);
    assert.equal(readFileSync(ROOT + p, 'utf8'), text, `${p} is out of date`);
  }
});

test('every link in the generated files points at something that exists', () => {
  for (const [p, text] of files) {
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (href.startsWith(REPO + '/tree/main/') || href.startsWith(REPO + '/blob/main/')) {
        const path = href.replace(/^.*\/(?:tree|blob)\/main\//, '');
        assert.ok(existsSync(ROOT + path), `${p}: ${href}`);
      } else if (!/^https?:/.test(href)) {
        assert.ok(existsSync(ROOT + normalize(join(dirname(p), href))), `${p}: broken relative link ${href}`);
      }
    }
  }
});

test('every folder link a reviewer is given opens a folder that holds the task’s code and its README', () => {
  for (const t of TASK_MAP) {
    const page = files.get(`submission/${String(t.n).padStart(2, '0')}-${t.slug}.md`);
    assert.ok(page.includes(`${REPO}/tree/main/${t.folder}`), t.slug);
    assert.ok(existsSync(ROOT + t.folder + '/README.md'));
  }
  assert.ok(files.get('SUBMISSION.md').split(`${REPO}/tree/main/`).length - 1 >= 15);
});

test('dependencies are found, not hand-written: a task folder README lists the lib files it really imports', () => {
  const d = dependencies(TASK_MAP[10]);
  const names = d.infra.map((x) => x.file);
  for (const f of ['lib/policy.js', 'lib/audit-log.js', 'lib/testnet-signer.js']) assert.ok(names.includes(f), f);
  assert.ok(files.get('skills/pharos-policy-gatekeeper/README.md').includes('lib/policy.js'));
  assert.deepEqual(d.infra.find((x) => x.file === 'lib/policy.js').usedBy, [12, 15], 'the gatekeeper engine is also imported by the Skill + Chain MCP flow, and by the Yield Optimizer (for its exact USDC amount parser), and by no other task');
  assert.ok(files.get('skills/pharos-transfer-preflight/README.md').includes('lib/policy.js') && files.get('skills/pharos-transfer-preflight/README.md').includes('lib/tasks/dry-run-executor.js'), 'the flow’s README shows the two Skills it composes');
});

test('no points anywhere in the generated files', () => {
  for (const [p, text] of files) assert.equal(/\bpoints?\b|\bpts\b/i.test(text), false, p);
});

test('the site shows each task’s GitHub folder: the front-end map matches the task map and the hero and run section use it', async () => {
  const { TASK_FOLDERS, folderUrl } = await import('../public/js/consts.js');
  assert.deepEqual(Object.keys(TASK_FOLDERS).sort(), TASK_MAP.map((t) => t.slug).sort());
  for (const t of TASK_MAP) {
    assert.equal(TASK_FOLDERS[t.slug], t.folder);
    assert.equal(folderUrl(t.slug), `${REPO}/tree/main/${t.folder}`);
  }
  assert.equal(folderUrl('not-a-task'), null);
  const views = readFileSync(ROOT + 'public/js/views.js', 'utf8');
  assert.match(views, /Code on GitHub/);
  assert.match(views, /This task’s folder on GitHub/);
});
