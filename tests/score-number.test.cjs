// A final score stored as text ("10", "9") must still compare, add up and print as numbers: as text "10" < "9", runs
// are glued together ("0" + "10" = "010"), and the value went into the page unescaped (V-40).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
function extract(source, marker, endMarker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  return source.slice(start, source.indexOf(endMarker, start) + endMarker.length);
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

test('V-40: the home page game card compares a text score as numbers and prints only numbers', () => {
  const ctx = vm.createContext({esc, shortDate: d => d, isGameScoreRecorded: () => true});
  vm.runInContext(extract(read('ui-app.js'), '  function gameCard(game) {', '\n  }\n'), ctx);
  const card = score => ctx.gameCard({id: 'g1', date: '2026-10-04', opponent: 'x', innings: [], finalScore: score});
  assert.match(card({us: '10', opp: '9'}), /fl-score is-win">10<i>:<\/i>9</, '10:9 is a win, not a loss');
  assert.match(card({us: '3', opp: '12'}), /fl-score is-loss">3<i>:<\/i>12</);
  assert.match(card({us: 4, opp: 2}), /fl-score is-win">4<i>:<\/i>2</, 'numbers unchanged');
  assert.doesNotMatch(card({us: '<b>1', opp: 0}), /<b>/, 'nothing but a number reaches the page');
});

test('V-40: the team game log reads the score as numbers for the record, runs and each row', () => {
  const source = read('team-insights.js');
  const ctx = vm.createContext({});
  vm.runInContext(extract(source, '  const scoreOf = ', ';\n').replace('const scoreOf', 'var scoreOf'), ctx);
  assert.deepEqual({...ctx.scoreOf({finalScore: {us: '10', opp: '9'}})}, {us: 10, opp: 9});
  assert.deepEqual({...ctx.scoreOf({finalScore: {us: '<b>', opp: null}})}, {us: 0, opp: 0});
  assert.deepEqual({...ctx.scoreOf({})}, {us: 0, opp: 0});
  const log = extract(source, 'function renderTeamGameLog(', '\n  }\n');
  assert.doesNotMatch(log, /=\s*g\.game\.finalScore\b/, 'the record and the rows use scoreOf, not the raw stored value');
  assert.equal((log.match(/scoreOf\(g\.game\)/g) || []).length, 2, 'record and row both go through scoreOf');
});
