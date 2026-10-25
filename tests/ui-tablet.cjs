const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const output=process.env.UI_QA_OUTPUT || path.join(os.tmpdir(),'baseball-ui-qa');
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.connectOverCDP(process.env.UI_CDP_URL || 'http://127.0.0.1:7293');
  const results=[];
  try {
    for(const [width,height,touch] of [[768,1024,true],[1024,768,true],[1280,800,true],[1366,1024,true],[1440,900,true],[1440,900,false]]) {
      const context=await browser.newContext({viewport:{width,height},hasTouch:touch});
      try {
        await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
        const page=await context.newPage();
        const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321');
        await page.waitForFunction(()=>document.getElementById('uiDrawerToggle') && Array.isArray(window.__previewWrites));
        const drawer=page.locator('#uiDrawerToggle');
        if(touch) {
          assert.ok(await drawer.isVisible());
          assert.equal(await page.locator('#mainNavigation').isVisible(),false,'drawer starts collapsed');
          // App shell (2026/10/26): one slim top bar — pages in the drawer (☰), every tool in one panel.
          const statusSelector='#flTopbar .fl-status-light';
          // The app opens on Home, where the date chip is hidden (Home is not filtered by page); data pages show it.
          await page.evaluate(()=>switchMainTab('tabOverview'));
          const barItems=['#uiDrawerToggle','#flTopbar .fl-top-logo','#uiDateToggle',statusSelector,'#flToolsButton'];
          for(const selector of barItems) assert.ok(await page.locator(selector).isVisible(),selector);
          const boxes=await Promise.all(barItems.map(selector=>page.locator(selector).boundingBox()));
          const centers=boxes.map(box=>box.y+box.height/2);
          assert.ok(Math.max(...centers)-Math.min(...centers)<3,'the top bar is one row');
          for(const box of boxes) assert.ok(box.x>=0 && box.x+box.width<=width,'each bar item fits inside viewport');
          const header=await page.locator('#appHeader').boundingBox();
          const workspace=await page.locator('#appWorkspace').boundingBox();
          assert.ok(header.height<=80,`slim top bar (${header.height})`);
          assert.ok(workspace.x<40,'collapsed drawer must release content width');
          await drawer.click();
          for(const name of ['Home','Overview','Analytics','Pitching','Records','Profile','Leaderboard','Compare','Health','Lineup','Scorebook','Glossary','Changelog']) assert.ok(await page.locator(`#btnTab${name}`).isVisible(),name);
          // Drawer title: small badge beside 所有功能, never the desktop sidebar's large centred badge (it was clipped).
          const title=await page.evaluate(()=>{const s=getComputedStyle(document.getElementById('mainNavigation'),'::before');return {content:s.content,bg:s.backgroundImage,size:s.backgroundSize,height:parseFloat(s.height)};});
          assert.equal(title.content,'"所有功能"');
          assert.match(title.bg,/logo-128\.webp/);
          assert.equal(title.size,'40px 40px');
          assert.ok(title.height>=40,`drawer title fits the badge (${title.height})`);
          await page.keyboard.press('Tab');
          assert.ok(await page.evaluate(()=>Boolean(document.activeElement.closest('#mainNavigation')) || document.activeElement.id==='uiDrawerToggle'));
          await page.keyboard.press('Escape');
          assert.equal(await drawer.getAttribute('aria-expanded'),'false');
          assert.equal(await page.locator('#mainNavigation').isVisible(),false);
          await drawer.click();
          await page.locator('#btnTabLeaderboard').click();
          assert.equal(await page.locator('#mainNavigation').isVisible(),false,'selecting a page collapses drawer');
          assert.ok(await page.locator('#panelLeaderboard').isVisible());
          assert.ok(await page.locator('.fl-subnav [data-sub="Leaderboard"][aria-current="page"]').isVisible(),'segmented control shows the group');
          await page.locator('#flToolsButton').click();
          for(const selector of ['button[onclick="manualRefresh()"]','button[onclick="openDefenseModal()"]','#btnToggleChien','#exportCsvBtn','#filterStartDate','#syncStatusBadge']) assert.ok(await page.locator(selector).isVisible(),selector);
          for(const text of ['系統建構：盧宣嘉',/^v\d{6}\.\d{4}$/]) assert.ok(await page.locator('#flTools').getByText(text,{exact:true}).isVisible(),String(text));
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#flTools').isVisible(),false,'Escape closes the tools panel');
          await page.locator(statusSelector).click();
          assert.ok(await page.locator('#globalToastContainer').isVisible());
          await page.screenshot({path:path.join(output,`${width}-TabletCompact.png`)});
        } else {
          assert.equal(await drawer.isVisible(),false,'desktop retains full sidebar');
          assert.ok(await page.locator('#mainNavigation').isVisible());
          const brand=page.locator('#mainNavigation > .fl-side-brand');
          assert.ok(await brand.isVisible(),'desktop sidebar shows the team badge');
          assert.deepEqual(await brand.locator('img').evaluate(img=>[img.offsetWidth,img.offsetHeight,img.complete&&img.naturalWidth>0]),[68,68,true]);
          assert.match(await brand.textContent(),/淡江航太系壘/);
          await page.locator('#flToolsButton').click();
          assert.ok(await page.locator('#flTools #syncStatusBadge').isVisible(),'cloud status lives in the tools panel');
          assert.ok(await page.locator('#flTools').getByText(/^v\d{6}\.\d{4}$/).isVisible(),'version shown in the tools panel');
          await page.keyboard.press('Escape');
          const bar=await page.locator('#appHeader').boundingBox();
          assert.ok(bar.height<=80,`desktop top bar stays on one line (${bar.height})`);
        }
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'page must not overflow');
        assert.deepEqual(errors,[]);
        assert.deepEqual(await page.evaluate(()=>window.__previewWrites),[]);
        results.push({width,height,touch,passed:true});
      } finally {await context.close();}
    }
    fs.writeFileSync(path.join(output,'tablet-report.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({passed:results.length,output}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
