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
6. Run `npm run render`, `npm run weekly:generate`, and `npm run render:site`
   only after the scoring gates. The weekly generator compares the new working
   tree with `HEAD:data/leaderboard.json` before any commit. It reports score
   movement only when both runs record the same scorecard version and the npm
   package version is unchanged.
   The site render must regenerate the root, paginated rankings, one canonical
   scorecard page per scored server, the dated Scoreboard Weekly edition,
   issue index, latest JSON, RSS, sitemap, `llms.txt`, and `llms-full.txt`.
7. Publish generated outputs with one GitHub connector commit only after
   rechecking that remote `main` still equals the recorded SHA.
8. Verify `https://leaderboard.delx.ai/leaderboard.json` and the HTML site show
   the new timestamp and the same counts as the committed JSON.
9. Run `npm run notify:indexnow` only after the public deployment is verified.
   Require an HTTP 200 or 202 receipt for the complete canonical URL set.
10. If the edition has comparable changes, prepare at most five short outreach
    drafts for maintainers whose public package changed materially. Each draft
    must cite the exact public scorecard and evidence. Never send email, open a
    GitHub issue, or post publicly from this routine. Any later owner-approved
    send must use `support@delx.ai` or the server-side AgentMail identity, never
    a personal mailbox.
11. Close or fail the run with a sanitized Delx continuity capsule under stable
    agent id `wb-delx-grok`. Include goal, done, next, blockers and do-not; never
    include environment values, tokens, file contents or private contacts.

## Mandatory fail-closed gates

- `corpus.length === counts.total`;
- all npm names are unique;
- `counts.deferred === 0`;
- `counts.scored + counts.unreachable === counts.total`;
- no result error contains `ENOSPC`, `EMFILE`, `ENFILE`, or
  `no space left on device`;
- `data/leaderboard.json` and `site/leaderboard.json` are identical;
- `engineVersion` is present and equals the exact installed lockfile version;
- every result carries the corpus npm version used for that run;
- one canonical `data/editions/YYYY-MM-DD.json` exists for the new
  `generatedAt`; its Markdown renders from the same object;
- a baseline or methodology-change edition contains no improvement/decline
  claims; a comparable edition only compares unchanged npm versions;
- `site/issues/YYYY-MM-DD/edition.json` and `site/issues/latest.json` equal the
  canonical edition byte-for-byte after JSON parsing;
- the issue HTML, index and RSS are public and contain the readiness/correctness
  limitation; neutral Scoreboard pages contain no paid remediation CTA;
- the Registry Observatory design contract passes, including complete-index
  search, mobile viewport containment, visible no-JS content and reduced-motion
  behavior;
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
scorecard, a ranking page, the dated weekly edition, issue index, latest JSON,
RSS, `sitemap.xml`, `llms.txt`, `llms-full.txt`, and `leaderboard.json` over
public HTTPS.

IndexNow submission is a discovery notification, not proof that any search
engine indexed a URL. Never describe the batch receipt as an indexing result.

Any failed gate means no commit, no deployment, and a concise failure report.
The last known-good production board remains live.
