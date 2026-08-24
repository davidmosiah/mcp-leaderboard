import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generator = join(repoRoot, "scripts/generate-weekly-brief.mjs");

assert.ok(existsSync(generator), "weekly brief generator must exist");

const makeBoard = (generatedAt, score) => ({
  generatedAt,
  engine: "mcp-scorecard",
  engineVersion: "0.5.10",
  counts: { total: 1, scored: 1, unreachable: 0, deferred: 0 },
  results: [{
    name: "fixture",
    npm: "fixture-mcp",
    version: "1.0.0",
    repo: "https://example.test/fixture",
    status: "scored",
    score,
    checks: [{ id: "annotations", label: "Annotations", status: score > 50 ? "pass" : "fail", score: score > 50 ? 10 : 0 }],
    topGap: score > 50 ? null : "Annotations"
  }]
});

test("reads a multi-megabyte HEAD leaderboard instead of publishing a false baseline", () => {
  const fixture = mkdtempSync(join(tmpdir(), "mcp-weekly-gitjson-"));
  try {
    const dataDir = join(fixture, "data");
    const outputDir = join(fixture, "editions");
    mkdirSync(dataDir, { recursive: true });
    const previous = makeBoard("2026-08-19T14:21:36.932Z", 40);
    const current = makeBoard("2026-08-24T12:38:53.956Z", 80);
    previous.counts.total = 12000;
    previous.counts.scored = 12000;
    previous.results = Array.from({ length: 12000 }, (_, index) => ({
      ...previous.results[0],
      name: `fixture-${index}`,
      npm: index === 0 ? "fixture-mcp" : `fixture-pad-${index}`
    }));
    const previousJson = `${JSON.stringify(previous)}\n`;
    assert.ok(Buffer.byteLength(previousJson) > 1024 * 1024, "fixture must exceed Node's default maxBuffer");
    writeFileSync(join(dataDir, "leaderboard.json"), previousJson);
    writeFileSync(join(dataDir, "corpus.json"), "[]\n");
    const git = (args) => {
      const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result;
    };
    git(["init"]);
    git(["add", "data/leaderboard.json", "data/corpus.json"]);
    git(["-c", "user.name=weekly-test", "-c", "user.email=weekly-test@example.test", "commit", "-m", "previous board"]);
    writeFileSync(join(dataDir, "leaderboard.json"), `${JSON.stringify(current)}\n`);
    const generated = spawnSync(process.execPath, [generator, "--out-dir", outputDir], {
      cwd: fixture,
      encoding: "utf8"
    });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    assert.match(generated.stdout, /weekly_delta 2026-08-24/);
    const edition = JSON.parse(readFileSync(join(outputDir, "2026-08-24.json"), "utf8"));
    assert.equal(edition.kind, "weekly_delta");
    assert.equal(edition.previousGeneratedAt, previous.generatedAt);
    assert.equal(edition.comparability.scoreDeltasComparable, true);
    assert.deepEqual(edition.movements.improvements.map((item) => item.npm), ["fixture-mcp"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("writes a deterministic dated JSON and Markdown edition", () => {
  const fixture = mkdtempSync(join(tmpdir(), "mcp-weekly-generator-"));
  try {
    const currentPath = join(fixture, "current.json");
    const previousPath = join(fixture, "previous.json");
    const outputDir = join(fixture, "editions");
    writeFileSync(currentPath, JSON.stringify(makeBoard("2026-08-12T06:00:00.000Z", 80)));
    writeFileSync(previousPath, JSON.stringify(makeBoard("2026-08-05T06:00:00.000Z", 40)));

    const args = [generator, "--current", currentPath, "--previous", previousPath, "--out-dir", outputDir];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const jsonPath = join(outputDir, "2026-08-12.json");
    const markdownPath = join(outputDir, "2026-08-12.md");
    assert.ok(existsSync(jsonPath));
    assert.ok(existsSync(markdownPath));
    const firstJson = readFileSync(jsonPath, "utf8");
    const firstMarkdown = readFileSync(markdownPath, "utf8");
    const edition = JSON.parse(firstJson);
    assert.equal(edition.kind, "weekly_delta");
    assert.deepEqual(edition.movements.improvements.map((item) => item.npm), ["fixture-mcp"]);

    const second = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(jsonPath, "utf8"), firstJson);
    assert.equal(readFileSync(markdownPath, "utf8"), firstMarkdown);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
