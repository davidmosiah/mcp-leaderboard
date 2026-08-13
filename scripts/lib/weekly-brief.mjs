const ORIGIN = "https://leaderboard.delx.ai";
const MOVEMENT_LIMIT = 10;

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const jsonForHtml = (value) => JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
const serverPath = (npm) => npm.split("/").map(encodeURIComponent).join("/");
const scorecardUrl = (npm) => `${ORIGIN}/servers/${serverPath(npm)}`;
const scoredOnly = (board) => (board.results || []).filter((item) => item.status === "scored");
const byNpm = (board) => new Map((board?.results || []).map((item) => [item.npm, item]));
const versionKnownAndEqual = (before, after) => Boolean(before.version && after.version && before.version === after.version);

const rankMap = (board) => new Map(
  scoredOnly(board)
    .sort((a, b) => b.score - a.score || a.npm.localeCompare(b.npm))
    .map((item, index) => [item.npm, index + 1])
);

const checkChanges = (before, after) => {
  const oldChecks = new Map((before.checks || []).map((item) => [item.id, item]));
  return (after.checks || [])
    .filter((item) => {
      const old = oldChecks.get(item.id);
      return old && (old.status !== item.status || old.score !== item.score);
    })
    .map((item) => {
      const old = oldChecks.get(item.id);
      return {
        checkId: item.id,
        label: item.label,
        previousStatus: old.status,
        currentStatus: item.status,
        previousScore: old.score,
        currentScore: item.score
      };
    })
    .sort((a, b) => a.checkId.localeCompare(b.checkId));
};

const movementRecord = (before, after, oldRanks, newRanks) => ({
  npm: after.npm,
  repo: after.repo || before.repo || null,
  version: after.version || null,
  previousScore: before.score,
  currentScore: after.score,
  delta: after.score - before.score,
  previousRank: oldRanks.get(before.npm) || null,
  currentRank: newRanks.get(after.npm) || null,
  checkChanges: checkChanges(before, after)
});

const ecosystemSummary = (current) => {
  const scored = scoredOnly(current);
  const scores = scored.map((item) => item.score).sort((a, b) => a - b);
  const averageScore = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : 0;
  const middle = Math.floor(scores.length / 2);
  const medianScore = scores.length === 0
    ? 0
    : scores.length % 2
      ? scores[middle]
      : Math.round((scores[middle - 1] + scores[middle]) / 2);
  const distribution = [
    { tier: "90-100", servers: scores.filter((score) => score >= 90).length },
    { tier: "75-89", servers: scores.filter((score) => score >= 75 && score < 90).length },
    { tier: "60-74", servers: scores.filter((score) => score >= 60 && score < 75).length },
    { tier: "40-59", servers: scores.filter((score) => score >= 40 && score < 60).length },
    { tier: "0-39", servers: scores.filter((score) => score < 40).length }
  ];
  const topServers = [...scored]
    .sort((a, b) => b.score - a.score || a.npm.localeCompare(b.npm))
    .slice(0, 10)
    .map((item, index) => ({ npm: item.npm, score: item.score, rank: index + 1, version: item.version || null }));
  return { averageScore, medianScore, distribution, topServers };
};

const commonGaps = (current) => {
  const scored = scoredOnly(current);
  const gaps = new Map();
  for (const result of scored) {
    for (const item of result.checks || []) {
      if (item.status === "pass") continue;
      const entry = gaps.get(item.id) || { checkId: item.id, label: item.label, servers: 0 };
      entry.servers += 1;
      gaps.set(item.id, entry);
    }
  }
  return [...gaps.values()]
    .map((item) => ({ ...item, shareOfScored: scored.length ? Number((item.servers / scored.length).toFixed(4)) : 0 }))
    .sort((a, b) => b.servers - a.servers || a.checkId.localeCompare(b.checkId))
    .slice(0, 10);
};

