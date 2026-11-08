// A defensive event whose runs were stored as text ("2") was added as text: 0 + "2" + "1" = "021", so the pitcher's
// runs and runs per inning were wrong or NaN (V-42).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('    function getAggregatedPitcherStats() {');
assert.notEqual(start, -1);
const source = html.slice(start, html.indexOf('\n    }\n', start) + 7);

test('V-42: defensive runs stored as text add up as numbers; invalid values count as 0', () => {
  const game = {id: 'g1', date: '2026-10-04', ourRole: 'home', pitcherName: 'P1', innings: [{topBottom: 'top', defensiveEvents: [
    {type: 'HIT', pitcher: 'P1', runs: '2'}, {type: 'GO', pitcher: 'P1', runs: 1}, {type: 'FO', pitcher: 'P1', runs: 'x'},
    {type: 'K', pitcher: 'P1', runs: -3}, {type: 'BB', pitcher: 'P1'}]}]};
  const ctx = vm.createContext({
    window: {allGames: [game]}, allGames: [game], baselinePitchingStats: [],
    document: {getElementById: () => null},
    isInningOurBat: (role, half) => (role === 'home' ? half === 'bottom' : half === 'top'),
    isGuestPlayerName: () => false,
    defaultOutsForDefenseEvent: type => (['GO', 'FO', 'K'].includes(type) ? 1 : 0)
  });
  vm.runInContext(source, ctx);
  const p1 = ctx.getAggregatedPitcherStats().find(p => p.name === 'P1');
  assert.ok(p1, 'P1 listed');
  assert.strictEqual(p1.runs, 3);
});
