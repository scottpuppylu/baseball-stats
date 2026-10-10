// Pure analysis of player-diagnostics.js, loaded without a DOM.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {window: {}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'player-diagnostics.js'), 'utf8'), ctx);
const D = ctx.window.PlayerDiagnostics;

// A player object shaped like getAggregatedStats() output.
function player(name, c) {
  const p = {name, pa: 0, ab: 0, h: 0, h2: 0, h3: 0, hr: 0, bb: 0, sf: 0, k: 0, k_swing: 0, k_foul: 0, bip: 0, ld: 0, gb: 0, fb: 0, pu: 0, pull: 0, cent: 0, oppo: 0, ...c};
  const tb = p.h + p.h2 + 2 * p.h3 + 3 * p.hr;
  p.avg = p.ab ? p.h / p.ab : 0;
  p.obp = p.pa ? (p.h + p.bb) / p.pa : 0;
  p.slg = p.ab ? tb / p.ab : 0;
  p.ops = p.obp + p.slg;
  p.iso = p.slg - p.avg;
  p.k_pct = p.pa ? p.k / p.pa : 0;
  p.bb_pct = p.pa ? p.bb / p.pa : 0;
  for (const t of ['ld', 'gb', 'fb', 'pu']) p[`${t}_pct`] = p.bip ? p[t] / p.bip : 0;
  for (const t of ['pull', 'cent', 'oppo']) p[`${t}_pct`] = p.bip ? p[t] / p.bip : 0;
  p.tracked = p.bip > 0;
  p.wrc_plus = p.wrc_plus ?? 100;
  return p;
}
const RATES = {line: {hit: 0.9, tb: 1.3}, grounder: {hit: 0.2, tb: 0.21}, fly: {hit: 0.15, tb: 0.3}, popup: {hit: 0.02, tb: 0.02}};
// A league of ordinary hitters to compare against.
const base = () => Array.from({length: 8}, (_, i) => player(`隊員${i}`, {pa: 40, ab: 36, h: 19, h2: 4, h3: 1, hr: 1, bb: 4, k: 3, bip: 12, ld: 7, gb: 2, fb: 3, pull: 5, cent: 4, oppo: 3}));
const textOf = r => JSON.stringify([r.issues, r.strengths, r.insights, r.plan]);

test('shrinkage pulls small samples toward the team rate', () => {
  assert.equal(D.shrink(2, 5, 0.1, 20), (2 + 2) / 25);
  assert.ok(D.shrink(2, 5, 0.1, 20) < 2 / 5);
  assert.ok(Math.abs(D.shrink(40, 400, 0.1, 20) - 0.1) < 0.01);
});

test('percentiles are team-relative, clamped and can be inverted', () => {
  const list = [{v: 1}, {v: 2}, {v: 3}, {v: 4}, {v: 5}];
  assert.equal(D.percentile(5, list, 'v'), 1);
  assert.equal(D.percentile(1, list, 'v'), 0);
  assert.equal(D.percentile(1, list, 'v', true), 1);
  assert.ok(D.percentile(99, list, 'v') <= 1);
  assert.equal(D.percentile(NaN, list, 'v'), null);
});

test('team context uses totals, not averages of averages', () => {
  const team = D.teamContext([player('a', {pa: 10, ab: 10, h: 5, k: 1}), player('b', {pa: 30, ab: 30, h: 9, k: 6})], RATES);
  assert.equal(team.k, 7 / 40);
  assert.equal(team.avg, 14 / 40);
});

test('one strikeout in a few plate appearances is not a weakness', () => {
  const list = [...base(), player('新人', {pa: 6, ab: 6, h: 2, k: 1})];
  const r = D.analyze({players: list}, RATES).results.find(x => x.name === '新人');
  assert.ok(!r.issues.some(x => x.key === 'k'));
  assert.equal(r.reliability.level, 'low');
  assert.equal(r.archetype.label, '樣本累積中');
});

