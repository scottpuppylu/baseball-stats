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
      // Head-to-head game log on the compare page: every pair adds up to each player's own totals.
      const h2h=await page.evaluate(()=>{
        const agg=getFullAgg();
        const names=agg.players.filter(p=>p.pa>0).map(p=>p.name);
        const pairs=names.slice(1).map(n=>[names[0],n]).concat([[names[1],names[2]]]);
        const out=pairs.map(([a,b])=>{
          comparePlayerAName=a;comparePlayerBName=b;renderComparison(agg);
          const section=document.getElementById('insightCompareGameLogSection');
          const ga=teamInsights.playerGames(a),gb=teamInsights.playerGames(b);
          const keys=new Set([...ga,...gb].map(g=>g.key));
          const kb=new Set(gb.filter(g=>!g.summary).map(g=>g.key));
          const shared=ga.filter(g=>!g.summary&&kb.has(g.key));
          const sum=offset=>[...section.querySelectorAll('tbody tr')].reduce((s,tr)=>{
            const td=tr.querySelectorAll('td');
            // "未出賽" collapses a player's five cells into one.
            const cells=[...td].slice(2);
            const first=offset===0?cells[0]:(cells[0].colSpan>1?cells[1]:cells[5]);
            const m=first&&first.textContent.match(/^(\d+)-(\d+)$/);
            return m?{h:s.h+Number(m[1]),ab:s.ab+Number(m[2])}:s;
          },{h:0,ab:0});
          const pa=agg.players.find(p=>p.name===a),pb=agg.players.find(p=>p.name===b);
          const cards=[...section.querySelectorAll('[data-h2h-card]')].map(c=>c.textContent);
          const fa=teamInsights.form(ga);
          return {a,b,rows:section.querySelectorAll('tbody tr').length,keys:keys.size,
            sharedText:section.querySelector('[data-h2h-shared]').textContent.includes(`同場出賽 ${shared.length} 場`),
            sumA:sum(0),sumB:sum(1),totA:{h:pa.h,ab:pa.ab},totB:{h:pb.h,ab:pb.ab},
            cardOps:!fa.recent||cards[0].includes(`OPS ${fa.recent.ops.toFixed(3).replace(/^0\./,'.')}`),
            hot:section.querySelectorAll('[data-h2h-card] .text-emerald-300').length<=1,
            svg:section.querySelectorAll('svg polyline').length};
        });
        comparePlayerAName=names[0];comparePlayerBName=names[0];renderComparison(agg);
        const same=document.getElementById('insightCompareGameLogSection').textContent.includes('請在上方選擇兩位不同的球員');
        comparePlayerAName=names[0];comparePlayerBName=names[1];renderComparison(agg);
        document.getElementById('insightCompareGameLogSection').scrollIntoView();
        return {out,same,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      });
      for(const r of h2h.out) {
        assert.equal(r.rows,r.keys,`${r.a} vs ${r.b}: one row per game either played`);
        assert.ok(r.sharedText,`${r.a} vs ${r.b}: shared game count`);
        assert.deepEqual(r.sumA,r.totA,`${r.a}: H-AB cells add up to the profile totals`);
        assert.deepEqual(r.sumB,r.totB,`${r.b}: H-AB cells add up to the profile totals`);
        assert.ok(r.cardOps,`${r.a}: recent OPS matches the profile game log`);
        assert.ok(r.hot,'at most one player is marked hotter');
      }
      assert.ok(h2h.out.some(r=>r.svg===2),'dual OPS trend draws both players');
      assert.ok(h2h.same,'same player twice asks for two players');
      assert.ok(!h2h.overflow,'compare page must not overflow');
      await page.screenshot({path:path.join(output,`${width}-CompareGameLog.png`)});
      // Team game log and player form board on the analytics page.
      const team=await page.evaluate(()=>{
        switchMainTab('tabAnalytics');
        renderAll();
        const section=document.getElementById('insightTeamGameLogSection');
        const agg=getAnalysisAgg();
        const names=new Set(agg.players.map(p=>p.name));
        const summary=t=>/總數據|彙總|總計/.test(String(t||''));
        const logs=getFilteredLogs().filter(l=>names.has(l.name)&&!summary(l.tag));
        const t=logs.reduce((s,l)=>{for(const k of ['pa','ab','h','h2','h3','hr','bb','sf'])s[k]+=Number(l[k])||0;return s;},{pa:0,ab:0,h:0,h2:0,h3:0,hr:0,bb:0,sf:0});
        const tb=t.h+t.h2+2*t.h3+3*t.hr;
        const ops=(t.h+t.bb)/(t.ab+t.bb+t.sf)+tb/t.ab;
        const cells=[...section.querySelectorAll('[data-team-log] tbody tr')].map(tr=>tr.querySelectorAll('td')[5].textContent.split('-').map(Number));
        const games=teamInsights.teamGames(names);
        const scored=games.filter(g=>g.game&&g.game.finalScore&&(g.game.finalScore.us||0)+(g.game.finalScore.opp||0)>0);
        const wins=scored.filter(g=>g.game.finalScore.us>g.game.finalScore.opp).length;
        const board=[...section.querySelectorAll('[data-form-board] tbody tr')].map(tr=>tr.querySelector('[data-insight-player]').dataset.insightPlayer);
        const expectedBoard=agg.players.filter(p=>teamInsights.playerGames(p.name).some(g=>!g.summary)).length;
        const order=teamInsights.formBoard(agg);
        const sorted=order.every((p,i)=>i===0||order[i-1].comparable>p.comparable||(order[i-1].comparable===p.comparable&&order[i-1].diff>=p.diff));
        return {rows:cells.length,keys:new Set(logs.filter(l=>Number(l.pa)>0).map(l=>l.gameId||(String(l.id).match(/^log_(?:game|auto)_(.+)_[^_]+$/)||[])[1]||`${l.date}|${l.tag||''}`)).size,
          h:cells.reduce((s,c)=>s+c[0],0),ab:cells.reduce((s,c)=>s+c[1],0),t,
          seasonOps:section.querySelector('[data-team-season]').textContent.includes(`OPS ${ops.toFixed(3).replace(/^0\./,'.')}`),
          record:scored.length?section.querySelector('[data-team-season]').textContent.includes(`${wins} 勝`):!section.querySelector('[data-team-season]').textContent.includes('戰績'),
          noFakeTies:![...section.querySelectorAll('[data-team-log] tbody tr')].some(tr=>tr.textContent.includes('0:0')),
          board:board.length,expectedBoard,sorted,first:board[0],
          after:section.previousElementSibling===document.querySelector('#panelAnalytics > section'),
          overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      });
      assert.equal(team.rows,team.keys,'one team row per single game');
      assert.deepEqual([team.h,team.ab],[team.t.h,team.t.ab],'team H-AB rows add up to the period totals');
      assert.ok(team.seasonOps,'team period OPS matches an independent calculation');
      assert.ok(team.record,'record shown only from recorded scores');
      assert.ok(team.noFakeTies,'unrecorded 0:0 finals are not shown as ties');
      assert.equal(team.board,team.expectedBoard,'form board lists every player with a single game');
      assert.ok(team.sorted,'form board sorted: comparable first, biggest rise first');
      assert.ok(team.after,'section sits right after the quadrant and custom charts');
      assert.ok(!team.overflow,'analytics page must not overflow');
      await page.locator('#insightTeamGameLogSection').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`${width}-AnalyticsGameLog.png`)});
      // A name opens that player's profile and game log.
      await page.locator(`#insightTeamGameLogSection [data-insight-player="${team.first}"]`).click();
      assert.ok(await page.locator('#panelProfile').isVisible(),'name opens the profile');
      assert.match(await page.locator('#insightGameLogSection h3').textContent(),new RegExp(team.first));
      // The "exclude 簡承均" setting applies here like the rest of the analytics page.
      const excluded=await page.evaluate(()=>{
        if(includeChien) toggleChienFilter();
        switchMainTab('tabAnalytics');renderAll();
        const names=[...document.querySelectorAll('#insightTeamGameLogSection [data-insight-player]')].map(b=>b.dataset.insightPlayer);
        toggleChienFilter();renderAll();
        return {without:!names.includes('簡承均'),back:[...document.querySelectorAll('#insightTeamGameLogSection [data-insight-player]')].some(b=>b.dataset.insightPlayer==='簡承均')};
      });
      assert.deepEqual(excluded,{without:true,back:true},'form board follows the 簡承均 setting');
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
