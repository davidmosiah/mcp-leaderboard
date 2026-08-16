# MCP Score Improvement — isolated pay-service

Owner-canonical location: **`davidmosiah/mcp-leaderboard` only**.
The entire MCP Score Improvement vertical — code, contract, x402, state,
receipts, and metrics — lives in this repository under `pay-service/`.

This document is the executable plan and the operator contract. Follow it in
order. This phase is **code, tests, runbook, and versioned manifests in the
repo**. Do not deploy, take real payment, self-buy, send email, open a
maintainer GitHub issue, merge to `main`, or publish the board from this work.

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

Future deploy (later, not this phase): an isolated unit/state/backup named
`mcp-scoreboard-pay` on the shared host, coordinated with the Delx host
operator. Candidate manifest: `pay-service/manifests/mcp-scoreboard-pay.candidate.json`.

## Offer (single service)

**MCP Score Improvement PR — 49 USDC on Base, capacity 5.**

Business flow (document only; do not execute against customers):

1. Free inquiry (`public_repository_url`, `npm_package`, `scoreboard_url`, `reply_email`).
2. Fit recommendation (human).
3. David's human approval.
4. Reserve 1 of 5 slots (no anonymous hold).
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
| `POST` | `/api/admin/delivery/complete` | Bearer | → `delivered`. Optional public draft PR URL. |
| `POST` | `/api/admin/cancel` | Bearer | Explicit `cancelled`. Frees the slot. |
| `POST` | `/api/admin/refund` | Bearer | Manual refund ledger + separate receipt. No automatic on-chain refund. |

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

Idempotency: `Idempotency-Key` header. Replay the original public response.

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

cancelled and refunded are explicit terminals.
reservation_expired is a non-slot state after TTL; a new approval may mint a
new reservation if capacity remains.
```

Slot-holding states (capacity 5): `payment_pending`, `paid`, `delivery_in_progress`.
Inquiries do **not** hold a slot. Expired reservations free the slot.

Default reservation TTL: **24 hours** (`PAY_SERVICE_RESERVATION_TTL_SECONDS`).
Assumption: a short hold prevents griefing without an anonymous inventory lock.

### x402 (do not invent protocol)

Receive path is the official TypeScript v2 SDK, not hand-rolled headers:

- Packages and exact versions recorded in `pay-service/package-lock.json`:
  `@x402/core@2.10.0`, `@x402/evm@2.10.0`, `@x402/express@2.10.0`,
  `@x402/extensions@2.10.0`, `express@5.2.1`
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

This phase never calls a live facilitator for a real transfer. Tests inject a
`FacilitatorClient`. Production facilitator URL is configuration only.

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
- `var/private/STATE.lock` — exclusive lock
- writes: temp file + `fsync` + atomic rename

Recovery: restart reloads `private/state.json`. Ignore leftover `*.tmp`.
Restore from the last intact private snapshot; rebuild the public projection.
Backup (later deploy): copy `var/private/` as the `mcp-scoreboard-pay` backup
set. This phase does not configure host backups.

Logs may include inquiry/reservation/order codes and states. Logs must not
include email, IP, Authorization, or payment payloads.

Unguessable codes: 32 cryptographically random bytes, base64url.

## Runtime configuration

No production secret is saved in this repository.

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `PAY_SERVICE_PAY_TO` | no (public address) | x402 `payTo` on Base |
| `PAY_SERVICE_ADMIN_TOKEN` | yes | Bearer for fit/admin. Generate at deploy. Never commit. |
| `PAY_SERVICE_FACILITATOR_URL` | no | Official facilitator base URL |
| `PAY_SERVICE_PUBLIC_BASE_URL` | no | Defaults to `https://pay.leaderboard.delx.ai` |
| `PAY_SERVICE_DATA_DIR` | no | Defaults to `pay-service/var` |
| `PAY_SERVICE_RESERVATION_TTL_SECONDS` | no | Defaults to `86400` |
| `PAY_SERVICE_PORT` | no | Defaults to `8787` |

`/readyz` fails closed if the admin token is missing or shorter than 32 bytes,
or if `PAY_SERVICE_PAY_TO` is not a 0x-prefixed 20-byte address.
Do not print these values.

## Commands

```bash
# root — scorer isolation remains
npm ci
npm test

# pay-service only
npm ci --prefix pay-service
npm test --prefix pay-service
```

Do not run `npm run all`, do not rewrite `data/*`, `LEADERBOARD.md`, or
`site/` generated outputs while implementing this vertical.

## Assumptions (safest isolation-preserving defaults)

1. Live GitHub “is this repo public?” probing is **off** in this phase. The
   service rejects non-public URL shapes, credential-bearing URLs, and
   private-repo indicators in the body. A network probe can be added at
   deploy time without changing the contract.
2. Reservation TTL is 24 hours unless overridden.
3. Capacity counts in-flight approved work, not raw inquiries.
4. Refund writes a **ledger receipt** only. It does not broadcast an on-chain
   refund and the API must not promise one.
5. Official `@x402/*` v2 packages are the receive path. Legacy `x402` /
   `x402-express` v1 packages are not used.
6. The weekly Scoreboard publisher stays on Vercel Hobby and remains CTA-free.
7. `support@delx.ai` remains the human reply identity for later outreach.
   This phase does not send mail.
