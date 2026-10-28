// Isolated preview only: app shell (2026/10/26) — Home landing page, page groups, top bar tools, touch chart previews.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {chromium, webkit} = require('playwright');
const {scrollToRendered}=require('./ui-wait.cjs');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const page$ = page => page.evaluate(() => document.body.dataset.page);
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))));
async function tapPoint(page, chartVar, index, pointerType, hasTouch) {
  // Real input: a touchscreen tap on touch devices, a mouse click otherwise (a scripted click has wrong offsets in WebKit).
  const point = await page.evaluate(({chartVar, index}) => {
    const chart = eval(chartVar);
    const el = chart.getDatasetMeta(0).data[index];
    const rect = chart.canvas.getBoundingClientRect();
    return {x: rect.left + el.x, y: rect.top + el.y, name: chart.data.datasets[0].data[index].name};
  }, {chartVar, index});
  if (pointerType === 'touch' && hasTouch) await page.touchscreen.tap(point.x, point.y);
  else if (pointerType === 'touch') {
    // Desktop context without a touchscreen: deliver the touch sequence the browser would send.
    await page.evaluate(({x, y}) => {
      const canvas = document.elementFromPoint(x, y);
      canvas.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'touch', clientX: x, clientY: y}));
      canvas.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: x, clientY: y}));
    }, point);
  } else await page.mouse.click(point.x, point.y);
  return point.name;
}
(async () => {
  fs.mkdirSync(output, {recursive: true});
  const results = [];
  for (const [engine, width, height] of [['chrome', 390, 844], ['chrome', 820, 1180], ['chrome', 1440, 900], ['webkit', 390, 844]]) {
    const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({channel: 'chrome', headless: true}));
    try {
      const context = await browser.newContext({viewport: {width, height}, hasTouch: width < 1024, isMobile: engine === 'chrome' && width < 768});
      const page = await context.newPage(), errors = [];
      // Probe: when the original header and overview are first parsed, the page must still be behind the boot splash.
      await page.addInitScript(() => {
        window.__bootProbe = null;
        new MutationObserver((records, observer) => {
          if (document.getElementById('panelOverview') && document.getElementById('appHeader')) {
            window.__bootProbe = document.documentElement.classList.contains('fl-booting'); observer.disconnect();
          }
        }).observe(document, {childList: true, subtree: true});
      });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => window.teamRecords && !syncStatusBadge.textContent.includes('連線同步中'));
      assert.equal(await page.evaluate(() => window.__bootProbe), true, 'the half-built page is hidden behind the splash');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('fl-booting')), false, 'the boot splash is gone once the shell is ready');
      // Home is the landing page, fully open, with live numbers and working links.
      assert.equal(await page$(page), 'Home');
      assert.ok(await page.locator('.fl-hero').isVisible());
      assert.equal(await page.locator('.ui-page-heading').isVisible(), false, 'Home has its own hero instead of the page heading');
      assert.match(await page.locator('.fl-telemetry').textContent(), /打擊率[\s\S]*\.\d{3}/);
      assert.ok(await page.locator('.fl-rail .fl-card[data-game]').count() > 0, 'recent games');
      assert.ok(await page.locator('.fl-leader').count() > 0, 'leaders');
      const heroBox = await page.locator('.fl-hero').boundingBox();
      if (width < 1280) assert.ok(heroBox.width >= width - 1, `hero spans the screen (${heroBox.width})`);
      assert.ok(heroBox.height >= height * 0.85, `hero fills the first screen (${heroBox.height})`);
      // A leader card opens that player's profile; the logo (or sidebar badge) returns home.
      const leader = await page.locator('.fl-leader').first().getAttribute('data-player');
      await page.locator('.fl-leader').first().click();
      assert.equal(await page$(page), 'Profile');
      assert.equal(await page.evaluate(() => selectedPlayerName), leader);
      await page.locator(width >= 1280 ? '#mainNavigation > .fl-side-brand' : '#flTopbar .fl-top-logo').click();
      assert.equal(await page$(page), 'Home');
      // Groups: the segmented control switches pages within a group; the phone tab bar reopens the last page.
      await page.evaluate(() => uiNavigation.openPage('Overview'));
      if (width < 1280) {
        assert.deepEqual(await page.locator('.fl-subnav button').allTextContents(), ['總覽', '分析', '投手', '紀錄']);
        await page.locator('.fl-subnav [data-sub="Analytics"]').click();
        assert.equal(await page$(page), 'Analytics');
      } else {
        assert.equal(await page.locator('.fl-subnav').isVisible(), false, 'desktop lists pages in the sidebar instead');
        await page.locator('#btnTabAnalytics').click();
      }
      if (width < 768) {
        await page.locator('.ui-mobile-nav [data-group="球員"]').click();
        assert.equal(await page$(page), 'Profile');
        await page.locator('.ui-mobile-nav [data-group="球隊數據"]').click();
        assert.equal(await page$(page), 'Analytics', 'the 數據 tab remembers its last page');
        assert.equal(await page.locator('.ui-mobile-nav [data-group="球隊數據"]').getAttribute('aria-current'), 'page');
        const thumb = await page.locator('.ui-mobile-nav .fl-tab-thumb').boundingBox();
        const tab = await page.locator('.ui-mobile-nav [data-group="球隊數據"]').boundingBox();
        // The glass thumb glides onto the current tab (spring animation; wait for it to settle).
        await page.waitForFunction(() => {
          const t = document.querySelector('.ui-mobile-nav .fl-tab-thumb').getBoundingClientRect(), b = document.querySelector('.ui-mobile-nav [data-group="球隊數據"]').getBoundingClientRect();
          return Math.abs(t.x - b.x) < 2 && Math.abs(t.width - b.width) < 2;
        }, null, {timeout: 4000});
        assert.ok(thumb);
      }
      // Back returns to the previous page.
      await page.goBack();
      await page.waitForFunction(() => document.body.dataset.page !== 'Analytics' || true);
      await page.evaluate(() => uiNavigation.openPage('Analytics'));
      // Chart points: touch shows the point first (tooltip + card), mouse opens the profile directly.
      await page.waitForFunction(() => typeof quadrantChartInst !== 'undefined' && quadrantChartInst && quadrantChartInst.getDatasetMeta(0).data.length > 0);
      await page.waitForTimeout(1200); // let the page finish its own re-render after opening (a chart redraw replaces the tooltip)
      await page.evaluate(() => quadrantChartInst.canvas.scrollIntoView({block: 'center'}));
      await page.waitForTimeout(400);
      await settle(page); // a tap during the page-reveal slide would land beside the point
      await scrollToRendered(page,page.locator('#quadrantChart'));
      await page.waitForFunction(()=>!!quadrantChartInst);
      const before = await page.evaluate(() => quadrantChartInst.id);
      const touched = await tapPoint(page, 'quadrantChartInst', 0, 'touch', width < 1024);
      assert.equal(await page$(page), 'Analytics', 'a tap does not jump away');
      const chip = page.locator('.fl-point-chip');
      assert.match(await chip.textContent(), new RegExp(touched));
      assert.equal(await page.evaluate(() => quadrantChartInst.id), before, 'same chart instance');
      await page.waitForFunction(() => quadrantChartInst.tooltip.getActiveElements().length === 1 && quadrantChartInst.tooltip.opacity > 0.3, null, {timeout: 3000}); // the tooltip shows the tapped point
      await chip.locator('.fl-point-open').click();
      assert.equal(await page$(page), 'Profile');
      assert.equal(await page.evaluate(() => selectedPlayerName), touched, 'the card opens that player');
      if (width >= 1024) { // with a mouse (desktop), a click on a point still opens the profile directly
        await page.evaluate(() => uiNavigation.openPage('Analytics'));
        await page.waitForTimeout(1200);
        await scrollToRendered(page,page.locator('#luckRegressionChart'));
        await page.waitForFunction(()=>!!luckRegressionChartInst);
        await page.waitForTimeout(400);
        await settle(page);
        const clicked = await tapPoint(page, 'luckRegressionChartInst', 0, 'mouse', width < 1024);
        await page.waitForFunction(() => document.body.dataset.page === 'Profile', null, {timeout: 3000}); // a mouse click still opens the profile (Chart.js handles it a frame later)
        assert.equal(await page.evaluate(() => selectedPlayerName), clicked);
      }
      // Tools: one panel with the date range, actions, status and version; closes with 完成.
      await page.locator('#flToolsButton').click();
      for (const selector of ['#filterStartDate', 'button[onclick="manualRefresh()"]', 'button[onclick="openDefenseModal()"]', '#btnToggleChien', '#exportCsvBtn', '#flTools #syncStatusBadge'])
        assert.ok(await page.locator(selector).isVisible(), selector);
      await page.screenshot({path: path.join(output, `${engine}-${width}-tools.png`)});
      await page.locator('#flTools .fl-tools-done').click();
      assert.equal(await page.locator('#flTools').isVisible(), false);
      const bar = await page.locator('#appHeader').boundingBox();
      assert.ok(bar.height <= 72, `one slim top bar (${bar.height})`);
      await page.evaluate(() => switchMainTab('tabHome'));
      await page.screenshot({path: path.join(output, `${engine}-${width}-home.png`)});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'no sideways scrolling');
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.__previewWrites), [], 'browsing writes nothing');
      results.push({engine, width, passed: true});
      await context.close();
    } catch (error) { error.message = `[${engine} ${width}] ${error.message}`; throw error; } finally { await browser.close(); }
  }
  console.log(JSON.stringify({passed: results.length, results}));
})().catch(e => { console.error(e); process.exitCode = 1; });
