const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const games=JSON.parse(fs.readFileSync(path.join(root,'data/games.json'),'utf8'));
const baseline=JSON.parse(execFileSync('git',['show','4af7a6c:data/games.json'],{cwd:root,encoding:'utf8'}));

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
  assert.deepEqual(original,baseline);
  const points=games.flatMap(g=>g.innings.flatMap(i=>i.plateAppearances||[]));
  assert.equal(points.filter(p=>p.x!==undefined&&p.y!==undefined&&p.trajectory!=='none'&&p.result!=='RUNNER_OUT'&&!p.isRunnerOut).length,68);
});

test('manual logs, avatars, tags and defense data are untouched',()=>{
  for(const file of ['logs','avatars','tags','defense']) {
    const current=JSON.parse(fs.readFileSync(path.join(root,'data',`${file}.json`),'utf8'));
    const old=JSON.parse(execFileSync('git',['show',`4af7a6c:data/${file}.json`],{cwd:root,encoding:'utf8'}));
    assert.deepEqual(current,old,file);
  }
});
