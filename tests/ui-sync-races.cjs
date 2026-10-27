// A cloud read begun before an upload must not erase that upload when its delayed response arrives.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
(async()=>{
  for(const [name,launch]of[['chrome',()=>chromium.launch({channel:'chrome',headless:true})],['webkit',()=>webkit.launch()]]){
    const browser=await launch();try{
      const context=await browser.newContext({serviceWorkers:'block'});
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,r=>r.abort());
      const page=await context.newPage();await page.goto(url);
      await page.waitForFunction(()=>window.teamRecords&&!syncStatusBadge.textContent.includes('連線同步中'));
      const id=await page.evaluate(()=>allGames[0].id);
      let release,captured,held=false;
      const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{captured=resolve;});
      await context.route('**/__mock-api/data/games.json*',async route=>{
        if(held||route.request().method()!=='GET')return route.continue();
        held=true;const response=await route.fetch();const body=await response.body();captured();await gate;
        return route.fulfill({response,body});
      });
      await page.evaluate(()=>{window.__staleLoad=loadGamesFromGitHub();});await seen;
      assert.equal(await page.evaluate(async()=>{allGames[0].finalScore={us:29,opp:8};return commitGamesToGitHub(allGames);}),true);
      assert.equal(await page.evaluate(()=>SyncDrafts.status().pending),0,'the upload was acknowledged');
      release();await page.evaluate(()=>window.__staleLoad);
      assert.equal(await page.evaluate(id=>allGames.find(g=>g.id===id).finalScore.us,id),29,'the older read cannot replace an acknowledged edit');
      await context.close();console.log(name+': delayed cloud read after acknowledged upload PASS');
    }finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
