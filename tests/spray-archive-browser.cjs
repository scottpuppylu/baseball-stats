// Isolated preview only: never exercise a production write.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
    await page.goto(process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rebas_all_games')||'[]').filter(g=>g.sprayChartArchive?.excluded).length===4);
    const result=await page.evaluate(async()=>{
      // Other QA scripts add games to the shared in-memory preview; start from the committed file.
      allGames=window.allGames=await (await fetch('/data/games.json',{cache:'no-store'})).json();
      const original=JSON.parse(JSON.stringify(allGames));
      const statsBefore=JSON.stringify(getAnalysisAgg());
      const name=original[0].innings.flatMap(i=>i.plateAppearances||[])[0].batterName;
      const player=getAnalysisAgg().players.find(p=>p.name===name);
      const counts=()=>{
        document.getElementById('teamSprayPlayerFilter').value='all';
        document.getElementById('teamSprayTypeFilter').value='all';
        renderTeamSpatialLab(getAnalysisAgg());
        document.getElementById('sprayPlayerSelect').innerHTML='';
        currentSprayFilter='all';
        renderSprayChartStudio();
        profileSprayFilter='all';
        renderPlayerStudioSprayChart(name);
        renderDualSprayCharts(player,player);
        return ['teamSpatialPointsContainer','sprayPointsContainer','profileSprayPointsContainer','compareSprayPointsA','compareSprayPointsB'].map(id=>document.getElementById(id).querySelectorAll('circle').length);
      };
      const archived=counts();
      const reviews=original.map(game=>{
        renderSelectedGameReview(game.id);
        return {points:document.querySelectorAll('#gameReviewDetailContainer svg circle').length,note:document.getElementById('gameReviewDetailContainer').textContent.includes('推估座標已封存')};
      });
      // An unarchived game still draws normally, including all result/player filters.
      const control=JSON.parse(JSON.stringify(original[0]));
      delete control.sprayChartArchive;
      control.id='qa_control_spray';
      control.date='2026-10-07';
      control.innings=[{...control.innings.find(i=>i.plateAppearances.length),plateAppearances:[original[0].innings.flatMap(i=>i.plateAppearances)[0]]}];
      allGames=[...original,control];
      const withControl=counts();
      renderSelectedGameReview(control.id);
      const controlReview=document.querySelectorAll('#gameReviewDetailContainer svg circle').length;
      const filters=[];
      for(const filter of ['all','hits','extra','outs']) {
        document.getElementById('teamSprayTypeFilter').value=filter;
        renderTeamSpatialLab(getAnalysisAgg());
        currentSprayFilter=filter;
        renderSprayChartStudio();
        profileSprayFilter=filter;
        renderPlayerStudioSprayChart(name);
        filters.push({filter,counts:['teamSpatialPointsContainer','sprayPointsContainer','profileSprayPointsContainer'].map(id=>document.getElementById(id).querySelectorAll('circle').length)});
      }
      allGames=original.map(({sprayChartArchive,...game})=>game);
      const restored=counts();
      const statsWithoutArchive=JSON.stringify(getAnalysisAgg());
      allGames=original;
      const final=counts();
      return {archived,reviews,withControl,controlReview,filters,restored,final,statsUnchanged:statsBefore===statsWithoutArchive,writes:window.__previewWrites};
    });
    assert.deepEqual(result.archived,[0,0,0,0,0]);
    assert.ok(result.reviews.every(r=>r.points===0&&r.note));
    assert.deepEqual(result.withControl,[1,1,1,1,1]);
    assert.equal(result.controlReview,1);
    for(const f of result.filters) assert.deepEqual(f.counts,Array(3).fill(['all','outs'].includes(f.filter)?1:0));
    assert.equal(result.restored[0],68);
    assert.equal(result.restored[1],68);
    assert.ok(result.restored.slice(2).every(n=>n>0));
    assert.deepEqual(result.final,[0,0,0,0,0]);
    assert.ok(result.statsUnchanged);
    assert.deepEqual(result.writes,[]);
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>{switchMainTab('tabAnalytics');renderTeamSpatialLab(getAnalysisAgg());});
    const output=process.env.UI_QA_OUTPUT || path.join(os.tmpdir(),'baseball-ui-qa');
    fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'spray-archived.png'),fullPage:true});
    fs.writeFileSync(path.join(output,'spray-archive-report.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({passed:true,archivedGames:4,archivedPoints:68,output}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
