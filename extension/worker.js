importScripts('config.js', 'model.js', 'data/seed.js', 'data/contest.js');

const M = globalThis.LcModel;
const CFG = globalThis.LcConfig;
const contest = globalThis.LcContest.problems;
let queue = Promise.resolve();

async function run(message) {
  const stored = await chrome.storage.local.get({ local: {}, outcomes: {} });
  const { local, outcomes } = stored;
  const catalog = { ...globalThis.LcSeed, ...local };
  const { type, slug, tier } = message;
  if (type === 'problem' && M.validSlug(slug)) {
    if (!Object.hasOwn(contest, slug) && Object.hasOwn(CFG.tiers, tier)) {
      const title = (typeof message.title === 'string' && message.title.trim().slice(0, 180))
        || slug.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' ');
      const old = catalog[slug];
      if (!old || old.tier !== tier || old.title !== title) {
        catalog[slug] = local[slug] = { title, tier };
        await chrome.storage.local.set({ local });
      }
    }
    return { problem: M.resolve(slug, contest, catalog, CFG), outcome: Object.hasOwn(outcomes, slug) ? outcomes[slug] : null };
  }
  if (type === 'outcome' && M.resolve(slug, contest, catalog, CFG)) {
    if (message.outcome === null) delete outcomes[slug];
    else if (['solved', 'missed'].includes(message.outcome)) outcomes[slug] = message.outcome;
    else throw new Error('Invalid outcome.');
    await chrome.storage.local.set({ outcomes });
    return { outcome: Object.hasOwn(outcomes, slug) ? outcomes[slug] : null };
  }
  if (type === 'dashboard') {
    const level = M.levelFor(outcomes, contest, catalog, CFG);
    return { level, recommendations: M.recommend(level, message.band, outcomes, contest, catalog, CFG),
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
  const task = queue.then(() => run(message));
  queue = task.catch(() => {});
  task.then(result => respond(result), () => respond({ error: 'Could not update practice data.' }));
  return true;
});
