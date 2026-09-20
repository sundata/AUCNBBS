/**
 * Branded SVG cover for AI feature articles. Deterministic palette from the
 * slug so every article gets a stable, distinct colour theme. Served by
 * GET /articles/:slug/cover.svg — no external image dependency required.
 */
const PALETTES: [string, string][] = [
  ['#0f4c81', '#3282b8'],
  ['#b23a48', '#e07a5f'],
  ['#1b6b52', '#81b29a'],
  ['#6d3b8e', '#b5838d'],
  ['#9a5b13', '#e0a458'],
  ['#274156', '#5c8d89'],
];

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Wrap a title into at most two lines of ~13 chars for the 1200×630 card. */
function wrapTitle(title: string): [string, string] {
  const t = title.slice(0, 28);
  if (t.length <= 13) return [t, ''];
  const cut = t.length <= 20 ? 10 : 13;
  return [t.slice(0, cut), t.slice(cut, cut + 14)];
}

export function articleCoverSvg(title: string, slug: string): string {
  const hash = [...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const [from, to] = PALETTES[hash % PALETTES.length];
  const [line1, line2] = wrapTitle(title);
  const titleY = line2 ? 300 : 330;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient>
</defs>
<rect width="1200" height="630" fill="url(#g)"/>
<circle cx="1080" cy="80" r="240" fill="#ffffff" opacity="0.08"/>
<circle cx="120" cy="580" r="300" fill="#ffffff" opacity="0.06"/>
<circle cx="950" cy="520" r="140" fill="#000000" opacity="0.07"/>
<text x="80" y="120" font-family="sans-serif" font-size="34" fill="#ffffff" opacity="0.85" letter-spacing="6">澳中生活圈 · AI 画报</text>
<text x="80" y="${titleY}" font-family="sans-serif" font-weight="700" font-size="76" fill="#ffffff">${esc(line1)}</text>
${line2 ? `<text x="80" y="${titleY + 96}" font-family="sans-serif" font-weight="700" font-size="76" fill="#ffffff">${esc(line2)}</text>` : ''}
<rect x="80" y="560" width="180" height="4" fill="#ffffff" opacity="0.7"/>
<text x="80" y="610" font-family="sans-serif" font-size="26" fill="#ffffff" opacity="0.75">aucn.info</text>
</svg>`;
}
