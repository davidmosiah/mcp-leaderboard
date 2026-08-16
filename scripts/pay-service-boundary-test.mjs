import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL(".", import.meta.url)));
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const rootPkg = json("package.json");
const payPkg = json("pay-service/package.json");

assert.equal(rootPkg.name, "mcp-leaderboard");
assert.ok(existsSync(join(repoRoot, "pay-service/package-lock.json")), "pay-service must have its own lockfile");
assert.equal(payPkg.name, "mcp-scoreboard-pay");
assert.match(JSON.stringify(payPkg.dependencies), /@x402\/express/);
assert.equal(rootPkg.dependencies, undefined);
assert.doesNotMatch(JSON.stringify(rootPkg.devDependencies || {}), /@x402|express/);
assert.match(rootPkg.scripts.test, /test:pay-service/);
assert.match(rootPkg.scripts.test, /test:pay-boundary/);
assert.equal(rootPkg.scripts["test:pay-service"], "npm test --prefix pay-service");

const scorerFiles = [
  "scripts/build-corpus.mjs",
  "scripts/run-leaderboard.mjs",
  "scripts/render.mjs",
  "scripts/render-site.mjs",
  "scripts/generate-weekly-brief.mjs",
  "scripts/lib/weekly-brief.mjs",
  "scripts/submit-indexnow.mjs"
];
for (const rel of scorerFiles) {
  const source = read(rel);
  assert.doesNotMatch(source, /pay-service\//, `${rel} must not import pay-service`);
  assert.doesNotMatch(source, /PAY_SERVICE_/, `${rel} must not read pay-service env`);
  assert.doesNotMatch(source, /@x402\//, `${rel} must not load the x402 runtime`);
}

const boardSurfaces = [
  "templates/index.html",
  "site/assets/site.js",
  "site/assets/site.css",
  "site/assets/directory.css",
  "scripts/render-site.mjs",
  "scripts/render.mjs",
  "scripts/generate-weekly-brief.mjs",
  "scripts/lib/weekly-brief.mjs"
];
const paidCta = /pay\.leaderboard\.delx\.ai|commerce\.delx\.ai|api\.delx\.ai|\$49|buy now|improve this mcp|checkout|add to cart/i;
for (const rel of boardSurfaces) {
  const source = read(rel);
  assert.doesNotMatch(source, paidCta, `${rel} would give leaderboard.delx.ai a paid CTA or foreign payment host`);
}

const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "var") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(mjs|js|json|md)$/.test(name)) acc.push(full);
  }
  return acc;
};

const payRuntime = walk(join(repoRoot, "pay-service/src")).concat(
  walk(join(repoRoot, "pay-service/manifests")),
  [join(repoRoot, "pay-service/package.json")]
);
assert.ok(payRuntime.length > 0, "pay-service runtime tree must exist");
for (const file of payRuntime) {
  const source = readFileSync(file, "utf8");
  const rel = relative(repoRoot, file);
  assert.doesNotMatch(source, /delx-agent-commerce/, `${rel} must not require Delx Commerce files`);
  assert.doesNotMatch(
    source,
    /["'`]https?:\/\/(api|commerce)\.delx\.ai/,
    `${rel} must not use api.delx.ai or commerce.delx.ai as a payment host`
  );
}

const stripped = spawnSync(
  process.execPath,
  [
    "-e",
    `
      const keys = Object.keys(process.env).filter((k) => k.startsWith("PAY_SERVICE_"));
      if (keys.length) {
        console.error("score child received pay-service env: " + keys.join(","));
        process.exit(2);
      }
      console.log("scorer isolation child: ok");
    `
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME }
  }
);
assert.equal(stripped.status, 0, stripped.stderr || stripped.stdout);
assert.match(stripped.stdout, /scorer isolation child: ok/);

console.log("pay-service boundary gate: ok (scorer isolation, no board CTA, no Delx Commerce host)");
