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
- `scripts/render-site.mjs` — generate the root, paginated rankings, one canonical HTML scorecard per scored server, sitemap and agent-readable indexes.
- `scripts/submit-indexnow.mjs` — notify participating search engines after a verified public deployment; its 200/202 receipt proves receipt, never indexing.
- `docs/GROK_CLOUD_REFRESH.md` — weekly Grok Cloud refresh and publish gates. The old GitHub Actions workflow is archived.
- `docs/MONETIZATION_PILOT.md` — bounded paid-offer draft and hosting/independence gates; selling stays off until every activation gate is explicit.
- `docs/WOULD_PAY_AGAIN_MODEL_ADAPTATION.md` — evidence behind the Scoreboard Weekly + remediation flywheel, including what was deliberately not copied.
- `docs/DESIGN_SYSTEM.md` — Registry Observatory visual contract, responsive/accessibility gates and generated-versus-hand-owned boundaries.
- `docs/PAY_SERVICE.md` — isolated MCP Score Improvement contract on `pay.leaderboard.delx.ai`. The entire vertical (code, x402, state, receipts, metrics) lives in this repo under `pay-service/`.
- `pay-service/` — isolated Node service with its own `package.json` and lockfile. Never loaded by the root batch scorer. Future host unit name: `mcp-scoreboard-pay`.
- `data/editions/` — canonical, deterministic MCP Scoreboard Weekly evidence. `render-site.mjs` owns the public issue HTML, JSON, RSS and index.
- `templates/index.html` — hand-owned source for the public home page. `site/index.html` is generated from it.
- `site/assets/site.css`, `site/assets/directory.css`, and `site/assets/site.js` — hand-owned shared presentation and progressive enhancement. `design/og-card.html` is the reproducible source for `site/assets/og-card.png`.

## Commands

- `npm ci`
- `npm run all` (corpus → run → render)
- Bounded: `npm run run -- --limit 30` or `--targets a,b`
- Pay-service (isolated): `npm ci --prefix pay-service` and `npm test --prefix pay-service`. Root `npm test` orchestrates those tests plus the scorer-isolation boundary. The score VM must never receive `PAY_SERVICE_*` env.

## Rules

- Never hand-edit `LEADERBOARD.md` or `data/*.json` — they are generated. Change the scripts instead.
- Never hand-edit `site/index.html`, `site/servers/`, `site/rankings/`, `site/sitemap.xml`, `site/llms.txt`, or `site/llms-full.txt` — `render-site.mjs` owns them. Edit `templates/index.html` or the render code instead.
- Never hand-edit `site/issues/` or `data/editions/*` — generate an edition with `npm run weekly:generate`, then render the site.
- Keep the run resilient: every target is isolated with a timeout; one bad server must never stall or crash the batch. New failure modes resolve to `unreachable`, never a fake low score.
- Runner infrastructure failures (`ENOSPC`, `EMFILE`, `ENFILE`) and deferred targets are fatal. Preserve the last known-good board instead of publishing a degraded run.
- Keep it fair: auth-gated servers are `unreachable`, not low-scored. Don't penalize what can't be probed.
- Scoring logic lives in mcp-scorecard, not here. To change what's measured, change the engine.
- Weekly directional claims require the same recorded scorecard version and the same npm package version in both runs. Otherwise publish a baseline/methodology-change edition and suppress improvement/decline claims.
- Keep the Scoreboard host neutral: `leaderboard.delx.ai` has no paid CTA. The human offer is **not** on `commerce.delx.ai` (legacy URL only; do not redirect and do not edit Delx Commerce). Payment lives only at `pay.leaderboard.delx.ai`.
- Do not load `pay-service/` runtime credentials or dependencies into corpus/score/render scripts. Do not send catalog, telemetry, or revenue to `api.delx.ai` or Delx Commerce.
- Do not hand-edit generated board outputs while working on pay-service. Change `pay-service/` or the isolation tests instead.
