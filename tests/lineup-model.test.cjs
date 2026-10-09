const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lineup-model.js');

const team = {bb: 0.115, k: 0.07, s1: 0.29, s2: 0.10, s3: 0.035, hr: 0.03, gbShare: 0.45, puShare: 0.10, prior: {...M.PRIOR_PA}};
const hitter = (name, pa, rates) => ({name, pa, bb: Math.round(pa * rates[0]), k: Math.round(pa * rates[1]), h1: Math.round(pa * rates[2]), h2: Math.round(pa * rates[3]), h3: Math.round(pa * rates[4]), hr: Math.round(pa * rates[5])});
const strong = hitter('強', 60, [0.15, 0.03, 0.35, 0.15, 0.05, 0.12]);
const weak = hitter('弱', 60, [0.05, 0.20, 0.20, 0.03, 0.00, 0.00]);
const permutations = list => list.length <= 1 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [x, ...p]));

test('a hitter with no plate appearances gets exactly the team rates, and probabilities sum to 1', () => {
  const m = M.batterModel({name: '新', pa: 0}, team);
  for (const e of ['bb', 'k', 's1', 's2', 's3', 'hr']) assert.ok(Math.abs(m.probs[e] - team[e]) < 1e-12, e);
  for (const p of [m, M.batterModel(strong, team), M.batterModel(weak, team)]) {
    const sum = M.EVENTS.reduce((s, e) => s + p.probs[e], 0);
    assert.ok(Math.abs(sum - 1) < 1e-12);
    assert.ok(M.EVENTS.every(e => p.probs[e] >= 0));
  }
});

test('more plate appearances move a hitter further from the team average', () => {
  const rates = [0.2, 0.0, 0.5, 0.1, 0.0, 0.1];
  const few = M.batterModel(hitter('少', 10, rates), team), many = M.batterModel(hitter('多', 100, rates), team);
  assert.ok(many.obp > few.obp && few.obp > M.batterModel({name: '平均', pa: 0}, team).obp);
  assert.ok(many.shrink < few.shrink);
});

test('empirical-Bayes prior weights are estimated within limits and fall back with few hitters', () => {
  assert.equal(M.estimatePriorPa([strong, weak]).estimated, false);
  const many = Array.from({length: 12}, (_, i) => hitter(`p${i}`, 30 + i, [0.05 + i * 0.01, 0.1, 0.25 + i * 0.01, 0.08, 0.02, 0.02 + i * 0.005]));
  const prior = M.estimatePriorPa(many);
  assert.equal(prior.estimated, true);
  for (const e of ['bb', 'k', 's1', 's2', 's3', 'hr']) assert.ok(prior[e] >= M.PRIOR_LIMITS[0] && prior[e] <= M.PRIOR_LIMITS[1], e);
});

test('every base/out transition conserves players: runners + batter = runners after + runs + outs added', () => {
  for (let outs = 0; outs < 3; outs++) for (let bases = 0; bases < 8; bases++) for (const event of M.EVENTS) {
    const outcomes = M.eventOutcomes(outs, bases, event, M.ADVANCE);
    const total = outcomes.reduce((s, o) => s + o[0], 0);
    assert.ok(Math.abs(total - 1) < 1e-12, `${outs}/${bases}/${event} probabilities`);
    const before = ((bases & 1) ? 1 : 0) + ((bases & 2) ? 1 : 0) + ((bases & 4) ? 1 : 0) + 1;
    for (const [, o2, b2, runs] of outcomes) {
      if (o2 >= 3) continue; // the inning ends and stranded runners leave the field
      const after = ((b2 & 1) ? 1 : 0) + ((b2 & 2) ? 1 : 0) + ((b2 & 4) ? 1 : 0);
      assert.equal(before, after + runs + (o2 - outs), `${outs}/${bases}/${event}`);
    }
  }
});

test('an all-strikeout lineup scores nothing and uses exactly three plate appearances per inning', () => {
  const k = {name: 'K', probs: {bb: 0, k: 1, s1: 0, s2: 0, s3: 0, hr: 0, go: 0, fo: 0, po: 0}};
  const compiled = Array.from({length: 10}, () => M.compileBatter(k, M.ADVANCE));
  const h = M.halfInning(compiled, 0);
  assert.equal(h.runs.reduce((a, b) => a + b, 0), 0);
  assert.ok(Math.abs(h.end[3] - 1) < 1e-12);
});

