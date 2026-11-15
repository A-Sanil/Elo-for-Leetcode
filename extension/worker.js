importScripts('config.js', 'model.js', 'data/seed.js', 'data/contest.js', 'data/roadmap.js');

const M = globalThis.LcModel;
const CFG = globalThis.LcConfig;
const contest = globalThis.LcContest.problems;
const roadmap = globalThis.LcRoadmap;
let queue = Promise.resolve();
const defaults = { local: {}, outcomes: {}, siteCatalog: {}, history: {}, daily: {}, recentSolves: [],
  notes: {}, goal: null, roadmaps: {}, ui: { focusMode: false }, sync: null };

function metaOf(value) {
  if (!value || !Object.hasOwn(CFG.tiers, value.tier)) return null;
  const meta = { title: typeof value.title === 'string' ? value.title.trim().slice(0, 180) : '',
    tier: value.tier, paid: value.paid === true };
  if (Array.isArray(value.tags)) {
    const tags = [...new Set(value.tags.filter(t => M.validSlug(t)))].slice(0, 12);
    if (tags.length) meta.tags = tags;
  }
  if (Number.isSafeInteger(value.acceptedCount) && Number.isSafeInteger(value.submissionCount) &&
      value.acceptedCount >= 0 && value.acceptedCount <= value.submissionCount && value.submissionCount > 0) {
    Object.assign(meta, { acceptedCount: value.acceptedCount, submissionCount: value.submissionCount,
      statsAt: Number.isFinite(value.statsAt) ? value.statsAt : Date.now() });
  }
  return meta;
}

function mergeCatalog(siteCatalog, local, history) {
  const catalog = { ...globalThis.LcSeed };
  for (const topic of roadmap.topics) {
    for (const p of topic.problems) {
      if (!Object.hasOwn(catalog, p.slug) && Object.hasOwn(CFG.tiers, p.difficulty)) {
        catalog[p.slug] = { title: p.title, tier: p.difficulty, ...(p.premium ? { paid: true } : {}) };
      }
    }
  }
  for (const [slug, item] of Object.entries(history)) {
    if (!Object.hasOwn(catalog, slug) && Object.hasOwn(CFG.tiers, item.tier)) {
      catalog[slug] = { title: item.title, tier: item.tier };
    }
  }
  Object.assign(catalog, siteCatalog);
  for (const [slug, item] of Object.entries(local)) {
    const old = Object.hasOwn(catalog, slug) ? catalog[slug] : null;
    if (!old || (item.statsAt ?? 0) >= (old.statsAt ?? 0)) catalog[slug] = { ...old, ...item };
  }
  return catalog;
}

function cleanHistory(raw) {
  const clean = {};
  for (const [key, item] of Object.entries(raw ?? {})) {
    if (!M.validSlug(key) || !Number.isSafeInteger(item?.submissions) || item.submissions < 1 ||
        !Number.isSafeInteger(item.accepted) || item.accepted < 0 || item.accepted > item.submissions) continue;
    if (item.accepted > 0 && (!Number.isSafeInteger(item.firstAcceptedAttempt) ||
        item.firstAcceptedAttempt < 1 || item.firstAcceptedAttempt > item.submissions)) continue;
    const time = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    clean[key] = { submissions: item.submissions, accepted: item.accepted,
      firstAcceptedAttempt: item.accepted ? item.firstAcceptedAttempt : null,
      firstTime: time(item.firstTime), firstACTime: time(item.firstACTime), lastTime: time(item.lastTime),
      title: typeof item.title === 'string' ? item.title.slice(0, 180) : key,
      ...(Object.hasOwn(CFG.tiers, item.tier) ? { tier: item.tier } : {}) };
  }
  return clean;
}

function cleanDaily(raw) {
  const clean = {};
  const count = v => (Number.isSafeInteger(v) && v >= 0 && v < 1e7 ? v : 0);
  for (const [key, item] of Object.entries(raw ?? {})) {
    if (!M.validDay(key) || !item) continue;
    clean[key] = { submissions: count(item.submissions), solved: count(item.solved), attempted: count(item.attempted) };
  }
  return clean;
}

async function refreshBadge() {
  try {
    const { daily, goal } = await chrome.storage.local.get({ daily: {}, goal: null });
    const today = daily[M.todayKey()] || { solved: 0 };
    const target = goal?.perDay ?? CFG.goalPerDay;
    await chrome.action.setBadgeText({ text: today.solved > 0 ? String(today.solved) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: today.solved >= target ? '#16a34a' : '#475569' });
  } catch { /* action API unavailable in this context */ }
}

