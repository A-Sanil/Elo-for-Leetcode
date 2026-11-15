'use strict';
const M = globalThis.LcModel;
const CFG = globalThis.LcConfig;
const ROADMAP = globalThis.LcRoadmap;
const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, reply => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!reply || reply.error) return reject(new Error(reply?.error || 'No response.'));
      resolve(reply);
    });
  });
}
function elem(tag, props, kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    if (k === 'class') e.className = props[k];
    else if (k === 'text') e.textContent = props[k];
    else if (k === 'html') e.innerHTML = props[k];
    else e.setAttribute(k, props[k]);
  }
  for (const kid of kids || []) if (kid) e.append(kid);
  return e;
}
function svg(name, attrs) { const e = document.createElementNS(SVGNS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
  const a = elem('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let state = { rows: [], daily: {}, goal: { perDay: 3 }, level: null, roadmaps: [], catalogSize: 0 };
let statusBy = new Map();

function computeStatus(rows) {
  const map = new Map();
  for (const r of rows) {
    const status = r.solved ? 'solved' : (r.submissions > 0 || r.outcome === 'missed') ? 'attempted' : 'todo';
    map.set(r.slug, status);
  }
  return map;
}

async function load() {
  try {
    state = await send({ type: 'dashboardData' });
  } catch (e) {
    $('empty').hidden = false;
    $('empty').textContent = 'Could not load data: ' + e.message;
    return;
  }
  statusBy = computeStatus(state.rows);
  const hasData = state.rows.length > 0 || Object.keys(state.daily).length > 0;
  $('empty').hidden = hasData;
  populateTopicFilter();
  $('d-goal').value = state.goal.perDay;
  renderOverview();
  renderMemory();
  renderRoadmap();
}

// ---- Tabs -------------------------------------------------------------------
$('tabs').addEventListener('click', e => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  for (const b of $('tabs').children) b.classList.toggle('active', b === btn);
  for (const id of ['overview', 'memory', 'roadmap', 'data']) $(id).hidden = id !== btn.dataset.tab;
});

// ---- Overview ---------------------------------------------------------------
function tile(n, label) { return elem('div', { class: 'tile' }, [elem('div', { class: 'n', text: String(n) }), elem('div', { class: 'l', text: label })]); }

function renderOverview() {
  const rows = state.rows;
  const streak = M.streaks(state.daily);
  const solved = rows.filter(r => r.solved).length;
  const rated = rows.filter(r => Number.isFinite(r.rating));
  const avg = rated.length ? Math.round(rated.filter(r => r.solved).reduce((a, r) => a + r.rating, 0) / Math.max(1, rated.filter(r => r.solved).length)) : 0;
  const tiles = $('tiles'); tiles.replaceChildren();
  tiles.append(
    tile(state.level ? '~' + state.level.rating : '—', 'Practice level' + (state.level?.provisional ? ' (provisional)' : '')),
    tile(solved, 'Problems solved'),
    tile(avg || '—', 'Avg solved rating'),
    tile(streak.current, 'Current streak'),
    tile(streak.longest, 'Longest streak'),
    tile(streak.today.solved + ' / ' + state.goal.perDay, "Today's goal")
  );
  renderHeatmap();
  renderCumulative();
  renderDifficulty();
  renderRatingHist();
  renderTopics();
  renderCoach();
}

function renderHeatmap() {
  const box = $('heatmap'); box.replaceChildren();
  const hm = M.heatmap(state.daily, CFG.heatmapWeeks);
  const startDow = new Date(M.parseDay(hm.start)).getUTCDay();
  const gridStart = M.shiftDay(hm.start, -startDow);
  const cols = Math.ceil((M.dayDiff(gridStart, hm.end) + 1) / 7);
  const cell = 13, gap = 3, left = 4, top = 4;
  const width = left + cols * (cell + gap), height = top + 7 * (cell + gap);
  const s = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, width, height });
  for (const c of hm.cells) {
    const idx = M.dayDiff(gridStart, c.date);
    const col = Math.floor(idx / 7), row = idx % 7;
    const t = c.solved ? Math.min(1, c.solved / Math.max(1, hm.max)) : 0;
    const rect = svg('rect', { x: left + col * (cell + gap), y: top + row * (cell + gap), width: cell, height: cell, rx: 3,
      fill: c.solved ? 'rgba(54,194,139,' + (0.3 + 0.7 * t).toFixed(2) + ')' : '#111826', stroke: '#0003' });
    rect.append(svg('title', {}));
    rect.lastChild.textContent = c.date + ': ' + c.solved + ' solved, ' + c.submissions + ' submissions';
    s.append(rect);
  }
  box.append(s);
  const legend = $('heatmap-legend'); legend.replaceChildren();
  legend.append(document.createTextNode('Less '),
    elem('i', { style: 'background:#111826' }), elem('i', { style: 'background:rgba(54,194,139,0.45)' }),
    elem('i', { style: 'background:rgba(54,194,139,0.75)' }), elem('i', { style: 'background:rgba(54,194,139,1)' }),
    document.createTextNode(' More · ' + streakText()));
}
function streakText() { const s = M.streaks(state.daily); return s.activeDays + ' active days'; }

