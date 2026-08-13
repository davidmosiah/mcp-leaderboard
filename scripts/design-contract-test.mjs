import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

assert.ok(existsSync("templates/index.html"), "the home page needs a hand-owned template outside generated output");

const render = spawnSync(process.execPath, ["scripts/render-site.mjs"], { encoding: "utf8" });
assert.equal(render.status, 0, render.stderr || render.stdout);

const html = readFileSync("site/index.html", "utf8");
const css = readFileSync("site/assets/site.css", "utf8");
const js = readFileSync("site/assets/site.js", "utf8");
const vercel = readFileSync("site/vercel.json", "utf8");

assert.match(html, /data-design="registry-observatory"/);
assert.match(html, /id="server-search"/);
assert.match(html, /id="search-results"[^>]*aria-live="polite"/);
assert.match(html, /href="\/issues\/latest\/"/);
assert.match(html, /data-live="average"/);
assert.match(html, /data-live="median"/);
assert.match(html, /Complete registry run/i);
assert.doesNotMatch(html, /class="grad"|🏆|purple gradient/i);

assert.match(css, /--paper:/);
assert.match(css, /--signal:/);
assert.match(css, /\.search-shell/);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /@media \(max-width: 640px\)/);

assert.match(js, /server-search/);
assert.match(js, /search-results/);
assert.match(js, /scorecardUrl/);
assert.match(js, /textContent/);
assert.match(html, /analytics-init\.js/);
assert.doesNotMatch(html, /window\.va\s*=|<script>window\.va/);
assert.match(vercel, /fonts\.googleapis\.com/);
assert.match(vercel, /fonts\.gstatic\.com/);
assert.match(css, /\.full-board thead/);

const ogCard = readFileSync("site/assets/og-card.png");
assert.equal(ogCard.readUInt32BE(16), 1200, "Open Graph card must remain 1200 px wide");
assert.equal(ogCard.readUInt32BE(20), 630, "Open Graph card must remain 630 px tall");

console.log("design contract gate: ok (registry observatory, search, responsive and accessible)");
