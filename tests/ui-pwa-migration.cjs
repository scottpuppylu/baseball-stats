const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {chromium}=require('playwright');
const base=process.env.UI_PREVIEW_URL;
const output=process.env.UI_QA_OUTPUT||os.tmpdir();
(async()=>{
 const b=await chromium.launch({channel:'chrome'});const c=await b.newContext();
 try{
  let p=await c.newPage();await p.request.get(base+'/__preview/legacy?enabled=1');
  await p.goto(base+'/baseball-stats/?pwa');
  await p.waitForFunction(()=>window.__pwaRegistration?.active&&window.teamRecords);
  await p.reload();await p.waitForFunction(()=>window.__pwaRegistration&&window.teamRecords);
  assert.equal(await p.locator('meta[name="baseball-release"]').count(),0);
  await p.evaluate(()=>{switchMainTab('tabScorebook');startNewGameFromSetup();recordQuickStrikeout('K');});
  const game=await p.evaluate(()=>localStorage.getItem('rebas_active_game'));
  const next=(await(await p.request.get(base+'/__preview/legacy')).json()).version;
  await p.evaluate(()=>window.__pwaRegistration.update());await p.waitForSelector('#uiUpdateBar');
  await p.click('#uiUpdateBar [data-act="update"]');
  await p.waitForFunction(()=>window.__pwaRegistration.waiting?.state==='installed');
  assert.equal(await p.locator('meta[name="baseball-release"]').count(),0,'legacy unguarded update does not force refresh');
  assert.equal(await p.evaluate(()=>JSON.stringify(activeGame)),game);
  await p.close();p=await c.newPage();await p.goto(base+'/__preview/release');
  await p.waitForFunction(async app=>!(await navigator.serviceWorker.getRegistration(app))?.waiting,base+'/baseball-stats/');
  await p.goto(base+'/baseball-stats/?pwa');
  await p.waitForFunction(()=>window.__pwaRegistration&&window.teamRecords);
  assert.equal(await p.locator('meta[name="baseball-release"]').getAttribute('content'),next);
  assert.equal(await p.evaluate(()=>JSON.stringify(activeGame)),game);
  assert.match(await p.evaluate(()=>BASEBALL_PWA_STATUS().updateBlocked),/場記進行中/);
  assert.deepEqual(await p.evaluate(()=>caches.keys()),['tkaero-shell-'+next]);
  const report={passed:true,legacy:'e1fdb9d',version:next,checks:['real-legacy-worker-and-client','legacy-unguarded-update-refused','no-reinstall-close-reopen','actual-game-restored','new-guard-active','legacy-cache-cleaned']};
  fs.writeFileSync(path.join(output,'pwa-migration-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await c.close();await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
