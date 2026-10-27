// Isolated preview only: the large local caches move to IndexedDB, survive a full localStorage, and keep startup behaviour.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const idb = page => page.evaluate(() => new Promise(resolve => {
  const request = indexedDB.open('rebas-cache', 1);
  request.onsuccess = () => {
    const out = {}, tx = request.result.transaction('kv', 'readonly');
    for (const key of ['rebas_all_games', 'rebas_logs', 'rebas_player_avatars']) tx.objectStore('kv').get(key).onsuccess = e => { out[key] = e.target.result ?? null; };
    tx.oncomplete = () => { request.result.close(); resolve(out); };
  };
}));
const ready = page => page.waitForFunction(() => window.teamRecords && !syncStatusBadge.textContent.includes('連線同步中'));
const totals = page => page.evaluate(() => ({games: allGames.length, pa: getFullAgg().players.reduce((s, p) => s + p.pa, 0)}));
(async () => {
  const results = [];
  for (const [engine, launch] of [['chrome', () => chromium.launch({channel: 'chrome', headless: true})], ['webkit', () => webkit.launch()]]) {
    const browser = await launch();
    try {
      const context = await browser.newContext({serviceWorkers: 'block'});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      // 1. A device from the previous version: its localStorage copy is the startup data and is copied to IndexedDB.
      await page.goto(url); await ready(page);
      const cloud = await totals(page);
      assert.ok(cloud.games > 0 && cloud.pa > 0);
      await page.evaluate(() => localStorage.setItem('rebas_all_games', JSON.stringify(allGames.slice(0, 1))));
      const offline = route => route.abort();
      await context.route(/\/__mock-api\/|\/data\/[^/]+\.json/, offline);
      await page.reload(); await ready(page);
      assert.equal(await page.evaluate(() => allGames.length), 1, 'the localStorage copy from the previous version is what this device shows offline');
      await page.waitForFunction(() => new Promise(resolve => {
        const r = indexedDB.open('rebas-cache', 1);
        r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('rebas_all_games'); g.onsuccess = () => { r.result.close(); resolve(g.result === localStorage.getItem('rebas_all_games')); }; };
      }));
      await context.unroute(/\/__mock-api\/|\/data\/[^/]+\.json/, offline);
      await page.reload(); await ready(page);
      assert.deepEqual(await totals(page), cloud, 'cloud data still replaces the startup copy');
      // 2. localStorage is full: the cloud load still succeeds and the copy lives in IndexedDB only.
      const fill = await page.evaluate(async () => {
        localStorage.removeItem('rebas_all_games');
        const chunk = 'x'.repeat(50000); let n = 0;
        try { for (;;) { localStorage.setItem('fill' + n, chunk); n++; } } catch (e) { /* full */ }
        for (let size = 25000, t = 0; size >= 1; size = Math.floor(size / 2)) { for (;;) { try { localStorage.setItem('fill-tail-' + t++, 'x'.repeat(size)); } catch (e) { break; } } }
        const source = await loadGamesFromGitHub();
        await LocalCache.whenPersisted();
        return {source, mirror: localStorage.getItem('rebas_all_games'), games: allGames.length, idbOnly: localStorage.getItem('rebas_cache_idb_only'),
          otherMirrors: ['rebas_logs', 'rebas_player_avatars'].filter(k => localStorage.getItem(k) !== null)};
      });
      assert.equal(fill.source, 'cloud', 'a full device no longer turns a successful cloud load into a failure');
      assert.equal(fill.mirror, null);
      assert.equal(fill.idbOnly, '1', 'the device switches to IndexedDB only');
      assert.deepEqual(fill.otherMirrors, [], 'all large copies leave localStorage, freeing room for the live game');
      assert.equal(fill.games, cloud.games);
      await page.waitForFunction(() => new Promise(resolve => {
        const r = indexedDB.open('rebas-cache', 1);
        r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('rebas_all_games'); g.onsuccess = () => { r.result.close(); resolve(!!g.result && JSON.parse(g.result).length === allGames.length); }; };
      }));
      // 3. Offline reopen on that full device: games come from IndexedDB, and the live-game key still has room.
      await context.route(/\/__mock-api\/|\/data\/[^/]+\.json/, route => route.abort());
      await page.reload(); await ready(page);
      await page.waitForFunction(n => allGames.length === n, cloud.games);
      assert.deepEqual(await totals(page), cloud, 'offline reopen shows the same totals from IndexedDB');
      assert.match(await page.evaluate(() => syncStatusBadge.textContent), /本機快取/);
      assert.equal(await page.evaluate(() => { try { localStorage.setItem('rebas_active_game', JSON.stringify({id: 'probe'})); localStorage.removeItem('rebas_active_game'); return true; } catch (e) { return false; } }), true);
      const stored = await idb(page);
      assert.ok(stored.rebas_logs && stored.rebas_player_avatars !== undefined);
      assert.deepEqual(errors, []);
      results.push({engine, passed: true, games: cloud.games, pa: cloud.pa});
      await context.close();
      // 4. Neither persistent layer accepts the new value. Keep old mirrors, warn, export, then recover.
      const failureContext = await browser.newContext({serviceWorkers:'block',acceptDownloads:true});
      const failurePage = await failureContext.newPage();
      failurePage.on('pageerror',e=>errors.push(e.message));
      await failurePage.goto(url); await ready(failurePage);
      const failure = await failurePage.evaluate(async()=>{
        await LocalCache.ready;
        window.__storageMethods = {set:Storage.prototype.setItem, put:IDBObjectStore.prototype.put};
        Storage.prototype.setItem=function(key,value){if(LocalCache.KEYS.includes(key))throw new DOMException('isolated quota','QuotaExceededError');return window.__storageMethods.set.call(this,key,value);};
        IDBObjectStore.prototype.put=function(){throw new DOMException('isolated IDB failure','QuotaExceededError');};
        const old=JSON.parse(localStorage.getItem('rebas_all_games'))[0].finalScore.us;
        allGames[0].finalScore.us=99;
        const accepted=LocalCache.set('rebas_all_games',JSON.stringify(allGames));
        let rejected=false;try{await LocalCache.whenPersisted('rebas_all_games');}catch(_){rejected=true;}
        return {old,accepted,rejected,failed:LocalCache.status().failed,mirror:JSON.parse(localStorage.getItem('rebas_all_games'))[0].finalScore.us,idbOnly:localStorage.getItem('rebas_cache_idb_only')};
      });
      assert.equal(failure.accepted,false);assert.equal(failure.rejected,true);assert.equal(failure.failed,true);
      assert.equal(failure.mirror,failure.old,'the previous durable mirror is not removed on failure');assert.equal(failure.idbOnly,null);
      await failurePage.locator('#uiStorageWarning').waitFor({state:'visible'});
      const download=await Promise.all([failurePage.waitForEvent('download'),failurePage.locator('#uiStorageWarning button').filter({hasText:'下載完整備份'}).click()]);
      const backup=JSON.parse(require('node:fs').readFileSync(await download[0].path(),'utf8'));
      assert.equal(backup.files['data/games.json'][0].finalScore.us,99,'backup includes the in-memory edit that could not be saved');
      await failurePage.evaluate(async()=>{
        Storage.prototype.setItem=window.__storageMethods.set;IDBObjectStore.prototype.put=window.__storageMethods.put;
        await LocalCache.retry();
      });
      await failurePage.locator('#uiStorageWarning').waitFor({state:'hidden'});
      await failureContext.route(/\/__mock-api\/|\/data\/[^/]+\.json/,route=>route.abort());
      await failurePage.reload();await ready(failurePage);
      assert.equal(await failurePage.evaluate(()=>allGames[0].finalScore.us),99,'recovered write survives an offline reopen');
      assert.deepEqual(errors,[]);
      await failureContext.close();
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({passed: results.length, results}));
})().catch(e => { console.error(e); process.exitCode = 1; });
