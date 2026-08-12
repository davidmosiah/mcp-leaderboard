// Build the leaderboard corpus from the official MCP registry.
// Extracts every server that ships an installable npm package, dedupes by
// package name, keeps the latest active entry. Writes data/corpus.json.
import { writeFileSync, mkdirSync } from "node:fs";

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const LIMIT = 100;
// Safety cap only — with version=latest the registry serves one entry per server.
// If we ever hit it, the corpus is TRUNCATED and the hard failure below must remain;
// a silently partial corpus breaks the board's "every public MCP server" claim
// (that exact bug hid every server published after ~page 60 until 2026-07-06).
const DEFAULT_MAX_PAGES = 1000;
const BLOCKED_PACKAGES = new Set([
  // Installs a macOS background app + LaunchAgent during normal execution.
  "local-mcp"
]);

async function fetchPage(cursor) {
  const url = cursor
    ? `${REGISTRY}?limit=${LIMIT}&version=latest&cursor=${encodeURIComponent(cursor)}`
    : `${REGISTRY}?limit=${LIMIT}&version=latest`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  return res.json();
}

function npmPackage(server) {
  const pkgs = server.packages || [];
  return pkgs.find((p) => (p.registryType || p.registry_type) === "npm");
}

function maxPagesFromEnv() {
  const raw = process.env.MAX_PAGES;
  if (raw === undefined) return DEFAULT_MAX_PAGES;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`MAX_PAGES must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

async function main() {
  const maxPages = maxPagesFromEnv();
  const rows = [];
  const requestedCursors = new Set();
  let cursor = null;
  let pages = 0;
  do {
    if (cursor) {
      if (requestedCursors.has(cursor)) {
        throw new Error(`registry pagination loop detected after ${pages} pages`);
      }
      requestedCursors.add(cursor);
    }
    const data = await fetchPage(cursor);
    const servers = data.servers || [];
    for (const entry of servers) {
      const s = entry.server || entry;
      const meta = entry._meta?.["io.modelcontextprotocol.registry/official"] || {};
      const npm = npmPackage(s);
      if (!npm) continue;
      if (BLOCKED_PACKAGES.has(npm.identifier)) continue;
      rows.push({
        name: s.name,
        npm: npm.identifier,
        version: npm.version || s.version || null,
        repo: s.repository?.url || null,
        status: meta.status || "unknown",
        isLatest: meta.isLatest !== false
      });
    }
    cursor = data.metadata?.nextCursor || data.metadata?.next_cursor || null;
    pages += 1;
  } while (cursor && pages < maxPages);
  if (cursor) {
    throw new Error(`MAX_PAGES (${maxPages}) hit with more registry pages pending — refusing to write a truncated corpus`);
  }

  // Keep latest + active, dedupe by npm package name.
  const seen = new Set();
  const corpus = [];
  for (const r of rows) {
    if (r.status === "deleted") continue;
    if (seen.has(r.npm)) continue;
    seen.add(r.npm);
    corpus.push(r);
  }
  corpus.sort((a, b) => a.npm.localeCompare(b.npm));

  mkdirSync("data", { recursive: true });
  writeFileSync("data/corpus.json", JSON.stringify(corpus, null, 2) + "\n");
  console.log(`registry pages fetched: ${pages}`);
  console.log(`raw npm entries: ${rows.length}`);
  console.log(`unique npm-installable MCPs: ${corpus.length}`);
  console.log("sample:", corpus.slice(0, 8).map((c) => c.npm).join(", "));
}

main().catch((e) => {
  console.error("corpus build failed:", e.message);
  process.exit(1);
});
