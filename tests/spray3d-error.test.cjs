// spray3d.js (3D replay, postgame video, player video): a batter who reached on an error (E) reached first; he is not out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'spray3d.js'), 'utf8');
function load() {
  const window = {};
  const ctx = vm.createContext({window, document: {getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}},console, Math, Number, Object, Array, String, JSON});
  vm.runInContext(source, ctx);
  return window.spray3d;
}

test('V-39: a batter safe on an error reaches first, is not caught out, and is labelled 失誤上壘', () => {
  const s3 = load();
  for (const trajectory of ['grounder', 'line', 'fly', 'popup']) {
    const pa = {result: 'E', x: 0.42, y: 0.55, trajectory, location: 'SS', outsAtEnd: 1, outsAdded: 0};
    const play = s3.planPlay(pa);
    assert.equal(play.bases, 1, `${trajectory}: he runs to first and stays there`);
    assert.equal(play.ball.out, false, `${trajectory}: the ball is not shown as caught or thrown out`);
    assert.equal(s3.situation(play, play.done).result, '失誤上壘', 'the label is Chinese, not the code 「E」');
    assert.equal(s3.situation(play, play.done).outs, 1, 'no out is added');
  }
  // Without a landing point (the player video plays every plate appearance) he still reaches first.
  assert.equal(s3.planPlay({result: 'E'}).bases, 1);
  assert.equal(s3.LABEL.E, '失誤上壘');
});

test('outs and hits keep their meaning next to the error (unchanged)', () => {
  const s3 = load();
  const go = s3.planPlay({result: 'GO', x: 0.42, y: 0.55, trajectory: 'grounder'});
  assert.equal(go.bases, 0);
  assert.equal(go.ball.out, true);
  const single = s3.planPlay({result: '1H', x: 0.42, y: 0.4, trajectory: 'line'});
  assert.equal(single.bases, 1);
  assert.equal(single.ball.out, false);
  const fc = s3.planPlay({result: 'FC', x: 0.42, y: 0.55, trajectory: 'grounder'});
  assert.equal(fc.bases, 1);
  assert.equal(fc.ball.out, true, 'a fielder\'s choice is still fielded (an out elsewhere)');
});

test('V-39b: an error is drawn in the postgame page yellow (#fbbf24), not the out red, and the legend names it', () => {
  const s3 = load();
  assert.equal(s3.COLOR.E, '#fbbf24', 'same yellow as game-analysis.js COLOR.E');
  assert.notEqual(s3.COLOR.E, s3.COLOR.out);
  assert.match(source.replace(/\r\n/g, '\n'), /COLOR\.E\}"><\/i>失誤上壘/, 'the 3D legend shows the yellow dot as 失誤上壘');
  // Other results keep their colours.
  assert.deepEqual({...s3.COLOR, E: undefined}, {HR: '#f59e0b', '3H': '#a855f7', '2H': '#38bdf8', '1H': '#22c55e', BB: '#cbd5e1', out: '#f43f5e', E: undefined});
});