function renderCumulative() {
  const box = $('cumulative'); box.replaceChildren();
  const series = M.cumulativeSolved(state.daily);
  if (!series.length) { box.append(elem('p', { class: 'muted', text: 'No dated history yet. Sync to populate.' })); return; }
  const W = 600, H = 170, pad = 28;
  const maxY = series[series.length - 1].cumulative || 1;
  const x = i => pad + (W - pad * 2) * (series.length === 1 ? 0.5 : i / (series.length - 1));
  const y = v => H - pad - (H - pad * 2) * (v / maxY);
  const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, preserveAspectRatio: 'none' });
  s.append(svg('line', { x1: pad, y1: H - pad, x2: W - pad, y2: H - pad, stroke: '#2a3647' }));
  s.append(svg('line', { x1: pad, y1: pad, x2: pad, y2: H - pad, stroke: '#2a3647' }));
  const pts = series.map((d, i) => x(i) + ',' + y(d.cumulative)).join(' ');
  s.append(svg('polyline', { points: (pad + ',' + (H - pad)) + ' ' + pts + ' ' + ((W - pad) + ',' + (H - pad)),
    fill: 'rgba(168,235,206,0.12)', stroke: 'none' }));
  s.append(svg('polyline', { points: pts, fill: 'none', stroke: '#a8ebce', 'stroke-width': 2 }));
  for (const [i, lbl] of [[0, series[0].date], [series.length - 1, series[series.length - 1].date]]) {
    const t = svg('text', { x: x(i), y: H - 8, fill: '#9fb0c7', 'font-size': 10, 'text-anchor': i === 0 ? 'start' : 'end' }); t.textContent = lbl; s.append(t);
  }
  const t0 = svg('text', { x: 4, y: y(maxY) + 4, fill: '#9fb0c7', 'font-size': 10 }); t0.textContent = maxY; s.append(t0);
  box.append(s);
}

