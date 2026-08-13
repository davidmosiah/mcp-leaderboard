import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

assert.ok(existsSync("data/editions"), "at least one canonical weekly edition must exist");
const editionFiles = readdirSync("data/editions").filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
assert.ok(editionFiles.length > 0, "at least one weekly edition JSON must exist");

const render = spawnSync(process.execPath, ["scripts/render-site.mjs"], { encoding: "utf8" });
assert.equal(render.status, 0, render.stderr || render.stdout);

const latestName = editionFiles.at(-1);
const latestSlug = latestName.replace(/\.json$/, "");
const latest = JSON.parse(readFileSync(join("data/editions", latestName), "utf8"));
const issueHtmlPath = join("site/issues", latestSlug, "index.html");
const issueJsonPath = join("site/issues", latestSlug, "edition.json");

assert.ok(existsSync("site/issues/index.html"));
assert.ok(existsSync("site/issues/feed.xml"));
assert.ok(existsSync("site/issues/latest.json"));
assert.ok(existsSync("site/issues/latest/index.html"));
assert.ok(existsSync(issueHtmlPath));
assert.ok(existsSync(issueJsonPath));
assert.deepEqual(JSON.parse(readFileSync(issueJsonPath, "utf8")), latest);
assert.deepEqual(JSON.parse(readFileSync("site/issues/latest.json", "utf8")), latest);

const issueHtml = readFileSync(issueHtmlPath, "utf8");
assert.match(issueHtml, /not correctness or security/i);
assert.equal((issueHtml.match(/\/_vercel\/insights\/script\.js/g) || []).length, 1);
assert.doesNotMatch(issueHtml, /\$49|improve this mcp/i, "neutral editorial pages must not contain the commercial offer");
const directoryCss = readFileSync("site/assets/directory.css", "utf8");
assert.match(directoryCss, /\.weekly-edition \.movements\s*\{/,
  "weekly evidence lists need an explicit layout so labels, counts and scores do not collapse together");
assert.match(directoryCss, /\.weekly-edition \.movements li\s*\{/);

const root = readFileSync("site/index.html", "utf8");
assert.match(root, /href="\/issues\/"/);
const issueIndex = readFileSync("site/issues/index.html", "utf8");
assert.match(issueIndex, new RegExp(`/issues/${latestSlug}`));
const feed = readFileSync("site/issues/feed.xml", "utf8");
assert.match(feed, new RegExp(`<link>https://leaderboard\\.delx\\.ai/issues/${latestSlug}</link>`));
const sitemap = readFileSync("site/sitemap.xml", "utf8");
assert.match(sitemap, /<loc>https:\/\/leaderboard\.delx\.ai\/issues\/<\/loc>/);
assert.match(sitemap, new RegExp(`<loc>https://leaderboard\\.delx\\.ai/issues/${latestSlug}</loc>`));
const llms = readFileSync("site/llms.txt", "utf8");
assert.match(llms, /MCP Scoreboard Weekly/);
assert.match(llms, /https:\/\/leaderboard\.delx\.ai\/issues\/latest\.json/);

console.log(`weekly site gate: ok (${editionFiles.length} editions, latest ${latestSlug})`);
