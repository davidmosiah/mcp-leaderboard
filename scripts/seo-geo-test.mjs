import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const origin = "https://leaderboard.delx.ai";
const data = JSON.parse(readFileSync("data/leaderboard.json", "utf8"));
const scored = (data.results || [])
  .filter((result) => result.status === "scored")
  .sort((a, b) => b.score - a.score || a.npm.localeCompare(b.npm));

const render = spawnSync(process.execPath, ["scripts/render-site.mjs"], {
  encoding: "utf8"
});
assert.equal(render.status, 0, render.stderr || render.stdout);
const firstIndex = readFileSync("site/index.html", "utf8");
const rerender = spawnSync(process.execPath, ["scripts/render-site.mjs"], {
  encoding: "utf8"
});
assert.equal(rerender.status, 0, rerender.stderr || rerender.stdout);
const secondIndex = readFileSync("site/index.html", "utf8");
assert.equal(secondIndex, firstIndex, "render-site must be idempotent");

const serverUrl = (npm) => `${origin}/servers/${npm.split("/").map(encodeURIComponent).join("/")}`;
const serverFile = (npm) => join("site", "servers", ...npm.split("/"), "index.html");
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)]
  .map((match) => JSON.parse(match[1]));

assert.ok(scored.length > 100, "fixture must contain a substantive scored corpus");

const index = secondIndex;
assert.doesNotMatch(index, /GitHub Action/i, "public copy must describe the Grok Cloud refresh");
for (const result of scored.slice(0, 100)) {
  assert.match(index, new RegExp(`href="${serverUrl(result.npm).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
}

const indexGraph = jsonLd(index).flatMap((value) => value["@graph"] || [value]);
const dataset = indexGraph.find((value) => value["@type"] === "Dataset");
const ranking = indexGraph.find((value) => value["@type"] === "ItemList");
assert.equal(dataset.dateModified, data.generatedAt);
assert.equal(dataset.version, data.generatedAt);
assert.equal(ranking.numberOfItems, scored.length);
assert.equal(ranking.itemListElement.length, Math.min(scored.length, 100));
assert.equal(ranking.itemListElement[0].url, serverUrl(scored[0].npm));

const samples = [
  scored[0],
  scored.find((result) => result.npm.startsWith("@")),
  scored.find((result) => !result.npm.startsWith("@"))
].filter(Boolean);
for (const result of samples) {
  const path = serverFile(result.npm);
  assert.ok(existsSync(path), `missing detail page ${path}`);
  const html = readFileSync(path, "utf8");
  assert.match(html, new RegExp(`<link rel="canonical" href="${serverUrl(result.npm).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
  assert.match(html, new RegExp(`<h1[^>]*>${result.npm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`));
  assert.match(html, new RegExp(`Score ${result.score} out of 100`));
  for (const check of result.checks || []) assert.match(html, new RegExp(check.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const graph = jsonLd(html).flatMap((value) => value["@graph"] || [value]);
  const app = graph.find((value) => value["@type"] === "SoftwareApplication");
  assert.equal(app.name, result.npm);
  assert.equal(app.url, serverUrl(result.npm));
  assert.equal(app.additionalProperty.find((value) => value.name === "Agent-readiness score").value, result.score);
}

const generatedPages = readdirSync("site/servers", { recursive: true })
  .filter((path) => path.endsWith("index.html"));
assert.equal(generatedPages.length, scored.length, "one detail page per scored server");

const sitemap = readFileSync("site/sitemap.xml", "utf8");
for (const result of scored) assert.ok(sitemap.includes(`<loc>${serverUrl(result.npm)}</loc>`), `sitemap missing ${result.npm}`);
const rankingPageCount = Math.ceil(scored.length / 100);
for (let page = 2; page <= rankingPageCount; page += 1) {
  const path = join("site", "rankings", String(page), "index.html");
  assert.ok(existsSync(path), `missing ranking page ${page}`);
  assert.ok(sitemap.includes(`<loc>${origin}/rankings/${page}</loc>`), `sitemap missing ranking page ${page}`);
}
assert.equal((sitemap.match(/<url>/g) || []).length, scored.length + rankingPageCount);

const robots = readFileSync("site/robots.txt", "utf8");
assert.match(robots, /User-agent: OAI-SearchBot\s+Allow: \//);

const llms = readFileSync("site/llms.txt", "utf8");
assert.doesNotMatch(llms, /GitHub Action/i);
assert.match(llms, new RegExp(`Scored servers: ${data.counts.scored}`));
assert.match(llms, /https:\/\/leaderboard\.delx\.ai\/llms-full\.txt/);
const llmsFull = readFileSync("site/llms-full.txt", "utf8");
assert.match(llmsFull, new RegExp(data.generatedAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(llmsFull, new RegExp(serverUrl(scored[0].npm).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

console.log(`seo/geo gate: ok (${scored.length} detail pages)`);
