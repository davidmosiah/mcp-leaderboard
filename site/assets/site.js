// Reveal-on-scroll
const revealItems = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    }
  }, { threshold: 0.14, rootMargin: '0px 0px -60px 0px' });
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

// Copy buttons
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(button.dataset.copy || '');
      button.textContent = 'Copied';
      button.classList.add('is-copied');
    } catch {
      button.textContent = 'Select text';
    }
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove('is-copied');
    }, 1400);
  });
}

// Progressive enhancement: refresh the rankings from the live /leaderboard.json.
// The server-rendered <table> rows are the source of truth; this only refreshes
// them when a newer dataset is served (e.g. after the weekly GitHub Action commit).
const tierClass = (s) => s >= 90 ? 'tier-a' : s >= 75 ? 'tier-b' : s >= 60 ? 'tier-c' : s >= 40 ? 'tier-d' : 'tier-f';

function fmtDate(iso) {
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return iso; }
}

fetch('/leaderboard.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((data) => {
    const baked = document.body.dataset.generated || '';
    const live = data.generatedAt || '';
    // Only repaint if the live file is newer than what was baked into the HTML.
    if (!live || live <= baked) return;

    const scored = (data.results || [])
      .filter((r) => r.status === 'scored')
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return;

    const tbody = document.getElementById('full-board-body');
    if (tbody) {
      tbody.innerHTML = scored.map((r, i) => {
        const rank = i + 1;
        const tc = tierClass(r.score);
        const passes = r.checks.filter((c) => c.status === 'pass').map((c) => c.label).slice(0, 3);
        const fails = r.checks.filter((c) => c.status === 'fail').map((c) => c.label).slice(0, 2);
        const tags = passes.map((p) => `<span class="pass">+ ${p}</span>`).join('') +
                     fails.map((f) => `<span class="fail">– ${f}</span>`).join('');
        const npmUrl = 'https://www.npmjs.com/package/' + encodeURIComponent(r.npm).replace('%40', '@').replace('%2F', '/');
        return `<tr class="${rank <= 3 ? 'top-' + rank : ''}">
          <td class="fb-rank">${rank}</td>
          <td class="fb-srv"><a href="${npmUrl}" target="_blank" rel="noopener">${r.npm}</a><small>${r.serverName || ''}</small></td>
          <td><span class="score-pill ${tc}">${r.score}</span></td>
          <td><div class="bar"><i style="width:${r.score}%;background:linear-gradient(90deg,var(--gold),var(--violet))"></i></div></td>
          <td><div class="check-tags">${tags}</div></td>
        </tr>`;
      }).join('');
    }

    // Refresh freshness meta strings.
    const c = data.counts || {};
    document.querySelectorAll('[data-live="generated"]').forEach((el) => { el.textContent = fmtDate(live); });
    document.querySelectorAll('[data-live="scored"]').forEach((el) => { el.textContent = c.scored ?? scored.length; });
    document.querySelectorAll('[data-live="total"]').forEach((el) => { el.textContent = c.total ?? ''; });
    document.querySelectorAll('[data-live="unreachable"]').forEach((el) => { el.textContent = c.unreachable ?? ''; });
  })
  .catch(() => { /* static rows remain the source of truth */ });
