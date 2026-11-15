(() => {
  const M = globalThis.LcModel;
  const tiers = new Map([['1','Easy'], ['2','Medium'], ['3','Hard'], ['easy','Easy'], ['medium','Medium'], ['hard','Hard']]);
  const tierFor = value => tiers.get(String(value).toLowerCase());
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const pageSize = 20;
  const recentLimit = 20;
  const maxPages = 1000;
  const accepted = /^accepted$/i;
  const failed = /^(wrong answer|time limit exceeded|memory limit exceeded|output limit exceeded|runtime error|compile error|compilation error|presentation error)$/i;

  async function jsonRequest(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(15000), ...options
    });
    if (!response.ok) {
      const hint = response.status === 429 ? 'LeetCode rate-limited the request. Wait before trying again.'
        : [401, 403].includes(response.status) ? 'LeetCode denied this request (HTTP ' + response.status + ').'
        : 'LeetCode returned HTTP ' + response.status + '.';
      throw Object.assign(new Error(hint), { status: response.status });
    }
    if (!response.headers.get('content-type')?.includes('json')) {
      throw new Error('LeetCode did not return data. Check that you’re signed in and reload the tab.');
    }
    return response.json();
  }

  async function fetchProblem(slug, request = jsonRequest) {
    if (!M.validSlug(slug)) return null;
    const data = await request('/graphql/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query EloProblemStats($slug: String!) { question(titleSlug: $slug) { titleSlug title difficulty stats isPaidOnly } }',
        variables: { slug }
      })
    });
    const q = data?.data?.question;
    if (!q || q.titleSlug !== slug || !tierFor(q.difficulty)) return null;
    let stats = {};
    try { stats = JSON.parse(q.stats) ?? {}; } catch { /* no acceptance data */ }
    return { title: q.title, tier: tierFor(q.difficulty), acceptedCount: stats.totalAcceptedRaw,
      submissionCount: stats.totalSubmissionRaw, paid: q.isPaidOnly === true, statsAt: Date.now() };
  }

  async function fetchCatalog(request = jsonRequest) {
    const data = await request('/api/problems/all/');
    if (!Array.isArray(data?.stat_status_pairs) || !data.stat_status_pairs.length) {
      throw new Error('LeetCode’s catalog did not contain problem metadata.');
    }
    const catalog = Object.create(null);
    for (const row of data.stat_status_pairs) {
      const s = row?.stat;
      const tier = tierFor(row?.difficulty?.level);
      if (!s || !M.validSlug(s.question__title_slug) || !tier || s.question__hide) continue;
      catalog[s.question__title_slug] = { title: s.question__title, tier, acceptedCount: s.total_acs,
        submissionCount: s.total_submitted, paid: row.paid_only === true, statsAt: Date.now() };
    }
    return catalog;
  }

  async function fetchRecentSolves(username, request = jsonRequest) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(username)) {
      throw new Error('Enter your LeetCode username, not a profile URL.');
    }
    // This public profile query is not an alternate route to private submission history.
    const data = await request('/graphql/', {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query EloRecentSolves($username: String!, $limit: Int!) { recentAcSubmissionList(username: $username, limit: $limit) { titleSlug } }',
        variables: { username, limit: recentLimit }
      })
    });
    const list = data?.data?.recentAcSubmissionList;
    if (data?.errors?.length || !Array.isArray(list) || list.length > recentLimit ||
        !list.every(row => M.validSlug(row?.titleSlug))) {
      throw new Error('LeetCode did not return a usable public recent-solves list. Saved data was kept.');
    }
    if (!list.length) throw new Error('No public recent solves found. Verify the username and profile visibility. Saved data was kept.');
    return [...new Set(list.map(row => row.titleSlug))];
  }

  function rowOf(row) {
    const slug = row?.title_slug;
    const id = String(row?.id ?? '');
    if (!M.validSlug(slug) || !/^\d+$/.test(id)) return null;
    const status = String(row.status_display ?? '').trim();
    const win = accepted.test(status) || Number(row.status) === 10;
    const loss = failed.test(status) || (!status && [11, 12, 13, 14, 15, 16].includes(Number(row.status)));
    if (!win && !loss) return null;
    const timestamp = Number(row.timestamp);
    return { id, slug, title: row.title, tier: tierFor(row.difficulty), win,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0 };
  }

  function summarize(rows) {
    const unique = new Map();
    for (const raw of rows) {
      const row = rowOf(raw);
      if (row && !unique.has(row.id)) unique.set(row.id, row);
    }
    const counts = Object.create(null);
    let acceptedAttempts = 0;
    for (const row of [...unique.values()].sort((a, b) => a.timestamp - b.timestamp || Number(a.id) - Number(b.id))) {
      const item = counts[row.slug] ??= {
        title: typeof row.title === 'string' ? row.title.slice(0, 180) : row.slug,
        tier: row.tier, submissions: 0, accepted: 0, firstAcceptedAttempt: null
      };
      item.submissions++;
      if (row.win) {
        acceptedAttempts++;
        item.accepted++;
        item.firstAcceptedAttempt ??= item.submissions;
      }
    }
    return { counts, total: unique.size, acceptedAttempts };
  }

  async function fetchHistory({ request = jsonRequest, progress = async () => {}, wait = pause } = {}) {
    const rows = [];
    const seen = new Set();
    let offset = 0;
    let previous = '';
    for (let page = 0; page < maxPages; page++) {
      const data = await request('/api/submissions/?offset=' + offset + '&limit=' + pageSize);
      const list = data?.submissions_dump;
      if (!Array.isArray(list) || typeof data.has_next !== 'boolean') {
        throw new Error('LeetCode returned an unexpected submission format. Your old history was kept.');
      }
      const fingerprint = list.map(row => row?.id).join(',');
      let newIds = 0;
      for (const row of list) {
        const id = row?.id == null ? null : String(row.id);
        if (id && !seen.has(id)) { seen.add(id); newIds++; }
        // Strip any unneeded fields immediately. Never keep code, runtime, memory, URLs, or credentials.
        rows.push({ id, title_slug: row?.title_slug, title: row?.title, difficulty: row?.difficulty,
          status: row?.status, status_display: row?.status_display, timestamp: row?.timestamp });
      }
      if ((data.has_next && (!list.length || !newIds)) || (page > 0 && list.length && fingerprint === previous)) {
        throw new Error('LeetCode repeated or interrupted a page of history. Your old history was kept.');
      }
      if (page % 3 === 0 || !data.has_next) await progress(seen.size);
      if (!data.has_next) return summarize(rows);
      previous = fingerprint;
      offset += list.length;
      await wait(400);
    }
    throw new Error('History exceeded the safety limit (20,000 rows). Your old history was kept.');
  }

  globalThis.LcSite = { fetchProblem, fetchCatalog, summarize, fetchHistory, fetchRecentSolves };
  if (typeof module === 'object' && module.exports) module.exports = globalThis.LcSite;
})();
