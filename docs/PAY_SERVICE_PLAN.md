# Pay-service implementation checklist

Follow `docs/PAY_SERVICE.md`. Tick by making the named test fail, then pass.

1. [x] `GET /`, `/healthz`, `/readyz`, `/api/offer`, `/openapi.json`, `/.well-known/x402`
2. [x] `POST /api/inquiry` validation, 8 KiB limit, rate limit, idempotency, no secrets
3. [x] `GET /api/inquiry/:code` sanitized (no email/IP)
4. [x] `POST /api/fit/approve` Bearer timing-safe; reservation only after approve
5. [x] Capacity 5; expiry frees the slot; no anonymous hold
6. [x] Missing/unapproved/expired pay route is **not** 402
7. [x] Approved unpaid reservation returns official x402 v2 402 (49 USDC Base)
8. [x] Forged `PAYMENT-SIGNATURE` does not create an order
9. [x] `X-Simulate-Paid` never marks paid
10. [x] Verified settle creates one order; retry/idempotency does not duplicate
11. [x] Public order/receipt hide contact; refund is a separate receipt
12. [x] State machine + admin delivery/cancel/refund
13. [x] Root scorer isolation + host-boundary tests
14. [x] Secret scan clean, `git diff --check` clean, full `npm test`
15. [x] Draft PR only — no merge, deploy, payment, email, or maintainer issue
16. [x] Owner explicitly authorized production activation on 2026-08-16
17. [x] Version isolated systemd, Caddy, immutable deploy, and backup contracts
18. [x] Provision dedicated CDP/admin credentials and reuse only the public Base receive address
19. [x] Deploy under `serverctl` lease and `gatewayctl`; verify public live state
20. [x] Complete encrypted off-site roundtrip/restore receipt and full host audits
