// Isolated preview only. No requests can reach GitHub, including retries.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
const ready=page=>page.waitForFunction(()=>window.teamRecords&&!syncStatusBadge.textContent.includes('連線同步中'));
(async()=>{
  for(const [name,launch] of [['chrome',()=>chromium.launch({channel:'chrome',headless:true})],['webkit',()=>webkit.launch()]]){
    const browser=await launch();
    try{
      const context=await browser.newContext({serviceWorkers:'block'});
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,r=>r.abort());
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url);await ready(page);
      // Retrying the same manual form must reuse its durable record ID, including after a failed save.
      const manualFailure=route=>route.request().method()==='PUT'?route.fulfill({status:503,body:'{}'}):route.continue();
      await context.route('**/__mock-api/**',manualFailure);
      await page.evaluate(()=>{
        new_date.value='2026-10-28';new_jersey.value=Object.keys(JERSEY_TO_NAME)[0];new_pa.value='1';
        addLogForm.dispatchEvent(new Event('submit',{cancelable:true}));
      });
      await page.waitForFunction(()=>addLogForm.dataset.pendingId&&allLogs.some(l=>l.id===addLogForm.dataset.pendingId)).catch(async error=>{
        console.log(JSON.stringify(await page.evaluate(()=>({drafts:window.SyncDrafts?.status(),cache:LocalCache.status(),badge:syncStatusBadge.textContent,toasts:globalToastContainer.textContent,errors:window.__draftErrors||[]}))));throw error;
      });
      const manualId=await page.evaluate(()=>addLogForm.dataset.pendingId);
      await context.unroute('**/__mock-api/**',manualFailure);
      await page.evaluate(()=>addLogForm.dispatchEvent(new Event('submit',{cancelable:true})));
      await page.waitForFunction(()=>!addLogForm.dataset.pendingId);
      assert.equal(await page.evaluate(id=>allLogs.filter(l=>l.id===id).length,manualId),1);
      const score=name==='chrome'?12:13;
      const original=await page.evaluate(()=>allGames.map(g=>({id:g.id,score:g.finalScore})));
      assert.ok(original.length>1);
      const blockWrites=route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:'{"message":"isolated outage"}'}):route.continue();
      await context.route('**/__mock-api/**',blockWrites);
      assert.equal(await page.evaluate(async score=>{allGames[0].finalScore={us:score,opp:8};allGames.splice(1,1);return commitGamesToGitHub(allGames);},score),false);
      await page.waitForSelector('#uiSyncDraftWarning').catch(async error=>{
        console.log(JSON.stringify(await page.evaluate(()=>({drafts:window.SyncDrafts?.status(),cache:LocalCache.status(),badge:syncStatusBadge.textContent,bar:document.getElementById('uiSyncDraftWarning')?.outerHTML}))));throw error;
      });
      await page.reload();await ready(page);
      assert.equal(await page.evaluate(id=>allGames.find(g=>g.id===id).finalScore.us,original[0].id),score);
      assert.equal(await page.evaluate(id=>allGames.some(g=>g.id===id),original[1].id),false,'failed deletion must not resurrect');
      await context.unroute('**/__mock-api/**',blockWrites);
      // A readable raw/static fallback must not erase drafts when the API is rate limited.
      const blockReads=route=>route.request().method()==='GET'?route.fulfill({status:403,body:'{}'}):route.continue();
      await context.route('**/__mock-api/**',blockReads);
      await page.reload();await ready(page);
      assert.equal(await page.evaluate(id=>allGames.find(g=>g.id===id).finalScore.us,original[0].id),score);
      assert.equal(await page.evaluate(id=>allGames.some(g=>g.id===id),original[1].id),false);
      await context.unroute('**/__mock-api/**',blockReads);
      assert.equal(await page.evaluate(()=>retryPendingSync()),true);
      assert.equal(await page.evaluate(()=>SyncDrafts.status().pending),0);
      await page.reload();await ready(page);
      assert.equal(await page.evaluate(id=>allGames.find(g=>g.id===id).finalScore.us,original[0].id),score);
      assert.equal(await page.evaluate(id=>allGames.some(g=>g.id===id),original[1].id),false);
      assert.deepEqual(errors,[]);await context.close();console.log(name+': drafts/reload/fallback/tombstone/retry PASS');
    }finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