function barRow(name, fraction, valText, color) {
  const fill = elem('div', { class: 'bar-fill', style: 'width:' + Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%' + (color ? ';background:' + color : '') });
  return elem('div', { class: 'bar-row' }, [elem('div', { class: 'name', text: name, title: name }),
    elem('div', { class: 'bar-track' }, [fill]), elem('div', { class: 'val', text: valText })]);
}

function renderDifficulty() {
  const box = $('difficulty'); box.replaceChildren();
  const d = M.difficultyBreakdown(state.rows);
  const colors = { Easy: 'var(--easy)', Medium: 'var(--med)', Hard: 'var(--hard)' };
  for (const tier of ['Easy', 'Medium', 'Hard']) {
    const { solved, total } = d[tier];
    box.append(barRow(tier, total ? solved / total : 0, solved + ' / ' + total, colors[tier]));
  }
}

function renderRatingHist() {
  const box = $('ratinghist'); box.replaceChildren();
  const solvedRows = state.rows.filter(r => r.solved);
  const buckets = M.ratingBuckets(solvedRows, CFG);
  if (!buckets.length) { box.append(elem('p', { class: 'muted', text: 'No rated solves yet.' })); return; }
  const max = Math.max(...buckets.map(b => b.count));
  for (const b of buckets) box.append(barRow(b.label, b.count / max, String(b.count)));
}

function renderTopics() {
  const box = $('topics'); box.replaceChildren();
  const topics = M.topicBreakdown(state.rows).slice(0, 12);
  if (!topics.length) { box.append(elem('p', { class: 'muted', text: 'Topic tags load during a sync. Run Sync to populate.' })); return; }
  for (const t of topics) box.append(barRow(t.tag, t.total ? t.solved / t.total : 0, t.solved + ' / ' + t.total));
}

function renderCoach() {
  const box = $('coach'); box.replaceChildren();
  const weak = M.weakTopics(state.rows, 3).slice(0, 5);
  if (!weak.length) {
    box.append(elem('p', { class: 'muted', text: 'Sync your history (topic tags included) to get topic-level coaching. Meanwhile, open the popup for a next-problem recommendation at your level.' }));
    return;
  }
  box.append(elem('p', { class: 'muted', text: 'Lowest solve rates among topics you have attempted at least 3 times. Drill these:' }));
  for (const t of weak) box.append(barRow(t.tag, t.rate, Math.round(t.rate * 100) + '% (' + t.solved + '/' + t.total + ')', 'var(--hard)'));
  if (state.level) box.append(elem('p', { class: 'muted', text: 'Practice level ~' + state.level.rating + '. Use the popup’s Warm-up / At my level / Stretch picker for targeted next problems.' }));
}

// ---- Problem memory ---------------------------------------------------------
function populateTopicFilter() {
  const tags = new Set();
  for (const r of state.rows) for (const t of r.tags) tags.add(t);
  const sel = $('f-topic'); const current = sel.value;
  sel.replaceChildren(elem('option', { value: '', text: 'Any topic' }));
  for (const t of [...tags].sort()) sel.append(elem('option', { value: t, text: t }));
  sel.value = current;
}
function readFilters() {
  const num = v => (v === '' || v == null ? undefined : Number(v));
  return { text: $('f-text').value, tier: $('f-tier').value, topic: $('f-topic').value, status: $('f-status').value,
    from: $('f-from').value || undefined, to: $('f-to').value || undefined, minRating: num($('f-min').value), maxRating: num($('f-max').value) };
}
function sortRows(rows, mode) {
  const by = {
    'recent': (a, b) => (b.lastTime || b.firstACTime || 0) - (a.lastTime || a.firstACTime || 0),
    'rating-desc': (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
    'rating-asc': (a, b) => (a.rating ?? 1e9) - (b.rating ?? 1e9),
    'title': (a, b) => a.title.localeCompare(b.title)
  };
  return rows.slice().sort(by[mode] || by.recent);
}
function currentMemory() {
  const { rows } = M.queryMemory(state.rows, readFilters());
  return sortRows(rows, $('f-sort').value);
}
function renderMemory() {
  const rows = currentMemory();
  const solved = rows.filter(r => r.solved).length;
  $('memory-count').textContent = rows.length + ' problems · ' + solved + ' solved · ' + (rows.length - solved) + ' not solved';
  const body = $('memory-body'); body.replaceChildren();
  for (const r of rows.slice(0, 1500)) {
    const link = elem('a', { href: M.problemUrl(r.slug), target: '_blank', rel: 'noopener noreferrer', text: r.title });
    const src = elem('span', { class: 'muted', text: r.source === 'contest' ? ' · contest' : (r.source === 'estimate' ? ' · est' : '') });
    const rating = r.rating == null ? '—' : (r.source === 'contest' ? String(r.rating) : '~' + r.rating);
    const diff = r.tier ? elem('span', { class: 'pill ' + r.tier, text: r.tier }) : document.createTextNode('—');
    const solvedOn = r.firstACTime ? M.dayKey(r.firstACTime) : (r.solved ? '✓' : '—');
    body.append(elem('tr', {}, [
      elem('td', {}, [link, src]),
      elem('td', { text: rating }),
      elem('td', {}, [diff]),
      elem('td', { class: 'tags', text: r.tags.slice(0, 3).join(', ') }),
      elem('td', { text: String(r.submissions || 0) }),
      elem('td', { text: String(r.accepted || 0) }),
      elem('td', { text: solvedOn }),
      elem('td', {}, [elem('div', { class: 'note', title: r.note, text: r.note })])
    ]));
  }
  if (!rows.length) body.append(elem('tr', {}, [elem('td', { colspan: '8', class: 'muted', text: 'No problems match these filters.' })]));
}

function wireFilters() {
  for (const id of ['f-text', 'f-tier', 'f-topic', 'f-status', 'f-from', 'f-to', 'f-min', 'f-max', 'f-sort'])
    $(id).addEventListener('input', renderMemory);
  $('f-reset').addEventListener('click', () => {
    for (const id of ['f-text', 'f-from', 'f-to', 'f-min', 'f-max']) $(id).value = '';
    for (const id of ['f-tier', 'f-topic', 'f-status']) $(id).value = '';
    $('f-sort').value = 'recent';
    renderMemory();
  });
  $('f-csv').addEventListener('click', () => download('leetcode-memory.csv', toCsv(currentMemory()), 'text/csv'));
}
function toCsv(rows) {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['slug', 'title', 'tier', 'rating', 'source', 'solved', 'submissions', 'accepted', 'firstAcceptedAttempt', 'solvedDate', 'lastDate', 'tags', 'note'];
  const lines = [head.join(',')];
  for (const r of rows) lines.push([r.slug, r.title, r.tier, r.rating, r.source, r.solved, r.submissions, r.accepted,
    r.firstAcceptedAttempt, r.firstACTime ? M.dayKey(r.firstACTime) : '', r.lastTime ? M.dayKey(r.lastTime) : '',
    r.tags.join(' '), r.note].map(q).join(','));
  return lines.join('\n');
}

// ---- Roadmap ----------------------------------------------------------------
function dot(problem) {
  const status = statusBy.get(problem.slug) || 'todo';
  const cls = 'dot ' + status + (problem.premium ? ' premium' : '');
  const a = elem('a', { class: cls, href: M.problemUrl(problem.slug), target: '_blank', rel: 'noopener noreferrer',
    title: problem.title + (problem.premium ? ' (premium)' : '') + ' · ' + status });
  a.textContent = problem.difficulty ? problem.difficulty[0] : '';
  return a;
}
function renderRoadmap() {
  const nc = $('neetcode'); nc.replaceChildren();
  let solved = 0, total = 0;
  for (const phase of ROADMAP.phases) {
    const topics = ROADMAP.topics.filter(t => t.phase === phase.id);
    if (!topics.length) continue;
    nc.append(elem('div', { class: 'phase-title', text: phase.label }));
    for (const topic of topics) {
      const dots = elem('div', { class: 'dots' }, topic.problems.map(dot));
      const tSolved = topic.problems.filter(p => statusBy.get(p.slug) === 'solved').length;
      solved += tSolved; total += topic.problems.length;
      const head = elem('div', { class: 'topic-head' }, [
        elem('span', { text: topic.icon || '•' }), elem('span', { class: 't', text: topic.title }),
        elem('span', { class: 'c', text: tSolved + ' / ' + topic.problems.length })]);
      nc.append(elem('div', { class: 'topic' }, [head, dots]));
    }
  }
  $('nc-progress').textContent = '· ' + solved + ' / ' + total + ' solved';
  renderCustomRoadmaps();
}
function renderCustomRoadmaps() {
  const box = $('custom-roadmaps'); box.replaceChildren();
  if (!state.roadmaps.length) { box.append(elem('p', { class: 'muted', text: 'No custom roadmaps yet. Build one below.' })); }
  for (const rm of state.roadmaps) {
    // Solved/attempted come from the shared status map built from problem memory.
    const s = rm.slugs.filter(sl => statusBy.get(sl) === 'solved').length;
    const bar = elem('div', { class: 'progress' }, [elem('i', { style: 'width:' + Math.round((s / Math.max(1, rm.slugs.length)) * 100) + '%' })]);
    const del = elem('button', { type: 'button', text: 'Delete' });
    del.addEventListener('click', async () => { if (confirm('Delete “' + rm.name + '”?')) { try { await send({ type: 'deleteRoadmap', id: rm.id }); await load(); } catch (e) { alert(e.message); } } });
    const head = elem('div', { class: 'rm-item' }, [
      elem('div', { class: 'grow' }, [elem('strong', { text: rm.name }), elem('span', { class: 'muted', text: '  ' + s + ' / ' + rm.slugs.length + ' solved' })]),
      del]);
    box.append(elem('div', {}, [head, bar]));
  }
}
function wireRoadmapBuilder() {
  $('rm-create').addEventListener('click', async () => {
    const name = $('rm-name').value.trim() || 'My roadmap';
    const slugs = M.inputSlugs($('rm-input').value || '');
    if (!slugs.length) { $('rm-note').textContent = 'No valid problem links or slugs found.'; return; }
    try {
      await send({ type: 'createRoadmap', name, problems: slugs.map(slug => ({ slug })) });
      $('rm-note').textContent = 'Created “' + name + '” with ' + slugs.length + ' problems.';
      $('rm-name').value = ''; $('rm-input').value = '';
      await load();
    } catch (e) { $('rm-note').textContent = e.message; }
  });
  $('rm-import').addEventListener('click', async () => {
    const line = ($('rm-input').value || '').split(/\n+/).map(s => s.trim()).find(Boolean);
    if (!line) { $('rm-note').textContent = 'Paste a collection URL (company list, study plan, or selectedList).'; return; }
    $('rm-note').textContent = 'Importing… this reads the list from an open leetcode.com tab.';
    let tabs = [];
    try { tabs = await chrome.tabs.query({ url: '*://leetcode.com/*' }); } catch { /* no tabs permission/host */ }
    const tab = tabs.find(t => t.id != null);
    if (!tab) { $('rm-note').textContent = 'Open a signed-in leetcode.com tab in this browser, then click Import again.'; return; }
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'importCollection', input: line });
      if (!reply || reply.error) throw new Error(reply?.error || 'The leetcode.com tab did not respond. Reload it and retry.');
      const problems = reply.problems || [];
      if (!problems.length) throw new Error('That collection returned no problems.');
      const name = $('rm-name').value.trim() || 'Imported list';
      await send({ type: 'createRoadmap', name, problems });
      $('rm-note').textContent = 'Imported ' + problems.length + ' problems into “' + name + '”.';
      $('rm-name').value = ''; $('rm-input').value = '';
      await load();
    } catch (e) { $('rm-note').textContent = e.message; }
  });
}

