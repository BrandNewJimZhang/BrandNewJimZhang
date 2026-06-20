#!/usr/bin/env node
// Self-hosted "top languages" card generator for the GitHub profile README.
// Replaces the third-party github-readme-stats service: fetches real language
// bytes via the GitHub GraphQL API and renders a Wonderlands x Showtime pixel
// SVG into assets/top-languages.svg. No runtime dependency on any external
// rendering service -- the SVG (and its rasterized PNG) live in the repo.
//
// Scope: ALL repositories the token can see (public + private), owned by the
// user, forks excluded. A default Actions GITHUB_TOKEN only sees this repo, so
// CI passes a fine-grained PAT via the STATS_TOKEN secret; without it the
// workflow skips regeneration and the committed card stays put (see
// .github/workflows/readme-stats.yml).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("GITHUB_TOKEN is required (locally: GITHUB_TOKEN=$(gh auth token)).");
  process.exit(1);
}
const USER = process.env.GH_USER || "BrandNewJimZhang";
const TOP_N = 6;

// wonderlands x showtime palette (jimzhang.me globals.css) -- fallback ramp
const PALETTE = ["#ff5eb5", "#34dd98", "#ffe66d", "#c9b1ff", "#ffb347", "#5eecf2"];
// shorten a few long linguist names so they fit the label column
const DISPLAY = { "Jupyter Notebook": "Jupyter", "Objective-C++": "Obj-C++" };
// canonical linguist colors for languages injected from outside the GraphQL feed
const LANG_COLOR = {
  Python: "#3572A5",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  CSS: "#663399",
  HTML: "#e34c26",
  Shell: "#89e051",
  PowerShell: "#012456",
};

// Heavy authored work that the GraphQL languages feed cannot attribute: the
// JFLFY2255/AutoSkill repo is private and owned by another account, so its
// languages{} stats are not reachable from this user's repository list. These
// bytes are Jim's own net authored contribution on the jim-front-end branch
// (git log --author, added-minus-deleted lines x measured bytes/line), baked
// in as a snapshot so the card reflects real volume. Refresh by re-running the
// git-history measurement when the contribution grows materially.
const EXTERNAL_CONTRIBUTIONS = {
  "JFLFY2255/AutoSkill@jim-front-end": {
    Python: 9179280,
    TypeScript: 2630700,
    JavaScript: 802211,
    CSS: 579207,
  },
};

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "jimzhang-profile-stats",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function collect() {
  const totals = new Map(); // name -> { size, color }
  const add = (name, size, color) => {
    const cur = totals.get(name) || { size: 0, color: color || LANG_COLOR[name] };
    cur.size += size;
    if (!cur.color) cur.color = color || LANG_COLOR[name];
    totals.set(name, cur);
  };
  let after = null;
  do {
    const data = await gql(
      `query($login:String!,$after:String){
        user(login:$login){
          repositories(first:100, after:$after, ownerAffiliations:OWNER, isFork:false){
            pageInfo{ hasNextPage endCursor }
            nodes{ languages(first:15, orderBy:{field:SIZE, direction:DESC}){
              edges{ size node{ name color } } } }
          }
        }
      }`,
      { login: USER, after }
    );
    const repos = data.user.repositories;
    for (const repo of repos.nodes) {
      for (const e of repo.languages.edges) add(e.node.name, e.size, e.node.color);
    }
    after = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null;
  } while (after);

  // merge external authored contributions (see EXTERNAL_CONTRIBUTIONS note)
  for (const langs of Object.values(EXTERNAL_CONTRIBUTIONS)) {
    for (const [name, size] of Object.entries(langs)) add(name, size, LANG_COLOR[name]);
  }
  return totals;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render(rows) {
  const W = 1200;
  const PAD = 40;
  const HEADER_H = 60;
  const HEADER_Y = 20 + HEADER_H;
  const ROW_H = 54;
  const BAR_X = 320;
  const BAR_W = W - BAR_X - PAD - 96; // leave room for percentage
  const H = HEADER_Y + 30 + rows.length * ROW_H + 24;

  const bars = rows
    .map((r, i) => {
      const y = HEADER_Y + 30 + i * ROW_H;
      const fill = r.color || PALETTE[i % PALETTE.length];
      const w = Math.max(10, Math.round(BAR_W * r.pct));
      const pctLabel = `${(r.pct * 100).toFixed(1)}%`;
      return `
  <text x="${PAD}" y="${y + 28}" class="lang">${esc(DISPLAY[r.name] || r.name)}</text>
  <rect x="${BAR_X}" y="${y + 10}" width="${BAR_W}" height="26" fill="#ffe9f3"/>
  <rect x="${BAR_X}" y="${y + 10}" width="${BAR_W}" height="26" fill="none" stroke="#ff85c8" stroke-width="2"/>
  <rect x="${BAR_X}" y="${y + 10}" width="${w}" height="26" fill="${fill}"/>
  <text x="${W - PAD}" y="${y + 28}" class="pct" text-anchor="end">${pctLabel}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Top languages for ${esc(USER)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0f5"/>
      <stop offset="1" stop-color="#fff7df"/>
    </linearGradient>
    <style>
      .head { font: 900 30px "Arial","Helvetica",sans-serif; fill:#ffffff; letter-spacing:1px; }
      .lang { font: 800 22px "Arial","Helvetica",sans-serif; fill:#5c2b48; }
      .pct  { font: 700 21px "Arial","Helvetica",sans-serif; fill:#b86b91; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="#fffafd"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="#d94896" stroke-width="6"/>
  <rect x="20" y="20" width="${W - 40}" height="${HEADER_H}" fill="#ff5eb5"/>
  <text x="${PAD}" y="62" class="head">&#9733; TOP LANGUAGES &#183; ALL REPOS + AUTOSKILL</text>${bars}
</svg>
`;
}

const totals = await collect();
const grand = [...totals.values()].reduce((a, b) => a + b.size, 0);
if (grand === 0) throw new Error("No language data returned from GitHub.");
const rows = [...totals.entries()]
  .map(([name, v]) => ({ name, size: v.size, color: v.color }))
  .sort((a, b) => b.size - a.size)
  .slice(0, TOP_N);
const shown = rows.reduce((a, b) => a + b.size, 0);
for (const r of rows) r.pct = r.size / shown; // normalize across shown langs

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "top-languages.svg");
writeFileSync(out, render(rows));
console.log(`Wrote ${out}`);
for (const r of rows) console.log(`  ${r.name}: ${(r.pct * 100).toFixed(1)}%`);
