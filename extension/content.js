(() => {
  const M = globalThis.LcModel;
  const site = globalThis.LcSite;
  const markId = 'elo-for-leetcode-panel';
  let route = null, host = null, generation = 0, inFlight = false;
  let current = null, lookedUp = false, syncing = false, dirty = false;

  async function send(message) {
    const data = await chrome.runtime.sendMessage(message);
    if (!data || data.error) throw new Error(data?.error ?? 'Reload this LeetCode tab and try again.');
    return data;
  }

  async function syncHistory() {
    let id;
    try {
      ({ id } = await send({ type: 'syncStart' }));
      const { counts } = await site.fetchHistory({
        progress: count => send({ type: 'syncProgress', id, count })
      });
      if (!Object.keys(counts).length) throw new Error('No judged submissions found. Check that you’re signed in to the correct account.');
      let catalog;
      try { catalog = await site.fetchCatalog(); } catch { /* known ratings still work */ }
      await send({ type: 'syncFinish', id, history: counts, catalog });
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
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.history || changes.siteCatalog)) {
      dirty = true;
      void tick();
    }
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
    // Older layouts use a plain difficulty label beside the description header.
    const label = [...document.querySelectorAll('span, div')].find(el =>
      el.childElementCount === 0 && /^(Easy|Medium|Hard)$/.test(el.textContent.trim()) &&
      visible(el) && el.getBoundingClientRect().top < 440 &&
      !el.closest('a, button, [role="menu"], nav, header'));
    return { title, tier: label?.textContent.trim() };
  }

  const make = (tag, value) => {
    const el = document.createElement(tag);
    el.textContent = value;
    return el;
  };

  function render(problem, outcome, stats) {
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
    details.append(panel);
    root.append(style, details);
    document.body.append(host);
  }

  async function tick() {
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
        render(data.problem, data.outcome, data.stats);
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
  tick();
  // LeetCode uses same-document navigation. No DOM scan while a badge is mounted.
  setInterval(tick, 850);
})();
