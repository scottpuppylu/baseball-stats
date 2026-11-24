// WO-06（PO-44）新版場記的外觀與進出：
//   B1 顏色、材質、圓角、襯線字取網站的 --fl-*；語意色對齊網站紅綠藍琥珀，亮底黑字對比 ≥7:1；戶外高對比照常。
//   B2 開賽設定放在場記頁裡：網站標題列與導覽都在（手機底部導覽、平板只有側欄），舊版內容不顯示，不橫向捲。
//   B3 進入／離開全螢幕記分有轉場：展開 280 ms、收回 240 ms（1.75×），減少動態只淡入淡出 160 ms；進入中就能點。
//   B4 沒有 :has()，場記裡沒有 Clawd。
// 用法：node tests/ui-v2-look.cjs（自己起隔離預覽，port 54514）；GitHub 用預覽的假 API，不寫 data/*.json。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const hashes = () => Object.fromEntries(fs.readdirSync(path.join(root, 'data')).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', f))).digest('hex')]));

function startPreview(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'ui-preview-server.cjs')], {cwd: root, env: {...process.env, UI_PREVIEW_PORT: String(port)}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    const timer = setTimeout(() => reject(new Error('preview startup timed out')), 15000);
    child.once('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(child); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited ${code}`)); });
  });
}
const SIZES = [['phone-390', 390, 844], ['tablet-portrait', 820, 1180], ['tablet-landscape', 1180, 820], ['desktop-1440', 1440, 900]];

