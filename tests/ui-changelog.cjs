// Isolated preview only: the version history is its own page (參考 › 版本紀錄), reachable from Home and the menu.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
(async () => {
  const results = [];
  for (const [engine, width] of [['chrome', 390], ['chrome', 1440], ['webkit', 390]]) {
    const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({channel: 'chrome', headless: true}));
    try {
      const page = await browser.newPage({viewport: {width, height: 900}, hasTouch: width < 768}), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => window.teamRecords && !syncStatusBadge.textContent.includes('連線同步中'));
      assert.equal(await page.evaluate(() => document.body.dataset.page), 'Home', 'the app opens on Home');
      // Home links to the current version's notes.
      const version = await page.evaluate(() => document.body.innerText.match(/v\d{6}\.\d{4}/)[0]);
      const homeLink = page.locator('#panelHome .fl-home-foot [data-go="Changelog"]');
      assert.match(await homeLink.textContent(), new RegExp(version.replace('.', '\\.')));
      await homeLink.click();
      assert.ok(await page.locator('#panelChangelog').isVisible(), 'the version page opens');
      const versions = page.locator('#panelChangelog .changelog-version');
      await versions.first().waitFor();
      assert.equal(await versions.count(), await page.evaluate(() => CHANGELOG.length));
      assert.equal(await versions.first().evaluate(e => e.open), true, 'the current version is open');
      assert.match(await versions.first().textContent(), new RegExp(version.replace('.', '\\.')));
      assert.equal(await versions.nth(1).evaluate(e => e.open), false, 'older versions are folded');
      await versions.nth(1).locator('summary').click();
      await page.waitForFunction(() => document.querySelectorAll('#panelChangelog .changelog-version')[1].open);
      assert.equal(await page.evaluate(() => document.querySelector('#panelGlossary #versionHistory')), null, 'no longer tucked under the glossary');
      // Also listed with the glossary under 參考 in the menu, and Back returns to Home.
      if (width < 768) await page.locator('#uiMoreNavigation').click();
      assert.ok(await page.locator('#btnTabChangelog').isVisible(), 'listed in the menu');
      if (width < 768) await page.keyboard.press('Escape');
      await page.goBack();
      await page.waitForFunction(() => document.body.dataset.page === 'Home');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scrolling');
      assert.deepEqual(errors, []);
      results.push({engine, width, versions: await page.evaluate(() => CHANGELOG.length)});
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({passed: results.length, results}));
})().catch(e => { console.error(e); process.exitCode = 1; });
