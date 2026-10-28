// Section jumps land exactly while off-screen sections are skipped by content-visibility (Chromium phones), and the
// skipping really applies there (and never in WebKit). Isolated preview only.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';

(async () => {
  for (const [engine, type] of [['chrome', chromium], ['webkit', webkit]]) {
    const browser = await (engine === 'chrome' ? type.launch({channel: 'chrome', headless: true}) : type.launch());
    try {
      const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: engine === 'chrome'});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
      for (const key of ['Profile', 'Glossary', 'Records']) {
        await page.evaluate(k => uiNavigation.openPage(k), key);
        await page.waitForTimeout(900);
        const {sections, skipping} = await page.evaluate(() => {
          const list = [...document.querySelectorAll('main > [id^="panel"]:not(.hidden) > section')];
          return {sections: list.length, skipping: list.some(s => getComputedStyle(s).contentVisibility === 'auto')};
        });
        // Pages made of one long section (the glossary) have nothing to skip.
        if (sections >= 2) assert.equal(skipping, engine === 'chrome', `${engine} ${key}: off-screen sections ${engine === 'chrome' ? 'are' : 'are not'} skipped`);
        const chips = page.locator('.ui-section-bar button');
        const count = await chips.count();
        if (count < 2) continue;
        for (const index of [1, count - 1]) {
          await chips.nth(index).tap();
          // The smooth scroll ends, then the jump settles on the real position.
          await page.waitForFunction(() => new Promise(resolve => {
            let last = scrollY, still = 0;
            const tick = () => { still = Math.abs(scrollY - last) < 1 ? still + 1 : 0; last = scrollY; if (still >= 20) resolve(true); else requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
          }), null, {timeout: 6000});
          await page.waitForTimeout(250);
          // The page marks the current section from real positions: it must be the one that was tapped (or, at the
          // very bottom, the last sections cannot rise further).
          const state = await page.evaluate(() => ({
            current: Number(document.querySelector('.ui-section-bar [aria-current="true"]')?.dataset.index),
            atBottom: scrollY + innerHeight >= document.documentElement.scrollHeight - 4
          }));
          assert.ok(state.current === index || (state.atBottom && index === count - 1), `${engine} ${key}: tapped section ${index}, current ${state.current}`);
        }
      }
      assert.deepEqual(errors, []);
      console.log(`${engine}: section jumps exact, content-visibility ${engine === 'chrome' ? 'on' : 'off'} PASS`);
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