test('an MLB-like average hitter scores a realistic 3.5-6 runs over nine full innings', () => {
  const mlb = {bb: 0.085, k: 0.23, s1: 0.14, s2: 0.045, s3: 0.005, hr: 0.035, gbShare: 0.43, puShare: 0.10, prior: M.PRIOR_PA};
  const avg = M.averageBatter(mlb);
  const cfg = M.makeConfig({timeLimit: 1e9, maxInnings: 9, minutesPerPa: 0.01}, mlb, 9);
  const result = M.evaluateOrder(Array(9).fill(avg), Array.from({length: 9}, (_, i) => i), cfg);
  assert.ok(Math.abs(result.innings - 9) < 1e-9);
  assert.ok(result.runs > 3.5 && result.runs < 6, String(result.runs));
});

test('identical hitters give the same runs in any order, with plate appearances falling down the order', () => {
  const avg = M.averageBatter(team);
  const cfg = M.makeConfig({}, team, 10);
  const models = Array(10).fill(avg);
  const a = M.evaluateOrder(models, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], cfg), b = M.evaluateOrder(models, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], cfg);
  assert.ok(Math.abs(a.runs - b.runs) < 1e-9);
  for (let i = 1; i < 10; i++) assert.ok(a.paBySlot[i] <= a.paBySlot[i - 1] + 1e-12);
  assert.ok(a.paBySlot[0] - a.paBySlot[9] > 0.5, 'a timed game gives the top of the order clearly more chances');
});

test('the clock limits innings: slower pace or a hard stop means fewer innings', () => {
  const avg = M.averageBatter(team);
  const models = Array(10).fill(avg), order = models.map((m, i) => i);
  const fast = M.evaluateOrder(models, order, M.makeConfig({minutesPerPa: 1.2}, team, 10));
  const slow = M.evaluateOrder(models, order, M.makeConfig({minutesPerPa: 2.4}, team, 10));
  const hard = M.evaluateOrder(models, order, M.makeConfig({minutesPerPa: 2.4, rule: 'hardStop'}, team, 10));
  assert.ok(fast.innings > slow.innings && slow.innings >= hard.innings);
  assert.ok(fast.innings <= 7 + 1e-9);
});

test('calibration reproduces the historical number of offensive innings', () => {
  const t = M.calibrateMinutesPerPa(team, {timeLimit: 90, rule: 'noNewInning', maxInnings: 7}, 10, 3.75);
  const cfg = M.makeConfig({minutesPerPa: t}, team, 10);
  const avg = M.averageBatter(team);
  const innings = M.evaluateOrder(Array(10).fill(avg), Array.from({length: 10}, (_, i) => i), cfg).innings;
  // Whole plate appearances make expected innings a step function of pace, so match within 0.05.
  assert.ok(Math.abs(innings - 3.75) < 0.05, String(innings));
});

test('the optimiser matches an exhaustive search on six hitters and beats The Book and random orders', () => {
  const six = [strong, weak, hitter('中1', 40, [0.1, 0.1, 0.3, 0.08, 0.02, 0.03]), hitter('中2', 40, [0.15, 0.05, 0.25, 0.06, 0.01, 0.06]),
    hitter('中3', 40, [0.08, 0.12, 0.33, 0.1, 0.03, 0.01]), hitter('中4', 40, [0.12, 0.08, 0.28, 0.12, 0.02, 0.05])];
  const models = six.map(p => M.batterModel(p, team));
  const cfg = M.makeConfig({}, team, 6);
  const best = M.optimizeOrder(models, cfg);
  const exhaustive = Math.max(...permutations([0, 1, 2, 3, 4, 5]).map(o => M.evaluateOrder(models, o, cfg).runs));
  assert.ok(exhaustive - best.runs < 1e-9, `local search ${best.runs} vs exhaustive ${exhaustive}`);
  assert.ok(best.runs >= M.evaluateOrder(models, M.bookOrder(models), cfg).runs - 1e-12);
  assert.ok(best.runs > M.randomOrderMean(models, cfg));
  // The strong hitter never ends up at the bottom of the order.
  assert.ok(best.order.indexOf(0) < 4);
});
