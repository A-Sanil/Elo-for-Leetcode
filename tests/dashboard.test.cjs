const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../extension/model.js');
require('../extension/config.js');
const cfg = globalThis.LcConfig;

const contest = { 'alpha': ['Alpha', 1700], 'beta': ['Beta', 2150] };
const catalog = { 'gamma': { title: 'Gamma', tier: 'Easy', tags: ['array'] } };
const DAY = 86400; // seconds
// A fixed local day key for a timestamp, reused so assertions are time-zone safe.
const key = ts => M.dayKey(ts);

test('calendar helpers do exact day arithmetic', () => {
  assert.equal(M.dayDiff('2026-01-01', '2026-01-08'), 7);
  assert.equal(M.shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(M.shiftDay('2026-12-31', 1), '2027-01-01');
  assert.ok(M.validDay('2026-11-14') && !M.validDay('nope'));
});

test('memoryRows joins history, outcomes and notes with resolved ratings', () => {
  const t = 1_700_000_000;
  const history = { alpha: { submissions: 3, accepted: 1, firstAcceptedAttempt: 2, firstTime: t, firstACTime: t + 10, lastTime: t + 20, title: 'Alpha', tier: 'Medium' },
    gamma: { submissions: 2, accepted: 0, firstAcceptedAttempt: null, firstTime: t, firstACTime: 0, lastTime: t + 5, title: 'Gamma', tier: 'Easy' } };
  const rows = M.memoryRows({ history, outcomes: { beta: 'missed' }, notes: { alpha: 'two pointers' } }, contest, catalog, cfg);
  const byslug = Object.fromEntries(rows.map(r => [r.slug, r]));
  assert.equal(rows.length, 3);
  assert.equal(byslug.alpha.rating, 1700);
  assert.equal(byslug.alpha.source, 'contest');
  assert.equal(byslug.alpha.solved, true);
  assert.equal(byslug.alpha.note, 'two pointers');
  assert.equal(byslug.gamma.solved, false);
  assert.equal(byslug.beta.solved, false);      // manual 'missed' overrides
  assert.deepEqual(byslug.gamma.tags, ['array']);
});

test('queryMemory filters by tier, topic, status, rating and date', () => {
  const t = 1_700_000_000;
  const rows = [
    { slug: 'a', title: 'A', tier: 'Easy', rating: 1200, source: 'estimate', paid: false, tags: ['array'], submissions: 1, accepted: 1, firstACTime: t, lastTime: t, solved: true, outcome: null, note: '' },
    { slug: 'b', title: 'B', tier: 'Hard', rating: 2200, source: 'contest', paid: false, tags: ['dp'], submissions: 4, accepted: 0, firstACTime: 0, lastTime: t + DAY, solved: false, outcome: null, note: 'hard one' }
  ];
  assert.equal(M.queryMemory(rows, { tier: 'Hard' }).count, 1);
  assert.equal(M.queryMemory(rows, { topic: 'array' }).rows[0].slug, 'a');
  assert.equal(M.queryMemory(rows, { status: 'solved' }).count, 1);
  assert.equal(M.queryMemory(rows, { status: 'attempted' }).rows[0].slug, 'b');
  assert.equal(M.queryMemory(rows, { minRating: 2000 }).rows[0].slug, 'b');
  assert.equal(M.queryMemory(rows, { text: 'hard one' }).rows[0].slug, 'b');
  assert.equal(M.queryMemory(rows, { from: key(t), to: key(t) }).rows.some(r => r.slug === 'a'), true);
  assert.equal(M.queryMemory(rows, { from: key(t + DAY), to: key(t + DAY) }).rows.some(r => r.slug === 'a'), false);
});

test('streaks count consecutive solved days up to today', () => {
  const daily = { '2026-11-10': { solved: 2, submissions: 3 }, '2026-11-11': { solved: 1, submissions: 1 },
    '2026-11-12': { solved: 0, submissions: 2 }, '2026-11-13': { solved: 1, submissions: 1 }, '2026-11-14': { solved: 1, submissions: 1 } };
  const s = M.streaks(daily, '2026-11-14');
  assert.equal(s.current, 2);          // 13th + 14th
  assert.equal(s.longest, 2);          // 10th + 11th (and 13th+14th)
  assert.equal(s.activeDays, 5);
  assert.equal(s.today.solved, 1);
  // An in-progress day with no solves yet keeps yesterday's streak alive.
  assert.equal(M.streaks(daily, '2026-11-15').current, 2);
});

test('heatmap returns a dense window ending today', () => {
  const daily = { '2026-11-14': { solved: 4, submissions: 5 } };
  const hm = M.heatmap(daily, 1, '2026-11-14');
  assert.equal(hm.cells.length, 7);
  assert.equal(hm.end, '2026-11-14');
  assert.equal(hm.max, 4);
  assert.equal(hm.cells[hm.cells.length - 1].solved, 4);
});

test('cumulative, difficulty, rating and topic aggregates', () => {
  const rows = [
    { tier: 'Easy', rating: 1200, tags: ['array'], solved: true },
    { tier: 'Easy', rating: 1250, tags: ['array', 'hash-table'], solved: false },
    { tier: 'Hard', rating: 2200, tags: ['dp'], solved: true }
  ];
  const diff = M.difficultyBreakdown(rows);
  assert.equal(diff.Easy.total, 2); assert.equal(diff.Easy.solved, 1); assert.equal(diff.Hard.solved, 1);
  const buckets = M.ratingBuckets(rows.filter(r => r.solved), cfg);
  assert.deepEqual(buckets.map(b => b.count), [1, 1]);     // 1200 and 2200 solved
  const topics = M.topicBreakdown(rows);
  assert.equal(topics[0].tag, 'array'); assert.equal(topics[0].total, 2); assert.equal(topics[0].solved, 1);
  const cum = M.cumulativeSolved({ '2026-11-10': { solved: 1, submissions: 1 }, '2026-11-11': { solved: 2, submissions: 2 } });
  assert.deepEqual(cum.map(c => c.cumulative), [1, 3]);
});

test('weakTopics ranks low solve-rate topics with enough attempts', () => {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push({ tier: 'Medium', rating: 1600, tags: ['dp'], solved: false });
  for (let i = 0; i < 4; i++) rows.push({ tier: 'Easy', rating: 1200, tags: ['array'], solved: true });
  rows.push({ tier: 'Medium', rating: 1600, tags: ['greedy'], solved: false }); // only 1 seen → excluded
  const weak = M.weakTopics(rows, 3);
  assert.equal(weak[0].tag, 'dp');
  assert.equal(weak[0].rate, 0);
  assert.ok(!weak.some(t => t.tag === 'greedy'));
});

test('roadmap and list progress reflect history and outcomes', () => {
  const roadmap = { phases: [{ id: 'f', label: 'Foundation' }], topics: [
    { id: 't', title: 'Arrays', icon: '🗃', color: '#000', phase: 'f',
      problems: [{ slug: 'two-sum', difficulty: 'Easy' }, { slug: 'valid-anagram', difficulty: 'Easy' }, { slug: 'group-anagrams', difficulty: 'Medium' }] }
  ] };
  const history = { 'two-sum': { submissions: 1, accepted: 1 }, 'valid-anagram': { submissions: 2, accepted: 0 } };
  const prog = M.roadmapProgress(roadmap, history, { 'group-anagrams': 'solved' });
  assert.equal(prog.overall.total, 3);
  assert.equal(prog.overall.solved, 2);       // two-sum (history) + group-anagrams (manual)
  assert.equal(prog.overall.attempted, 1);    // valid-anagram
  const list = M.listProgress(['two-sum', 'unknown-x'], history, {});
  assert.equal(list.total, 2); assert.equal(list.solved, 1);
});
