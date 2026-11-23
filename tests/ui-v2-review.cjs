// WO-05 B5＋B6：新版覆盤（G-B4 AC-5、AC-6、AC-8）。只在隔離預覽跑，GitHub 用預覽的假 API，不寫 data/*.json。
//
// 用法：node tests/ui-v2-review.cjs                 （自己起隔離預覽，port 54512）
//       UI_PREVIEW_URL=http://127.0.0.1:54321 node tests/ui-v2-review.cjs
//       UI_V2_SHOTS=D:\baseball-analytics-out\WO-05\shots node tests/ui-v2-review.cjs   （另外存 4 尺寸截圖）
//
// - AC-5 摘要快取在比賽內容改變時作廢；逐局照局數、先上後下排（先攻、後攻各一場）；比分走勢同分時兩條線、兩個線尾標籤分得開。
// - AC-6 新紀錄不寫 battingSide、舊紀錄的 battingSide 不動（PO-31）；6 秒內按「復原」會再寫一次，內容等於編輯前；
//   覆盤新增／刪除打席（G-30）與守備事件（G-32）和舊版做同樣操作的結果相同；A9 三場舊資料只變改動的欄位。
// - AC-8 4 個尺寸：摘要、逐局、打者、投守、編輯 sheet 不溢出、按鈕 ≥44 px；改一個打席結果 ≤5 下、儲存鈕不用捲就看得到。
// - CP-19 記分中的比賽不能編輯；畫面文字沒有 PO-29 禁字。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const hashes = () => Object.fromEntries(fs.readdirSync(path.join(root, 'data')).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', f))).digest('hex')]));

