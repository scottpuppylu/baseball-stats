// Isolated preview only: checks the read-only insight layer (game log, sample notes, post-game image).
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
  const report={};
  try {
    for(const [width,height] of [[1440,900],[390,844]]) {
      const page=await browser.newPage({viewport:{width,height},hasTouch:width<768,acceptDownloads:true});
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
      await page.goto(url);
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rebas_all_games')||'[]').length>0);
      // First visit (empty cache): scorebook games must already count, not only after a second load.
      await page.waitForFunction(()=>allLogs.some(l=>String(l.id).startsWith('log_game_')));
      assert.ok(await page.evaluate(()=>window.allGames===allGames && window.allLogs===allLogs),'window copies stay live');
      const firstVisitPa=await page.evaluate(()=>getFullAgg().players.reduce((s,p)=>s+p.pa,0));
      // A returning visitor: scorebook games are cached before the logs are rebuilt.
      await page.reload();
      await page.waitForFunction(()=>window.teamInsights && allLogs.some(l=>String(l.id).startsWith('log_game_')));
      assert.equal(await page.evaluate(()=>getFullAgg().players.reduce((s,p)=>s+p.pa,0)),firstVisitPa,'first and returning visits show the same totals');
      const players=await page.evaluate(()=>{
        document.getElementById('filterStartDate').value='';
        document.getElementById('filterEndDate').value='';
        renderAll();
        switchMainTab('tabProfile');
        const agg=getAnalysisAgg();
        return agg.players.map(p=>{
          selectedPlayerName=p.name;
          renderPlayerProfile(agg);
          const games=teamInsights.playerGames(p.name);
          return {name:p.name,pa:p.pa,ops:p.ops.toFixed(3),
            logPa:games.reduce((s,g)=>s+g.stats.pa,0),lastOps:games.at(-1)?.toDate.ops.toFixed(3) ?? '0.000',
            rows:document.querySelectorAll('#insightGameLogSection tbody tr').length,games:games.length,
            gameDates:games.filter(g=>!g.summary).map(g=>g.date),
            note:document.getElementById('insightSampleNote').textContent.trim().length>0};
        });
      });
      for(const p of players) {
        assert.equal(p.logPa,p.pa,`${p.name}: game log PA equals profile PA`);
        if(p.pa>0) assert.equal(p.lastOps,p.ops,`${p.name}: cumulative OPS ends at profile OPS`);
        assert.equal(p.rows,p.games,`${p.name}: one table row per game`);
        assert.equal(p.note,p.pa<20,`${p.name}: sample note only under 20 PA`);
      }
      // Two scorebook games on 2026-09-19 must stay separate.
      assert.ok(players.some(p=>p.gameDates.filter(d=>d==='2026-09-19').length===2));
      // The game log follows the date filter through the normal renderAll path.
      const filtered=await page.evaluate(()=>{
        document.getElementById('filterStartDate').value='2026-09-19';
        document.getElementById('filterEndDate').value='2026-09-19';
        document.getElementById('filterEndDate').dispatchEvent(new Event('change'));
        selectedPlayerName='簡承均';
        renderPlayerProfile(getAnalysisAgg());
        return [...document.querySelectorAll('#insightGameLogSection tbody tr td:first-child')].map(td=>td.textContent.trim());
      });
      assert.deepEqual(filtered,['2026-09-19','2026-09-19']);
      const compare=await page.evaluate(()=>{
        document.getElementById('filterStartDate').value='';
        document.getElementById('filterEndDate').value='';
        renderAll();
        switchMainTab('tabCompare');
        const agg=getFullAgg();
        const small=agg.players.find(p=>p.pa>0&&p.pa<20), big=agg.players.filter(p=>p.pa>=20);
        comparePlayerAName=small.name; comparePlayerBName=big[0].name; renderComparison(agg);
        const one=document.getElementById('insightCompareSampleNote').textContent;
        comparePlayerAName=big[0].name; comparePlayerBName=big[1].name; renderComparison(agg);
        return {one:one.includes(small.name)&&!one.includes(big[0].name),none:document.getElementById('insightCompareSampleNote').textContent.trim()===''};
      });
      assert.deepEqual(compare,{one:true,none:true});
      await page.evaluate(()=>{switchMainTab('tabScorebook');switchScorebookSubTab('review');renderSelectedGameReview('game_20260920_4922');});
      await page.locator('[data-insight-image]').click();
      await page.waitForSelector('#insightImageModal img');
      const image=await page.evaluate(()=>{const img=document.querySelector('#insightImageModal img');return {w:img.naturalWidth,h:img.naturalHeight};});
      assert.equal(image.w,1080);
      assert.ok(image.h>1000);
      const summary=await page.evaluate(()=>{const s=teamInsights.gameSummary(allGames.find(g=>g.id==='game_20260920_4922'));return {pa:s.rows.reduce((a,r)=>a+r.pa,0),h:s.rows.reduce((a,r)=>a+r.h,0)};});
      const review=await page.evaluate(()=>{const cells=[...document.querySelectorAll('#gameReviewDetailContainer tr')].find(tr=>tr.textContent.includes('合計')).querySelectorAll('td');return {pa:Number(cells[2].textContent),h:Number(cells[4].textContent)};});
      assert.deepEqual(summary,review,'image totals match the review box score');
      const [download]=await Promise.all([page.waitForEvent('download'),page.click('[data-insight="download"]')]);
      assert.match(download.suggestedFilename(),/^淡江航太系壘_2026-09-20_vs_.+\.png$/);
      await page.screenshot({path:path.join(output,`${width}-PostGameImage.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#insightImageModal').count(),0);
      await page.evaluate(()=>{isEditingReviewGame=true;renderSelectedGameReview('game_20260920_4922');});
      assert.equal(await page.locator('[data-insight-image]').count(),0,'no image button while editing');
      await page.evaluate(()=>{isEditingReviewGame=false;});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'page must not overflow');
      assert.deepEqual(errors,[]);
      assert.deepEqual(await page.evaluate(()=>window.__previewWrites),[]);
      // A saved manual log shows immediately (the write lands in preview memory only).
      const added=await page.evaluate(async()=>{
        const before=getFilteredLogs().length;
        const ok=await commitLogsToGitHub([...allLogs,{id:'log_qa_live_binding',date:'2026-10-10',tag:'QA',name:'簡承均',jersey:4,pa:1,ab:1,h:1,h1:1,h2:0,h3:0,hr:0,bb:0,sf:0,k:0}],'qa: live binding');
        return {ok,delta:getFilteredLogs().length-before};
      });
      assert.deepEqual(added,{ok:true,delta:1},'manual log appears without reload');
      report[width]={players:players.length,passed:true};
      await page.close();
    }
    fs.writeFileSync(path.join(output,'insights-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:true,viewports:Object.keys(report).length,output}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
