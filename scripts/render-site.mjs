// Render the public, crawlable static site from the committed leaderboard.
// The generated HTML, JSON-LD, sitemap and agent-readable surfaces all come
// from the same dataset so search engines and answer engines see one truth.
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

const ORIGIN = "https://leaderboard.delx.ai";
const PAGE_SIZE = 100;
const data = JSON.parse(readFileSync("data/leaderboard.json", "utf8"));
const scored = (data.results || [])
  .filter((result) => result.status === "scored")
  .sort((a, b) => b.score - a.score || a.npm.localeCompare(b.npm));

if (!scored.length) {
  console.error("render-site: no scored servers in data/leaderboard.json — refusing to bake an empty board");
  process.exit(1);
}

const pageCount = Math.ceil(scored.length / PAGE_SIZE);
const dateShort = data.generatedAt.slice(0, 10);
const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const xmlEsc = (value) => esc(value).replace(/'/g, "&apos;");
const json = (value) => JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
const tierClass = (score) => score >= 90 ? "tier-a" : score >= 75 ? "tier-b" : score >= 60 ? "tier-c" : score >= 40 ? "tier-d" : "tier-f";
const npmUrl = (npm) => `https://www.npmjs.com/package/${npm}`;
const serverPath = (npm) => npm.split("/").map(encodeURIComponent).join("/");
const serverUrl = (npm) => `${ORIGIN}/servers/${serverPath(npm)}`;
const serverFile = (npm) => join("site", "servers", ...npm.split("/"), "index.html");
const write = (path, contents) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
};

const checksSummary = (result) => {
  const checks = result.checks || [];
  const passes = checks.filter((check) => check.status === "pass").map((check) => check.label).slice(0, 3);
  const gaps = checks.filter((check) => check.status !== "pass").map((check) => check.label).slice(0, 2);
  return passes.map((label) => `<span class="pass">+ ${esc(label)}</span>`).join("\n") +
    (passes.length && gaps.length ? "\n" : "") +
    gaps.map((label) => `<span class="fail">&ndash; ${esc(label)}</span>`).join("\n");
};

const rankingRows = (results, offset = 0) => results.map((result, index) => {
  const rank = offset + index + 1;
  return `          <tr class="${rank <= 3 ? `top-${rank}` : ""}">
            <td class="fb-rank">${rank}</td>
            <td class="fb-srv"><a href="${serverUrl(result.npm)}">${esc(result.npm)}</a><small>${result.serverName ? `server: ${esc(result.serverName)}` : "View the complete scorecard"}</small></td>
            <td><span class="score-pill ${tierClass(result.score)}">${result.score}</span></td>
            <td><div class="bar"><i style="width:${result.score}%;background:linear-gradient(90deg,var(--gold),var(--violet))"></i></div></td>
            <td><div class="check-tags">${checksSummary(result)}</div></td>
          </tr>`;
}).join("\n");

const heroRows = scored.slice(0, 5).map((result, index) => `          <tr class="${index < 3 ? `top-${index + 1}` : ""}">
            <td class="col-rank">${index + 1}</td>
            <td class="col-srv"><a href="${serverUrl(result.npm)}">${esc(result.npm)}</a></td>
            <td><span class="score-pill ${tierClass(result.score)}">${result.score}</span></td>
            <td class="gap-cell"><span class="dot"></span>${esc(result.topGap || "—")}</td>
          </tr>`).join("\n");

const pagination = (current) => {
  const link = (page) => page === 1 ? `${ORIGIN}/#leaderboard` : `${ORIGIN}/rankings/${page}`;
  const previous = current > 1 ? `<a class="pagination-step" href="${link(current - 1)}" rel="prev">← Previous</a>` : "";
  const next = current < pageCount ? `<a class="pagination-step" href="${link(current + 1)}" rel="next">Next →</a>` : "";
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)
    .map((page) => page === current
      ? `<span aria-current="page">${page}</span>`
      : `<a href="${link(page)}">${page}</a>`)
    .join("");
  return `<nav class="pagination" aria-label="Leaderboard pages">${previous ? `\n    ${previous}` : ""}
    <div class="pagination-pages">${pages}</div>${next ? `\n    ${next}` : ""}
  </nav>`;
};

const person = {
  "@type": "Person",
  "@id": "https://github.com/davidmosiah#person",
  name: "David Mosiah",
  url: "https://github.com/davidmosiah",
  sameAs: ["https://x.com/delx369", "https://github.com/davidmosiah"]
};

const rootStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${ORIGIN}/#website`,
      url: `${ORIGIN}/`,
      name: "MCP Leaderboard",
      description: "Public agent-readiness ranking of npm-installable Model Context Protocol servers.",
      publisher: { "@id": person["@id"] }
    },
    person,
    {
      "@type": "SoftwareApplication",
      "@id": `${ORIGIN}/#engine`,
      name: "mcp-scorecard",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Node.js",
      description: "Open-source CLI and MCP server that grades MCP agent-readiness on a 0-100 score.",
      downloadUrl: "https://www.npmjs.com/package/mcp-scorecard",
      url: "https://github.com/davidmosiah/mcp-scorecard",
      codeRepository: "https://github.com/davidmosiah/mcp-scorecard",
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      author: { "@id": person["@id"] }
    },
    {
      "@type": "Dataset",
      "@id": `${ORIGIN}/#dataset`,
      name: "MCP Agent-Readiness Leaderboard",
      alternateName: ["MCP Leaderboard", "Model Context Protocol server ranking"],
      description: `A weekly dataset ranking ${scored.length} npm-installable Model Context Protocol servers by agent-readiness. Each server is booted over stdio and measured on schema validity, tool naming, descriptions, annotations, mutation gating, privacy modes, resources, discovery and smoke testing.`,
      url: `${ORIGIN}/`,
      sameAs: "https://github.com/davidmosiah/mcp-leaderboard",
      isBasedOn: "https://registry.modelcontextprotocol.io",
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      creator: { "@id": person["@id"] },
      dateModified: data.generatedAt,
      version: data.generatedAt,
      keywords: ["Model Context Protocol", "MCP servers", "agent-readiness", "leaderboard", "AI agents"],
      measurementTechnique: "Boot each MCP server over stdio; run mcp-scorecard agent-readiness checks; sum the checks to a 0-100 score.",
      variableMeasured: ["Agent-readiness score", "Schema validity", "Tool naming", "Tool descriptions", "Annotations", "Mutation gating", "Privacy modes", "Resources", "Agent discovery", "Smoke test"],
      distribution: [{
        "@type": "DataDownload",
        encodingFormat: "application/json",
        contentUrl: `${ORIGIN}/leaderboard.json`
      }]
    },
    {
      "@type": "ItemList",
      "@id": `${ORIGIN}/#ranking`,
      name: "MCP Leaderboard ranking",
      description: "MCP servers ranked by agent-readiness score from highest to lowest.",
      numberOfItems: scored.length,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: scored.slice(0, PAGE_SIZE).map((result, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: result.npm,
        url: serverUrl(result.npm)
      }))
    }
  ]
};

let html = readFileSync("site/index.html", "utf8");
const missing = [];
const swap = (pattern, replacement, label) => {
  if (!pattern.test(html)) {
    missing.push(label);
    return;
  }
  html = html.replace(pattern, replacement);
};
const swapTbody = (id, rows) => swap(
  new RegExp(`(<tbody id="${id}">)[\\s\\S]*?(</tbody>)`),
  `$1\n${rows}\n          $2`,
  id
);
const swapLive = (key, value) => {
  const pattern = new RegExp(`(data-live="${key}"[^>]*>)[^<]*(</)`, "g");
  if (!pattern.test(html)) missing.push(`data-live=${key}`);
  html = html.replace(pattern, `$1${value}$2`);
};

