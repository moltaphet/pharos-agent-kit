import { META, PLAN, REPO } from './meta.js';
import { PANELS } from './panels.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATUS_LABEL = { planned: 'Planned', built: 'Built', submitted: 'Submitted', approved: 'Approved' };
const VIDEO_BONUS = 50;

let tasks = [];
let filter = 'all';
let query = '';
let cleanup = () => {};

const statusOf = (t) => META[t.slug]?.status ?? 'planned';
const isBuilt = (t) => statusOf(t) !== 'planned';

async function boot() {
  $('#repo-link').href = REPO;
  try {
    ({ tasks } = await (await fetch('/registry.json')).json());
  } catch {
    $('#main').innerHTML = '<p class="error">Could not load the task list.</p>';
    return;
  }
  $('#side .filters').onclick = (e) => {
    if (!e.target.dataset.f) return;
    filter = e.target.dataset.f;
    document.querySelectorAll('.filters button').forEach((b) => b.classList.toggle('on', b === e.target));
    renderNav();
  };
  $('#search').oninput = (e) => ((query = e.target.value.trim().toLowerCase()), renderNav());
  $('#menu').onclick = () => {
    const open = document.body.classList.toggle('nav-open');
    $('#menu').setAttribute('aria-expanded', open);
  };
  window.addEventListener('hashchange', route);
  route();
}

// ---------------------------------------------------------------- sidebar
function renderNav() {
  const current = location.hash.replace('#/', '');
  const shown = tasks.filter(
    (t) =>
      (filter === 'all' || (filter === 'built' ? isBuilt(t) : !isBuilt(t))) &&
      (!query || `${t.title} ${t.category} ${t.tier}`.toLowerCase().includes(query)),
  );
  const groups = new Map();
  for (const t of shown) groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
  $('#nav').innerHTML = shown.length
    ? [...groups]
        .map(
          ([cat, list]) => `<div class="group"><h3>${esc(cat)}</h3>${list
            .map(
              (t) => `<a class="item" href="#/${t.slug}" ${t.slug === current ? 'aria-current="page"' : ''}>
                <span class="dot ${statusOf(t)}" title="${STATUS_LABEL[statusOf(t)]}"></span>
                <span class="t">${esc(t.title)}</span><span class="pts">${t.points}</span></a>`,
            )
            .join('')}</div>`,
        )
        .join('')
    : '<p class="none-found">No tasks match.</p>';
}

// ---------------------------------------------------------------- routing
function route() {
  cleanup();
  cleanup = () => {};
  document.body.classList.remove('nav-open');
  $('#menu').setAttribute('aria-expanded', 'false');
  const slug = location.hash.replace(/^#\/?/, '');
  const task = tasks.find((t) => t.slug === slug);
  renderNav();
  task ? renderTask(task) : renderHome();
  document.title = task ? `${task.title} · Pharos Agent Kit` : 'Pharos Agent Kit';
  window.scrollTo(0, 0);
}

const fmt = (n) => n.toLocaleString('en-US');

function renderHome() {
  const built = tasks.filter(isBuilt);
  const approved = tasks.filter((t) => statusOf(t) === 'approved');
  const sum = (list) => list.reduce((a, t) => a + t.points, 0);
  $('#main').innerHTML = `
    <p class="eyebrow">Pharos Season of AI</p>
    <h1>Agents built on Chain MCP and Developer Docs MCP</h1>
    <p class="lead">One place to try every task we’ve built for the Agent Arena. Pick a task in the menu: each page shows the official requirements, how our build meets them, and a live demo against Pharos mainnet.</p>
    <div class="stats">
      <div class="stat"><b>${built.length} / ${tasks.length}</b><span>tasks built</span></div>
      <div class="stat"><b>${fmt(sum(built))}</b><span>base points built, of ${fmt(sum(tasks))} in the pool</span></div>
      <div class="stat"><b>${fmt(sum(approved))}</b><span>points approved by reviewers</span></div>
    </div>
    <p class="note">Points are awarded only when an Arena reviewer approves a submission. “Built” means it works and can be tried here, not that it has been scored.</p>
    <section><h2>Ready to try</h2><div class="grid">${built.map(tile).join('') || '<p class="muted">Nothing yet.</p>'}</div></section>
    <section><h2>Planned</h2><div class="grid">${tasks.filter((t) => !isBuilt(t)).map(tile).join('')}</div></section>`;
}

const tile = (t) => `<a class="tile" href="#/${t.slug}">
  <span class="name">${esc(t.title)}</span>
  <span class="sub">${esc(t.category)} · ${esc(t.tier)} · ${t.points} pts</span>
  <span><span class="pill ${statusOf(t)}">${STATUS_LABEL[statusOf(t)]}</span></span></a>`;

function renderTask(t) {
  const meta = META[t.slug];
  const status = statusOf(t);
  const proof = `${location.origin}/#/${t.slug}`;
  const i = tasks.indexOf(t);
  const prev = tasks[i - 1];
  const next = tasks[i + 1];

  $('#main').innerHTML = `
    <p class="eyebrow">${esc(t.category)}</p>
    <h1>${esc(t.title)}</h1>
    <div class="chip-row">
      <span class="pill ${esc(t.tier)}">${esc(t.tier)}</span>
      <span class="pill pts">${t.points} pts <span style="opacity:.7">+${VIDEO_BONUS} with video</span></span>
      <span class="pill ${status}">${STATUS_LABEL[status]}</span>
      <a href="${esc(t.url)}" target="_blank" rel="noopener" style="font-size:13px">Arena task ↗</a>
    </div>
    <p class="lead">${esc(t.summary)}</p>

    <section><h2>What the task asks for</h2><p>${esc(t.build)}</p></section>

    <section><h2>Requirements ${meta ? '<span class="muted" style="font-weight:400">and how this build meets them</span>' : ''}</h2>
      <ul class="reqs">${t.requirements
        .map(
          (r, n) => `<li><span class="mark ${meta ? 'yes' : ''}"></span><span>${esc(r)}</span>
            ${meta?.evidence?.[n] ? `<span class="ev-note">${esc(meta.evidence[n])}</span>` : ''}</li>`,
        )
        .join('')}</ul></section>

    <section><h2>${meta ? 'Try it live' : 'Status'}</h2>
      ${meta ? '<div class="panel" id="panel"></div>' : `<div class="panel"><p style="margin:0"><b>Not built yet.</b></p><p class="muted" style="margin:6px 0 0">${esc(PLAN[t.slug] ?? '')}</p></div>`}
    </section>

    ${
      meta
        ? `<section><h2>Submit to the Arena</h2><div class="panel submit">
            <div class="line"><span>Proof link</span><code id="proof">${esc(proof)}</code><button class="ghost" data-copy="${esc(proof)}">Copy</button></div>
            <div class="line"><span>Repo link</span><code>${esc(REPO)}</code><button class="ghost" data-copy="${esc(REPO)}">Copy</button></div>
            <div class="line"><span>Code</span><span>${meta.files.map((f) => `<a href="${REPO}/blob/main/${f}" target="_blank" rel="noopener"><code>${f}</code></a>`).join(' ')}</span></div>
          </div></section>`
        : ''
    }

    <nav class="pager" aria-label="Task navigation">
      ${prev ? `<a href="#/${prev.slug}">← ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a href="#/${next.slug}">${esc(next.title)} →</a>` : '<span></span>'}
    </nav>`;

  if (meta && PANELS[t.slug]) cleanup = PANELS[t.slug]($('#panel')) ?? (() => {});
  document.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Copy failed';
      }
      setTimeout(() => (b.textContent = 'Copy'), 1500);
    };
  });
}

boot();
