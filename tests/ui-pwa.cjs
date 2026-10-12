// PWA in a real browser (isolated preview only): manifest, service worker lifecycle, offline start and notice,
// no caching of data / sign-in / API traffic, update prompt after a new deployment, and phone layout of the notices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const ready = page => page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const checks = [];
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => route.abort());

    // Manifest
    const manifest = await (await page.request.get(`${url}/manifest.webmanifest`)).json();
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) assert.equal((await page.request.get(`${url}/${icon.src}`)).status(), 200, icon.src);
    checks.push('manifest');

    // Service worker installs, activates and controls the page after a reload.
    await page.goto(`${url}/?pwa`);
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller || window.__pwaRegistration?.active, null, {timeout: 20000});
    await page.reload();
    await ready(page);
    assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'page is controlled');
    const cached = await page.evaluate(async () => { const out = []; for (const key of await caches.keys()) for (const r of await (await caches.open(key)).keys()) out.push(r.url); return out; });
    assert.ok(cached.some(u => u.includes('team-insights.js')), 'program files cached');
    assert.ok(!cached.some(u => /__mock-api|__cloud|\/data\/|api\.github|auth/.test(u)), `no data, API or sign-in responses cached: ${cached.filter(u => /__mock-api|__cloud|\/data\//.test(u))}`);
    checks.push('sw-lifecycle', 'no-sensitive-cache');

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

    // A new deployment: the update bar appears; accepting it reloads into the new version.
    await page.request.get(`${url}/__preview/bump-sw`);
    await page.evaluate(() => window.__pwaRegistration.update());
    await page.waitForSelector('#uiUpdateBar', {timeout: 20000});
    await page.screenshot({path: path.join(output, 'pwa-update-390.png')});
    await Promise.all([page.waitForEvent('load', {timeout: 20000}), page.click('#uiUpdateBar [data-act="update"]')]);
    await ready(page);
    const keys = await page.evaluate(() => caches.keys());
    assert.equal(keys.length, 1, `old cache removed (${keys})`);
    assert.match(keys[0], /-preview1$/, 'new version active');
    checks.push('update-flow');

    // Kill switch: serviceWorker false (here: the preview without ?pwa) removes the worker and its cache.
    await page.goto(`${url}/`);
    await ready(page);
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length === 0 && (await caches.keys()).length === 0, null, {timeout: 20000});
    checks.push('kill-switch');

    assert.deepEqual(errors, []);
    await context.close();
    console.log(JSON.stringify({passed: true, checks, output}));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
