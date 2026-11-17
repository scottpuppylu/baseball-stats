// 新舊一致測試（WO-05 B1 起）：同一串操作分別在舊版場記與新版（旗標 rebas_ui_v2）下做，產出的比賽 JSON
// （排除時間戳與 id）和統計結果要完全相同。只在隔離預覽跑，不寫 data/*.json，也不連 GitHub。
//
// 用法：node tests/ui-v2-parity.cjs                 （自己起隔離預覽，port 54503）
//       UI_PREVIEW_URL=http://127.0.0.1:54321 node tests/ui-v2-parity.cjs
//       UI_PARITY_CASES=P1,P2 只跑指定情境
//
// 框架：
// - 情境（SCENARIOS）是一串抽象操作，例如 {op: 'startGame'}、{op: 'result', code: 'GO'}。
// - 每種 UI 有一個 driver：legacy 走舊版場記的現有函式；v2 先找新版自己的做法（V2_OPS），
//   還沒做的操作退回舊版函式（新版開著、舊版面板藏在背後照常運作），結果裡標成 fallback，看得出還有幾步不是新版做的。
//   B2 起每做好一個新版操作，就在 V2_OPS 加一筆（點新版的按鈕），這個測試就會改走新版。
// - 比對：normalize() 去掉時間戳與 id 後的 activeGame、allGames、待上傳佇列，加上統計（打者彙總、投手彙總、球隊紀錄）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const hashes = () => Object.fromEntries(fs.readdirSync(path.join(root, 'data')).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', f))).digest('hex')]));

// ---------- 情境 ----------
const SCENARIOS = [
  {id: 'P1', title: '開賽、記 4 個打席（滾地出局、三振、四壞、界外三振）', ops: [
    {op: 'startGame', opponent: 'Parity QA', date: '2026-11-18'},
    {op: 'result', code: 'GO'},
    {op: 'strikeout', kind: 'K'},
    {op: 'walk'},
    {op: 'strikeout', kind: '界外K'}
  ]},
  {id: 'P2', title: '三出局後再按記錄不會多記', ops: [
    {op: 'startGame', opponent: 'Parity QA 2', date: '2026-11-18'},
    {op: 'strikeout', kind: 'K'},
    {op: 'result', code: 'GO'},
    {op: 'strikeout', kind: 'K'},
    {op: 'walk'},
    {op: 'strikeout', kind: 'K'}
  ]}
];

// ---------- driver ----------
// 舊版：現有的全域函式（和 ui-data-safety.cjs 用的一樣）。
const LEGACY_OPS = {
  startGame: (page, {opponent, date}) => page.evaluate(({opponent, date}) => {
    document.getElementById('setup_game_date').value = date;
    document.getElementById('setup_game_opponent').value = opponent;
    switchMainTab('tabScorebook'); switchScorebookSubTab('live'); startNewGameFromSetup();
  }, {opponent, date}),
  result: (page, {code}) => page.evaluate(code => { selectOutcome(code); submitBattedBallPlay(); }, code),
  strikeout: (page, {kind}) => page.evaluate(kind => recordQuickStrikeout(kind), kind),
  walk: page => page.evaluate(() => recordQuickWalk())
};
// 新版：B1 還沒有任何記錄操作（只有外殼），全部退回舊版函式。B2 起在這裡加。
const V2_OPS = {};

const drivers = {
  legacy: {query: '', run: (page, step) => LEGACY_OPS[step.op](page, step).then(() => 'legacy')},
  v2: {query: '?ui=v2', run: (page, step) => V2_OPS[step.op] ? V2_OPS[step.op](page, step).then(() => 'v2') : LEGACY_OPS[step.op](page, step).then(() => 'fallback')}
};

// ---------- 比對 ----------
const VOLATILE = /^(id|gameId|.*At|ts|time|timestamp|savedAt|updated|created)$/i;
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter(k => !VOLATILE.test(k)).map(k => [k, normalize(value[k])]));
  }
  return value;
}
const snapshot = page => page.evaluate(() => {
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (error) { return 'unreadable'; } };
  const safe = fn => { try { return fn(); } catch (error) { return 'error: ' + error.message; } };
  return {
    activeGame: window.activeGame || null,
    storedActiveGame: read('rebas_active_game'),
    allGames: window.allGames || [],
    pendingSync: read('rebas_pending_sync'),
    stats: {
      batting: safe(() => getAggregatedStats(window.allLogs || [])),
      pitching: safe(() => getAggregatedPitcherStats()),
      team: safe(() => window.teamRecords.teamRecords()),
      games: safe(() => window.teamRecords.teamGameRecords())
    }
  };
});

