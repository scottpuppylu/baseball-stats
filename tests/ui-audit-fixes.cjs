// All traffic and writes stay in the isolated preview. Regressions for the 2026/10/11 audit fixes.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
const output=process.env.UI_QA_OUTPUT||path.join(os.tmpdir(),'baseball-ui-qa');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const report={};let externalGitHub=0;
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,r=>{externalGitHub++;return r.abort();});
    await page.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
    await page.goto(url);
    await page.waitForFunction(()=>window.teamRecords&&document.getElementById('syncStatusBadge').textContent.includes('雲端已同步'));
    // 2, 3: exclusion survives rebuild and reload; login restores every complete field and the season total.
    const excluded=await page.evaluate(async()=>{
      const game=allGames[0];const expected=buildGameLogs(game);
      const season=()=>getFullAgg().players.reduce((s,p)=>s+p.pa,0);
      const before=season();await undoGameFromTeamLogs(game.id);syncAllGamesToTeamLogs();
      return {id:game.id,expected,before,after:season(),flag:game.excludedFromLogs,logged:isGameAlreadyLogged(game.id),writes:[...window.__previewWrites]};
    });
    assert.equal(excluded.flag,true);assert.equal(excluded.logged,false);
    assert.equal(excluded.before-excluded.after,excluded.expected.reduce((s,l)=>s+l.pa,0));
    assert.ok(excluded.writes.includes('data/games.json')&&excluded.writes.includes('data/logs.json'));
    const cloudCopy=await page.evaluate(async()=>JSON.parse(atob((await(await fetch('/__mock-api/data/games.json')).json()).content)));
    assert.equal(cloudCopy.find(g=>g.id===excluded.id).excludedFromLogs,true,'exclusion is stored in cloud preview, not just browser memory');
    await page.reload();
    await page.waitForFunction(id=>window.teamInsights&&allGames.find(g=>g.id===id)?.excludedFromLogs&&!document.getElementById('syncStatusBadge').textContent.includes('連線同步中'),excluded.id);
    assert.equal(await page.evaluate(id=>isGameAlreadyLogged(id),excluded.id),false);
    assert.equal(await page.evaluate(()=>getFullAgg().players.reduce((s,p)=>s+p.pa,0)),excluded.after);
    const logged=await page.evaluate(async id=>{
      selectedReviewGameId=id;await syncReviewGameToTeamLogs();
      const fromLogin=allLogs.filter(l=>l.gameId===id);syncAllGamesToTeamLogs();
      return {fromLogin,rebuilt:allLogs.filter(l=>l.gameId===id),excluded:!!allGames.find(g=>g.id===id).excludedFromLogs,logged:isGameAlreadyLogged(id),pa:getFullAgg().players.reduce((s,p)=>s+p.pa,0)};
    },excluded.id);
    assert.deepEqual(logged.fromLogin,excluded.expected);assert.deepEqual(logged.rebuilt,excluded.expected);
    assert.equal(logged.excluded,false);assert.equal(logged.logged,true);assert.equal(logged.pa,excluded.before);
    report.logs={excludedPa:excluded.before-excluded.after,restored:true,identicalFields:true};
    // 4: cloud failure falls back to static, then to cache, then to a declared failure; toast names the affected data.
    const fail=r=>r.fulfill({status:500,body:'{}'});
    await page.route('**/__mock-api/data/games.json?*',fail);
    await page.evaluate(()=>loadLogsFromGitHub());
    const partial=await page.locator('#syncStatusBadge').textContent();
    assert.doesNotMatch(partial,/雲端已同步/);assert.match(partial,/賽事.*備援/);
    await page.evaluate(()=>showCloudStatusToast());
    assert.match(await page.locator('#globalToastContainer').textContent(),/賽事/);
    await page.route('**/data/games.json?*',fail);
    const cached=await page.evaluate(()=>loadGamesFromGitHub());
    assert.equal(cached,'cache','both read paths fail: use the cache with its actual source');
    const failed=await page.evaluate(async()=>{localStorage.removeItem('rebas_all_games');return loadGamesFromGitHub();});
    assert.equal(failed,'failed');
    await page.unroute('**/data/games.json?*',fail);
    await page.unroute('**/__mock-api/data/games.json?*',fail);
    await page.evaluate(()=>loadLogsFromGitHub());
    assert.match(await page.locator('#syncStatusBadge').textContent(),/雲端已同步/);
    report.loading={partial,cache:cached,failed};
    // 5: all three pages discard the old tables, charts and extra analysis; removing the range restores them.
    await page.evaluate(()=>{
      selectedPlayerName='盧宣嘉';renderPlayerProfile(getAnalysisAgg());
      switchMainTab('tabLineup');selectAllAttendance();applyRecommendedToCustom();
      switchMainTab('tabCompare');renderComparison(getFullAgg());
    });
    const empty=await page.evaluate(()=>{
      document.getElementById('filterStartDate').value='2099-01-01';document.getElementById('filterEndDate').value='2099-12-31';renderAll();
      return {players:getFullAgg().players.length,
        rows:['recommendedLineupBody','customLineupTableBody','compareTableBody'].map(id=>document.getElementById(id).querySelectorAll('tr').length),
        charts:['radarChart','donutChart','profileBattedBallChart','profileSprayPolarChart','profileExpectedChart','compareRadarChart','lineupFlowChart'].map(id=>!!Chart.getChart(id)),
        select:['comparePlayerA','comparePlayerB'].map(id=>({disabled:document.getElementById(id).disabled,text:document.getElementById(id).textContent})),
        lineup:document.getElementById('lineupEvalMetrics').textContent,profile:document.getElementById('playerProfileBio').textContent,compare:document.getElementById('compareCardA').textContent,
        model:document.getElementById('lineupModelSummary')?.textContent||'',customModel:!!document.getElementById('customLineupModelCard'),
        compareLog:document.getElementById('insightCompareGameLogSection')?.textContent||'',sampleNote:document.getElementById('insightCompareSampleNote')?.textContent||'',
        statcast:document.getElementById('playerProfileCard').textContent,
        spray:['profileSprayPointsContainer','compareSprayPointsA','compareSprayPointsB'].map(id=>document.getElementById(id).querySelectorAll('circle').length)};
    });
    assert.equal(empty.players,0);assert.deepEqual(empty.rows,[0,0,0]);assert.ok(empty.charts.every(v=>!v));
    assert.ok(empty.select.every(s=>s.disabled&&s.text.includes('沒有打擊紀錄')));
    for(const field of ['lineup','profile','compare'])assert.match(empty[field],/此日期範圍內沒有打擊紀錄/);
    for(const field of ['model','compareLog','sampleNote','statcast'])assert.equal(empty[field],'');
    assert.equal(empty.customModel,false);assert.deepEqual(empty.spray,[0,0,0]);
    const restored=await page.evaluate(()=>{
      document.getElementById('filterStartDate').value='';document.getElementById('filterEndDate').value='';renderAll();
      return {rows:['recommendedLineupBody','customLineupTableBody','compareTableBody'].map(id=>document.getElementById(id).querySelectorAll('tr').length),
        charts:['radarChart','donutChart','profileBattedBallChart','profileSprayPolarChart','profileExpectedChart','compareRadarChart','lineupFlowChart'].map(id=>!!Chart.getChart(id)),
        enabled:!document.getElementById('comparePlayerA').disabled&&!document.getElementById('comparePlayerB').disabled,model:!!document.getElementById('lineupModelSummary')?.textContent,compareLog:!!document.getElementById('insightCompareGameLogSection')?.textContent};
    });
    assert.ok(restored.rows.every(n=>n>0));assert.ok(restored.charts.every(Boolean));assert.ok(restored.enabled&&restored.model&&restored.compareLog);
    report.emptyRange={cleared:true,recovered:true};
    // 6: the same player's discipline percentile is identical on both radar charts.
    const sdi=await page.evaluate(()=>{
      const agg=getFullAgg();selectedPlayerName='林楊大禎';comparePlayerAName=selectedPlayerName;comparePlayerBName='盧宣嘉';
      renderPlayerProfile(agg);renderComparison(agg);
      const p=agg.players.find(p=>p.name===selectedPlayerName);
      return {profile:Chart.getChart('radarChart').data.datasets[0].data[2],compare:Chart.getChart('compareRadarChart').data.datasets[0].data[2],expected:getPercentile(p.sdi,'sdi',agg.players)};
    });
    assert.equal(sdi.profile,sdi.expected);assert.equal(sdi.compare,sdi.expected);report.sdi=sdi;
    // 7: every point is inside identical axis limits, including AVG=0 and values above .800.
    const luck=await page.evaluate(()=>{
      renderLuckRegressionChart(getAnalysisAgg());const c=Chart.getChart('luckRegressionChart');
      const points=c.data.datasets[0].data;return {points,limits:[c.scales.x.min,c.scales.x.max,c.scales.y.min,c.scales.y.max],line:c.data.datasets[1].data};
    });
    const [xmin,xmax,ymin,ymax]=luck.limits;assert.equal(xmin,ymin);assert.equal(xmax,ymax);
    assert.ok(luck.points.length>0&&luck.points.some(p=>p.y===0)&&luck.points.some(p=>p.x>.8||p.y>.8),'fixture covers both previously clipped extremes');
    assert.ok(luck.points.every(p=>p.x>=xmin&&p.x<=xmax&&p.y>=ymin&&p.y<=ymax));
    assert.deepEqual(luck.line,[{x:xmin,y:xmin},{x:xmax,y:xmax}]);
    const noPoints=await page.evaluate(()=>{renderLuckRegressionChart({players:[]});const c=Chart.getChart('luckRegressionChart');const out={points:c.data.datasets[0].data.length,min:c.scales.x.min,max:c.scales.x.max};renderLuckRegressionChart(getAnalysisAgg());return out;});
    assert.deepEqual(noPoints,{points:0,min:0,max:1});report.luck={players:luck.points.length,limits:luck.limits};
    // 8: changing the actual select dispatches its inline handler and updates the chart's selected pitcher.
    await page.evaluate(()=>{
      window.__qaOriginalGames=allGames;
      const names=['盧宣嘉','田耕宇'];allGames=window.allGames=allGames.map((g,j)=>{
        const copy=JSON.parse(JSON.stringify(g));copy.pitcherName=names[j%2];
        copy.innings.forEach(i=>{if(!isInningOurBat(copy.ourRole,i.topBottom))i.defensiveEvents=[{pitcher:copy.pitcherName,type:j%2?'FO':'GO',outsAdded:1,runs:0}];});return copy;
      });selectedPitcherName=names[0];switchMainTab('tabPitching');renderPitchingStudio();
    });
    await page.locator('#pitchingPlayerSelect').selectOption('田耕宇');
    const pitcher=await page.evaluate(()=>{const p=getAggregatedPitcherStats().find(p=>p.name==='田耕宇');return {selected:selectedPitcherName,value:document.getElementById('pitchingPlayerSelect').value,data:Chart.getChart('pitcherOutProfileChart').data.datasets[0].data,expected:[p.go,p.fo,p.k_foul,p.k_swing,p.dp,p.runner_out]};});
    assert.equal(pitcher.selected,'田耕宇');assert.equal(pitcher.value,'田耕宇');assert.deepEqual(pitcher.data,pitcher.expected);assert.ok(pitcher.data[1]>0&&pitcher.data[0]===0);report.pitcher= {selected:pitcher.selected,chartUpdated:true};
    await page.evaluate(()=>{allGames=window.allGames=window.__qaOriginalGames;delete window.__qaOriginalGames;});
    // 11: scoreless means unrecorded; a positive tie is neutral, with the two actual outcomes preserved.
    const scores=await page.evaluate(()=>{
      switchMainTab('tabScorebook');switchScorebookSubTab('review');const game=allGames[0];const original=JSON.parse(JSON.stringify(game.finalScore));
      const out=[[0,0],[5,5],[6,3],[2,4]].map(([us,opp])=>{game.finalScore={us,opp};renderSelectedGameReview(game.id);const label=document.querySelector('#reviewGameSummaryBadge > div > span');return {us,opp,text:label.textContent.trim(),style:label.className};});
      game.finalScore=original;renderGameReview();return {out,option:document.querySelector('#reviewGameSelect option').textContent};
    });
    for(const [i,label]of ['比分未記錄','TIE 平手','VICTORY 勝利','DEFEAT 落敗'].entries())assert.ok(scores.out[i].text.includes(label));
    assert.doesNotMatch(scores.out[0].text,/0 - 0|DEFEAT|VICTORY|TIE/);assert.doesNotMatch(scores.out[1].style,/rose|emerald/);
    assert.match(scores.option,/比分未記錄/);report.scores=scores.out.map(s=>s.text);
    assert.deepEqual(errors,[],'no runtime errors across the new flows');assert.equal(externalGitHub,0,'no real GitHub traffic');
    fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'audit-fixes-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:true,checks:['complete-logs','persistent-exclusion','partial-loading','empty-recovery','consistent-sdi','full-chart-range','pitcher-selection','review-results'],externalGitHub,output}));
    await page.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
