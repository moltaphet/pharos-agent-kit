// Visual identity: a colour and icon per category, and a generated "constellation"
// for each task header. The art is seeded from the task slug, so every task has its
// own header and it never changes between visits.

const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  chain: ic('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  docs: ic('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM19 19v2H6"/>'),
  skill: ic('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>'),
  compose: ic('<path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5"/>'),
  defi: ic('<path d="M3 3v18h18M7 15l4-4 3 3 5-6"/>'),
  payments: ic('<path d="M3 6h18v12H3zM3 10h18M7 15h3"/>'),
  trading: ic('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  compliance: ic('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4"/>'),
  support: ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M18.4 5.6l-3.2 3.2M8.8 15.2l-3.2 3.2"/>'),
  cross: ic('<circle cx="12" cy="3.5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 5.5v6M12 11.5l-6 6M12 11.5l6 6"/>'),
  link: ic('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  copy: ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  play: ic('<path d="M7 4l13 8-13 8V4z"/>'),
  sun: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: ic('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>'),
  download: ic('<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>'),
  check: ic('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

// category -> { hue, icon, blurb }
export const CATEGORY = {
  'Chain MCP': { hue: 218, icon: 'chain', blurb: 'Live chain data through the Pharos Chain MCP server' },
  'Developer Docs MCP': { hue: 268, icon: 'docs', blurb: 'The Pharos docs, queried through Developer Docs MCP' },
  SkillEngine: { hue: 36, icon: 'skill', blurb: 'Skills for the Pharos Skill Engine' },
  Composition: { hue: 174, icon: 'compose', blurb: 'Several tools working as one flow' },
  'DeFi / Portfolio': { hue: 150, icon: 'defi', blurb: 'Positions, yields and portfolios' },
  Payments: { hue: 328, icon: 'payments', blurb: 'Preparing and paying on-chain' },
  'Trading / Monitoring': { hue: 18, icon: 'trading', blurb: 'Watching the chain and reacting' },
  'Compliance / Security': { hue: 352, icon: 'compliance', blurb: 'Risk and audit' },
  'Support / Reporting': { hue: 196, icon: 'support', blurb: 'Explaining and reporting' },
  'Cross-tool / Advanced': { hue: 248, icon: 'cross', blurb: 'Docs, chain and skills together' },
};
export const categoryOf = (name) => CATEGORY[name] ?? { hue: 220, icon: 'chain', blurb: '' };

// Deterministic PRNG so the same slug always gives the same art.
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// A network of nodes joined to their near neighbours: it reads as "chain" without
// being literal, and it differs for every task.
export function constellation(seed, w = 960, h = 300, count = 34) {
  const rand = rng(seed);
  const nodes = Array.from({ length: count }, () => ({ x: rand() * w, y: rand() * h, r: 1.2 + rand() * 3.2, glow: rand() > 0.82 }));
  const lines = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (d < 150) lines.push(`<line x1="${nodes[i].x.toFixed(1)}" y1="${nodes[i].y.toFixed(1)}" x2="${nodes[j].x.toFixed(1)}" y2="${nodes[j].y.toFixed(1)}" stroke-opacity="${(0.5 * (1 - d / 150)).toFixed(2)}"/>`);
    }
  }
  const dots = nodes.map((n) => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill-opacity="${n.glow ? 0.95 : 0.55}" ${n.glow ? 'class="glow"' : ''}/>`);
  return `<svg class="art" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><g stroke="#fff" stroke-width="1">${lines.join('')}</g><g fill="#fff">${dots.join('')}</g></svg>`;
}