const assertCompleteBoard = (board) => {
  if (!board || !Array.isArray(board.results)) throw new Error("weekly brief requires a leaderboard payload");
  const counts = board.counts || {};
  if (counts.deferred !== 0) throw new Error("weekly brief refuses a deferred leaderboard run");
  if (counts.total !== board.results.length) throw new Error("weekly brief refuses a count/result mismatch");
  if (counts.scored + counts.unreachable !== counts.total) throw new Error("weekly brief refuses incomplete coverage counts");
};

export function buildEdition({ current, previous = null }) {
  assertCompleteBoard(current);
  if (previous) assertCompleteBoard(previous);

  const slug = current.generatedAt.slice(0, 10);
  const baseline = !previous;
  const sameMethodology = Boolean(
    previous?.engineVersion &&
    current.engineVersion &&
    previous.engine === current.engine &&
    previous.engineVersion === current.engineVersion
  );
  const kind = baseline ? "baseline" : sameMethodology ? "weekly_delta" : "methodology_change";
  const reason = baseline
    ? "This is the baseline edition; no earlier comparable run is used for directional claims."
    : sameMethodology
      ? `Both runs used ${current.engine}@${current.engineVersion}; score deltas are reported only when the npm package version is unchanged.`
      : `Score deltas are suppressed because methodology changed or is unknown (${previous.engine || "unknown"}@${previous.engineVersion || "unknown"} → ${current.engine || "unknown"}@${current.engineVersion || "unknown"}).`;

  const movements = {
    improvements: [],
    declines: [],
    recovered: [],
    becameUnreachable: [],
    newPackages: [],
    removedPackages: [],
    packageUpdates: []
  };

  if (previous) {
    const oldItems = byNpm(previous);
    const newItems = byNpm(current);
    const oldRanks = rankMap(previous);
    const newRanks = rankMap(current);

    for (const after of current.results) {
      const before = oldItems.get(after.npm);
      if (!before) {
        movements.newPackages.push({ npm: after.npm, status: after.status, score: after.score ?? null, version: after.version || null });
        continue;
      }
      if (before.status !== "scored" && after.status === "scored") {
        movements.recovered.push({ npm: after.npm, currentScore: after.score, currentRank: newRanks.get(after.npm) || null, version: after.version || null });
      } else if (before.status === "scored" && after.status !== "scored") {
        movements.becameUnreachable.push({ npm: after.npm, previousScore: before.score, previousRank: oldRanks.get(after.npm) || null, version: after.version || before.version || null });
      }
      if (before.version && after.version && before.version !== after.version) {
        movements.packageUpdates.push({
          npm: after.npm,
          previousVersion: before.version,
          currentVersion: after.version,
          previousStatus: before.status,
          currentStatus: after.status,
          previousScore: before.score ?? null,
          currentScore: after.score ?? null
        });
        continue;
      }
      if (
        sameMethodology &&
        before.status === "scored" &&
        after.status === "scored" &&
        versionKnownAndEqual(before, after) &&
        before.score !== after.score
      ) {
        const record = movementRecord(before, after, oldRanks, newRanks);
        if (record.delta > 0) movements.improvements.push(record);
        if (record.delta < 0) movements.declines.push(record);
      }
    }

    for (const before of previous.results) {
      if (!newItems.has(before.npm)) {
        movements.removedPackages.push({ npm: before.npm, previousStatus: before.status, previousScore: before.score ?? null, version: before.version || null });
      }
    }
  }

  movements.improvements.sort((a, b) => b.delta - a.delta || a.npm.localeCompare(b.npm));
  movements.declines.sort((a, b) => a.delta - b.delta || a.npm.localeCompare(b.npm));
  for (const key of ["recovered", "becameUnreachable", "newPackages", "removedPackages", "packageUpdates"]) {
    movements[key].sort((a, b) => a.npm.localeCompare(b.npm));
  }
  movements.improvements = movements.improvements.slice(0, MOVEMENT_LIMIT);
  movements.declines = movements.declines.slice(0, MOVEMENT_LIMIT);

  return {
    schemaVersion: "1",
    slug,
    title: baseline ? `MCP Scoreboard Weekly — ${slug} baseline` : `MCP Scoreboard Weekly — ${slug}`,
    kind,
    generatedAt: current.generatedAt,
    previousGeneratedAt: previous?.generatedAt || null,
    engine: current.engine || "mcp-scorecard",
    engineVersion: current.engineVersion || null,
    coverage: { ...current.counts },
    ecosystem: ecosystemSummary(current),
    commonGaps: commonGaps(current),
    comparability: { scoreDeltasComparable: sameMethodology, reason },
    movements,
    limitations: [
      "The score measures agent-readiness metadata, schemas, discovery and declared safety cues — not correctness or security.",
      "Unreachable means the package could not be graded fairly; it is not a low score.",
      "A score movement is directional evidence only when both runs use the same engine version and the package version is unchanged."
    ],
    canonicalUrl: `${ORIGIN}/issues/${slug}`,
    machineUrl: `${ORIGIN}/issues/${slug}/edition.json`
  };
}

