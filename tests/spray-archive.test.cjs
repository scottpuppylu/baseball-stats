// Guards the one-time spray-chart archive (commit 8b790b8, 2026-10-07). It checks that commit against its
// parent in git history, so later legitimate edits by the team (new games, defence rankings…) never fail it.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const ARCHIVE='8b790b8';
const at=(rev,file)=>JSON.parse(execFileSync('git',['show',`${rev}:data/${file}.json`],{cwd:root,encoding:'utf8'}));
const games=at(ARCHIVE,'games');
const before=at(`${ARCHIVE}^`,'games');

test('only the four requested games receive an archive marker; every original field is preserved',()=>{
  assert.equal(games.filter(g=>g.sprayChartArchive?.excluded).length,4);
  for(const game of games) {
    const expected=['2026-09-19','2026-09-20'].includes(game.date);
    assert.equal(game.sprayChartArchive?.excluded===true,expected);
    if(expected) {
      assert.equal(game.sprayChartArchive.archivedAt,'2026-10-07');
      assert.match(game.sprayChartArchive.reason,/守位紀錄正確/);
    }
  }
  const original=games.map(({sprayChartArchive,...game})=>game);
  assert.deepEqual(original,before);
  const points=games.flatMap(g=>g.innings.flatMap(i=>i.plateAppearances||[]));
  assert.equal(points.filter(p=>p.x!==undefined&&p.y!==undefined&&p.trajectory!=='none'&&p.result!=='RUNNER_OUT'&&!p.isRunnerOut).length,68);
});

test('the archive left manual logs, avatars, tags and defense data untouched',()=>{
  for(const file of ['logs','avatars','tags','defense']) assert.deepEqual(at(ARCHIVE,file),at(`${ARCHIVE}^`,file),file);
});

test('the archived games still carry their markers in the current data',()=>{
  const current=JSON.parse(fs.readFileSync(path.join(root,'data','games.json'),'utf8'));
  for(const game of games.filter(g=>g.sprayChartArchive?.excluded)) {
    const now=current.find(g=>g.id===game.id);
    if(now) assert.deepEqual(now.sprayChartArchive,game.sprayChartArchive,game.id);
  }
});
