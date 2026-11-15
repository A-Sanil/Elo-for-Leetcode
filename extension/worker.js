importScripts('config.js', 'model.js', 'data/seed.js', 'data/contest.js');

const M = globalThis.LcModel;
const CFG = globalThis.LcConfig;
const contest = globalThis.LcContest.problems;
let queue = Promise.resolve();
const defaults = { local: {}, outcomes: {}, siteCatalog: {}, history: {}, sync: null };

function metaOf(value) {
  if (!value || !Object.hasOwn(CFG.tiers, value.tier)) return null;
  const meta = { title: typeof value.title === 'string' ? value.title.trim().slice(0, 180) : '',
    tier: value.tier, paid: value.paid === true };
  if (Number.isSafeInteger(value.acceptedCount) && Number.isSafeInteger(value.submissionCount) &&
      value.acceptedCount >= 0 && value.acceptedCount <= value.submissionCount && value.submissionCount > 0) {
    Object.assign(meta, { acceptedCount: value.acceptedCount, submissionCount: value.submissionCount,
      statsAt: Number.isFinite(value.statsAt) ? value.statsAt : Date.now() });
  }
  return meta;
}

function mergeCatalog(siteCatalog, local, history) {
  const catalog = { ...globalThis.LcSeed };
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

async function run(message, sender) {
  const { type, slug } = message;
  const stateOnly = ['syncState', 'syncStart', 'syncProgress', 'syncError', 'clearHistory'].includes(type);
  const stored = await chrome.storage.local.get(stateOnly ? { sync: null } : defaults);
  const { local, outcomes, siteCatalog, history, sync } = stored;
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
    const next = { state: 'running', id: crypto.randomUUID(), tab: sender.tab.id, count: 0, updatedAt: Date.now() };
    await chrome.storage.local.set({ sync: next });
    return { id: next.id };
  }
  if (['syncProgress', 'syncFinish', 'syncError'].includes(type)) {
    if (sync?.state !== 'running' || sync.id !== message.id || sync.tab !== sender.tab?.id) return { error: 'Sync is no longer active.' };
    if (type === 'syncProgress') {
      await chrome.storage.local.set({ sync: { ...sync, count: Number(message.count) || 0, updatedAt: Date.now() } });
    } else if (type === 'syncError') {
      await chrome.storage.local.set({ sync: { state: 'error', message: String(message.error).slice(0, 250) } });
    } else {
      const clean = {};
      for (const [key, item] of Object.entries(message.history ?? {})) {
        if (!M.validSlug(key) || !Number.isSafeInteger(item?.submissions) || item.submissions < 1 ||
            !Number.isSafeInteger(item.accepted) || item.accepted < 0 || item.accepted > item.submissions) continue;
        if (item.accepted > 0 && (!Number.isSafeInteger(item.firstAcceptedAttempt) ||
            item.firstAcceptedAttempt < 1 || item.firstAcceptedAttempt > item.submissions)) continue;
        clean[key] = { submissions: item.submissions, accepted: item.accepted,
          firstAcceptedAttempt: item.accepted ? item.firstAcceptedAttempt : null,
          title: typeof item.title === 'string' ? item.title.slice(0, 180) : key,
          ...(Object.hasOwn(CFG.tiers, item.tier) ? { tier: item.tier } : {}) };
      }
      if (!Object.keys(clean).length) throw new Error('No recognized submissions found on this account.');
      const metadata = { ...siteCatalog };
      for (const [key, value] of Object.entries(message.catalog ?? {})) {
        const meta = metaOf(value);
        if (meta && M.validSlug(key)) metadata[key] = meta;
      }
      await chrome.storage.local.set({ history: clean, siteCatalog: metadata, sync: { state: 'done',
        count: Object.values(clean).reduce((sum, item) => sum + item.submissions, 0),
        catalogLoaded: Boolean(message.catalog), updatedAt: Date.now() } });
    }
    return { ok: true };
  }
  if (type === 'clearHistory') {
    if (sync?.state === 'running' && Date.now() - sync.updatedAt < 90000) throw new Error('Wait for the current sync to finish.');
    await chrome.storage.local.set({ history: {}, sync: null });
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
        if (JSON.stringify(meta) !== JSON.stringify(old)) {
          catalog[slug] = local[slug] = meta;
          await chrome.storage.local.set({ local });
        }
      }
    }
    return { problem: M.resolve(slug, contest, catalog, CFG),
      outcome: Object.hasOwn(outcomes, slug) ? outcomes[slug] : null,
      stats: Object.hasOwn(history, slug) ? history[slug] : null };
  }
  if (type === 'outcome' && M.resolve(slug, contest, catalog, CFG)) {
    if (message.outcome === null) delete outcomes[slug];
    else if (['solved', 'missed'].includes(message.outcome)) outcomes[slug] = message.outcome;
    else throw new Error('Invalid outcome.');
    await chrome.storage.local.set({ outcomes });
    return { outcome: Object.hasOwn(outcomes, slug) ? outcomes[slug] : null };
  }
  if (type === 'dashboard') {
    const level = M.levelFor(outcomes, contest, catalog, CFG, history);
    const attempted = { ...history, ...outcomes };
    const counts = Object.values(history);
    return { level, recommendations: M.recommend(level, message.band, attempted, contest, catalog, CFG),
      history: { solved: counts.filter(h => h.accepted > 0).length, count: counts.length,
        submissions: counts.reduce((sum, h) => sum + h.submissions, 0) },
      catalogSize: new Set([...Object.keys(contest), ...Object.keys(catalog)]).size };
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
  throw new Error('Invalid request.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
  const task = queue.then(() => run(message, sender));
  queue = task.catch(() => {});
  task.then(result => respond(result), error => respond({ error: error?.message || 'Could not update practice data.' }));
  return true;
});
