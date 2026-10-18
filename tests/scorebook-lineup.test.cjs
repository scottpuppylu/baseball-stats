const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function context(game = {}) {
  const c = vm.createContext({activeGame:game, POSITIONS:['P','C','1B','2B','3B','SS','LF','SF','RC','RF'].map(key=>({key})),
    localStorage:{setItem(){}},renderLiveScorer(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../scorebook-lineup.js'),'utf8'),c);
  return c;
}
const plain = x => JSON.parse(JSON.stringify(x));
test('legacy positions remain unknown and reading does not mutate the record', () => {
  const game = {lineup:['A','B','C'],pitcherName:'B',hasDh:true,dhSlot:3};
  const before = JSON.stringify(game), c = context(game);
  assert.deepEqual(plain(c.getGameLineupPositions()),['','P','DH']);
  assert.equal(JSON.stringify(game),before);
});
test('position swap moves DH and P together, snapshots and historical events stay immutable', () => {
  const game = {lineup:['A','B','C'],lineupPositions:['P','C','DH'],startingPositions:['P','C','DH'],hasDh:true,dhSlot:3,pitcherName:'A',currentInning:2,currentHalf:'top',innings:[{defensiveEvents:[{pitcher:'A'}]}]};
  const c = context(game);
  c.changeLiveLineupPosition(2,'P');
  assert.deepEqual(plain(game.lineupPositions),['DH','C','P']);
  assert.equal(game.pitcherName,'C'); assert.equal(game.dhSlot,1);
  assert.deepEqual(game.startingPositions,['P','C','DH']);
  assert.equal(game.innings[0].defensiveEvents[0].pitcher,'A');
  const history = JSON.stringify(game.positionChanges[0]);
  c.changeLiveLineupPosition(1,'P');
  assert.equal(JSON.stringify(game.positionChanges[0]),history);
  assert.equal(game.positionChanges.length,2);
});
test('clearing P requires a new pitching selection, while a bench-only pitcher survives unrelated edits', () => {
  const game = {lineup:['A','B'],lineupPositions:['P','C'],pitcherName:'A'};
  const c = context(game);
  c.changeLiveLineupPosition(0,''); assert.equal(game.pitcherName,null);
  c.alignLineupPitcher('BENCH');
  c.changeLiveLineupPosition(1,'1B'); assert.equal(game.pitcherName,'BENCH');
  assert.equal(game.lineupPositions.includes('P'),false);
  c.changeLiveLineupPosition(0,'P'); assert.equal(game.pitcherName,'A');
});
test('invalid and duplicate positions cannot create multiple fielders at one position', () => {
  const c = context({lineup:['A','B'],lineupPositions:['P','C'],pitcherName:'A'});
  assert.deepEqual(plain(c.normalizeLineupPositions(['A','B','C','D'],['P','P','DH','bad'],false)),['P','','','']);
  const before = JSON.stringify(c.activeGame);
  for (const [i,p] of [[-1,'C'],[2,'C'],[0,'DH'],[0,'bad']]) c.changeLiveLineupPosition(i,p);
  assert.equal(JSON.stringify(c.activeGame),before);
});
test('field markup escapes names and keeps DH off the ten-position field', () => {
  const c = context(); c.FIELD_BASE_SVG = '<rect />';
  const svg = c.lineupFieldMarkup(['<script>','DH name'],['P','DH']);
  assert.equal((svg.match(/data-position=/g)||[]).length,10);
  assert.ok(svg.includes('&lt;script&gt;')); assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('DH name（不列入場上守位）'));
});
