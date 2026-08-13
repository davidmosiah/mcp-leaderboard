# Registry Observatory design system

The public Scoreboard is an independent evidence publication, not a SaaS
dashboard. Its visual direction is an editorial registry observatory: warm
technical paper, black ink, signal red, evidence green and dense typographic
hierarchy. The memorable object is the current-run index panel, not a generic
gradient card.

## Source ownership

- Edit `templates/index.html` for the home-page structure.
- Edit `site/assets/site.css` for the shared system and root layout.
- Edit `site/assets/directory.css` for ranking, scorecard and weekly pages.
- Edit `site/assets/site.js` only for progressive enhancement. Server-rendered
  rows and links remain the source of truth without JavaScript.
- Edit `design/og-card.html`, then render exactly 1200×630 to
  `site/assets/og-card.png` for the social image.
- Never hand-edit generated `site/index.html`, `site/servers/`,
  `site/rankings/` or `site/issues/`.

## Product and evidence rules

- The home must let a human search the full scored corpus, not only the first
  ranking page.
- Every search result and table row resolves to a canonical scorecard.
- Weekly, scorecard and ranking surfaces share the same typography, header and
  evidence colors.
- Scoreboard pages stay neutral: no paid CTA, featured position or commercial
  ranking treatment. The separate Commerce offer does not influence this UI.
- Unreachable remains visually and semantically separate from a low score.
- The readiness/correctness/security limitation stays visible.

## Quality gates

`npm test` must preserve all generated SEO/GEO surfaces and pass
`scripts/design-contract-test.mjs`. Browser QA additionally checks:

- desktop and 390 px views of the home, a scorecard and a weekly edition;
- no document-level horizontal overflow at 390 px;
- complete-index search returns the canonical scorecard;
- no content remains hidden when animation or JavaScript is unavailable;
- focus-visible and reduced-motion behavior remain present;
- `site/assets/og-card.png` remains exactly 1200×630.

The scheduled corpus run and publication remain Grok Cloud work. The visual
assets are static and add no persistent compute requirement to the maintainer's
Mac.
