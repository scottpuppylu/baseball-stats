// Isolated preview only: ui-delight.js (2026/11/02) — home effects, Clawd the easter-egg creature, search, previous/next
// player. The preview turns Clawd off for every other test; this one opens ?clawd.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {chromium, webkit} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const page$ = page => page.evaluate(() => document.body.dataset.page);

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const results = [];
  for (const [engine, width, height] of [['chrome', 390, 844], ['chrome', 1440, 900], ['webkit', 390, 844]]) {
    const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({channel: 'chrome', headless: true}));
    try {
      const context = await browser.newContext({viewport: {width, height}, hasTouch: width < 1024, isMobile: engine === 'chrome' && width < 768});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => r.abort());
      await page.goto(`${url}/?clawd`);
      await page.waitForFunction(() => window.teamRecords && !document.documentElement.classList.contains('fl-booting') && !syncStatusBadge.textContent.includes('連線同步中'));
      const tag = `${engine}-${width}`;

      // ---------- Home effects ----------
      assert.equal(await page$(page), 'Home');
      const title = await page.locator('.fl-hero-title').evaluate(el => ({text: el.textContent, label: el.getAttribute('aria-label'), chars: el.querySelectorAll('.fl-ch').length}));
      assert.deepEqual(title, {text: '淡江航太系壘', label: '淡江航太系壘', chars: 6}, 'title split for the blur-in, text unchanged');
      assert.equal(await page.locator('.fl-hero > canvas.fl-stars').count(), 1, 'star field behind the hero');
      assert.ok(await page.locator('.fl-cta.fl-star-border').count() === 1 && await page.locator('.fl-eyebrow.fl-shiny').count() === 1);
      // The count-up ends on the exact original numbers (waits for it: CI machines are slower).
      const expected = await page.evaluate(() => { const a = getAnalysisAgg(); return [a.teamAvg, a.teamObp].map(v => v.toFixed(3).replace(/^0(?=\.)/, '')); });
      await page.waitForFunction(values => { const t = document.querySelector('.fl-telemetry')?.textContent || ''; return values.every(v => t.includes(v)); }, expected, {timeout: 6000});
      assert.match(await page.locator('.fl-telemetry').textContent(), /打擊率[\s\S]*\.\d{3}/);

      // ---------- Clawd: lives behind the glass, never talks, never on 比賽場記 ----------
      await page.waitForFunction(() => window.flClawd);
      const scenes = await page.evaluate(() => flClawd.scenes());
      const cover = width < 768 ? ['bar-peek', '.ui-mobile-nav'] : width >= 1280 ? ['side-peek', '#mainNavigation'] : ['header-hang', '#appHeader'];
      assert.ok(scenes.includes(cover[0]) && scenes.includes('dash'), `scenes on this screen: ${scenes}`);
      assert.equal(await page.locator('#flClawd').count(), 0, 'not in the page between visits');
      await page.evaluate(k => { window.__clawd = flClawd.appear(k); }, cover[0]);
      await page.waitForTimeout(1100);
      const peek = await page.evaluate(sel => {
        const c = document.getElementById('flClawd'), g = document.querySelector(sel);
        return {z: Number(c.style.zIndex), coverZ: Number(getComputedStyle(g).zIndex), svg: Boolean(c.querySelector('svg .cl-body')), eyes: Boolean(c.querySelector('.cl-eyes'))};
      }, cover[1]);
      assert.ok(peek.svg && peek.eyes, 'pixel sprite drawn in the page');
      assert.ok(peek.z < peek.coverZ, `hides behind its glass (z ${peek.z} < ${peek.coverZ})`);
      await page.screenshot({path: path.join(output, `delight-${tag}-peek.png`)});
      // A tap startles it: sparks, then back behind the glass and gone.
      await page.locator('#flClawd').click({force: true});
      assert.ok(await page.locator('.fl-clawd-spark').count() > 0, 'sparks when startled');
      await page.waitForFunction(() => !document.getElementById('flClawd'), null, {timeout: 2500});
      assert.equal(await page.evaluate(() => window.__clawd), true);
      // Hats: the team cap most of the time (both looks render).
      const caps = await page.evaluate(async () => { let n = 0; for (let i = 0; i < 12; i++) { const p = flClawd.appear('dash'); await new Promise(r => setTimeout(r, 30)); if (document.querySelector('#flClawd .cl-cap')) n++; document.getElementById('flClawd')?.getAnimations().forEach(a => a.finish()); await p; } return n; });
      assert.ok(caps >= 4, `wears the AE cap most of the time (${caps}/12)`);
      // Never talks, never on 比賽場記.
      assert.equal(await page.locator('.fl-clawd-bubble').count(), 0, 'no speech bubbles');
      await page.evaluate(() => switchMainTab('tabScorebook'));
      assert.equal(await page.evaluate(() => flClawd.appear('dash')), false, 'stays away from 比賽場記');
      assert.equal(await page.locator('#flClawd').count(), 0);
      await page.evaluate(() => switchMainTab('tabOverview'));

      // ---------- Search ----------
      const player = await page.evaluate(() => getAllAvailablePlayerNames().teamNames.find(n => [...document.getElementById('playerSelect').options].some(o => o.value === n)));
      if (width >= 1024) await page.keyboard.press('Control+K');
      else await page.locator('#flSearchButton').click();
      await page.locator('#flSearch input').waitFor();
      await page.keyboard.type(player.slice(-2));
      assert.ok(await page.locator('.fl-search-item').count() > 0, 'results while typing');
      await page.locator('.fl-search-item', {hasText: player}).first().click();
      await page.waitForFunction(() => document.body.dataset.page === 'Profile');
      assert.equal(await page.locator('#playerSelect').inputValue(), player, 'search opens the player');
      assert.equal(await page.locator('#flSearch').count(), 0, 'palette closed');
      // Pages are searchable too.
      await page.locator('#flSearchButton').click();
      await page.keyboard.type('排行');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.body.dataset.page === 'Leaderboard');

      // ---------- Previous / next player ----------
      await page.evaluate(() => switchMainTab('tabProfile'));
      const before = await page.locator('#playerSelect').inputValue();
      await page.locator('.fl-step [data-step="1"]').click();
      const after = await page.locator('#playerSelect').inputValue();
      assert.notEqual(after, before, '› moves to the next player');
      assert.match(await page.locator('#panelProfile').textContent(), new RegExp(after));
      if (width >= 1024) { await page.keyboard.press('ArrowLeft'); assert.equal(await page.locator('#playerSelect').inputValue(), before, '← goes back'); }
      else { await page.locator('.fl-step [data-step="-1"]').click(); assert.equal(await page.locator('#playerSelect').inputValue(), before); }

      // Nothing re-renders the page while it sits still (Clawd and the effects live outside the workspace).
      await page.waitForTimeout(1200);
      const idle = await page.evaluate(() => new Promise(res => { let n = 0; const o = new MutationObserver(r => { n += r.length; }); o.observe(document.getElementById('appWorkspace'), {subtree: true, attributes: true, childList: true}); setTimeout(() => { o.disconnect(); res(n); }, 2500); }));
      assert.equal(idle, 0, 'no idle mutations in the page');

      assert.deepEqual(errors, [], 'runtime errors');
      results.push({engine, width, passed: true});
      await context.close();
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({passed: results.length, results}));
})().catch(error => { console.error(error); process.exitCode = 1; });
