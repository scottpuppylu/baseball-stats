// 新舊一致測試（WO-05 B1 起，B2 擴充）：同一串操作分別在舊版場記與新版（旗標 rebas_ui_v2）下做，產出的比賽 JSON
// （排除時間戳與 id）和統計結果要完全相同。只在隔離預覽跑，不寫 data/*.json，也不連 GitHub。
//
// 用法：node tests/ui-v2-parity.cjs                 （自己起隔離預覽，port 54503）
//       UI_PREVIEW_URL=http://127.0.0.1:54321 node tests/ui-v2-parity.cjs
//       UI_PARITY_CASES=P1,P3 只跑指定情境（P0 與 AC 檢查照跑）
//
// 框架：
// - 情境（SCENARIOS）是一串抽象操作，例如 {op: 'startGame'}、{op: 'result', code: 'GO', at: [x, y]}。
// - 每種 UI 有一個 driver：legacy 走舊版場記的現有函式；v2 點新版場記自己的按鈕（V2_OPS），
//   還沒做的操作（目前只剩開賽設定，B4 才換）退回舊版函式，結果裡標成 fallback。
// - 比對：normalize() 去掉時間戳與 id 後的 activeGame、allGames、待上傳佇列，加上統計（打者彙總、投手彙總、球隊紀錄）。
//
// 刻意不同（不進一致比對，另有新版專屬檢查）：
// - 沒標落點的安打：舊版沿用上一打席留下的落點（開賽時是 P、之後是 2B），新版清掉後套舊版 selectOutcome 自己的安打預設落點
//   （1H→2B、2H→LF、3H→RC、HR→SF）。一致情境裡安打都有標落點。
// - 左右開弓打者：舊版要先選打擊方向才能送出；新版不記 battingSide（PO-29／D 節），新紀錄沒有這個欄位。
// - 6 秒內復原換局、換投：舊版沒有這個功能，新版把動作前一刻的比賽原地放回（AC-5 檢查和動作前完全相同）。
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
const V2_FILES = ['scorebook-v2.js', 'scorebook-v2-haptics.js', 'review-v2/review-v2.js', 'ui-v2.css'];

// ---------- 情境 ----------
// at：球場 400×400 座標（和舊版 handleFieldClick 同一套）；選在守位區塊中間，不壓在分界線上。
const START = (opponent) => ({op: 'startGame', opponent, date: '2026-11-18'});
const SCENARIOS = [
  {id: 'P1', title: '開賽、記 4 個打席（滾地出局、三振、四壞、界外三振）', ops: [
    START('Parity QA'),
    {op: 'result', code: 'GO'},
    {op: 'strikeout', kind: 'K'},
    {op: 'walk'},
    {op: 'strikeout', kind: '界外K'}
  ]},
  {id: 'P2', title: '三出局後再按記錄不會多記；復原上一筆後再記', ops: [
    START('Parity QA 2'),
    {op: 'strikeout', kind: 'K'},
    {op: 'result', code: 'GO'},
    {op: 'strikeout', kind: 'K'},
    {op: 'walk'},
    {op: 'strikeout', kind: 'K'},
    {op: 'undoLast'},
    {op: 'strikeout', kind: '界外K'}
  ]},
  {id: 'P3', title: '15 種打擊結果全部記一次（含落點、型態、得分），跨四個進攻半局', ops: [
    START('Parity QA 3'),
    {op: 'result', code: '1H', at: [245, 118], traj: 'line'},
    {op: 'result', code: '2H', at: [80, 120], traj: 'fly', runs: 1},
    {op: 'walk'},
    {op: 'result', code: 'GO', at: [160, 205]},
    {op: 'result', code: 'E', at: [290, 285], traj: 'grounder'},
    {op: 'result', code: 'FC', at: [110, 285], traj: 'grounder', runs: 1},
    {op: 'runnerOut'},
    {op: 'inning'},
    {op: 'inning'},
    {op: 'result', code: '3H', at: [245, 118], traj: 'fly', runs: 2},
    {op: 'result', code: 'HR', at: [155, 118], traj: 'fly', runs: 1},
    {op: 'result', code: 'LO', at: [320, 120], traj: 'line'},
    {op: 'result', code: 'SF', at: [160, 120], traj: 'fly', runs: 1},
    {op: 'result', code: 'FO', at: [85, 168], traj: 'line'},
    {op: 'inning'},
    {op: 'inning'},
    {op: 'strikeout', kind: '界外K'},
    {op: 'result', code: 'DP', at: [246, 214], traj: 'grounder'},
    {op: 'inning'},
    {op: 'inning'},
    {op: 'strikeout', kind: 'K'}
  ]},
  {id: 'P4', title: '防守 10 種事件、換投（直接、半局中確認、場下投手）、復原防守紀錄', ops: [
    START('Parity QA 4'),
    {op: 'strikeout', kind: 'K'}, {op: 'strikeout', kind: 'K'}, {op: 'strikeout', kind: 'K'},
    {op: 'inning'},
    {op: 'pitcher', who: 'lineup:0'},
    {op: 'def', code: 'BB'},
    {op: 'def', code: 'HIT'},
    {op: 'def', code: 'R1'},
    {op: 'def', code: 'K'},
    {op: 'pitcher', who: 'lineup:1'},
    {op: 'def', code: 'GO'},
    {op: 'def', code: '界外K'},
    {op: 'def', code: 'R2'},
    {op: 'inning'},
    {op: 'strikeout', kind: 'K'}, {op: 'strikeout', kind: 'K'}, {op: 'strikeout', kind: 'K'},
    {op: 'inning'},
    {op: 'pitcher', who: 'bench:0'},
    {op: 'def', code: 'DP'},
    {op: 'def', code: 'RO'},
    {op: 'undoLast'},
    {op: 'def', code: 'FO'},
    {op: 'inning'}
  ]},
  {id: 'P5', title: '換人、DH 切換、復原最新打者與跑者出局', ops: [
    START('Parity QA 5'),
    {op: 'result', code: '1H', at: [80, 120], traj: 'line'},
    {op: 'walk'},
    {op: 'undoLast'},
    {op: 'runnerOut'},
    {op: 'undoLast'},
    {op: 'sub', slot: 2, who: 'bench:0'},
    {op: 'dh'},
    {op: 'result', code: 'GO', at: [160, 205]},
    {op: 'dh'},
    {op: 'strikeout', kind: 'K'}
  ]}
];