swapTbody("hero-board-body", heroRows);
swapTbody("full-board-body", rankingRows(scored.slice(0, PAGE_SIZE)));
swapLive("generated", dateShort);
swapLive("scored", String(data.counts?.scored ?? scored.length));
swapLive("total", String(data.counts?.total ?? data.results.length));
swapLive("unreachable", String(data.counts?.unreachable ?? data.results.length - scored.length));
swap(/<body data-generated="[^"]*">/, `<body data-generated="${data.generatedAt}">`, "body[data-generated]");
swap(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">\n${json(rootStructuredData)}\n  </script>`, "root JSON-LD");
swap(/<meta name="description" content="[^"]*">/, `<meta name="description" content="Compare ${scored.length} MCP servers by agent-readiness score, rank and check-level evidence. Built from the official MCP registry and refreshed weekly.">`, "meta description");
swap(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="Compare ${scored.length} MCP servers by agent-readiness score with a canonical evidence page for every scored package.">`, "Open Graph description");
swap(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="Compare ${scored.length} MCP servers by agent-readiness score with check-level evidence.">`, "Twitter description");
swap(/<p class="unreachable-note">[\s\S]*?<\/p>/, `<p class="unreachable-note"><b>${data.counts.unreachable} servers were unreachable this run</b> and are intentionally not scored. Auth requirements, startup errors and timeouts are reported as unreachable rather than converted into a fake low score.</p>`, "unreachable note");
if (/<nav class="pagination"/.test(html)) {
  html = html.replace(/<nav class="pagination"[\s\S]*?<\/nav>/, pagination(1));
} else {
  html = html.replace(/(<p class="unreachable-note">[\s\S]*?<\/p>)/, `$1\n        ${pagination(1)}`);
}
html = html
  .replaceAll("GitHub Action", "Grok Cloud routine")
  .replace(/<section class="notice"[\s\S]*?<\/section>/, `<section class="notice" aria-label="Complete registry run" data-reveal><strong>Complete registry run.</strong><span>This edition covers <span data-live="total">${data.counts.total}</span> unique npm packages from the official registry: <span data-live="scored">${data.counts.scored}</span> scored and <span data-live="unreachable">${data.counts.unreachable}</span> reported as unreachable rather than unfairly penalized.</span></section>`)
  .replace('<article class="story-card" data-reveal>\n        <article class="story-card" data-reveal>', '<article class="story-card" data-reveal>')
  .replace("The whole board, by score.", `Top ${PAGE_SIZE} servers. Browse every scorecard.`)
  .replace(/(?:Page 1 of \d+\. )*Every server here was booted/, `Page 1 of ${pageCount}. Every server here was booted`)
  .replace("Full table below", `Top ${PAGE_SIZE} below · ${scored.length} detailed scorecards`);
if (!html.includes('href="/llms.txt"')) {
  html = html.replace(
    '<link rel="alternate" type="application/json" href="/leaderboard.json" title="Machine-readable leaderboard data">',
    '<link rel="alternate" type="application/json" href="/leaderboard.json" title="Machine-readable leaderboard data">\n  <link rel="alternate" type="text/plain" href="/llms.txt" title="AI-readable project summary">\n  <link rel="alternate" type="text/plain" href="/llms-full.txt" title="Complete AI-readable ranking">'
  );
}

if (missing.length) {
  console.error(`render-site: anchors missing in site/index.html: ${missing.join(", ")}`);
  process.exit(1);
}
writeFileSync("site/index.html", html);

const pageHead = ({ title, description, canonical, structuredData }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="author" content="David Mosiah">
  <meta name="theme-color" content="#0b1120">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="MCP Leaderboard">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ORIGIN}/assets/og-card.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${ORIGIN}/assets/og-card.png">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/site.css">
  <link rel="stylesheet" href="/assets/directory.css">
  <script type="application/ld+json">
${json(structuredData)}
  </script>
</head>`;

const pageHeader = `<a class="skip-link" href="#main">Skip to content</a>
  <div class="grain" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="${ORIGIN}/" aria-label="MCP Leaderboard home">
      <span class="brand-mark" aria-hidden="true"></span>
      <span><strong>MCP Leaderboard</strong><small>by Delx · agent-readiness, ranked</small></span>
    </a>
    <nav class="nav" aria-label="Primary navigation">
      <a href="${ORIGIN}/#leaderboard">Leaderboard</a>
      <a href="${ORIGIN}/#method">Methodology</a>
      <a href="${ORIGIN}/#agents">For agents</a>
      <a class="nav-pill" href="https://github.com/davidmosiah/mcp-leaderboard">GitHub</a>
    </nav>
  </header>`;

const pageFooter = `<footer class="footer">
    <p><strong>MCP Leaderboard</strong> by <a href="https://github.com/davidmosiah">David Mosiah</a>. Scored by <a href="https://github.com/davidmosiah/mcp-scorecard">mcp-scorecard</a> from the <a href="https://registry.modelcontextprotocol.io">official MCP registry</a>.</p>
    <p>This measures agent-readiness shape and metadata, not correctness or security. Always review before production.</p>
  </footer>`;

rmSync("site/servers", { recursive: true, force: true });
rmSync("site/rankings", { recursive: true, force: true });

for (const [index, result] of scored.entries()) {
  const rank = index + 1;
  const canonical = serverUrl(result.npm);
  const description = `${result.npm} ranks #${rank} of ${scored.length} scored MCP servers with an agent-readiness score of ${result.score}/100. See every check and the biggest gap.`;
  const additionalProperty = [
    { "@type": "PropertyValue", name: "Agent-readiness score", value: result.score, unitText: "out of 100" },
    { "@type": "PropertyValue", name: "Leaderboard rank", value: rank },
    ...(result.checks || []).map((check) => ({
      "@type": "PropertyValue",
      name: check.label,
      value: check.score,
      unitText: `${check.status}; points out of 10`
    }))
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${canonical}#page`,
        url: canonical,
        name: `${result.npm} MCP server scorecard`,
        description,
        dateModified: data.generatedAt,
        isPartOf: { "@id": `${ORIGIN}/#website` },
        mainEntity: { "@id": `${canonical}#software` }
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${canonical}#software`,
        name: result.npm,
        alternateName: result.serverName || undefined,
        url: canonical,
        downloadUrl: npmUrl(result.npm),
        codeRepository: result.repo || undefined,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Node.js",
        description,
        isAccessibleForFree: true,
        additionalProperty
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "MCP Leaderboard", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: `Ranking page ${Math.ceil(rank / PAGE_SIZE)}`, item: rank <= PAGE_SIZE ? `${ORIGIN}/#leaderboard` : `${ORIGIN}/rankings/${Math.ceil(rank / PAGE_SIZE)}` },
          { "@type": "ListItem", position: 3, name: result.npm, item: canonical }
        ]
      }
    ]
  };
  const checks = (result.checks || []).map((check) => `<li class="check-result check-${esc(check.status)}">
          <span><strong>${esc(check.label)}</strong><small>${esc(check.status)}</small></span>
          <b>${check.score}/10</b>
        </li>`).join("\n");
  const neighbors = scored.slice(Math.max(0, index - 2), Math.min(scored.length, index + 3))
    .filter((neighbor) => neighbor.npm !== result.npm)
    .map((neighbor) => `<a href="${serverUrl(neighbor.npm)}"><span>${esc(neighbor.npm)}</span><b>${neighbor.score}/100</b></a>`)
    .join("\n");
  const document = `${pageHead({ title: `${result.npm} MCP score: ${result.score}/100 · MCP Leaderboard`, description, canonical, structuredData })}
<body>
  ${pageHeader}
  <main id="main" class="directory-main">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${ORIGIN}/">MCP Leaderboard</a><span>/</span><a href="${rank <= PAGE_SIZE ? `${ORIGIN}/#leaderboard` : `${ORIGIN}/rankings/${Math.ceil(rank / PAGE_SIZE)}`}">Rank #${rank}</a><span>/</span><span>${esc(result.npm)}</span></nav>
    <article class="scorecard-page">
      <header class="scorecard-hero">
        <div><p class="eyebrow">MCP server scorecard · updated ${dateShort}</p><h1>${esc(result.npm)}</h1><p>${esc(description)}</p></div>
        <div class="score-orb ${tierClass(result.score)}" aria-label="Score ${result.score} out of 100"><strong>${result.score}</strong><span>out of 100</span></div>
      </header>
      <dl class="score-facts">
        <div><dt>Rank</dt><dd>#${rank} of ${scored.length}</dd></div>
        <div><dt>Server name</dt><dd>${esc(result.serverName || "Not reported")}</dd></div>
        <div><dt>Biggest gap</dt><dd>${esc(result.topGap || "None reported")}</dd></div>
        <div><dt>Measured</dt><dd>${dateShort}</dd></div>
      </dl>
      <section class="check-section" aria-labelledby="checks-title"><div class="section-head"><p class="eyebrow">Check-level evidence</p><h2 id="checks-title">Every agent-readiness check.</h2></div><ul class="check-results">${checks}</ul></section>
      <section class="scorecard-context"><h2>What this score means</h2><p>mcp-scorecard boots the package over stdio and grades its schemas, tool metadata, safety annotations, discovery surfaces and smoke-test readiness. The score measures how easily an agent can understand and onboard the server. It does not certify correctness or security.</p><div class="scorecard-actions"><a class="button primary" href="${npmUrl(result.npm)}" rel="noopener">View npm package</a>${result.repo ? `<a class="button secondary" href="${esc(result.repo)}" rel="noopener">Source repository</a>` : ""}<a class="button secondary" href="${ORIGIN}/#method">Read methodology</a></div></section>
      <aside class="nearby-scorecards" aria-labelledby="nearby-title"><h2 id="nearby-title">Nearby in the ranking</h2><div>${neighbors}</div></aside>
    </article>
  </main>
  ${pageFooter}
