const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../extension/model.js');
const site = require('../extension/leetcode.js');
require('../extension/config.js');
const cfg = globalThis.LcConfig;
const mk = (id, status_display, title_slug = 'add-two-numbers') =>
  ({ id, status_display, title_slug, title: 'Fixture title', timestamp: id, code: 'must not be stored' });

test('acceptance data separates problems in the same tier; contest data takes precedence', () => {
  const easy = { title: 'A', tier: 'Medium', acceptedCount: 7000, submissionCount: 10000 };
  const hard = { ...easy, acceptedCount: 2000 };
  const r1 = M.resolve('test-a', {}, { 'test-a': easy }, cfg);
  const r2 = M.resolve('test-a', {}, { 'test-a': hard }, cfg);
  assert.ok(r1.rating < cfg.tiers.Medium.rating && r2.rating > cfg.tiers.Medium.rating);
  assert.equal(r1.acceptance, 0.7);
  assert.equal(M.resolve('test-a', { 'test-a':['A', 2000] }, { 'test-a': hard }, cfg).rating, 2000);
});

test('history counts unique judged submissions and stops counting first-solve retries after AC', () => {
  const ac = mk(3, 'Accepted');
  const r = site.summarize([mk(6,'Accepted'), mk(4,'Judging'), ac, mk(2,'Runtime Error'),
    mk(5,'Wrong Answer'), mk(1,'Wrong Answer'), ac, mk(8,'Wrong Answer','two-sum')]);
  assert.equal(r.total, 6);
  assert.equal(r.counts['add-two-numbers'].submissions, 5);
  assert.equal(r.counts['add-two-numbers'].accepted, 2);
  assert.equal(r.counts['add-two-numbers'].firstAcceptedAttempt, 3);
  assert.equal(r.counts['two-sum'].accepted, 0);
  assert.equal(r.counts['add-two-numbers'].code, undefined);
});

test('extra pre-AC attempts reduce credit, later retries do not, and manual outcome overrides', () => {
  const catalog = { 'two-sum':['Two Sum', 1700] };
  const level = (outcomes, submissions, firstAcceptedAttempt) => M.levelFor(outcomes, catalog, {}, cfg, {
    'two-sum': { submissions, accepted: 1, firstAcceptedAttempt }
  });
  assert.equal(level({}, 1, 1).rating, level({}, 8, 1).rating);
  assert.ok(level({}, 1, 1).rating > level({}, 8, 8).rating);
  assert.equal(level({}, 8, 8).provisional, true);
  assert.equal(level({ 'two-sum':'missed' }, 1, 1).solved, 0);
});

test('history sync paginates to the end and fails on a repeated page', async () => {
  const first = { has_next: true, submissions_dump: [mk(5,'Accepted')] };
  const second = { has_next: false, submissions_dump: [mk(1,'Wrong Answer')] };
  const offsets = [];
  const history = await site.fetchHistory({ request: async path => {
    offsets.push(path);
    return offsets.length === 1 ? first : second;
  }, wait: async () => {} });
  assert.match(offsets[1], /offset=1/);
  assert.equal(history.total, 2);
  assert.equal(history.counts['add-two-numbers'].firstAcceptedAttempt, 2);
  await assert.rejects(site.fetchHistory({ request: async () => first, wait: async () => {} }), /repeated/);
});

test('site metadata parser ignores account status and validates the live slug', async () => {
  const catalog = await site.fetchCatalog(async () => ({ stat_status_pairs: [{
    stat: { question__title_slug: 'two-sum', question__title: 'Two Sum', total_acs: 350, total_submitted: 500 },
    difficulty: { level: 1 }, status: 'ac'
  }] }));
  assert.equal(catalog['two-sum'].tier, 'Easy');
  assert.equal(catalog['two-sum'].status, undefined);
  const api = async () => ({ data: { question: { titleSlug: 'two-sum', title: 'Two Sum', difficulty: 'Easy',
    stats: '{"totalAcceptedRaw":350,"totalSubmissionRaw":500}' } } });
  assert.equal((await site.fetchProblem('two-sum', api)).acceptedCount, 350);
  assert.equal(await site.fetchProblem('add-two-numbers', api), null);
});