async function run(message, sender) {
  const { type, slug } = message;
  const stateOnly = ['syncState', 'syncStart', 'syncProgress', 'syncError'].includes(type);
  const stored = await chrome.storage.local.get(stateOnly ? { sync: null } : defaults);
  const { local, outcomes, siteCatalog, history, daily, recentSolves, notes, goal, roadmaps, ui, sync } = stored;

  if (type === 'syncState') {
    if (sync?.state === 'running' && Date.now() - sync.updatedAt > 90000) {
      const stopped = { state: 'error', message: 'The sync was interrupted. Restart it from a LeetCode tab.' };
      await chrome.storage.local.set({ sync: stopped });
      return stopped;
    }
    return sync ?? { state: 'idle' };
  }
  if (type === 'syncStart' && sender.tab?.id != null) {
    if (sync?.state === 'running' && Date.now() - sync.updatedAt < 90000) return { error: 'A sync is already running.' };
    const next = { state: 'running', id: crypto.randomUUID(), tab: sender.tab.id, count: 0, source: message.source === 'recent' ? 'recent' : 'history', updatedAt: Date.now() };
    await chrome.storage.local.set({ sync: next });
    return { id: next.id };
  }
  if (['syncProgress', 'syncFinish', 'recentFinish', 'syncError'].includes(type)) {
    if (sync?.state !== 'running' || sync.id !== message.id || sync.tab !== sender.tab?.id) return { error: 'Sync is no longer active.' };
    if (type === 'syncProgress') {
      await chrome.storage.local.set({ sync: { ...sync, count: Number(message.count) || 0, updatedAt: Date.now() } });
    } else if (type === 'syncError') {
      await chrome.storage.local.set({ sync: { state: 'error', message: String(message.error).slice(0, 250) } });
    } else if (type === 'recentFinish') {
      if (sync.source !== 'recent' || !Array.isArray(message.slugs) || !message.slugs.length ||
          message.slugs.length > 20 || !message.slugs.every(M.validSlug)) throw new Error('Invalid public recent-solves list.');
      const slugs = [...new Set(message.slugs)];
      await chrome.storage.local.set({ recentSolves: slugs,
        sync: { state: 'done', source: 'recent', count: slugs.length, updatedAt: Date.now() } });
    } else {
      if (sync.source !== 'history') throw new Error('Invalid full history import.');
      const clean = cleanHistory(message.history);
      if (!Object.keys(clean).length) throw new Error('No recognized submissions found on this account.');
      const metadata = { ...siteCatalog };
      for (const [key, value] of Object.entries(message.catalog ?? {})) {
        const meta = metaOf(value);
        if (meta && M.validSlug(key)) metadata[key] = meta;
      }
      for (const [key, tags] of Object.entries(message.tags ?? {})) {
        if (!M.validSlug(key) || !Array.isArray(tags)) continue;
        const good = [...new Set(tags.filter(t => M.validSlug(t)))].slice(0, 12);
        if (good.length && metadata[key]) metadata[key] = { ...metadata[key], tags: good };
      }
      await chrome.storage.local.set({ history: clean, daily: cleanDaily(message.daily),
        siteCatalog: metadata, sync: { state: 'done',
          count: Object.values(clean).reduce((sum, item) => sum + item.submissions, 0),
          catalogLoaded: Boolean(message.catalog), tagsLoaded: Boolean(message.tags && Object.keys(message.tags).length),
          updatedAt: Date.now() } });
      await refreshBadge();
    }
    return { ok: true };
  }
  if (type === 'clearHistory') {
    if (sync?.state === 'running' && Date.now() - sync.updatedAt < 90000) throw new Error('Wait for the current sync to finish.');
    await chrome.storage.local.set({ history: {}, daily: {}, recentSolves: [], sync: null });
    await refreshBadge();
    return { ok: true };
  }

  const catalog = mergeCatalog(siteCatalog, local, history);

  if (type === 'problem' && M.validSlug(slug)) {
    const meta = metaOf(message);
    if (meta && !Object.hasOwn(contest, slug)) {
      const old = Object.hasOwn(catalog, slug) ? catalog[slug] : null;
      if (!meta.statsAt && old?.statsAt) {
        // A DOM tag has less information than stored acceptance stats.
      } else {
        meta.title ||= old?.title || slug.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' ');
        if (!meta.tags && old?.tags) meta.tags = old.tags;
        if (JSON.stringify(meta) !== JSON.stringify(old)) {
          catalog[slug] = local[slug] = meta;
          await chrome.storage.local.set({ local });
        }
      }
    }
    return { problem: M.resolve(slug, contest, catalog, CFG),
      outcome: Object.hasOwn(outcomes, slug) ? outcomes[slug] : null,
      stats: Object.hasOwn(history, slug) ? history[slug] : null,
      recentSolve: recentSolves.includes(slug),
      note: notes[slug] || '' };
  }

  if (type === 'outcome' && M.resolve(slug, contest, catalog, CFG)) {
    if (message.outcome === null) delete outcomes[slug];
    else if (['solved', 'missed'].includes(message.outcome)) outcomes[slug] = message.outcome;
    else throw new Error('Invalid outcome.');
    await chrome.storage.local.set({ outcomes });
    return { outcome: Object.hasOwn(outcomes, slug) ? outcomes[slug] : null };
  }

  if (type === 'setNote' && M.validSlug(slug)) {
    const text = typeof message.note === 'string' ? message.note.trim().slice(0, 4000) : '';
    if (text) notes[slug] = text; else delete notes[slug];
    await chrome.storage.local.set({ notes });
    return { ok: true, note: notes[slug] || '' };
  }

  if (type === 'ratings' && Array.isArray(message.slugs)) {
    const out = {};
    for (const s of message.slugs.slice(0, 500)) {
      if (!M.validSlug(s) || Object.hasOwn(out, s)) continue;
      const item = M.resolve(s, contest, catalog, CFG);
      out[s] = item ? { rating: item.rating, source: item.source,
        solved: Object.hasOwn(outcomes, s) ? outcomes[s] === 'solved' : (history[s]?.accepted > 0 || recentSolves.includes(s)) } : null;
    }
    return { ratings: out };
  }

  if (type === 'getUi') {
    return { ui: ui || { focusMode: false }, goal: { perDay: goal?.perDay ?? CFG.goalPerDay } };
  }
  if (type === 'setFocus') {
    const next = { ...(ui || {}), focusMode: message.on === true };
    await chrome.storage.local.set({ ui: next });
    return { ok: true, ui: next };
  }
  if (type === 'setGoal') {
    const perDay = Number(message.perDay);
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > 100) throw new Error('Goal must be 1–100.');
    await chrome.storage.local.set({ goal: { perDay } });
    await refreshBadge();
    return { ok: true, goal: { perDay } };
  }

  if (type === 'summary') {
    const counts = Object.values(history);
    const streak = M.streaks(daily);
    return { streak, today: streak.today, goal: { perDay: goal?.perDay ?? CFG.goalPerDay },
      solvedTotal: counts.filter(h => h.accepted > 0).length,
      level: M.levelFor(outcomes, contest, catalog, CFG, history, recentSolves) };
  }

  if (type === 'dashboard') {
    const level = M.levelFor(outcomes, contest, catalog, CFG, history, recentSolves);
    const attempted = { ...history, ...outcomes };
    for (const key of recentSolves) attempted[key] = true;
    const counts = Object.values(history);
    return { level, recommendations: M.recommend(level, message.band, attempted, contest, catalog, CFG),
      history: { solved: counts.filter(h => h.accepted > 0).length, count: counts.length,
        submissions: counts.reduce((sum, h) => sum + h.submissions, 0), recentSolved: recentSolves.length },
      catalogSize: new Set([...Object.keys(contest), ...Object.keys(catalog)]).size };
  }

  if (type === 'dashboardData') {
    const rows = M.memoryRows({ history, outcomes, notes, recentSolves }, contest, catalog, CFG);
    const level = M.levelFor(outcomes, contest, catalog, CFG, history, recentSolves);
    return { rows, daily, goal: { perDay: goal?.perDay ?? CFG.goalPerDay }, level,
      roadmaps: Object.entries(roadmaps).map(([id, r]) => ({ id, name: r.name, slugs: r.slugs, createdAt: r.createdAt })),
      catalogSize: new Set([...Object.keys(contest), ...Object.keys(catalog)]).size };
  }

  if (type === 'createRoadmap') {
    const name = typeof message.name === 'string' ? message.name.trim().slice(0, 80) : '';
    const problems = Array.isArray(message.problems) ? message.problems : [];
    if (!name) throw new Error('Name the roadmap.');
    const slugs = [];
    for (const p of problems.slice(0, 1000)) {
      if (!M.validSlug(p?.slug) || slugs.includes(p.slug)) continue;
      slugs.push(p.slug);
      const meta = metaOf(p);
      if (meta && !Object.hasOwn(contest, p.slug) && !Object.hasOwn(local, p.slug)) local[p.slug] = meta;
    }
    if (!slugs.length) throw new Error('No known problems to add.');
    const id = crypto.randomUUID();
    roadmaps[id] = { name, slugs, createdAt: Date.now() };
    await chrome.storage.local.set({ roadmaps, local });
    return { ok: true, id };
  }
  if (type === 'deleteRoadmap') {
    if (Object.hasOwn(roadmaps, message.id)) { delete roadmaps[message.id]; await chrome.storage.local.set({ roadmaps }); }
    return { ok: true };
  }

  if (type === 'import' && typeof message.text === 'string') {
    let added = 0, existing = 0, unknown = 0;
    for (const key of M.inputSlugs(message.text.slice(0, 200000))) {
      if (!M.resolve(key, contest, catalog, CFG)) unknown++;
      else if (Object.hasOwn(outcomes, key)) existing++;
      else { outcomes[key] = 'solved'; added++; }
    }
    if (added) await chrome.storage.local.set({ outcomes });
    return { added, existing, unknown };
  }

  if (type === 'exportAll') {
    return { version: 2, exportedAt: Date.now(),
      data: { local, outcomes, siteCatalog, history, daily, recentSolves, notes, goal, roadmaps, ui } };
  }
  if (type === 'restore') {
    const data = message.data && typeof message.data === 'object' ? message.data : null;
    if (!data) throw new Error('Nothing to restore.');
    const next = {};
    if (data.history) next.history = cleanHistory(data.history);
    if (data.daily) next.daily = cleanDaily(data.daily);
    if (Array.isArray(data.recentSolves)) next.recentSolves = [...new Set(data.recentSolves.filter(M.validSlug))].slice(0, 20);
    if (data.outcomes && typeof data.outcomes === 'object') {
      next.outcomes = {};
      for (const [k, v] of Object.entries(data.outcomes)) if (M.validSlug(k) && ['solved', 'missed'].includes(v)) next.outcomes[k] = v;
    }
    if (data.notes && typeof data.notes === 'object') {
      next.notes = {};
      for (const [k, v] of Object.entries(data.notes)) if (M.validSlug(k) && typeof v === 'string') next.notes[k] = v.slice(0, 4000);
    }
    if (data.siteCatalog && typeof data.siteCatalog === 'object') {
      next.siteCatalog = {};
      for (const [k, v] of Object.entries(data.siteCatalog)) { const m = metaOf(v); if (m && M.validSlug(k)) next.siteCatalog[k] = m; }
    }
    if (data.local && typeof data.local === 'object') {
      next.local = {};
      for (const [k, v] of Object.entries(data.local)) { const m = metaOf(v); if (m && M.validSlug(k)) next.local[k] = m; }
    }
    if (data.roadmaps && typeof data.roadmaps === 'object') {
      next.roadmaps = {};
      for (const [id, r] of Object.entries(data.roadmaps)) {
        if (!/^[a-z0-9-]{1,80}$/.test(id) || !r || typeof r.name !== 'string' || !Array.isArray(r.slugs)) continue;
        next.roadmaps[id] = { name: r.name.slice(0, 80), slugs: r.slugs.filter(s => M.validSlug(s)).slice(0, 1000),
          createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now() };
      }
    }
    if (data.goal && Number.isInteger(data.goal.perDay) && data.goal.perDay >= 1 && data.goal.perDay <= 100) next.goal = { perDay: data.goal.perDay };
    if (data.ui && typeof data.ui === 'object') next.ui = { focusMode: data.ui.focusMode === true };
    await chrome.storage.local.set(next);
    await refreshBadge();
    return { ok: true, restored: Object.keys(next) };
  }

  throw new Error('Invalid request.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
  const task = queue.then(() => run(message, sender));
  queue = task.catch(() => {});
  task.then(result => respond(result), error => respond({ error: error?.message || 'Could not update practice data.' }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => { void refreshBadge(); });
chrome.runtime.onStartup?.addListener(() => { void refreshBadge(); });
void refreshBadge();
