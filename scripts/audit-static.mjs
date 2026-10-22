// Static audit of the live tasks against the task briefs (public/registry.json).
// Checks: every requirement has evidence, referenced files exist, skills follow the
// Pharos Skill Engine template, and the Capability Index anchors resolve.
import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';

// content.js imports browser modules; they only touch the DOM inside functions, so Node can load them.
globalThis.localStorage = undefined;
const { liveOf } = await import('../public/js/content.js');
const { SKILL_DIRS } = await import('../lib/skills.js');
const registry = JSON.parse(await readFile('public/registry.json', 'utf8')).tasks;
const exists = (p) => access(p).then(() => true, () => false);
const problems = [];
const bad = (task, msg) => problems.push(`${task}: ${msg}`);
const slug = (h) => h.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ +/g, '-');

const live = registry.filter((t) => liveOf(t.slug));
console.log(`live tasks: ${live.length} of ${registry.length}`);
for (const t of live) {
  const c = liveOf(t.slug);
  // 1. every requirement has its evidence, in the same order
  if (c.evidence.length !== t.requirements.length) bad(t.slug, `${t.requirements.length} requirements but ${c.evidence.length} evidence lines`);
  // 2. required sections present and non-trivial
  for (const k of ['tagline', 'story', 'how', 'decisions', 'run', 'verify', 'files']) if (!c[k] || (Array.isArray(c[k]) && !c[k].length)) bad(t.slug, `missing content: ${k}`);
  // 3. referenced files exist
  for (const f of c.files ?? []) if (!(await exists(f))) bad(t.slug, `files lists "${f}" which does not exist`);
  // 4. commands mention scripts that exist
  for (const cmd of c.run?.commands ?? []) for (const m of cmd.matchAll(/(?:skills|bin|lib)\/[\w./-]+\.(?:mjs|json|js)\b/g)) if (!(await exists(m[0]))) bad(t.slug, `run command references missing file ${m[0]}`);
  // 5. skill tasks must ship a skill
  if (c.skill && !SKILL_DIRS[t.slug]) bad(t.slug, 'content.skill is true but no SKILL_DIRS entry');
  if (t.category === 'SkillEngine' && !c.skill) bad(t.slug, 'a SkillEngine task must ship a Skill');
  console.log(`\n== ${t.slug}  (${t.tier}, ${t.requirements.length} requirements)`);
  t.requirements.forEach((r, i) => console.log(`  ${i + 1}. REQ : ${r.slice(0, 110)}\n     DONE: ${c.evidence[i]?.slice(0, 110)}`));
}

// Skill lint: Pharos Skill Engine template
const SECTIONS = ['### Overview', '### Command Template', '### Parameters', '### Output Parsing', '### Error Handling', '> **Agent Guidelines**'];
for (const [task, dir] of Object.entries(SKILL_DIRS)) {
  const base = join('skills', dir);
  const skill = await readFile(join(base, 'SKILL.md'), 'utf8');
  const fm = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---/);
  if (!fm) bad(task, 'SKILL.md has no name/description front matter');
  else if (fm[1] !== dir) bad(task, `SKILL.md name "${fm[1]}" != folder "${dir}"`);
  for (const h of ['## Prerequisites', '## Network Configuration', '## Capability Index', '## Write Operation Pre-checks', '## Security Reminders']) if (!skill.includes(h)) bad(task, `SKILL.md lacks "${h}"`);
  if (!(await exists(join(base, 'assets/networks.json')))) bad(task, 'assets/networks.json missing');
  const refs = (await readdir(join(base, 'references'))).filter((f) => f.endsWith('.md'));
  if (!refs.length) bad(task, 'no reference file');
  const anchors = new Map();
  for (const r of refs) {
    const text = await readFile(join(base, 'references', r), 'utf8');
    const parts = text.split(/\n---\n/).slice(1);
    const heads = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    anchors.set(r, heads.map(slug));
    if (heads.length !== parts.length) bad(task, `${r}: ${heads.length} sections but ${parts.length} blocks`);
    for (const p of parts) {
      const name = p.match(/^## (.+)$/m)?.[1] ?? '?';
      for (const s of SECTIONS) if (!p.includes(s)) bad(task, `${r} → "${name}" lacks "${s}"`);
      if (!/\| Parameter \| Type \| Required \| Description \|/.test(p)) bad(task, `${r} → "${name}" Parameters table lacks the standard header`);
      if (!/\| Error Signature \| Cause \| Suggested Action \|/.test(p)) bad(task, `${r} → "${name}" Error table lacks the standard header`);
      if (!/> 1\. /.test(p)) bad(task, `${r} → "${name}" Agent Guidelines has no numbered steps`);
    }
  }
  // Capability Index links resolve
  for (const m of skill.matchAll(/→ references\/([\w.-]+)#([\w-]+)/g)) {
    if (!anchors.get(m[1])) bad(task, `Capability Index points to missing file ${m[1]}`);
    else if (!anchors.get(m[1]).includes(m[2])) bad(task, `Capability Index anchor #${m[2]} has no heading in ${m[1]} (have: ${anchors.get(m[1]).join(', ')})`);
  }
  // scripts referenced in the reference exist
  for (const r of refs) for (const m of (await readFile(join(base, 'references', r), 'utf8')).matchAll(/skills\/[\w-]+\/(?:scripts|examples)\/[\w.-]+/g)) if (!(await exists(m[0]))) bad(task, `${r} references missing ${m[0]}`);
  const script = (await readdir(join(base, 'scripts'))).length;
  console.log(`\nskill ${dir}: ${refs.length} reference(s), ${script} script(s)`);
}
console.log(`\n${problems.length ? 'PROBLEMS (' + problems.length + '):\n - ' + problems.join('\n - ') : 'no static problems found'}`);
process.exitCode = problems.length ? 1 : 0;
