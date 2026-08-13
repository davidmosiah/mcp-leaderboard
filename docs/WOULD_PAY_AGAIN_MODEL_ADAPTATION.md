# Would Pay Again model → MCP Scoreboard adaptation

Evidence captured 2026-08-12. This document separates observed behavior from
inference and records why the implementation copies the flywheel, not the
newsletter's exact product stack.

## What the model actually is

Would Pay Again is simultaneously a publication, a buyer of machine services,
an API QA lab, a public receipt ledger and a tiny advertising storefront. Its
core loop is:

1. discover an endpoint or story through x402 catalogs and targeted search;
2. pay for real calls, including one useful edge case;
3. independently verify output and settlement;
4. publish a free human story plus machine-readable surfaces;
5. notify the supplier with specific evidence;
6. retest a same-day fix and turn the response into follow-up coverage;
7. offer a clearly labeled ad or sponsored slot without selling the verdict.

The strongest conversion mechanism is not mass email. Public ledger entries
show targeted article/contact research, and the Delx approach arrived only
after a detailed paid review. The useful finding created the relationship; the
ad offer was attached to that value.

## Public economics we could verify

- The public ledger listed 103 paid calls and 29.0972 USDC spent at inspection
  time. Much of the early spend was company setup rather than repeat issue cost.
- Declared issue production was usually cents after setup: issue-specific calls
  and header assets ranged roughly from 0.001 to 0.4062 USDC in the first five
  editions.
- The ledger's 1.876 USDC income field explicitly describes circular payments
  from its own wallet, so it is not evidence of external revenue.
- Two outside classified bookings were publicly verifiable: 0.20 USDC for
  scrape402 and 0.60 USDC for Delx. Verified external ad revenue was therefore
  0.80 USDC at inspection time.
- A 25 USDC sponsored-review offer existed, but no public conversion was found.
- Paid issue JSON and a paid review feed existed, but public evidence did not
  support a demand claim for either.

The clever unit-economics property is that one supplier purchase produces two
assets: input for the publication and a review of the supplier. The hidden
bottleneck remains editorial judgment and follow-up, not API spend.

## What works and what we should not copy

### Keep

- real evidence before outreach;
- public limitations and failed deliveries;
- correction/retest as the most valuable follow-up story;
- free human reach plus deterministic machine-readable evidence;
- strict separation between payment and editorial verdict;
- cheap, automated production with a bounded human review surface.

### Do not copy

- pay-first ad approval and refund operations: approve fit before payment;
- anonymous inventory holds that can grief availability;
- self-settlements presented near income: indexing spend is acquisition, never
  revenue;
- paid JSON as a thesis before repeat buyer evidence;
- advertising before audience measurement;
- a ledger that aggregates income without itemizing external versus circular;
- hard-coded issue endpoints, stale RSS, missing `llms.txt`, or discovery
  records left under an old pay-to address.

## Our defensible advantage

Would Pay Again must find and test subjects one at a time. The Scoreboard
already has a complete, repeatable evidence source:

- 6,947 official-registry npm packages in the 2026-08-12 baseline;
- 3,976 scored with check-level evidence;
- 2,971 reported unreachable instead of assigned a fake low score;
- a fail-closed Grok Cloud run that uses no GitHub Actions quota, Mac compute or
  Hetzner batch compute;
- a canonical public scorecard for every scored package.

The differentiated editorial asset is therefore **verified change**, not broad
MCP news. Other public MCP newsletters cover launches and links; MCP Radar
tracks GitHub momentum. Scoreboard Weekly covers changes in agent-readiness
under one open methodology.

## Implemented flywheel

### Neutral publication

`MCP Scoreboard Weekly` is generated from the complete run:

- dated human HTML;
- canonical evidence JSON and Markdown;
- issue index, `latest.json` and RSS;
- ecosystem average, median, distribution and common readiness gaps;
- recovery/unreachable, new/removed package and package-version changes;
- improvements/declines only when the scorecard version and npm package
  version are unchanged across both runs.

The first edition is explicitly a baseline. A scorecard methodology change
suppresses directional claims. This prevents the publication from turning an
engine upgrade or package release into a fabricated maintainer achievement.

### Commercial conversion

The paid outcome is **MCP Score Improvement PR — 49 USDC** on the existing
Delx Commerce surface:

- five public repositories;
- free fit review before payment;
- current verification, prioritized remediation, one focused PR, full rerun;
- seven-calendar-day delivery target;
- no private credentials, production deploy, security claim, promised score or
  ranking influence.

The Scoreboard host contains no commercial CTA because it uses Vercel Hobby.
Commerce hosts the offer and machine contract, avoiding new spend, DNS and
infrastructure.

### Grok automation

The existing Monday 06:00 America/Fortaleza Grok Cloud routine owns the heavy
work in a fresh ephemeral VM with Cursor Grok 4.6 High Fast:

1. complete registry scan and fail-closed scoring;
2. deterministic weekly edition generation;
3. complete site render and verification;
4. connector-only commit after remote-SHA recheck;
5. production and IndexNow verification;
6. at most five evidence-specific outreach drafts, never sent automatically;
7. sanitized Delx continuity capsule under `wb-delx-grok`.

No scheduled process depends on the maintainer's Mac or shared Hetzner compute.

## Pilot gate

Run four editions, with a 14-day commercial measurement window beginning only
after the offer is verified live.

- Pass: one external paid remediation or two qualified external inquiries.
- Fail: zero qualified inquiries; remove the active offer and return to
  maintenance.
- Never count: self-buy, QA, page views, indexing settlements or unpaid holds.
- Ads remain frozen until at least 100 verified human views on an edition or 25
  email subscribers. A paid audience is not sold before an audience exists.
- Bounties and sponsored analysis remain frozen until the first offer has a
  measured verdict.

## Sources

- <https://wouldpayagain.com/>
- <https://wouldpayagain.com/pricing>
- <https://wouldpayagain.com/openapi.json>
- <https://wouldpayagain.com/ledger.json>
- <https://wouldpayagain.com/api/ads>
- <https://wouldpayagain.com/api/ads/booking/5>
- <https://wouldpayagain.com/api/ads/booking/9>
- <https://wouldpayagain.com/issue/5>
- <https://docs.cdp.coinbase.com/x402/bazaar>
- <https://www.pulsemcp.com/>
- <https://mcpnewsletter.com/>
- <https://mcp.liqiwa.com/>
