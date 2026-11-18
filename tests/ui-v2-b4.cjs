// WO-05 B4：新版開賽設定、同步膠囊、上傳／結束／清除（G-B3 AC-3～AC-7）。只在隔離預覽跑，GitHub 用預覽的假 API，不寫 data/*.json。
//
// 用法：node tests/ui-v2-b4.cjs                 （自己起隔離預覽，port 54511）
//       UI_PREVIEW_URL=http://127.0.0.1:54321 node tests/ui-v2-b4.cjs
//
// - AC-3 寫入次數與時機：同一串操作（開賽、一局、上傳本局、離開再回來、結束並同步）在舊版與新版各做一次，
//   每一步之後假 API 收到的寫入（檔名清單）要完全一樣。
// - AC-4 結束並同步鎖記分、上傳中有變動維持進行中；清除此場、刪除比賽立即生效立即同步，沒有復原。
// - AC-5 開賽設定：預設帶入上一場打線、沒有上一場就全空手排、不出現最佳推薦；4 個尺寸一屏不捲。
// - AC-6 離開再回來比賽還在；CP-19 覆盤不能編輯記分中的比賽；CP-20 本機存不進去時不打斷、提示上傳。
// - AC-7 同步膠囊 5 種狀態都有字；記分中不跳更新提示條，只在「⋯」標記。
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
const tap = (page, selector) => page.evaluate(selector => {
  window.uiV2.live.state.busyUntil = 0;
  const el = document.querySelector(`.v2-live ${selector}`);
  if (!el) throw new Error(`v2: missing ${selector}`);
  el.click();
}, selector);
const has = (page, selector) => page.evaluate(selector => !!document.querySelector(`.v2-live ${selector}`), selector);
// 寫入都送完：舊版的寫入佇列空了，而且 400 ms 內沒有新的寫入。
async function settle(page) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() => (typeof gamesWritesInFlight !== 'undefined' && gamesWritesInFlight > 0 ? -2 : window.__previewWrites.length));
    if (n >= 0 && n === last) return page.evaluate(() => window.__previewWrites.slice());
    last = n;
    await page.waitForTimeout(400);
  }
  throw new Error('writes did not settle');
}
const games = page => page.evaluate(() => ({live: !!activeGame, status: activeGame && activeGame.status, id: activeGame && activeGame.id,
  pas: activeGame ? activeGame.innings.reduce((n, i) => n + i.plateAppearances.length, 0) : 0}));

