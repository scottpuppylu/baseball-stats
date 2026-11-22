// WO-08 打序一點就到（PO-47）：新版場記的打者卡／投手卡整張是「打序」入口，換人、改目前打者都在同一個打序 sheet 做完。
//   AC-2 實際點擊數（真的滑鼠點）：改打者 ≤2 下、到換人選球員 ≤2 下、換人完成 ≤3 下；390、820、1180 寬，攻與守都算。
//        820 直式另有常駐打序：點任一棒直接開打序、停在那一棒。
//   AC-3 新入口和 ⋯ 舊入口（⋯ → 換人／改目前打者，現在打開同一個打序 sheet）做同樣的換人＋改打者，比賽資料完全相同（去掉 id／時間）。
//   AC-4 點打者卡、投手卡後 0 筆新紀錄；sheet 開著時點記分盤位置也 0 筆（被遮罩擋住）。
//   AC-6 390、820、1180、1440 四種尺寸：主畫面與打序 sheet 沒有水平溢出、按鍵字不斷行；記分盤每顆鍵的位置和大小與
//        「拿掉新入口（常駐打序、打序 ›）」時相同（0 px），也就是新入口只讓球場變矮，記分盤不動。
// 用法：node tests/ui-v2-lineup-access.cjs（自己起隔離預覽，port 54518）；GitHub 用預覽的假 API，不寫 data/*.json。
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
const VOLATILE = /^(id|gameId|playId|.*At|ts|time|timestamp|savedAt|updated|created)$/i;
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => !VOLATILE.test(k)).map(k => [k, normalize(value[k])]));
  return value;
}
const SIZES = [['phone-390', 390, 844], ['tablet-portrait-820', 820, 1180], ['tablet-landscape-1180', 1180, 820], ['desktop-1440', 1440, 900]];