// 名字由比賽當下決定（兩邊用同一套規則）：lineup:k＝打線上除了現任投手的第 k 位；bench:k＝不在打線上、不是投手的第 k 位隊員。
const resolveWho = (who) => {
  const g = window.activeGame;
  const [kind, k] = who.split(':');
  if (kind === 'lineup') return g.lineup.filter(n => n && n !== g.pitcherName)[Number(k)];
  const {teamNames} = getAllAvailablePlayerNames();
  return teamNames.filter(n => n && !g.lineup.includes(n) && n !== g.pitcherName)[Number(k)];
};
const DEF = {K: ['K', 0], GO: ['GO', 0], FO: ['FO', 0], DP: ['DP', 0], '界外K': ['界外K', 0], RO: ['RUNNER_OUT', 0], BB: ['BB', 0], HIT: ['HIT', 0], R1: ['RUN', 1], R2: ['RUN', 2]};

// ---------- driver ----------
// 舊版：現有的全域函式（和 ui-data-safety.cjs 用的一樣）。點球場＝handleFieldClick 的存法。
const LEGACY_OPS = {
  startGame: (page, {opponent, date}) => page.evaluate(({opponent, date}) => {
    document.getElementById('setup_game_date').value = date;
    document.getElementById('setup_game_opponent').value = opponent;
    switchMainTab('tabScorebook'); switchScorebookSubTab('live'); startNewGameFromSetup();
  }, {opponent, date}),
  result: (page, {code, at, tapped, traj, runs}) => page.evaluate(({code, at, traj, runs}) => {
    const input = window.currentPlayInput;
    if (at) {
      input.x = parseFloat(at[0].toFixed(3));
      input.y = parseFloat(at[1].toFixed(3));
      input.location = detectPositionFromCoords(at[0], at[1]);
    }
    selectOutcome(code);
    if (traj) selectTrajectory(traj);
    if (runs) selectRunsScored(runs);
    submitBattedBallPlay();
  }, {code, at: tapped || (at && [at[0] / 400, at[1] / 400]), traj, runs}),
  strikeout: (page, {kind}) => page.evaluate(kind => recordQuickStrikeout(kind), kind),
  walk: page => page.evaluate(() => recordQuickWalk()),
  runnerOut: page => page.evaluate(() => recordRunnerOut()),
  def: (page, {code}) => page.evaluate(([type, runs]) => recordDefenseEvent(type, runs), DEF[code]),
  inning: page => page.evaluate(() => switchInningNext()),
  pitcher: (page, {who}) => page.evaluate(async ({who, resolve}) => {
    const name = new Function('return ' + resolve)()(who);
    await changeDefensePitcher(name);
    const modal = document.getElementById('pitcherChangeModal');
    if (modal && !modal.classList.contains('hidden')) {
      document.getElementById('modalNewPitcherSelect').value = name;
      confirmPitcherChange();
    }
  }, {who, resolve: resolveWho.toString()}),
  sub: (page, {slot, who}) => page.evaluate(async ({slot, who, resolve}) => {
    const name = new Function('return ' + resolve)()(who);
    openSubstituteModal(slot);
    document.getElementById('substituteNewPlayerSelect').value = name;
    await confirmSubstitution();
  }, {slot, who, resolve: resolveWho.toString()}),
  dh: page => page.evaluate(() => toggleActiveGameDh()),
  undoLast: page => page.evaluate(() => {
    const g = window.activeGame;
    const inn = g.innings.find(i => i.inningNum === g.currentInning && i.topBottom === g.currentHalf);
    if (isInningOurBat(g.ourRole, g.currentHalf)) deleteInningPlay(inn.plateAppearances.length - 1);
    else deleteDefenseEvent(inn.defensiveEvents[inn.defensiveEvents.length - 1].id);
  })
};

