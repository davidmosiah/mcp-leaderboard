import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildEdition, renderEditionMarkdown } from "./lib/weekly-brief.mjs";

const args = process.argv.slice(2);
const argValue = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const gitJson = (path) => {
  try {
    return JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
};
const enrichVersions = (board, corpus) => {
  if (!board || !Array.isArray(corpus)) return board;
  const versions = new Map(corpus.map((item) => [item.npm, item.version || null]));
  return {
    ...board,
    results: board.results.map((item) => ({ ...item, version: item.version || versions.get(item.npm) || null }))
  };
};

const currentPath = argValue("--current", "data/leaderboard.json");
const currentCorpusPath = argValue("--current-corpus", "data/corpus.json");
const previousPath = argValue("--previous");
const previousCorpusPath = argValue("--previous-corpus");
const outDir = argValue("--out-dir", "data/editions");
const baselineOnly = args.includes("--baseline");

let current = readJson(currentPath);
try {
  current = enrichVersions(current, readJson(currentCorpusPath));
} catch {
  // An explicit fixture may already contain versions and omit a corpus.
}

let previous = null;
if (!baselineOnly) {
  previous = previousPath ? readJson(previousPath) : gitJson("data/leaderboard.json");
  const previousCorpus = previousCorpusPath
    ? readJson(previousCorpusPath)
    : previousPath
      ? null
      : gitJson("data/corpus.json");
  previous = enrichVersions(previous, previousCorpus);
  if (previous?.generatedAt === current.generatedAt) previous = null;
}

const edition = buildEdition({ current, previous });
mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, `${edition.slug}.json`);
const markdownPath = join(outDir, `${edition.slug}.md`);
writeFileSync(jsonPath, `${JSON.stringify(edition, null, 2)}\n`);
writeFileSync(markdownPath, renderEditionMarkdown(edition));
console.log(`weekly brief: ${edition.kind} ${edition.slug} → ${jsonPath}`);