const markdownList = (items, formatter, empty = "No qualifying changes.") => items.length
  ? items.map((item) => `- ${formatter(item)}`).join("\n")
  : empty;

export function renderEditionMarkdown(edition) {
  const lines = [
    `# ${edition.title}`,
    "",
    `Generated ${edition.generatedAt}. ${edition.coverage.scored} of ${edition.coverage.total} registry packages were scored; ${edition.coverage.unreachable} were unreachable and ${edition.coverage.deferred} were deferred.`,
    "",
    `**Comparison status:** ${edition.comparability.reason}`,
    "",
    `Ecosystem average: **${edition.ecosystem.averageScore}/100** · median: **${edition.ecosystem.medianScore}/100**.`,
    "",
    "## Most common readiness gaps",
    "",
    ...edition.commonGaps.slice(0, 5).map((item) => `- ${item.label}: ${item.servers} servers (${Math.round(item.shareOfScored * 100)}% of scored packages)`),
    ""
  ];

  if (edition.comparability.scoreDeltasComparable) {
    lines.push(
      "## Largest verified improvements",
      "",
      markdownList(edition.movements.improvements, (item) => `[${item.npm}](${scorecardUrl(item.npm)}): ${item.previousScore} → ${item.currentScore} (${item.delta > 0 ? "+" : ""}${item.delta}) on npm ${item.version}`),
      "",
      "## Largest verified declines",
      "",
      markdownList(edition.movements.declines, (item) => `[${item.npm}](${scorecardUrl(item.npm)}): ${item.previousScore} → ${item.currentScore} (${item.delta}) on npm ${item.version}`),
      ""
    );
  }

  lines.push(
    "## Reachability and catalog changes",
    "",
    `Recovered: ${edition.movements.recovered.length} · became unreachable: ${edition.movements.becameUnreachable.length} · new packages: ${edition.movements.newPackages.length} · removed packages: ${edition.movements.removedPackages.length} · package version changes: ${edition.movements.packageUpdates.length}.`,
    "",
    "## Limits",
    "",
    ...edition.limitations.map((item) => `- ${item}`),
    "",
    `[Machine-readable evidence](${edition.machineUrl}) · [Complete leaderboard](${ORIGIN}/)`
  );
  return `${lines.join("\n")}\n`;
}

const movementCards = (items, direction) => items.length
  ? items.map((item) => `<li><a href="${scorecardUrl(item.npm)}">${esc(item.npm)}</a><span>${item.previousScore} → ${item.currentScore}</span><strong>${direction === "up" ? "+" : ""}${item.delta}</strong><small>npm ${esc(item.version)}</small></li>`).join("\n")
  : "<li><span>No qualifying changes.</span></li>";

