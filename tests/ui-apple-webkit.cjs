const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {webkit} = require('playwright');
const base = process.env.UI_PREVIEW_URL;
const output = process.env.UI_QA_OUTPUT || os.tmpdir();
const ready = page => page.waitForFunction(() => window.teamRecords && !/連線同步中/.test(syncStatusBadge.textContent) && !legacyMergeRunning);
(async () => {
 const browser = await webkit.launch({headless:true});
 const results = []; const checks = []; const errors = []; let externalRequests = 0; let offlineNavigationProbe;
 try {
  const probeContext=await browser.newContext();
  const probe=await probeContext.newPage();await probe.goto(base+'/__webkit-probe/');
  await probe.waitForFunction(()=>navigator.serviceWorker.controller);
  await probeContext.setOffline(true);
  try { await probe.reload(); offlineNavigationProbe='SUPPORTED'; }
  catch(e) { offlineNavigationProbe='HARNESS_UNAVAILABLE: '+e.message.split('\n')[0]; }
  await probeContext.close();
  for (const [width,height] of [[390,844],[844,390],[768,1024],[1024,768],[507,1024],[1440,900]]) {
   const context = await browser.newContext({viewport:{width,height},hasTouch:width<1280,acceptDownloads:true});
   await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,r=>{externalRequests++;return r.abort();});
   const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
   page.on('dialog',d=>d.accept());
   await page.goto(base + '/baseball-stats/?pwa'); await ready(page);
   assert.equal(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content'),'航太系壘');
   for (const tab of ['Overview','Profile','Leaderboard','Records','Analytics','Compare','Lineup','Scorebook','Pitching','Glossary']) {
    await page.evaluate(name=>switchMainTab('tab'+name),tab);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const state=await page.evaluate(name=>({visible:!document.getElementById('panel'+name).classList.contains('hidden'),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}),tab);
    assert.ok(state.visible && state.overflow<=1,`${width} ${tab} overflow ${state.overflow}`);
   }
   assert.equal(await page.evaluate(()=>allLogs.length>0 && allGames.length>0),true);
   await page.screenshot({path:path.join(output,`webkit-${width}x${height}.png`)});
   if(width===390) {
    // Native date/select controls still accept values; the original scorer persists a real play across reload/rotation.
    await page.evaluate(()=>{switchMainTab('tabScorebook');switchScorebookSubTab('live');});
    await page.locator('#setup_game_date').fill('2026-10-16');
    await page.locator('#setup_game_opponent').fill('Apple WebKit QA');
    await page.evaluate(()=>startNewGameFromSetup());
    await page.locator('#res_GO').click();
    await page.locator('button[onclick="submitBattedBallPlay()"]').click();
    const stored=await page.evaluate(()=>localStorage.getItem('rebas_active_game'));
    assert.ok(JSON.parse(stored).innings[0].plateAppearances.length>0);
    await page.setViewportSize({width:844,height:390});
    assert.equal(await page.evaluate(()=>localStorage.getItem('rebas_active_game')),stored);
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(()=>JSON.stringify(activeGame)),stored);
    checks.push('date-input','real-scorebook-restore','rotation-preserves-game');
    // Downloads use the original export handlers, no duplicate statistics implementation.
    const backupEvent=page.waitForEvent('download');
    await page.evaluate(()=>document.getElementById('downloadBackupBtn').click());
    const backup=await backupEvent;
    const backupJson=JSON.parse(fs.readFileSync(await backup.path(),'utf8'));
    assert.equal(backupJson.activeGame.id,JSON.parse(stored).id);
    assert.ok(backupJson.files['data/logs.json'].length>0);
    const csvEvent=page.waitForEvent('download');
    await page.evaluate(()=>document.getElementById('exportCsvBtn').click());
    const csv=await csvEvent;
    assert.match(fs.readFileSync(await csv.path(),'utf8'),/選手,打席,打數/);
    checks.push('json-backup-with-active-game','csv-download');
    await page.locator('#hiddenAvatarInput').setInputFiles(path.join(__dirname,'..','assets','icons','icon-192.png'));
    await page.locator('#cropCanvas').waitFor({state:'visible'});
    await page.evaluate(()=>{rotateCropImage();resetCropTransform();});
    await page.evaluate(()=>confirmCropAndSave());
    assert.ok(await page.evaluate(()=>Object.values(playerAvatars).some(v=>/^data:image\//.test(v))));
    assert.equal(await page.evaluate(()=>commitTagsToGitHub({...playerTags, WebKit:['fixture']},'webkit fixture')),true);
    await page.evaluate(()=>window.__previewFailWrites=true);
    assert.equal(await page.evaluate(()=>commitTagsToGitHub({...playerTags},'webkit fail fixture')),false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('rebas_active_game')),stored);
    checks.push('image-decode-crop-rotate-write','direct-github-success-failure-keeps-game');
    await page.waitForFunction(()=>window.__pwaRegistration?.active,null,{timeout:30000});
    await page.reload();await ready(page);
    await context.setOffline(true);
    await page.waitForFunction(()=>document.getElementById('uiOfflineBar'));
    assert.equal(await page.evaluate(()=>JSON.stringify(activeGame)),stored);
    if (offlineNavigationProbe === 'SUPPORTED') {
      await page.reload();
      await page.waitForFunction(()=>window.teamRecords && window.BASEBALL_OFFLINE_SHELL);
      assert.equal(await page.evaluate(()=>JSON.stringify(activeGame)),stored);
      checks.push('webkit-supported-harness-full-offline-navigation');
    }
    await context.setOffline(false);
    // Real 503 from both live endpoints exercises the worker fallback while the installed snapshot stays available.
    await page.request.get(base+'/__preview/unavailable?enabled=1');
    await page.reload();
    await page.waitForFunction(()=>window.teamRecords&&window.BASEBALL_OFFLINE_SHELL&&document.getElementById('uiOfflineBar'));
    assert.equal(await page.evaluate(()=>JSON.stringify(activeGame)),stored);
    await page.request.get(base+'/__preview/unavailable?enabled=0');
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForFunction(()=>/已恢復連線/.test(document.getElementById('uiOfflineBar')?.textContent||''));
    checks.push('webkit-offline-notice-preserves-game','webkit-sw-server-failure-game-recovery','reconnect');
    const isolated=await browser.newContext();
    const other=await isolated.newPage();await other.goto(base+'/baseball-stats/');await ready(other);
    assert.equal(await other.evaluate(()=>localStorage.getItem('rebas_active_game')),null);
    await isolated.close();
    checks.push('separate-context-storage-isolation-not-physical-safari');
   }
   results.push({width,height,pages:10,passed:true}); await context.close();
  }
  assert.deepEqual(errors,[]);assert.equal(externalRequests,0);
  const report={passed:true,engine:'Playwright WebKit '+browser.version(),offlineNavigationProbe,physicalIPhone:'UNVERIFIED',physicalIPad:'UNVERIFIED',physicalMac:'UNVERIFIED',results,checks,errors,externalRequests};
  fs.writeFileSync(path.join(output,'apple-webkit-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
