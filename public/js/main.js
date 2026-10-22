// Boot, side menu, router and header status.

import { $, $$, api, esc, store } from './util.js';
import { ICONS, categoryOf } from './art.js';
import { REPO } from './content.js';
import { isLive, renderAbout, renderHome, renderTask, wireCopy } from './views.js';

let tasks = [];
let filter = 'all';
let query = '';
let current = { key: null, cleanup: () => {} };

const main = $('#main');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ routing
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [slug = '', section = ''] = path.split('/');
  return { slug, section, qs, params: Object.fromEntries(new URLSearchParams(qs)) };
}

function route() {
  const { slug, section, qs, params } = parseRoute();
  const key = `${slug}?${qs}`;
  const task = tasks.find((t) => t.slug === slug);

  if (key !== current.key) {
    current.cleanup();
    if (task) current = { key, ...renderTask(main, task, params, tasks) };
    else if (slug === 'about') current = { key, ...renderAbout(main) };
    else current = { key, ...renderHome(main, tasks) };
    document.title = task ? `${task.title} · Pharos Agent Kit` : slug === 'about' ? 'How this was built · Pharos Agent Kit' : 'Pharos Agent Kit';
    renderNav();
    document.body.classList.remove('nav-open');
    $('#menu').setAttribute('aria-expanded', 'false');
    if (!section) {
      window.scrollTo(0, 0);
      $('h1', main)?.focus({ preventScroll: true });
    }
  }
  if (section) {
    const target = $(`#sec-${section}`, main);
    // wait a frame so a freshly rendered page has laid out before we scroll
    requestAnimationFrame(() => target?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }));
  }
}

// ------------------------------------------------------------------ side menu
function renderNav() {
  const { slug } = parseRoute();
  const shown = tasks.filter((t) => (filter === 'all' || (filter === 'live' ? isLive(t) : !isLive(t))) && (!query || `${t.title} ${t.category}`.toLowerCase().includes(query)));
  const groups = new Map();
  for (const t of shown) groups.set(t.category, [...(groups.get(t.category) ?? []), t]);
  $('#nav').innerHTML = shown.length
    ? [...groups]
        .map(
          ([cat, list]) => `<div class="group" style="--h:${categoryOf(cat).hue}"><h3>${esc(cat)}</h3>${list
            .map((t) => `<a class="item${isLive(t) ? ' live' : ''}" href="#/${t.slug}" ${t.slug === slug ? 'aria-current="page"' : ''}><span class="dot" aria-hidden="true"></span><span class="t">${esc(t.title)}</span>${isLive(t) ? '<span class="lv">Live</span>' : ''}</a>`)
            .join('')}</div>`,
        )
        .join('')
    : '<p class="none-found">No tasks match.</p>';
  $$('.nav-top a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === `#/${slug}` || (a.getAttribute('href') === '#/' && slug === '')));
}

// ------------------------------------------------------------------ header: theme + service status
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme').innerHTML = dark ? ICONS.sun : ICONS.moon;
  $('#theme').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

async function pollHealth() {
  const box = $('#health');
  try {
    const { data } = await api('health');
    box.innerHTML = data.services
      .map((s) => `<span class="svc ${s.ok ? 'ok' : 'down'}" title="${esc(`${s.name}: ${s.ok ? s.detail : 'unavailable, ' + s.detail} (${s.ms} ms)`)}"><i></i>${esc(s.name.replace('Developer ', ''))}</span>`)
      .join('');
    box.setAttribute('aria-label', 'Live status of the Pharos services this site uses');
  } catch {
    box.innerHTML = '<span class="svc down" title="Could not reach this site’s API"><i></i>API</span>';
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  $('#repo-link').href = REPO;
  applyTheme(store.get('theme'));
  $('#theme').onclick = () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = dark ? 'light' : 'dark';
    store.set('theme', next);
    applyTheme(next);
  };
  try {
    ({ tasks } = await (await fetch('/registry.json')).json());
  } catch {
    main.innerHTML = '<p class="error">Could not load the task list.</p>';
    return;
  }

  $('.filters').onclick = (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    filter = f;
    $$('.filters button').forEach((b) => b.classList.toggle('on', b === e.target));
    renderNav();
  };
  $('#search').oninput = (e) => ((query = e.target.value.trim().toLowerCase()), renderNav());
  $('#menu').onclick = () => $('#menu').setAttribute('aria-expanded', document.body.classList.toggle('nav-open'));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $('#search').focus();
    }
    if (e.key === 'Escape') document.body.classList.remove('nav-open');
  });
  wireCopy(main);
  window.addEventListener('hashchange', route);
  route();

  pollHealth();
  setInterval(() => !document.hidden && pollHealth(), 45_000);
}

boot();
