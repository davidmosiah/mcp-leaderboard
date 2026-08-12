import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const origin = "https://leaderboard.delx.ai";
const key = "694d4f0ab91bbfda87508e3a73124d40";
const keyLocation = `${origin}/${key}.txt`;
const endpoint = "https://api.indexnow.org/indexnow";

const sitemap = readFileSync("site/sitemap.xml", "utf8");
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

assert.ok(urlList.length > 0, "sitemap has no canonical URLs");
assert.ok(urlList.length <= 10_000, "IndexNow accepts at most 10,000 URLs per request");
assert.ok(urlList.every((url) => url.startsWith(`${origin}/`)), "sitemap contains a foreign host");
assert.equal(new Set(urlList).size, urlList.length, "sitemap contains duplicate URLs");
assert.equal(readFileSync(`site/${key}.txt`, "utf8").trim(), key, "IndexNow key file mismatch");

if (process.argv.includes("--dry-run")) {
  console.log(`IndexNow dry run: ok (${urlList.length} canonical URLs)`);
  process.exit(0);
}

const publishedKey = await fetch(keyLocation);
assert.equal(publishedKey.status, 200, `published IndexNow key returned HTTP ${publishedKey.status}`);
assert.equal((await publishedKey.text()).trim(), key, "published IndexNow key mismatch");

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: new URL(origin).host,
    key,
    keyLocation,
    urlList
  })
});

assert.ok([200, 202].includes(response.status), `IndexNow rejected the batch with HTTP ${response.status}`);
console.log(`IndexNow accepted ${urlList.length} canonical URLs (HTTP ${response.status})`);
