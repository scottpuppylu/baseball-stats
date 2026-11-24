// Not run by run-all since WO-05B7R4: B7's on-demand suggested lineup was taken back from the site; kept for when it returns.
// WO-05 B7 建議打線按需計算（PO-30a）：新版打線頁不直接顯示、也不計算建議打線，「更多 → 建議打線 → 計算」才載入算法。
//   AC-2 新版打線頁第一次載入：lineup-recommender.js 請求 0 次、算法（LineupModel 搜尋與評估函式、analyzeLineupOrder）呼叫 0 次；
//        建議打線區塊藏起來，只看得到「更多」。
//   AC-3 按「計算」之後，建議打線表格（每一棒的名字、守位、數字）和舊版打線頁完全相同；「帶入自訂棒次分析」帶入的棒次、
//        DH 棒次也相同。實際滑鼠點擊數：更多 → 建議打線 → 計算 = 3 下。
//   AC-4 新版開賽流程（場記 → 開賽設定）不載入 lineup-recommender.js，先發打線預設帶入上一場。
//   AC-6 390、820×1180、1180×820、1440：打線頁、「更多」選單、建議打線 sheet、計算結果沒有水平溢出，按鍵字不斷行、觸控 ≥44 px；
//        sheet 升起動畫是 1.75 倍速（與覆盤 sheet 同一個動畫）。截圖寫到 UI_QA_OUTPUT/lineup-rec/。
//   AC-7 PWA：已快取後離線，按「計算」仍然算得出來（lineup-recommender.js 在預先快取裡）。
// 用法：node tests/ui-v2-lineup-rec.cjs（自己起隔離預覽，port 54522）；GitHub 用預覽的假 API，不寫 data/*.json。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const hashes = () => Object.fromEntries(fs.readdirSync(path.join(root, 'data')).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', f))).digest('hex')]));
const output = path.join(process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa'), 'lineup-rec');

function startPreview(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'ui-preview-server.cjs')], {cwd: root, env: {...process.env, UI_PREVIEW_PORT: String(port)}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    const timer = setTimeout(() => reject(new Error('preview startup timed out')), 15000);
    child.once('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(child); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited ${code}`)); });
  });
}
const SIZES = [['phone-390', 390, 844], ['tablet-portrait-820', 820, 1180], ['tablet-landscape-1180', 1180, 820], ['desktop-1440', 1440, 900]];
const RECOMMENDER = /\/lineup-recommender\.js(\?|$)/;
const MODEL_FNS = ['simulateRecommendation', 'optimizeOrder', 'evaluateOrder', 'slotSensitivity', 'batterModel', 'teamRates', 'makeConfig'];

