// Bake data/leaderboard.json into the static site (site/), so the deployed page
// matches the committed board without JavaScript. site/assets/site.js still
// live-refreshes the full table client-side between deploys; this script is what
// makes the *served* HTML, JSON, and sitemap fresh on every weekly CI run.
//
// Fails loudly (non-zero exit) if an injection anchor is missing — a silent no-op
// here would re-freeze the site, which is exactly the bug this script exists to fix.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const data = JSON.parse(readFileSync("data/leaderboard.json", "utf8"));
const scored = (data.results || [])
  .filter((r) => r.status === "scored")
  .sort((a, b) => b.score - a.score || a.npm.localeCompare(b.npm));
if (!scored.length) {
  console.error("render-site: no scored servers in data/leaderboard.json — refusing to bake an empty board");
  process.exit(1);
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tierClass = (s) => (s >= 90 ? "tier-a" : s >= 75 ? "tier-b" : s >= 60 ? "tier-c" : s >= 40 ? "tier-d" : "tier-f");
const npmUrl = (npm) => "https://www.npmjs.com/package/" + npm;
const dateShort = data.generatedAt.slice(0, 10);

const heroRows = scored.slice(0, 5).map((r, i) => `          <tr class="${i < 3 ? `top-${i + 1}` : ""}">
            <td class="col-rank">${i + 1}</td>
            <td class="col-srv"><a href="${npmUrl(r.npm)}" target="_blank" rel="noopener">${esc(r.npm)}</a></td>
            <td><span class="score-pill ${tierClass(r.score)}">${r.score}</span></td>
            <td class="gap-cell"><span class="dot"></span>${esc(r.topGap || "—")}</td>
          </tr>`).join("\n");

const fullRows = scored.map((r, i) => {
  const rank = i + 1;
  const checks = r.checks || [];
  const passes = checks.filter((c) => c.status === "pass").map((c) => c.label).slice(0, 3);
  const fails = checks.filter((c) => c.status !== "pass").map((c) => c.label).slice(0, 2);
  const tags =
    passes.map((p) => `              <span class="pass">+ ${esc(p)}</span>`).join("\n") +
    (passes.length && fails.length ? "\n" : "") +
    fails.map((f) => `              <span class="fail">&ndash; ${esc(f)}</span>`).join("\n");
  return `          <tr class="${rank <= 3 ? `top-${rank}` : ""}">
            <td class="fb-rank">${rank}</td>
            <td class="fb-srv"><a href="${npmUrl(r.npm)}" target="_blank" rel="noopener">${esc(r.npm)}</a><small>${r.serverName ? `server: ${esc(r.serverName)}` : ""}</small></td>
            <td><span class="score-pill ${tierClass(r.score)}">${r.score}</span></td>
            <td><div class="bar"><i style="width:${r.score}%;background:linear-gradient(90deg,var(--gold),var(--violet))"></i></div></td>
            <td><div class="check-tags">
${tags}
            </div></td>
          </tr>`;
}).join("\n");

let html = readFileSync("site/index.html", "utf8");
let missing = [];
const swapTbody = (id, rows) => {
  const re = new RegExp(`(<tbody id="${id}">)[\\s\\S]*?(</tbody>)`);
  if (!re.test(html)) { missing.push(id); return; }
  html = html.replace(re, `$1\n${rows}\n          $2`);
};
swapTbody("hero-board-body", heroRows);
swapTbody("full-board-body", fullRows);

const swapLive = (key, value) => {
  const re = new RegExp(`(data-live="${key}"[^>]*>)[^<]*(</)`, "g");
  if (!re.test(html)) { missing.push(`data-live=${key}`); return; }
  html = html.replace(re, `$1${value}$2`);
};
swapLive("generated", dateShort);
swapLive("scored", String(data.counts?.scored ?? scored.length));
swapLive("total", String(data.counts?.total ?? data.results.length));
swapLive("unreachable", String(data.counts?.unreachable ?? data.results.length - scored.length));

if (!/<body data-generated="[^"]*">/.test(html)) missing.push("body[data-generated]");
html = html.replace(/<body data-generated="[^"]*">/, `<body data-generated="${data.generatedAt}">`);

if (missing.length) {
  console.error(`render-site: anchors missing in site/index.html: ${missing.join(", ")}`);
  process.exit(1);
}
writeFileSync("site/index.html", html);

let sitemap = readFileSync("site/sitemap.xml", "utf8");
sitemap = sitemap.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${dateShort}</lastmod>`);
writeFileSync("site/sitemap.xml", sitemap);

copyFileSync("data/leaderboard.json", "site/leaderboard.json");
console.log(`rendered site/ — ${scored.length} ranked, generated ${dateShort}`);
