import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
