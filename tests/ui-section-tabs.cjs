// Phones and tablets (2026/11/03): a long page shows one section at a time; the chip row is its tab bar (tap, or swipe the
// page sideways); scrolling to something in another section brings that section forward; the desktop keeps the long page.
// 球員檔案's player switcher heads the page on compact screens. Scroll-in motion never leaves anything hidden.
// The preview turns both off for every other test; this one opens ?tabs&motion.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';

(async () => {
  const results = [];
  for (const [engine, width, height] of [['chrome', 390, 844], ['chrome', 820, 1180], ['chrome', 1180, 820], ['webkit', 390, 844], ['chrome', 1440, 900]]) {
    const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({channel: 'chrome', headless: true}));
    try {
      const context = await browser.newContext({viewport: {width, height}, hasTouch: width < 1280, isMobile: engine === 'chrome' && width < 768});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => r.abort());
      await page.goto(`${url}/?tabs&motion`);
      await page.waitForFunction(() => window.teamRecords && !document.documentElement.classList.contains('fl-booting'));
      const state = () => page.evaluate(() => {
        const panel = document.querySelector('[id^="panel"]:not(.hidden)');
        const sections = [...panel.querySelectorAll(':scope > section, :scope > div > section')].filter(s => !s.parentElement.closest('section'));
        return {tabbed: document.body.classList.contains('ui-tabbed'), shown: sections.filter(s => s.getClientRects().length).length, total: sections.length,
          chips: [...document.querySelectorAll('.ui-section-bar button')].map(b => b.getAttribute('aria-selected') === 'true')};
      });
      await page.evaluate(() => switchMainTab('tabProfile'));
      await page.waitForTimeout(900);
      // A slower machine (CI) builds the chip row a little later: wait for it instead of reading too early.
      if (width < 1280) await page.waitForFunction(() => document.body.classList.contains('ui-tabbed') && document.querySelector('.ui-section-bar button[aria-selected="true"]'), null, {timeout: 15000}).catch(() => {});
      let s = await state();
      if (width >= 1280) {
        assert.equal(s.tabbed, false, 'desktop keeps the long page');
        assert.equal(s.shown, s.total);
        assert.equal(await page.locator('#panelProfile > .fl-player-row').count(), 0, 'switcher stays in its title row on the desktop');
        assert.deepEqual(errors, []);
        results.push({engine, width, passed: true});
        continue;
      }
      assert.ok(s.tabbed && s.total >= 4, `tabbed: ${JSON.stringify(s)}`);
      assert.ok(s.shown === 1 && s.chips.indexOf(true) === 0, `one section, the first chip selected: ${JSON.stringify(s)}`);
      assert.equal(await page.locator('#panelProfile > .fl-player-row.fl-player-top #playerSelect').count(), 1, 'player switcher heads the page');
      // Tap the third chip.
      await page.locator('.ui-section-bar button').nth(2).click();
      await page.waitForTimeout(500);
      s = await state();
      assert.ok(s.shown === 1 && s.chips.indexOf(true) === 2, `third section after a tap: ${JSON.stringify(s)}`);
      assert.ok(await page.locator('#playerSelect').isVisible(), 'player switcher still at hand on another section');
      // Swipe left on the page text: the next section.
      const y = await page.evaluate(() => { const sec = [...document.querySelectorAll('#panelProfile section')].find(x => x.getClientRects().length && !x.parentElement.closest('section')); const p = [...sec.querySelectorAll('p')].find(e => { const r = e.getBoundingClientRect(); return r.top > 140 && r.bottom < innerHeight - 140; }); const r = (p || sec).getBoundingClientRect(); return r.top + r.height / 2; });
      if (engine === 'chrome') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: width * .85, y}]});
        for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: width * (.85 - .7 * i / 6), y}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await page.waitForTimeout(500);
        s = await state();
        assert.equal(s.chips.indexOf(true), 3, `swipe moves to the next section: ${JSON.stringify(s)}`);
      }
      // Something in another section scrolled into view brings that section forward.
      const brought = await page.evaluate(() => { const secs = [...document.querySelectorAll('#panelProfile > section, #panelProfile > div > section')]; const first = secs[0]; first.querySelector('h2, p, div').scrollIntoView(); return first.getClientRects().length > 0; });
      assert.ok(brought, 'scrollIntoView brings its section');
      // Each page reopens on its last section.
      await page.locator('.ui-section-bar button').nth(1).click();
      await page.evaluate(() => switchMainTab('tabOverview'));
      await page.waitForTimeout(500);
      await page.evaluate(() => switchMainTab('tabProfile'));
      await page.waitForTimeout(700);
      assert.equal((await state()).chips.indexOf(true), 1, 'reopens on the section left last');
      // Scroll-in motion leaves nothing hidden once it has played.
      await page.evaluate(() => switchMainTab('tabRecords'));
      await page.waitForTimeout(600);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(250); }
      await page.waitForTimeout(1800);
      const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-fl-enter]')].filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).length);
      assert.equal(hidden, 0, 'nothing on screen stays hidden after its entrance');
      assert.deepEqual(errors, [], 'runtime errors');
      results.push({engine, width, passed: true});
      await context.close();
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({passed: results.length, results}));
})().catch(error => { console.error(error); process.exit(1); });