export function renderEditionHtml(edition) {
  const description = `${edition.coverage.scored} MCP servers scored, ${edition.coverage.unreachable} unreachable, with evidence-first ecosystem changes and readiness gaps.`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: edition.title,
    datePublished: edition.generatedAt,
    dateModified: edition.generatedAt,
    mainEntityOfPage: edition.canonicalUrl,
    isAccessibleForFree: true,
    author: { "@type": "Person", name: "David Mosiah", url: "https://github.com/davidmosiah" },
    about: ["Model Context Protocol", "MCP servers", "agent-readiness"]
  };
  const top = edition.ecosystem.topServers.slice(0, 5)
    .map((item) => `<li><span>#${item.rank}</span><a href="${scorecardUrl(item.npm)}">${esc(item.npm)}</a><strong>${item.score}/100</strong></li>`)
    .join("\n");
  const gaps = edition.commonGaps.slice(0, 5)
    .map((item) => `<li><span>${esc(item.label)}</span><strong>${item.servers}</strong><small>${Math.round(item.shareOfScored * 100)}% of scored packages</small></li>`)
    .join("\n");
  const comparisonSections = edition.comparability.scoreDeltasComparable ? `<section><h2>Largest verified improvements</h2><ul class="movements">${movementCards(edition.movements.improvements, "up")}</ul></section>
      <section><h2>Largest verified declines</h2><ul class="movements">${movementCards(edition.movements.declines, "down")}</ul></section>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(edition.title)} · MCP Leaderboard</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${edition.canonicalUrl}">
  <link rel="alternate" type="application/json" href="${edition.machineUrl}">
  <link rel="alternate" type="application/rss+xml" href="${ORIGIN}/issues/feed.xml" title="MCP Scoreboard Weekly">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/site.css">
  <link rel="stylesheet" href="/assets/directory.css">
  <script type="application/ld+json">
${jsonForHtml(structuredData)}
  </script>
  <script defer src="/assets/analytics-init.js"></script>
  <script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="paper-grid" aria-hidden="true"></div>
  <header class="site-header"><a class="brand" href="${ORIGIN}/"><span class="brand-index" aria-hidden="true">MCP<br>01</span><span class="brand-wordmark"><strong>Leaderboard</strong><small>Weekly evidence by Delx</small></span></a><nav class="nav"><a href="${ORIGIN}/">Leaderboard</a><a href="${ORIGIN}/issues/">Weekly</a><a class="nav-mark" href="${edition.machineUrl}">JSON ↗</a></nav></header>
  <main id="main" class="directory-main">
    <article class="scorecard-page weekly-edition">
      <header class="scorecard-hero"><div><p class="eyebrow">MCP Scoreboard Weekly · ${esc(edition.kind.replaceAll("_", " "))}</p><h1>${esc(edition.title)}</h1><p>${esc(description)}</p></div><div class="score-orb tier-b"><strong>${edition.ecosystem.averageScore}</strong><span>average /100</span></div></header>
      <section class="scorecard-context"><h2>Evidence boundary</h2><p>${esc(edition.comparability.reason)}</p><p><strong>${edition.coverage.scored}</strong> scored · <strong>${edition.coverage.unreachable}</strong> unreachable · <strong>${edition.coverage.deferred}</strong> deferred.</p></section>
      <section><h2>Top of the current board</h2><ul class="movements">${top}</ul></section>
      <section><h2>Most common readiness gaps</h2><ul class="movements">${gaps}</ul></section>
${comparisonSections ? `      ${comparisonSections}\n` : ""}      <section><h2>Reachability and catalog changes</h2><p>Recovered: ${edition.movements.recovered.length} · became unreachable: ${edition.movements.becameUnreachable.length} · new packages: ${edition.movements.newPackages.length} · removed packages: ${edition.movements.removedPackages.length} · package version changes: ${edition.movements.packageUpdates.length}.</p></section>
      <section class="scorecard-context"><h2>What this does not prove</h2><ul>${edition.limitations.map((item) => `<li>${esc(item)}</li>`).join("")}</ul><div class="scorecard-actions"><a class="button primary" href="${edition.machineUrl}">Download evidence JSON</a><a class="button secondary" href="${ORIGIN}/">Browse every scorecard</a></div></section>
    </article>
  </main>
  <footer class="footer"><p><strong>MCP Scoreboard Weekly</strong> is generated from the same complete, fail-closed run as the public leaderboard.</p><p>The score measures agent-readiness shape and metadata, not correctness or security.</p></footer>
</body>
</html>
`;
}
