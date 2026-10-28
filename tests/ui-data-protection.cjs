// Data protection (2026/10/28), isolated preview only (no real data):
// D1  an upload that fails keeps the edit on this device: it survives a reload and an API outage (backup copy), a
//     notice offers 重新同步, and the retry uploads it;
// D2  the live scorer is locked while the finish uploads; anything recorded meanwhile keeps the game open; a failed
//     finish leaves the game in progress, also in history;
// D3  when localStorage is full and IndexedDB fails, the save is reported as failed (warning + backup) and retried;
// D4  a play added in the review editor has no landing point, so it never appears on spray charts.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const ready = page => page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
const notice = (page, id) => page.evaluate(id => document.querySelector(`.fl-notice[data-notice="${id}"] span`)?.textContent || '', id);
const cloud = (page, file) => page.evaluate(async file => {
  const res = await fetch(`/__mock-api/${file}`);
  return res.ok ? JSON.parse(base64ToUtf8((await res.json()).content)) : null;
}, file);

async function device(browser, width = 1280) {
  const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
  await context.addInitScript(() => { window.confirm = () => true; window.alert = () => {}; });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await ready(page);
  await page.evaluate(() => localCache.ready);
  return {context, page, errors};
}

async function d1(browser, engine) {
  const {context, page, errors} = await device(browser);
  const id = await page.evaluate(async () => {
    window.__previewFailWrites = true;
    const game = allGames[0];
    game.finalScore = {us: 12, opp: 8};
    localCache.set('rebas_all_games', JSON.stringify(allGames));
    const ok = await commitGamesToGitHub(allGames, 'protection test');
    if (ok) throw new Error('the upload should have failed');
    return game.id;
  });
  assert.match(await notice(page, 'pending'), /1 筆修改尚未同步/, `${engine}: notice after a failed upload`);

  // Reload: the cloud still has the old score; the device keeps the edit.
  await page.reload();
  await ready(page);
  await page.evaluate(() => localCache.ready);
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(id => allGames.find(g => g.id === id).finalScore, id), {us: 12, opp: 8}, `${engine}: edit survives a reload`);
  assert.match(await notice(page, 'pending'), /1 筆/, `${engine}: notice survives a reload`);

  // API outage on the next start: the backup copy is loaded, the edit still goes back on top.
  await page.evaluate(() => sessionStorage.setItem('__apiDown', '1'));
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__apiDown')) return;
    const original = window.fetch;
    window.fetch = (input, options) => (/api\.github\.com\/repos\/.*\/contents\//.test(String(input)) && (!options || !options.method || options.method === 'GET')
      ? Promise.reject(new TypeError('API down')) : original(input, options));
  });
  await page.reload();
  await page.waitForFunction(() => window.teamRecords);
  await page.evaluate(() => localCache.ready);
  await page.waitForFunction(id => (allGames.find(g => g.id === id) || {}).finalScore?.us === 12, id, {timeout: 8000});
  await page.evaluate(() => sessionStorage.removeItem('__apiDown'));

  // Retry with the cloud reachable again.
  await page.reload();
  await ready(page);
  await page.evaluate(() => localCache.ready);
  const ok = await page.evaluate(() => retryPendingSync());
  assert.equal(ok, true, `${engine}: retry succeeds`);
  assert.deepEqual((await cloud(page, 'data/games.json')).find(g => g.id === id).finalScore, {us: 12, opp: 8}, `${engine}: the cloud has the edit`);
  assert.equal(await notice(page, 'pending'), '', `${engine}: notice clears`);
  assert.deepEqual(errors, []);
  await context.close();
}

async function d2(browser, engine) {
  const {context, page, errors} = await device(browser);
  const start = () => page.evaluate(() => {
    activeGame = window.activeGame = null; localStorage.removeItem('rebas_active_game');
    setDhRule(false); switchMainTab('tabScorebook'); loadLineupIntoGameSetup('recommended');
    document.getElementById('setup_game_role').value = '先攻'; startNewGameFromSetup(); recordQuickWalk();
    return activeGame.id;
  });
  const plays = (page, id) => page.evaluate(id => { const g = allGames.find(x => x.id === id); return g ? g.innings.reduce((n, i) => n + (i.plateAppearances || []).length, 0) : -1; }, id);
  const slowWrites = () => page.evaluate(() => { const f = window.fetch; window.__restoreFetch = () => { window.fetch = f; }; window.fetch = (u, o = {}) => (o.method === 'PUT' ? new Promise(r => setTimeout(r, 1200)).then(() => f(u, o)) : f(u, o)); });

  // Locked while uploading; finishes with exactly what was recorded.
  let id = await start();
  await slowWrites();
  await page.evaluate(() => { window.__finish = finishActiveGameAndSyncLogs(); });
  await page.waitForFunction(() => isFinalizingGame());
  assert.equal(await page.evaluate(() => document.getElementById('scoreSubPanelLive').inert), true, `${engine}: scorer is inert while uploading`);
  await page.evaluate(() => window.__finish);
  await page.evaluate(() => window.__restoreFetch());
  assert.equal(await page.evaluate(() => activeGame), null, `${engine}: finished`);
  assert.equal(await plays(page, id), 1, `${engine}: saved play count`);
  assert.equal(await page.evaluate(() => document.getElementById('scoreSubPanelLive').inert), false, `${engine}: unlocked afterwards`);

  // Something recorded during the upload (not through the locked buttons) keeps the game open instead of being lost.
  id = await start();
  await slowWrites();
  await page.evaluate(() => { window.__finish = finishActiveGameAndSyncLogs(); });
  await page.waitForFunction(() => isFinalizingGame());
  await page.evaluate(() => recordQuickWalk());
  await page.evaluate(() => window.__finish);
  await page.evaluate(() => window.__restoreFetch());
  assert.equal(await page.evaluate(() => activeGame && activeGame.status), 'in_progress', `${engine}: game kept open`);
  assert.equal(await page.evaluate(() => activeGame.innings.reduce((n, i) => n + (i.plateAppearances || []).length, 0)), 2, `${engine}: no play lost`);

  // A failed finish: the game stays in progress, in history too, and the scorer is usable.
  await page.evaluate(() => { window.__previewFailWrites = true; });
  await page.evaluate(() => finishActiveGameAndSyncLogs());
  assert.equal(await page.evaluate(() => activeGame.status), 'in_progress', `${engine}: failed finish stays in progress`);
  assert.equal(await page.evaluate(id => allGames.find(g => g.id === id).status, id), 'in_progress', `${engine}: history not marked finished`);
  assert.equal(await page.evaluate(() => document.getElementById('scoreSubPanelLive').inert), false, `${engine}: scorer usable after a failure`);
  await page.evaluate(() => { window.__previewFailWrites = false; });
  assert.deepEqual(errors, []);
  await context.close();
}