function startPreview(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'ui-preview-server.cjs')], {cwd: root, env: {...process.env, UI_PREVIEW_PORT: String(port)}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    const timer = setTimeout(() => reject(new Error('preview startup timed out')), 15000);
    child.once('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(child); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited ${code}`)); });
  });
}

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const diskBefore = hashes();
  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { preview = await startPreview(54503); url = 'http://127.0.0.1:54503'; }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  let externalGitHub = 0;
  const errors = [];
  const results = [];
  const open = async (query, width = 390) => {
    const context = await browser.newContext({viewport: {width, height: 844}, isMobile: width < 768, hasTouch: width < 1024});
    // 兩邊同一個時鐘與亂數，產出的資料才可以逐欄比對。
    await context.addInitScript(() => {
      let now = 1795000000000; Date.now = () => (now += 1000);
      let s = 20261118; Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    });
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${query || 'legacy'}: ${error.message}`));
    await page.goto(url + '/' + query);
    await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    return {context, page};
  };
  try {
    // 0. 旗標本身：預設關；?ui=v2 開；設定開關寫 / 清 localStorage；新版檔案不寫資料、不連網、不用 :has()。
    {
      const off = await open('');
      const state = await off.page.evaluate(() => ({flag: window.uiV2Flag && window.uiV2Flag.on, v2: !!window.uiV2, css: !!document.querySelector('link[href*="ui-v2.css"]'),
        toggle: document.getElementById('uiV2Toggle')?.getAttribute('aria-checked'), bodyClass: document.body.classList.contains('ui-v2')}));
      assert.deepEqual(state, {flag: false, v2: false, css: false, toggle: 'false', bodyClass: false}, 'flag off: no v2 code or style on the page');
      await off.context.close();
      const on = await open('?ui=v2');
      await on.page.waitForFunction(() => window.uiV2);
      await on.page.evaluate(() => switchMainTab('tabScorebook'));
      await on.page.waitForFunction(() => document.querySelector('.v2-shell[data-v2-view="live"]')?.getClientRects().length);
      assert.equal(await on.page.evaluate(() => document.getElementById('panelScorebook').getClientRects().length), 0, 'flag on: the old 場記 panel is hidden');
      await on.page.locator('.v2-shell[data-v2-view="live"] [data-v2-go="review"]').click();
      await on.page.waitForFunction(() => document.querySelector('.v2-shell[data-v2-view="review"]')?.getClientRects().length);
      assert.equal(await on.page.evaluate(() => document.getElementById('panelGames').getClientRects().length), 0, 'flag on: the old 覆盤 panel is hidden');
      await on.context.close();
      for (const file of ['scorebook-v2.js', 'review-v2/review-v2.js', 'ui-v2.css']) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        assert.doesNotMatch(text, /:has\(/, `${file}: no :has()`);
        if (file.endsWith('.js')) assert.doesNotMatch(text, /localStorage\.(setItem|removeItem)|localCache\.(set|remove)|fetch\(|XMLHttpRequest|commit[A-Z]\w*\(/, `${file}: B1 shell never writes data or calls the network`);
      }
      results.push({id: 'P0', title: '旗標開關與新版檔案的安全檢查', status: 'PASS'});
    }
    // 1. 情境：同一串操作，舊版和新版各做一次，比對資料與統計。
    const want = process.env.UI_PARITY_CASES ? process.env.UI_PARITY_CASES.split(',') : null;
    for (const scenario of SCENARIOS.filter(s => !want || want.includes(s.id))) {
      const runs = {};
      for (const [name, driver] of Object.entries(drivers)) {
        const {context, page} = await open(driver.query);
        if (name === 'v2') assert.ok(await page.evaluate(() => !!window.uiV2Flag.on), 'v2 run has the flag on');
        const via = [];
        for (const step of scenario.ops) via.push(await driver.run(page, step));
        runs[name] = {data: normalize(await snapshot(page)), via};
        await context.close();
      }
      assert.ok(runs.legacy.data.activeGame, `${scenario.id}: the scenario produced a game`);
      assert.deepEqual(runs.v2.data, runs.legacy.data, `${scenario.id}: game JSON and statistics are identical under the old and new UI`);
      const count = kind => runs.v2.via.filter(v => v === kind).length;
      results.push({id: scenario.id, title: scenario.title, status: 'PASS', ops: scenario.ops.length, v2Ops: count('v2'), fallbackOps: count('fallback'),
        plateAppearances: (runs.legacy.data.activeGame.innings || []).reduce((n, inn) => n + (inn.plateAppearances || []).length, 0)});
    }
    assert.deepEqual(errors, [], 'no page errors');
    assert.equal(externalGitHub, 0, 'no request reached GitHub');
    assert.deepEqual(hashes(), diskBefore, 'data/*.json untouched');
    fs.writeFileSync(path.join(output, 'ui-v2-parity.json'), JSON.stringify(results, null, 2));
    for (const r of results) console.log(`${r.status} ${r.id} ${r.title}${r.ops ? `（${r.ops} 步：新版 ${r.v2Ops}、退回舊版 ${r.fallbackOps}；${r.plateAppearances} 個打席）` : ''}`);
    console.log(`ui-v2-parity: ${results.length} checks passed`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
