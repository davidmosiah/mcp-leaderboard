# Monetization pilot — decision draft

Date prepared: 2026-08-12. Public selling is **not active** until the hosting
commercial-use gate below is resolved.

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

## Funnel after the hosting gate

1. Add a clearly separate `Improve this MCP` CTA to each generated scorecard.
2. Link to one `/improve` landing page that repeats the independence guarantee,
   scope, price, capacity and exclusions.
3. Use `support@delx.ai` for a prefilled inquiry containing only the public npm
   package and scorecard URL. Never transmit repository credentials through the
   form or URL.
4. Invoice only after confirming that the public repository and requested work
   fit the offer. Payment handling remains outside the ranking engine.
5. Measure scorecard views, `/improve` views and qualified inquiries. Do not
   claim impressions before the analytics baseline exists.

## Gates and verdict

- Vercel Web Analytics was enabled on 2026-08-12 and the generated HTML now
  includes its anonymous, cookie-free page-view script.
- The current Vercel account reports `billing.plan = hobby`. Vercel documents
  Hobby as non-commercial/personal use only. Therefore the paid CTA must not be
  published while the project remains on Hobby.
- Activation requires either Vercel Pro owner approval or a separately approved
  migration to a host whose terms permit commercial use. Do not silently incur
  a subscription or move DNS.
- Proposed measurement window: 14 days after activation.
- Pass: at least one external paid order, or two qualified external inquiries.
- Fail: zero qualified inquiries; remove the CTA and return to maintenance.
- Sponsorships, featured listings, subscriptions and additional offers stay
  frozen until this first offer has a measured verdict.

Sources checked for the decision:

- Vercel Hobby plan: <https://vercel.com/docs/plans/hobby>
- Vercel Web Analytics privacy: <https://vercel.com/docs/analytics/privacy-policy>
- Claude Rules featured-listing pricing: <https://clauderules.net/submit/mcp>
- ServerHub featured-listing pricing: <https://www.serverhub.digital/>
- Regulatory Signals MCP audit: <https://www.regulatorysignals.com/mcp-audit>
