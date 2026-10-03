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
          assert.equal(await page.locator('#uiHeaderTools').isVisible(),false,'brand and tools start collapsed');
          const header=await page.locator('#appHeader').boundingBox();
          const workspace=await page.locator('#appWorkspace').boundingBox();
          assert.ok(header.height<=140,`compact header height ${header.height}`);
          assert.ok(workspace.x<40,'collapsed drawer must release content width');
          await drawer.click();
          for(const name of ['Overview','Profile','Leaderboard','Analytics','Compare','Lineup','Scorebook','Pitching','Glossary']) assert.ok(await page.locator(`#btnTab${name}`).isVisible());
          await page.keyboard.press('Tab');
          assert.ok(await page.evaluate(()=>Boolean(document.activeElement.closest('#mainNavigation')) || document.activeElement.id==='uiDrawerToggle'));
          await page.keyboard.press('Escape');
          assert.equal(await drawer.getAttribute('aria-expanded'),'false');
          assert.equal(await page.locator('#mainNavigation').isVisible(),false);
          await drawer.click();
          await page.locator('#btnTabLeaderboard').click();
          assert.equal(await page.locator('#mainNavigation').isVisible(),false,'selecting a page collapses drawer');
          assert.ok(await page.locator('#panelLeaderboard').isVisible());
          await page.locator('#uiToolsToggle').click();
          assert.ok(await page.locator('#uiHeaderTools').isVisible());
          for(const selector of ['button[onclick="manualRefresh()"]','button[onclick="openDefenseModal()"]','#btnToggleChien','#exportCsvBtn']) assert.ok(await page.locator(selector).isVisible(),selector);
          await page.locator('#uiToolsToggle').click();
          assert.equal(await page.locator('#uiHeaderTools').isVisible(),false);
          await page.locator('#uiCompactStatus').click();
          assert.ok(await page.locator('#globalToastContainer').isVisible());
          await page.screenshot({path:path.join(output,`${width}-TabletCompact.png`)});
        } else {
          assert.equal(await drawer.isVisible(),false,'desktop retains full sidebar');
          assert.ok(await page.locator('#mainNavigation').isVisible());
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
        assert.deepEqual(errors,[]);
        assert.deepEqual(await page.evaluate(()=>window.__previewWrites),[]);
        results.push({width,height,touch,passed:true});
      } finally {await context.close();}
    }
    fs.writeFileSync(path.join(output,'tablet-report.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({passed:results.length,output}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
