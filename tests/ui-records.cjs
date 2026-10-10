// Isolated preview only: the 生涯紀錄 page and the profile's career section, checked against an independent
// calculation from the raw logs; career records ignore the date filter; nothing is written.
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
    for(const [width,height] of [[1440,900],[390,844]]) {
      const page=await browser.newPage({viewport:{width,height},hasTouch:width<768,isMobile:width<768});
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
      await page.goto(url);
      await page.waitForFunction(()=>window.teamRecords&&allLogs.some(l=>String(l.id).startsWith('log_game_')));
      // The tab: opens from the navigation, hides every other page, and gives way again.
      if(width<768) await page.locator('#uiMoreNavigation').click();
      else if(await page.locator('#uiDrawerToggle').isVisible()) await page.locator('#uiDrawerToggle').click();
      await page.locator('#btnTabRecords').click();
      const tab=await page.evaluate(()=>({shown:[...document.querySelectorAll('main > [id^=panel]')].filter(p=>!p.classList.contains('hidden')).map(p=>p.id),
        active:document.getElementById('btnTabRecords').classList.contains('tab-active'),others:[...document.querySelectorAll('#mainNavigation > button.tab-active')].map(b=>b.id),
        title:document.getElementById('uiPageTitle').textContent}));
      assert.deepEqual(tab,{shown:['panelRecords'],active:true,others:['btnTabRecords'],title:'生涯紀錄'},'records tab is the only page shown');
      await page.screenshot({path:path.join(output,`${width}-Records.png`),fullPage:true});
      // Independent career totals from the raw logs (guests excluded, season summaries included).
      const check=await page.evaluate(()=>{
        const sum={};const games={};
        const key=l=>l.gameId||(String(l.id).match(/^log_(?:game|auto)_(.+)_[^_]+$/)||[])[1]||`${l.date}|${l.tag||''}`;
        const summary=t=>/總數據|彙總|總計/.test(String(t||''));
        for(const l of allLogs){if(!(Number(l.pa)>0)||isGuestPlayerName(l.name))continue;const s=sum[l.name]||(sum[l.name]={pa:0,h:0,hr:0,h2:0,h3:0,bb:0});for(const k of Object.keys(s))s[k]+=Number(l[k])||0;
          if(!summary(l.tag)){const g=(games[l.name]||(games[l.name]={}));const gk=key(l);const s2=g[gk]||(g[gk]={h:0,ab:0,hr:0});s2.h+=Number(l.h)||0;s2.ab+=Number(l.ab)||0;s2.hr+=Number(l.hr)||0;}}
        const names=Object.keys(sum);
        const top=f=>Math.max(...names.map(f));
        // Each card is marked data-record-card; its first row carries the leading value.
        const shown=title=>{const first=document.querySelector(`#panelRecords [data-record-card="${title}"] [data-record-row]`);return first?first.dataset.value:null;};
        const records=teamRecords.teamRecords();
        const threeHit=Math.max(...names.map(n=>Object.values(games[n]||{}).filter(g=>g.h>=3).length));
        return {players:records.length,expectedPlayers:names.length,
          h:[shown('安打'),String(top(n=>sum[n].h))],hr:[shown('全壘打'),String(top(n=>sum[n].hr))],
          singleH:[shown('單場安打'),String(Math.max(...names.flatMap(n=>Object.values(games[n]||{}).map(g=>g.h))))],
          threeHit:[shown('猛打賞'),threeHit?String(threeHit):null],
          rateMin:records.filter(r=>r.career.pa>=teamRecords.MIN_RATE_PA).length,
          rateShown:document.querySelectorAll('#panelRecords [data-record-card="打擊率"] [data-record-row]').length,
          rateNames:[...document.querySelectorAll('#panelRecords [data-record-card="打擊率"] [data-record-player]')].map(b=>b.dataset.recordPlayer).every(n=>sum[n].pa>=teamRecords.MIN_RATE_PA),
          hero:[...document.querySelectorAll('#panelRecords [data-record-hero]')].map(h=>h.dataset.recordHero),
          heroHits:document.querySelector('#panelRecords [data-record-hero="生涯安打王"]')?.textContent.includes(String(top(n=>sum[n].h))),
          grouped:[...document.querySelectorAll('#panelRecords [data-record-card="最長連續安打"] [data-record-row]')].map(r=>Number(r.dataset.value)).every((v,i,a)=>i===0||a[i-1]>v),
          locked:[...document.querySelectorAll('#panelRecords [data-record-locked] [data-record-card]')].map(x=>x.dataset.recordCard),
          lockedExpected:[['單場多轟',r=>r.fun.multiHr],['完全打擊',r=>r.fun.cycle],['猛打賞',r=>r.fun.threeHit],['多安打場',r=>r.fun.multiHit],['安打全中',r=>r.fun.perfect]].filter(([,f])=>!records.some(r=>f(r)>0)).map(([t])=>t),
          streak:records.every(r=>JSON.stringify(r.streaks)===JSON.stringify(teamInsights.streaks(teamInsights.playerGames(r.name,allLogs)))),
          pa:records.every(r=>r.career.pa===sum[r.name].pa)};
      });
      assert.equal(check.players,check.expectedPlayers,'every team player with a plate appearance');
      for(const k of ['h','hr','singleH','threeHit']) assert.equal(check[k][0],check[k][1],`${k} leader`);
      assert.ok(check.rateShown>=Math.min(5,check.rateMin)&&check.rateNames,'rate leaders only from players with enough PA');
      assert.deepEqual(check.hero,['生涯安打王','生涯全壘打王','生涯 OPS 王','單場最多安打','最長連續安打','最新里程碑'],'隊史之最 tiles');
      assert.ok(check.heroHits,'hit king tile shows the career hit total');
      assert.ok(check.grouped,'grouped cards: one row per value, highest first (ties share a row)');
      assert.deepEqual(check.locked.sort(),check.lockedExpected.sort(),'records nobody holds yet are listed as locked');
      assert.ok(check.streak&&check.pa,'streaks and career PA match the game logs');
      // Career records ignore the date filter.
      const before=await page.locator('#panelRecords').textContent();
      await page.evaluate(()=>{document.getElementById('filterStartDate').value='2026-09-20';document.getElementById('filterEndDate').value='2026-09-20';document.getElementById('filterEndDate').dispatchEvent(new Event('change'));renderAll();});
      assert.equal(await page.locator('#panelRecords').textContent(),before,'date filter does not change career records');
      await page.evaluate(()=>{document.getElementById('filterStartDate').value='';document.getElementById('filterEndDate').value='';renderAll();});
      // The team does not record RBI: no page shows it (records, scorer, review, glossary).
      const rbiPages=await page.evaluate(async()=>{
        const out=[];
        for(const t of ['Overview','Profile','Leaderboard','Compare','Records','Analytics','Pitching','Lineup','Scorebook','Glossary']){
          switchMainTab(`tab${t}`);
          for(const sub of t==='Scorebook'?['live','review','spray']:[null]){
            if(sub) switchScorebookSubTab(sub);
            await new Promise(r=>requestAnimationFrame(r));
            const text=document.querySelector('main > [id^=panel]:not(.hidden)').innerText;
            if(/打點|RBI/.test(text)) out.push(t+(sub?`/${sub}`:''));
          }
        }
        switchMainTab('tabRecords');
        return out;
      });
      assert.deepEqual(rbiPages,[],'no RBI anywhere');
      assert.equal(await page.locator('#rbiButtonGroup, [id^="rbi_"]').count(),0,'no RBI input in the scorer');
      // A name opens that player's profile, with the career section.
      const name=await page.locator('#panelRecords [data-record-player]').first().getAttribute('data-record-player');
      await page.locator('#panelRecords [data-record-player]').first().click();
      const profile=await page.evaluate(name=>{const s=document.getElementById('insightCareerSection');const rec=teamRecords.teamRecords().find(r=>r.name===name);
        const cells=[...s.querySelectorAll('[data-career-line] > div')].map(d=>[d.children[0].textContent,d.children[1].textContent]);
        return {visible:!document.getElementById('panelProfile').classList.contains('hidden'),records:document.getElementById('panelRecords').classList.contains('hidden'),
          title:s.querySelector('h3').textContent.includes(name),pa:cells.find(c=>c[0]==='打席')?.[1]===String(rec.career.pa),hits:cells.find(c=>c[0]==='安打')?.[1]===String(rec.career.h),
          // Profile order: profile, recent form, diagnosis, batted-ball types, spray, career last.
          last:s===[...document.querySelectorAll('#panelProfile > section')].filter(x=>x.getClientRects().length).at(-1)};},name);
      assert.deepEqual(profile,{visible:true,records:true,title:true,pa:true,hits:true,last:true},`profile career section for ${name}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'no sideways scroll');
      assert.deepEqual(errors,[]);
      assert.deepEqual(await page.evaluate(()=>window.__previewWrites),[],'records never write');
      await page.close();
    }
    console.log(JSON.stringify({passed:true,viewports:2,output}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
