# Agent Development Notes

## Scope

`mcp-leaderboard` publishes a public agent-readiness ranking of the MCP
ecosystem. It is data + automation, not a library (not published to npm). The
scoring engine is [mcp-scorecard](https://github.com/davidmosiah/mcp-scorecard);
this repo only builds the corpus, batch-runs the engine, and renders the board.

## Layout

- `scripts/build-corpus.mjs` — pull npm-installable servers from the official MCP registry → `data/corpus.json`.
- `scripts/run-leaderboard.mjs` — boot + score each target with mcp-scorecard (isolated child process, hard timeout) → `data/leaderboard.json`.
- `scripts/render.mjs` — `data/leaderboard.json` → `LEADERBOARD.md`.
- `docs/GROK_CLOUD_REFRESH.md` — weekly Grok Cloud refresh and publish gates. The old GitHub Actions workflow is archived.

## Commands

- `npm ci`
- `npm run all` (corpus → run → render)
- Bounded: `npm run run -- --limit 30` or `--targets a,b`

## Rules

- Never hand-edit `LEADERBOARD.md` or `data/*.json` — they are generated. Change the scripts instead.
- Keep the run resilient: every target is isolated with a timeout; one bad server must never stall or crash the batch. New failure modes resolve to `unreachable`, never a fake low score.
- Runner infrastructure failures (`ENOSPC`, `EMFILE`, `ENFILE`) and deferred targets are fatal. Preserve the last known-good board instead of publishing a degraded run.
- Keep it fair: auth-gated servers are `unreachable`, not low-scored. Don't penalize what can't be probed.
- Scoring logic lives in mcp-scorecard, not here. To change what's measured, change the engine.
