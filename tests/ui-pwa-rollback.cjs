// Exercise the prepared public kill switch against fixture-only GitHub; no credential-bearing backups.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const base = `${process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321'}/baseball-stats/`;
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => r.abort());
    await page.goto(base + '?pwa');
    await page.waitForFunction(() => window.__pwaRegistration?.active);
    await page.reload();
    await page.waitForFunction(() => allGames.length > 0 && !/連線同步中/.test(syncStatusBadge.textContent));
    const id = await page.evaluate(() => {
      const game = {...allGames[0], id: 'game_rollback_qa', status: 'in_progress'};
      localStorage.setItem('rebas_active_game', JSON.stringify(game));
      return game.id;
    });
    await page.request.get(new URL('/__preview/config-disabled?enabled=1', base).href);
    await page.goto(base + '?pwa');
    await page.waitForFunction(() => window.BASEBALL_PWA_DISABLED && window.teamRecords && !/連線同步中/.test(syncStatusBadge.textContent));
    assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length)), 0);
    assert.equal(await page.evaluate(() => caches.keys().then(r => r.length)), 0);
    assert.equal(await page.evaluate(() => activeGame?.id), id);
    for (const tab of ['Overview', 'Profile', 'Leaderboard', 'Records', 'Analytics', 'Compare', 'Lineup', 'Scorebook', 'Pitching', 'Glossary']) {
      assert.ok(await page.evaluate(name => { switchMainTab('tab' + name); return !document.getElementById('panel' + name).classList.contains('hidden'); }, tab));
    }
    assert.equal(await page.evaluate(() => commitTagsToGitHub({...playerTags}, 'rollback fixture QA')), true);
    assert.deepEqual(errors, []);
    const report = {passed: true, checks: ['deployed-config-kill-switch-with-new-hash', 'sw-unregistered', 'shell-cache-cleared', 'local-game-preserved', 'ten-pages', 'direct-fixture-write']};
    fs.writeFileSync(path.join(output, 'pwa-rollback-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
