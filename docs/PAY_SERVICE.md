# MCP Score Improvement — isolated pay-service

Owner-canonical location: **`davidmosiah/mcp-leaderboard` only**.
The entire MCP Score Improvement vertical — code, contract, x402, state,
receipts, and metrics — lives in this repository under `pay-service/`.

This document is the executable plan and the operator contract. The repository
implementation phase is complete. Production activation was authorized by the
owner on 2026-08-16 and uses the versioned production unit, route, deployment
script, isolated state/backup, and a dedicated CDP API key. Activation does not
authorize self-buy, customer outreach, maintainer issues, refunds, or delivery
without a real approved inquiry.

## Separation that must not be mixed

| Surface | Host | Role |
| --- | --- | --- |
| Neutral Scoreboard | `https://leaderboard.delx.ai` | Static evidence. No paid CTA. |
| Pay-service | `https://pay.leaderboard.delx.ai` | Isolated Node service. Inquiry, human fit, reservation, x402, receipts. |
| Legacy Commerce URL | `https://commerce.delx.ai/services/mcp-score-improvement` | **Superseded.** Cite only as a later migration leftover. Do not implement a redirect. Do not edit `delx-agent-commerce` or `api.delx.ai`. |

Do **not** send files, routes, catalog, telemetry, or revenue to Delx Commerce.
Do **not** add `commerce.delx.ai` or `api.delx.ai` as a payment host.
Do **not** load pay-service runtime credentials or dependencies into the root
batch scorer. The weekly Grok Cloud score VM must never receive pay-service env.

Production runs as the isolated unit/state/backup `mcp-scoreboard-pay` on the
shared host. The active contract is
`pay-service/manifests/mcp-scoreboard-pay.production.json`; the older candidate
manifest remains historical evidence and is not deployable.

## Offer (single service)

**MCP Score Improvement PR — 49 USDC on Base, capacity 5.**

Business flow (document only; do not execute against customers):

1. Free inquiry (`public_repository_url`, `npm_package`, `scoreboard_url`, `reply_email`).
2. Fit recommendation (human).
3. David's human approval.
4. Reserve 1 of 5 **founding seats** (lifetime capacity, not concurrency).
5. Official x402 v2 payment, exactly 49 USDC on Base.
6. Public order + receipt with verifiable settlement.
7. One focused draft PR on the matching public customer repo.
8. Rerun within 7 calendar days.

Payment never buys rank, score, editorial treatment, security outcome, merge,
deploy, or publication. The board only observes change after the maintainer
publishes the package.

Out of scope: private repos, credentials, custom infrastructure, security
certification, production deployment, guaranteed score/rank, automatic refund.

## Executable TDD sequence

Work only on a branch off the validated `main` SHA. Do not rebase onto a
surprise `origin/main` move.

1. Re-fetch `origin/main`. Stop if HEAD moved.
2. Write this contract and the isolation rules in `AGENTS.md` plus the
   canonical docs. Cite the old Commerce URL only as legacy.
3. Create `pay-service/` with its own `package.json` and lockfile.
4. Observe a failing test before each implementation slice:
   - health / offer / OpenAPI / discovery
   - inquiry validation, body/rate limits, idempotency, privacy
   - fit approval, capacity, reservation expiry
   - unpaid official 402 vs missing/unapproved/expired (no 402)
   - forged `PAYMENT-SIGNATURE` does not create an order
   - verified settlement creates one order; retry is idempotent
   - simulated paid header never marks paid
   - admin auth (timing-safe), refund receipt, state machine
   - root scorer isolation + host-boundary tests
5. Implement only enough to pass the observed failure.
6. Run gates. Keep the PR **draft**. Never merge, never deploy.

## HTTP contract