// 在 lineup-model.js 執行之前就攔下 window.LineupModel，把算法函式包起來計次（不改它的結果）。
function countModelCalls(names) {
  window.__modelCalls = {};
  let api;
  Object.defineProperty(window, 'LineupModel', {
    configurable: true,
    get: () => api,
    set: value => {
      api = value;
      for (const name of names) {
        if (typeof value[name] !== 'function') continue;
        const original = value[name];
        window.__modelCalls[name] = 0;
        value[name] = function () { window.__modelCalls[name] += 1; return original.apply(this, arguments); };
      }
    }
  });
}

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const diskBefore = hashes();
  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { const port = Number(process.env.UI_PREVIEW_PORT) || 54522; preview = await startPreview(port); url = `http://127.0.0.1:${port}`; }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  const passed = [];
  let externalGitHub = 0;
  const open = async (query, w = 390, h = 844) => {
    const context = await browser.newContext({viewport: {width: w, height: h}, isMobile: w < 768, hasTouch: w < 1200});
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    await context.addInitScript(countModelCalls, MODEL_FNS);
    const page = await context.newPage();
    const requests = [];
    page.on('request', request => { if (RECOMMENDER.test(new URL(request.url()).pathname)) requests.push(request.url()); });
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(`${query} ${w}x${h}: ${error.message}`));
    await page.goto(url + '/' + query);
    await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    return {context, page, requests};
  };
  const toLineup = async page => {
    await page.evaluate(() => switchMainTab('tabLineup'));
    await page.waitForFunction(() => !document.getElementById('panelLineup').classList.contains('hidden') && document.querySelectorAll('#customLineupPickersContainer > *').length > 0);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  // 實際滑鼠點（被遮住、不在畫面上就失敗），每點一下記一次；等 sheet 動畫停下再點下一下。
  const clicker = page => {
    const c = async sel => {
      await page.locator(sel).first().click({timeout: 5000});
      c.n += 1;
      await page.waitForFunction(() => !document.querySelector('.v2lu-layer') || !document.querySelector('.v2lu-layer').getAnimations({subtree: true}).some(a => a.playState === 'running'));
    };
    c.n = 0;
    return c;
  };
  const calculate = async page => {
    const click = clicker(page);
    await click('.v2lu-more');
    await click('.v2lu-layer [data-lu="rec"]');
    await click('.v2lu-layer [data-lu="calc"]');
    await page.waitForFunction(() => document.querySelector('[data-v2-rec]')?.dataset.v2Rec === 'shown' && !document.querySelector('.v2lu-layer'));
    return click.n;
  };
  // 建議打線表格：每一列每一格的文字（名字、守位、數字）。
  const recTable = page => page.evaluate(() => [...document.querySelectorAll('#recommendedLineupBody tr')].map(tr => [...tr.cells].map(td => td.textContent.replace(/\s+/g, ' ').trim())));
  const recSummary = page => page.evaluate(() => {
    const el = document.getElementById('lineupModelSummary');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  const applied = page => page.evaluate(() => {
    applyRecommendedToCustom();
    return {lineup: customLineup.slice(), dhSlot: customDhSlot};
  });

  try {
    // ---------- AC-2：新版打線頁第一次載入，不載入、不呼叫算法 ----------
    let v2Table, v2Summary, v2Applied, clicks;
    {
      const {context, page, requests} = await open('?ui=v2');
      await toLineup(page);
      // 給它時間（閒置排程、延後載入如果有的話都該跑完了）。
      await page.waitForTimeout(1500);
      const before = await page.evaluate(() => ({
        calls: {...window.__modelCalls}, analyze: typeof window.analyzeLineupOrder,
        lazy: document.querySelectorAll('script[data-v2-lazy]').length,
        hidden: document.querySelector('[data-v2-rec]').classList.contains('hidden') && document.querySelector('[data-v2-rec]').getClientRects().length === 0,
        more: !!document.querySelector('.v2lu-more')?.getClientRects().length
      }));
      assert.deepEqual(requests, [], 'lineup-recommender.js is not requested on the v2 lineup page');
      assert.ok(Object.keys(before.calls).length >= 5, `LineupModel functions are being counted: ${Object.keys(before.calls)}`);
      assert.deepEqual(Object.values(before.calls).filter(n => n), [], `no algorithm call before 計算: ${JSON.stringify(before.calls)}`);
      assert.equal(before.analyze, 'undefined', 'analyzeLineupOrder is not defined before 計算');
      assert.equal(before.lazy, 0);
      assert.ok(before.hidden && before.more, 'the recommended lineup is hidden; only 更多 shows');
      passed.push(`AC-2 新版打線頁首次載入：recommender 請求 0、算法呼叫 0（${Object.keys(before.calls).join('、')}）`);

      clicks = await calculate(page);
      assert.equal(clicks, 3, 'more → 建議打線 → 計算 is three clicks');
      assert.equal(requests.length, 1, `lineup-recommender.js requested once after 計算: ${requests}`);
      assert.match(requests[0], /lineup-recommender\.js\?v=/, 'the same versioned file as the static page');
      const after = await page.evaluate(() => ({calls: {...window.__modelCalls}, analyze: typeof window.analyzeLineupOrder, focus: document.activeElement?.id}));
      assert.ok(after.calls.simulateRecommendation >= 1, `the search ran after 計算: ${JSON.stringify(after.calls)}`);
      assert.equal(after.analyze, 'function');
      assert.equal(after.focus, 'recLineupTitle', 'focus moves to the result');
      v2Table = await recTable(page);
      v2Summary = await recSummary(page);
      // 再按一次（重新計算）：不再請求檔案，結果一樣。
      const again = clicker(page);
      await again('.v2lu-more');
      await again('.v2lu-layer [data-lu="rec"]');
      assert.match(await page.locator('.v2lu-layer [data-lu="calc"]').textContent(), /重新計算/);
      await again('.v2lu-layer [data-lu="calc"]');
      await page.waitForFunction(() => !document.querySelector('.v2lu-layer'));
      assert.equal(requests.length, 1, 'recalculating does not load the file again');
      assert.deepEqual(await recTable(page), v2Table, 'recalculating gives the same table');
      v2Applied = await applied(page);
      await context.close();
    }

    // ---------- AC-3：結果和舊版（旗標關）相同 ----------
    {
      const {context, page, requests} = await open('?ui=v1');
      await toLineup(page);
      assert.equal(requests.length, 1, 'flag off: the page loads lineup-recommender.js as before');
      assert.equal(await page.evaluate(() => typeof window.analyzeLineupOrder), 'function');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.v2lu-bar, [data-v2-rec]').length), 0, 'flag off: no v2 lineup UI');
      const v1Table = await recTable(page);
      assert.ok(v1Table.length >= 10, `old page shows the recommendation (${v1Table.length} rows)`);
      assert.deepEqual(v2Table, v1Table, 'v2 after 計算 shows the same batting order, positions and numbers');
      assert.equal(v2Summary, await recSummary(page), 'same model summary');
      const v1Applied = await applied(page);
      assert.deepEqual(v2Applied, v1Applied, '帶入自訂棒次分析 brings in the same order and DH slot');
      passed.push(`AC-3 計算後建議打線 ${v1Table.length} 列（棒次、名字、守位、數字）與舊版逐格相同；帶入自訂分析相同（${v1Applied.lineup.length} 棒，DH ${v1Applied.dhSlot}）；點擊數 ${clicks} 下`);
      await context.close();
    }

    // ---------- AC-4：開賽流程不載入 recommender，先發帶入上一場 ----------
    {
      const {context, page, requests} = await open('?ui=v2');
      await page.evaluate(() => switchMainTab('tabScorebook'));
      await page.waitForFunction(() => document.body.classList.contains('v2-setup-on') && document.querySelector('.v2l-setup [data-v2-from]'));
      await page.waitForTimeout(800);
      const s = await page.evaluate(() => {
        const prev = allGames.filter(x => (x.startingLineup || x.lineup || []).length >= 10)
          .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)))[0];
        const expected = (prev.startingLineup || prev.lineup).slice(0, prev.hasDh && (prev.startingLineup || prev.lineup).length >= 11 ? 11 : 10);
        const shown = [...document.querySelectorAll('.v2l-setup .v2u-name')].map(b => b.getAttribute('aria-label').replace(/^第 \d+ 棒：/, ''));
        return {expected, shown, from: document.querySelector('.v2l-setup [data-v2-from]').textContent, calls: {...window.__modelCalls}, analyze: typeof window.analyzeLineupOrder};
      });
      assert.deepEqual(requests, [], 'the game setup does not load lineup-recommender.js');
      assert.equal(s.analyze, 'undefined');
      assert.equal(s.calls.simulateRecommendation || 0, 0, 'no recommendation search in the setup');
      assert.match(s.from, /^帶入上一場 /);
      assert.deepEqual(s.shown, s.expected, 'starting lineup defaults to the previous game');
      passed.push(`AC-4 開賽設定：recommender 請求 0、搜尋呼叫 0；先發帶入上一場（${s.expected.length} 棒）`);
      await context.close();
    }

    // ---------- AC-6：四種尺寸版面 ----------
    {
      const notes = [];
      for (const [name, w, h] of SIZES) {
        const {context, page} = await open('?ui=v2', w, h);
        await toLineup(page);
        const check = async (label, selectors) => {
          const r = await page.evaluate(selectors => {
            const overflow = document.documentElement.scrollWidth - innerWidth;
            const bad = [];
            for (const sel of selectors) for (const el of document.querySelectorAll(sel)) {
              if (!el.getClientRects().length) continue;
              const box = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
              // 按鍵字不斷行：主文字只有一行（小字說明另算）。
              const main = el.matches('.v2s-item') ? el.querySelector(':scope > span') : el;
              const range = document.createRange(); range.selectNodeContents(main);
              // 圖示和文字垂直置中時 top 會差幾 px；相差超過半行才算換到下一行。
              const tops = [...range.getClientRects()].filter(rc => rc.width > 0).map(rc => rc.top + rc.height / 2).sort((a, b) => a - b);
              const lines = tops.reduce((n, t, i) => n + (i && t - tops[i - 1] > line * 0.6 ? 1 : 0), tops.length ? 1 : 0);
              if (box.height < 44 || box.width < 44) bad.push(`${sel} ${Math.round(box.width)}x${Math.round(box.height)} <44`);
              if (lines > 1) bad.push(`${sel} text wraps (${lines} lines, line ${line})`);
              if (box.left < -0.5 || box.right > innerWidth + 0.5) bad.push(`${sel} outside the screen`);
            }
            return {overflow, bad};
          }, selectors);
          assert.ok(r.overflow <= 0, `${name} ${label}: no horizontal overflow (${r.overflow})`);
          assert.deepEqual(r.bad, [], `${name} ${label}`);
          await page.screenshot({path: path.join(output, `${name}-${label}.png`)});
        };
        // 進頁的淡入動畫跑完再量、再截圖。
        await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)));
        await check('lineup', ['.v2lu-more']);
        await page.locator('.v2lu-more').click();
        // 升起動畫：與覆盤 sheet 同一個（1.75 倍速）；記下時間長度，等它停下再量。
        const rise = await page.evaluate(() => document.querySelector('.v2lu-layer').getAnimations({subtree: true}).map(a => Math.round(a.effect.getComputedTiming().duration)));
        await page.waitForFunction(() => !document.querySelector('.v2lu-layer').getAnimations({subtree: true}).some(a => a.playState === 'running'));
        await check('more-menu', ['.v2lu-layer .v2s-item', '.v2lu-layer .v2s-x']);
        await page.locator('.v2lu-layer [data-lu="rec"]').click();
        await page.waitForFunction(() => !document.querySelector('.v2lu-layer').getAnimations({subtree: true}).some(a => a.playState === 'running'));
        await check('rec-sheet', ['.v2lu-layer [data-lu="calc"]', '.v2lu-layer [data-lu="back"]', '.v2lu-layer .v2s-x']);
        await page.locator('.v2lu-layer [data-lu="calc"]').click();
        await page.waitForFunction(() => document.querySelector('[data-v2-rec]').dataset.v2Rec === 'shown' && !document.querySelector('.v2lu-layer'));
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        await check('result', ['.v2lu-more']);
        const top = await page.evaluate(() => Math.round(document.getElementById('recLineupTitle').getBoundingClientRect().top));
        assert.ok(top >= 0 && top < h / 2, `${name}: the result is scrolled into view (title at ${top})`);
        notes.push(`${name}（sheet 動畫 ${rise.join('/') || '無'} ms）`);
        await context.close();
      }
      passed.push(`AC-6 四尺寸打線頁／更多選單／建議打線 sheet／結果：溢出 0、斷行 0、觸控 ≥44：${notes.join('、')}`);
    }

    // ---------- AC-7：PWA 已快取時離線按「計算」 ----------
    {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'baseball-lineup-rec-pwa-'));
      const context = await chromium.launchPersistentContext(profile, {channel: 'chrome', headless: true, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
      try {
        await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(`pwa: ${error.message}`));
        const ready = () => page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'), null, {timeout: 20000});
        await page.goto(`${url}/baseball-stats/?pwa&ui=v2`);
        await ready();
        await page.waitForFunction(() => navigator.serviceWorker.controller || window.__pwaRegistration?.active, null, {timeout: 20000});
        await page.reload();
        await ready();
        const cached = await page.evaluate(async () => { const out = []; for (const key of await caches.keys()) for (const r of await (await caches.open(key)).keys()) out.push(r.url); return out; });
        assert.ok(cached.some(u => /lineup-recommender\.js\?v=/.test(u)), 'lineup-recommender.js is pre-cached');
        await context.setOffline(true);
        await page.reload();
        await page.waitForFunction(() => window.teamRecords && document.getElementById('uiOfflineBar'), null, {timeout: 20000});
        await toLineup(page);
        assert.equal(await page.evaluate(() => typeof window.analyzeLineupOrder), 'undefined');
        await calculate(page);
        const rows = await recTable(page);
        assert.ok(rows.length >= 10, `offline 計算 shows the recommendation (${rows.length} rows)`);
        assert.deepEqual(rows, v2Table, 'offline result equals the online one');
        passed.push(`AC-7 PWA 已快取、離線：按「計算」算出 ${rows.length} 列，和連線時相同`);
      } finally {
        await context.close();
        fs.rmSync(profile, {recursive: true, force: true});
      }
    }

    assert.deepEqual(errors, [], 'no page errors');
    assert.equal(externalGitHub, 0, 'no request reached GitHub');
    assert.deepEqual(hashes(), diskBefore, 'data/*.json unchanged');
    for (const p of passed) console.log('✓ ' + p);
    console.log(`ui-v2-lineup-rec ok (${passed.length} checks)`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
