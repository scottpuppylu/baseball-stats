// Isolated preview only: the version history sits closed at the bottom of 指標說明 and opens version by version.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
(async () => {
  const results = [];
  for (const [engine, width] of [['chrome', 390], ['chrome', 1440], ['webkit', 390]]) {
    const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({channel: 'chrome', headless: true}));
    try {
      const page = await browser.newPage({viewport: {width, height: 900}}), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => window.teamRecords && !syncStatusBadge.textContent.includes('連線同步中'));
      await page.evaluate(() => switchMainTab('tabGlossary'));
      const box = page.locator('#versionHistory');
      assert.equal(await page.evaluate(() => document.getElementById('panelGlossary').lastElementChild.contains(document.getElementById('versionHistory'))), true, 'at the bottom of 指標說明');
      assert.equal(await box.evaluate(e => e.open), false, 'closed by default');
      assert.equal(await box.locator('.changelog-version').count(), 0, 'built only when opened');
      await box.locator('summary').first().click();
      const versions = box.locator('.changelog-version');
      await versions.first().waitFor(); // the toggle event fires after the click
      assert.equal(await versions.count(), await page.evaluate(() => CHANGELOG.length));
      assert.equal(await versions.first().evaluate(e => e.open), true, 'the current version is open');
      assert.equal(await versions.nth(1).evaluate(e => e.open), false, 'older versions are folded');
      assert.match(await versions.first().textContent(), new RegExp(await page.evaluate(() => document.body.innerText.match(/v\d{6}\.\d{4}/)[0]).then(v => v.replace('.', '\.'))));
      await versions.nth(1).locator('summary').click();
      await page.waitForFunction(() => document.querySelectorAll('#versionHistory .changelog-version')[1].open);
      assert.equal(await versions.nth(1).evaluate(e => e.open), true, 'an older version opens on tap');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scrolling');
      assert.deepEqual(errors, []);
      results.push({engine, width, versions: await versions.count()});
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({passed: results.length, results}));
})().catch(e => { console.error(e); process.exitCode = 1; });
