// Delayed first PWA load: modules must not be mistaken for fully loaded cloud data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => r.abort());
    await page.route('**/__mock-api/data/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await route.continue();
    });
    const start = Date.now();
    await page.goto(url);
    await page.waitForFunction(() => window.teamRecords && typeof switchMainTab === 'function');
    const moduleReadyMs = Date.now() - start;
    const early = await page.evaluate(() => ({
      pending: /連線同步中/.test(document.getElementById('syncStatusBadge').textContent),
      games: allGames.length
    }));
    assert.equal(early.pending, true, 'old module-only readiness returns before initial data');
    assert.equal(early.games, 0, 'fresh storage has no cloud games before reads complete');
    await page.waitForFunction(() => !/連線同步中/.test(document.getElementById('syncStatusBadge').textContent));
    const dataReadyMs = Date.now() - start;
    assert.ok(await page.evaluate(() => allGames.length > 0 && allLogs.length > 0));
    assert.deepEqual(errors, [], 'delayed fresh startup must finish without script exceptions');
    const report = {passed: true, moduleReadyMs, dataReadyMs, early, checks: ['reproduced-module-data-race', 'delayed-startup-completes', 'no-script-errors']};
    fs.mkdirSync(output, {recursive: true});
    fs.writeFileSync(path.join(output, 'startup-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
