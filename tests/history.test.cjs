const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
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

test('public profile uses a single credential-free, bounded query and returns only unique slugs', async () => {
  let requests = 0;
  const slugs = await site.fetchRecentSolves('my-profile', async (endpoint, options) => {
    requests++;
    assert.equal(endpoint, '/graphql/');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.method, 'POST');
    const { query, variables } = JSON.parse(options.body);
    assert.match(query, /^query .*recentAcSubmissionList.*\{ titleSlug \}/);
    assert.deepEqual(variables, { username: 'my-profile', limit: 20 });
    return { data: { recentAcSubmissionList: [
      { titleSlug: 'two-sum', id: 'ignore me' }, { titleSlug: 'two-sum' }, { titleSlug: 'add-two-numbers' }
    ] } };
  });
  assert.deepEqual(slugs, ['two-sum', 'add-two-numbers']);
  assert.equal(requests, 1);
  await assert.rejects(site.fetchRecentSolves('https://leetcode.com/u/me/', () => assert.fail('must not fetch')), /username/);
});

test('public profile rejects empty, malformed, oversized and partial GraphQL results', async () => {
  const result = list => ({ data: { recentAcSubmissionList: list } });
  const valid = { titleSlug: 'two-sum' };
  await assert.rejects(site.fetchRecentSolves('me', async () => result([])), /No public recent solves/);
  for (const response of [result(null), result([valid, { titleSlug: '/no' }]), result(Array(21).fill(valid)),
    { ...result([valid]), errors: [{ message: 'not exposed to popup' }] }]) {
    await assert.rejects(site.fetchRecentSolves('me', async () => response), /did not return a usable/);
  }
});

test('recent solves are provisional and never replace a manual override or a known first-AC attempt', () => {
  const contest = { 'two-sum': ['Two Sum', 1700] };
  const recent = ['two-sum'];
  const log = (accepted, firstAcceptedAttempt) => ({ 'two-sum': { submissions: 5, accepted, firstAcceptedAttempt } });
  assert.deepEqual(M.levelFor({}, contest, {}, cfg, log(1, 5), recent), M.levelFor({}, contest, {}, cfg, log(1, 5)));
  const profileOnly = M.levelFor({}, contest, {}, cfg, {}, recent);
  assert.equal(profileOnly.solved, 1);
  assert.equal(profileOnly.provisional, true);
  assert.deepEqual(M.levelFor({}, contest, {}, cfg, log(0, null), recent), profileOnly);
  assert.equal(M.levelFor({ 'two-sum': 'missed' }, contest, {}, cfg, {}, recent).solved, 0);
});

test('403 keeps counted history and manual logs; explicit profile import saves solves only', async () => {
  const stored = {
    history: { 'two-sum': { submissions: 3, accepted: 1, firstAcceptedAttempt: 3 } },
    outcomes: { 'merge-intervals': 'missed' }
  };
  const oldHistory = structuredClone(stored.history);
  const requests = [];
  let background, content, profileAvailable = true;
  const readScript = file => fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8');
  const request = (handler, msg, sender = { id: 'elo', tab: { id: 1 } }) =>
    new Promise(resolve => handler(msg, sender, resolve));
  const worker = vm.createContext({
    crypto, importScripts: (...files) => files.forEach(file => vm.runInContext(readScript(file), worker)),
    chrome: {
      runtime: { id: 'elo', onMessage: { addListener: listener => { background = listener; } } },
      storage: { local: {
        get: async defaults => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, stored[key] ?? value])),
        set: async data => Object.assign(stored, structuredClone(data))
      } }
    }
  });
  vm.runInContext(readScript('worker.js'), worker);
  const page = vm.createContext({
    AbortSignal, location: { pathname: '/' }, setInterval: () => {},
    fetch: async (endpoint, options) => {
      requests.push({ endpoint, options });
      if (endpoint.startsWith('/api/submissions/')) return new Response('', { status: 403 });
      assert.equal(endpoint, '/graphql/');
      return Response.json({ data: { recentAcSubmissionList: profileAvailable ? [{ titleSlug: 'add-two-numbers' }] : [] } });
    },
    chrome: {
      runtime: { id: 'elo', sendMessage: msg => request(background, msg),
        onMessage: { addListener: listener => { content = listener; } } },
      storage: { onChanged: { addListener: () => {} } }
    }
  });
  for (const file of ['model.js', 'leetcode.js', 'content.js']) vm.runInContext(readScript(file), page);
  const waitForSync = async state => {
    for (let i = 0; i < 20; i++) {
      const status = await request(background, { type: 'syncState' });
      if (status.state === state) return status;
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('sync did not reach ' + state);
  };

  assert.equal((await request(content, { type: 'startTabSync' })).ok, true);
  assert.match((await waitForSync('error')).message, /403.*Import recent profile solves/);
  assert.equal(requests.length, 1); // no implicit fallback or retries
  assert.deepEqual(stored.history, oldHistory);

  assert.equal((await request(content, { type: 'startRecentSync', username: 'my-profile' })).ok, true);
  assert.equal((await waitForSync('done')).source, 'recent');
  assert.equal(requests.length, 2); // one query; no catalog or private history call
  assert.equal(requests[1].options.credentials, 'omit');
  assert.deepEqual(stored.history, oldHistory);
  assert.deepEqual(stored.recentSolves, ['add-two-numbers']);
  const problem = await request(background, { type: 'problem', slug: 'add-two-numbers' });
  assert.equal(problem.recentSolve, true);
  assert.equal(problem.stats, null);
  const dashboard = await request(background, { type: 'dashboard', band: 'near' });
  assert.equal(dashboard.history.submissions, 3);
  assert.equal(dashboard.history.recentSolved, 1);
  assert.ok(dashboard.recommendations.every(p => p.slug !== 'add-two-numbers'));

  profileAvailable = false;
  assert.equal((await request(content, { type: 'startRecentSync', username: 'my-profile' })).ok, true);
  await waitForSync('error');
  assert.deepEqual(stored.recentSolves, ['add-two-numbers']);
  assert.equal((await request(background, { type: 'clearHistory' })).ok, true);
  assert.deepEqual(stored.recentSolves, []);
  assert.deepEqual(stored.history, {});
  assert.deepEqual(stored.outcomes, { 'merge-intervals': 'missed' });
});
