(() => {
  const M = globalThis.LcModel;
  const site = globalThis.LcSite;
  const markId = 'elo-for-leetcode-panel';
  let route = null, host = null, generation = 0, inFlight = false;
  let current = null, lookedUp = false, syncing = false, dirty = false;
  let focusMode = false;
  let noteTimer = null;

  async function send(message) {
    const data = await chrome.runtime.sendMessage(message);
    if (!data || data.error) throw new Error(data?.error ?? 'Reload this LeetCode tab and try again.');
    return data;
  }

  async function syncHistory() {
    let id;
    try {
      ({ id } = await send({ type: 'syncStart' }));
      const { counts, daily } = await site.fetchHistory({
        progress: count => send({ type: 'syncProgress', id, count })
      });
      if (!Object.keys(counts).length) throw new Error('No judged submissions found. Check that you’re signed in to the correct account.');
      let catalog, tags;
      try { catalog = await site.fetchCatalog(); } catch { /* known ratings still work */ }
      try { tags = await site.fetchTags(); } catch { /* topic breakdowns are optional */ }
      await send({ type: 'syncFinish', id, history: counts, daily, catalog, tags });
    } catch (e) {
      if (!id) return;
      try {
        await send({ type: 'syncError', id, error: e?.message || 'Sync failed.' });
      } catch { /* worker may have been reloaded */ }
    } finally { syncing = false; }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'current') {
      respond(current?.problem && current.problem.slug === M.problemSlug(location.pathname) ? current : null);
    } else if (message?.type === 'startTabSync') {
      if (syncing) return respond({ error: 'A sync is already running on this tab.' });
      syncing = true;
      void syncHistory();
      respond({ ok: true });
    } else if (message?.type === 'importCollection') {
      site.fetchCollection(message.input).then(
        problems => respond({ problems }),
        err => respond({ error: err?.message || 'Could not import that collection.' }));
      return true;
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.history || changes.siteCatalog || changes.outcomes) { dirty = true; void tick(); listCache.clear(); }
    if (changes.ui) { focusMode = changes.ui.newValue?.focusMode === true; applyFocus(); }
  });

  function visible(node) {
    return node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  }

  function metadata() {
    const title = document.title.replace(/\s*[-–|]\s*LeetCode.*$/i, '').trim();
    const known = document.querySelectorAll('[class*="text-difficulty-"], [data-difficulty]');
    for (const el of known) {
      const tier = el.textContent.trim();
      if (/^(Easy|Medium|Hard)$/.test(tier) && visible(el)) return { title, tier };
    }
    const label = [...document.querySelectorAll('span, div')].find(el =>
      el.childElementCount === 0 && /^(Easy|Medium|Hard)$/.test(el.textContent.trim()) &&
      visible(el) && el.getBoundingClientRect().top < 440 &&
      !el.closest('a, button, [role="menu"], nav, header'));
    return { title, tier: label?.textContent.trim() };
  }

  const make = (tag, value) => {
    const el = document.createElement(tag);
    if (value != null) el.textContent = value;
    return el;
  };

  // ---- Focus mode: blur difficulty + topic tags until hovered --------------
  function applyFocus() {
    let el = document.getElementById('elo-focus-style');
    if (focusMode) {
      if (!el) { el = document.createElement('style'); el.id = 'elo-focus-style'; document.documentElement.appendChild(el); }
      el.textContent = '[class*="text-difficulty-"],[data-difficulty],a[href*="/tag/"]{filter:blur(6px)!important;transition:filter .12s}' +
        '[class*="text-difficulty-"]:hover,[data-difficulty]:hover,a[href*="/tag/"]:hover{filter:none!important}';
    } else if (el) el.remove();
  }

  function render(problem, outcome, stats, note) {
    const wasOpen = host?.shadowRoot?.querySelector('details')?.open ?? false;
    if (host) host.remove();
    host = document.createElement('aside');
    host.id = markId;
    host.setAttribute('aria-label', 'Elo for LeetCode');
    host.style.cssText = 'all:initial;position:fixed!important;z-index:2147483000!important;bottom:62px!important;right:18px!important';
    const root = host.attachShadow({ mode: 'open' });
    const style = make('style', `
      details{font:13px system-ui;color:#edf1fa;background:#171d28;border:1px solid #343e50;
        max-width:min(300px,calc(100vw - 36px));border-radius:12px;box-shadow:0 8px 24px #0005}
      summary{cursor:pointer;color:#b8f4d9;padding:9px 12px;font-weight:700}
      p{margin:0 0 8px;color:#bec8db} section{padding:2px 12px 12px}
      button{font:inherit;color:#edf1fa;background:#273348;border:1px solid #526178;border-radius:7px;
        cursor:pointer;padding:5px 7px;margin:0 4px 4px 0}
      button[aria-pressed="true"]{background:#24533f;border-color:#82dbb3}
      button:disabled{opacity:.5;cursor:default}
      textarea{width:100%;box-sizing:border-box;margin:2px 0 4px;background:#0f141d;color:#edf1fa;
        border:1px solid #343e50;border-radius:7px;font:inherit;padding:5px;resize:vertical}
      .mini{color:#8da0bd;font-size:11px}
      a.open{color:#b8f4d9}
    `);
    const details = document.createElement('details');
    details.open = wasOpen;
    const hint = problem.source === 'contest' ? 'Contest · ' : 'Estimate · ~';
    details.append(make('summary', hint + problem.rating));
    const panel = document.createElement('section');
    panel.append(make('p', problem.source === 'contest'
      ? 'ZeroTrac contest-derived rating.'
      : problem.tier + ' estimate' + (problem.acceptance != null
        ? ' · ' + (problem.acceptance * 100).toFixed(1) + '% acceptance.' : ' · tier only.')));
    if (problem.source !== 'contest') panel.append(make('p', 'Heuristic band: ' + problem.low + '–' + problem.high + '.'));
    if (stats) panel.append(make('p', 'Your history: ' + stats.submissions + ' submissions · ' + stats.accepted + ' accepted.'));
    panel.append(make('p', 'Log one independent practice outcome:'));
    const status = make('p', '');
    status.setAttribute('role', 'status');
    const buttons = [];
    for (const [key, label] of [['solved', 'Solved solo'], ['missed', 'Not solved'], [null, 'Clear']]) {
      const button = make('button', label);
      button.type = 'button';
      buttons.push([key, button]);
      button.onclick = async () => {
        for (const [, b] of buttons) b.disabled = true;
        try {
          const result = await send({ type: 'outcome', slug: problem.slug, outcome: key });
          update(result.outcome);
        } catch { status.textContent = 'Could not save. Reload and try again.'; }
        finally { for (const [, b] of buttons) b.disabled = false; }
      };
      panel.append(button);
    }
    function update(value) {
      status.textContent = value === 'solved' ? 'Saved: solved independently.'
        : value === 'missed' ? 'Saved: not solved.' : 'No outcome logged.';
      for (const [key, button] of buttons) if (key) button.setAttribute('aria-pressed', String(key === value));
    }
    update(outcome);
    panel.append(status);

    // Notes, saved to this problem's memory.
    const noteWrap = document.createElement('details');
    noteWrap.append(make('summary', 'Notes'));
    const area = make('textarea');
    area.rows = 3;
    area.maxLength = 4000;
    area.placeholder = 'Approach, pattern, mistakes to avoid…';
    area.value = note || '';
    const noteStatus = make('p', '');
    noteStatus.className = 'mini';
    noteStatus.setAttribute('role', 'status');
    area.addEventListener('input', () => {
      clearTimeout(noteTimer);
      noteStatus.textContent = 'Saving…';
      noteTimer = setTimeout(async () => {
        try { await send({ type: 'setNote', slug: problem.slug, note: area.value }); noteStatus.textContent = 'Saved to this browser.'; }
        catch { noteStatus.textContent = 'Could not save.'; }
      }, 600);
    });
    const noteSection = make('section');
    noteSection.append(area, noteStatus);
    noteWrap.append(noteSection);
    panel.append(noteWrap);

    const tip = make('p', 'Alt+Shift+P panel · N next · R focus · S solved · X not solved');
    tip.className = 'mini';
    panel.append(tip);

    details.append(panel);
    root.append(style, details);
    document.body.append(host);
  }

  async function tick() {
    applyFocus();
    const next = M.problemSlug(location.pathname);
    if (next !== route) {
      route = next;
      generation++;
      host?.remove();
      host = null;
      current = null;
      lookedUp = false;
      dirty = false;
    }
    if (!route || (host?.isConnected && !dirty) || inFlight) return;
    dirty = false;
    const slug = route;
    const request = generation;
    inFlight = true;
    try {
      const { title, tier } = metadata();
      const stillHere = () => generation === request && slug === M.problemSlug(location.pathname);
      const display = data => {
        if (!stillHere() || !data?.problem) return;
        current = data;
        render(data.problem, data.outcome, data.stats, data.note);
      };
      const data = await send({ type: 'problem', slug, title, tier });
      display(data);
      const p = data.problem;
      if (stillHere() && !lookedUp && p?.source !== 'contest' &&
          (!p?.statsAt || Date.now() - p.statsAt > 86400000)) {
        lookedUp = true;
        const live = await site.fetchProblem(slug);
        if (live && stillHere()) display(await send({ type: 'problem', slug, ...live }));
      }
    } catch { /* extension may have reloaded while this tab was open */ }
    finally { inFlight = false; }
  }

  // ---- Rating chips in problem / company / study-plan lists ------------------
  const listCache = new Map();         // slug -> { rating, source, solved } | null
  let listPending = new Set();
  let listFlush = null;

  const isListPage = () => /^\/(problemset|problem-list|studyplan|company|tag|explore)\b/.test(location.pathname)
    || location.search.includes('favoriteSlug=') || location.search.includes('selectedList=');

  function chipFor(info) {
    const chip = make('span', info.source === 'contest' ? String(info.rating) : '~' + info.rating);
    chip.className = 'elo-chip';
    chip.style.cssText = 'display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;font:600 11px system-ui;' +
      'vertical-align:middle;color:' + (info.solved ? '#06281c' : '#0b1f16') + ';' +
      'background:' + (info.solved ? '#82dbb3' : '#b9e7d6') + ';border:1px solid #4aa985';
    chip.title = (info.source === 'contest' ? 'Contest rating' : 'Estimated rating') + (info.solved ? ' · solved' : '');
    return chip;
  }

  async function flushRatings() {
    const slugs = [...listPending].slice(0, 400);
    listPending = new Set([...listPending].slice(400));
    if (slugs.length) {
      try {
        const { ratings } = await send({ type: 'ratings', slugs });
        for (const [slug, info] of Object.entries(ratings)) listCache.set(slug, info);
      } catch { for (const s of slugs) listCache.set(s, null); }
    }
    paintChips();
    if (listPending.size) { listFlush = setTimeout(flushRatings, 200); } else listFlush = null;
  }

  function paintChips() {
    if (!isListPage()) return;
    for (const a of document.querySelectorAll('a[href^="/problems/"]:not([data-elo-done])')) {
      let slug;
      try { slug = M.problemSlug(new URL(a.href, location.origin).pathname); } catch { slug = null; }
      if (!slug) continue;
      if (a.closest('#' + markId)) continue;
      if (!listCache.has(slug)) { listPending.add(slug); continue; }
      a.dataset.eloDone = '1';
      const info = listCache.get(slug);
      if (info && !a.querySelector('.elo-chip')) a.append(chipFor(info));
    }
    if (listPending.size && !listFlush) listFlush = setTimeout(flushRatings, 120);
  }

  // ---- Keyboard shortcuts (Alt+Shift+key) ------------------------------------
  function editable(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest?.('.monaco-editor'));
  }
  async function markCurrent(outcome) {
    if (!current?.problem) return;
    try { await send({ type: 'outcome', slug: current.problem.slug, outcome }); dirty = true; void tick(); } catch { /* ignore */ }
  }
  async function openNext() {
    try {
      const { recommendations } = await send({ type: 'dashboard', band: 'near' });
      if (recommendations?.[0]) location.href = M.problemUrl(recommendations[0].slug);
    } catch { /* ignore */ }
  }
  document.addEventListener('keydown', e => {
    if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey || editable(e.target)) return;
    const key = e.key.toLowerCase();
    if (!['p', 'n', 'r', 's', 'x'].includes(key)) return;
    e.preventDefault();
    if (key === 'p') { const d = host?.shadowRoot?.querySelector('details'); if (d) d.open = !d.open; }
    else if (key === 'n') void openNext();
    else if (key === 'r') { focusMode = !focusMode; applyFocus(); void send({ type: 'setFocus', on: focusMode }).catch(() => {}); }
    else if (key === 's') void markCurrent('solved');
    else if (key === 'x') void markCurrent('missed');
  }, true);

  // Boot.
  send({ type: 'getUi' }).then(ui => { focusMode = ui?.ui?.focusMode === true; applyFocus(); }).catch(() => {});
  tick();
  paintChips();
  const observer = new MutationObserver(() => { paintChips(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // LeetCode uses same-document navigation. No DOM scan while a badge is mounted.
  setInterval(tick, 850);
})();