</body>
</html>\n`;
  write(serverFile(result.npm), document);
}

for (let page = 2; page <= pageCount; page += 1) {
  const start = (page - 1) * PAGE_SIZE;
  const results = scored.slice(start, start + PAGE_SIZE);
  const canonical = `${ORIGIN}/rankings/${page}`;
  const firstRank = start + 1;
  const lastRank = start + results.length;
  const description = `MCP Leaderboard ranks ${firstRank}-${lastRank}: compare agent-readiness scores and detailed evidence for npm-installable Model Context Protocol servers.`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `${canonical}#page`, url: canonical, name: `MCP Leaderboard rankings ${firstRank}-${lastRank}`, description, dateModified: data.generatedAt, isPartOf: { "@id": `${ORIGIN}/#website` } },
      { "@type": "ItemList", numberOfItems: results.length, itemListOrder: "https://schema.org/ItemListOrderDescending", itemListElement: results.map((result, index) => ({ "@type": "ListItem", position: start + index + 1, name: result.npm, url: serverUrl(result.npm) })) },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "MCP Leaderboard", item: `${ORIGIN}/` }, { "@type": "ListItem", position: 2, name: `Ranking page ${page}`, item: canonical }] }
    ]
  };
  const document = `${pageHead({ title: `MCP Leaderboard rankings ${firstRank}-${lastRank} · Page ${page}`, description, canonical, structuredData })}
<body>
  ${pageHeader}
  <main id="main" class="directory-main">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${ORIGIN}/">MCP Leaderboard</a><span>/</span><span>Page ${page}</span></nav>
    <section class="ranking-page"><header><p class="eyebrow">The live ranking · page ${page} of ${pageCount}</p><h1>MCP servers ranked ${firstRank}-${lastRank}.</h1><p>${description}</p></header><div class="full-board-wrap"><div class="table-scroll"><table class="full-board"><thead><tr><th scope="col" class="fb-rank">#</th><th scope="col">MCP server (npm)</th><th scope="col">score</th><th scope="col">agent-readiness</th><th scope="col">key checks</th></tr></thead><tbody>${rankingRows(results, start)}</tbody></table></div></div>${pagination(page)}</section>
  </main>
  ${pageFooter}
</body>
</html>\n`;
  write(join("site", "rankings", String(page), "index.html"), document);
}

