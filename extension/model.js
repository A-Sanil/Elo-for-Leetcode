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
    if (Object.hasOwn(contest, slug)) {
      const [title, rating] = contest[slug];
      return { slug, title, rating, source: 'contest' };
    }
    const meta = Object.hasOwn(local, slug) ? local[slug] : null;
    if (!meta || !Object.hasOwn(cfg.tiers, meta.tier)) return null;
    return { ...cfg.tiers[meta.tier], slug, title: meta.title, tier: meta.tier, source: 'estimate' };
  }

  function chance(level, difficulty, cfg) {
    return 1 / (1 + 10 ** ((difficulty - level) / cfg.scale));
  }

  // Fit a regularized logistic model by bisection. The score derivative is monotonic.
  function levelFor(outcomes, contest, local, cfg) {
    const samples = [];
    for (const [slug, outcome] of Object.entries(outcomes)) {
      if (outcome !== 'solved' && outcome !== 'missed') continue;
      const item = resolve(slug, contest, local, cfg);
      if (item) samples.push({
        rating: item.rating,
        y: Number(outcome === 'solved'),
        weight: item.source === 'contest' ? 1 : cfg.tierWeight
      });
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
    const solved = samples.reduce((sum, sample) => sum + sample.y, 0);
    return { rating: Math.round((lo + hi) / 50) * 25, count: samples.length, solved,
      provisional: samples.length < 12 || solved === 0 || solved === samples.length };
  }

  function recommend(level, band, outcomes, contest, local, cfg) {
    const offset = Object.hasOwn(cfg.recommendationOffsets, band) ? cfg.recommendationOffsets[band] : 0;
    const target = (level?.rating ?? cfg.prior) + offset;
    const pool = [...new Set([...Object.keys(contest), ...Object.keys(local)])];
    return pool
      .filter(slug => !Object.hasOwn(outcomes, slug))
      .map(slug => resolve(slug, contest, local, cfg))
      .filter(Boolean)
      .sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target)
        || Number(b.source === 'contest') - Number(a.source === 'contest')
        || a.slug.localeCompare(b.slug))
      .slice(0, cfg.recommendationCount);
  }

  globalThis.LcModel = { problemSlug, problemUrl, validSlug, inputSlugs, resolve, levelFor, recommend };
  if (typeof module === 'object' && module.exports) module.exports = globalThis.LcModel;
})();
