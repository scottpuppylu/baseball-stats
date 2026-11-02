// Isolated preview only: ui-delight.js (2026/11/02; later the same day: finer pixel Clawd, outfits, faces, play) — home effects, Clawd the easter-egg creature, search, previous/next
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
      await page.waitForFunction(() => window.flClawd);
      await page.evaluate(() => flClawd.quiet()); // no visits of its own: the test calls it out by hand

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

      // ---------- Clawd: a pixel creature behind the glass; never talks, never on 比賽場記 ----------
      const scenes = await page.evaluate(() => flClawd.scenes());
      const cover = width < 768 ? ['bar-peek', '.ui-mobile-nav'] : width >= 1280 ? ['side-peek', '#mainNavigation'] : ['header-hang', '#appHeader'];
      for (const s of [cover[0], 'dash', 'hop', 'edge-peek', 'flyby', 'rocket', 'sleep']) assert.ok(scenes.includes(s), `scene ${s} on this screen: ${scenes}`);
      assert.equal(await page.locator('#flClawd').count(), 0, 'not in the page between visits');
      const peekNow = async (opts = {}) => { await page.evaluate(([k, o]) => { window.__clawd = flClawd.appear(k, o); }, [cover[0], opts]); await page.waitForTimeout(1000); };
      await peekNow({outfit: 'cap', face: 'happy'});
      const peek = await page.evaluate(sel => {
        const c = document.getElementById('flClawd'), g = document.querySelector(sel);
        return {z: Number(c.style.zIndex), coverZ: Number(getComputedStyle(g).zIndex), body: Boolean(c.querySelector('svg .cl-body')), eyes: c.querySelectorAll('.cl-eyes rect').length, ae: Boolean(c.querySelector('.cl-cap .cl-ae')), outfit: c.dataset.outfit};
      }, cover[1]);
      assert.ok(peek.body && peek.eyes >= 4 && peek.ae && peek.outfit === 'cap', `pixel sprite drawn in the page with its AE cap: ${JSON.stringify(peek)}`);
      assert.ok(peek.z < peek.coverZ, `hides behind its glass (z ${peek.z} < ${peek.coverZ})`);
      await page.screenshot({path: path.join(output, `delight-${tag}-peek.png`)});
      // A tap: a bounce with sparks and big eyes; it stays a moment, then ducks back and is gone.
      await page.locator('#flClawd').click({force: true});
      assert.ok(await page.locator('.fl-clawd-spark').count() > 0, 'sparks on a tap');
      assert.equal(await page.locator('#flClawd').getAttribute('data-face'), 'wide', 'big eyes on a tap');
      await page.waitForFunction(() => !document.getElementById('flClawd'), null, {timeout: 9000});
      assert.equal(await page.evaluate(() => window.__clawd), true);
      // Press and hold: petting (hearts, blush).
      await peekNow();
      let box = await page.locator('#flClawd').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * .3);
      await page.mouse.down();
      await page.waitForTimeout(700);
      assert.ok(await page.locator('.fl-clawd-heart').count() > 0, 'hearts while petted');
      assert.equal(await page.locator('#flClawd.is-blush').count(), 1, 'blushes while petted');
      await page.mouse.up();
      await page.waitForFunction(() => !document.getElementById('flClawd'), null, {timeout: 9000});
      // Drag it out and throw it: it follows the pointer above the glass, then falls, lands and walks off.
      await peekNow();
      box = await page.locator('#flClawd').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * .3);
      await page.mouse.down();
      await page.mouse.move(width / 2, 200, {steps: 8});
      const held = await page.evaluate(() => { const c = document.getElementById('flClawd'), r = c.getBoundingClientRect(); return {held: c.classList.contains('is-held'), cx: r.left + r.width / 2, z: Number(c.style.zIndex)}; });
      assert.ok(held.held && Math.abs(held.cx - width / 2) < 12 && held.z > 90, `held under the pointer, above the glass: ${JSON.stringify(held)}`);
      await page.mouse.move(width / 2 + 120, 150, {steps: 2});
      await page.mouse.up();
      await page.waitForFunction(() => !document.getElementById('flClawd'), null, {timeout: 12000});
      // Every outfit and every face draws; the team cap family carries the AE.
      const looks = await page.evaluate(async () => {
        const out = {outfits: [], faces: []};
        const show = async (opts, read) => { const p = flClawd.appear('dash', opts); await new Promise(r => setTimeout(r, 30)); const el = document.getElementById('flClawd'); const v = el && read(el); el?.getAnimations().forEach(a => a.finish()); await p; return v; };
        for (const o of flClawd.outfits()) out.outfits.push(await show({outfit: o}, el => [o, el.dataset.outfit, el.querySelector('.cl-wear').childElementCount + el.querySelector('.cl-held').childElementCount, Boolean(el.querySelector('.cl-ae'))]));
        for (const f of flClawd.faces()) out.faces.push(await show({outfit: 'bare', face: f}, el => [f, el.dataset.face, el.querySelectorAll('.cl-eyes rect').length]));
        return out;
      });
      assert.ok(looks.outfits.length >= 10 && looks.outfits.every(([o, shown, parts, ae]) => o === shown && (o === 'bare' || parts > 0) && ae === ['cap', 'slugger', 'fielder'].includes(o)), `outfits: ${JSON.stringify(looks.outfits)}`);
      assert.ok(looks.faces.length >= 9 && looks.faces.every(([f, shown, n]) => f === shown && n >= 2), `faces: ${JSON.stringify(looks.faces)}`);
      // The team logo, tapped three times quickly, calls it out.
      const logo = page.locator(width >= 1280 ? '.fl-side-brand' : '.fl-top-logo');
      for (let i = 0; i < 3; i++) await logo.click();
      await page.waitForSelector('#flClawd', {state: 'attached', timeout: 3000});
      await page.evaluate(() => flClawd.quiet());
      // Never talks, never on 比賽場記.
      assert.equal(await page.locator('.fl-clawd-bubble').count(), 0, 'no speech bubbles');
      assert.equal(await page.locator('#flClawd text, .fl-clawd-fx text').count(), 0, 'no words anywhere');
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