async function d3(browser, engine) {
  const {context, page, errors} = await device(browser);
  const before = await page.evaluate(() => {
    const original = {setItem: Storage.prototype.setItem, put: IDBObjectStore.prototype.put};
    window.__restoreStorage = () => { Storage.prototype.setItem = original.setItem; IDBObjectStore.prototype.put = original.put; };
    Storage.prototype.setItem = function(key, value) { if (key === 'rebas_all_games') throw new DOMException('full', 'QuotaExceededError'); return original.setItem.call(this, key, value); };
    IDBObjectStore.prototype.put = function() { throw new DOMException('full', 'QuotaExceededError'); };
    allGames[0].opponent = '儲存測試';
    return {returned: localCache.set('rebas_all_games', JSON.stringify(allGames)), logsMirror: localStorage.getItem('rebas_logs') !== null};
  });
  assert.equal(before.returned, false, `${engine}: an unsaved value is not reported as saved`);
  await page.waitForFunction(() => LocalCache.status().failed, null, {timeout: 5000});
  assert.match(await notice(page, 'storage'), /儲存空間不足/, `${engine}: warning shown`);
  assert.equal(await page.evaluate(() => localStorage.getItem('rebas_logs') !== null), before.logsMirror, `${engine}: other copies are kept until IndexedDB confirms`);
  // Space again: the retry stores it and the warning goes away.
  await page.evaluate(() => { window.__restoreStorage(); LocalCache.retry(); });
  await page.waitForFunction(() => !LocalCache.status().failed, null, {timeout: 5000});
  assert.equal(await page.evaluate(() => LocalCache.whenPersisted('rebas_all_games')), true);
  assert.equal(await notice(page, 'storage'), '', `${engine}: warning clears`);
  // The retried value is really in IndexedDB (read directly, not through the page's memory copy). Chrome only: a second
  // IndexedDB connection opened from the test intermittently crashes Playwright's WebKit build (whenPersisted above
  // already confirms the write there).
  if (engine !== 'chrome') { assert.deepEqual(errors, []); await context.close(); return; }
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('rebas-cache', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const get = request.result.transaction('kv', 'readonly').objectStore('kv').get('rebas_all_games');
      get.onsuccess = () => { resolve(JSON.parse(get.result)[0].opponent); request.result.close(); };
      get.onerror = () => reject(get.error);
    };
  }));
  assert.equal(stored, '儲存測試', `${engine}: the retried value is stored in IndexedDB`);
  assert.deepEqual(errors, []);
  await context.close();
}

async function d4(browser, engine) {
  const {context, page, errors} = await device(browser);
  const result = await page.evaluate(() => {
    const game = allGames.find(g => g.innings && g.innings.length && !isSprayChartArchived(g)) || allGames[0];
    const count = () => game.innings.reduce((n, inn) => n + (inn.plateAppearances || []).filter(pa => Number.isFinite(pa.x) && Number.isFinite(pa.y)).length, 0);
    const before = count();
    addPlayToReviewInning(game.id, 0);
    const added = game.innings[0].plateAppearances.at(-1);
    return {before, after: count(), hasX: 'x' in added, location: added.location};
  });
  assert.equal(result.hasX, false, `${engine}: no coordinates on a review play`);
  assert.equal(result.after, result.before, `${engine}: spray point count unchanged`);
  assert.equal(result.location, 'LF');
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  for (const [engine, type] of [['chrome', chromium], ['webkit', webkit]]) {
    const browser = await (engine === 'chrome' ? type.launch({channel: 'chrome', headless: true}) : type.launch());
    try {
      await d1(browser, engine);
      await d2(browser, engine);
      await d3(browser, engine);
      await d4(browser, engine);
      console.log(`${engine}: D1 drafts, D2 finish lock, D3 storage failure, D4 review points PASS`);
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
