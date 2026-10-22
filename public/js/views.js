// Page views: home, about, and a task page (hero, section nav, sections).

import { $, $$, copyText, esc } from './util.js';
import { ICONS, categoryOf, constellation } from './art.js';
import { ABOUT, EXPLORER, PLAN, REPO, SECTIONS, liveOf } from './content.js';
import { TASK_MODULES } from './tasks/index.js';
import readPanel from './panels/read.js';
import watchPanel from './panels/watch.js';
import docsPanel from './panels/docs.js';

const PANELS = { 'read-contract-state': readPanel, 'event-log-monitor': watchPanel, 'doc-search-cli': docsPanel };
const panelOf = (slug) => PANELS[slug] ?? TASK_MODULES[slug]?.mount;
const TOOL = { chain: ['Chain MCP', 218], docs: ['Docs MCP', 268], rpc: ['Public RPC', 36] };
const SERVER_CHIP = { chain: 'Chain MCP', docs: 'Docs MCP', rpc: 'Public RPC', local: 'This repo' };

export const isLive = (t) => Boolean(liveOf(t.slug));

const toolBadges = (tools = []) => tools.map((k) => `<span class="tool" style="--h:${TOOL[k][1]}"><i></i>${TOOL[k][0]}</span>`).join('');

// Heading with a copy-link button, so any section can be shared by itself.
const heading = (slug, id, text, extra = '') => `<h2 id="h-${id}"><span>${text}</span>${extra}
  <button type="button" class="anchor" data-link="${esc(`${location.origin}/#/${slug}/${id}`)}" aria-label="Copy link to the “${esc(text.replace(/<[^>]+>/g, ''))}” section" title="Copy link to this section">${ICONS.link}</button></h2>`;

