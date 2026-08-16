# MCP Scoreboard pay-service production receipt — 2026-08-16

## Result

The isolated MCP Scoreboard pay-service is live at
`https://pay.leaderboard.delx.ai` from immutable release
`35d27c774c754fa9b5846615da80bb2ec7f27845`.

This receipt proves deployment and operational readiness. It does **not** prove
an external inquiry, payment, delivery, revenue, ranking improvement, merge,
deploy, or publication.

## Product boundary

- Repository, process, systemd unit, state, metrics, admin token, CDP API key,
  backup, route, and receipts are dedicated to MCP Scoreboard.
- Only the public Base receive address is shared with the owner's other x402
  services.
- The live catalog is one `MCP Score Improvement PR` for 49 USDC on Base
  (`eip155:8453`), with capacity 5.
- Payment never buys score, rank, editorial treatment, security outcome, merge,
  deploy, or publication.

## Live evidence

- Authoritative and recursive DNS both resolved
  `pay.leaderboard.delx.ai` to `77.42.20.140`; TTL is 600 seconds.
- `GET /healthz` returned HTTP 200 with `{"status":"ok"}`.
- `GET /readyz` returned HTTP 200 with `{"status":"ready"}`.
- `GET /.well-known/x402` returned x402 v2, exact scheme, USDC on Base,
  atomic amount `49000000`, and the configured public receive address.
- `GET /api/offer` returned price `49 USDC`, capacity `5`, used `0`, and the
  isolated pay route.
- `GET /openapi.json` returned HTTP 200 and the Scoreboard-only API contract.
- `POST /api/pay/not-a-real-reservation` returned HTTP 404, not a 402 challenge.
- `GET /api/admin/metrics` without a token returned HTTP 401.
- The systemd unit was `active/running`, `ExecMainStatus=0`; loopback
  `GET http://127.0.0.1:8797/readyz` returned ready.

## Shared-host safety

- `gatewayctl deploy mcp-scoreboard-pay ...` completed through the global
  transactional controller; the full route audit returned 13 expected probes.
- The pre-deploy gateway baseline was green for every existing route.
- The post-deploy full gateway audit was `status=ok`: all existing Delx,
  Reacher, Build Week, Nourish, Ani Ritmo, Mediagen and Scoreboard probes passed;
  Caddy's admin API remained on the permissioned Unix socket.
- The post-deploy `serverctl audit --scope full --json` was `healthy`, with zero
  findings across 22 services, 15 probes, 12 backups, 12 system timers,
  10 root-user timers, and 20 Hermes jobs.
- The gateway manifest, Scoreboard route, and gateway controller are immutable
  on the host after deployment.

## Backup and restore

- Off-site receipt: private release `server-20260816T125900Z`, encrypted and
  roundtrip verified at `2026-08-16T13:17:41Z`.
- Restore receipt: snapshot consistency `ok`, remote roundtrip `ok`, profile
  `full-restore-v4`.
- The backup contains the isolated state and credential material required by
  the service contract; no secret is recorded in this repository.

## Economic state at activation

No production inquiry, reservation, order, payment, self-buy, delivery, or
revenue was created during activation. Live capacity remained `used: 0`.

## Grok Bot autonomous connector activation

- Grok Bot connector `mcp-scoreboard-ops` completed authorization-code OAuth
  with S256 PKCE and a one-time owner approval entered directly on
  `pay.leaderboard.delx.ai`. The OAuth client secret was not stored in the bot.
- The server recorded `oauth_token_issued` with scope `scoreboard:operate` and
  `owner_approved: true`; no token, code, verifier, nonce, or secret was logged.
- The connected bot listed exactly five tools. A read-only smoke called
  `scoreboard_get_status` and `scoreboard_list_work`: capacity `0/5`, zero
  inquiries, zero orders, zero external revenue, and no mutation.
- The Grok routine is active hourly, pinned to the production release above,
  and instructed to use only `mcp-scoreboard-ops`. Legacy connector cards are
  ignored and grant no additional capability.
- Cross-role checks remained closed: the agent Bearer received HTTP 401 from
  the admin API, the admin Bearer received HTTP 401 from `/mcp`, and the agent
  Bearer listed exactly five MCP tools.
- The final gateway audit was `status=ok`; every existing Delx, Reacher, Build
  Week, Nourish, Ani Ritmo, Mediagen and Scoreboard probe passed. The final
  `serverctl` audit covered 22 services and 15 probes with one residual warning:
  disk usage `81.2%`. No retention candidate was deleted.