test('strikeouts that are mostly foul third strikes point at two-strike contact, not plate discipline', () => {
  const list = [...base(), player('界外K', {pa: 40, ab: 38, h: 15, bb: 2, k: 8, k_swing: 2, k_foul: 6, bip: 10, ld: 6, gb: 2, fb: 2})];
  const r = D.analyze({players: list}, RATES).results.find(x => x.name === '界外K');
  assert.equal(r.issues[0].key, 'k');
  assert.ok(r.insights.some(x => x.title.includes('界外')));
  assert.match(r.plan[0].focus, /界內/);
  assert.equal(r.archetype.label, '三振風險型');
});

test('fly-ball heavy hitters without power get the lost-hits estimate from the team rates', () => {
  const list = [...base(), player('高飛', {pa: 40, ab: 38, h: 13, h2: 1, bb: 2, k: 2, bip: 12, ld: 2, gb: 1, fb: 7, pu: 2})];
  const r = D.analyze({players: list}, RATES).results.find(x => x.name === '高飛');
  const air = r.issues.find(x => x.key === 'air');
  assert.ok(air, 'fly-ball issue');
  assert.match(air.evidence, /約多 7\.0 支安打/); // 7 fly balls × (0.90 − 0.15) + 2 pop-ups × (0.90 − 0.02)
  assert.ok(r.insights.some(x => x.title.includes('擊球點偏下')));
  assert.equal(r.plan[0].key, r.issues[0].key, 'plan follows issue priority');
  assert.ok(r.plan.length <= 3);
});

test('power hitters who fly out are told to flatten the swing, not that they lack power', () => {
  const list = [...base(), player('重砲', {pa: 40, ab: 37, h: 20, h2: 3, h3: 1, hr: 6, bb: 3, k: 2, bip: 12, ld: 3, gb: 1, fb: 8})];
  const r = D.analyze({players: list}, RATES).results.find(x => x.name === '重砲');
  assert.ok(r.insights.some(x => x.title.includes('力量型')));
  assert.ok(!r.issues.some(x => x.key === 'iso'));
  assert.ok(r.strengths.some(x => x.title === '長打火力'));
});

test('luck reads the same tracked sample in both directions', () => {
  const lucky = player('好運', {pa: 40, ab: 36, h: 19, bb: 4, k: 3, bip: 10, ld: 5, gb: 3, fb: 2, xba: 0.45, t_avg: 0.7});
  const unlucky = player('壞運', {pa: 40, ab: 36, h: 12, bb: 4, k: 3, bip: 10, ld: 8, gb: 1, fb: 1, xba: 0.8, t_avg: 0.5});
  const res = D.analyze({players: [...base(), lucky, unlucky]}, RATES).results;
  assert.ok(res.find(x => x.name === '好運').insights.some(x => x.title.includes('運氣偏好')));
  assert.ok(res.find(x => x.name === '壞運').insights.some(x => x.title.includes('運氣偏差')));
  assert.ok(res.find(x => x.name === '好運').luck);
});

test('every result has a plan and never claims data the scorebook does not record', () => {
  const list = [...base(), player('高飛', {pa: 40, ab: 38, h: 13, bb: 2, k: 2, bip: 12, ld: 2, gb: 1, fb: 7, pu: 2}), player('少', {pa: 3, ab: 3, h: 1})];
  for (const r of D.analyze({players: list}, RATES).results) {
    assert.ok(r.plan.length >= 1, r.name);
    assert.doesNotMatch(textOf(r), /追打|壞球|球路|球速|揮棒速度/, `${r.name}: no pitch-level claims`);
  }
});

test('analysis works without batted-ball rates and without tracked balls', () => {
  const list = base().map(p => ({...p, bip: 0, ld: 0, gb: 0, fb: 0, pu: 0, tracked: false}));
  for (const r of D.analyze({players: list}, null).results) {
    assert.equal(r.scores.quality, null);
    assert.ok(r.plan.length >= 1);
  }
});
