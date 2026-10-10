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
      const pages={}, heights={};
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
            chips:bar.hidden?[]:[...bar.querySelectorAll('button')].map(b=>b.textContent),
            total:document.documentElement.scrollHeight,header:document.getElementById('appHeader').getBoundingClientRect().height,
            start:panel.getBoundingClientRect().top+window.scrollY-(document.querySelector('#appWorkspace > div:not(.ui-page-heading):not(.ui-section-bar)')?.getBoundingClientRect().height||0)};
        });
        // No sideways scrolling anywhere (the jump-chip row is navigation, not content), and every folded
        // column comes back when its row is tapped — folding hides nothing for good.
        const fold=await page.evaluate(()=>{
          const panel=document.querySelector('[id^=panel]:not(.hidden)');
          const sideways=[...panel.querySelectorAll('*')].filter(el=>{if(!el.getClientRects().length)return false;const o=getComputedStyle(el).overflowX;return (o==='auto'||o==='scroll')&&el.scrollWidth>el.clientWidth+4;}).map(el=>el.id||el.className.toString().slice(0,30));
          const missing=[];
          for(const t of [...panel.querySelectorAll('table.ui-fold-table')].filter(t=>t.getClientRects().length)){
            const head=[...t.tHead.rows[0].cells];
            const folded=head.filter(c=>c.classList.contains('ui-col-folded')).map(c=>c.textContent.trim());
            const row=t.tBodies[0].rows[0];row.click();
            const shown=[...row.nextElementSibling.querySelectorAll('.ui-detail-grid > div > span')].map(s=>s.textContent);
            missing.push(...folded.filter(l=>!shown.includes(l)));
            row.click();
            if(row.nextElementSibling?.classList.contains('ui-row-detail'))missing.push('detail did not close');
          }
          return {sideways,missing};
        });
        assert.deepEqual(fold.sideways,[],`${width} ${name}: no sideways-scrolling content`);
        assert.deepEqual(fold.missing,[],`${width} ${name}: folded columns all reachable by tapping a row`);
        assert.deepEqual(r.small,[],`${width} ${name}: every control is at least 36×36`);
        assert.deepEqual(r.zoom,[],`${width} ${name}: no field under 16px (iOS would zoom)`);
        assert.deepEqual(r.tiny,[],`${width} ${name}: no text under 11px`);
        assert.equal(r.overflow,false,`${width} ${name}: no sideways page scroll`);
        if(LONG.includes(tab)) assert.ok(r.chips.length>=2,`${width} ${name}: section jump bar (${r.chips})`);
        assert.ok(r.chips.every(c=>c.length<=11),`${width} ${name}: short chip labels`);
        pages[name]=r.chips.length;
        heights[name]=r;
      }
      // Density: compact header, content soon after it, and every long page clearly shorter than before the
      // density pass (390 px heights measured on the same fixture, 2026/10/10).
      if(width===390) {
        const BEFORE={Overview:2851,Profile:6757,Leaderboard:2249,Analytics:5183,Compare:5120,Lineup:7667,'Scorebook-live':1924,'Scorebook-review':2588,Pitching:2255,Glossary:7906};
        for(const [name,before] of Object.entries(BEFORE)) assert.ok(heights[name].total<=before*0.9,`${name}: ${heights[name].total}px vs ${before}px before`);
        assert.ok(heights.Glossary.total<=BEFORE.Glossary*0.65,'glossary folds to an index');
        assert.ok(Object.values(heights).every(h=>h.header<=110),'header at most two compact rows');
        assert.ok(Object.values(heights).every(h=>h.start<=280),'content starts in the top third of the screen');
      }
      // A re-render with identical data rebuilds the rows; the phone layout must come back, not fall back to scrolling.
      for(const t of ['Leaderboard','Analytics','Lineup']) {
        await page.evaluate(t=>{switchMainTab(`tab${t}`);window.scrollTo(0,0);},t);
        await page.waitForTimeout(200);
        await page.evaluate(()=>renderAll()); // also re-renders the lineup tables
        await page.waitForTimeout(300);
        const after=await page.evaluate(()=>{const panel=document.querySelector('[id^=panel]:not(.hidden)');
          return {sideways:[...panel.querySelectorAll('*')].filter(el=>{if(!el.getClientRects().length)return false;const o=getComputedStyle(el).overflowX;return (o==='auto'||o==='scroll')&&el.scrollWidth>el.clientWidth+4;}).length,
            folded:[...panel.querySelectorAll('table.ui-fold-table')].filter(x=>x.getClientRects().length).every(x=>[...x.tBodies[0].rows].filter(r=>!r.classList.contains('ui-row-detail')).every(r=>r.querySelector('.ui-col-folded')))};});
        assert.deepEqual(after,{sideways:0,folded:true},`${width} ${t}: phone layout survives a re-render`);
      }
      // The comparison table keeps both players side by side; attendance bars keep their length.
      await page.evaluate(()=>{switchMainTab('tabCompare');window.scrollTo(0,0);});
      await page.waitForTimeout(250);
      const compare=await page.evaluate(()=>{const t=document.querySelector('#panelCompare table');return [...t.tHead.rows[0].cells].filter(c=>!c.classList.contains('ui-col-folded')&&c.getClientRects().length).map(c=>c.textContent.trim());});
      assert.equal(compare.filter(l=>/^#\d+\s/.test(l)).length,2,`${width}: both players visible in the comparison (${compare})`);
      assert.equal(await page.locator('[data-h2h-phone]').isVisible(),true,`${width}: two-player game list shown as phone blocks`);
      await page.evaluate(()=>{switchMainTab('tabOverview');window.scrollTo(0,0);});
      await page.waitForTimeout(250);
      const bars=await page.evaluate(()=>[...document.querySelectorAll('[data-attendance-row]')].slice(0,6).map(row=>{
        const fill=row.querySelector('[style*="width:"]');const track=fill.parentElement;
        return {pct:parseFloat(fill.style.width),ratio:fill.getBoundingClientRect().width/track.getBoundingClientRect().width,height:fill.getBoundingClientRect().height};}));
      for(const b of bars) assert.ok(Math.abs(b.ratio*100-b.pct)<=2&&b.height<=10,`${width}: attendance bar ${JSON.stringify(b)}`);
      // Folded glossary card opens on tap and shows its English name and full explanation.
      await page.evaluate(()=>{switchMainTab('tabGlossary');window.scrollTo(0,0);});
      await page.waitForTimeout(250);
      const card=page.locator('#panelGlossary .grid > .ui-fold').first();
      const hiddenBefore=await card.evaluate(c=>[...c.querySelectorAll('p')].slice(1).every(p=>getComputedStyle(p).display==='none'));
      await card.click();
      const opened=await card.evaluate(c=>({open:c.classList.contains('ui-open'),expanded:c.getAttribute('aria-expanded'),shown:[...c.querySelectorAll('p')].every(p=>getComputedStyle(p).display!=='none')}));
      assert.ok(hiddenBefore,'folded card hides the explanation');
      assert.deepEqual(opened,{open:true,expanded:'true',shown:true},'tapping a card opens it');
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
    assert.equal(await desk.evaluate(()=>document.querySelectorAll('.ui-fold-table, .ui-card-table, .ui-wrap-table, .ui-col-folded').length),0,'desktop tables are never folded');
    assert.equal(await desk.evaluate(()=>{switchMainTab('tabCompare');return document.querySelector('[data-h2h-phone]').getClientRects().length;}),0,'desktop keeps the full two-player table');
    await desk.close();
    fs.writeFileSync(path.join(output,'mobile-comfort-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:true,chips:report[390],output}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
