# Monetization pilot — decision draft

Date prepared: 2026-08-12. Updated: 2026-08-16. Implementation status: the
neutral publication stays on the existing non-commercial Scoreboard host.
The commercial offer is **not** implemented under Delx Commerce. An earlier
idea that put the human offer on `commerce.delx.ai` is superseded. The entire
MCP Score Improvement vertical belongs only in `davidmosiah/mcp-leaderboard`
under `pay-service/`, served from `pay.leaderboard.delx.ai`. Production was
activated on 2026-08-16; the autonomous Grok authority boundary is
`docs/GROK_AUTONOMOUS_OPERATIONS.md`.

## One offer

**MCP Score Improvement PR — US$49 one-time founding price**

For a public GitHub repository that publishes an npm-installable MCP server:

1. verify its current leaderboard result with the same `mcp-scorecard` engine;
2. turn the failed and partial checks into a prioritized remediation plan;
3. open one focused pull request in the customer's public repository;
4. rerun the complete scorecard and report the verified before/after result;
5. let the neutral weekly leaderboard publish the new score only after the
   customer releases the changed package.

The purchase never changes rank, score, methodology, refresh order, or editorial
treatment. There is no guaranteed score, rank, security outcome, certification,
or publication date. This is agent-readiness remediation, not a security audit.

Pilot capacity: five public repositories. Proposed delivery target: seven
calendar days after the repository and target package are confirmed. Private
repositories, credentials, custom infrastructure, security certification and
production deployment are outside the pilot.

## Why this offer first

The intent is already present on every scorecard: the owner can see exactly
which checks hold the package back. Selling rank would damage the dataset's
credibility, and sponsored inventory needs traffic evidence that the site does
not yet have. A bounded code outcome can convert with low traffic and has no
dependency on fabricated reach.

Observed comparable public offers on 2026-08-12:

- MCP directory featured placements start around US$29/month and commonly run
  to US$99/month;
- a public MCP security-audit offer is priced at US$499 one-time.

The founding price deliberately sits below security-audit pricing because the
deliverable is narrower and makes no security or certification claim.

## Funnel

1. Publish the free MCP Scoreboard Weekly evidence under
   `leaderboard.delx.ai/issues/`. It contains no paid CTA and never sells
   ranking, score, editorial treatment or refresh priority.
2. Publish the separately governed offer at
   `pay.leaderboard.delx.ai` (`GET /api/offer`, OpenAPI, x402 discovery), with
   the same scope, price, capacity and exclusions. The old Commerce URL
   `commerce.delx.ai/services/mcp-score-improvement` is legacy only — do not
   implement a redirect and do not edit the other repository.
3. Accept a machine inquiry on the pay-service (`POST /api/inquiry`) containing
   only the public repository, npm package, scorecard URL and reply email.
   Never transmit repository credentials. Outreach and replies use the
   connected server-side AgentMail identity, never a personal mailbox.
4. Take payment only after the restricted Grok MCP verifies live public GitHub,
   npm, and Scoreboard identity and reserves 1 of 5 slots. A failed check cannot
   be overridden by the agent.
   Settlement is official x402 v2 (49 USDC on Base) on the pay-service, outside
   the ranking engine and outside `api.delx.ai`.
5. Measure qualified inquiries and verified external settlement on the
   pay-service. Do not claim impressions before the analytics baseline exists.

## Gates and verdict

- Vercel Web Analytics was enabled on 2026-08-12 and the generated HTML now
  includes its anonymous, cookie-free page-view script.
- The current Scoreboard Vercel account reports `billing.plan = hobby`, so the
  Scoreboard remains neutral and free. No paid CTA is rendered there.
- The commercial offer lives in this repository's isolated `pay-service/`
  (future host unit `mcp-scoreboard-pay` on `pay.leaderboard.delx.ai`). It
  does not require Vercel Pro on the Scoreboard, Delx Commerce, `api.delx.ai`,
  GitHub Actions, or compute on the maintainer's Mac. Deploy is a later
  operator-coordinated step, not this phase.
- Proposed measurement window: 14 days after activation.
- Pass: at least one external paid order, or two qualified external inquiries.
- Fail: zero qualified inquiries; remove the CTA and return to maintenance.
- Sponsorships, featured listings, subscriptions and bounties stay frozen until
  this first offer has a measured verdict. Advertising also requires audience
  evidence: at least 100 verified human views on a weekly edition or 25 email
  subscribers before inventory is offered.

Sources checked for the decision:

- Vercel Hobby plan: <https://vercel.com/docs/plans/hobby>
- Vercel Web Analytics privacy: <https://vercel.com/docs/analytics/privacy-policy>
- Claude Rules featured-listing pricing: <https://clauderules.net/submit/mcp>
- ServerHub featured-listing pricing: <https://www.serverhub.digital/>
- Regulatory Signals MCP audit: <https://www.regulatorysignals.com/mcp-audit>