// 新版：點新版場記的按鈕（事件委派在 .v2-live 根節點）。每一下先清掉 400 ms 防連點，測的是資料不是手速。
const tap = (page, selector) => page.evaluate(selector => {
  window.uiV2.live.state.busyUntil = 0;
  const el = document.querySelector(`.v2-live ${selector}`);
  if (!el) throw new Error(`v2: missing ${selector}`);
  el.click();
}, selector);
const has = (page, selector) => page.evaluate(selector => !!document.querySelector(`.v2-live ${selector}`), selector);
// 點球場：用 SVG 的 getScreenCTM 把 400 座標換成螢幕座標，發一個真的 click（新版 pickSpot 反算回 400 座標）。
const tapField = (page, [x, y]) => page.evaluate(([x, y]) => {
  const svg = document.querySelector('.v2l-sheet [data-v2-field]');
  const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
  svg.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, clientX: p.x, clientY: p.y}));
  const pa = window.uiV2.live.state.pa;
  return {pos: pa.pos, x: pa.x, y: pa.y};
}, [x, y]);
const css = s => JSON.stringify(s); // 名字放進屬性選擇器
// 三出局後新版的結果鍵整排換成「三出局卡」（換局／上傳／復原上一筆／結束），根本按不到；舊版是按了不記。兩邊資料一樣。
const recordKey = async (page, selector) => {
  if (!(await has(page, selector)) && await has(page, '[data-act="inning"]')) return false;
  await tap(page, selector);
  return true;
};
const V2_OPS = {
  async result(page, step) {
    const {code, at, traj, runs} = step;
    if (!(await recordKey(page, `[data-act="off"][data-code=${css(code)}]`))) return;
    if (at) {
      // 真的點擊座標是整數像素，換回 400 座標會差不到 1 個像素；舊版 handleFieldClick 也一樣。舊版那一輪用新版實際存下的 0–1 座標，
      // 等於「兩邊點在同一個螢幕點」。
      const got = await tapField(page, at);
      assert.ok(Math.abs(got.x * 400 - at[0]) < 2 && Math.abs(got.y * 400 - at[1]) < 2, `v2 field tap lands where tapped (${JSON.stringify(got)} vs ${at})`);
      assert.equal(got.pos, await page.evaluate(([x, y]) => detectPositionFromCoords(x, y), [got.x, got.y]), 'v2 field position matches the old detectPositionFromCoords');
      step.tapped = [got.x, got.y];
    }
    if (traj) await tap(page, `.v2l-sheet [data-act="traj"][data-traj="${traj}"]`);
    for (let i = 0; i < (runs || 0); i++) await tap(page, '.v2l-sheet [data-act="runs"][data-d="1"]');
    await tap(page, '.v2l-sheet [data-act="pa-submit"]');
  },
  strikeout: (page, {kind}) => recordKey(page, `[data-act="off"][data-code=${css(kind)}]`),
  walk: page => recordKey(page, '[data-act="off"][data-code="BB"]'),
  runnerOut: page => recordKey(page, '[data-act="off"][data-code="RO"]'),
  def: (page, {code}) => recordKey(page, `[data-act="def"][data-code=${css(code)}]`),
  async inning(page) {
    if (await has(page, '[data-act="inning"]')) return tap(page, '[data-act="inning"]');
    await tap(page, '[data-act="menu"]');
    await tap(page, '.v2l-sheet [data-act="inning-direct"]');
  },
  async pitcher(page, {who}) {
    const name = await page.evaluate(({who, resolve}) => new Function('return ' + resolve)()(who), {who, resolve: resolveWho.toString()});
    await tap(page, '.v2l-key[data-act="pitcher"]');
    await tap(page, `.v2l-sheet [data-act="pick-pitcher"][data-name=${css(name)}]`);
    if (await has(page, '.v2l-sheet [data-act="pitcher-yes"]')) await tap(page, '.v2l-sheet [data-act="pitcher-yes"]');
  },
  async sub(page, {slot, who}) {
    const name = await page.evaluate(({who, resolve}) => new Function('return ' + resolve)()(who), {who, resolve: resolveWho.toString()});
    await tap(page, '[data-act="menu"]');
    await tap(page, '.v2l-sheet [data-act="sub"]');
    await tap(page, `.v2l-sheet [data-act="sub-slot"][data-i="${slot}"]`);
    await tap(page, `.v2l-sheet [data-act="sub-pick"][data-name=${css(name)}]`);
  },
  async dh(page) {
    await tap(page, '[data-act="menu"]');
    await tap(page, '.v2l-sheet [data-act="dh"]');
    await tap(page, '.v2l-sheet [data-act="dh-yes"]');
  },
  // 復原：大字列上的「復原」（主要路徑）；大字列已換成錯誤訊息時，用三出局卡上的「復原上一筆」。
  async undoLast(page) {
    if (await has(page, '[data-act="snack-undo"]')) return tap(page, '[data-act="snack-undo"]');
    return tap(page, '[data-act="undo-last"]');
  }
};

// 新版先跑（記下實際點到的座標），舊版後跑。
const drivers = {
  v2: {query: '?ui=v2', run: async (page, step) => {
    if (!V2_OPS[step.op]) {
      await LEGACY_OPS[step.op](page, step);
      if (step.op === 'startGame') await page.waitForFunction(() => document.body.classList.contains('v2-live-on'));
      return 'fallback';
    }
    await V2_OPS[step.op](page, step);
    return 'v2';
  }},
  legacy: {query: '', run: (page, step) => LEGACY_OPS[step.op](page, step).then(() => 'legacy')}
};

// ---------- 比對 ----------
// playId 由時間戳產生（play_<Date.now()>），和 id 一樣排除。
const VOLATILE = /^(id|gameId|playId|.*At|ts|time|timestamp|savedAt|updated|created)$/i;
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
const gameJson = page => page.evaluate(() => JSON.stringify(window.activeGame));

function startPreview(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'ui-preview-server.cjs')], {cwd: root, env: {...process.env, UI_PREVIEW_PORT: String(port)}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    const timer = setTimeout(() => reject(new Error('preview startup timed out')), 15000);
    child.once('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(child); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited ${code}`)); });
  });
}