// A9：8d12570 的 data/games.json 裡 2026-03-15（11 個欄位）與 2026-10-01（16 個欄位、沒有打席）兩場，原樣內嵌。
// 舊資料裡本來就有的欄位與說明文字以跳脫字元保存（內容不變）。
const A9 = [{"id":"game_20261001_0411","date":"2026-10-01","opponent":"\u53cb\u968a\u9078\u624b","tag":"\u7cfb\u58d8\u4f8b\u884c\u8cfd","hasDh":true,"dhSlot":9,"ourRole":"\u5148\u653b","lineup":["\u5289\u61ac\u7ff0","\u9673\u6cd3\u9298","\u7c21\u627f\u5747","\u694a\u667a\u7fd4","\u6797\u694a\u5927\u798e","\u6d2a\u9298\u99ff","\u5b6b\u715c\u54f2","\u5433\u4f91\u5bb8","\u5ed6\u4ef2\u6bc5","\u76e7\u5ba3\u5609","\u8b1d\u627f\u7950"],"currentInning":3,"currentHalf":"bottom","currentOuts":0,"currentBases":{"first":null,"second":null,"third":null},"currentBatterIdx":0,"status":"in_progress","finalScore":{"us":0,"opp":0},"innings":[{"inningNum":1,"topBottom":"top","runs":0,"hits":0,"plateAppearances":[]},{"inningNum":1,"topBottom":"bottom","runs":0,"hits":0,"plateAppearances":[]},{"inningNum":2,"topBottom":"top","runs":0,"hits":0,"plateAppearances":[]},{"inningNum":2,"topBottom":"bottom","runs":0,"hits":0,"plateAppearances":[]},{"inningNum":3,"topBottom":"top","runs":0,"hits":0,"plateAppearances":[]},{"inningNum":3,"topBottom":"bottom","runs":0,"hits":0,"plateAppearances":[]}]},{"id":"game_20260315_mech","date":"2026-03-15","opponent":"\u6a5f\u68b0\u7cfb\u58d8","tag":"\u6625\u5b63\u53cb\u8abc\u9080\u8acb\u8cfd","hasDh":true,"ourRole":"\u5148\u653b","lineup":["\u5ed6\u4ef2\u6bc5","\u76e7\u5ba3\u5609","\u5289\u61ac\u7ff0","\u7c21\u627f\u5747","\u9673\u67cf\u7ff0","\u9673\u5a01\u9a0f","\u9673\u6cd3\u9298","\u6d2a\u9298\u99ff","\u5b6b\u715c\u54f2","\u7530\u8015\u5b87","\u8b1d\u627f\u7950"],"dhSlot":9,"status":"finished","finalScore":{"us":10,"opp":6},"innings":[{"inningNum":1,"topBottom":"top","runs":3,"hits":3,"plateAppearances":[{"batterOrder":1,"batterName":"\u5ed6\u4ef2\u6bc5","jersey":41,"result":"BB","trajectory":"none","location":"C","x":0.5,"y":0.94,"r\u0062i":0,"runsScored":0,"outsAdded":0,"textSummary":"\u9078\u7403\u7cbe\u6e96\u56db\u58de\u4fdd\u9001\u4e0a\u58d8","outsAtEnd":0},{"batterOrder":2,"batterName":"\u76e7\u5ba3\u5609","jersey":44,"result":"2H","trajectory":"line","location":"LF","x":0.22,"y":0.32,"r\u0062i":1,"runsScored":1,"outsAdded":0,"textSummary":"\u5de6\u5916\u91ce\u6df1\u9060\u5e73\u98db\u4e8c\u58d8\u5b89\u6253 (1\u5206\u6253\u9ede)","outsAtEnd":0},{"batterOrder":3,"batterName":"\u5289\u61ac\u7ff0","jersey":2,"result":"FO","trajectory":"fly","location":"SF","x":0.41,"y":0.24,"r\u0062i":0,"runsScored":0,"outsAdded":1,"textSummary":"\u5de6\u4e2d\u5916\u91ce\u6df1\u9060\u9ad8\u98db\u7403\u906d\u63a5\u6bba (1\u51fa\u5c40)","outsAtEnd":1},{"batterOrder":4,"batterName":"\u7c21\u627f\u5747","jersey":8,"result":"HR","trajectory":"fly","location":"RC","x":0.65,"y":0.12,"r\u0062i":2,"runsScored":2,"outsAdded":0,"textSummary":"\u53f3\u4e2d\u5916\u91ce\u5169\u5206\u7832\uff01\u4e00\u68d2\u6e05\u58d8\uff01","outsAtEnd":1},{"batterOrder":5,"batterName":"\u9673\u67cf\u7ff0","jersey":98,"result":"GO","trajectory":"grounder","location":"SS","x":0.41,"y":0.55,"r\u0062i":0,"runsScored":0,"outsAdded":1,"textSummary":"\u6e38\u64ca\u65b9\u5411\u5f37\u52c1\u6efe\u5730\u7403\u523a\u6bba (2\u51fa\u5c40)","outsAtEnd":2},{"batterOrder":6,"batterName":"\u9673\u5a01\u9a0f","jersey":99,"result":"K","trajectory":"none","location":"C","x":0.5,"y":0.94,"r\u0062i":0,"runsScored":0,"outsAdded":1,"textSummary":"\u63ee\u68d2\u843d\u7a7a\u541e\u4e09\u632f (3\u51fa\u5c40)","outsAtEnd":3}]},{"inningNum":2,"topBottom":"top","runs":2,"hits":2,"plateAppearances":[{"batterOrder":7,"batterName":"\u9673\u6cd3\u9298","jersey":4,"result":"1H","trajectory":"line","location":"2B","x":0.59,"y":0.55,"r\u0062i":0,"runsScored":0,"outsAdded":0,"textSummary":"\u7a7f\u8d8a\u4e8c\u58d8\u9632\u7dda\u5e73\u98db\u5b89\u6253","outsAtEnd":0},{"batterOrder":8,"batterName":"\u6d2a\u9298\u99ff","jersey":30,"result":"1H","trajectory":"grounder","location":"1B","x":0.69,"y":0.71,"r\u0062i":0,"runsScored":0,"outsAdded":0,"textSummary":"\u7a7f\u8d8a\u4e00\u4e8c\u58d8\u9593\u5f37\u52c1\u6efe\u5730\u5b89\u6253","outsAtEnd":0},{"batterOrder":9,"batterName":"\u5b6b\u715c\u54f2","jersey":31,"result":"BB","trajectory":"none","location":"C","x":0.5,"y":0.94,"r\u0062i":0,"runsScored":0,"outsAdded":0,"textSummary":"\u5c08\u8077DH\u4fdd\u9001\u6eff\u58d8","outsAtEnd":0},{"batterOrder":10,"batterName":"\u7530\u8015\u5b87","jersey":72,"result":"GO","trajectory":"grounder","location":"P","x":0.5,"y":0.65,"r\u0062i":1,"runsScored":1,"outsAdded":1,"textSummary":"\u6295\u624b\u524d\u6efe\u5730\u7403\u63a8\u9032\u5e36\u6709 1 \u5206\u6253\u9ede (1\u51fa\u5c40)","outsAtEnd":1},{"batterOrder":11,"batterName":"\u8b1d\u627f\u7950","jersey":47,"result":"SF","trajectory":"fly","location":"RF","x":0.78,"y":0.32,"r\u0062i":1,"runsScored":1,"outsAdded":1,"textSummary":"\u53f3\u5916\u91ce\u9ad8\u98db\u72a7\u7272\u6253\uff0c\u518d\u6dfb 1 \u5206 (2\u51fa\u5c40)","outsAtEnd":2},{"batterOrder":1,"batterName":"\u5ed6\u4ef2\u6bc5","jersey":41,"result":"LO","trajectory":"line","location":"3B","x":0.31,"y":0.71,"r\u0062i":0,"runsScored":0,"outsAdded":1,"textSummary":"\u4e09\u58d8\u5f37\u52c1\u5e73\u98db\u7403\u906d\u76f4\u63a5\u63a5\u6bba (3\u51fa\u5c40)","outsAtEnd":3}]}]}];
// 後攻、同分的測試場：兩隊每半局各 1 分，比分一路 0:0 → 1:1 → 2:2；第 1 局資料故意先存下半再存上半。
const HOME = {id: 'game_review_home', date: '2026-11-02', opponent: '後攻測試隊', tag: '友誼賽', ourRole: '後攻', status: 'finished', hasDh: false,
  lineup: ['劉憬翰', '陳泓銘'], pitcherName: '劉憬翰', finalScore: {us: 2, opp: 2},
  innings: [
    {inningNum: 1, topBottom: 'bottom', runs: 1, hits: 1, plateAppearances: [
      {playId: 'p1', batterName: '劉憬翰', slot: 1, result: '1H', trajectory: 'line', location: 'LF', runsScored: 1, outsAdded: 0, outsAtEnd: 0, battingSide: 'L', desc: '劉憬翰 擊出一壘安打'},
      {playId: 'p2', batterName: '陳泓銘', slot: 2, result: 'K', trajectory: 'none', runsScored: 0, outsAdded: 1, outsAtEnd: 1, desc: '陳泓銘 三振'}]},
    {inningNum: 1, topBottom: 'top', runs: 1, hits: 0, defensiveEvents: [
      {id: 'd1', pitcher: '劉憬翰', type: 'K', runs: 0, outsAdded: 1, outsAtEnd: 1, desc: '三振'},
      {id: 'd2', pitcher: '劉憬翰', type: 'GO', runs: 1, outsAdded: 1, outsAtEnd: 2, desc: '內野滾地刺殺 (+1 出局)'}]},
    {inningNum: 2, topBottom: 'top', runs: 1, hits: 1, defensiveEvents: [{id: 'd3', pitcher: '劉憬翰', type: 'HIT', runs: 1, outsAdded: 0, outsAtEnd: 0, desc: '安打'}]},
    {inningNum: 2, topBottom: 'bottom', runs: 1, hits: 0, plateAppearances: [{playId: 'p3', batterName: '劉憬翰', slot: 1, result: 'GO', trajectory: 'grounder', location: 'SS', runsScored: 1, outsAdded: 1, outsAtEnd: 1, desc: '滾地出局'}]}
  ]};
