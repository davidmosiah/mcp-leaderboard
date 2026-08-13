import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "mcp-leaderboard-metadata-test-"));
const fakeBin = join(fixtureRoot, "node_modules/.bin/mcp-scorecard");

try {
  mkdirSync(dirname(fakeBin), { recursive: true });
  mkdirSync(join(fixtureRoot, "data"), { recursive: true });
  mkdirSync(join(fixtureRoot, "node_modules/mcp-scorecard"), { recursive: true });
  writeFileSync(
    join(fixtureRoot, "data/corpus.json"),
    JSON.stringify([{ name: "fixture", npm: "fixture-mcp", version: "2.3.4", repo: "https://example.test/repo" }])
  );
  writeFileSync(join(fixtureRoot, "node_modules/mcp-scorecard/package.json"), JSON.stringify({ version: "0.5.10" }));
  writeFileSync(fakeBin, "#!/bin/sh\nprintf '%s\\n' '{\"totalScore\":80,\"target\":{\"serverName\":\"fixture\"},\"checks\":[]}'\n");
  chmodSync(fakeBin, 0o755);

  const result = spawnSync(
    process.execPath,
    [join(repoRoot, "scripts/run-leaderboard.mjs")],
    { cwd: fixtureRoot, encoding: "utf8", timeout: 15_000 }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(readFileSync(join(fixtureRoot, "data/leaderboard.json"), "utf8"));
  assert.equal(payload.engineVersion, "0.5.10");
  assert.equal(payload.results[0].version, "2.3.4");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("result metadata gate: ok");