// ------------------------------------------------------------------ task page
function hero(t) {
  const cat = categoryOf(t.category);
  const live = liveOf(t.slug);
  return `<header class="hero" style="--h:${cat.hue}">
    ${constellation(t.slug)}
    <div class="hero-in">
      <p class="crumb"><a href="#/">All tasks</a><span aria-hidden="true">/</span><span>${esc(t.category)}</span></p>
      <div class="hero-row">
        <div class="hero-icon" aria-hidden="true">${ICONS[cat.icon]}</div>
        <div>
          <h1 tabindex="-1">${esc(t.title)}</h1>
          <p class="tagline">${esc(live?.tagline ?? t.summary)}</p>
        </div>
      </div>
      <div class="hero-chips">
        <span class="pill">${esc(t.tier)}</span>
        ${toolBadges(live?.tools)}
        <span class="pill ${live ? 'live' : 'planned'}">${live ? '<i></i>Live' : 'Planned'}</span>
      </div>
      <div class="hero-actions">
        ${live ? `<a class="btn solid" href="#/${t.slug}/try">${ICONS.play} Try it live</a><a class="btn" href="#/${t.slug}/story">Read the story</a>` : `<a class="btn" href="#/${t.slug}/requirements">See the requirements</a>`}
        <button type="button" class="btn" data-link="${esc(`${location.origin}/#/${t.slug}`)}">${ICONS.link} Copy link</button>
        <a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener">Task brief ↗</a>
      </div>
    </div>
  </header>`;
}

function requirements(t, live) {
  return `<p class="brief">${esc(t.build)}</p>
    <ul class="reqs">${t.requirements
      .map(
        (r, n) => `<li><span class="mark ${live ? 'yes' : ''}" aria-hidden="true"></span><div><p>${esc(r)}</p>${live?.evidence?.[n] ? `<p class="met"><b>How it is met:</b> ${esc(live.evidence[n])}</p>` : ''}</div></li>`,
      )
      .join('')}</ul>`;
}

const flow = (steps) => `<ol class="flow">${steps
  .map((s, i) => `<li><span class="n">${i + 1}</span><div><div class="fl-h"><span class="chip srv-${s.server}">${SERVER_CHIP[s.server]}</span><code>${esc(s.tool)}</code></div><p>${esc(s.text)}</p></div></li>`)
  .join('')}</ol>`;

const codeBlock = (text, label = 'Copy') => `<div class="code"><button type="button" class="mini" data-copy="${esc(text)}">${label}</button><pre><code>${esc(text)}</code></pre></div>`;

function liveSections(t, live) {
  const slug = t.slug;
  const S = (id, title, body, extra) => `<section class="sec" id="sec-${id}" data-sec="${id}">${heading(slug, id, title, extra)}${body}</section>`;
  return [
    S('story', 'The story', live.story.map((p) => `<p class="story">${esc(p)}</p>`).join('')),
    S('try', 'Try it live', '<div class="panel" id="panel"></div>'),
    S('requirements', 'Requirements', requirements(t, live)),
    S('how', 'How it works', flow(live.how)),
    S('decisions', 'Decisions', `<div class="cards">${live.decisions.map((d) => `<article class="note-card"><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p></article>`).join('')}</div>`),
    S(
      'run',
      'Run it yourself',
      `<p>No install step and no dependencies. Needs Node.js 20+. Clone <a href="${REPO}" target="_blank" rel="noopener">the repository</a> and run:</p>
       ${live.run.commands.map((c) => codeBlock(c)).join('')}
       <p class="muted">Real output from a mainnet run:</p>${codeBlock(live.run.sample)}
       <p>Code: ${live.files.map((f) => `<a class="file" href="${REPO}/blob/main/${f}" target="_blank" rel="noopener"><code>${f}</code></a>`).join(' ')}</p>`,
    ),
    S(
      'verify',
      'Verify independently',
      `<p>Don’t take our word for it. These checks use only public services, with none of our code in the path.</p>
       <div class="cards">${live.verify
         .map((v) => `<article class="note-card"><h3>${esc(v.title)}</h3><p>${esc(v.text)}</p>${v.link ? `<p><a class="btn small" href="${esc(v.link[0])}" target="_blank" rel="noopener">${esc(v.link[1])} ↗</a></p>` : ''}${v.code ? codeBlock(v.code) : ''}</article>`)
         .join('')}</div>`,
    ),
  ].join('');
}

function plannedSections(t) {
  const S = (id, title, body) => `<section class="sec" id="sec-${id}" data-sec="${id}">${heading(t.slug, id, title)}${body}</section>`;
  return [
    S('requirements', 'Requirements', requirements(t, null)),
    S('plan', 'Status and plan', `<div class="panel plan"><p><b>Not built yet.</b></p><p class="muted">${esc(PLAN[t.slug] ?? 'No plan recorded yet.')}</p></div>`),
  ].join('');
}

// Renders a task page into `main`. Returns { cleanup }.
export function renderTask(main, t, params, tasks) {
  const live = liveOf(t.slug);
  const cat = categoryOf(t.category);
  const i = tasks.indexOf(t);
  const prev = tasks[i - 1];
  const next = tasks[i + 1];
  const sections = live ? SECTIONS : [['requirements', 'Requirements'], ['plan', 'Status and plan']];

  main.innerHTML = `<article class="task" style="--h:${cat.hue}">
    ${hero(t)}
    <nav class="toc" aria-label="Sections of this page">${sections.map(([id, label]) => `<a href="#/${t.slug}/${id}" data-toc="${id}">${label}</a>`).join('')}</nav>
    <div class="sections">${live ? liveSections(t, live) : plannedSections(t)}</div>
    <nav class="pager" aria-label="Neighbouring tasks">
      ${prev ? `<a href="#/${prev.slug}"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a href="#/${next.slug}" class="r"><small>Next</small>${esc(next.title)}</a>` : '<span></span>'}
    </nav>
  </article>`;

  let cleanup = () => {};
  if (live && panelOf(t.slug)) cleanup = panelOf(t.slug)($('#panel', main), { slug: t.slug, params }) ?? cleanup;

  // Highlight the section being read in the section nav.
  const links = new Map($$('[data-toc]', main).map((a) => [a.dataset.toc, a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) links.forEach((a, id) => a.toggleAttribute('aria-current', id === e.target.dataset.sec));
    },
    { rootMargin: '-110px 0px -65% 0px' },
  );
  $$('.sec', main).forEach((s) => io.observe(s));
  return { cleanup: () => (cleanup(), io.disconnect()) };
}

// ------------------------------------------------------------------ home
export function renderHome(main, tasks) {
  const live = tasks.filter(isLive);
  const planned = tasks.filter((t) => !isLive(t));
  const card = (t) => {
    const cat = categoryOf(t.category);
    const c = liveOf(t.slug);
    return `<a class="tcard" href="#/${t.slug}" style="--h:${cat.hue}">
      <div class="tcard-art">${constellation(t.slug, 480, 150, 20)}<span class="tcard-icon" aria-hidden="true">${ICONS[cat.icon]}</span></div>
      <div class="tcard-body"><span class="eyebrow">${esc(t.category)}</span><h3>${esc(t.title)}</h3><p>${esc(c.tagline)}</p>
      <div class="tcard-foot">${toolBadges(c.tools)}<span class="pill live"><i></i>Live</span></div></div></a>`;
  };

  main.innerHTML = `
    <header class="home-hero">
      ${constellation('pharos-home', 1100, 340, 46)}
      <div class="hero-in">
        <p class="eyebrow">Pharos Season of AI</p>
        <h1 tabindex="-1">Agents on Pharos you can test yourself</h1>
        <p class="tagline">Working agents built on the Pharos Chain MCP and Developer Docs MCP. Run each one, read its log call by call, and check the result against a second source.</p>
        <div class="hero-actions"><a class="btn solid" href="#/read-contract-state">${ICONS.play} Try the first task</a><a class="btn" href="#/about">How it was built</a><a class="btn" href="${REPO}" target="_blank" rel="noopener">Source on GitHub ↗</a></div>
      </div>
    </header>

    <section class="home-sec"><div class="sec-head"><h2>Ready to test</h2><p class="muted">${live.length} of ${tasks.length} tasks are live. Each has its own page, and each section of a page has its own link.</p></div>
      <div class="tcards">${live.map(card).join('')}</div></section>

    <section class="home-sec"><div class="sec-head"><h2>How to review a task</h2></div>
      <ol class="steps">${ABOUT.review.map((s, n) => `<li><span class="n">${n + 1}</span><p>${esc(s)}</p></li>`).join('')}</ol></section>

    <section class="home-sec"><div class="sec-head"><h2>Coming next</h2><p class="muted">The remaining tasks, with what each one needs. Open one to see its requirements.</p></div>
      <div class="roadmap">${planned.map((t) => `<a href="#/${t.slug}" style="--h:${categoryOf(t.category).hue}"><i></i><span>${esc(t.title)}</span><small>${esc(t.category)}</small></a>`).join('')}</div></section>`;
  return { cleanup() {} };
}

// ------------------------------------------------------------------ about
export function renderAbout(main) {
  main.innerHTML = `
    <header class="home-hero slim">
      ${constellation('pharos-about', 1100, 260, 36)}
      <div class="hero-in"><p class="eyebrow">About</p><h1 tabindex="-1">How this was built</h1><p class="tagline">${esc(ABOUT.intro)}</p></div>
    </header>

    <section class="home-sec"><div class="sec-head"><h2>How a request flows</h2></div>
      <ol class="flowbox">${ABOUT.flow.map((f, n) => `<li><span class="n">${n + 1}</span><div><b>${esc(f.who)}</b><p>${esc(f.what)}</p></div></li>`).join('')}</ol>
      <p class="muted">Every upstream call is recorded with its tool, arguments, raw response and timing. That record is the run log on each task page.</p></section>

    <section class="home-sec"><div class="sec-head"><h2>Constraints we ran into</h2><p class="muted">These shaped the design, and each one is handled in the code.</p></div>
      <div class="cards">${ABOUT.constraints.map((c) => `<article class="note-card"><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></article>`).join('')}</div></section>

    <section class="home-sec"><div class="sec-head"><h2>Source and checks</h2></div>
      <p>The code is open: <a href="${REPO}" target="_blank" rel="noopener">${REPO.replace('https://', '')}</a>. It has no dependencies and ships offline tests for the decoding, de-duplication and “no good answer” logic.</p>
      ${codeBlock(`git clone ${REPO}\ncd pharos-agent-kit\nnpm test`)}
      <p class="muted">Block explorer used for checks: <a href="${EXPLORER}" target="_blank" rel="noopener">pharosscan.xyz</a>.</p></section>`;
  return { cleanup() {} };
}

// One delegated handler for the copy buttons and anchor links that views render.
export function wireCopy(root) {
  root.addEventListener('click', (e) => {
    const link = e.target.closest('[data-link]');
    if (link) return void copyText(link.dataset.link, 'Link copied');
    const copy = e.target.closest('[data-copy]');
    if (copy && !copy.closest('.log') && !copy.closest('.panel')) copyText(copy.dataset.copy);
  });
}
