import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = resolve(repoRoot, "scripts/lib/weekly-brief.mjs");

assert.ok(existsSync(modulePath), "weekly brief module must exist");

const {
  buildEdition,
  renderEditionHtml,
  renderEditionMarkdown
} = await import(pathToFileURL(modulePath));

const check = (id, status, score) => ({
  id,
  label: id.replaceAll("_", " "),
  status,
  score
});

const scored = (npm, score, checks, extra = {}) => ({
  name: npm,
  npm,
  repo: `https://github.com/example/${npm.replaceAll("/", "-")}`,
  status: "scored",
  score,
  checks,
  topGap: checks.find((item) => item.status !== "pass")?.label || null,
  ...extra
});

const board = ({ generatedAt, engineVersion, results }) => ({
  generatedAt,
  engine: "mcp-scorecard",
  engineVersion,
  counts: {
    total: results.length,
    scored: results.filter((item) => item.status === "scored").length,
    unreachable: results.filter((item) => item.status !== "scored").length,
    deferred: 0
  },
  results
});

test("builds a baseline without inventing week-over-week movement", () => {
  const current = board({
    generatedAt: "2026-08-12T21:41:20.376Z",
    engineVersion: null,
    results: [
      scored("alpha", 80, [check("schema_validity", "pass", 10), check("annotations", "fail", 0)]),
      scored("beta", 60, [check("schema_validity", "pass", 10), check("annotations", "fail", 0)]),
      { name: "locked", npm: "locked", status: "error", error: "auth required" }
    ]
  });

  const edition = buildEdition({ current, previous: null });

  assert.equal(edition.kind, "baseline");
  assert.equal(edition.slug, "2026-08-12");
  assert.deepEqual(edition.coverage, { total: 3, scored: 2, unreachable: 1, deferred: 0 });
  assert.equal(edition.ecosystem.averageScore, 70);
  assert.equal(edition.commonGaps[0].checkId, "annotations");
  assert.equal(edition.commonGaps[0].servers, 2);
  assert.deepEqual(edition.movements.improvements, []);
  assert.deepEqual(edition.movements.declines, []);
  assert.match(edition.comparability.reason, /baseline/i);
});

test("separates comparable score movement, package updates and reachability changes", () => {
  const previous = board({
    generatedAt: "2026-08-05T06:00:00.000Z",
    engineVersion: "0.5.10",
    results: [
      scored("alpha", 60, [check("annotations", "fail", 0)], { version: "1.0.0" }),
      scored("beta", 90, [check("annotations", "pass", 10)], { version: "1.0.0" }),
      scored("gamma", 50, [check("resources", "fail", 0)], { version: "1.0.0" }),
      { name: "delta", npm: "delta", version: "1.0.0", status: "error", error: "timeout" },
      scored("epsilon", 40, [check("annotations", "fail", 0)], { version: "1.0.0" }),
      scored("removed", 70, [check("annotations", "pass", 10)], { version: "1.0.0" })
    ]
  });
  const current = board({
    generatedAt: "2026-08-12T06:00:00.000Z",
    engineVersion: "0.5.10",
    results: [
      scored("alpha", 80, [check("annotations", "pass", 10)], { version: "1.0.0" }),
      scored("beta", 70, [check("annotations", "fail", 0)], { version: "1.0.0" }),
      { name: "gamma", npm: "gamma", version: "1.0.0", status: "error", error: "timeout" },
      scored("delta", 55, [check("resources", "warn", 7)], { version: "1.0.0" }),
      scored("epsilon", 95, [check("annotations", "pass", 10)], { version: "2.0.0" }),
      scored("new-package", 65, [check("resources", "pass", 10)], { version: "1.0.0" })
    ]
  });

  const edition = buildEdition({ current, previous });

  assert.equal(edition.kind, "weekly_delta");
  assert.equal(edition.comparability.scoreDeltasComparable, true);
  assert.deepEqual(edition.movements.improvements.map((item) => [item.npm, item.delta]), [["alpha", 20]]);
  assert.deepEqual(edition.movements.declines.map((item) => [item.npm, item.delta]), [["beta", -20]]);
  assert.deepEqual(edition.movements.recovered.map((item) => item.npm), ["delta"]);
  assert.deepEqual(edition.movements.becameUnreachable.map((item) => item.npm), ["gamma"]);
  assert.deepEqual(edition.movements.newPackages.map((item) => item.npm), ["new-package"]);
  assert.deepEqual(edition.movements.removedPackages.map((item) => item.npm), ["removed"]);
  assert.deepEqual(edition.movements.packageUpdates.map((item) => [item.npm, item.previousVersion, item.currentVersion]), [["epsilon", "1.0.0", "2.0.0"]]);
  assert.ok(!edition.movements.improvements.some((item) => item.npm === "epsilon"), "version changes must not be sold as score improvements");
  assert.equal(edition.movements.improvements[0].checkChanges[0].checkId, "annotations");
});

test("suppresses directional score claims across methodology changes", () => {
  const previous = board({
    generatedAt: "2026-08-05T06:00:00.000Z",
    engineVersion: "0.5.9",
    results: [scored("alpha", 20, [check("annotations", "fail", 0)], { version: "1.0.0" })]
  });
  const current = board({
    generatedAt: "2026-08-12T06:00:00.000Z",
    engineVersion: "0.5.10",
    results: [scored("alpha", 100, [check("annotations", "pass", 10)], { version: "1.0.0" })]
  });

  const edition = buildEdition({ current, previous });

  assert.equal(edition.kind, "methodology_change");
  assert.equal(edition.comparability.scoreDeltasComparable, false);
  assert.deepEqual(edition.movements.improvements, []);
  assert.deepEqual(edition.movements.declines, []);
  assert.match(edition.comparability.reason, /0\.5\.9/);
  assert.match(edition.comparability.reason, /0\.5\.10/);
});

test("renders evidence-first human and machine-safe copy", () => {
  const current = board({
    generatedAt: "2026-08-12T21:41:20.376Z",
    engineVersion: null,
    results: [
      scored("<script>alert(1)</script>", 80, [check("annotations", "fail", 0)])
    ]
  });
  const edition = buildEdition({ current, previous: null });
  const markdown = renderEditionMarkdown(edition);
  const html = renderEditionHtml(edition);

  assert.match(markdown, /not correctness or security/i);
  assert.match(markdown, /baseline/i);
  assert.match(html, /not correctness or security/i);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /application\/ld\+json/);
});
