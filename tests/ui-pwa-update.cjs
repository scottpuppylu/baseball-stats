const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const base = process.env.UI_PREVIEW_URL;
const output = process.env.UI_QA_OUTPUT || os.tmpdir();
const ready = page => page.waitForFunction(() => window.__pwaRegistration && window.teamRecords && !/連線同步中/.test(syncStatusBadge.textContent));
const version = page => page.locator('meta[name="baseball-release"]').getAttribute('content');
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 const context = await browser.newContext();
 const checks = []; const errors = [];
 try {
  await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => r.abort());
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/baseball-stats/?pwa'); await ready(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.reload(); await ready(page);
  const v1 = await version(page);
  const data = await page.evaluate(() => ({logs: JSON.stringify(allLogs), games: JSON.stringify(allGames)}));
  const v2 = (await (await page.request.get(base + '/__preview/bump-sw')).json()).version;
  assert.notEqual(v1, v2);
  await page.evaluate(() => window.__pwaRegistration.update());
  await page.waitForSelector('#uiUpdateBar');
  await page.click('#uiUpdateBar [data-act="later"]');
  await page.reload(); await ready(page);
  assert.equal(await version(page), v1, 'reload while waiting stays entirely V1');
  assert.equal(await page.evaluate(() => window.__previewRelease || 0), 0);
  checks.push('js-css-only-auto-version', 'defer-reload-keeps-complete-v1');
  await page.waitForSelector('#uiUpdateBar');
  // Another tab editing vetoes activation. No tab is forcibly reloaded.
  const other = await context.newPage();
  await other.goto(base + '/baseball-stats/?pwa'); await ready(other);
  await other.evaluate(() => { switchMainTab('tabScorebook'); startNewGameFromSetup(); });
  const gameId = await other.evaluate(() => activeGame.id);
  await page.click('#uiUpdateBar [data-act="update"]');
  await page.waitForFunction(() => /場記進行中/.test(document.getElementById('uiUpdateBar')?.textContent || ''));
  assert.equal(await version(other), v1);
  assert.equal(await other.evaluate(() => activeGame.id), gameId);
  // End the local fixture session without touching a formal branch.
  await other.evaluate(() => { localStorage.removeItem('rebas_active_game'); activeGame = window.activeGame = null; });
  await other.evaluate(() => { document.getElementById('liveScorerContainer')?.classList.add('hidden'); });
  await other.evaluate(() => {
    const field = document.createElement('input'); field.id = 'updateQaUnfinished'; document.body.prepend(field);
  });
  await other.locator('#updateQaUnfinished').fill('Unfinished form');
  await page.click('#uiUpdateBar [data-act="retry"]');
  await page.click('#uiUpdateBar [data-act="update"]');
  await page.waitForFunction(() => /另一個分頁/.test(document.getElementById('uiUpdateBar')?.textContent || ''));
  await other.close();
  checks.push('other-tab-live-game-veto', 'other-tab-unsaved-form-veto');
  await page.click('#uiUpdateBar [data-act="retry"]');
  const reload = page.waitForEvent('load');
  await page.click('#uiUpdateBar [data-act="update"]'); await reload; await ready(page);
  assert.equal(await version(page), v2); assert.equal(await page.evaluate(() => window.__previewRelease), 1);
  assert.deepEqual(await page.evaluate(() => ({logs: JSON.stringify(allLogs), games: JSON.stringify(allGames)})), data);
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['tkaero-shell-' + v2]);
  assert.equal(await page.evaluate(() => commitTagsToGitHub({...playerTags, 更新驗證:['V2']}, 'isolated V2')), true);
  checks.push('confirmed-v2', 'old-cache-cleaned', 'local-records-preserved', 'direct-github-v2');
  // A stale/corrupt resource makes installation fail; the full previous release stays usable, also offline.
  await page.request.get(base + '/__preview/corrupt?file=ui-comfort.css');
  const v3 = (await (await page.request.get(base + '/__preview/bump-sw')).json()).version;
  await page.evaluate(async () => {
    const r = window.__pwaRegistration;
    window.__failedInstall = new Promise(resolve => r.addEventListener('updatefound', () => {
      const worker = r.installing;
      worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(true); });
    }, {once:true}));
    await r.update();
  });
  await page.evaluate(() => window.__failedInstall);
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['tkaero-shell-' + v2]);
  await context.setOffline(true); await page.reload();
  await page.waitForFunction(() => window.teamRecords && window.BASEBALL_OFFLINE_SHELL);
  assert.equal(await version(page), v2);
  assert.equal(await page.evaluate(() => window.__previewRelease), 1);
  checks.push('partial-install-rejected', 'interrupted-update-keeps-v2-offline');
  await context.setOffline(false);
  await page.reload(); await ready(page);
  // Drain the automatic retry of the still-corrupt V3 before testing a distinct V4 interruption.
  await page.evaluate(() => window.__pwaRegistration.update());
  await page.waitForFunction(() => !window.__pwaRegistration.installing);
  await page.request.get(base + '/__preview/corrupt');
  await page.request.get(base + '/__preview/drop?file=ui-comfort.js');
  const v4 = (await (await page.request.get(base + '/__preview/bump-sw')).json()).version;
  // Returning to the foreground triggers a real update request (advance only the check throttle).
  await page.evaluate(() => {
    const r = window.__pwaRegistration;
    window.__failedInstall = new Promise(resolve => r.addEventListener('updatefound', () => {
      const worker = r.installing;
      worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(true); });
    }, {once:true}));
    const now = Date.now; Date.now = () => now() + 16000;
    window.dispatchEvent(new Event('pageshow')); Date.now = now;
  });
  await page.evaluate(() => window.__failedInstall);
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['tkaero-shell-' + v2]);
  assert.equal(await version(page), v2);
  await page.request.get(base + '/__preview/drop');
  checks.push('foreground-update-detection', 'connection-dropped-during-install-keeps-v2');
  assert.deepEqual(errors, []);
  const report = {passed:true, v1,v2,v3,v4,checks,physicalApple:'UNVERIFIED'};
  fs.writeFileSync(path.join(output,'pwa-update-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 } finally { await context.close(); await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
