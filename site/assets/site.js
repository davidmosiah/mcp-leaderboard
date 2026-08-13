document.documentElement.classList.add('reveal-enabled');

const revealItems = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(button.dataset.copy || '');
      button.textContent = 'Copied';
      button.classList.add('is-copied');
    } catch {
      button.textContent = 'Select the command';
    }
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove('is-copied');
    }, 1400);
  });
}

const tierClass = (score) => score >= 90 ? 'tier-a' : score >= 75 ? 'tier-b' : score >= 60 ? 'tier-c' : score >= 40 ? 'tier-d' : 'tier-f';
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const scorecardUrl = (npm) => '/servers/' + npm.split('/').map(encodeURIComponent).join('/');
const fmtDate = (iso) => {
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return iso; }
};

let searchCorpus = [];
const serverSearch = document.getElementById('server-search');
const searchResults = document.getElementById('search-results');

const renderSearchResults = () => {
  if (!serverSearch || !searchResults) return;
  const query = serverSearch.value.trim().toLowerCase();
  searchResults.replaceChildren();
  if (query.length < 2) return;

  const matches = searchCorpus
    .map((result, index) => ({ result, rank: index + 1 }))
    .filter(({ result }) => result.npm.toLowerCase().includes(query) || String(result.serverName || '').toLowerCase().includes(query))
    .sort((a, b) => {
      const aStarts = a.result.npm.toLowerCase().startsWith(query) ? 0 : 1;
      const bStarts = b.result.npm.toLowerCase().startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.rank - b.rank;
    })
    .slice(0, 8);

  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = 'No scored package matches this search.';
    searchResults.append(empty);
    return;
  }

  for (const { result, rank } of matches) {
    const link = document.createElement('a');
    link.className = 'search-result';
    link.href = scorecardUrl(result.npm);

    const rankNode = document.createElement('span');
    rankNode.className = 'search-result-rank';
    rankNode.textContent = `#${rank}`;
    const nameNode = document.createElement('span');
    nameNode.className = 'search-result-name';
    nameNode.textContent = result.npm;
    const scoreNode = document.createElement('strong');
    scoreNode.className = 'search-result-score';
    scoreNode.textContent = `${result.score}/100`;
    link.append(rankNode, nameNode, scoreNode);
    searchResults.append(link);
  }
};

serverSearch?.addEventListener('input', renderSearchResults);
serverSearch?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  serverSearch.value = '';
  renderSearchResults();
  serverSearch.blur();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  if (!serverSearch) return;
  event.preventDefault();
  serverSearch.focus();
});

fetch('/leaderboard.json', { cache: 'no-store' })
  .then((response) => response.ok ? response.json() : Promise.reject(response.status))
  .then((data) => {
    const scored = (data.results || [])
      .filter((result) => result.status === 'scored')
      .sort((a, b) => b.score - a.score || a.npm.localeCompare(b.npm));
    if (!scored.length) return;
    searchCorpus = scored;
    if (serverSearch?.value.trim()) renderSearchResults();

    const baked = document.body.dataset.generated || '';
    const live = data.generatedAt || '';
    if (!live || live <= baked) return;

    const tbody = document.getElementById('full-board-body');
    if (tbody) {
      tbody.innerHTML = scored.slice(0, 100).map((result, index) => {
        const rank = index + 1;
        const passes = result.checks.filter((check) => check.status === 'pass').map((check) => check.label).slice(0, 3);
        const fails = result.checks.filter((check) => check.status === 'fail').map((check) => check.label).slice(0, 2);
        const tags = passes.map((label) => `<span class="pass">+ ${esc(label)}</span>`).join('') +
          fails.map((label) => `<span class="fail">– ${esc(label)}</span>`).join('');
        return `<tr class="${rank <= 3 ? `top-${rank}` : ''}">
          <td class="fb-rank">${rank}</td>
          <td class="fb-srv"><a href="${scorecardUrl(result.npm)}">${esc(result.npm)}</a><small>${esc(result.serverName || 'View the complete scorecard')}</small></td>
          <td><span class="score-pill ${tierClass(result.score)}">${result.score}</span></td>
          <td><div class="bar"><i style="width:${result.score}%"></i></div></td>
          <td><div class="check-tags">${tags}</div></td>
        </tr>`;
      }).join('');
    }

    const counts = data.counts || {};
    const scores = scored.map((result) => result.score).sort((a, b) => a - b);
    const average = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    const median = scores.length % 2
      ? scores[Math.floor(scores.length / 2)]
      : Math.round((scores[(scores.length / 2) - 1] + scores[scores.length / 2]) / 2);
    const liveValues = {
      generated: fmtDate(live),
      scored: counts.scored ?? scored.length,
      total: counts.total ?? '',
      unreachable: counts.unreachable ?? '',
      average,
      median
    };
    for (const [key, value] of Object.entries(liveValues)) {
      document.querySelectorAll(`[data-live="${key}"]`).forEach((element) => { element.textContent = value; });
    }
    const coverage = document.getElementById('coverage-progress');
    if (coverage instanceof HTMLProgressElement && counts.total) {
      coverage.max = counts.total;
      coverage.value = counts.scored;
      coverage.textContent = `${Math.round((counts.scored / counts.total) * 100)}%`;
    }
  })
  .catch(() => {
    if (serverSearch?.value.trim().length >= 2 && searchResults) {
      const error = document.createElement('p');
      error.className = 'search-empty';
      error.textContent = 'Search is temporarily unavailable. The published table remains authoritative.';
      searchResults.replaceChildren(error);
    }
  });
