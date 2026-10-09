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
        localStorage.removeItem('rebas_lineup_locks');
        setDhRule(false);
        selectAllAttendance();
        switchMainTab('tabLineup');
        const r=calculateRecommendedLineup(getFullAgg().players);
        return {n:r.items.length,target:r.targetSize,names:r.items.map(i=>i.player.name),pitcher:r.items.some(i=>i.posInfo.posKey==='P'),
          runs:r.model.runs,legacy:r.model.legacyRuns,book:r.model.bookRuns,random:r.model.randomRuns,innings:r.model.detail.innings,pa:r.model.detail.paBySlot,third:r.model.detail.paAtLeast.map(x=>x[2]),
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
      // Chance of a third plate appearance: shown for every slot and falling down the order.
      assert.ok(rec.roles.every(r=>/打到第 3 次 \d+%/.test(r)));
      for(let i=1;i<rec.third.length;i++) assert.ok(rec.third[i]<=rec.third[i-1]+1e-9);
      assert.ok(rec.third[0]>0.5 && rec.third[0]-rec.third[rec.third.length-1]>0.3);
      assert.ok(rec.summary.includes('打到第 3 次的機率') && /全隊每場約 \d+ 打席/.test(rec.summary));
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
      // Slot locks: the locked hitter stays put, the rest is re-optimised, and the cost is shown.
      const lock=await page.evaluate(()=>{
        clearLineupLocks();
        const free=calculateRecommendedLineup(getFullAgg().players);
        setLineupLock('簡承均',2);
        const r=calculateRecommendedLineup(getFullAgg().players);
        const out={freeRuns:free.model.runs,lockedRuns:r.model.runs,freeRunsAfter:r.model.freeRuns,second:r.items[1].player.name,role:r.items[1].role,
          reason:r.items[1].reason,cost:document.getElementById('lineupLockCost')?.textContent||'',row:document.querySelectorAll('#recommendedLineupBody tr')[1].textContent,
          select:document.querySelector('[data-lock-name="簡承均"]').value};
        // Locking another hitter to the same slot replaces the first lock.
        setLineupLock('盧宣嘉',2);
        const replaced=calculateRecommendedLineup(getFullAgg().players);
        out.replacedSecond=replaced.items[1].player.name;
        out.stored=JSON.parse(localStorage.getItem('rebas_lineup_locks'));
        // Locking a present bench player makes them start in that slot.
        out.bench=[...presentPlayersSet].find(n=>getFullAgg().players.some(p=>p.name===n)&&!replaced.items.some(i=>i.player.name===n))||null;
        if(out.bench){setLineupLock(out.bench,9);out.benchSlot9=calculateRecommendedLineup(getFullAgg().players).items[8].player.name;}
        // A lock beyond the lineup length is reported, not applied.
        setLineupLock('簡承均',11);
        out.ignored=calculateRecommendedLineup(getFullAgg().players).model.ignoredLocks.join('|');
        clearLineupLocks();
        const cleared=calculateRecommendedLineup(getFullAgg().players);
        out.clearedRuns=cleared.model.runs;out.clearedLocked=cleared.model.lockedSlots.length;out.costAfterClear=!!document.getElementById('lineupLockCost');
        return out;
      });
      assert.equal(lock.second,'簡承均');
      assert.equal(lock.select,'2');
      assert.ok(lock.role.includes('🔒') && lock.row.includes('🔒') && lock.reason.includes('教練鎖定第 2 棒'));
      assert.ok(Math.abs(lock.freeRunsAfter-lock.freeRuns)<1e-9 && lock.lockedRuns<=lock.freeRuns+1e-9);
      assert.ok(lock.cost.includes('完全最佳化'));
      assert.equal(lock.replacedSecond,'盧宣嘉');
      assert.deepEqual(lock.stored,{'盧宣嘉':2});
      if(lock.bench) assert.equal(lock.benchSlot9,lock.bench);
      assert.ok(lock.ignored.includes('簡承均') && lock.ignored.includes('11'));
      assert.ok(Math.abs(lock.clearedRuns-lock.freeRuns)<1e-9 && lock.clearedLocked===0 && !lock.costAfterClear);
      report[`${width}-lock`]={freeRuns:lock.freeRuns,lockedRuns:lock.lockedRuns,cost:lock.freeRuns-lock.lockedRuns};
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
    console.log(JSON.stringify({passed:true,viewports:Object.keys(report).filter(k=>!k.endsWith('-lock')).length,output}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
