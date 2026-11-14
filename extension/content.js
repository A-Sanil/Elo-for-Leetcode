(() => {
  const M = globalThis.LcModel;
  const markId = 'elo-for-leetcode-panel';
  let route = null, host = null, generation = 0, inFlight = false;

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

  function render(problem, outcome) {
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
    const hint = problem.source === 'contest' ? 'Contest · ' : 'Estimate · ~';
    details.append(make('summary', hint + problem.rating));
    const panel = document.createElement('section');
    panel.append(make('p', problem.source === 'contest'
      ? 'ZeroTrac contest-derived rating.'
      : problem.tier + ' tier estimate. Heuristic band: ' + problem.low + '–' + problem.high + '.'));
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
          const result = await chrome.runtime.sendMessage({ type: 'outcome', slug: problem.slug, outcome: key });
          if (!result || result.error) throw new Error();
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
    }
    if (!route || host?.isConnected || inFlight) return;
    const request = generation;
    inFlight = true;
    try {
      const { title, tier } = metadata();
      const data = await chrome.runtime.sendMessage({ type: 'problem', slug: route, title, tier });
      if (data?.problem && generation === request && data.problem.slug === M.problemSlug(location.pathname)) {
        render(data.problem, data.outcome);
      }
    } catch { /* extension may have reloaded while this tab was open */ }
    finally { inFlight = false; }
  }
  tick();
  // LeetCode uses same-document navigation. No DOM scan while a badge is mounted.
  setInterval(tick, 850);
})();
