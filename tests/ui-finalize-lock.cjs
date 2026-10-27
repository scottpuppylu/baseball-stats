const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
(async()=>{
  for(const [name,launch] of [['chrome',()=>chromium.launch({channel:'chrome',headless:true})],['webkit',()=>webkit.launch()]]){
    const browser=await launch();
    try{
      const context=await browser.newContext({serviceWorkers:'block'});
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,r=>r.abort());
      await context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(()=>window.teamRecords&&!syncStatusBadge.textContent.includes('連線同步中'));
      const start=()=>page.evaluate(()=>{switchMainTab('tabScorebook');switchScorebookSubTab('live');startNewGameFromSetup();recordQuickWalk();return activeGame.id;});
      const id=await start();
      let release,puts=0;
      const gate=new Promise(resolve=>{release=resolve;});
      const delay=async route=>{if(route.request().method()==='PUT'){puts++;await gate;}return route.continue();};
      await context.route('**/__mock-api/**',delay);
      await page.evaluate(()=>{window.__finishPromise=finishActiveGameAndSyncLogs();});
      await page.waitForFunction(()=>window.__gameFinalizing===true);
      assert.equal(await page.evaluate(()=>panelScorebook.inert),true);
      assert.equal(await page.locator('button[onclick="finishActiveGameAndSyncLogs()"]').isDisabled(),true);
      const before=await page.evaluate(()=>JSON.stringify(activeGame));
      try{await page.locator('button[onclick="recordQuickWalk()"]').click({timeout:700});}
      catch(error){assert.match(error.name,/Timeout/);}
      await page.evaluate(()=>{
        recordQuickWalk();recordQuickStrikeout();recordRunnerOut();switchInningNext();discardActiveGame();
        deleteInningPlay(0);adjustOpponentScore(1);toggleBaseRunner('first');changeCurrentBatterIndex(1);
        changeLiveLineupPosition(0,'P');finishActiveGameAndSyncLogs();
      });
      assert.equal(await page.evaluate(()=>JSON.stringify(activeGame)),before,'all scoring/undo/lineup paths stay locked');
      release();await page.evaluate(()=>window.__finishPromise);
      assert.equal(await page.evaluate(()=>activeGame),null);
      assert.equal(await page.evaluate(()=>panelScorebook.inert),false);
      assert.equal(await page.evaluate(id=>allGames.find(g=>g.id===id).innings[0].plateAppearances.length,id),1);
      assert.equal(puts,2,'one games and one logs upload; repeated finish cannot double-submit');
      await context.unroute('**/__mock-api/**',delay);
      // Partial upload failure unlocks the same game and preserves all plays for retry.
      const second=await start();
      const fail=route=>route.request().method()==='PUT'&&route.request().url().includes('/logs.json')?route.fulfill({status:503,body:'{}'}):route.continue();
      await context.route('**/__mock-api/**',fail);
      await page.evaluate(()=>finishActiveGameAndSyncLogs());
      assert.equal(await page.evaluate(()=>activeGame.id),second);
      assert.equal(await page.evaluate(()=>window.__gameFinalizing),false);
      assert.equal(await page.evaluate(()=>panelScorebook.inert),false);
      await page.evaluate(()=>recordQuickWalk());
      await context.unroute('**/__mock-api/**',fail);
      await page.evaluate(()=>finishActiveGameAndSyncLogs());
      assert.equal(await page.evaluate(()=>activeGame),null);
      assert.equal(await page.evaluate(id=>allGames.find(g=>g.id===id).innings[0].plateAppearances.length,second),2);
      assert.deepEqual(errors,[]);await context.close();console.log(name+': finalization lock/success/partial failure/retry PASS');
    }finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
