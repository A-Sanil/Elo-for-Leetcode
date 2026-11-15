const $ = id => document.getElementById(id);
let generation = 0;
let lastSync = '';
let size = 0;
let actionMessage = '';
let polling = false;
async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply || reply.error) throw new Error(reply?.error ?? 'No response from extension.');
  return reply;
}
async function refresh() {
  const id = ++generation;
  try {
    const { level, recommendations, catalogSize, history } = await send({ type: 'dashboard', band: $('band').value });
    if (id !== generation) return;
    $('rating').textContent = level ? '~' + level.rating : 'Not rated yet';
    $('level-note').textContent = level
      ? (level.provisional ? 'Provisional · ' : '') + level.solved + ' solved / ' + level.count + ' rated practice problems.'
      : 'Sync your history or log an outcome to personalize recommendations.';
    size = history.count + history.recentSolved;
    if (history.count) $('level-note').textContent += ' Saved history: ' + history.solved.toLocaleString() + ' solved, ' +
      history.submissions.toLocaleString() + ' judged submissions.';
    if (history.recentSolved) $('level-note').textContent += ' Recent profile import: ' +
      history.recentSolved.toLocaleString() + ' solved problems; submission counts unavailable from profile.';
    $('catalog').textContent = catalogSize.toLocaleString() + ' known problems';
    $('recommendations').replaceChildren();
    for (const p of recommendations) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = LcModel.problemUrl(p.slug);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = p.title;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = p.source === 'contest' ? p.rating + ' contest' : '~' + p.rating + ' estimate';
      a.append(title, tag);
      li.append(a);
      $('recommendations').append(li);
    }
    if (!recommendations.length) $('recommendations').textContent = 'No unlogged problems in the catalog.';
  } catch {
    if (id === generation) $('level-note').textContent = 'Could not load practice data. Reopen the popup to retry.';
  }
}

$('band').addEventListener('change', refresh);

async function sendToTab(type, fields = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) throw new Error('Open LeetCode in the active tab.');
  return chrome.tabs.sendMessage(tab.id, { type, ...fields });
}
async function updateCurrent() {
  try {
    const result = await sendToTab('current');
    if (!result?.problem) throw new Error();
    const p = result.problem;
    $('current-title').textContent = p.title + ' · ' + (p.source === 'contest' ? p.rating : '~' + p.rating);
    let caption = p.source === 'contest' ? 'ZeroTrac contest rating'
      : (p.acceptance == null ? 'Tier-only estimate' : 'Estimate · ' + (p.acceptance * 100).toFixed(1) + '% acceptance');
    if (result.stats) caption += ' · Saved history: ' + result.stats.accepted + '/' + result.stats.submissions + ' accepted';
    if (result.recentSolve) caption += ' · Recent profile solve (submission counts unavailable from profile)';
    $('current-note').textContent = caption;
  } catch {
    $('current-title').textContent = 'Open a LeetCode problem to see its rating.';
    $('current-note').textContent = '';
  }
}
async function updateSync() {
  try {
    const state = await send({ type: 'syncState' });
    const key = [state.state, state.source, state.updatedAt, state.message].join(':');
    if (key !== lastSync) {
      lastSync = key;
      if (state.state === 'done' || state.state === 'idle') await refresh();
    }
    const working = state.state === 'running';
    const recent = state.source === 'recent';
    $('sync').disabled = working;
    $('sync-recent').disabled = working;
    $('clear-history').hidden = !size || working;
    $('sync-note').textContent = actionMessage || (working
      ? (recent ? 'Reading public recent solves…' : 'Reading history… ' + state.count.toLocaleString() + ' entries.') + ' Keep the LeetCode tab open.'
      : state.state === 'done'
        ? (recent ? 'Recent solves imported. Submission counts unavailable from profile.' :
          'Sync complete. ' + (state.catalogLoaded ? 'Catalog updated.' : 'Catalog unavailable; some problems may be unrated.'))
        : state.state === 'error' ? state.message : 'Use a signed-in LeetCode tab. History stays in this browser.');
  } catch { /* popup can be closed while a sync runs */ }
}
async function poll() {
  if (polling) return;
  polling = true;
  try { await Promise.all([updateCurrent(), updateSync()]); }
  finally { polling = false; }
}
async function startSync(type, fields, tabHint) {
  actionMessage = '';
  $('sync').disabled = $('sync-recent').disabled = true;
  try {
    const reply = await sendToTab(type, fields);
    if (reply?.error) actionMessage = reply.error;
    if (!reply?.ok) throw new Error('No response.');
    $('sync-note').textContent = 'Starting… Keep the LeetCode tab open.';
  } catch {
    actionMessage ||= tabHint;
    await updateSync();
  }
}
$('sync').addEventListener('click', () => startSync('startTabSync', {},
  'Open a signed-in leetcode.com tab, reload it, then try Sync again.'));
$('recent-form').addEventListener('submit', event => {
  event.preventDefault();
  void startSync('startRecentSync', { username: $('profile-username').value.trim() },
    'Open a leetcode.com tab, reload it, then try Import recent solves again.');
});
$('clear-history').addEventListener('click', async () => {
  actionMessage = '';
  try { await send({ type: 'clearHistory' }); await refresh(); await poll(); }
  catch (e) { actionMessage = e.message; await updateSync(); }
});
$('import').addEventListener('click', async () => {
  const text = $('solves').value.trim();
  if (!text) return;
  $('import').disabled = true;
  try {
    const { added, existing, unknown } = await send({ type: 'import', text });
    $('import-note').textContent = 'Added ' + added + ' · Already logged ' + existing + ' · Unknown ' + unknown;
    if (!unknown) $('solves').value = '';
    await refresh();
  } catch { $('import-note').textContent = 'Could not import. Try again.'; }
  finally { $('import').disabled = false; }
});
refresh();
void poll();
setInterval(poll, 1000);
