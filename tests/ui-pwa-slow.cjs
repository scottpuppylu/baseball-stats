// WO-03 B8: the installed site opens from its verified snapshot even when the network is slow. The service worker
// fetches the kill switch and the live page together and waits at most 3 s; past that the snapshot opens as the
// offline shell (with its notice), and on a normal network the full page (not the offline shell) opens as before.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const appUrl = `${url}/baseball-stats/`;
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'baseball-pwa-slow-')), {
    channel: 'chrome', headless: true, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true
  });
  const result = {};
  try {
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => route.abort());
    let delay = 0;
    let workerFetches = 0;
    // Only the worker's own requests for the live page and the kill switch are slowed (the page's requests are not).
    await context.route(/\/baseball-stats\/(index\.html|app-config\.js)$/, async route => {
      if (route.request().serviceWorker()) workerFetches++;
      if (delay && route.request().serviceWorker()) await wait(delay);
      await route.continue().catch(() => {});
    });
    const page = await context.newPage();
    await page.goto(`${appUrl}?pwa`);
    await page.waitForFunction(() => navigator.serviceWorker.controller || window.__pwaRegistration?.active, null, {timeout: 30000});
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {timeout: 20000});

    // Normal network: the full page, not the offline shell.
    let t0 = Date.now();
    await page.reload({waitUntil: 'domcontentloaded'});
    result.normalMs = Date.now() - t0;
    assert.notEqual(await page.evaluate(() => window.BASEBALL_OFFLINE_SHELL), true, 'normal network opens the full page');
    assert.ok(workerFetches > 0, 'the worker fetched the live page through the network');

    // Network slower than the limit: the snapshot opens within about 3 s as the offline shell, with its notice.
    delay = 8000;
    t0 = Date.now();
    await page.reload({waitUntil: 'domcontentloaded', timeout: 15000});
    result.slowMs = Date.now() - t0;
    assert.ok(result.slowMs < 5500, `slow network: page opened after ${result.slowMs} ms (limit 3 s plus load)`);
    assert.equal(await page.evaluate(() => window.BASEBALL_OFFLINE_SHELL), true, 'slow network: credential-free offline shell');
    await page.waitForSelector('#uiOfflineBar', {timeout: 10000});
    assert.match(await page.locator('#uiOfflineBar').innerText(), /離線中/);
    await page.screenshot({path: path.join(output, 'pwa-slow-390.png')});

    // Back to normal: the next open is the full page again.
    delay = 0;
    await page.reload({waitUntil: 'domcontentloaded'});
    assert.notEqual(await page.evaluate(() => window.BASEBALL_OFFLINE_SHELL), true, 'after the network recovers, the full page opens');
  } finally {
    await context.close();
  }
  console.log(JSON.stringify({passed: true, ...result}));
})().catch(error => { console.error(error); process.exit(1); });
