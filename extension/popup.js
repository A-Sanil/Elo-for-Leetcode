const $ = id => document.getElementById(id);
let generation = 0;
async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply || reply.error) throw new Error(reply?.error ?? 'No response from extension.');
  return reply;
}
async function refresh() {
  const id = ++generation;
  try {
    const { level, recommendations, catalogSize } = await send({ type: 'dashboard', band: $('band').value });
    if (id !== generation) return;
    $('rating').textContent = level ? '~' + level.rating : 'Not rated yet';
    $('level-note').textContent = level
      ? (level.provisional ? 'Provisional · ' : '') + level.solved + ' solved / ' + level.count + ' logged. Self-reported practice.'
      : 'Log outcomes on problem pages to personalize recommendations.';
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