// 新版的震動假裝置：記下每次 navigator.vibrate 的參數。
const VIBRATE_MOCK = () => {
  window.__vib = [];
  Object.defineProperty(Navigator.prototype, 'vibrate', {configurable: true, writable: true, value: function (pattern) { window.__vib.push(pattern); return true; }});
};

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
  const open = async (query, width = 390, options = {}) => {
    const context = await browser.newContext({viewport: {width, height: 844}, isMobile: width < 768, hasTouch: width < 1024, reducedMotion: options.reducedMotion || 'no-preference'});
    // 兩邊同一個時鐘與亂數，產出的資料才可以逐欄比對。
    await context.addInitScript(() => {
      let now = 1795000000000; Date.now = () => (now += 1000);
      let s = 20261118; Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    });
    if (options.vibrate) await context.addInitScript(VIBRATE_MOCK);
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    const page = await context.newPage();
    // 舊版的確認框（換投、DH）一律按「確定」，和使用者在新版按「確定換投」「改用 DH」一樣。
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(`${query || 'legacy'}: ${error.message}`));
    await page.goto(url + '/' + query);
    await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    return {context, page};
  };
  const startV2 = async (options = {}) => {
    const run = await open('?ui=v2', options.width || 390, options);
    await run.page.waitForFunction(() => window.uiV2 && window.uiV2.live);
    await LEGACY_OPS.startGame(run.page, {opponent: 'AC QA', date: '2026-11-18'});
    await run.page.waitForFunction(() => document.body.classList.contains('v2-live-on'));
    return run;
  };
  try {
    // 0. 旗標本身：預設關；?ui=v2 開；外殼沒有「實況／覆盤」切換，從既有的比賽群組分頁進出；新版檔案不寫比賽資料、不連網、不用 :has()。
    {
      const off = await open('');
      const state = await off.page.evaluate(() => ({flag: window.uiV2Flag && window.uiV2Flag.on, v2: !!window.uiV2, css: !!document.querySelector('link[href*="ui-v2.css"]'),
        toggle: document.getElementById('uiV2Toggle')?.getAttribute('aria-checked'), bodyClass: document.body.classList.contains('ui-v2')}));
      assert.deepEqual(state, {flag: false, v2: false, css: false, toggle: 'false', bodyClass: false}, 'flag off: no v2 code or style on the page');
      await off.context.close();
      const on = await open('?ui=v2');
      await on.page.waitForFunction(() => window.uiV2);
      await on.page.evaluate(() => switchMainTab('tabScorebook'));
      await on.page.waitForFunction(() => document.body.dataset.page === 'Scorebook');
      const noGame = await on.page.evaluate(() => ({legacySetup: document.getElementById('panelScorebook').getClientRects().length > 0, live: document.body.classList.contains('v2-live-on'),
        seg: document.querySelectorAll('.v2-seg, [data-v2-go]').length}));
      assert.deepEqual(noGame, {legacySetup: true, live: false, seg: 0}, 'flag on, no game: 場記 shows the old setup (B4 replaces it); no 實況／覆盤 switch');
      await on.page.evaluate(() => switchMainTab('tabGames'));
      await on.page.waitForFunction(() => document.querySelector('.v2-shell[data-v2-view="review"]')?.getClientRects().length);
      assert.equal(await on.page.evaluate(() => document.getElementById('panelGames').getClientRects().length), 0, 'flag on: the old 覆盤 panel is hidden');
      assert.equal(await on.page.evaluate(() => document.querySelectorAll('.v2-seg, [data-v2-go]').length), 0, 'flag on: the review shell has no 實況／覆盤 switch (REVISION 2 addition 3)');
      await on.context.close();
      for (const file of V2_FILES) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        assert.doesNotMatch(text, /:has\(/, `${file}: no :has()`);
        if (!file.endsWith('.js')) continue;
        assert.doesNotMatch(text, /localCache\.(set|remove)|fetch\(|XMLHttpRequest|commit[A-Z]\w*\(/, `${file}: never calls the network or commits data itself`);
        // localStorage 只寫新版自己的兩個偏好鍵；比賽只透過舊版的 storeLocal('rebas_active_game') 存。
        for (const m of text.matchAll(/localStorage\.(setItem|removeItem)\(\s*([^,)]+)/g)) assert.ok(['KEY', 'HC_KEY'].includes(m[2].trim()), `${file}: localStorage write only to the v2 preference keys (${m[0]})`);
        for (const m of text.matchAll(/storeLocal\(\s*([^,)]+)/g)) assert.equal(m[1].trim(), "'rebas_active_game'", `${file}: storeLocal only for the active game`);
      }
      assert.match(fs.readFileSync(path.join(root, 'scorebook-v2-haptics.js'), 'utf8'), /const KEY = 'rebas_ui_v2_haptics'/);
      assert.match(fs.readFileSync(path.join(root, 'scorebook-v2.js'), 'utf8'), /HC_KEY = 'rebas_ui_v2_hc'/);
      results.push({id: 'P0', title: '旗標開關、外殼沒有實況／覆盤切換、新版檔案的安全檢查', status: 'PASS'});
    }
    // 1. 情境：同一串操作，舊版和新版各做一次，比對資料與統計。
    const want = process.env.UI_PARITY_CASES ? process.env.UI_PARITY_CASES.split(',') : null;
    for (const scenario of SCENARIOS.filter(s => !want || want.includes(s.id))) {
      scenario.ops.forEach(step => { delete step.tapped; });
      const runs = {};
      for (const [name, driver] of Object.entries(drivers)) {
        const {context, page} = await open(driver.query);
        if (name === 'v2') assert.ok(await page.evaluate(() => !!window.uiV2Flag.on), 'v2 run has the flag on');
        const via = [];
        for (const step of scenario.ops) {
          try { via.push(await driver.run(page, step)); } catch (error) { throw new Error(`${scenario.id} ${name} step ${via.length + 1} ${JSON.stringify(step)}: ${error.message}`); }
        }
        runs[name] = {data: normalize(await snapshot(page)), via};
        await context.close();
      }
      assert.ok(runs.legacy.data.activeGame, `${scenario.id}: the scenario produced a game`);
      assert.deepEqual(runs.v2.data, runs.legacy.data, `${scenario.id}: game JSON and statistics are identical under the old and new UI`);
      const count = kind => runs.v2.via.filter(v => v === kind).length;
      const g = runs.legacy.data.activeGame;
      results.push({id: scenario.id, title: scenario.title, status: 'PASS', ops: scenario.ops.length, v2Ops: count('v2'), fallbackOps: count('fallback'),
        plateAppearances: (g.innings || []).reduce((n, inn) => n + (inn.plateAppearances || []).length, 0),
        defensiveEvents: (g.innings || []).reduce((n, inn) => n + (inn.defensiveEvents || []).length, 0)});
    }

    // 2. AC-4：PO-29（不記打點、跑者推進、失誤歸屬、處理球員）、壘包不自動動、色調、鍵盤、守位對應。
    {
      const banned = /RBI|rbi|打點|帶進|fielder|處理球員/;
      for (const file of V2_FILES) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), banned, `${file}: no RBI / runner-advance / fielder words`);
      const {context, page} = await startV2();
      const pad = await page.evaluate(() => {
        const keys = [...document.querySelectorAll('.v2-live [data-act="off"]')];
        return {codes: keys.map(k => k.dataset.code), tones: Object.fromEntries(keys.map(k => [k.dataset.code, [...k.classList].find(c => c.startsWith('tone-'))])),
          padText: keys[0].parentElement.textContent, hasMore: [...keys[0].parentElement.querySelectorAll('button')].some(b => /更多/.test(b.textContent + (b.getAttribute('aria-label') || '')))};
      });
      assert.deepEqual(pad.codes, ['1H', '2H', '3H', 'HR', 'BB', 'GO', 'FO', 'LO', 'K', '界外K', 'DP', 'FC', 'SF', 'RO', 'E'], 'offense pad: 15 result keys, nothing hidden');
      assert.equal(pad.hasMore, false, 'offense pad: no 更多 key');
      const TONE = {'1H': 'hit', '2H': 'hit', '3H': 'hit', HR: 'hit', BB: 'on', E: 'on', GO: 'out', FO: 'out', LO: 'out', K: 'out', '界外K': 'out', DP: 'out', FC: 'out', SF: 'out', RO: 'out'};
      assert.deepEqual(pad.tones, Object.fromEntries(Object.entries(TONE).map(([k, v]) => [k, `tone-${v}`])), 'result tones: out red, hit green, on-base blue');
      // 每個守位標籤的中心點一下，對應的守位和舊版 detectPositionFromCoords 一樣。
      await tap(page, '[data-act="off"][data-code="1H"]');
      const centres = await page.evaluate(() => [...document.querySelectorAll('.v2l-sheet [data-v2-field] .v2f-label')].map(t => { const b = t.getBBox(); return [t.textContent, b.x + b.width / 2, b.y + b.height / 2]; }));
      assert.equal(centres.length, 10, '10 fielder positions on the field');
      for (const [label, x, y] of centres) {
        const got = await tapField(page, [x, y]);
        const legacy = await page.evaluate(([x, y]) => detectPositionFromCoords(x / 400, y / 400), [x, y]);
        assert.equal(got.pos, label, `tap on the ${label} label centre picks ${label}`);
        assert.equal(legacy, label, `the old detectPositionFromCoords also gives ${label}`);
      }
      await tap(page, '.v2l-sheet [data-act="close"].v2s-x');
      // 連三支一安：壘包不會自動改（只能手動切換）。
      const basesBefore = await page.evaluate(() => JSON.stringify(window.activeGame.currentBases));
      for (let i = 0; i < 3; i++) await V2_OPS.result(page, {code: '1H', at: [245, 118], traj: 'line'});
      assert.equal(await page.evaluate(() => JSON.stringify(window.activeGame.currentBases)), basesBefore, 'three singles in a row leave the bases unchanged');
      // 沒標落點的安打（刻意不同）：套舊版 selectOutcome 的安打預設落點。
      await tap(page, '[data-act="off"][data-code="2H"]');
      await tap(page, '.v2l-sheet [data-act="pa-submit"]');
      assert.equal(await page.evaluate(() => { const g = window.activeGame; const pas = g.innings[0].plateAppearances; return pas[pas.length - 1].location; }), 'LF', 'untapped 2H gets the old auto spot LF');
      // 左右開弓（刻意不同）：舊版沒選方向不能送出；新版照記，而且新紀錄沒有 battingSide。
      const sw = await page.evaluate(() => {
        const g = window.activeGame;
        const batter = g.lineup[g.currentBatterIdx];
        const data = PlayerHealthStore.data();
        data[batter] = {...(data[batter] || {}), bats: 'S'};
        const count = () => g.innings[0].plateAppearances.length;
        const before = count();
        selectOutcome('GO'); selectTrajectory('grounder'); submitBattedBallPlay();
        return {batter, legacyBlocked: count() === before, stillS: PlayerHealthStore.data()[batter]?.bats === 'S'};
      });
      assert.ok(sw.stillS && sw.legacyBlocked, 'the switch-hitter flag is in effect (the old submit refuses without a side)');
      await V2_OPS.result(page, {code: 'GO', at: [160, 205]});
      const last = await page.evaluate(() => { const pas = window.activeGame.innings[0].plateAppearances; return pas[pas.length - 1]; });
      assert.equal(last.batter || last.name || last.player || sw.batter, sw.batter);
      assert.equal(last.result, 'GO', 'the switch hitter\'s plate appearance is recorded');
      assert.equal('battingSide' in last, false, 'new record has no battingSide key');
      const keys = await page.evaluate(() => [...new Set(window.activeGame.innings.flatMap(i => [...(i.plateAppearances || []), ...(i.defensiveEvents || [])]).flatMap(r => Object.keys(r)))]);
      assert.deepEqual(keys.filter(k => /rbi|fielder|error|battingSide|advance/i.test(k)), [], 'no RBI / fielder / error / runner-advance fields in any record');
      await context.close();
      results.push({id: 'AC-4', title: 'PO-29 禁字與欄位、連三安壘包不動、色調、15 鍵無更多、10 守位中心對應、未標落點安打、左右開弓不記 battingSide', status: 'PASS'});
    }

    // 3. AC-5：PO-37 換局／換投 6 秒復原、確認條件、PO-38 出局 ± 只改 currentOuts、復原鈕 6 秒後消失。
    {
      const legacyLines = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split('\n').slice(9073, 9076).join('\n');
      assert.match(legacyLines, /activeGame\.pitcherName && newPitcherName !== activeGame\.pitcherName && \(currentHalf\?\.defensiveEvents \|\| \[\]\)\.length/, 'index.html:9074-9076 still holds the confirm condition the v2 pitcherNeedsConfirm copies');
      assert.match(fs.readFileSync(path.join(root, 'scorebook-v2.js'), 'utf8'), /g\.pitcherName && name !== g\.pitcherName && \(inn\?\.defensiveEvents \|\| \[\]\)\.length/, 'v2 pitcherNeedsConfirm uses the same condition');
      const {context, page} = await startV2();
      for (let i = 0; i < 3; i++) await V2_OPS.strikeout(page, {kind: 'K'});
      // 換局 → 6 秒內復原：局數、出局、壘包、打序全回到換局前（整場比賽 JSON 一模一樣）。
      const beforeInning = await gameJson(page);
      await V2_OPS.inning(page);
      assert.equal(await page.evaluate(() => window.activeGame.currentHalf), 'bottom', 'inning changed');
      await tap(page, '[data-act="snack-undo"]');
      assert.equal(await gameJson(page), beforeInning, 'undo within 6 s after an inning change restores the game exactly (inning, outs, bases, batting order)');
      assert.equal(await page.evaluate(() => localStorage.getItem('rebas_active_game')), beforeInning, 'the restored game is also what is stored');
      await V2_OPS.inning(page);
      // 換投（本半局還沒有守備紀錄）：直接換，不問；6 秒內復原回原投手，也不多出守備事件。
      const p1 = await page.evaluate(`(${resolveWho.toString()})('lineup:0')`);
      const beforeP1 = await gameJson(page);
      await tap(page, '.v2l-key[data-act="pitcher"]');
      await tap(page, `.v2l-sheet [data-act="pick-pitcher"][data-name=${css(p1)}]`);
      assert.equal(await has(page, '.v2l-sheet [data-act="pitcher-yes"]'), false, 'no confirm when the half has no defense record yet');
      assert.equal(await page.evaluate(() => window.activeGame.pitcherName), p1, 'pitcher changed directly');
      await tap(page, '[data-act="snack-undo"]');
      assert.equal(await gameJson(page), beforeP1, 'undo within 6 s after a pitcher change restores the pitcher and adds no defense event');
      // 有守備紀錄後換投：要再確認一次（舊版 9074-9076 同一條件）。
      await V2_OPS.def(page, {code: 'K'});
      const p2 = await page.evaluate(`(${resolveWho.toString()})('lineup:1')`);
      const beforeP2 = await gameJson(page);
      await tap(page, '.v2l-key[data-act="pitcher"]');
      await tap(page, `.v2l-sheet [data-act="pick-pitcher"][data-name=${css(p2)}]`);
      assert.equal(await has(page, '.v2l-sheet [data-act="pitcher-yes"]'), true, 'mid-half pitcher change asks to confirm');
      await tap(page, '.v2l-sheet [data-act="pitcher-yes"]');
      assert.equal(await page.evaluate(() => window.activeGame.innings.find(i => i.topBottom === 'bottom').defensiveEvents.length), 1, 'pitcher change adds no defense event');
      await tap(page, '[data-act="snack-undo"]');
      assert.equal(await gameJson(page), beforeP2, 'undo restores the mid-half pitcher change exactly');
      // PO-38：出局 ± 只改 currentOuts，不新增紀錄、不改任何一筆。
      const beforeOuts = JSON.parse(await gameJson(page));
      await tap(page, '[data-act="sit"]');
      await tap(page, '.v2l-sheet [data-act="outs"][data-d="1"]');
      const afterOuts = JSON.parse(await gameJson(page));
      assert.equal(afterOuts.currentOuts, beforeOuts.currentOuts + 1, 'outs + adds one out');
      assert.deepEqual({...afterOuts, currentOuts: 0}, {...beforeOuts, currentOuts: 0}, 'outs ± changes only currentOuts (no new field, no record touched)');
      await tap(page, '.v2l-sheet [data-act="outs"][data-d="-1"]');
      assert.deepEqual(JSON.parse(await gameJson(page)), beforeOuts, 'outs − brings it back');
      await tap(page, '.v2l-sheet [data-act="close"].v2s-x');
      // 復原鈕 6 秒後消失。
      await V2_OPS.def(page, {code: 'GO'});
      assert.equal(await has(page, '[data-act="snack-undo"]'), true, 'undo button shows after a record');
      await page.waitForTimeout(6200);
      assert.equal(await has(page, '[data-act="snack-undo"]'), false, 'undo button is gone after 6 s');
      // AC-FB-5 的效能做法：新版蓋著時舊版隱藏面板延後重畫。換回舊函式要完整，新版收起時舊版畫面要跟資料一致。
      assert.deepEqual(await page.evaluate(() => ['renderLiveScorer', 'updateBasesAndOutsDisplay', 'updateLiveBatterCard', 'renderLiveLineupCard'].map(n => window[n].name)),
        ['renderLiveScorer', 'updateBasesAndOutsDisplay', 'updateLiveBatterCard', 'renderLiveLineupCard'], 'legacy painters are the real functions again after each record');
      await page.evaluate(() => switchMainTab('tabGames'));
      const legacy = await page.evaluate(() => {
        const g = window.activeGame;
        const lit = [1, 2, 3].map(i => document.getElementById('outLamp' + i).className.includes('bg-rose-500'));
        return {outs: g.currentOuts, lit, meta: document.getElementById('liveGameMetaSubtitle').textContent};
      });
      assert.deepEqual(legacy.lit, [1, 2, 3].map(i => legacy.outs >= i), 'legacy out lamps match the game once the v2 overlay is hidden');
      assert.ok(legacy.meta.includes('我方守備投球中'), 'legacy header is repainted for the current half');
      await context.close();
      results.push({id: 'AC-5', title: 'PO-37 確認條件＝index.html:9074-9076、換局／換投 6 秒復原完全還原、復原鈕 6 秒消失、PO-38 出局 ± 只改 currentOuts、新版收起後舊版畫面補畫一致（復原打者／跑者出局見 P2、P4、P5）', status: 'PASS'});
    }

    // 4. AC-6：AC-FB-1（六種回饋的震動與畫面）、FB-6（減少動態）、FB-7（觸覺開關）、FB-8（動畫白名單）。
    {
      const {context, page} = await startV2({vibrate: true});
      assert.equal(await page.evaluate(() => window.uiV2Haptics.mode), 'vibrate');
      const lastVib = () => page.evaluate(() => JSON.stringify(window.__vib[window.__vib.length - 1]));
      const board = () => page.evaluate(() => { const b = document.querySelector('.v2-live [data-v2-board]'); return {flash: b.classList.contains('v2-flash'), tone: b.dataset.flash || '', big: b.dataset.big || ''}; });
      // V1：按下就變實色（pointerdown 當下），放開就回來。
      const v1 = await page.evaluate(() => {
        window.uiV2.live.state.busyUntil = 0;
        const key = document.querySelector('.v2-live [data-act="off"][data-code="GO"]');
        key.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'touch'}));
        const down = key.classList.contains('v2-down');
        const style = getComputedStyle(key);
        const border = style.borderTopWidth;
        const transition = style.transitionDuration;
        key.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0, pointerType: 'touch'}));
        return {down, border, transition, up: !key.classList.contains('v2-down')};
      });
      assert.deepEqual(v1, {down: true, border: '3px', transition: '0s', up: true}, 'V1: solid press state with a 3px border, no transition, released on pointerup');
      // ① 選取（開打席 sheet）
      await tap(page, '[data-act="off"][data-code="1H"]');
      assert.equal(await lastVib(), '10', '① select = 10');
      await tapField(page, [245, 118]);
      await tap(page, '.v2l-sheet [data-act="pa-submit"]');
      // ② 一般記錄
      assert.equal(await lastVib(), '40', '② record = 40');
      assert.deepEqual(await board(), {flash: true, tone: 'hit', big: ''}, '② board flashes the hit tone');
      // ③ 出局
      await V2_OPS.result(page, {code: 'GO', at: [160, 205]});
      assert.equal(await lastVib(), '[40,70,40]', '③ out = [40,70,40]');
      assert.equal((await board()).tone, 'out', '③ board flashes the out tone');
      await V2_OPS.strikeout(page, {kind: 'K'});
      // ④ 三出局
      await V2_OPS.strikeout(page, {kind: 'K'});
      assert.equal(await lastVib(), '[40,70,40,70,40]', '④ third out = [40,70,40,70,40]');
      assert.deepEqual(await board(), {flash: true, tone: 'out', big: '三出局'}, '④ board shows 三出局 big');
      // ⑤ 復原
      await tap(page, '[data-act="snack-undo"]');
      assert.equal(await lastVib(), '120', '⑤ undo = 120');
      assert.equal((await board()).tone, 'neutral', '⑤ board flashes neutral');
      // ⑥ 錯誤：三出局後在「出局與壘包」再按出局 ＋
      await V2_OPS.strikeout(page, {kind: 'K'});
      const pas = () => page.evaluate(() => window.activeGame.innings[0].plateAppearances.length);
      const n = await pas();
      await tap(page, '[data-act="sit"]');
      await tap(page, '.v2l-sheet [data-act="outs"][data-d="1"]');
      assert.equal(await lastVib(), '[20,40,20,40,20]', '⑥ error = [20,40,20,40,20]');
      assert.equal(await pas(), n, '⑥ nothing recorded');
      assert.deepEqual(await page.evaluate(() => ({err: !!document.querySelector('.v2-live .v2-err'), snack: document.querySelector('.v2-live .v2l-snack').className, outs: window.activeGame.currentOuts})), {err: true, snack: 'v2l-snack tone-error', outs: 3}, '⑥ the key shakes red and the snack shows the error');
      await tap(page, '.v2l-sheet [data-act="close"].v2s-x');
      // 防連點：400 ms 內第二下不記、不震、不給回饋。
      await tap(page, '[data-act="undo-last"]');
      const debounce = await page.evaluate(() => {
        window.uiV2.live.state.busyUntil = 0;
        const before = window.__vib.length;
        const key = () => document.querySelector('.v2-live [data-act="off"][data-code="界外K"]');
        key().click();
        const k2 = key() || document.querySelector('.v2-live [data-act="inning"]');
        k2.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0}));
        const down = k2.classList.contains('v2-down');
        k2.click();
        return {calls: window.__vib.length - before, down};
      });
      assert.deepEqual(debounce, {calls: 1, down: false}, 'a debounced second tap gives no vibration and no press feedback');
      assert.equal(await pas(), n, 'debounced tap records nothing extra');
      // FB-7：觸覺開關在 ⋯ 選單、緊鄰戶外高對比；兩下切換；重新整理後還是關；關掉時不震但畫面回饋照常。
      await tap(page, '[data-act="menu"]');
      const sw = await page.evaluate(() => { const h = document.querySelector('.v2l-sheet [data-act="haptics"]'); return {adjacent: h.previousElementSibling?.dataset.act === 'hc', on: h.getAttribute('aria-checked')}; });
      assert.deepEqual(sw, {adjacent: true, on: 'true'}, '觸覺回饋 switch sits right after 戶外高對比, on by default');
      await tap(page, '.v2l-sheet [data-act="haptics"]');
      assert.equal(await page.evaluate(() => [document.querySelector('.v2l-sheet [data-act="haptics"]').getAttribute('aria-checked'), localStorage.getItem('rebas_ui_v2_haptics')].join()), 'false,0', 'switched off in 2 taps and saved');
      await page.reload();
      await page.waitForFunction(() => window.uiV2 && window.teamRecords);
      await page.evaluate(() => switchMainTab('tabScorebook'));
      await page.waitForFunction(() => document.body.classList.contains('v2-live-on'));
      assert.equal(await page.evaluate(() => window.uiV2Haptics.enabled), false, 'still off after reload');
      await tap(page, '[data-act="undo-last"]');
      assert.deepEqual([await page.evaluate(() => window.__vib.length), (await board()).flash], [0, true], 'haptics off: no vibrate call, visual feedback unchanged');
      await tap(page, '[data-act="menu"]');
      await tap(page, '.v2l-sheet [data-act="haptics"]');
      assert.equal(await page.evaluate(() => localStorage.getItem('rebas_ui_v2_haptics')), null, 'switched back on');
      await tap(page, '.v2l-sheet [data-act="close"].v2s-x');
      // FB-8：新版場記裡只有三種動畫：sheet 升起 240 ms ease-out、復原倒數 6 s、記分盤淡回 120 ms。沒有彈簧、沒有超過 300 ms 的其他動畫。
      const sample = () => page.evaluate(() => document.getAnimations().filter(a => a.effect?.target && document.querySelector('.v2-live').contains(a.effect.target)).map(a => {
        const t = a.effect.getTiming();
        const k = a.effect.getKeyframes ? a.effect.getKeyframes() : [];
        return {name: a.animationName || a.transitionProperty, dur: t.duration, easing: t.easing === 'linear' && k[0] && k[0].easing ? k[0].easing : t.easing};
      }));
      const seen = [];
      await tap(page, '[data-act="off"][data-code="2H"]');
      seen.push(...await sample());
      await tapField(page, [80, 120]);
      await tap(page, '.v2l-sheet [data-act="pa-submit"]');
      seen.push(...await sample());
      await page.waitForTimeout(340);
      seen.push(...await sample());
      const allowed = a => (a.name === 'v2-rise' && a.dur === 240 && a.easing === 'ease-out') || (a.name === 'v2-drain' && a.dur === 6000) || (a.name === 'background-color' && a.dur <= 120);
      assert.deepEqual(seen.filter(a => !allowed(a)), [], `only the whitelisted animations run (${JSON.stringify(seen)})`);
      assert.ok(seen.some(a => a.name === 'v2-rise') && seen.some(a => a.name === 'v2-drain') && seen.some(a => a.name === 'background-color'), 'the three allowed animations were actually observed');
      await context.close();
      // FB-6：減少動態：sheet 原地出現、沒有倒數條（改成文字）、閃色與大字與震動照常、沒有 transform 動畫。
      const rm = await startV2({vibrate: true, reducedMotion: 'reduce'});
      await tap(rm.page, '[data-act="off"][data-code="1H"]');
      const sheetAnims = await rm.page.evaluate(() => document.getAnimations().filter(a => document.querySelector('.v2-live').contains(a.effect?.target)).map(a => a.animationName || a.transitionProperty));
      assert.deepEqual(sheetAnims, [], 'reduced motion: the sheet appears in place');
      await tapField(rm.page, [245, 118]);
      await tap(rm.page, '.v2l-sheet [data-act="pa-submit"]');
      const rmState = await rm.page.evaluate(() => ({
        anims: document.getAnimations().filter(a => document.querySelector('.v2-live').contains(a.effect?.target)).map(a => a.animationName || a.transitionProperty),
        drainText: document.querySelector('.v2-live .v2l-drain-txt')?.textContent || '', drainBar: !!document.querySelector('.v2-live .v2l-drain'),
        flash: document.querySelector('.v2-live [data-v2-board]').classList.contains('v2-flash'), vib: JSON.stringify(window.__vib)}));
      assert.deepEqual(rmState, {anims: [], drainText: '6 秒內可復原', drainBar: false, flash: true, vib: '[10,40,40]'}, 'reduced motion keeps V1/V2/haptics, no moving animation, drain bar becomes text');
      await rm.context.close();
      results.push({id: 'AC-6', title: 'AC-FB-1 六種震動與畫面回饋＋防連點、FB-6 減少動態、FB-7 觸覺開關（緊鄰高對比、兩下、重整保留）、FB-8 動畫白名單', status: 'PASS'});
    }

    assert.deepEqual(errors, [], 'no page errors');
    assert.equal(externalGitHub, 0, 'no request reached GitHub');
    assert.deepEqual(hashes(), diskBefore, 'data/*.json untouched');
    fs.writeFileSync(path.join(output, 'ui-v2-parity.json'), JSON.stringify(results, null, 2));
    for (const r of results) console.log(`${r.status} ${r.id} ${r.title}${r.ops ? `（${r.ops} 步：新版 ${r.v2Ops}、退回舊版 ${r.fallbackOps}；${r.plateAppearances} 個打席、${r.defensiveEvents} 筆守備）` : ''}`);
    console.log(`ui-v2-parity: ${results.length} checks passed`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