// ---- Data -------------------------------------------------------------------
function wireData() {
  let goalTimer = null;
  $('d-goal').addEventListener('input', () => {
    clearTimeout(goalTimer);
    goalTimer = setTimeout(async () => {
      const perDay = Number($('d-goal').value);
      if (Number.isInteger(perDay) && perDay >= 1 && perDay <= 100) { try { await send({ type: 'setGoal', perDay }); state.goal.perDay = perDay; renderOverview(); } catch { /* ignore */ } }
    }, 400);
  });
  $('d-export').addEventListener('click', async () => {
    try { const data = await send({ type: 'exportAll' }); download('elo-for-leetcode-backup.json', JSON.stringify(data, null, 2), 'application/json'); $('d-note').textContent = 'Backup downloaded.'; }
    catch (e) { $('d-note').textContent = e.message; }
  });
  $('d-csv').addEventListener('click', () => download('leetcode-all-problems.csv', toCsv(state.rows), 'text/csv'));
  $('d-import').addEventListener('change', async ev => {
    const file = ev.target.files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
      const reply = await send({ type: 'restore', data });
      $('d-note').textContent = 'Restored: ' + (reply.restored || []).join(', ');
      await load();
    } catch (e) { $('d-note').textContent = 'Could not restore: ' + e.message; }
    finally { ev.target.value = ''; }
  });
  $('d-clear').addEventListener('click', async () => {
    if (!confirm('Clear synced history and the activity calendar? Notes, outcomes and roadmaps stay.')) return;
    try { await send({ type: 'clearHistory' }); await load(); $('d-note').textContent = 'History cleared.'; }
    catch (e) { $('d-note').textContent = e.message; }
  });
}

wireFilters();
wireRoadmapBuilder();
wireData();
load();