Public host: `https://pay.leaderboard.delx.ai`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/` | public | Service identity. Points at offer, OpenAPI, x402 discovery. |
| `GET` | `/healthz` | public | Process liveness. |
| `GET` | `/readyz` | public | Store writable + required runtime config present. Never echo secrets. |
| `GET` | `/api/offer` | public | Machine catalog of the single service. |
| `GET` | `/openapi.json` | public | Canonical OpenAPI 3.1. |
| `GET` | `/.well-known/x402` | public | Host-local x402 v2 discovery document. |
| `POST` | `/api/inquiry` | public | Strict validation. Idempotent. Never accepts secrets or private repos. |
| `GET` | `/api/inquiry/:code` | public | Sanitized state. No email/IP. |
| `POST` | `/api/fit/approve` | Bearer | Human fit required. Creates an unguessable reservation only after approval. |
| `GET` | `/api/reservation/:code` | public | Sanitized state. `pay_route` only for an approved, unexpired reservation. |
| `POST` | `/api/pay/:reservation` | x402 v2 | Official receive path. 402 only for an approved live reservation that still needs payment. |
| `GET` | `/api/order/:id` | public | Sanitized order + verifiable settlement. No private contact. |
| `GET` | `/api/receipt/:id` | public | Sanitized receipt. Refunds are a separate receipt. |
| `GET` | `/api/admin/inquiries` | Bearer | Pending inquiries. Email visible only here. Never log it. |
| `GET` | `/api/admin/orders` | Bearer | Orders without inventing a production token. |
| `GET` | `/api/admin/metrics` | Bearer | Counts only. No PII. |
| `POST` | `/api/admin/delivery/start` | Bearer | `paid` → `delivery_in_progress`. |
| `POST` | `/api/admin/delivery/complete` | Bearer | → `delivered`. Draft PR URL must match the purchased `owner/repo`. Live GitHub verification is a later operational gate, not this phase. |
| `POST` | `/api/admin/cancel` | Bearer | Explicit `cancelled` only before payment. Validates conflicts before any mutation. Pre-payment cancel frees the seat. |
| `POST` | `/api/admin/refund` | Bearer | Without on-chain proof: non-terminal `refund_pending` + `refund_request` receipt. With coherent transfer proof: terminal `refunded` + `refund` receipt. The service never broadcasts a chain refund. |
| `POST` | `/api/admin/reconcile` | Bearer | Auditable resolution of `payment_reconciliation_required`. `decision: paid` requires a transaction reference; `decision: release` frees the seat. Never retries settle. |

### Inquiry body

```json
{
  "public_repository_url": "https://github.com/owner/repo",
  "npm_package": "@scope/mcp-server",
  "scoreboard_url": "https://leaderboard.delx.ai/servers/%40scope/mcp-server/",
  "reply_email": "maintainer@example.com"
}
```

Rejected: extra properties; fields named like secrets; credential-bearing URLs;
non-https GitHub URLs; private-repo indicators; non-Scoreboard scorecard URLs;
bodies over 8 KiB; more than 10 inquiries / hashed-IP / hour.

Idempotency: `Idempotency-Key` header bound to a canonical SHA-256 of
`public_repository_url`, `npm_package`, `scoreboard_url`, and `reply_email`.
Same key + same body replays the original public response. Same key + different
body returns `409 idempotency_conflict`.

Rate limit uses the socket `remoteAddress` by default. `X-Forwarded-For` is
trusted only when `PAY_SERVICE_TRUSTED_PROXY=1`. The TLS edge that terminates
HTTPS must overwrite `X-Forwarded-For`; this process must not trust an
arbitrary client-supplied header.

### State machine

```
inquiry_received
        │
        ▼
payment_pending   ← reservation created only after human approve
        │
        ▼
      paid        ← only after official facilitator verify + settle
        │
        ▼
delivery_in_progress
        │
        ▼
    delivered

