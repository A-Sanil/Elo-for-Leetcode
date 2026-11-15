(() => {
  const M = globalThis.LcModel;
  const tiers = new Map([['1','Easy'], ['2','Medium'], ['3','Hard'], ['easy','Easy'], ['medium','Medium'], ['hard','Hard']]);
  const tierFor = value => tiers.get(String(value).toLowerCase());
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const pageSize = 20;
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
        : [401, 403].includes(response.status) ? 'LeetCode denied access. Check that you’re signed in on this tab.'
        : 'LeetCode returned HTTP ' + response.status + '.';
      throw new Error(hint);
    }
    if (!response.headers.get('content-type')?.includes('json')) {
      throw new Error('LeetCode did not return data. Check that you’re signed in and reload the tab.');
    }
    return response.json();
  }

  const tagSlugs = tags => Array.isArray(tags)
    ? [...new Set(tags.map(t => t && t.slug).filter(s => M.validSlug(s)))].slice(0, 12) : [];

  async function fetchProblem(slug, request = jsonRequest) {
    if (!M.validSlug(slug)) return null;
    const data = await request('/graphql/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query EloProblemStats($slug: String!) { question(titleSlug: $slug) { titleSlug title difficulty stats isPaidOnly topicTags { slug } } }',
        variables: { slug }
      })
    });
    const q = data?.data?.question;
    if (!q || q.titleSlug !== slug || !tierFor(q.difficulty)) return null;
    let stats = {};
    try { stats = JSON.parse(q.stats) ?? {}; } catch { /* no acceptance data */ }
    return { title: q.title, tier: tierFor(q.difficulty), acceptedCount: stats.totalAcceptedRaw,
      submissionCount: stats.totalSubmissionRaw, paid: q.isPaidOnly === true, tags: tagSlugs(q.topicTags),
      statsAt: Date.now() };
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

  // Best-effort topic tags for the whole problem set, paged. Degrades to {} on any failure
  // so a sync still succeeds without topic breakdowns.
  async function fetchTags({ request = jsonRequest, wait = pause, limit = 100, max = 6000 } = {}) {
    const query = 'query EloTags($skip: Int!, $limit: Int!) {' +
      ' problemsetQuestionListV2(categorySlug: "all-code-essentials", skip: $skip, limit: $limit,' +
      ' filters: { filterCombineType: ALL }) { hasMore questions { titleSlug topicTags { slug } } } }';
    const tags = Object.create(null);
    let skip = 0;
    for (let page = 0; page < Math.ceil(max / limit); page++) {
      let data;
      try {
        data = await request('/graphql/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { skip, limit } }) });
      } catch { return tags; }
      const list = data?.data?.problemsetQuestionListV2;
      if (!list || !Array.isArray(list.questions)) return tags;
      for (const q of list.questions) if (M.validSlug(q?.titleSlug)) tags[q.titleSlug] = tagSlugs(q.topicTags);
      if (!list.hasMore || !list.questions.length) return tags;
      skip += list.questions.length;
      await wait(350);
    }
    return tags;
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
    const ordered = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp || Number(a.id) - Number(b.id));
    const counts = Object.create(null);
    const daily = Object.create(null);
    const bump = (ts, field) => {
      if (!ts) return;
      const key = M.dayKey(ts);
      (daily[key] ??= { submissions: 0, solved: 0, attempted: 0 })[field]++;
    };
    let acceptedAttempts = 0;
    for (const row of ordered) {
      const item = counts[row.slug] ??= {
        title: typeof row.title === 'string' ? row.title.slice(0, 180) : row.slug,
        tier: row.tier, submissions: 0, accepted: 0, firstAcceptedAttempt: null,
        firstTime: 0, firstACTime: 0, lastTime: 0
      };
      item.submissions++;
      if (row.timestamp) {
        if (!item.firstTime) item.firstTime = row.timestamp;
        if (row.timestamp > item.lastTime) item.lastTime = row.timestamp;
      }
      bump(row.timestamp, 'submissions');
      if (row.win) {
        acceptedAttempts++;
        item.accepted++;
        if (item.firstAcceptedAttempt == null) {
          item.firstAcceptedAttempt = item.submissions;
          item.firstACTime = row.timestamp || 0;
        }
      }
    }
    // One solved/attempted tally per problem, on the day it was first solved (or first tried).
    for (const slug in counts) {
      const item = counts[slug];
      if (item.accepted > 0) bump(item.firstACTime, 'solved');
      else bump(item.firstTime, 'attempted');
    }
    return { counts, daily, total: unique.size, acceptedAttempts };
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

  // ---- Collection import (best-effort) ---------------------------------------
  // Parse a pasted LeetCode collection URL or bare slug into { type, id }.
  function parseCollection(input) {
    const token = String(input || '').trim();
    if (!token) return null;
    try {
      const url = new URL(token);
      if (url.hostname !== 'leetcode.com') return null;
      const fav = url.searchParams.get('favoriteSlug');
      if (fav) return { type: 'favorite', id: fav };
      const sel = url.searchParams.get('selectedList');
      if (sel) return { type: 'list', id: sel };
      let m = /^\/studyplan\/([^/]+)/.exec(url.pathname);
      if (m) return { type: 'favorite', id: m[1] };
      m = /^\/company\/([^/]+)/.exec(url.pathname);
      if (m) return { type: 'favorite', id: m[1] + '-all' };
      m = /^\/list\/([^/]+)/.exec(url.pathname);
      if (m) return { type: 'list', id: m[1] };
      return null;
    } catch { /* not a URL */ }
    return /^[A-Za-z0-9-]+$/.test(token) ? { type: 'favorite', id: token } : null;
  }

  async function fetchFavorite(id, request) {
    const query = 'query EloFavorite($favoriteSlug: String!, $limit: Int!, $skip: Int!) {' +
      ' favoriteQuestionList(favoriteSlug: $favoriteSlug, limit: $limit, skip: $skip)' +
      ' { hasMore questions { titleSlug title difficulty topicTags { slug } } } }';
    const out = [];
    let skip = 0;
    while (out.length < 1000) {
      const data = await request('/graphql/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { favoriteSlug: id, limit: 100, skip } }) });
      const list = data?.data?.favoriteQuestionList;
      if (!list) throw new Error('No list found for “' + id + '”. It may be private, premium, or misspelled.');
      for (const q of (list.questions || [])) {
        if (M.validSlug(q?.titleSlug)) out.push({ slug: q.titleSlug, title: q.title,
          tier: tierFor(q.difficulty) || undefined, tags: tagSlugs(q.topicTags) });
      }
      if (!list.hasMore) break;
      skip += 100;
    }
    return out;
  }

  async function fetchListDetail(id, request) {
    const data = await request('/list/api/get_question_detail/' + encodeURIComponent(id) + '/');
    const raw = data?.questions || data?.question_list || [];
    return raw.map(q => ({
      slug: q.stat?.question__title_slug || q.titleSlug || '',
      title: q.stat?.question__title || q.title || '',
      tier: tierFor(q.difficulty?.level) || tierFor(q.difficulty) || undefined, tags: []
    })).filter(p => M.validSlug(p.slug));
  }

  async function fetchCollection(input, request = jsonRequest) {
    const parsed = parseCollection(input);
    if (!parsed) throw new Error('Unrecognized collection. Paste a company list, study plan, or selectedList URL.');
    if (parsed.type === 'list') return fetchListDetail(parsed.id, request);
    try { return await fetchFavorite(parsed.id, request); }
    catch (err) {
      // A bare slug that is really a personal list can still work through the REST detail endpoint.
      try { const viaList = await fetchListDetail(parsed.id, request); if (viaList.length) return viaList; }
      catch { /* fall through to the original error */ }
      throw err;
    }
  }

  globalThis.LcSite = { fetchProblem, fetchCatalog, fetchTags, summarize, fetchHistory,
    parseCollection, fetchCollection };
  if (typeof module === 'object' && module.exports) module.exports = globalThis.LcSite;
})();
