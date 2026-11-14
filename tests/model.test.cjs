const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../extension/model.js');
require('../extension/config.js');
require('../extension/data/contest.js');
const cfg = globalThis.LcConfig;
const contest = { 'alpha-problem': ['Alpha', 1700], 'beta-problem': ['Beta', 1710] };
const local = { 'another-problem': { title: 'Another', tier: 'Medium' } };

test('extracts valid routes and imports only supported LeetCode URLs or slugs', () => {
  assert.equal(M.problemSlug('/problems/two-sum/submissions/123'), 'two-sum');
  assert.equal(M.problemSlug('/problemset/'), null);
  assert.equal(M.problemSlug('/problems/%3Cscript/'), null);
  assert.deepEqual(M.inputSlugs('two-sum, https://leetcode.com/problems/two-sum/\n'
    + 'https://leetcode.com/problems/group-anagrams/description/ https://evil.test/problems/foo/'),
    ['two-sum', 'group-anagrams']);
});

test('distinguishes contest ratings, rough estimates and missing metadata', () => {
  assert.equal(M.resolve('alpha-problem', contest,
    { 'alpha-problem': { tier: 'Easy' } }, cfg).rating, 1700);
  assert.equal(M.resolve('alpha-problem', contest, local, cfg).source, 'contest');
  assert.deepEqual(M.resolve('another-problem', contest, local, cfg), {
    slug: 'another-problem', title: 'Another', tier: 'Medium', source: 'estimate', rating: 1650, low: 1400, high: 1900
  });
  assert.equal(M.resolve('unknown', contest, local, cfg), null);
});

test('practice estimate responds to successes and misses and flags one-sided data', () => {
  assert.equal(M.levelFor({}, contest, local, cfg), null);
  const won = M.levelFor({ 'alpha-problem': 'solved' }, contest, local, cfg);
  const lost = M.levelFor({ 'alpha-problem': 'missed' }, contest, local, cfg);
  const estimatedWin = M.levelFor({ 'another-problem': 'solved' }, contest, local, cfg);
  assert.ok(won.rating > cfg.prior && lost.rating < cfg.prior);
  assert.ok(won.rating > estimatedWin.rating);
  assert.equal(won.provisional, true);
  assert.equal(lost.count, 1);
});

test('recommendations respect selected band and exclude logged problems', () => {
  assert.equal(M.recommend({ rating: 1700 }, 'near', { 'alpha-problem': 'solved' },
    contest, local, cfg)[0].slug, 'beta-problem');
  assert.equal(M.recommend({ rating: 1700 }, 'warmup', {}, contest, local, cfg)[0].slug, 'another-problem');
});

test('bundled snapshot contains real, valid contest rows', () => {
  const { problems, ref } = globalThis.LcContest;
  assert.ok(Object.keys(problems).length > 2000);
  assert.ok(ref);
  for (const [slug, item] of Object.entries(problems)) {
    assert.ok(M.validSlug(slug));
    assert.ok(typeof item[0] === 'string' && Number.isInteger(item[1]) && item[1] > 0);
  }
});