const sitemapUrls = [
  `${ORIGIN}/`,
  ...Array.from({ length: pageCount - 1 }, (_, index) => `${ORIGIN}/rankings/${index + 2}`),
  ...scored.map((result) => serverUrl(result.npm))
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <url><loc>${xmlEsc(url)}</loc><lastmod>${dateShort}</lastmod></url>`).join("\n")}
</urlset>\n`;
writeFileSync("site/sitemap.xml", sitemap);

const llms = `# MCP Leaderboard

> A public, neutral ranking of npm-installable Model Context Protocol servers by agent-readiness. Every score comes from mcp-scorecard booting the server over stdio and evaluating check-level evidence. Refreshed weekly by a fail-closed Grok Cloud routine; nothing is hand-edited.

Updated: ${data.generatedAt}
Corpus servers: ${data.counts.total}
Scored servers: ${data.counts.scored}
Unreachable servers: ${data.counts.unreachable}
Deferred servers: ${data.counts.deferred}

## Canonical resources

- Human-readable ranking: ${ORIGIN}/
- Complete agent-readable index: ${ORIGIN}/llms-full.txt
- Machine-readable dataset: ${ORIGIN}/leaderboard.json
- Sitemap of canonical HTML pages: ${ORIGIN}/sitemap.xml
- Source and methodology: https://github.com/davidmosiah/mcp-leaderboard
- Scoring engine: https://github.com/davidmosiah/mcp-scorecard
- Corpus source: https://registry.modelcontextprotocol.io

## Interpretation

Agent-readiness measures whether an AI agent can discover tools, trust schemas and understand side effects without reading source code. It does not certify correctness or security. Unreachable means the server could not be graded fairly; it is not a low score.

## How to use

Fetch leaderboard.json for exhaustive structured results, or llms-full.txt for a compact ranked index with canonical scorecard pages. To score a package directly, run: npx -y mcp-scorecard <package-or-repo> --json
`;
writeFileSync("site/llms.txt", llms);

const llmsFull = `# MCP Leaderboard — complete ranked index

Generated: ${data.generatedAt}
Scoring engine: ${data.engine || "mcp-scorecard"}
Canonical dataset: ${ORIGIN}/leaderboard.json
Methodology: ${ORIGIN}/#method

Each entry links to a canonical HTML scorecard with visible check-level evidence. Scores measure agent-readiness, not correctness or security.

## Ranked MCP servers

${scored.map((result, index) => `${index + 1}. [${result.npm}](${serverUrl(result.npm)}) — ${result.score}/100; biggest gap: ${result.topGap || "none reported"}`).join("\n")}
`;
writeFileSync("site/llms-full.txt", llmsFull);

copyFileSync("data/leaderboard.json", "site/leaderboard.json");
console.log(`rendered site/ — ${scored.length} scorecards, ${pageCount} ranking pages, generated ${dateShort}`);
