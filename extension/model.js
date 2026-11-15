(() => {
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const validSlug = slug => typeof slug === 'string' && slug.length < 180 && slugPattern.test(slug);
  function problemSlug(pathname) {
    const match = /^\/problems\/([^/]+)(?:\/|$)/.exec(pathname);
    return match && validSlug(match[1]) ? match[1] : null;
  }

  const problemUrl = slug => 'https://leetcode.com/problems/' + slug + '/description/';

  function inputSlugs(text) {
    const result = new Set();
    for (const token of text.trim().split(/[\s,]+/)) {
      if (validSlug(token)) result.add(token);
      else {
        try {
          const url = new URL(token);
          const slug = problemSlug(url.pathname);
          if (url.protocol === 'https:' && url.hostname === 'leetcode.com' && slug) result.add(slug);
        } catch { /* ignore invalid tokens */ }
      }
    }
    return [...result];
  }

  function resolve(slug, contest, local, cfg) {
    if (!validSlug(slug)) return null;
    const meta = Object.hasOwn(local, slug) ? local[slug] : null;
    if (Object.hasOwn(contest, slug)) {
      const [title, rating] = contest[slug];
      return { slug, title, rating, source: 'contest', ...(meta?.tags ? { tags: meta.tags } : {}),
        ...(meta?.paid ? { paid: true } : {}) };
    }
    if (!meta || !Object.hasOwn(cfg.tiers, meta.tier)) return null;
    const base = { ...cfg.tiers[meta.tier], slug, title: meta.title, tier: meta.tier, source: 'estimate' };
    if (meta.paid) base.paid = true;
    if (meta.tags) base.tags = meta.tags;
    const n = meta.submissionCount;
    const ac = meta.acceptedCount;
    if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(ac) || ac < 0 || ac > n) return base;
    const anchor = cfg.acceptanceMidpoint[meta.tier];
    const rate = (ac + anchor * 500) / (n + 500);
    const odds = p => p / (1 - p);
    const delta = Math.max(-cfg.maxAcceptanceAdjustment, Math.min(cfg.maxAcceptanceAdjustment,
      cfg.acceptanceScale * Math.log2(odds(anchor) / odds(rate))));
    return { ...base, rating: Math.round((base.rating + delta) / 25) * 25,
      low: Math.round((base.low + delta) / 25) * 25, high: Math.round((base.high + delta) / 25) * 25,
      acceptance: ac / n, statsAt: meta.statsAt };
  }

  function chance(level, difficulty, cfg) {
    return 1 / (1 + 10 ** ((difficulty - level) / cfg.scale));
  }

  // Fit a regularized logistic model by bisection. The score derivative is monotonic.
  function levelFor(outcomes, contest, local, cfg, history = {}, recentSolves = []) {
    const samples = [];
    const recent = new Set(recentSolves);
    const slugs = new Set([...Object.keys(outcomes), ...Object.keys(history), ...recent]);
    for (const slug of slugs) {
      const item = resolve(slug, contest, local, cfg);
      if (!item) continue;
      const weight = item.source === 'contest' ? 1 : cfg.tierWeight;
      const outcome = Object.hasOwn(outcomes, slug) ? outcomes[slug] : null;
      if (outcome === 'solved' || outcome === 'missed') {
        samples.push({ rating: item.rating, y: Number(outcome === 'solved'), solved: outcome === 'solved', weight });
        continue;
      }
      const logged = history[slug];
      if (recent.has(slug) && !(logged?.accepted > 0)) {
        samples.push({ rating: item.rating, y: 1, solved: true, weight: weight * cfg.historyWeight, history: true });
        continue;
      }
      if (!logged || !logged.submissions) continue;
      const solved = logged.accepted > 0;
      // One contribution per problem. Later resubmits do not reduce first-solve credit.
      const y = solved ? Math.max(0.6, 1 - cfg.retryPenalty * Math.log2(logged.firstAcceptedAttempt || 1)) : 0;
      samples.push({ rating: item.rating, y, solved, weight: weight * cfg.historyWeight, history: true });
    }
    if (!samples.length) return null;
    let lo = cfg.minRating;
    let hi = cfg.maxRating;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      let slope = cfg.priorWeight * (0.5 - chance(mid, cfg.prior, cfg));
      for (const s of samples) slope += s.weight * (s.y - chance(mid, s.rating, cfg));
      if (slope > 0) lo = mid;
      else hi = mid;
    }
    const solved = samples.reduce((sum, sample) => sum + Number(sample.solved), 0);
    return { rating: Math.round((lo + hi) / 50) * 25, count: samples.length, solved,
      historyCount: samples.filter(sample => sample.history).length,
      provisional: samples.some(sample => sample.history) || samples.length < 12 || solved === 0 || solved === samples.length };
  }

  function recommend(level, band, outcomes, contest, local, cfg) {
    const offset = Object.hasOwn(cfg.recommendationOffsets, band) ? cfg.recommendationOffsets[band] : 0;
    const target = (level?.rating ?? cfg.prior) + offset;
    const pool = [...new Set([...Object.keys(contest), ...Object.keys(local)])];
    return pool
      .filter(slug => !Object.hasOwn(outcomes, slug))
      .map(slug => resolve(slug, contest, local, cfg))
      .filter(item => item && !item.paid)
      .sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target)
        || Number(b.source === 'contest') - Number(a.source === 'contest')
        || a.slug.localeCompare(b.slug))
      .slice(0, cfg.recommendationCount);
  }

  // ---- Calendar helpers -------------------------------------------------------
  // dayKey labels a timestamp with its LOCAL calendar day. Arithmetic treats those
  // labels as UTC midnights so day differences are exact regardless of time zone.
  function dayKey(tsSeconds, now) {
    const d = now instanceof Date ? now : new Date(tsSeconds * 1000);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  const validDay = key => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
  function parseDay(key) { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function shiftDay(key, n) {
    const d = new Date(parseDay(key) + n * 86400000);
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return d.getUTCFullYear() + '-' + m + '-' + day;
  }
  const dayDiff = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
  const todayKey = () => dayKey(0, new Date());

  // ---- Problem memory ---------------------------------------------------------
  // One row per problem the user has touched (synced history, a manual outcome, or a note).
  function memoryRows(stores, contest, catalog, cfg) {
    const history = stores.history || {};
    const outcomes = stores.outcomes || {};
    const notes = stores.notes || {};
    const recent = new Set(stores.recentSolves || []);
    const slugs = new Set([...Object.keys(history), ...Object.keys(outcomes), ...Object.keys(notes), ...recent]);
    const rows = [];
    for (const slug of slugs) {
      if (!validSlug(slug)) continue;
      const h = history[slug] || null;
      const item = resolve(slug, contest, catalog, cfg);
      const outcome = Object.hasOwn(outcomes, slug) ? outcomes[slug] : null;
      const tier = item?.tier || h?.tier || null;
      const accepted = h?.accepted || 0;
      const solved = outcome ? outcome === 'solved' : accepted > 0 || recent.has(slug);
      rows.push({
        slug,
        title: item?.title || h?.title || slug,
        tier,
        rating: item?.rating ?? null,
        source: item?.source || (h ? 'history' : 'manual'),
        paid: item?.paid === true,
        tags: item?.tags || [],
        acceptance: item?.acceptance ?? null,
        submissions: h?.submissions || 0,
        accepted,
        publicSolve: recent.has(slug),
        firstAcceptedAttempt: h?.firstAcceptedAttempt ?? null,
        firstTime: h?.firstTime || 0,
        firstACTime: h?.firstACTime || 0,
        lastTime: h?.lastTime || 0,
        outcome,
        solved,
        note: notes[slug] || ''
      });
    }
    rows.sort((a, b) => (b.lastTime || b.firstACTime || 0) - (a.lastTime || a.firstACTime || 0)
      || a.slug.localeCompare(b.slug));
    return rows;
  }

  // The activity date a row is counted under: its solve day, else its last-attempt day.
  const rowDay = row => {
    const ts = row.solved ? (row.firstACTime || row.lastTime) : (row.lastTime || row.firstACTime);
    return ts ? dayKey(ts) : null;
  };

  function queryMemory(rows, filters = {}) {
    const f = filters || {};
    const text = (f.text || '').trim().toLowerCase();
    const out = rows.filter(row => {
      if (f.tier && row.tier !== f.tier) return false;
      if (f.topic && !row.tags.includes(f.topic)) return false;
      if (f.status === 'solved' && !row.solved) return false;
      if (f.status === 'attempted' && (row.solved || !(row.submissions > 0 || row.outcome === 'missed'))) return false;
      if (f.status === 'unsolved' && row.solved) return false;
      if (Number.isFinite(f.minRating) && !(Number.isFinite(row.rating) && row.rating >= f.minRating)) return false;
      if (Number.isFinite(f.maxRating) && !(Number.isFinite(row.rating) && row.rating <= f.maxRating)) return false;
      if (f.from || f.to) {
        const day = rowDay(row);
        if (!day) return false;
        if (f.from && validDay(f.from) && dayDiff(f.from, day) < 0) return false;
        if (f.to && validDay(f.to) && dayDiff(day, f.to) < 0) return false;
      }
      if (text) {
        const hay = (row.title + ' ' + row.slug + ' ' + row.tags.join(' ') + ' ' + row.note).toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
    return { rows: out, count: out.length, solved: out.filter(r => r.solved).length };
  }

  // ---- Aggregates for the graphs ---------------------------------------------
  function streaks(daily, today = todayKey()) {
    const map = daily || {};
    const solvedDays = Object.keys(map).filter(k => validDay(k) && map[k] && map[k].solved > 0).sort();
    let longest = 0, run = 0, prev = null;
    for (const key of solvedDays) {
      run = (prev && dayDiff(prev, key) === 1) ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = key;
    }
    let current = 0;
    let anchor = (map[today] && map[today].solved > 0) ? today : shiftDay(today, -1);
    while (map[anchor] && map[anchor].solved > 0) { current++; anchor = shiftDay(anchor, -1); }
    const activeDays = Object.keys(map).filter(k => validDay(k) && map[k] &&
      (map[k].solved > 0 || map[k].submissions > 0)).length;
    const todayStats = map[today] || { solved: 0, submissions: 0, attempted: 0 };
    return { current, longest, activeDays, today: { solved: todayStats.solved || 0, submissions: todayStats.submissions || 0 } };
  }

  // Dense daily series over the last `weeks*7` days, ending today. Good for a heatmap grid.
  function heatmap(daily, weeks, today = todayKey()) {
    const map = daily || {};
    const span = Math.max(1, weeks | 0) * 7;
    const start = shiftDay(today, -(span - 1));
    const cells = [];
    let max = 0;
    for (let i = 0; i < span; i++) {
      const key = shiftDay(start, i);
      const d = map[key] || {};
      const solved = d.solved || 0;
      if (solved > max) max = solved;
      cells.push({ date: key, solved, submissions: d.submissions || 0 });
    }
    return { cells, max, start, end: today };
  }

  function cumulativeSolved(daily) {
    const map = daily || {};
    const keys = Object.keys(map).filter(k => validDay(k) && map[k] &&
      (map[k].solved > 0 || map[k].submissions > 0)).sort();
    let total = 0;
    return keys.map(date => {
      total += map[date].solved || 0;
      return { date, solved: map[date].solved || 0, submissions: map[date].submissions || 0, cumulative: total };
    });
  }

  function topicBreakdown(rows) {
    const map = new Map();
    for (const row of rows) {
      for (const tag of row.tags) {
        const e = map.get(tag) || { tag, total: 0, solved: 0 };
        e.total++;
        if (row.solved) e.solved++;
        map.set(tag, e);
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
  }

  function difficultyBreakdown(rows) {
    const out = { Easy: { solved: 0, total: 0 }, Medium: { solved: 0, total: 0 }, Hard: { solved: 0, total: 0 } };
    for (const row of rows) {
      const bucket = out[row.tier];
      if (!bucket) continue;
      bucket.total++;
      if (row.solved) bucket.solved++;
    }
    return out;
  }

  function ratingBuckets(rows, cfg) {
    const width = cfg.ratingBucket || 200;
    const map = new Map();
    for (const row of rows) {
      if (!Number.isFinite(row.rating)) continue;
      const min = Math.floor(row.rating / width) * width;
      const e = map.get(min) || { min, max: min + width, label: min + '–' + (min + width), count: 0, solved: 0 };
      e.count++;
      if (row.solved) e.solved++;
      map.set(min, e);
    }
    return [...map.values()].sort((a, b) => a.min - b.min);
  }

  // ---- Weakness-aware coaching -----------------------------------------------
  // Topics ranked by low solve-rate with enough attempts to matter.
  function weakTopics(rows, minSeen = 3) {
    return topicBreakdown(rows)
      .filter(t => t.total >= minSeen)
      .map(t => ({ ...t, rate: t.solved / t.total }))
      .sort((a, b) => a.rate - b.rate || b.total - a.total);
  }

  // ---- Roadmap progress -------------------------------------------------------
  function problemStatus(slug, history, outcomes) {
    const outcome = Object.hasOwn(outcomes, slug) ? outcomes[slug] : null;
    if (outcome === 'solved') return 'solved';
    if (outcome === 'missed') return 'attempted';
    const h = history[slug];
    if (h && h.accepted > 0) return 'solved';
    if (h && h.submissions > 0) return 'attempted';
    return 'todo';
  }

  function roadmapProgress(roadmap, history = {}, outcomes = {}) {
    const topics = (roadmap?.topics || []).map(topic => {
      const problems = topic.problems.map(p => ({ ...p, status: problemStatus(p.slug, history, outcomes) }));
      const solved = problems.filter(p => p.status === 'solved').length;
      const attempted = problems.filter(p => p.status === 'attempted').length;
      return { id: topic.id, title: topic.title, icon: topic.icon, color: topic.color, phase: topic.phase,
        problems, solved, attempted, total: problems.length };
    });
    const total = topics.reduce((a, t) => a + t.total, 0);
    const solved = topics.reduce((a, t) => a + t.solved, 0);
    const attempted = topics.reduce((a, t) => a + t.attempted, 0);
    return { topics, overall: { solved, attempted, total } };
  }

  // Progress for a flat custom roadmap (a list of slugs).
  function listProgress(slugs, history = {}, outcomes = {}) {
    const problems = (slugs || []).filter(validSlug).map(slug => ({ slug, status: problemStatus(slug, history, outcomes) }));
    return { problems, solved: problems.filter(p => p.status === 'solved').length,
      attempted: problems.filter(p => p.status === 'attempted').length, total: problems.length };
  }

  globalThis.LcModel = {
    problemSlug, problemUrl, validSlug, validDay, inputSlugs, resolve, levelFor, recommend,
    dayKey, parseDay, shiftDay, dayDiff, todayKey,
    memoryRows, rowDay, queryMemory, streaks, heatmap, cumulativeSolved,
    topicBreakdown, difficultyBreakdown, ratingBuckets, weakTopics,
    problemStatus, roadmapProgress, listProgress
  };
  if (typeof module === 'object' && module.exports) module.exports = globalThis.LcModel;
})();
