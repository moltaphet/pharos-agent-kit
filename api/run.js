// GET|POST /api/run?slug=<task>[&...inputs]
// One route for every task that needs the server. Keeping them behind one function
// keeps the deployment small; each task lives in lib/tasks/<slug>.js.
import { chainClient, docsClient, handle, need, one } from '../lib/server.js';
import { TASKS } from '../lib/tasks/index.js';
import { readSkill } from '../lib/skills.js';

export default function route(req, res) {
  return handle(async (q) => {
    const ip = String(req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
    const slug = one(q.slug);
    if (slug === '_skill') {
      const skill = await readSkill(one(q.task));
      need(skill, `no skill package for "${one(q.task) ?? ''}"`);
      return skill;
    }
    need(slug && Object.hasOwn(TASKS, slug), `unknown task "${slug ?? ''}"`);
    return TASKS[slug]({ q, body: req.body ?? null, chain: chainClient(), docs: docsClient(), ip });
  })(req, res);
}