(async () => {
  const diskBefore = hashes();
  for (const file of ['ui-v2.css', 'scorebook-v2.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /:has\(/, `${file}: no :has()`);
  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { preview = await startPreview(54514); url = 'http://127.0.0.1:54514'; }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  let externalGitHub = 0;
  const passed = [];
  const open = async (w, h, opts = {}) => {
    const context = await browser.newContext({viewport: {width: w, height: h}, isMobile: w < 768, hasTouch: w < 1200, reducedMotion: opts.reducedMotion || 'no-preference'});
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(`${w}x${h}: ${error.message}`));
    await page.goto(url + '/?ui=v2');
    await page.waitForFunction(() => window.teamRecords && window.uiV2 && window.uiV2.live && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    await page.evaluate(() => switchMainTab('tabScorebook'));
    await page.waitForFunction(() => document.body.classList.contains('v2-setup-on') && document.querySelector('.v2l-setup .v2u-start'));
    return {context, page};
  };
  // 開賽設定填好（上一場打線＋對手），回傳開始鍵。
  const fillSetup = page => page.evaluate(() => {
    if (typeof renderSetupLineupGrid === 'function') renderSetupLineupGrid();
    const s = window.uiV2.live.state.setup;
    s.dh = !!isDhEnabled; const n = s.dh ? 11 : 10;
    s.lineup = setupLineupList.slice(0, n); s.pos = setupLineupPositions.slice(0, n); s.touched = true;
    window.uiV2.live.render();
    const el = document.querySelector('.v2l-setup [data-su="opponent"]'); el.value = '外觀測試'; el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  // 按開始，量轉場：動畫 id／時間／關鍵影格，和「按下後多久記分盤能接到點擊」。
  const startAndMeasure = page => page.evaluate(() => new Promise(resolve => {
    const start = document.querySelector('.v2l-setup .v2u-start');
    const r0 = start.getBoundingClientRect();
    window.uiV2.live.state.busyUntil = 0;
    const t0 = performance.now();
    start.click();
    const clickSyncMs = performance.now() - t0; // the click handler's own synchronous work
    const live = document.querySelector('.v2-live');
    const anim = live.getAnimations().find(a => a.id === 'v2-enter');
    const veil = document.querySelector('.v2-veil');
    const info = {hasAnim: !!anim, veilShown: !veil.hidden, setupHidden: document.querySelector('.v2-setup-host').hidden, origin: [r0.top, r0.bottom], clickSyncMs};
    // When the animation really starts: startTime is on the document timeline, the same clock as performance.now().
    if (anim) anim.ready.then(() => { info.animStartMs = anim.startTime - t0; });
    if (anim) {
      const t = anim.effect.getTiming();
      info.dur = t.duration; info.easing = t.easing;
      info.props = Object.keys(anim.effect.getKeyframes()[0]).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).sort();
      info.firstClip = anim.effect.getKeyframes()[0].clipPath || '';
    }
    // 進入中能不能點：每一幀看記分盤上的按鍵是不是點得到（elementFromPoint 落在按鍵上、根節點不是 inert）。
    const poll = () => {
      const key = live.querySelector('[data-act="off"]');
      const r = key && key.getBoundingClientRect();
      const hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (key && hit && key.contains(hit) && !live.inert && getComputedStyle(live).pointerEvents !== 'none') {
        info.clickableMs = performance.now() - t0;
        info.duringAnim = !!anim && anim.playState === 'running';
        (anim ? anim.finished : Promise.resolve()).then(() => {
          info.doneMs = performance.now() - t0;
          if (info.animStartMs != null) info.animRunMs = info.doneMs - info.animStartMs;
          requestAnimationFrame(() => { info.veilAfter = !veil.hidden; info.fxAfter = document.body.classList.contains('v2-fx'); info.left = live.getAnimations().map(a => a.id || a.animationName); resolve(info); });
        });
        return;
      }
      if (performance.now() - t0 > 3000) { info.clickableMs = -1; resolve(info); return; }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }));
  try {
    // ---------- B2：開賽設定在網站頁面裡，4 種尺寸 ----------
    for (const [name, w, h] of SIZES) {
      const {context, page} = await open(w, h);
      // fl-booting hides the page until the next frame, so the header reads as hidden until it is gone (WO-05B7R5).
      await page.waitForFunction(() => !document.documentElement.classList.contains('fl-booting'), null, {timeout: 3000}).catch(() => {});
      // Right after switchMainTab the 場記 panel still slides in (a translateY on #panelScorebook); on a slow machine the
      // 44 px controls then measure 43.99997 px. Wait for that page animation to end before the 44 px check (WO-05B7R5).
      await page.waitForFunction(() => document.getElementById('panelScorebook').getAnimations().every(a => a.playState !== 'running'), null, {timeout: 3000}).catch(() => {});
      const s = await page.evaluate(() => {
        const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const setup = document.querySelector('.v2l-setup');
        const panel = document.getElementById('panelScorebook');
        const legacy = [...panel.children].filter(c => !c.classList.contains('v2-setup-host')).some(vis);
        const nav = document.querySelector('.ui-mobile-nav');
        const card = getComputedStyle(setup);
        const small = [...document.querySelectorAll('.v2-setup-host button, .v2-setup-host input')].filter(b => { const r = (b.closest('label') || b).getBoundingClientRect(); return r.width && r.height < 44; }) /* 輸入框的觸控範圍是整個 label（點哪裡都聚焦） */.map(b => b.textContent.trim() || b.dataset.su);
        return {
          inPanel: panel.contains(setup), title: vis(document.getElementById('uiPageTitle')), header: vis(document.getElementById('appHeader')),
          mobileNav: vis(nav), legacy, liveHidden: document.querySelector('.v2-live').hidden,
          sideways: document.documentElement.scrollWidth > innerWidth, radius: card.borderTopLeftRadius, shadow: card.boxShadow !== 'none', bg: card.backgroundImage,
          titleFont: getComputedStyle(setup.querySelector('.v2u-title')).fontFamily, small
        };
      });
      assert.equal(s.inPanel, true, `${name}: setup is inside the 場記 page`);
      assert.equal(s.title && s.header, true, `${name}: site header and page title stay`);
      assert.equal(s.mobileNav, w < 768, `${name}: phone keeps the bottom nav; tablets/desktop use the side drawer only`);
      assert.equal(s.legacy, false, `${name}: legacy setup content hidden`);
      assert.equal(s.liveHidden, true, `${name}: full-screen root stays hidden during setup`);
      assert.equal(s.sideways, false, `${name}: no sideways scroll`);
      assert.equal(s.radius, '22px', `${name}: same 22 px card radius as the site's material cards`);
      assert.ok(s.shadow && /gradient/.test(s.bg), `${name}: site material (gradient + edge) on the setup card`);
      assert.match(s.titleFont, /Mincho/, `${name}: serif title (PO-22)`);
      assert.deepEqual(s.small, [], `${name}: every setup control ≥44 px tall`);
      await context.close();
    }
    passed.push('B2 開賽設定在場記頁裡（標題列、導覽、手機底部列／平板側欄），舊版內容藏起、無橫向捲動、卡片材質與圓角 22、襯線標題、控制項 ≥44 px（4 種尺寸）');

    // ---------- B1：顏色取網站 token；對比 ≥7:1；戶外高對比 ----------
    {
      const {context, page} = await open(390, 844);
      const t = await page.evaluate(() => {
        const host = document.querySelector('.v2-setup-host');
        const css = getComputedStyle(host);
        const site = getComputedStyle(document.body);
        const v = (style, k) => style.getPropertyValue(k).trim().toLowerCase();
        const pairs = {'--v2-out': '--fl-red', '--v2-hit': '--fl-green', '--v2-on': '--fl-accent', '--v2-run': '--fl-amber', '--v2-ink': '--fl-ink', '--v2-bg': '--fl-bg'};
        const map = Object.fromEntries(Object.entries(pairs).map(([a, b]) => [a, [v(css, a), v(site, b)]]));
        const lum = hex => { const n = hex.replace('#', ''); const c = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const dark = v(css, '--v2-dark');
        const contrast = Object.fromEntries(['--v2-out', '--v2-hit', '--v2-on', '--v2-run', '--v2-white'].map(k => [k, Math.round(ratio(v(css, k), dark) * 100) / 100]));
        return {map, contrast};
      });
      for (const [k, [mine, site]] of Object.entries(t.map)) assert.equal(mine, site, `${k} follows the site token`);
      for (const [k, r] of Object.entries(t.contrast)) assert.ok(r >= 7, `${k} on dark text: ${r}:1 ≥ 7:1`);
      // 戶外高對比：在開賽設定和記分畫面都生效（同一個開關）。
      await fillSetup(page);
      const m = await startAndMeasure(page);
      assert.ok(m.clickableMs > 0, 'live screen reachable');
      await page.evaluate(() => { window.uiV2.live.state.busyUntil = 0; document.querySelector('.v2-live [data-act="menu"]').click(); });
      await page.evaluate(() => { window.uiV2.live.state.busyUntil = 0; document.querySelector('.v2-live .v2l-sheet [data-act="hc"]').click(); });
      const hc = await page.evaluate(() => ({live: document.querySelector('.v2-live').classList.contains('hc'), host: document.querySelector('.v2-setup-host').classList.contains('hc'),
        bg: getComputedStyle(document.querySelector('.v2-live')).backgroundColor, key: getComputedStyle(document.querySelector('.v2-live .v2l-key')).borderTopWidth}));
      assert.deepEqual(hc, {live: true, host: true, bg: 'rgb(0, 0, 0)', key: '3px'}, 'outdoor high contrast: black, 3 px frames, setup follows');
      await page.evaluate(() => { window.uiV2.live.state.busyUntil = 0; document.querySelector('.v2-live .v2l-sheet [data-act="hc"]').click(); });
      fs.writeFileSync(path.join(process.env.UI_QA_OUTPUT || require('node:os').tmpdir(), 'ui-v2-look-contrast.json'), JSON.stringify(t, null, 2));
      await context.close();
      passed.push(`B1 語意色＝網站 --fl-red/green/accent/amber，亮底黑字對比 ${Object.values(t.contrast).join(' / ')}（皆 ≥7:1）；戶外高對比在記分與開賽設定都生效`);
    }

    // ---------- B3：進入／離開轉場（手機、平板） ----------
    const timing = [];
    for (const [name, w, h] of [SIZES[0], SIZES[1]]) {
      const {context, page} = await open(w, h);
      await fillSetup(page);
      const m = await startAndMeasure(page);
      const ms = v => v == null ? null : Math.round(v);
      timing.push({name, clickSyncMs: ms(m.clickSyncMs), animStartMs: ms(m.animStartMs), animRunMs: ms(m.animRunMs), doneMs: ms(m.doneMs), clickableMs: ms(m.clickableMs)});
      console.log(`v2-look timing ${JSON.stringify(timing.at(-1))}`);
      fs.writeFileSync(path.join(process.env.UI_QA_OUTPUT || require('node:os').tmpdir(), 'ui-v2-look-timing.json'), JSON.stringify(timing, null, 2));
      assert.equal(m.hasAnim, true, `${name}: entering plays v2-enter`);
      assert.equal(m.dur, 280, `${name}: enter 490 ms ÷ 1.75 = 280 ms`);
      assert.match(m.easing, /cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/, `${name}: site easing`);
      assert.deepEqual(m.props, ['clipPath', 'opacity'], `${name}: the panel expands from its place (clip) and fades in`);
      assert.match(m.firstClip, /^inset\(/, `${name}: starts at the setup card`);
      assert.equal(m.veilShown, true, `${name}: the site behind fades and blurs`);
      assert.ok(m.clickableMs >= 0 && m.clickableMs <= 300, `${name}: clickable within 300 ms (${Math.round(m.clickableMs)} ms)`);
      // WO-05B7R5: "reachable after the tap" is checked by clickableMs ≤ 300 above; the animation itself by animRunMs ≤ 600
      // (from anim.startTime to the end). doneMs (from before click() to the end, which adds the click's own work and the
      // wait for the first frame), clickSyncMs and animStartMs are kept as recorded output only (log and timing.json).
      assert.ok(m.animRunMs <= 600, `${name}: transition finished (animation ran ${Math.round(m.animRunMs)} ms; ${Math.round(m.doneMs)} ms from the tap)`);
      assert.deepEqual([m.veilAfter, m.fxAfter, m.left], [false, false, []], `${name}: veil and helper class removed, no animation left`);
      // 離開：‹ 回首頁，反向收回，收回中不能點，之後根節點隱藏。
      const out = await page.evaluate(() => new Promise(resolve => {
        const live = document.querySelector('.v2-live');
        window.uiV2.live.state.busyUntil = 0;
        const t0 = performance.now();
        live.querySelector('.v2l-head [data-act="leave"]').click();
        // 換頁後 body[data-page] 由 ui-comfort.js 非同步寫入，收回轉場在那之後才開始：等它出現。
        const wait = () => {
          const anim = live.getAnimations().find(a => a.id === 'v2-exit');
          if (!anim && performance.now() - t0 < 1000) { requestAnimationFrame(wait); return; }
          const info = {hasAnim: !!anim, dur: anim && anim.effect.getTiming().duration, blocked: getComputedStyle(live).pointerEvents === 'none', shownDuring: !live.hidden};
          (anim ? anim.finished : Promise.resolve()).then(() => requestAnimationFrame(() => { info.hiddenAfter = live.hidden; info.page = document.body.dataset.page; info.veil = !document.querySelector('.v2-veil').hidden; resolve(info); }));
        };
        wait();
      }));
      assert.deepEqual(out, {hasAnim: true, dur: 240, blocked: true, shownDuring: true, hiddenAfter: true, page: out.page, veil: false}, `${name}: leaving plays v2-exit 240 ms (420 ÷ 1.75), not clickable meanwhile, then hidden`);
      // 回場記頁（比賽還在）：從網站內容區展開。
      const back = await page.evaluate(() => new Promise(resolve => {
        switchMainTab('tabScorebook');
        const check = () => {
          const anim = document.querySelector('.v2-live').getAnimations().find(a => a.id === 'v2-enter');
          if (document.body.classList.contains('v2-live-on')) resolve({anim: !!anim, dur: anim && anim.effect.getTiming().duration}); else requestAnimationFrame(check);
        };
        check();
      }));
      assert.deepEqual(back, {anim: true, dur: 280}, `${name}: opening the site onto a game in progress also expands in`);
      await context.close();
    }
    passed.push('B3 進入 v2-enter 280 ms（從開賽設定卡展開＋背景淡出模糊）、300 ms 內可點；離開 v2-exit 240 ms、收回中不可點；回到進行中比賽也有展開（手機、平板）');

    // ---------- B3：減少動態只淡入淡出 ----------
    {
      const {context, page} = await open(390, 844, {reducedMotion: 'reduce'});
      await fillSetup(page);
      const m = await startAndMeasure(page);
      assert.deepEqual([m.hasAnim, m.dur, m.props], [true, 160, ['opacity']], 'reduced motion: a plain 160 ms fade, no expanding');
      assert.ok(m.clickableMs >= 0 && m.clickableMs <= 300, `reduced motion: clickable within 300 ms (${Math.round(m.clickableMs)} ms)`);
      await context.close();
      passed.push('B3 減少動態：只淡入 160 ms，沒有展開');
    }

    // ---------- B4：場記裡沒有 Clawd ----------
    {
      const {context, page} = await open(390, 844);
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => !!document.getElementById('flClawd')), false, 'no Clawd on the 場記 page (setup)');
      await fillSetup(page);
      await startAndMeasure(page);
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => !!document.getElementById('flClawd')), false, 'no Clawd while scoring');
      await context.close();
      passed.push('B4 沒有 :has()；場記（開賽設定、記分）沒有 Clawd');
    }

    assert.deepEqual(errors, [], 'no page errors');
    assert.equal(externalGitHub, 0, 'no request reached GitHub');
    assert.deepEqual(hashes(), diskBefore, 'data/*.json untouched');
    for (const line of passed) console.log(`PASS ${line}`);
    console.log(`ui-v2-look: ${passed.length} checks passed`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
