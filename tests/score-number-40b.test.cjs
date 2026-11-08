// Scores stored as text ("10", "9") were compared as text in the game picker and the postgame image: "10" < "9", so a
// 10:9 win showed as a loss (V-40b, same fix as V-40).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const WIN = {status: 'final', finalScore: {us: '10', opp: '9'}};

test('V-40b: the game picker reads a text score as a number (game-analysis.js:114/118)', () => {
  const source = read('game-analysis.js').replace(/\n\}\)\(\);\s*$/, '\nwindow.__inner = {resultOf, scoreText};\n})();\n');
  const window = {siteHooks: {after() {}}};
  const ctx = vm.createContext({window, document: {getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}}, console, isGameScoreRecorded: () => true});
  vm.runInContext(source, ctx);
  const {resultOf, scoreText} = window.__inner;
  assert.equal(resultOf(WIN), 'win');
  assert.equal(resultOf({finalScore: {us: '3', opp: '12'}}), 'loss');
  assert.equal(scoreText(WIN), '10 : 9 ');
  assert.equal(scoreText({finalScore: {us: '<b>', opp: 2}}), '0 : 2 ', 'a stored value that is not a number shows as 0');
});

test('V-40b: the postgame image reads a text score as a number (team-insights.js:781)', () => {
  const source = read('team-insights.js');
  const helper = source.match(/\n  const scoreOf = [^\n]*\n/)[0];
  const start = source.indexOf('  function drawGameImage(game, options = {}) {');
  const cut = source.indexOf('\n', source.indexOf('    const result = ', start));
  const head = source.slice(start, cut) + '\n    return {score, result};\n  }\n';
  const ctx = vm.createContext({gameSummary: () => ({}), isGameScoreRecorded: () => true, IMG: {green: 'g', red: 'r', amber: 'a'}});
  vm.runInContext(helper + head, ctx);
  const out = ctx.drawGameImage(WIN);
  assert.equal(out.result[0], '勝');
  assert.strictEqual(out.score.us, 10);
  assert.strictEqual(out.score.opp, 9);
});