cancelled is an explicit pre-payment terminal.
refund_pending is a non-terminal refund request (no transfer proof yet).
refunded is terminal only after operator-supplied transfer proof.
reservation_expired is a non-seat state after TTL; a new approval may mint a
new reservation if capacity remains.
```

Founding capacity is **5 total seats**, not concurrency 5. A seat is consumed by
a `payment_pending` reservation or by **any** order (`paid`,
`delivery_in_progress`, `delivered`, `refund_pending`, `refunded`). Delivery
does **not** free the seat. Pre-payment cancel or expiry may free it. Inquiries
do **not** hold a seat.

Default reservation TTL: **24 hours** (`PAY_SERVICE_RESERVATION_TTL_SECONDS`).
Assumption: a short hold prevents griefing without an anonymous inventory lock.

### x402 (do not invent protocol)

Receive path is the official TypeScript v2 SDK, not hand-rolled headers:

- Packages and exact versions recorded in `pay-service/package-lock.json`:
  `@x402/core@2.22.0`, `@x402/evm@2.22.0`, `@x402/express@2.22.0`,
  `@x402/extensions@2.22.0`,   `@x402/svm@2.22.0` (CDP x402 barrel peer only;
  this service settles USDC on Base, not Solana), `@coinbase/cdp-sdk@1.55.0`,
  `express@5.2.1`.
  `@coinbase/cdp-sdk@1.55.0` still declares `axios@1.16.0`, which npm audit
  flags. This package pins an explicit npm override to **axios@1.19.0**
  (documented, not `audit fix --force`) so production verify/settle auth stays
  on CDP 1.55.0 without the 1.16.0 advisories.
- Network: `eip155:8453` (Base mainnet)
- Asset: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals)
- Amount: `49000000` atomic (`price: "$49.00"` in official route config)
- Scheme: `exact`
- Client header: `PAYMENT-SIGNATURE` (official v2; SDK also reads legacy `X-PAYMENT`)
- Server challenge: HTTP 402 + `PAYMENT-REQUIRED`
- Settlement echo: `PAYMENT-RESPONSE`
- Discovery: bazaar extension on the pay route + `GET /.well-known/x402`

Official references used while writing this phase:

- <https://docs.x402.org/getting-started/quickstart-for-sellers>
- <https://docs.x402.org/guides/migration-v1-to-v2>
- <https://docs.x402.org/extensions/bazaar>
- <https://github.com/x402-foundation/x402> (`@x402/express` README)

A missing, unapproved, or expired reservation **must not** return 402.
A forged `PAYMENT-SIGNATURE` must fail official verify and **must not** create
an order. A simulated / QA header such as `X-Simulate-Paid` is ignored.
`paid` is recorded only after facilitator `verify` + `settle` both succeed
with a non-empty transaction id.

Production receive path keeps the official `@x402/express` resource server and
uses `createCdpFacilitatorClient()` from `@coinbase/cdp-sdk/x402` so CDP
`verify`/`settle` carry `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`. Do not wire
an unauthenticated `HTTPFacilitatorClient({ url })` for mainnet. Tests inject a
`FacilitatorClient`; production wiring reads the two CDP secrets from env.
`PAY_SERVICE_PAY_TO` remains a public address only — no wallet secret.

Two concurrent paid POSTs against the same reservation serialize on a durable
per-reservation claim before `verify`+`settle`. Claims are **not** released by
TTL. Unpaid 402 challenges do not take a claim.

A timeout or exception after settlement has started is treated as
`payment_reconciliation_required` (`settlement_unknown`). Official FAQ: a
timed-out settle may still have landed on-chain and must be reconciled by
transaction reference, not retried
(<https://docs.cdp.coinbase.com/x402/support/faq#going-to-production>).
A second `PAYMENT-SIGNATURE` must not call settle. Only an explicitly final
rejected verify or an explicitly final settle failure (`invalid_signature`,
`invalid_scheme`, `verification_failed`, `unsupported_payload_type`,
`kyt_risk_detected`, and no transaction) may return the reservation to
`payment_pending`.

On store load, any `payment_pending` reservation with a `pay_claim` and no
order is fail-closed to `payment_reconciliation_required` and an auditable
`startup_orphan_claim` event is persisted **before** the process serves
traffic. Claims are never auto-released. If `createOrder` persistence fails
after settle, the handler tries to mark reconciliation; if that persist also
fails, the process exits so the next startup can normalize the orphan claim.

Admin `POST /api/admin/reconcile` (`decision: paid|release`) is the auditable
path. `paid` requires a contract-valid settlement before creating an order:
transaction `0x`+64 hex, network `eip155:8453`, amount `49000000`, asset USDC
on Base, `pay_to` equal to configured `PAY_SERVICE_PAY_TO`, and a 0x payer
address. Invalid settlement returns 400 and must not create an order.

This phase never calls a live facilitator for a real transfer.

## Isolation

- `pay-service/package.json` + `pay-service/package-lock.json` are the only
  place `@x402/*` and the HTTP runtime are declared.
- Root `package.json` stays scorer-only (`mcp-scorecard`).
- Root `npm test` orchestrates `npm test --prefix pay-service` plus
  `scripts/pay-service-boundary-test.mjs`.
- Scorer scripts (`build-corpus`, `run-leaderboard`, `render`, `render-site`,
  weekly generator) must not import `pay-service/` or read `PAY_SERVICE_*`.
- Boundary tests fail if:
  - `leaderboard.delx.ai` templates/renderers gain a paid CTA
  - `api.delx.ai` or `commerce.delx.ai` appears as a payment host
  - Delx Commerce files are required to boot or test pay-service

## Store, privacy, recovery

Durable single-writer JSON store under `pay-service/var/` (gitignored):

- `var/private/state.json` — source of truth, includes reply email and hashed IP
- `var/public/receipts.json` — public orders/receipts only (no email/IP)
- `var/private/STATE.lock` — exclusive inter-process lock (`O_CREAT|O_EXCL`).
  A second instance fails closed at startup. `store.close()` releases the lock.
  Persist does **not** rewrite the lock file. A leftover lock whose PID is dead
  may be recovered; a live PID is refused.
- writes: temp file + `fsync` + atomic rename

Startup: missing `private/state.json` (`ENOENT`) initializes empty state.
Corrupted JSON, permission errors, or other IO failures **fail closed** and
must not rewrite the file.

Recovery: restart reloads `private/state.json`. Ignore leftover `*.tmp`.
Restore from the last intact private snapshot; rebuild the public projection.
Production state maps `PAY_SERVICE_DATA_DIR` to
`/var/lib/mcp-scoreboard-pay`. Backup freezes the single writer and captures
the private state, public projection, and root-owned environment as the
encrypted `mcp-scoreboard-pay-state` set. A private off-site roundtrip and
restore receipt are required before the host audit is green.

Logs may include inquiry/reservation/order codes and states. Logs must not
include email, IP, Authorization, or payment payloads.

Unguessable codes: 32 cryptographically random bytes, base64url.

## Runtime configuration

No production secret is saved in this repository. The CDP PEM is stored as
`/etc/mcp-scoreboard-pay/cdp-api-key.pem` and delivered through systemd
`LoadCredential`; it is not flattened into the shared environment file.
Coinbase downloads ECDSA keys as SEC1 (`BEGIN EC PRIVATE KEY`), while the pinned
SDK imports PKCS8. Provisioning must convert it with `openssl pkcs8 -topk8
-nocrypt` and the deploy gate refuses any other PEM header.

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `PAY_SERVICE_PAY_TO` | no (public address) | x402 `payTo` on Base. Never a wallet secret. |
| `PAY_SERVICE_ADMIN_TOKEN` | yes | Bearer for fit/admin. Generate at deploy. Never commit. |
| `CDP_API_KEY_ID` | yes | CDP JWT key id for authenticated facilitator `verify`/`settle`. Never commit. |
| `CDP_API_KEY_SECRET` | yes | CDP JWT key secret. Never commit. Never echo from `/readyz`. |
| `PAY_SERVICE_TRUSTED_PROXY` | no | Set to `1` only behind an edge that overwrites `X-Forwarded-For`. Default: ignore that header. |
| `PAY_SERVICE_PUBLIC_BASE_URL` | no | Defaults to `https://pay.leaderboard.delx.ai` |
| `PAY_SERVICE_DATA_DIR` | no | Defaults to `pay-service/var` |
| `PAY_SERVICE_RESERVATION_TTL_SECONDS` | no | Defaults to `86400` |
| `PAY_SERVICE_PORT` | no | Defaults to `8787` |

Production pins `PAY_SERVICE_PORT=8797`, `PAY_SERVICE_TRUSTED_PROXY=1`, and
`PAY_SERVICE_DATA_DIR=/var/lib/mcp-scoreboard-pay`. `PAY_SERVICE_PAY_TO` reuses
the existing public Delx Base receiving address. That does not share a private
key: this service has its own CDP key, admin token, process, state, receipts,
metrics, and backup.

`/readyz` fails closed if the admin token is missing or shorter than 32 bytes,
if `PAY_SERVICE_PAY_TO` is not a 0x-prefixed 20-byte address, or if either CDP
API secret env is missing. Do not print these values.

## Commands

```bash
# root — scorer isolation remains
npm ci
npm test

# pay-service only
npm ci --prefix pay-service
npm test --prefix pay-service

# production deploy: exact committed release only; requires a serverctl lease
pay-service/ops/deploy-production.sh <full-commit-sha>
```

Do not run `npm run all`, do not rewrite `data/*`, `LEADERBOARD.md`, or
`site/` generated outputs while implementing this vertical.

## Assumptions (safest isolation-preserving defaults)

1. Live GitHub “is this repo public?” probing is **off** in this phase. The
   service rejects non-public URL shapes, credential-bearing URLs, and
   private-repo indicators in the body. A network probe can be added at
   deploy time without changing the contract.
2. Reservation TTL is 24 hours unless overridden.
3. Founding capacity is 5 **total** seats. Delivery keeps the seat. Pre-payment
   cancel/expiry may free it. Inquiries do not hold a seat.
4. A refund request without transfer proof is `refund_pending` +
   `refund_request`. Terminal `refunded` requires operator-supplied proof
   (transaction, network, amount, merchant payer = `PAY_TO`, recipient = original
   settlement payer). The service does not broadcast a chain refund.
5. Draft `draft_pr_url` owner/repo must match `order.public_repository_url`.
   Confirming the PR exists and is a draft on GitHub is an operational gate
   before calling complete, not an automated check in this phase.
6. Official `@x402/*` v2.22.0 packages plus `@coinbase/cdp-sdk@1.55.0` are the
   receive path. Legacy `x402` / `x402-express` v1 packages are not used.
7. The weekly Scoreboard publisher stays on Vercel Hobby and remains CTA-free.
8. `support@delx.ai` remains the human reply identity for later outreach.
   This phase does not send mail.
