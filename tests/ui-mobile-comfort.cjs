// Isolated preview only: phone comfort on every page — finger-sized targets, no iOS input zoom, no text under
// 11px, no sideways overflow, section jump bar, back-to-top, a pinned name column on wide tables, and no
// re-render loop. Desktop must not show the phone-only controls.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const url=process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output=process.env.UI_QA_OUTPUT || path.join(os.tmpdir(),'baseball-ui-qa');
const PAGES=[['Overview'],['Profile'],['Leaderboard'],['Analytics'],['Compare'],['Lineup'],['Scorebook','live'],['Scorebook','review'],['Scorebook','spray'],['Pitching'],['Glossary']];
const LONG=['Overview','Profile','Analytics','Compare','Lineup','Pitching','Glossary'];
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const report={};
  try {
    for(const [width,height] of [[390,844],[360,740]]) {
      const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true});
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
      await context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(()=>window.PlayerDiagnostics&&allLogs.some(l=>String(l.id).startsWith('log_game_')));
      const pages={};
      for(const [tab,sub] of PAGES) {
        const name=tab+(sub?`-${sub}`:'');
        await page.evaluate(([t,s])=>{switchMainTab(`tab${t}`);if(s)switchScorebookSubTab(s);window.scrollTo(0,0);},[tab,sub]);
        await page.waitForTimeout(250);
        const r=await page.evaluate(()=>{
          const panel=document.querySelector('[id^=panel]:not(.hidden)');
          const shown=el=>{const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')return false;const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&!el.closest('.hidden');};
          const targets=[...panel.querySelectorAll('button,a[href],select,input:not([type=hidden]),[onclick],[role=button],summary')].filter(shown)
            .filter(el=>el.type!=='checkbox'&&el.type!=='radio').filter(el=>{const b=el.getBoundingClientRect();return b.width<36||b.height<36;});
          const fields=[...document.querySelectorAll('#appHeader input, #appHeader select')].concat([...panel.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]),select,textarea')]).filter(shown)
            .filter(el=>parseFloat(getComputedStyle(el).fontSize)<16);
          const walker=document.createTreeWalker(panel,NodeFilter.SHOW_TEXT);const tiny=[];
          while(walker.nextNode()){const el=walker.currentNode.parentElement;if(!walker.currentNode.textContent.trim()||!shown(el))continue;if(parseFloat(getComputedStyle(el).fontSize)<11)tiny.push(walker.currentNode.textContent.trim().slice(0,12));}
          const bar=document.querySelector('.ui-section-bar');
          return {small:targets.map(el=>`${el.tagName}:${(el.textContent||'').trim().slice(0,10)}`),zoom:fields.map(el=>el.id||el.tagName),tiny:tiny.slice(0,5),
            overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
            chips:bar.hidden?[]:[...bar.querySelectorAll('button')].map(b=>b.textContent)};
        });
        assert.deepEqual(r.small,[],`${width} ${name}: every control is at least 36×36`);
        assert.deepEqual(r.zoom,[],`${width} ${name}: no field under 16px (iOS would zoom)`);
        assert.deepEqual(r.tiny,[],`${width} ${name}: no text under 11px`);
        assert.equal(r.overflow,false,`${width} ${name}: no sideways page scroll`);
        if(LONG.includes(tab)) assert.ok(r.chips.length>=2,`${width} ${name}: section jump bar (${r.chips})`);
        assert.ok(r.chips.every(c=>c.length<=11),`${width} ${name}: short chip labels`);
        pages[name]=r.chips.length;
      }
      // Jump bar: sticky, lands each section just under itself and marks it; back-to-top returns to 0.
      await page.evaluate(()=>{switchMainTab('tabProfile');window.scrollTo(0,0);});
      await page.waitForTimeout(250);
      const chips=await page.locator('.ui-section-bar button').allTextContents();
      for(const label of [chips[2],chips.at(-1)]) {
        await page.locator('.ui-section-bar button',{hasText:label}).click();
        await page.waitForFunction(label=>{const bar=document.querySelector('.ui-section-bar');return bar.querySelector('[aria-current]')?.textContent===label;},label,{timeout:5000});
        await page.waitForTimeout(700);
        const at=await page.evaluate(()=>{const bar=document.querySelector('.ui-section-bar');return {bar:bar.getBoundingClientRect().top,barH:bar.offsetHeight};});
        assert.ok(Math.abs(at.bar)<=1,`${width}: jump bar stays at the top (${at.bar})`);
      }
      assert.equal(await page.locator('.ui-back-top.is-visible').count(),0,'back-to-top stays out of the way while scrolling down');
      await page.mouse.wheel(0,-400);
      await page.waitForSelector('.ui-back-top.is-visible',{timeout:3000});
      await page.screenshot({path:path.join(output,`${width}-MobileJump.png`)});
      await page.locator('.ui-back-top').click();
      await page.waitForFunction(()=>window.scrollY===0,null,{timeout:5000});
      // Wide summary table: the name column stays put while the rest scrolls sideways.
      await page.evaluate(()=>switchMainTab('tabOverview'));
      await page.selectOption('#uiSummaryColumns','all');
      await page.waitForTimeout(300);
      const pinned=await page.evaluate(()=>{
        const table=document.querySelector('#viewSummary table');const area=table.closest('.ui-table-scroll');
        const before=table.tBodies[0].rows[0].cells[0].getBoundingClientRect().left;area.scrollLeft=500;
        return new Promise(res=>requestAnimationFrame(()=>res({sticky:table.classList.contains('ui-sticky-cols'),moved:Math.abs(table.tBodies[0].rows[0].cells[0].getBoundingClientRect().left-before),scrolled:area.scrollLeft})));
      });
      assert.ok(pinned.sticky&&pinned.scrolled>0&&pinned.moved<=1,`${width}: name column pinned while scrolling (${JSON.stringify(pinned)})`);
      // Pinned columns never take more than about half of a table.
      const wide=await page.evaluate(()=>[...document.querySelectorAll('.ui-sticky-cols')].map(t=>{const area=t.closest('.ui-table-scroll');const row=t.rows[0];const w=row.cells[0].getBoundingClientRect().width+(t.classList.contains('ui-sticky-two')?row.cells[1].getBoundingClientRect().width:0);return w/area.clientWidth;}));
      assert.ok(wide.every(x=>x<=0.53),`${width}: pinned share ${wide}`);
      // Live scoring during a game: the most-tapped controls are finger-sized.
      await page.evaluate(()=>switchMainTab('tabLineup'));
      await page.click('button[onclick="selectAllAttendance()"]');
      await page.click('#btnRuleNoDh');
      await page.click('button[onclick="applyRecommendedToCustom()"]');
      await page.evaluate(()=>{switchMainTab('tabScorebook');switchScorebookSubTab('live');});
      await page.fill('#setup_game_opponent',`手機測試-${width}`);
      await page.click('button[onclick="loadLineupIntoGameSetup(\'custom\')"]');
      await page.click('button[onclick="startNewGameFromSetup()"]');
      await page.waitForFunction(()=>activeGame&&activeGame.status==='in_progress');
      const live=await page.evaluate(()=>{
        const panel=document.getElementById('panelScorebook');
        const shown=el=>{const s=getComputedStyle(el);const b=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&b.width>0&&b.height>0&&!el.closest('.hidden');};
        const small=[...panel.querySelectorAll('button,select,input:not([type=hidden]),[onclick]')].filter(shown).filter(el=>el.type!=='checkbox'&&el.type!=='radio')
          .filter(el=>{const b=el.getBoundingClientRect();return b.width<36||b.height<36;}).map(el=>el.id||el.textContent.trim().slice(0,6));
        const rbi=document.getElementById('rbi_1').getBoundingClientRect();
        return {small,rbi:[Math.round(rbi.width),Math.round(rbi.height)],
          overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      });
      assert.deepEqual(live.small,[],`${width} live scoring: every control at least 36×36`);
      assert.ok(live.rbi[0]>=44&&live.rbi[1]>=44,`${width} live scoring: RBI buttons ${live.rbi}`);
      assert.equal(live.overflow,false,`${width} live scoring: no sideways scroll`);
      await page.screenshot({path:path.join(output,`${width}-MobileLive.png`),fullPage:true});
      await page.evaluate(()=>{activeGame=window.activeGame=null;localStorage.removeItem('rebas_active_game');});

      // Nothing keeps re-rendering while the page is idle.
      const idle=await page.evaluate(()=>new Promise(res=>{let n=0;const o=new MutationObserver(r=>{n+=r.length;});o.observe(document.getElementById('appWorkspace'),{subtree:true,attributes:true,childList:true});setTimeout(()=>{o.disconnect();res(n);},1200);}));
      assert.equal(idle,0,`${width}: no idle re-render loop`);
      assert.deepEqual(errors,[],`${width} runtime errors`);
      report[width]=pages;
      await context.close();
    }
    // Desktop keeps its layout: no phone controls, fields keep their size.
    const desk=await browser.newPage({viewport:{width:1440,height:900}});
    await desk.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
    await desk.goto(url);
    await desk.waitForFunction(()=>window.PlayerDiagnostics&&allLogs.length>0);
    await desk.evaluate(()=>{switchMainTab('tabProfile');window.scrollTo(0,3000);});
    await desk.waitForTimeout(300);
    assert.equal(await desk.locator('.ui-section-bar').isVisible(),false,'no jump bar on desktop');
    assert.equal(await desk.locator('.ui-back-top').isVisible(),false,'no back-to-top on desktop');
    assert.equal(await desk.evaluate(()=>document.querySelectorAll('.ui-sticky-cols').length),0,'no pinned columns on desktop');
    await desk.close();
    fs.writeFileSync(path.join(output,'mobile-comfort-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:true,chips:report[390],output}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
