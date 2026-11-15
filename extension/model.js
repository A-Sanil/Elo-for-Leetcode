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
      return { slug, title, rating, source: 'contest', ...(meta?.paid ? { paid: true } : {}) };
    }
    if (!meta || !Object.hasOwn(cfg.tiers, meta.tier)) return null;
    const base = { ...cfg.tiers[meta.tier], slug, title: meta.title, tier: meta.tier, source: 'estimate' };
    if (meta.paid) base.paid = true;
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
      // A visible AC proves a solve, not how many attempts it took.
      // Use counted AC evidence when available, including its known retry penalty.
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

  globalThis.LcModel = { problemSlug, problemUrl, validSlug, inputSlugs, resolve, levelFor, recommend };
  if (typeof module === 'object' && module.exports) module.exports = globalThis.LcModel;
})();
