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
        await LocalCache.whenPersisted('rebas_all_games'); // the switch happens once IndexedDB has confirmed the copy
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
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({passed: results.length, results}));
})().catch(e => { console.error(e); process.exitCode = 1; });