// PO-29 禁字（用跳脫字元寫，本檔自己不含禁字）。
const BANNED = new RegExp(['R' + 'BI', 'r' + 'bi', '\u6253\u9ede', '\u5e36\u9032', 'field' + 'er', '\u8655\u7406\u7403\u54e1'].join('|'));
const SHOTS = process.env.UI_V2_SHOTS || '';
const SIZES = [[390, 844], [820, 1180], [1180, 820], [1440, 900]];

function startPreview(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'ui-preview-server.cjs')], {cwd: root, env: {...process.env, UI_PREVIEW_PORT: String(port)}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    const timer = setTimeout(() => reject(new Error('preview startup timed out')), 15000);
    child.once('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(child); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited ${code}`)); });
  });
}
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
// 比較用：去掉新增時用時間產生的 id。
const norm = g => JSON.parse(JSON.stringify(g, (k, v) => (k === 'playId' || (k === 'id' && typeof v === 'string' && v.startsWith('def_'))) ? undefined : v));
const stats = page => (id => page.evaluate(id => {
  const a = gameAnalysis.analyse(allGames.find(g => g.id === id));
  return {rows: a.rows.map(r => [r.name, r.pa, r.ab, r.h, r.bb, r.k, r.hr]), pitchers: a.pitchers.map(p => [p.name, p.outs, p.faced, p.hits, p.bb, p.k, p.runs]), halves: a.halves.map(h => [h.num, h.half, h.runs, h.hits])};
}, id));
const gameOf = (page, id) => page.evaluate(id => JSON.parse(JSON.stringify(allGames.find(g => g.id === id))), id);
// 兩個 JSON 之間不同的路徑。
function diffPaths(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return [at || '/'];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap(k => diffPaths(a[k], b[k], `${at}/${k}`));
}