(async () => {
  const diskBefore = hashes();
  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { preview = await startPreview(54511); url = 'http://127.0.0.1:54511'; }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  let externalGitHub = 0;
  const passed = [];
  const open = async (query, width = 390, height = 844) => {
    const context = await browser.newContext({viewport: {width, height}, isMobile: width < 768, hasTouch: width < 1024});
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(`${query || 'legacy'} ${width}: ${error.message}`));
    const gate = {delay: 0};
    await page.route('**/__mock-api/data/games.json*', async route => {
      if (route.request().method() === 'PUT' && gate.delay) await new Promise(r => setTimeout(r, gate.delay));
      await route.continue();
    });
    await page.goto(url + '/' + query);
    await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    if (query) await page.waitForFunction(() => window.uiV2 && window.uiV2.live);
    await page.evaluate(() => { window.__previewWrites.length = 0; });
    return {context, page, gate};
  };
  // 新版開賽：場記頁的開賽設定，打線用舊版開賽表單同一份（和舊版 driver 同一批人），按「開始比賽」。
  const startV2 = async (page, opponent) => {
    await page.evaluate(() => switchMainTab('tabScorebook'));
    await page.waitForFunction(() => document.body.classList.contains('v2-setup-on'));
    await page.evaluate(opponent => {
      if (typeof renderSetupLineupGrid === 'function') renderSetupLineupGrid();
      const s = window.uiV2.live.state.setup;
      s.dh = !!isDhEnabled; const n = s.dh ? 11 : 10;
      s.lineup = setupLineupList.slice(0, n); s.pos = setupLineupPositions.slice(0, n); s.touched = true;
      window.uiV2.live.render();
      const el = document.querySelector('.v2l-setup [data-su="opponent"]'); el.value = opponent; el.dispatchEvent(new Event('input', {bubbles: true}));
    }, opponent);
    await tap(page, '[data-act="su-start"]');
    await page.waitForFunction(() => document.body.classList.contains('v2-live-on'));
  };
  const startLegacy = (page, opponent) => page.evaluate(opponent => {
    document.getElementById('setup_game_opponent').value = opponent;
    switchMainTab('tabScorebook'); switchScorebookSubTab('live'); startNewGameFromSetup();
  }, opponent);
  const key = async (page, code) => { await tap(page, `[data-act="off"][data-code="${code}"]`); };
  try {
    // ---------- AC-3：寫入次數與時機，舊版＝新版 ----------
    {
      const flows = {
        legacy: {
          start: p => startLegacy(p, 'B4 寫入'),
          inning: p => p.evaluate(() => { recordQuickStrikeout('K'); recordQuickStrikeout('K'); recordQuickStrikeout('K'); switchInningNext(); }),
          upload: p => p.evaluate(() => syncCurrentInningToCloud()),
          leaveReturn: p => p.evaluate(() => { switchMainTab('tabHome'); switchMainTab('tabScorebook'); }),
          finish: p => p.evaluate(() => finishActiveGameAndSyncLogs())
        },
        v2: {
          start: p => startV2(p, 'B4 寫入'),
          inning: async p => { for (let i = 0; i < 3; i++) { await key(p, 'K'); } await tap(p, '[data-act="inning"]'); },
          upload: async p => { await tap(p, '[data-act="menu"]'); await tap(p, '.v2l-sheet [data-act="upload"]'); },
          leaveReturn: async p => {
            await tap(p, '.v2l-head [data-act="leave"]');
            await p.waitForFunction(() => !document.body.classList.contains('v2-live-on'));
            await p.evaluate(() => switchMainTab('tabScorebook'));
            await p.waitForFunction(() => document.body.classList.contains('v2-live-on'));
          },
          finish: async p => { await tap(p, '[data-act="menu"]'); await tap(p, '.v2l-sheet [data-act="end"]'); await tap(p, '.v2l-sheet [data-act="end-yes"]'); }
        }
      };
      const writes = {};
      for (const mode of ['legacy', 'v2']) {
        const {context, page} = await open(mode === 'v2' ? '?ui=v2' : '');
        writes[mode] = {};
        let before = 0;
        for (const step of ['start', 'inning', 'upload', 'leaveReturn', 'finish']) {
          await flows[mode][step](page);
          const all = await settle(page);
          writes[mode][step] = all.slice(before);
          before = all.length;
          if (step === 'leaveReturn') assert.deepEqual((await games(page)).live, true, `${mode}: the game is still live after leave and return`);
        }
        assert.equal((await games(page)).live, false, `${mode}: 結束並同步 finished the game`);
        await context.close();
      }
      assert.deepEqual(writes.v2, writes.legacy, 'AC-3: same writes after every step, legacy vs v2');
      assert.ok(writes.v2.upload.length >= 1 && writes.v2.finish.length >= 2, `AC-3: 上傳本局 and 結束並同步 write (${JSON.stringify(writes.v2)})`);
      passed.push(`AC-3 寫入次數與時機 新舊相同：${Object.entries(writes.v2).map(([k, v]) => `${k} ${v.length}`).join('、')}（${JSON.stringify(writes.v2)}）`);
    }

    // ---------- AC-4：結束鎖記分、上傳中有變動維持進行中、清除與刪除立即生效 ----------
    {
      const {context, page, gate} = await open('?ui=v2');
      await startV2(page, 'B4 鎖定');
      for (let i = 0; i < 3; i++) await key(page, 'K');
      assert.ok(await has(page, '.v2l-three [data-act="end"]'), 'three-out card has 結束比賽');
      gate.delay = 1500;
      await tap(page, '.v2l-three [data-act="end"]');
      await tap(page, '.v2l-sheet [data-act="end-yes"]');
      await page.waitForFunction(() => document.querySelector('.v2l-lock:not([hidden])'));
      const locked = await page.evaluate(() => ({legacy: document.getElementById('scoreSubPanelLive').classList.contains('ui-finalizing'), inert: [...document.querySelectorAll('.v2-live > [inert]')].length,
        text: document.querySelector('.v2l-lock').textContent}));
      assert.equal(locked.legacy, true, 'finish locks the legacy scorer (setScorerLocked)');
      assert.ok(locked.inert >= 4 && /日誌同步中/.test(locked.text), `v2 scorer is inert and shows 日誌同步中 (${JSON.stringify(locked)})`);
      // 上傳中有變動（例如另一個分頁改了）：舊版的保護網讓比賽維持進行中。
      await page.evaluate(() => { activeGame.pitcherName = activeGame.pitcherName + ' '; });
      await page.waitForFunction(() => !document.querySelector('.v2l-lock:not([hidden])'), null, {timeout: 15000});
      gate.delay = 0;
      const after = await games(page);
      assert.equal(after.status, 'in_progress', 'a change during upload keeps the game in progress');
      assert.ok(await page.evaluate(() => document.body.classList.contains('v2-live-on') && /比賽保持進行中/.test(document.querySelector('.v2l-snack').textContent)), 'v2 says the game stays in progress');
      await settle(page);
      // 清除此場：確認文字、立即生效、立即同步（比賽已在雲端），沒有復原。
      await page.evaluate(() => { window.__previewWrites.length = 0; });
      await tap(page, '[data-act="menu"]'); await tap(page, '.v2l-sheet [data-act="clear"]');
      assert.equal(await page.evaluate(() => document.querySelector('.v2l-sheet [data-v2-irrev]').textContent), '確認後立即生效，不能復原');
      await tap(page, '.v2l-sheet [data-act="clear-yes"]');
      const cleared = await page.evaluate(() => ({live: !!activeGame, undo: !!document.querySelector('.v2-live [data-act="snack-undo"]'), setup: document.body.classList.contains('v2-setup-on')}));
      assert.deepEqual(cleared, {live: false, undo: false, setup: true}, 'clear is immediate, no undo, back to setup');
      assert.ok((await settle(page)).includes('data/games.json'), 'clear syncs right away');
      // 刪除比賽（覆盤，舊版函式）：立即生效、立即同步。
      await page.evaluate(() => { window.__previewWrites.length = 0; });
      const del = await page.evaluate(async () => {
        const g = allGames.find(x => x.status === 'finished');
        selectedReviewGameId = g.id;
        await deleteReviewGame();
        return {gone: !allGames.some(x => x.id === g.id)};
      });
      assert.equal(del.gone, true, 'delete removes the game at once');
      assert.ok((await settle(page)).includes('data/games.json'), 'delete syncs right away');
      await context.close();
      passed.push('AC-4 結束並同步：舊版記分區 ui-finalizing＋新版 inert＋「日誌同步中」；上傳中有變動→進行中；清除此場確認文字、立即生效、立即同步、沒有復原；刪除比賽立即生效立即同步');
    }

    // ---------- AC-5：開賽設定 ----------
    {
      const fits = [];
      for (const [name, w, h] of [['phone-390', 390, 844], ['tablet-portrait', 820, 1180], ['tablet-landscape', 1180, 820], ['desktop-1440', 1440, 900]]) {
        const {context, page} = await open('?ui=v2', w, h);
        await page.evaluate(() => switchMainTab('tabScorebook'));
        await page.waitForFunction(() => document.body.classList.contains('v2-setup-on'));
        const s = await page.evaluate(() => {
          const prev = allGames.filter(x => (x.startingLineup || x.lineup || []).length >= 10)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)))[0];
          const expected = (prev.startingLineup || prev.lineup).slice(0, prev.hasDh && (prev.startingLineup || prev.lineup).length >= 11 ? 11 : 10);
          const shown = [...document.querySelectorAll('.v2l-setup .v2u-name')].map(b => b.getAttribute('aria-label').replace(/^第 \d+ 棒：/, ''));
          const setup = document.querySelector('.v2l-setup');
          const start = setup.querySelector('.v2u-start').getBoundingClientRect();
          return {expected, shown, from: setup.querySelector('[data-v2-from]').textContent, text: setup.textContent,
            fits: start.bottom <= innerHeight && setup.scrollHeight <= setup.clientHeight + 1 && document.querySelector('.v2-live').scrollHeight <= innerHeight,
            legacy: !!document.getElementById('panelScorebook').offsetParent && !!document.getElementById('setupGameContainer')?.offsetParent};
        });
        assert.deepEqual(s.shown, s.expected, `${name}: setup defaults to the previous game's starting lineup`);
        assert.match(s.from, /^帶入上一場 /);
        assert.doesNotMatch(s.text, /最佳推薦|推薦打線/, 'no recommended lineup in the setup');
        assert.equal(s.fits, true, `${name}: setup fits one screen without scrolling`);
        fits.push(name);
        if (name === 'phone-390') {
          const none = await page.evaluate(() => {
            const saved = allGames; allGames = [];
            window.uiV2.live.state.setup = null; window.uiV2.live.render();
            const r = {from: document.querySelector('[data-v2-from]').textContent, filled: document.querySelectorAll('.v2l-setup .v2u-name:not(.empty)').length,
              pos: document.querySelectorAll('.v2l-setup .v2u-pos:not(.empty)').length};
            allGames = saved; window.uiV2.live.state.setup = null; window.uiV2.live.render();
            return r;
          });
          assert.deepEqual(none, {from: '沒有上一場，請逐棒選', filled: 0, pos: 0}, 'no previous game: every slot empty, picked by hand');
          // 手排：第 1 棒選人 → 守位，沿用舊版的對調規則。
          await tap(page, '[data-act="su-player"][data-i="0"]');
          const second = await page.evaluate(() => document.querySelectorAll('.v2l-setup .v2u-name')[1].getAttribute('aria-label').replace(/^第 \d+ 棒：/, ''));
          await page.evaluate(name => { const b = [...document.querySelectorAll('.v2l-sheet [data-act="su-pick"]')].find(x => x.dataset.name === name); window.uiV2.live.state.busyUntil = 0; b.click(); }, second);
          const swapped = await page.evaluate(() => [...document.querySelectorAll('.v2l-setup .v2u-name')].slice(0, 2).map(b => b.getAttribute('aria-label').replace(/^第 \d+ 棒：/, '')));
          assert.equal(swapped[0], second, 'picking a player already in the lineup swaps the two slots');
        }
        await context.close();
      }
      passed.push(`AC-5 開賽設定：預設帶入上一場先發打線；沒有上一場全空手排；沒有最佳推薦；一屏不捲 ${fits.join('、')}`);
    }

    // ---------- AC-6：離開再回來、CP-19、CP-20 ----------
    {
      const {context, page} = await open('?ui=v2');
      await startV2(page, 'B4 保護');
      await key(page, 'K');
      await tap(page, '[data-act="menu"]'); await tap(page, '.v2l-sheet [data-act="upload"]');
      await settle(page);
      const before = await games(page);
      await tap(page, '.v2l-head [data-act="leave"]');
      await page.waitForFunction(() => document.body.dataset.page !== 'Scorebook');
      assert.equal((await games(page)).live, true, 'leaving keeps the game');
      await page.reload();
      await page.waitForFunction(() => window.uiV2 && window.teamRecords);
      await page.evaluate(() => switchMainTab('tabScorebook'));
      await page.waitForFunction(() => document.body.classList.contains('v2-live-on'));
      assert.deepEqual(await games(page), before, 'coming back (even after a reload) shows the same live game');
      // CP-19：覆盤編輯、儲存都擋下記分中的那一場，其他場不擋。
      const cp19 = await page.evaluate(() => {
        const id = activeGame.id;
        const stored = JSON.stringify(allGames.find(g => g.id === id));
        selectedReviewGameId = id;
        const toasts = () => document.body.innerText.includes('這場比賽還在記錄中');
        toggleEditCurrentReviewGame();
        const blockedEdit = toasts();
        saveEditedReviewGame(id);
        return {blockedEdit, unchanged: JSON.stringify(allGames.find(g => g.id === id)) === stored};
      });
      assert.deepEqual(cp19, {blockedEdit: true, unchanged: true}, 'CP-19: review cannot edit or save the game being scored');
      // CP-20：本機存不進去（QuotaExceeded）：記錄照樣進記憶體、不跳 sheet，頂部出現「請先上傳本局」提示條。
      await page.evaluate(() => {
        window.__realSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) { if (k === 'rebas_active_game') throw new DOMException('full', 'QuotaExceededError'); return window.__realSetItem.call(this, k, v); };
      });
      const pasBefore = (await games(page)).pas;
      await key(page, 'K');
      const cp20 = await page.evaluate(() => ({bar: !!document.querySelector('.v2l-warnbar:not([hidden])'), sheet: !!document.querySelector('.v2l-layer:not([hidden])'),
        text: document.querySelector('.v2l-warnbar').textContent}));
      assert.equal(cp20.bar, true, 'CP-20: storage-full bar shows');
      assert.equal(cp20.sheet, false, 'CP-20: nothing blocks scoring');
      assert.equal((await games(page)).pas, pasBefore + 1, 'CP-20: the record is still taken');
      await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; window.__previewWrites.length = 0; });
      await tap(page, '.v2l-warnbar [data-act="upload"]');
      assert.ok((await settle(page)).includes('data/games.json'), 'CP-20: the bar uploads this game');
      assert.equal(await page.evaluate(() => !!document.querySelector('.v2l-warnbar:not([hidden])')), false, 'CP-20: bar clears after upload');
      await context.close();
      passed.push('AC-6 離開再回來（含重新整理）比賽還在；CP-19 覆盤編輯／儲存擋下記分中那場；CP-20 本機存不進去不打斷、提示條上傳後消失');
    }

    // ---------- AC-7：同步膠囊 5 種狀態、記分中不跳更新 ----------
    {
      const {context, page, gate} = await open('?ui=v2');
      const cap = () => page.evaluate(() => { const c = document.querySelector('.v2-live [data-v2-cap]'); return c && [c.dataset.v2Cap, c.textContent.trim()]; });
      await startV2(page, 'B4 膠囊');
      await key(page, 'K');
      const seen = {};
      seen.pend = await cap();
      assert.match(seen.pend[1], /^待上傳/);
      gate.delay = 1200;
      await tap(page, '[data-act="sync"]'); await tap(page, '.v2l-sheet [data-act="upload"]');
      seen.busy = await cap();
      assert.deepEqual(seen.busy, ['busy', '上傳中']);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.v2l-key:disabled').length), 0, 'uploading disables only the upload key, never the result keys');
      await page.waitForFunction(() => document.querySelector('[data-v2-cap]').dataset.v2Cap === 'ok');
      gate.delay = 0;
      seen.ok = await cap();
      assert.deepEqual(seen.ok, ['ok', '已同步']);
      await page.evaluate(() => { window.__previewFailWrites = true; });
      await key(page, 'K');
      await tap(page, '[data-act="sync"]'); await tap(page, '.v2l-sheet [data-act="upload"]');
      await page.waitForFunction(() => document.querySelector('.v2l-sheet [data-act="retry"]'));
      assert.match(await page.evaluate(() => document.querySelector('.v2l-sheet').textContent), /紀錄在這台裝置，沒有遺失/);
      seen.fail = await cap();
      assert.deepEqual(seen.fail, ['fail', '重試']);
      await page.evaluate(() => { window.__previewFailWrites = false; });
      await tap(page, '.v2l-sheet [data-act="retry"]');
      await page.waitForFunction(() => document.querySelector('[data-v2-cap]').dataset.v2Cap === 'ok');
      await context.setOffline(true);
      await page.waitForTimeout(150);
      seen.off = await cap();
      assert.deepEqual(seen.off, ['off', '離線']);
      await tap(page, '[data-act="menu"]');
      assert.match(await page.evaluate(() => document.querySelector('.v2l-sheet [data-act="upload"]').textContent), /連線後再按上傳本局/);
      await tap(page, '.v2l-sheet [data-act="close"]');
      await context.setOffline(false);
      // 有新版：pwa.js 的更新條在記分中藏起來，「⋯」加標記；選單裡說明比賽結束後再更新。
      await page.evaluate(() => { const bar = document.createElement('div'); bar.id = 'uiUpdateBar'; bar.className = 'ui-app-bar'; bar.innerHTML = '<button type="button" data-act="update">更新</button>'; document.body.append(bar); });
      await page.waitForFunction(() => document.querySelector('.v2l-head [data-v2-update]'));
      const upd = await page.evaluate(() => ({bar: getComputedStyle(document.getElementById('uiUpdateBar')).display !== 'none', label: document.querySelector('.v2l-more').getAttribute('aria-label')}));
      assert.deepEqual(upd, {bar: false, label: '更多操作（有新版）'}, 'no update bar while scoring; ⋯ is marked');
      await tap(page, '[data-act="menu"]');
      assert.ok(await has(page, '.v2l-sheet [data-v2-update-row]'), 'menu explains the update waits');
      await tap(page, '.v2l-sheet [data-act="close"]');
      // 離開場記（收起新版）後提示條回來。
      await tap(page, '.v2l-head [data-act="leave"]');
      await page.waitForFunction(() => !document.body.classList.contains('v2-live-on'));
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('uiUpdateBar')).display !== 'none'), true, 'the update bar comes back once scoring is left');
      await context.close();
      passed.push(`AC-7 膠囊 5 種狀態：${Object.values(seen).map(x => x.join(':')).join('、')}；上傳中只停用上傳鍵；記分中不跳更新條，⋯ 有標記，離開場記後更新條回來`);
    }
    assert.deepEqual(errors, [], 'no page errors');
    assert.equal(externalGitHub, 0, 'never reaches the real GitHub');
    assert.deepEqual(hashes(), diskBefore, 'data/*.json unchanged');
    for (const line of passed) console.log('PASS ' + line);
    console.log(`ui-v2-b4: ${passed.length} checks passed`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
