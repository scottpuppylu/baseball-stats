// PWA in a real browser (isolated preview only): manifest, service worker lifecycle, offline start and notice,
// no caching of data / sign-in / API traffic, update prompt after a new deployment, and phone layout of the notices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const appUrl = `${url}/baseball-stats/`;
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const ready = page => page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));

(async () => {
  fs.mkdirSync(output, {recursive: true});
  // A normal isolated profile is required: private browsing deliberately disables PWA installation.
  const browser = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'baseball-pwa-install-')), {
    channel: 'chrome', headless: true, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true
  });
  const checks = [];
  try {
    const context = browser;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => route.abort());

    // Manifest
    const manifest = await (await page.request.get(`${appUrl}manifest.webmanifest`)).json();
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) assert.equal((await page.request.get(`${appUrl}${icon.src}`)).status(), 200, icon.src);
    checks.push('manifest');

    // Service worker installs, activates and controls the page after a reload.
    await page.goto(`${appUrl}?pwa`);
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller || window.__pwaRegistration?.active, null, {timeout: 20000});
    await page.reload();
    await ready(page);
    assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'page is controlled');
    const cached = await page.evaluate(async () => { const out = []; for (const key of await caches.keys()) for (const r of await (await caches.open(key)).keys()) out.push(r.url); return out; });
    assert.ok(cached.some(u => u.includes('team-insights.js')), 'program files cached');
    assert.ok(!cached.some(u => /__mock-api|__cloud|\/data\/|api\.github|auth/.test(u)), `no data, API or sign-in responses cached: ${cached.filter(u => /__mock-api|__cloud|\/data\//.test(u))}`);
    checks.push('sw-lifecycle', 'no-sensitive-cache');
    const offlineHtmlSafe = await page.evaluate(async () => {
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) {
          const text = await (await cache.match(request)).text();
          if (text.includes('isolated-preview')) return false;
        }
      }
      return true;
    });
    assert.equal(offlineHtmlSafe, true, 'even the preview credential is absent from every cached entry');
    const cdp = await context.newCDPSession(page);
    const installability = await cdp.send('Page.getInstallabilityErrors');
    fs.writeFileSync(path.join(output, 'pwa-installability.json'), JSON.stringify(installability, null, 2));
    assert.deepEqual(installability.installabilityErrors, [], 'Chromium technical installation requirements');
    await cdp.detach();
    checks.push('credential-free-offline-html', 'chromium-installability', 'github-pages-subpath');

    assert.equal(await page.evaluate(() => commitTagsToGitHub({...playerTags, 謝承祐: ['PWA online QA']}, 'pwa online')), true, 'direct GitHub write succeeds in isolated memory');
    checks.push('direct-github-write');
    const avatarName = await page.evaluate(() => selectedPlayerName);
    await page.locator('#hiddenAvatarInput').setInputFiles(path.join(__dirname, '..', 'assets', 'icons', 'icon-192.png'));
    await page.locator('#cropCanvas').waitFor({state: 'visible'});
    await page.evaluate(() => { rotateCropImage(); resetCropTransform(); });
    await page.evaluate(() => confirmCropAndSave());
    assert.ok(await page.evaluate(async name => {
      const cloud = await fetch('/__mock-api/data/avatars.json').then(r => r.json());
      const avatars = JSON.parse(base64ToUtf8(cloud.content));
      return /^data:image\//.test(avatars[name]) && avatars[name] === playerAvatars[name];
    }, avatarName), 'selected/cropped image reaches fixture GitHub through the original direct writer');
    checks.push('image-file-crop-direct-write');

    // Offline: the app still opens from the cache, says the data may be old, and refuses to pretend an upload worked.
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.teamRecords && document.getElementById('uiOfflineBar'), null, {timeout: 20000});
    assert.match(await page.locator('#uiOfflineBar').innerText(), /離線中.*可能不是最新/);
    const offlineWrite = await page.evaluate(() => commitTagsToGitHub({...playerTags, 謝承祐: ['離線']}, 'offline'));
    assert.equal(offlineWrite, false, 'offline upload reported as failed');
    assert.match(await page.locator('#syncStatusBadge').textContent(), /離線/);
    assert.ok(await page.evaluate(() => allLogs.length > 0), 'cached data shown offline');
    const bar = await page.locator('#uiOfflineBar').boundingBox();
    assert.ok(bar.x >= 0 && bar.x + bar.width <= 390, 'offline notice fits the phone');
    await page.screenshot({path: path.join(output, 'pwa-offline-390.png')});
    await context.setOffline(false);
    await page.waitForFunction(() => /已恢復連線/.test(document.getElementById('uiOfflineBar')?.innerText || ''));
    checks.push('offline-start', 'offline-no-fake-sync', 'reconnect-notice');
    assert.equal(await page.evaluate(() => window.BASEBALL_OFFLINE_SHELL), true, 'offline HTML has no credential');
    await Promise.all([page.waitForEvent('load'), page.click('#uiOfflineBar [data-act="refresh"]')]);
    await ready(page);
    assert.equal(await page.evaluate(() => Boolean(window.BASEBALL_OFFLINE_SHELL)), false, 'reconnect reload gets the live page');
    assert.equal(await page.evaluate(() => commitTagsToGitHub({...playerTags, 謝承祐: ['PWA reconnect QA']}, 'pwa reconnect')), true);
    checks.push('reconnect-restores-direct-write');

    // A new deployment: the update bar appears; accepting it reloads into the new version.
    await page.request.get(`${url}/__preview/bump-sw`);
    await page.evaluate(() => window.__pwaRegistration.update());
    await page.waitForSelector('#uiUpdateBar', {timeout: 20000});
    const gameId = await page.evaluate(() => {
      const game = JSON.parse(JSON.stringify(allGames[0]));
      game.id = 'game_pwa_update_qa'; game.status = 'in_progress';
      localStorage.setItem('rebas_active_game', JSON.stringify(game));
      return game.id;
    });
    await page.screenshot({path: path.join(output, 'pwa-update-390.png')});
    await Promise.all([page.waitForEvent('load', {timeout: 20000}), page.click('#uiUpdateBar [data-act="update"]')]);
    await ready(page);
    const keys = await page.evaluate(() => caches.keys());
    assert.equal(keys.length, 1, `old cache removed (${keys})`);
    assert.match(keys[0], /-preview1$/, 'new version active');
    assert.equal(await page.evaluate(() => activeGame?.id), gameId, 'in-progress game is restored after accepting the update');
    await page.evaluate(() => localStorage.removeItem('rebas_active_game'));
    checks.push('update-flow', 'active-game-survives-update');

    // Kill switch: serviceWorker false (here: the preview without ?pwa) removes the worker and its cache.
    await page.goto(appUrl);
    await ready(page);
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length === 0 && (await caches.keys()).length === 0, null, {timeout: 20000});
    checks.push('kill-switch');

    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'pwa-result.json'), JSON.stringify({passed: true, checks, installability, physicalAndroid: 'UNVERIFIED', physicalIPhone: 'UNVERIFIED'}, null, 2));
    await context.close();
    console.log(JSON.stringify({passed: true, checks, output}));
  } catch (error) {
    const failedPage = browser.pages().at(-1);
    if (failedPage) {
      await failedPage.screenshot({path: path.join(output, 'pwa-failure.png')}).catch(() => {});
      const state = await failedPage.evaluate(async () => ({url: location.href, online: navigator.onLine, records: typeof window.teamRecords,
        offlineShell: Boolean(window.BASEBALL_OFFLINE_SHELL), offlineBar: Boolean(document.getElementById('uiOfflineBar')),
        cacheEntries: await Promise.all((await caches.keys()).map(async key => ({key, urls: (await (await caches.open(key)).keys()).map(r => r.url)})))
      })).catch(e => ({diagnosticError: e.message}));
      fs.writeFileSync(path.join(output, 'pwa-failure-state.json'), JSON.stringify(state, null, 2));
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