(async () => {
  const diskBefore = hashes();
  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { preview = await startPreview(54512); url = 'http://127.0.0.1:54512'; }
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
    await page.goto(url + '/' + query);
    await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    await page.evaluate(([a9, home]) => {
      // 假 API 會留著前一頁寫進去的內容；每頁都換回原始的測試場。
      for (const g of [...a9, home]) { const i = allGames.findIndex(x => x.id === g.id); const copy = JSON.parse(JSON.stringify(g)); if (i >= 0) allGames[i] = copy; else allGames.push(copy); }
      renderAll();
      window.__previewWrites.length = 0;
    }, [A9, HOME]);
    if (query) {
      await page.waitForFunction(() => window.uiV2 && window.reviewV2);
      await page.evaluate(() => switchMainTab('tabGames'));
      await page.waitForFunction(() => document.querySelector('.v2r[data-v2r]'));
    }
    return {context, page};
  };
  // 新版：選場次、切分段、點按鈕都走畫面上的按鈕（計點擊數）。
  const v2 = page => {
    let taps = 0;
    const tap = async selector => { taps++; await page.locator(selector).first().click(); };
    return {
      get taps() { return taps; }, reset() { taps = 0; }, tap,
      choose: id => page.evaluate(id => { window.reviewV2.ui.id = id; window.reviewV2.redraw(); }, id),
      tabTo: name => page.evaluate(name => document.querySelector(`.v2r [data-r="tab"][data-tab="${name}"]`).click(), name),
      sheet: () => page.waitForSelector('.v2r-sheet [data-r]', {state: 'visible'}),
      still: () => page.waitForFunction(() => (document.querySelector('.v2r-layer')?.getAnimations({subtree: true}) || []).every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)),
      done: async () => { await page.evaluate(() => window.reviewV2Edit && window.reviewV2Edit.idle()); return settle(page); }
    };
  };
  const loadEdit = page => page.evaluate(() => window.reviewV2.need && Promise.all([window.reviewV2.need('reviewV2Detail', 'review-v2/review-detail.js'), window.reviewV2.need('reviewV2Edit', 'review-v2/review-edit.js')]));
  // 舊版：在比賽覆盤頁按「編輯」→ 新增／刪除 → 儲存。
  const legacy = (page, id, op) => page.evaluate(async ([id, op]) => {
    switchMainTab('tabGames');
    selectedReviewGameId = id; renderSelectedGameReview(id);
    toggleEditCurrentReviewGame();
    const [fn, inn, i] = op;
    window[fn](id, inn, i);
    await saveEditedReviewGame(id);
  }, [id, op]);
  try {
    // ---------- AC-5 / AC-6 / CP-19（手機 390） ----------
    {
      const {context, page} = await open('?ui=v2');
      const ui = v2(page);
      await loadEdit(page);

      // AC-5 快取：內容一改，鍵就換、摘要重算。
      const cache = await page.evaluate(() => {
        const R = window.reviewV2, g = allGames.find(x => x.id === 'game_review_home');
        const k1 = R.cache.keyOf(g); const s1 = R.summaryOf(g);
        g.innings[0].plateAppearances[1].result = '2H';
        const k2 = R.cache.keyOf(g); const s2 = R.summaryOf(g);
        g.innings[0].plateAppearances[1].result = 'K';
        return {k1, k2, h1: s1.rows.reduce((n, r) => n + r.h, 0), h2: s2.rows.reduce((n, r) => n + r.h, 0), again: R.cache.keyOf(g) === k1};
      });
      assert.notEqual(cache.k1, cache.k2, 'cache key must change with content');
      assert.equal(cache.h2, cache.h1 + 1, 'summary must be recomputed after a change');
      assert.ok(cache.again);
      passed.push('AC-5 快取作廢');

      // AC-5 逐局排序：後攻場（資料先存下半）與 A9 先攻場都照 1上、1下、2上…
      for (const id of ['game_review_home', 'game_20260315_mech', 'game_20261001_0411']) {
        await ui.choose(id); await ui.tabTo('innings');
        const order = await page.$$eval('.v2r .v2r-half-n', els => els.map(e => e.textContent.trim()));
        const expected = await page.evaluate(id => { const R = window.reviewV2, g = R.findGame(id); return R.inningOrder(g).map(i => R.halfName(g.innings[i].inningNum, g.innings[i].topBottom)); }, id);
        assert.ok(order.length, `innings headers rendered for ${id}`);
        assert.deepEqual(order, expected, `innings order ${id}`);
        const nums = expected.map(s => [parseInt(s, 10), s.endsWith('上') ? 0 : 1]);
        for (let i = 1; i < nums.length; i++) assert.ok(nums[i][0] > nums[i - 1][0] || (nums[i][0] === nums[i - 1][0] && nums[i][1] >= nums[i - 1][1]), `sorted ${id}`);
      }
      passed.push('AC-5 逐局排序（先攻、後攻）');

      // AC-5 走勢同分：0:0 起、一路同分到 2:2，兩條線不重疊在同一條路徑、樣式不同、線尾標籤上下分開不重疊。
      await ui.choose('game_review_home'); await ui.tabTo('summary');
      const chart = await page.evaluate(() => {
        const us = document.querySelector('.v2r-chart [data-line="us"]'), opp = document.querySelector('.v2r-chart [data-line="opp"]');
        const eu = document.querySelector('.v2r-end-us').getBoundingClientRect(), eo = document.querySelector('.v2r-end-opp').getBoundingClientRect();
        const su = getComputedStyle(us), so = getComputedStyle(opp);
        return {same: us.getAttribute('d') === opp.getAttribute('d'), dashU: su.strokeDasharray, dashO: so.strokeDasharray, colorSame: su.stroke === so.stroke, overlap: !(eu.bottom <= eo.top || eo.bottom <= eu.top)};
      });
      assert.equal(chart.same, false, 'tied lines must not be drawn on the same path');
      assert.notEqual(chart.dashU, chart.dashO, 'tied lines need different dash');
      assert.equal(chart.colorSame, false);
      assert.equal(chart.overlap, false, 'end labels must not overlap');
      passed.push('AC-5 走勢同分可分辨');

      // AC-8 手機：改一個打席的結果 ≤5 下，儲存鈕不用捲就看得到；PO-31 舊紀錄 battingSide 不動。
      const before = await gameOf(page, 'game_review_home');
      await ui.tabTo('innings');
      ui.reset();
      await ui.tap('.v2r [data-r="pa"][data-inn="0"][data-i="0"]');
      await ui.sheet();
      await ui.tap('.v2r-sheet [data-r="edit"]');
      await page.waitForSelector('.v2r-sheet [data-r="save"]', {state: 'visible'});
      await ui.still();
      const saveBox = await page.evaluate(() => { const r = document.querySelector('.v2r-sheet [data-r="save"]').getBoundingClientRect(); return {top: r.top, bottom: r.bottom, vh: innerHeight}; });
      assert.ok(saveBox.top >= 0 && saveBox.bottom <= saveBox.vh, `save visible without scrolling ${JSON.stringify(saveBox)}`);
      await ui.tap('.v2r-sheet [data-r="set"][data-k="result"][data-v="2H"]');
      await ui.tap('.v2r-sheet [data-r="save"]');
      const w1 = await ui.done();
      assert.ok(ui.taps <= 5, `edit took ${ui.taps} taps`);
      assert.deepEqual(w1, ['data/games.json', 'data/logs.json'], 'one save writes games then logs like legacy');
      const edited = await gameOf(page, 'game_review_home');
      assert.deepEqual(diffPaths(before, edited), ['/innings/0/plateAppearances/0/result'], 'only the edited field changes');
      assert.equal(edited.innings[0].plateAppearances[0].result, '2H');
      assert.equal(edited.innings[0].plateAppearances[0].battingSide, 'L', 'PO-31: existing battingSide untouched');
      passed.push(`AC-8 改一個打席 ${ui.taps} 下、儲存鈕不用捲`);
      passed.push('PO-31 舊紀錄 battingSide 不動');

      // AC-6 6 秒復原：再寫一次，內容等於編輯前。
      await page.waitForSelector('.v2r-snackbox [data-r="undo"]', {state: 'visible'});
      await page.locator('.v2r-snackbox [data-r="undo"]').click();
      const w2 = await ui.done();
      assert.deepEqual(w2, ['data/games.json', 'data/logs.json', 'data/games.json', 'data/logs.json'], 'undo writes again');
      assert.deepEqual(await gameOf(page, 'game_review_home'), before, 'undo restores the game exactly');
      const stored = await page.evaluate(() => JSON.parse(localCache.get('rebas_all_games')).find(g => g.id === 'game_review_home'));
      assert.deepEqual(stored, before, 'undo restores the local cache too');
      passed.push('AC-6 6 秒復原會再同步、內容等於編輯前');

      // PO-31 新紀錄：新增打席不寫 battingSide。
      await ui.tap('.v2r [data-r="add-pa"][data-inn="0"]');
      await page.waitForSelector('.v2r-sheet [data-r="save"]', {state: 'visible'});
      await ui.tap('.v2r-sheet [data-r="save"]');
      await ui.done();
      const added = (await gameOf(page, 'game_review_home')).innings[0].plateAppearances.slice(-1)[0];
      assert.equal('battingSide' in added, false, 'PO-31: new record has no battingSide');
      passed.push('PO-31 新紀錄不寫 battingSide');

      // PO-29：覆盤各分段與 sheet 的畫面文字沒有禁字。
      for (const tab of ['summary', 'innings', 'batters', 'pitching']) {
        await ui.tabTo(tab);
        const text = await page.evaluate(() => document.querySelector('.v2r').innerText + (document.querySelector('.v2r-layer')?.innerText || ''));
        assert.equal(BANNED.test(text), false, `PO-29 banned word on ${tab}`);
      }
      for (const file of ['review-v2/review-core.js', 'review-v2/review-detail.js', 'review-v2/review-edit.js', 'review-v2/review-cache.js', 'review-v2/review-v2.js']) {
        assert.equal(BANNED.test(fs.readFileSync(path.join(root, file), 'utf8')), false, `PO-29 banned word in ${file}`);
      }
      passed.push('PO-29 畫面與程式沒有禁字');

      // CP-19：記分中的比賽不能編輯（沒有「＋新增」、詳情的編輯鈕停用、直接呼叫也不寫）。
      const live = await page.evaluate(async () => {
        const g = allGames.find(x => x.id === 'game_review_home');
        window.activeGame = g; g.status = 'in_progress';
        window.reviewV2.cache.drop(g); window.reviewV2.redraw();
        document.querySelector('.v2r [data-r="tab"][data-tab="innings"]').click();
        const adds = document.querySelectorAll('.v2r [data-r="add-pa"], .v2r [data-r="add-def"]').length;
        window.__previewWrites.length = 0;
        await window.reviewV2Edit.commit(g.id, game => { game.opponent = 'x'; return true; }, 'x');
        const opp = g.opponent;
        g.status = 'finished'; window.activeGame = null; window.reviewV2.cache.drop(g); window.reviewV2.redraw();
        return {adds, writes: window.__previewWrites.length, opp};
      });
      assert.equal(live.adds, 0);
      assert.equal(live.writes, 0);
      assert.equal(live.opp, '後攻測試隊');
      passed.push('CP-19 記分中不能編輯');

      // A9：三場舊資料（兩場 8d12570 + 現行 fixture 第一場）各改一個欄位，其他欄位一個都不變。
      const fixtureId = await page.evaluate(() => allGames.find(g => !String(g.id).startsWith('game_review') && !['game_20260315_mech', 'game_20261001_0411'].includes(g.id) && (g.innings || []).some(i => (i.plateAppearances || []).length)).id);
      for (const id of ['game_20260315_mech', 'game_20261001_0411', fixtureId]) {
        await ui.choose(id); await ui.tabTo('innings');
        const old = await gameOf(page, id);
        const idx = old.innings.findIndex(i => (i.plateAppearances || []).length);
        if (idx >= 0) {
          const pa = old.innings[idx].plateAppearances[0];
          const target = pa.result === 'BB' ? 'K' : 'BB';
          await ui.tap(`.v2r [data-r="pa"][data-inn="${idx}"][data-i="0"]`); await ui.sheet();
          await ui.tap('.v2r-sheet [data-r="edit"]'); await page.waitForSelector('.v2r-sheet [data-r="save"]', {state: 'visible'});
          await ui.tap(`.v2r-sheet [data-r="set"][data-k="result"][data-v="${target}"]`);
          await ui.tap('.v2r-sheet [data-r="save"]'); await ui.done();
          const now = await gameOf(page, id);
          const changed = diffPaths(old, now);
          const allowed = [`/innings/${idx}/plateAppearances/0/result`, `/innings/${idx}/hits`, `/innings/${idx}/runs`];
          assert.ok(changed.includes(allowed[0]), `${id} result changed`);
          assert.deepEqual(changed.filter(p => !allowed.includes(p)), [], `${id} only touched fields changed: ${changed}`);
          assert.deepEqual(Object.keys(now).sort(), Object.keys(old).sort(), `${id} top-level keys kept`);
        } else {
          // 2026-10-01 沒有打席：只改對手，其他欄位不變。
          await page.evaluate(() => document.querySelector('.v2r [data-r="menu"]').click()); await ui.sheet();
          await page.locator('.v2r-sheet [data-r="info"]').click();
          await page.waitForSelector('.v2r-sheet [data-f="opponent"]', {state: 'visible'});
          await page.fill('.v2r-sheet [data-f="opponent"]', old.opponent + '隊');
          await page.locator('.v2r-sheet [data-r="save"]').click(); await ui.done();
          const now = await gameOf(page, id);
          assert.deepEqual(diffPaths(old, now), ['/opponent'], `${id} only opponent changed`);
        }
      }
      passed.push('AC-6 A9 三場舊資料只變改動欄位');
      await context.close();
    }

    // ---------- G-30／G-32：新增、刪除打席與守備事件，新版＝舊版 ----------
    {
      const ops = [
        ['add-pa', ['addPlayToReviewInning', 0]],
        ['del-pa', ['deletePlayFromReviewInning', 0, 1]],
        ['add-def', ['addDefenseEventToReviewInning', 1]],
        ['del-def', ['deleteDefenseEventFromReviewInning', 1, 0]]
      ];
      for (const [name, op] of ops) {
        const L = await open('');
        await legacy(L.page, 'game_review_home', op);
        const wl = await settle(L.page);
        const gl = norm(await gameOf(L.page, 'game_review_home')), sl = await stats(L.page)('game_review_home');
        await L.context.close();

        const N = await open('?ui=v2');
        const ui = v2(N.page);
        await loadEdit(N.page);
        await ui.choose('game_review_home'); await ui.tabTo('innings');
        if (name === 'add-pa' || name === 'add-def') {
          await ui.tap(`.v2r [data-r="${name}"][data-inn="${op[1]}"]`);
        } else {
          await ui.tap(`.v2r [data-r="${name === 'del-pa' ? 'pa' : 'def'}"][data-inn="${op[1]}"][data-i="${op[2]}"]`); await ui.sheet();
          await ui.tap('.v2r-sheet [data-r="edit"]');
        }
        await N.page.waitForSelector(`.v2r-sheet [data-r="${name.startsWith('add') ? 'save' : 'del'}"]`, {state: 'visible'});
        await ui.tap(`.v2r-sheet [data-r="${name.startsWith('add') ? 'save' : 'del'}"]`);
        const wn = await ui.done();
        const gn = norm(await gameOf(N.page, 'game_review_home')), sn = await stats(N.page)('game_review_home');
        await N.context.close();
        assert.deepEqual(wn, wl, `${name}: writes equal legacy`);
        assert.deepEqual(gn, gl, `${name}: game equals legacy`);
        assert.deepEqual(sn, sl, `${name}: stats equal legacy`);
      }
      passed.push('G-30／G-32 新增刪除打席與守備事件＝舊版');
    }

    // ---------- AC-3：3D 重播、賽後圖、賽後影片走和舊版同一個函式、同樣的參數；下載的賽後圖 PNG 位元組相同 ----------
    {
      const id = 'game_20260315_mech';
      // 換掉真正的輸出端（開 3D、開大圖、做影片、下載），只記下收到什麼；賽後圖照常畫，記 PNG 的 SHA-256。
      const spy = page => page.evaluate(() => {
        window.__calls = [];
        const rec = (name, args) => window.__calls.push([name, JSON.parse(JSON.stringify(args))]);
        spray3d.open = scope => rec('spray3d.open', [scope]);
        teamInsights.openImageModal = gid => rec('openImageModal', [gid]);
        gameVideo.gameVideoFor = async gid => { rec('gameVideoFor', [gid]); return null; };
        gameVideo.download = async (blob, name) => {
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
          rec('download', [name, hash]);
        };
      });
      const calls = async page => { await page.waitForFunction(n => window.__calls.length >= n, 4, {timeout: 60000}); return page.evaluate(() => window.__calls.slice().sort((a, b) => a[0].localeCompare(b[0]))); };

      const L = await open('');
      await L.page.evaluate(id => { switchMainTab('tabGames'); gameAnalysis.choose(id); }, id);
      await L.page.waitForFunction(() => window.spray3d && window.gameVideo && window.teamInsights && document.querySelector('#panelGames [data-ga="replay"]'));
      await spy(L.page);
      for (const act of ['replay', 'image', 'make-video', 'download-image']) await L.page.evaluate(act => document.querySelector(`#panelGames [data-ga="${act}"]`).click(), act);
      const legacyCalls = await calls(L.page);
      await L.context.close();

      const N = await open('?ui=v2');
      const ui = v2(N.page);
      await N.page.evaluate(() => Promise.all([window.reviewV2.need('spray3d', 'spray3d.js'), window.reviewV2.need('gameVideo', 'game-video.js')]));
      await ui.choose(id);
      await spy(N.page);
      for (const act of ['replay', 'image', 'video']) await ui.tap(`.v2r [data-r="${act}"]`);
      await ui.tap('.v2r [data-r="menu"]'); await ui.sheet(); await ui.tap('.v2r-sheet [data-r="download"]');
      const v2Calls = await calls(N.page);
      await N.context.close();
      assert.deepEqual(v2Calls, legacyCalls, 'review outputs go through the same functions with the same arguments');
      passed.push('AC-3 3D／賽後圖／影片和舊版同函式同參數、賽後圖 PNG 相同');
    }

    // ---------- AC-8：4 個尺寸，各分段與編輯 sheet 不溢出、按鈕 ≥44 px ----------
    {
      if (SHOTS) fs.mkdirSync(SHOTS, {recursive: true});
      for (const [w, h] of SIZES) {
        const {context, page} = await open('?ui=v2', w, h);
        const ui = v2(page);
        await loadEdit(page);
        await ui.choose('game_20260315_mech');
        const check = () => page.evaluate(() => {
          const vw = innerWidth, over = [], small = [];
          const roots = [document.querySelector('.v2r'), document.querySelector('.v2r-layer')].filter(Boolean);
          for (const el of roots.flatMap(r => [...r.querySelectorAll('*')])) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
            const scrollX = /(auto|scroll)/.test(getComputedStyle(el).overflowX);
            const inScroller = el.closest('.v2r-table');
            if (!inScroller && (r.right > vw + 0.5 || r.left < -0.5)) over.push(el.className || el.tagName);
            if (!scrollX && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).overflowX !== 'hidden' && !inScroller) over.push('scroll:' + (el.className || el.tagName));
            if (el.matches('button, [data-r], select, input') && !el.disabled) {
              const on = r.bottom > 0 && r.top < innerHeight;
              if (on && (r.height < 44 - 0.5 || r.width < 44 - 0.5)) small.push(`${el.className || el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
          return {page: document.scrollingElement.scrollWidth - vw, over: [...new Set(over)], small: [...new Set(small)]};
        });
        for (const tab of ['summary', 'innings', 'batters', 'pitching']) {
          await ui.tabTo(tab);
          await page.waitForTimeout(80);
          const c = await check();
          assert.equal(c.page, 0, `${w}x${h} ${tab}: page overflow`);
          assert.deepEqual(c.over, [], `${w}x${h} ${tab}: overflow`);
          assert.deepEqual(c.small, [], `${w}x${h} ${tab}: touch targets`);
          if (tab === 'batters') assert.ok(await page.evaluate(() => [...document.querySelectorAll('.v2r-table')].every(t => t.scrollWidth <= t.clientWidth + 1)), `${w}x${h}: batters table fits without sideways scrolling`);
          if (SHOTS) await page.screenshot({path: path.join(SHOTS, `review-${w}x${h}-${tab}.png`), fullPage: true});
        }
        await ui.tabTo('innings');
        ui.reset();
        await ui.tap('.v2r [data-r="pa"][data-inn="0"][data-i="0"]'); await ui.sheet();
        await ui.tap('.v2r-sheet [data-r="edit"]');
        await page.waitForSelector('.v2r-sheet [data-r="save"]', {state: 'visible'});
        await ui.still();
        const c = await check();
        const save = await page.evaluate(() => { const r = document.querySelector('.v2r-sheet [data-r="save"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
        assert.equal(save, true, `${w}x${h}: save visible without scrolling`);
        assert.deepEqual(c.over, [], `${w}x${h} sheet: overflow`);
        assert.deepEqual(c.small, [], `${w}x${h} sheet: touch targets`);
        if (SHOTS) await page.screenshot({path: path.join(SHOTS, `review-${w}x${h}-edit.png`)});
        await context.close();
      }
      passed.push('AC-8 4 尺寸 × 5 畫面：溢出 0、觸控 ≥44 px、儲存鈕不用捲');
    }

    assert.deepEqual(errors, [], 'page errors');
    assert.equal(externalGitHub, 0, 'no real GitHub traffic');
    assert.deepEqual(hashes(), diskBefore, 'data/*.json untouched');
    for (const p of passed) console.log('✓ ' + p);
    console.log(`ui-v2-review: ${passed.length} checks passed`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
