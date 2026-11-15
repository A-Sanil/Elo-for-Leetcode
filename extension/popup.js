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
    size = (history?.count ?? 0) + (history?.recentSolved ?? 0);
    if (history?.count) $('level-note').textContent += ' History: ' + history.solved.toLocaleString() + ' solved, ' +
      history.submissions.toLocaleString() + ' judged submissions.';
    if (history?.recentSolved) $('level-note').textContent += ' Public recent solves: ' + history.recentSolved + '.';
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

async function loadSummary() {
  try {
    const { streak, goal, today } = await send({ type: 'summary' });
    $('today-solved').textContent = (today?.solved ?? 0).toLocaleString();
    $('streak-current').textContent = streak?.current ?? 0;
    if (document.activeElement !== $('goal-input')) $('goal-input').value = goal?.perDay ?? 3;
  } catch { /* keep last values */ }
}

$('band').addEventListener('change', refresh);
$('open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
let goalTimer = null;
$('goal-input').addEventListener('input', () => {
  clearTimeout(goalTimer);
  goalTimer = setTimeout(async () => {
    const perDay = Number($('goal-input').value);
    if (Number.isInteger(perDay) && perDay >= 1 && perDay <= 100) {
      try { await send({ type: 'setGoal', perDay }); } catch { /* ignore */ }
    }
  }, 500);
});

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
    if (result.stats) caption += ' · You: ' + result.stats.accepted + '/' + result.stats.submissions + ' accepted';
    $('current-note').textContent = caption;
  } catch {
    $('current-title').textContent = 'Open a LeetCode problem to see its rating.';
    $('current-note').textContent = '';
  }
}
async function updateSync() {
  try {
    const state = await send({ type: 'syncState' });
    const key = [state.state, state.updatedAt, state.message].join(':');
    if (key !== lastSync) {
      lastSync = key;
      if (state.state === 'done' || state.state === 'idle') { await refresh(); await loadSummary(); }
    }
    const working = state.state === 'running';
    $('sync').disabled = working;
    $('sync-recent').disabled = working;
    $('clear-history').hidden = !size || working;
    $('sync-note').textContent = actionMessage || (working
      ? (state.source === 'recent' ? 'Reading public profile…' :
        'Reading history… ' + state.count.toLocaleString() + ' entries. Keep the LeetCode tab open.')
      : state.state === 'done'
        ? (state.source === 'recent' ? 'Imported ' + state.count + ' recent public solves. No retry counts available.' :
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
$('sync').addEventListener('click', async () => {
  actionMessage = '';
  $('sync').disabled = true;
  try {
    const reply = await sendToTab('startTabSync');
    if (reply?.error) throw new Error(reply.error);
    if (!reply?.ok) throw new Error('No response.');
    $('sync-note').textContent = 'Starting… Keep the LeetCode tab open.';
  } catch {
    actionMessage = 'Open a signed-in leetcode.com tab, reload it, then try Sync again.';
    await updateSync();
  }
});
$('sync-recent').addEventListener('click', async () => {
  const username = $('profile-name').value.trim();
  actionMessage = '';
  if (!username) {
    actionMessage = 'Enter your LeetCode username.';
    await updateSync();
    return;
  }
  $('sync-recent').disabled = true;
  try {
    const reply = await sendToTab('startRecentSync', { username });
    if (!reply?.ok) throw new Error(reply?.error || 'No response.');
    $('sync-note').textContent = 'Starting public profile import…';
  } catch {
    actionMessage = 'Open a leetcode.com tab and reload it before importing.';
    await updateSync();
  }
});
$('clear-history').addEventListener('click', async () => {
  actionMessage = '';
  try { await send({ type: 'clearHistory' }); await refresh(); await loadSummary(); await poll(); }
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
loadSummary();
void poll();
setInterval(poll, 1000);
