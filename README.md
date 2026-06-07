<h1 align="center">🏆 MCP Leaderboard</h1>

<p align="center">
  <a href="LEADERBOARD.md"><img src="https://img.shields.io/badge/VIEW-the_leaderboard-FBBF24?style=for-the-badge&labelColor=0F172A" alt="View the leaderboard" /></a>
  <a href="https://github.com/davidmosiah/mcp-scorecard"><img src="https://img.shields.io/badge/ENGINE-mcp--scorecard-7C3AED?style=for-the-badge&labelColor=0F172A" alt="mcp-scorecard" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/LICENSE-MIT-22C55E?style=for-the-badge&labelColor=0F172A" alt="License MIT" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/BUILT_FOR-MCP-0EA5A3?style=for-the-badge&labelColor=0F172A" alt="Built for MCP" /></a>
</p>

<h3 align="center">
  The agent-readiness ranking of the entire public MCP ecosystem.<br>
  Every npm server in the official registry, booted and graded — auto-refreshed weekly.
</h3>

---

## 👉 [See the live leaderboard → LEADERBOARD.md](LEADERBOARD.md)

Every public MCP server in the [official registry](https://registry.modelcontextprotocol.io) is booted over stdio and graded by [**mcp-scorecard**](https://github.com/davidmosiah/mcp-scorecard) on 10 agent-readiness checks — schema validity, tool naming, read-only annotations, discovery surfaces, mutation gating, privacy modes, and more — for a 0–100 score. A weekly GitHub Action re-scores the field and commits the result. Nothing is hand-edited.

## Why this exists

Hundreds of MCP servers ship every month and there's no neutral signal for which ones an agent can actually pick up cleanly. Downloads measure popularity, not quality. This leaderboard measures **agent-readiness**: can an LLM discover the tools, trust the schemas, and onboard itself without a human reading the source?

## Climb the board

```bash
# Score your server and get the itemized fixes
npx -y mcp-scorecard <your-package-or-repo>

# Add the live badge to your README
npx -y mcp-scorecard <your-package> --badge
```

Improve the conventions the score rewards (snake_case tool names, read-only annotations, an `*_agent_manifest` / `*_capabilities` discovery surface, a smoke test) and you climb on the next refresh.

## How it's built

```bash
npm ci
npm run corpus    # pull npm-installable servers from the MCP registry → data/corpus.json
npm run run       # boot + score each with mcp-scorecard → data/leaderboard.json
npm run render    # → LEADERBOARD.md
# or: npm run all
```

Bounded runs while iterating:

```bash
npm run run -- --limit 30           # first 30 of the corpus
npm run run -- --targets whoop-mcp-unofficial,astral-mcp
```

## Methodology & fairness

- **Corpus:** npm-installable servers from the official registry, latest active version, deduped.
- **Isolation:** each server boots in its own child process with a hard timeout; one hang can't stall the run.
- **Unreachable ≠ bad:** servers that require auth before `listTools()` and don't honor the `MCP_PROBE` hook are listed as *unreachable*, not scored low. Support `MCP_PROBE` to be gradeable.
- **Scope:** this grades shape, metadata and discoverability — **not** correctness or security. A server can score 100 and still return wrong data. Always review before production.

Methodology issues and corpus additions welcome via [issues](https://github.com/davidmosiah/mcp-leaderboard/issues).

## License

MIT — the engine ([mcp-scorecard](https://github.com/davidmosiah/mcp-scorecard)) and this leaderboard are both open source. Built by [David Mosiah](https://github.com/davidmosiah).
