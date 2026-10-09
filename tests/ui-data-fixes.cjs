// Isolated preview only: runner outs are not plate appearances, and aggregate spray charts follow the date range.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const url=process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output=process.env.UI_QA_OUTPUT || path.join(os.tmpdir(),'baseball-ui-qa');
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
    await page.goto(url);
    await page.waitForFunction(()=>allLogs.some(l=>String(l.id).startsWith('log_game_')));
    // The 9/19 game holds one legacy runner-out record ('OUT', no flag) for 廖仲毅.
    const pa=await page.evaluate(()=>{
      document.getElementById('filterStartDate').value='';document.getElementById('filterEndDate').value='';renderAll();
      const name='廖仲毅';
      const gamePas=allGames.flatMap(g=>g.innings.flatMap(i=>i.plateAppearances||[])).filter(p=>p.batterName===name);
      const manual=allLogs.filter(l=>l.name===name&&!String(l.id).startsWith('log_game_')).reduce((s,l)=>s+(Number(l.pa)||0),0);
      const game=allGames.find(g=>g.innings.some(i=>(i.plateAppearances||[]).some(p=>p.result==='OUT')));
      renderSelectedGameReview(game.id);
      const row=[...document.querySelectorAll('#gameReviewDetailContainer tr')].find(tr=>tr.textContent.includes(name));
      return {legacy:gamePas.filter(p=>p.result==='OUT').length,expected:manual+gamePas.filter(p=>p.result!=='OUT').length,
        agg:getFullAgg().players.find(p=>p.name===name).pa,boxPa:Number(row.querySelectorAll('td')[2].textContent),
        boxExpected:game.innings.flatMap(i=>i.plateAppearances||[]).filter(p=>p.batterName===name&&p.result!=='OUT').length};
    });
    assert.ok(pa.legacy>=1,'fixture still holds the legacy runner out');
    assert.equal(pa.agg,pa.expected,'season PA excludes the runner out');
    assert.equal(pa.boxPa,pa.boxExpected,'review box score excludes the runner out');
    // Spray charts: an unarchived test game on 2026-10-05 appears only when the date range includes it.
    const spray=await page.evaluate(()=>{
      const original=allGames;
      const control=JSON.parse(JSON.stringify(original[0]));
      delete control.sprayChartArchive;
      control.id='qa_date_spray';control.date='2026-10-05';
      allGames=window.allGames=[...original,control];
      const name=control.innings.flatMap(i=>i.plateAppearances||[]).find(p=>p.x!=null&&p.trajectory!=='none').batterName;
      const player=getFullAgg().players.find(x=>x.name===name); // stats object for the dual chart, taken before narrowing dates
      const ids=['teamSpatialPointsContainer','sprayPointsContainer','profileSprayPointsContainer','compareSprayPointsA'];
      const count=()=>{
        document.getElementById('teamSprayPlayerFilter').value='all';document.getElementById('teamSprayTypeFilter').value='all';
        renderTeamSpatialLab(getAnalysisAgg());
        currentSprayFilter='all';renderSprayChartStudio();
        profileSprayFilter='all';renderPlayerStudioSprayChart(name);
        renderDualSprayCharts(player,player);
        return ids.map(id=>document.getElementById(id).querySelectorAll('circle').length);
      };
      const set=(s,e)=>{document.getElementById('filterStartDate').value=s;document.getElementById('filterEndDate').value=e;};
      set('','');const all=count();
      set('2026-10-01','2026-10-31');const inside=count();
      set('2026-09-01','2026-09-30');const outside=count();
      set('','');allGames=window.allGames=original;
      return {all,inside,outside};
    });
    assert.ok(spray.all.every(n=>n>0),`all dates ${spray.all}`);
    assert.deepEqual(spray.inside,spray.all,'range containing the game');
    assert.deepEqual(spray.outside,[0,0,0,0],'range excluding the game');
    assert.deepEqual(errors,[]);
    assert.deepEqual(await page.evaluate(()=>window.__previewWrites),[]);
    const result={passed:true,runnerOut:pa,spray,output};
    fs.writeFileSync(path.join(output,'data-fixes-report.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({passed:true,seasonPa:pa.agg,sprayAll:spray.all,output}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
