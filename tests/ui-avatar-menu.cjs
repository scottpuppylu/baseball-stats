// WO-03 B1: the player profile's identity head. The name is the player picker (a transparent select over it) with ‹ ›
// beside it; the camera button opens a small menu (換照片 / 清除頭像) instead of uploading directly; 清除頭像 still asks
// first; phones and tablets get a compact bar once the head has scrolled away. Never writes data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
fs.mkdirSync(output, {recursive: true});
(async () => {
  const browser = await chromium.connectOverCDP(process.env.UI_CDP_URL || 'http://127.0.0.1:7293');
  const results = [];
  try {
    for (const [width, height] of [[390, 844], [820, 1180], [1440, 900]]) {
      const context = await browser.newContext({viewport: {width, height}, hasTouch: width < 768});
      try {
        await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => route.abort());
        const page = await context.newPage();
        await page.goto(process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321');
        await page.waitForFunction(() => window.teamRecords && PlayerHealthStore.status().ready && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
        await page.evaluate(() => { switchMainTab('tabProfile'); scrollTo(0, 0); });
        await page.waitForFunction(() => document.getElementById('playerSelect').value && document.getElementById('playerPickName').textContent !== '—');

        // The name shown is the selected player; ‹ › sit on either side of it and step through the list.
        const shown = () => page.evaluate(() => [document.getElementById('playerSelect').value, document.getElementById('playerPickName').textContent]);
        const [value, name] = await shown();
        assert.equal(name, value, 'the identity head shows the selected player');
        const boxes = await page.evaluate(() => ['[data-step="-1"]', '.pf-pick-label', '[data-step="1"]'].map(s => document.querySelector(`#playerPick ${s}`).getBoundingClientRect().x));
        assert.ok(boxes[0] < boxes[1] && boxes[1] < boxes[2], `‹ name › in that order (${boxes})`);
        await page.locator('#playerPick [data-step="1"]').click();
        await page.waitForFunction(old => document.getElementById('playerSelect').value !== old, value);
        const [value2, name2] = await shown();
        assert.equal(name2, value2, 'the name follows ›');
        await page.locator('#playerPick [data-step="-1"]').click();
        await page.waitForFunction(old => document.getElementById('playerSelect').value === old, value);
        assert.ok(await page.evaluate(() => { const s = document.getElementById('playerSelect'), b = s.getBoundingClientRect(), l = s.parentElement.getBoundingClientRect(); return getComputedStyle(s).opacity === '0' && b.width >= l.width - 1 && b.height >= 44; }), 'the select covers the name (tap the name to pick)');

        // Camera: opens the menu, not the file chooser.
        const camera = page.locator('#playerProfileBio .pf-camera');
        await camera.scrollIntoViewIfNeeded();
        let chooserOpened = false;
        const onChooser = () => { chooserOpened = true; };
        page.on('filechooser', onChooser);
        await camera.click();
        const menu = page.locator('.pf-avatar-menu[role="menu"]');
        await menu.waitFor();
        await page.waitForTimeout(150);
        assert.equal(chooserOpened, false, 'the camera opens the menu, not the upload directly');
        page.off('filechooser', onChooser);
        const hasPhoto = await page.evaluate(n => !!playerAvatars[n], value);
        const items = await menu.locator('button').allTextContents();
        assert.deepEqual(items.map(s => s.trim()), hasPhoto ? ['換照片', '清除頭像'] : ['換照片'], 'menu items');
        const mb = await menu.boundingBox();
        assert.ok(mb.x >= 0 && mb.x + mb.width <= width && mb.y >= 0 && mb.y + mb.height <= height, 'the menu stays on screen');
        await page.keyboard.press('Escape');
        await menu.waitFor({state: 'detached'});

        // 換照片 opens the original single-file upload.
        await camera.click();
        const chooser = page.waitForEvent('filechooser');
        await menu.getByRole('menuitem', {name: '換照片'}).click();
        assert.equal((await chooser).isMultiple(), false, '換照片 opens the original upload control');
        assert.equal(await menu.count(), 0, 'the menu closes after a choice');

        // 清除頭像 still asks first; dismissing keeps the photo.
        if (hasPhoto) {
          await camera.click();
          let asked = '';
          page.once('dialog', dialog => { asked = dialog.message(); dialog.dismiss(); });
          await menu.getByRole('menuitem', {name: '清除頭像'}).click();
          await page.waitForTimeout(200);
          assert.ok(asked.length > 0, '清除頭像 asks before clearing');
          assert.equal(await page.evaluate(n => !!playerAvatars[n], value), true, 'dismissing keeps the photo');
        }

        // Phones and tablets: a compact bar once the head has scrolled away, gone again at the top. Desktop: none.
        await page.evaluate(() => scrollTo(0, document.getElementById('profileIdentity').getBoundingClientRect().bottom + scrollY + 200));
        await page.waitForTimeout(500);
        const compact = await page.evaluate(() => { const e = document.querySelector('.pf-compact'); return {on: !!e?.classList.contains('is-on'), docked: document.querySelector('.ui-section-bar').classList.contains('is-docked'), visible: !!e && getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).display !== 'none', name: e?.querySelector('.pf-compact-name')?.textContent}; });
        if (width < 1280) {
          assert.equal(compact.on && compact.visible, true, 'the compact bar shows after scrolling past the head');
          assert.equal(compact.name, value, 'the compact bar names the same player');
          assert.equal(compact.docked, true, 'the section chips under the compact bar keep their glass (docked)');
          await page.evaluate(() => scrollTo(0, 0));
          await page.waitForTimeout(500);
          assert.equal(await page.evaluate(() => document.querySelector('.pf-compact')?.classList.contains('is-on')), false, 'the compact bar leaves at the top');
        } else {
          assert.equal(compact.visible, false, 'no compact bar on desktop (the head stays in the left column)');
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'page must not overflow');
        assert.deepEqual(await page.evaluate(() => window.__previewWrites), [], 'inspection must not write data');
        await page.screenshot({path: path.join(output, `${width}-AvatarMenu.png`)});
        results.push({width, height, hasPhoto, compact});
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'avatar-menu-report.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({passed: results.length, output}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
