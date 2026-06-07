// Batch-score the corpus with mcp-scorecard. Each target is booted in its own
// child process with a hard timeout, so one hanging server can't stall the run.
// Writes data/leaderboard.json.
//
// Usage:
//   node scripts/run-leaderboard.mjs              # whole corpus
//   node scripts/run-leaderboard.mjs --limit 30   # first N of corpus
//   node scripts/run-leaderboard.mjs --targets a,b # specific npm names
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const TIMEOUT_MS = Number(process.env.TARGET_TIMEOUT_MS || 120000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

const corpus = JSON.parse(readFileSync("data/corpus.json", "utf8"));
let targets;
const explicit = argVal("--targets");
if (explicit) {
  targets = explicit.split(",").map((s) => s.trim()).filter(Boolean)
    .map((n) => corpus.find((c) => c.npm === n) || { name: n, npm: n, repo: null });
} else {
  targets = corpus.slice();
  const limit = argVal("--limit");
  if (limit) targets = targets.slice(0, Number(limit));
}

const SCORECARD_BIN = existsSync("node_modules/.bin/mcp-scorecard")
  ? "node_modules/.bin/mcp-scorecard"
  : null;

function scoreOne(target) {
  return new Promise((resolve) => {
    const cmd = SCORECARD_BIN || "npx";
    const cmdArgs = SCORECARD_BIN ? [target.npm, "--json"] : ["-y", "mcp-scorecard", target.npm, "--json"];
    const child = spawn(cmd, cmdArgs, { env: { ...process.env, MCP_PROBE: "1" } });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ name: target.name, npm: target.npm, repo: target.repo, status: "timeout" }); }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); resolve({ name: target.name, npm: target.npm, repo: target.repo, status: "error", error: e.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const jsonStart = out.indexOf("{");
      if (jsonStart < 0) { resolve({ name: target.name, npm: target.npm, repo: target.repo, status: "error", error: (err.trim().split("\n").pop() || `exit ${code}`).slice(0, 200) }); return; }
      try {
        const r = JSON.parse(out.slice(jsonStart));
        const checks = (r.checks || []).map((c) => ({ id: c.id, label: c.label, score: c.score, status: c.status }));
        const topGap = checks.filter((c) => c.status !== "pass").sort((a, b) => a.score - b.score)[0]?.label || null;
        resolve({ name: target.name, npm: target.npm, repo: target.repo, status: "scored", score: r.totalScore, serverName: r.target?.serverName || null, checks, topGap });
      } catch { resolve({ name: target.name, npm: target.npm, repo: target.repo, status: "error", error: "unparseable scorecard output" }); }
    });
  });
}

async function run() {
  const results = new Array(targets.length);
  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const i = idx++;
      process.stderr.write(`[${i + 1}/${targets.length}] ${targets[i].npm}\n`);
      results[i] = await scoreOne(targets[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return results;
}

const results = await run();
const scored = results.filter((r) => r.status === "scored");
mkdirSync("data", { recursive: true });
const payload = {
  generatedAt: new Date().toISOString(),
  engine: "mcp-scorecard",
  counts: { total: results.length, scored: scored.length, unreachable: results.length - scored.length },
  results
};
writeFileSync("data/leaderboard.json", JSON.stringify(payload, null, 2) + "\n");
console.log(`scored ${scored.length}/${results.length} (unreachable: ${results.length - scored.length})`);
