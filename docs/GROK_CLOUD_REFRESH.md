# Grok Cloud refresh

The production leaderboard refresh runs in a fresh Grok Cloud VM. It replaces
the archived GitHub Actions cron for this repository and must not consume the
maintainer's Mac or the shared Hetzner host.

## Schedule and executor

- Weekly, Monday at 06:00 America/Fortaleza.
- Agent: `MCP Scoreboard Publisher`.
- Cloud task model: `Cursor Grok 4.6 High Fast` (never Auto/default).
- Repository: `davidmosiah/mcp-leaderboard`, default branch only.
- GitHub access is connector-only. Never expose a token to the shell, npm,
  subprocess environment, files, logs, or artifacts.

## Execution

1. Start from a fresh ephemeral VM and record the remote `main` SHA.
2. Unset `GITHUB_TOKEN`, `GH_TOKEN`, and `GIT_ASKPASS` before every npm command.
3. Install with `npm ci --ignore-scripts`; require Node 22+ and the exact
   `mcp-scorecard` version in the lockfile (0.5.10 or newer).
4. Build the entire registry corpus. Cursor pagination must terminate normally;
   truncation, repeated cursors, or a pending cursor is fatal.
5. Score every corpus target. Treat packages as hostile, preserve per-target
   timeouts, and never classify runner failures as server quality failures.
6. Run `npm run render` and `npm run render:site` only after the scoring gates.
   The site render must regenerate the root, paginated rankings, one canonical
   scorecard page per scored server, sitemap, `llms.txt`, and `llms-full.txt`.
7. Publish generated outputs with one GitHub connector commit only after
   rechecking that remote `main` still equals the recorded SHA.
8. Verify `https://leaderboard.delx.ai/leaderboard.json` and the HTML site show
   the new timestamp and the same counts as the committed JSON.

## Mandatory fail-closed gates

- `corpus.length === counts.total`;
- all npm names are unique;
- `counts.deferred === 0`;
- `counts.scored + counts.unreachable === counts.total`;
- no result error contains `ENOSPC`, `EMFILE`, `ENFILE`, or
  `no space left on device`;
- `data/leaderboard.json` and `site/leaderboard.json` are identical;
- `site/servers/` contains exactly one `index.html` per scored server;
- the sitemap contains every scorecard and ranking page with the run's real
  `lastmod`, and no JSON or text utility URLs;
- root and detail JSON-LD parse and reflect the current `generatedAt`, counts,
  ranks, scores and visible check-level evidence;
- `llms.txt` and `llms-full.txt` reflect the same current dataset and link to
  canonical scorecard pages;
- diff contains only approved generated outputs and deliberate dependency or
  runbook updates;
- secret scan is clean.

After deployment, verify the root, a scoped-package scorecard, an unscoped
scorecard, a ranking page, `sitemap.xml`, `llms.txt`, `llms-full.txt`, and
`leaderboard.json` over public HTTPS.

Any failed gate means no commit, no deployment, and a concise failure report.
The last known-good production board remains live.