(async () => {
  const diskBefore = hashes();
  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { preview = await startPreview(54518); url = 'http://127.0.0.1:54518'; }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  const passed = [];
  let externalGitHub = 0;
  const open = async (w, h) => {
    const context = await browser.newContext({viewport: {width: w, height: h}, isMobile: w < 768, hasTouch: w < 1200});
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(`${w}x${h}: ${error.message}`));
    await page.goto(url + '/?ui=v2');
    await page.waitForFunction(() => window.teamRecords && window.uiV2 && window.uiV2.live && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    await page.evaluate(() => switchMainTab('tabScorebook'));
    await page.waitForFunction(() => document.body.classList.contains('v2-setup-on') && document.querySelector('.v2l-setup .v2u-start'));
    await page.evaluate(() => {
      if (typeof renderSetupLineupGrid === 'function') renderSetupLineupGrid();
      const s = window.uiV2.live.state.setup;
      s.dh = !!isDhEnabled; const n = s.dh ? 11 : 10;
      s.lineup = setupLineupList.slice(0, n); s.pos = setupLineupPositions.slice(0, n); s.touched = true;
      window.uiV2.live.render();
      const el = document.querySelector('.v2l-setup [data-su="opponent"]'); el.value = '打序測試'; el.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await tap(page, '.v2l-setup [data-act="su-start"]');
    await page.waitForFunction(() => document.body.classList.contains('v2-live-on') && !document.querySelector('.v2-live').getAnimations().length);
    return {context, page};
  };
  // 準備動作（不算在點擊數裡）：直接觸發按鈕。
  const tap = (page, sel) => page.evaluate(sel => { window.uiV2.live.state.busyUntil = 0; const b = document.querySelector(sel); if (!b) throw new Error('missing ' + sel); b.click(); }, sel);
  // 使用者動作：真的滑鼠點（被遮住、不在畫面上就會失敗），每點一下記一次。防連點時間歸零，模擬兩下之間正常的間隔。
  const clicker = page => {
    const c = async sel => {
      await page.evaluate(() => { window.uiV2.live.state.busyUntil = 0; });
      await page.locator(sel).first().click({timeout: 3000});
      c.n += 1;
    };
    c.n = 0;
    return c;
  };
  const recordPa = async (page, code) => {
    await tap(page, `.v2-live [data-act="off"][data-code="${code}"]`);
    if (await page.$('.v2l-sheet [data-act="pa-submit"]')) await tap(page, '.v2l-sheet [data-act="pa-submit"]');
  };
  const records = page => page.evaluate(() => (activeGame.innings || []).reduce((n, inn) => n + (inn.plateAppearances || []).length + (inn.defensiveEvents || []).length, 0));
  const sheetName = page => page.evaluate(() => window.uiV2.live.state.sheet);
  const snack = page => page.evaluate(() => document.querySelector('.v2-live .v2l-snack')?.textContent || '');
  const keyRects = page => page.evaluate(() => [...document.querySelectorAll('.v2-live .v2l-padwrap button')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.code || b.dataset.act, Math.round(r.left * 100) / 100, Math.round(r.top * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100]; }));
  // 打序 sheet：每棒一列（棒次、姓名、守位、本場成績）、兩個動作；目前／下一棒標記；底部換投、DH。不溢出、按鍵字不斷行。
  const sheetLook = page => page.evaluate(() => {
    const s = document.querySelector('.v2-live .v2l-sheet');
    const rows = [...s.querySelectorAll('.v2s-lrow')];
    const fits = el => el.scrollWidth <= el.clientWidth + 1;
    return {
      title: s.querySelector('.v2s-title').textContent,
      rows: rows.length, lineup: activeGame.lineup.length,
      complete: rows.every(r => r.querySelector('.v2s-lno') && r.querySelector('.v2s-lnm') && r.querySelector('.v2s-ltags') && r.querySelector('[data-act="pick-batter"]') && r.querySelector('[data-act="sub-slot"]')),
      marks: rows.map(r => r.querySelector('.v2s-lmark')?.textContent || ''),
      onIdx: rows.findIndex(r => r.classList.contains('on')),
      cur: activeGame.currentBatterIdx,
      heights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
      btnOneLine: [...s.querySelectorAll('.v2s-lbtn')].every(b => b.getBoundingClientRect().height <= 46 && fits(b)),
      btnLabels: [...new Set([...s.querySelectorAll('.v2s-lbtn')].map(b => b.textContent))],
      footer: [...s.querySelectorAll(':scope > [data-act="pitcher"], :scope > [data-act="dh"]')].map(b => b.querySelector('span').textContent),
      overflow: s.scrollWidth > s.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth,
      radius: getComputedStyle(s).borderTopLeftRadius,
    };
  });
  const mainOverflow = page => page.evaluate(() => {
    const live = document.querySelector('.v2-live');
    const go = live.querySelector('.v2l-card-go');
    const gr = go.getBoundingClientRect();
    const cr = live.querySelector('.v2l-card').getBoundingClientRect();
    return {x: document.documentElement.scrollWidth > innerWidth || live.scrollWidth > live.clientWidth + 1,
      go: go.textContent, goInside: gr.width > 0 && gr.right <= cr.right + .5 && gr.left >= cr.left && go.scrollWidth <= go.clientWidth + 1,
      order: [...live.querySelectorAll('.v2l-ord')].every(o => o.scrollWidth <= o.clientWidth + 1)};
  });

  try {
    const clicks = {};
    for (const [name, w, h] of SIZES) {
      const {context, page} = await open(w, h);
      await recordPa(page, 'BB');
      await recordPa(page, '1H');
      await recordPa(page, 'K');
      await page.evaluate(() => { window.uiV2.live.state.busyUntil = 0; });
      await page.waitForTimeout(300);
      const tablet = w >= 768 && w < 1024;
      const orderShown = await page.evaluate(() => getComputedStyle(document.querySelector('.v2-live .v2l-order')).display !== 'none');
      assert.equal(orderShown, tablet, `${name}: 常駐打序只在平板直式出現`);

      // ---------- AC-6 主畫面 ----------
      const mo = await mainOverflow(page);
      assert.deepEqual(mo, {x: false, go: '打序 ›', goInside: true, order: true}, `${name}: 主畫面不溢出、卡上看得到「打序 ›」`);
      const keysNow = await keyRects(page);
      const keysBare = await page.evaluate(() => {
        const live = document.querySelector('.v2-live');
        live.querySelector('.v2l-order').style.display = 'none';
        live.querySelector('.v2l-card-go').style.display = 'none';
        const out = [...live.querySelectorAll('.v2l-padwrap button')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.code || b.dataset.act, Math.round(r.left * 100) / 100, Math.round(r.top * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100]; });
        live.querySelector('.v2l-order').style.display = '';
        window.uiV2.live.render();
        return out;
      });
      assert.deepEqual(keysNow, keysBare, `${name}: 記分盤每顆鍵位置、大小和沒有新入口時相同（0 px）`);
      const fieldH = await page.evaluate(() => document.querySelector('.v2-live .v2l-field').getBoundingClientRect().height);
      assert.ok(fieldH >= 200, `${name}: 球場還在（${Math.round(fieldH)} px）`);

      // ---------- AC-4 點打者卡：只開 sheet，0 筆新紀錄；sheet 開著點記分盤位置也 0 筆 ----------
      const before = await records(page);
      const k = keysNow.find(r => r[0] === '1H');
      const c = clicker(page);
      await c('.v2-live .v2l-card');
      assert.equal(await sheetName(page), 'lineup', `${name}: 點打者卡打開打序`);
      assert.equal(await records(page), before, `${name}: 點打者卡 0 筆新紀錄`);
      const look = await sheetLook(page);
      assert.equal(look.title, '打序');
      assert.equal(look.rows, look.lineup, `${name}: 每一棒一列`);
      assert.ok(look.complete, `${name}: 每列有棒次、姓名、本場成績、從這棒打、換人`);
      assert.equal(look.onIdx, look.cur, `${name}: 目前打者那列有框`);
      assert.equal(look.marks[look.cur], '目前');
      assert.equal(look.marks[(look.cur + 1) % look.lineup], '下一棒');
      for (const hh of look.heights) assert.ok(hh >= 52 && hh <= 56, `${name}: 列高 52–56（${hh}）`);
      assert.ok(look.btnOneLine, `${name}: 從這棒打／換人 不斷行、不截字`);
      assert.deepEqual(look.btnLabels, ['從這棒打', '換人']);
      assert.deepEqual(look.footer, ['換投', 'DH 制'], `${name}: 底部換投、DH 制`);
      assert.equal(look.overflow, false, `${name}: 打序 sheet 不溢出`);
      assert.equal(look.radius, '24px');
      await page.mouse.click(k[1] + k[3] / 2, k[2] + k[4] / 2);
      assert.equal(await records(page), before, `${name}: sheet 開著時點記分盤位置 0 筆新紀錄`);
      if (await sheetName(page)) await tap(page, '.v2l-sheet [data-act="close"]');

      // ---------- AC-2 改打者 ≤2 下 ----------
      const c1 = clicker(page);
      await c1('.v2-live .v2l-card');
      await c1('.v2l-sheet [data-act="pick-batter"][data-i="6"]');
      const name6 = await page.evaluate(() => activeGame.lineup[6]);
      assert.equal(await page.evaluate(() => activeGame.currentBatterIdx), 6, `${name}: 從這棒打 → 目前打者第 7 棒`);
      assert.equal(await sheetName(page), null, `${name}: 按了關 sheet`);
      assert.equal((await snack(page)).includes(`目前打者：第 7 棒 ${name6}`), true, `${name}: 回報「目前打者：第 7 棒 ${name6}」`);
      // ---------- AC-2 到換人選球員 ≤2 下；換人完成 ≤3 下 ----------
      const c2 = clicker(page);
      await c2('.v2-live .v2l-card');
      await c2('.v2l-sheet [data-act="sub-slot"][data-i="2"]');
      const picker = await page.evaluate(() => ({sub: window.uiV2.live.state.sub, title: document.querySelector('.v2l-sheet .v2s-title').textContent,
        guest: !!document.querySelector('.v2l-sheet [data-act="sub-guest"]'), picks: document.querySelectorAll('.v2l-sheet [data-act="sub-pick"]').length}));
      assert.equal(picker.sub, 2, `${name}: 棒次已選好`);
      assert.match(picker.title, /換下第 3 棒/);
      assert.ok(picker.guest && picker.picks > 0, `${name}: 選球員清單有球員和「＋ 新增支援選手」`);
      const pickName = await page.evaluate(() => document.querySelector('.v2l-sheet [data-act="sub-pick"]').dataset.name);
      const toPicker = c2.n;
      await c2('.v2l-sheet [data-act="sub-pick"]');
      assert.equal(await page.evaluate(() => activeGame.lineup[2]), pickName, `${name}: 換人完成`);
      assert.equal(await sheetName(page), null);
      clicks[name] = {batter: c1.n, picker: toPicker, sub: c2.n};
      // 常駐打序（平板直式）：點第 9 棒 → 打序 sheet 停在那一棒，再一下就改好
      if (tablet) {
        const c3 = clicker(page);
        await c3('.v2-live .v2l-order [data-i="8"]');
        const focus = await page.evaluate(() => ({sheet: window.uiV2.live.state.sheet, act: document.activeElement?.dataset.act, i: document.activeElement?.dataset.i}));
        assert.deepEqual(focus, {sheet: 'lineup', act: 'pick-batter', i: '8'}, `${name}: 常駐打序點第 9 棒，sheet 停在那一棒`);
        await c3('.v2l-sheet [data-act="pick-batter"][data-i="8"]');
        assert.equal(await page.evaluate(() => activeGame.currentBatterIdx), 8);
        clicks[name].order = c3.n;
      }
      // ---------- ⋯ 舊入口打開同一個 sheet ----------
      await tap(page, '.v2-live [data-act="menu"]');
      await tap(page, '.v2l-sheet [data-act="sub"]');
      assert.equal(await sheetName(page), 'lineup', `${name}: ⋯ → 換人 打開打序`);
      await tap(page, '.v2l-sheet [data-act="close"]');
      await tap(page, '.v2-live [data-act="menu"]');
      await tap(page, '.v2l-sheet [data-act="batter"]');
      assert.equal(await sheetName(page), 'lineup', `${name}: ⋯ → 改目前打者 打開打序`);
      await tap(page, '.v2l-sheet [data-act="close"]');

      // ---------- 守備：投手卡開同一個 sheet；0 筆新紀錄；改打者、換人點擊數一樣 ----------
      await page.evaluate(() => { activeGame.currentOuts = 2; window.uiV2.live.render(); });
      await recordPa(page, 'K');
      await tap(page, '.v2-live [data-act="inning"]');
      await page.waitForFunction(() => document.querySelector('.v2-live').classList.contains('v2l-def'));
      await page.evaluate(() => { window.uiV2.live.state.busyUntil = 0; });
      const defKeys = await keyRects(page);
      const before2 = await records(page);
      const d = clicker(page);
      await d('.v2-live .v2l-card');
      assert.equal(await sheetName(page), 'lineup', `${name}: 防守時點投手卡打開打序`);
      assert.equal(await records(page), before2, `${name}: 點投手卡 0 筆新紀錄`);
      const dlook = await sheetLook(page);
      assert.equal(dlook.marks[dlook.cur], '下局先打', `${name}: 防守時目前那棒標「下局先打」`);
      assert.deepEqual(dlook.footer, ['換投', 'DH 制']);
      assert.equal(dlook.overflow, false);
      const dk = defKeys[0];
      await page.mouse.click(dk[1] + dk[3] / 2, dk[2] + dk[4] / 2);
      assert.equal(await records(page), before2, `${name}: 防守 sheet 開著時點記分盤位置 0 筆新紀錄`);
      if (await sheetName(page)) await tap(page, '.v2l-sheet [data-act="close"]');
      const d1 = clicker(page);
      await d1('.v2-live .v2l-card');
      await d1('.v2l-sheet [data-act="sub-slot"][data-i="5"]');
      const dToPicker = d1.n;
      const dPick = await page.evaluate(() => document.querySelector('.v2l-sheet [data-act="sub-pick"]').dataset.name);
      await d1('.v2l-sheet [data-act="sub-pick"]');
      assert.equal(await page.evaluate(() => activeGame.lineup[5]), dPick, `${name}: 防守換人完成`);
      const d2 = clicker(page);
      await d2('.v2-live .v2l-card');
      await d2('.v2l-sheet [data-act="pick-batter"][data-i="3"]');
      assert.equal(await page.evaluate(() => activeGame.currentBatterIdx), 3);
      clicks[name].defBatter = d2.n; clicks[name].defPicker = dToPicker; clicks[name].defSub = d1.n;
      // 守備時：投手卡 → 換投 走既有換投 sheet
      await tap(page, '.v2-live .v2l-card');
      await tap(page, '.v2l-sheet [data-act="pitcher"]');
      assert.equal(await sheetName(page), 'pitcher', `${name}: 打序底部「換投」走既有換投`);
      await tap(page, '.v2l-sheet [data-act="close"]');
      // 鍵盤：打者卡 Enter 也開打序
      await page.focus('.v2-live .v2l-card');
      await page.keyboard.press('Enter');
      assert.equal(await sheetName(page), 'lineup', `${name}: 卡片按 Enter 打開打序`);
      await page.keyboard.press('Escape');
      assert.equal(await mainOverflow(page).then(m => m.x), false, `${name}: 防守主畫面不溢出`);
      await context.close();
    }
    for (const [name, c] of Object.entries(clicks)) {
      assert.ok(c.batter <= 2 && c.defBatter <= 2, `${name}: 改打者 ≤2 下（${c.batter}/${c.defBatter}）`);
      assert.ok(c.picker <= 2 && c.defPicker <= 2, `${name}: 到換人選球員 ≤2 下（${c.picker}/${c.defPicker}）`);
      assert.ok(c.sub <= 3 && c.defSub <= 3, `${name}: 換人完成 ≤3 下（${c.sub}/${c.defSub}）`);
      if (c.order != null) assert.ok(c.order <= 2, `${name}: 常駐打序改打者 ≤2 下`);
    }
    passed.push(`AC-2 實際點擊數（攻／守）：${Object.entries(clicks).map(([n, c]) => `${n} 改打者 ${c.batter}/${c.defBatter}、到選球員 ${c.picker}/${c.defPicker}、換人 ${c.sub}/${c.defSub}${c.order ? `、常駐打序 ${c.order}` : ''}`).join('；')}`);
    passed.push('AC-4 4 尺寸：點打者卡／投手卡 0 筆新紀錄；sheet 開著時點記分盤位置 0 筆');
    passed.push('AC-6 4 尺寸：主畫面、打序 sheet 不溢出、按鍵不斷行；記分盤每顆鍵位置和大小與拿掉新入口時相同（0 px）；常駐打序只在平板直式');

    // ---------- AC-3 新入口 vs ⋯ 舊入口：同樣的改打者＋換人，比賽資料相同 ----------
    const run = async via => {
      const {context, page} = await open(390, 844);
      await page.evaluate(() => { let t = 1765000000000; Date.now = () => (t += 1000); });
      await recordPa(page, 'BB');
      await recordPa(page, 'K');
      const openLineup = async () => {
        if (via === 'card') await tap(page, '.v2-live .v2l-card');
        else { await tap(page, '.v2-live [data-act="menu"]'); await tap(page, '.v2l-sheet [data-act="batter"]'); }
      };
      const openSub = async () => {
        if (via === 'card') await tap(page, '.v2-live .v2l-card');
        else { await tap(page, '.v2-live [data-act="menu"]'); await tap(page, '.v2l-sheet [data-act="sub"]'); }
      };
      await openLineup();
      await tap(page, '.v2l-sheet [data-act="pick-batter"][data-i="4"]');
      await openSub();
      await tap(page, '.v2l-sheet [data-act="sub-slot"][data-i="2"]');
      await tap(page, '.v2l-sheet [data-act="sub-pick"]');
      await recordPa(page, '1H');
      const game = await page.evaluate(() => JSON.parse(JSON.stringify(activeGame)));
      await context.close();
      return game;
    };
    const viaCard = await run('card');
    const viaMenu = await run('menu');
    assert.equal(viaCard.lineup.length, viaMenu.lineup.length);
    assert.notEqual(viaCard.lineup[2], undefined);
    assert.deepEqual(normalize(viaCard), normalize(viaMenu), '新入口和 ⋯ 入口做出來的比賽資料相同');
    passed.push('AC-3 新入口（打者卡）和 ⋯ 入口做同樣的改打者＋換人，比賽資料（去掉 id／時間）完全相同');

    assert.deepEqual(errors, []);
    assert.equal(externalGitHub, 0);
    assert.deepEqual(hashes(), diskBefore, 'data/*.json 不能被改');
    for (const p of passed) console.log('PASS ' + p);
    console.log(`ui-v2-lineup-access: ${passed.length} checks passed`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
