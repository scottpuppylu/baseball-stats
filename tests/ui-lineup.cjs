// Isolated preview only: checks the simulation-based lineup recommendation on the lineup page.
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
      const page=await browser.newPage({viewport:{width,height},hasTouch:width<768});
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('dialog',d=>d.accept());
      await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
      await page.goto(url);
      await page.waitForFunction(()=>window.LineupModel && allLogs.some(l=>String(l.id).startsWith('log_game_')));
      // First visit: default attendance is re-picked from cloud data (PA >= 14), grid included.
      const attendance=await page.evaluate(()=>{
        const hist={};
        allLogs.forEach(l=>{hist[l.name]=(hist[l.name]||0)+(Number(l.pa)||0);});
        const expected=Object.values(JERSEY_TO_NAME).filter(n=>(hist[n]||0)>=14).sort();
        return {present:[...presentPlayersSet].sort(),expected,badge:document.getElementById('attendanceCountBadge').textContent,
          button:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='PA≥14出席')};
      });
      assert.equal(attendance.expected.length>=10,true);
      assert.deepEqual(attendance.present,attendance.expected);
      assert.ok(attendance.present.includes('陳泓銘'));
      assert.ok(attendance.badge.includes(`${attendance.expected.length} 人`));
      assert.ok(attendance.button);
      // A coach's own attendance choice survives a later cloud refresh.
      const kept=await page.evaluate(async()=>{toggleAttendancePlayer('陳泓銘');await loadLogsFromGitHub();return presentPlayersSet.has('陳泓銘');});
      assert.equal(kept,false);
      // With more players present than slots, the player fielding P must come from the pitcher ranking.
      const pitching=await page.evaluate(()=>{
        const r=calculateRecommendedLineup(getFullAgg().players);
        const ranks=defenseRankings.P||DEFAULT_DEFENSE_RANKINGS.P||[];
        return {pitcher:r.items.find(i=>i.posInfo.posKey==='P')?.player.name,ranks,present:[...presentPlayersSet]};
      });
      if(pitching.ranks.some(n=>pitching.present.includes(n))) assert.ok(pitching.ranks.includes(pitching.pitcher),`P is ${pitching.pitcher}`);
      const rec=await page.evaluate(()=>{
        localStorage.removeItem('rebas_lineup_sim_settings');
        setDhRule(false);
        selectAllAttendance();
        switchMainTab('tabLineup');
        const r=calculateRecommendedLineup(getFullAgg().players);
        return {n:r.items.length,target:r.targetSize,names:r.items.map(i=>i.player.name),pitcher:r.items.some(i=>i.posInfo.posKey==='P'),
          runs:r.model.runs,legacy:r.model.legacyRuns,book:r.model.bookRuns,random:r.model.randomRuns,innings:r.model.detail.innings,pa:r.model.detail.paBySlot,
          rows:document.querySelectorAll('#recommendedLineupBody tr').length,summary:document.getElementById('lineupModelSummary').textContent,
          roles:r.items.map(i=>i.role),reasons:r.items.map(i=>i.reason)};
      });
      assert.equal(rec.n,rec.target);
      assert.equal(rec.rows,rec.target);
      assert.equal(new Set(rec.names).size,rec.n,'no duplicate hitters');
      assert.ok(rec.pitcher,'a pitcher bats');
      assert.ok(rec.runs>=rec.legacy-1e-9 && rec.runs>=rec.book-1e-9 && rec.runs>rec.random,'recommended order scores at least as much as every baseline');
      assert.ok(rec.innings>2 && rec.innings<=7);
      for(let i=1;i<rec.pa.length;i++) assert.ok(rec.pa[i]<=rec.pa[i-1]+1e-9,'plate appearances fall down the order');
      assert.ok(rec.summary.includes('分／場') && rec.summary.includes('模型如何計算'));
      assert.ok(rec.roles.every(r=>/每場 [\d.]+ 打席/.test(r)) && rec.reasons.every(r=>r.includes('校正後上壘率')));
      // Changing the game length re-renders with fewer innings; the setting is stored only as a preference.
      const shorter=await page.evaluate(()=>{
        const input=document.getElementById('lineupSimTime');input.value='60';input.dispatchEvent(new Event('change'));
        return {innings:calculateRecommendedLineup(getFullAgg().players).model.detail.innings,saved:JSON.parse(localStorage.getItem('rebas_lineup_sim_settings')).timeLimit,
          subtitle:document.getElementById('recLineupSubtitle').textContent};
      });
      assert.ok(shorter.innings<rec.innings);
      assert.equal(shorter.saved,60);
      assert.ok(shorter.subtitle.includes('60 分鐘'));
      await page.evaluate(()=>{const input=document.getElementById('lineupSimTime');input.value='90';input.dispatchEvent(new Event('change'));});
      // The custom lineup card compares against the recommendation, and applying it gives the same value.
      const custom=await page.evaluate(()=>{
        const before=document.getElementById('customLineupModelCard').textContent;
        applyRecommendedToCustom();
        const applied=document.getElementById('customLineupModelCard').textContent;
        const reversed=[...customLineup].reverse();
        reversed.forEach((n,i)=>{customLineup[i]=n;});
        evaluateCustomLineup(getFullAgg());
        return {before:before.length>0,applied,reversed:document.getElementById('customLineupModelCard').textContent};
      });
      assert.ok(custom.before && custom.applied.includes('與推薦打線幾乎相同'));
      assert.ok(custom.reversed.includes('比推薦打線少'));
      // Loading the recommendation into game setup uses the optimised order.
      const setup=await page.evaluate(()=>{loadLineupIntoGameSetup('recommended');return [...setupLineupList];});
      assert.deepEqual(setup,rec.names);
      // DH format: 11 hitters, one designated hitter.
      const dh=await page.evaluate(()=>{setDhRule(true);const r=calculateRecommendedLineup(getFullAgg().players);const out={n:r.items.length,dh:r.items.filter(i=>i.posInfo.isDh).length,rows:document.querySelectorAll('#recommendedLineupBody tr').length};setDhRule(false);return out;});
      assert.deepEqual(dh,{n:11,dh:1,rows:11});
      await page.locator('#lineupModelSummary').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`${width}-LineupModel.png`)});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'page must not overflow');
      assert.deepEqual(errors,[]);
      assert.deepEqual(await page.evaluate(()=>window.__previewWrites),[]);
      report[width]={runs:rec.runs,legacy:rec.legacy,book:rec.book,random:rec.random,innings:rec.innings,order:rec.names};
      await page.close();
    }
    fs.writeFileSync(path.join(output,'lineup-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:true,viewports:Object.keys(report).length,output}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
