// Phones and tablets (2026/11/03): a long page shows one section at a time; the chip row is its tab bar (tap, or swipe the
// page sideways); scrolling to something in another section brings that section forward; the desktop keeps the long page.
// 球員檔案's player switcher heads the page on compact screens. Scroll-in motion never leaves anything hidden.
// The preview turns both off for every other test; this one opens ?tabs&motion.
const assert = require('node:assert/strict');
const {chromium, webkit} = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';

// In the page: resolves once the shown section, the chip row and the scroll position hold still for 5 frames with no
// finite animation running (a slow machine is still laying out or animating well after a fixed wait).
const settle = () => new Promise(resolve => {
  let last = '', same = 0, frames = 0;
  const tick = () => {
    const sec = [...document.querySelectorAll('#panelProfile section')].find(x => x.getClientRects().length && !x.parentElement.closest('section'));
    const key = [sec, document.querySelector('.ui-section-bar')].map(el => el ? JSON.stringify(el.getBoundingClientRect()) : '-').join() + scrollY;
    const busy = document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect && a.effect.getComputedTiming().endTime));
    same = key === last && !busy ? same + 1 : 0;
    last = key;
    if (same >= 5) resolve({frames});
    else if (++frames > 900) resolve({frames, timedOut: true});
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
// In the page: a starting point on the shown section's text that the page's swipe handler takes (ui-comfort.js skips
// tables, charts, fields, the player card, the chip row); falls back to the old pick if no paragraph qualifies.
const pickStart = () => {
  const skip = '.ui-table-scroll, .overflow-x-auto, canvas, input, select, textarea, #panelProfile > section:first-of-type, #profileIdentity, .ga-picker, .fl-subnav, .ui-section-bar';
  const ok = el => el && !el.closest(skip) && !(el.closest('svg') && el.closest('svg').getBoundingClientRect().width > 120);
  const sec = [...document.querySelectorAll('#panelProfile section')].find(x => x.getClientRects().length && !x.parentElement.closest('section'));
  const name = el => el ? `${el.tagName}${el.id ? '#' + el.id : ''}` : null;
  for (const p of sec.querySelectorAll('p')) {
    const r = p.getBoundingClientRect();
    if (!(r.top > 140 && r.bottom < innerHeight - 140)) continue;
    const y = r.top + r.height / 2;
    for (const f of [.85, .8, .75]) {
      const hit = document.elementFromPoint(innerWidth * f, y);
      if (sec.contains(hit) && ok(hit)) return {x: innerWidth * f, y, hit: name(hit), picked: true};
    }
  }
  const p = [...sec.querySelectorAll('p')].find(e => { const b = e.getBoundingClientRect(); return b.top > 140 && b.bottom < innerHeight - 140; });
  const r = (p || sec).getBoundingClientRect(), y = r.top + r.height / 2;
  return {x: innerWidth * .85, y, hit: name(document.elementFromPoint(innerWidth * .85, y)), picked: false};
};

(async () => {
  const results = [];
  for (const [engine, width, height] of [['chrome', 390, 844], ['chrome', 820, 1180], ['chrome', 1180, 820], ['webkit', 390, 844], ['chrome', 1440, 900]]) {
    const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({channel: 'chrome', headless: true}));
    try {
      const context = await browser.newContext({viewport: {width, height}, hasTouch: width < 1280, isMobile: engine === 'chrome' && width < 768});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      // UI_CPU_THROTTLE=4 replays a slow machine (CPU slowed 4x) in Chrome; unset in npm test.
      if (engine === 'chrome' && +process.env.UI_CPU_THROTTLE > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', {rate: +process.env.UI_CPU_THROTTLE});
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
      // A slower machine (CI) finishes the switch later: wait for the third chip and its section, then for the layout to settle.
      await page.waitForFunction(() => document.querySelector('.ui-section-bar button:nth-child(3)[aria-selected="true"]'), null, {timeout: 5000}).catch(() => {});
      const settled = await page.evaluate(settle);
      s = await state();
      assert.ok(s.shown === 1 && s.chips.indexOf(true) === 2, `third section after a tap: ${JSON.stringify(s)}`);
      assert.ok(await page.locator('#playerSelect').isVisible(), 'player switcher still at hand on another section');
      // Swipe left on the page text: the next section. Start on text the page's swipe handler takes (not a table, chart,
      // field or control with its own sideways gesture), the way a person would.
      const start = await page.evaluate(pickStart);
      const y = start.y;
      if (engine === 'chrome') {
        await page.evaluate(() => {
          const log = window.__swipeLog = [];
          const name = el => el ? `${el.tagName}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : ''}` : null;
          addEventListener('touchstart', e => log.push({type: 'start', t: Math.round(performance.now()), x: e.touches[0].clientX, y: e.touches[0].clientY, target: name(e.target)}), {capture: true, passive: true});
          addEventListener('touchend', e => log.push({type: 'end', t: Math.round(performance.now()), x: e.changedTouches[0] && e.changedTouches[0].clientX}), {capture: true, passive: true});
          addEventListener('touchcancel', () => log.push({type: 'cancel', t: Math.round(performance.now())}), {capture: true, passive: true});
        });
        const cdp = await context.newCDPSession(page);
        const wall = Date.now();
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: start.x, y}]});
        for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: start.x - width * .7 * i / 6, y}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        const gestureMs = Date.now() - wall;
        await page.waitForFunction(() => document.querySelector('.ui-section-bar button:nth-child(4)[aria-selected="true"]'), null, {timeout: 5000}).catch(() => {});
        s = await state();
        // Evidence for CI: where the finger landed, what it hit, how long the gesture took, which Chrome — pass or fail.
        const loopMs = await page.evaluate(() => { const t = performance.now(); let x = 0; for (let i = 0; i < 2e7; i++) x += i % 7; return Math.round(performance.now() - t) + (x < 0 ? 1 : 0); });
        const diag = {engine, width, chrome: browser.version(), cpuThrottle: +process.env.UI_CPU_THROTTLE || 1, loopMs, settled, start, gestureMs, events: await page.evaluate(() => window.__swipeLog), state: s};
        try { const dir = process.env.UI_QA_OUTPUT; if (dir) { fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, `section-tabs-swipe-${engine}-${width}.json`), JSON.stringify(diag, null, 2)); } } catch {}
        assert.equal(s.chips.indexOf(true), 3, `swipe moves to the next section: ${JSON.stringify(diag)}`);
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
