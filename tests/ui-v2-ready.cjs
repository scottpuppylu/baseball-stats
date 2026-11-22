// WO-05 週六實戰就緒（PO-42）：新版補上的三個比賽中功能，資料要和舊版同一個函式做出來的完全一樣。
//   1. 改目前打者（⋯ → 改目前打者，舊版 changeCurrentBatterIndex）
//   2. 直接改對手分數，我方進攻時也行（出局與壘包面板，舊版 adjustOpponentScore）
//   3. 換人時新增支援選手（換人 → 選棒次 → ＋ 新增支援選手並換上，舊版 askNewGuest 同一個對話框）
// 同一串操作舊版做一次、新版做一次，比對整場比賽資料（去掉 id／時間）。新版的對話框用真的點擊與輸入，確認蓋在記分畫面上面。
// 用法：node tests/ui-v2-ready.cjs（自己起隔離預覽，port 54513）；GitHub 用預覽的假 API，不寫 data/*.json。
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
  const el = (document.querySelector(`.v2-live ${selector}`) || document.querySelector(`.v2-setup-host ${selector}`));
  if (!el) throw new Error(`v2: missing ${selector}`);
  el.click();
}, selector);
const VOLATILE = /^(id|gameId|playId|.*At|ts|time|timestamp|savedAt|updated|created)$/i;
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => !VOLATILE.test(k)).map(k => [k, normalize(value[k])]));
  return value;
}
const GUEST = '週六客串甲';

(async () => {
  const diskBefore = hashes();
  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { preview = await startPreview(54513); url = 'http://127.0.0.1:54513'; }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  let externalGitHub = 0;
  const open = async (query) => {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(`${query || 'legacy'}: ${error.message}`));
    await page.goto(url + '/' + query);
    await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    if (query) await page.waitForFunction(() => window.uiV2 && window.uiV2.live);
    return {context, page};
  };
  const fillGuest = async page => {
    const dialog = page.locator('[data-dialog-field="0"]');
    await dialog.waitFor({state: 'visible'});
    await dialog.fill(GUEST);
    await page.locator('[data-dialog-field="1"]').fill('77');
    await page.getByRole('button', {name: '加入支援名冊', exact: true}).click(); // 真的點：被記分畫面蓋住就會點不到而逾時
  };
  const result = {};
  try {
    // ---------- 舊版 ----------
    {
      const {context, page} = await open('');
      await page.evaluate(() => {
        document.getElementById('setup_game_opponent').value = '就緒測試';
        switchMainTab('tabScorebook'); switchScorebookSubTab('live'); startNewGameFromSetup();
        recordQuickStrikeout('K');
        changeCurrentBatterIndex(4);
        adjustOpponentScore(1); adjustOpponentScore(1); adjustOpponentScore(-1);
        openSubstituteModal(2);
        document.getElementById('substituteNewPlayerSelect').value = '__NEW_GUEST__';
        window.__subDone = confirmSubstitution();
      });
      await fillGuest(page);
      await page.evaluate(() => window.__subDone);
      result.legacy = await page.evaluate(() => JSON.parse(JSON.stringify(activeGame)));
      await context.close();
    }
    // ---------- 新版 ----------
    {
      const {context, page} = await open('?ui=v2');
      await page.evaluate(() => switchMainTab('tabScorebook'));
      await page.waitForFunction(() => document.body.classList.contains('v2-setup-on'));
      await page.evaluate(() => {
        if (typeof renderSetupLineupGrid === 'function') renderSetupLineupGrid();
        const s = window.uiV2.live.state.setup;
        s.dh = !!isDhEnabled; const n = s.dh ? 11 : 10;
        s.lineup = setupLineupList.slice(0, n); s.pos = setupLineupPositions.slice(0, n); s.touched = true;
        window.uiV2.live.render();
        const el = document.querySelector('.v2l-setup [data-su="opponent"]'); el.value = '就緒測試'; el.dispatchEvent(new Event('input', {bubbles: true}));
      });
      await tap(page, '[data-act="su-start"]');
      await page.waitForFunction(() => document.body.classList.contains('v2-live-on'));
      await tap(page, '[data-act="off"][data-code="K"]');
      // 1. 改目前打者
      await tap(page, '[data-act="menu"]');
      assert.match(await page.locator('.v2-live .v2l-sheet [data-act="batter"]').innerText(), /目前第 2 棒/);
      await tap(page, '.v2l-sheet [data-act="batter"]');
      assert.equal(await page.locator('.v2-live .v2l-sheet [data-act="pick-batter"][aria-current="true"]').getAttribute('data-i'), '1');
      await tap(page, '.v2l-sheet [data-act="pick-batter"][data-i="4"]');
      assert.equal(await page.evaluate(() => activeGame.currentBatterIdx), 4);
      // 2. 對手分數（我方進攻中）
      await tap(page, '[data-act="sit"]');
      for (const d of ['1', '1', '-1']) await tap(page, `.v2l-sheet [data-act="opp"][data-d="${d}"]`);
      assert.equal(await page.locator('.v2-live .v2l-sheet [data-v2-opp]').innerText(), '1');
      assert.equal(await page.locator('.v2-live .v2l-board [data-v2-opp]').innerText(), '1', '頁首比分跟著變');
      await tap(page, '.v2l-sheet [data-act="close"]');
      // 3. 換人時新增支援選手
      await tap(page, '[data-act="menu"]');
      await tap(page, '.v2l-sheet [data-act="sub"]');
      await tap(page, '.v2l-sheet [data-act="sub-slot"][data-i="2"]');
      await tap(page, '.v2l-sheet [data-act="sub-guest"]');
      await fillGuest(page);
      await page.waitForFunction(name => activeGame.lineup[2] === name, GUEST);
      result.v2 = await page.evaluate(() => JSON.parse(JSON.stringify(activeGame)));
      // 對手分數到 0 不能再減
      await tap(page, '[data-act="sit"]');
      await tap(page, '.v2l-sheet [data-act="opp"][data-d="-1"]');
      await tap(page, '.v2l-sheet [data-act="opp"][data-d="-1"]');
      assert.equal(await page.evaluate(() => activeGame.finalScore.opp), 0);
      await context.close();
    }
    assert.equal(result.legacy.lineup[2], GUEST);
    assert.equal(result.legacy.currentBatterIdx, 4);
    assert.equal(result.legacy.finalScore.opp, 1);
    assert.deepEqual(normalize(result.v2), normalize(result.legacy), '新版三個功能做出來的比賽資料要和舊版一樣');
    assert.deepEqual(errors, []);
    assert.equal(externalGitHub, 0);
    assert.deepEqual(hashes(), diskBefore, 'data/*.json 不能被改');
    console.log('ui-v2-ready: 改目前打者、對手分數、換人新增支援選手 — 新版＝舊版');
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
