// scorebook-v2.js — 新版場記（WO-05 B2＋B3）與覆盤外殼。
// 只在旗標開時載入（localStorage.rebas_ui_v2 = '1' 或網址 ?ui=v2；判斷在 index.html 結尾）。旗標關時這個檔案不會載入，
// 舊版場記與覆盤一行都不受影響。
//
// 資料規則（WO-05 §D）：
// - 新舊版讀寫同一份 rebas_active_game／rebas_all_games／rebas_pending_sync。所有寫入都經現有函式
//   （submitBattedBallPlay、recordQuickStrikeout、recordQuickWalk、recordRunnerOut、recordDefenseEvent、deleteInningPlay、
//   deleteDefenseEvent、switchInningNext、changeDefensePitcher、confirmPitcherChange、confirmSubstitution、toggleActiveGameDh、
//   toggleBaseRunner、syncCurrentInningToCloud、finishActiveGameAndSyncLogs、discardActiveGame）。不轉格式、不搬資料。
// - 例外只有四種，舊版場記沒有對應的按鈕，所以由這裡照現有函式的寫法做（欄位與格式不變）：
//   出局 ±（PO-38，只改 currentOuts）、換投／換局 6 秒復原（PO-37，把動作前一刻的比賽原地放回）、
//   全部紀錄裡改結果、刪除前面半局的一筆（總監 D2；目前半局的刪除仍走 deleteInningPlay／deleteDefenseEvent）。
// - PO-29：只記結果、落點、型態、得分；跑者推進與守備相關欄位一律不記，壘包只能手動切換。PO-31：沒有左右打選擇，新紀錄不寫 battingSide。
// - activeGame 是舊版 inline script 的頂層 let（window.activeGame 是同一個物件）。很多舊函式直接用 let 那份，
//   所以這裡永遠只改同一個物件，不換成新物件（6 秒復原也是原地放回）。
(function () {
  'use strict';
  const main = document.querySelector('#appWorkspace main');
  if (!main || !window.siteHooks || typeof window.switchMainTab !== 'function') return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const haptics = window.uiV2Haptics || {fire() { return false; }, attach() {}, note() { return '此裝置不支援震動'; }, mode: 'none', enabled: false, setEnabled() { return false; }};
  const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};
  const PROBE = /[?&]fbprobe=1(&|$)/.test(location.search);
  const HC_KEY = 'rebas_ui_v2_hc';

  // ---------- 結果與顏色（PO-34／F6；覆盤的結果標籤用同一份，B5 起從 window.uiV2.RESULT_TONE 讀） ----------
  // out＝紅（會出局的 9 個結果）、hit＝綠、on＝藍（保送、失誤上壘）、run＝琥珀（對方得分）。
  const RESULT_TONE = Object.freeze({
    K: 'out', '界外K': 'out', GO: 'out', FO: 'out', LO: 'out', SF: 'out', FC: 'out', DP: 'out', RO: 'out', OUT: 'out', RUNNER_OUT: 'out',
    '1H': 'hit', '2H': 'hit', '3H': 'hit', HR: 'hit', HIT: 'hit',
    BB: 'on', E: 'on',
    R1: 'run', R2: 'run', RUN: 'run'
  });
  const RESULT_NAME = {
    '1H': '一安', '2H': '二安', '3H': '三安', HR: '全壘打', BB: '保送', GO: '滾地出局', FO: '飛球接殺', LO: '平飛接殺', K: '三振', '界外K': '界外K',
    DP: '雙殺', FC: '野選', SF: '犧飛', RO: '跑者出局', OUT: '跑者出局', E: '失誤上壘'
  };
  const DEF_NAME = {K: '三振', GO: '滾地刺殺', FO: '接殺', DP: '雙殺', '界外K': '界外K', RUNNER_OUT: '跑者出局', BB: '保送', HIT: '被安打', RUN: '失分'};
  // 進攻 5×3：所有結果都在主盤，沒有「更多」（PO-35／F7）。[代碼, 大字, 小字]
  const OFF_PAD = [
    ['1H', '1H', '一安'], ['2H', '2H', '二安'], ['3H', '3H', '三安'], ['HR', 'HR', '全壘打'], ['BB', 'BB', '保送'],
    ['GO', '滾地', '出局'], ['FO', '飛球', '接殺'], ['LO', '平飛', '接殺'], ['K', 'K', '三振'], ['界外K', '界外K', '三振'],
    ['DP', '雙殺', '兩出局'], ['FC', '野選', '出局'], ['SF', '犧飛', '出局'], ['RO', '跑者', '出局'], ['E', '失誤', '上壘']
  ];
  const QUICK = new Set(['K', '界外K', 'BB', 'RO']); // 不用落點與型態，按下就記
  // 防守 4×3（含換投、跑者出局）。[代碼, 大字, 小字, 事件型別, 失分]
  const DEF_PAD = [
    ['K', 'K', '三振', 'K', 0], ['GO', '滾地', '刺殺', 'GO', 0], ['FO', '飛球', '接殺', 'FO', 0], ['DP', '雙殺', '兩出局', 'DP', 0],
    ['界外K', '界外K', '三振', '界外K', 0], ['RO', '跑者', '出局', 'RUNNER_OUT', 0], ['BB', 'BB', '保送', 'BB', 0], ['HIT', '安打', '被安打', 'HIT', 0],
    ['R1', '失 1 分', '對方得分', 'RUN', 1], ['R2', '失 2 分', '對方得分', 'RUN', 2]
  ];
  const HITS = ['1H', '2H', '3H', 'HR'];
  // 和 index.html 的 TRAJECTORY_RULES 相同（舊版才是準則；原型的 FO 只能高飛、LO 只能平飛不採用）。
  const TRAJ_RULES = {GO: ['grounder'], FO: ['fly', 'line'], LO: ['line', 'fly'], SF: ['fly', 'line']};
  const TRAJ_LABEL = {grounder: '滾地', line: '平飛', fly: '高飛'};
  const INFIELD = ['P', 'C', '1B', '2B', '3B', 'SS'];
  const POS_NAME = {P: '投手', C: '捕手', '1B': '一壘', '2B': '二壘', '3B': '三壘', SS: '游擊', LF: '左外', SF: '自由', RC: '右中', RF: '右外'};
  // 舊版 submitBattedBallPlay 的出局數表（9722-9726）
  const outsFor = code => (['GO', 'FO', 'LO', 'K', '界外K', 'FC'].includes(code) ? 1 : code === 'DP' ? 2 : code === 'SF' ? 1 : 0);
  const DEF_OUTS = type => (type === 'DP' ? 2 : ['GO', 'FO', 'K', '界外K', 'RUNNER_OUT'].includes(type) ? 1 : 0);

  // ---------- 舊版狀態的讀取 ----------
  const game = () => (typeof activeGame !== 'undefined' && activeGame) ? activeGame : (window.activeGame || null);
  const live = () => { const g = game(); return g && g.status === 'in_progress' ? g : null; };
  const halfOf = (g, num, half) => (g.innings || []).find(i => i.inningNum === num && i.topBottom === half);
  const curHalf = g => halfOf(g, g.currentInning, g.currentHalf);
  const weBat = g => isInningOurBat(g.ourRole, g.currentHalf);
  const halfLabel = (num, half) => `${num} 局${half === 'top' ? '上' : '下'}`;
  const nextHalf = g => g.currentHalf === 'top' ? {num: g.currentInning, half: 'bottom'} : {num: g.currentInning + 1, half: 'top'};
  const jersey = name => (window.NAME_TO_JERSEY && window.NAME_TO_JERSEY[name] != null ? `#${window.NAME_TO_JERSEY[name]} ` : '');
  const positions = g => { try { return getGameLineupPositions(); } catch (error) { return g.lineupPositions || []; } };
  const finalizing = () => typeof window.isFinalizingGame === 'function' && window.isFinalizingGame();
  const saveGame = g => storeLocal('rebas_active_game', JSON.stringify(g));

  // 舊版函式寫入時會跳自己的 toast（右下角）；新版用自己的大字列，所以呼叫期間先收起來，錯誤訊息轉成新版的錯誤回饋。
  // AC-FB-5：新版蓋在上面時，舊版看不見的面板（壘包燈、打者卡、名單卡…）每次記錄都重畫一次，4× 降速下佔掉 60～80 ms。
  // 這段期間先把這些「只畫畫面、不寫資料」的函式換成記號，等新版收起來（換分頁、比賽結束）再一次補畫舊版畫面。
  const LEGACY_PAINTERS = ['renderLiveScorer', 'updateLiveScoreboard', 'updateBasesAndOutsDisplay', 'updateLiveBatterCard', 'updateLivePitcherCard',
    'renderLiveLineupCard', 'renderCurrentInningPlaysTable', 'renderCurrentInningDefensePlays', 'updateFieldTargetDisplay'];
  let legacyDirty = false;
  function deferLegacyPaint(fn) {
    if (!document.body.classList.contains('v2-live-on')) return fn();
    const saved = {};
    for (const name of LEGACY_PAINTERS) {
      if (typeof window[name] !== 'function') continue;
      saved[name] = window[name];
      window[name] = function () { legacyDirty = true; };
    }
    try { return fn(); } finally { for (const name in saved) window[name] = saved[name]; }
  }
  function repaintLegacy() {
    if (!legacyDirty) return;
    legacyDirty = false;
    try { if (typeof window.renderLiveScorer === 'function') window.renderLiveScorer(); } catch (error) { console.warn('[ui-v2] legacy repaint', error); }
  }
  // CP-20：本機存不進去時，舊版 storeLocal 會跳「本機暫存失敗」，有些地方直接 localStorage.setItem 會丟 QuotaExceededError。
  // 兩種都不當成「沒記到」：紀錄已在畫面上的比賽裡，只提示空間滿、請先上傳本局，流程照走（不中斷）。
  const STORAGE_FULL = /本機暫存失敗/;
  const isQuota = error => !!error && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014 || /quota/i.test(String(error.message || '')));
  function quiet(fn) {
    const original = window.showToast;
    const messages = [];
    window.showToast = (message, type = 'info') => { messages.push({message: String(message), type}); };
    let result;
    try { result = deferLegacyPaint(fn); } catch (error) { if (!isQuota(error)) throw error; messages.push({message: '本機暫存失敗', type: 'error'}); } finally { window.showToast = original; }
    if (messages.some(m => STORAGE_FULL.test(m.message))) storageFull();
    const error = messages.find(m => (m.type === 'error' || /失敗|錯誤/.test(m.message)) && !STORAGE_FULL.test(m.message));
    return {result, messages, error: error ? error.message : ''};
  }
  // 上傳本局、結束並同步是非同步的：期間舊版的 toast（「正在同步…」「同步失敗…」）改由新版的膠囊、sheet 表達，先收進 sink。
  // 用一層常駐的轉接，重疊的兩次上傳各收各的，不會互相把 showToast 換錯。
  const sinks = [];
  let realToast = null;
  function captureToasts(fn) {
    const sink = [];
    if (!realToast && typeof window.showToast === 'function') {
      realToast = window.showToast;
      window.showToast = function (message, type) {
        if (sinks.length) { sinks[sinks.length - 1].push({message: String(message), type: type || 'info'}); return; }
        return realToast.apply(this, arguments);
      };
    }
    sinks.push(sink);
    let promise;
    try { promise = Promise.resolve(fn()); } catch (error) { promise = Promise.reject(error); }
    return promise.catch(error => { console.warn('[ui-v2] upload', error); }).then(() => {
      const i = sinks.indexOf(sink); if (i >= 0) sinks.splice(i, 1);
      if (sink.some(m => STORAGE_FULL.test(m.message))) storageFull();
      return sink;
    });
  }
  const toast = (message, type) => (realToast || window.showToast)(message, type);
  // 舊版在這幾個地方用瀏覽器原生 confirm()。新版先用自己的 sheet 問過（或依規則不必問），再呼叫舊函式時代答。
  function answered(answer, fn) {
    const original = window.confirm;
    window.confirm = () => answer;
    try { return fn(); } finally { window.confirm = original; }
  }
  // PO-31：左右開弓打者在新版不選邊也能送出、紀錄不寫 battingSide。舊版 9730 的檢查讀 PlayerHealthStore.data()[name].bats，
  // 這裡只在這一次送出期間，讓這位打者讀起來不是 'S'；健康資料本身不動。
  function withoutSwitchCheck(name, fn) {
    const store = window.PlayerHealthStore;
    const data = store && store.data && store.data();
    if (!data || !data[name] || data[name].bats !== 'S') return fn();
    const original = store.data;
    store.data = function () { const all = original.apply(this, arguments); return {...all, [name]: {...all[name], bats: ''}}; };
    try { return fn(); } finally { store.data = original; }
  }

  // ---------- 版面 ----------
  const root = document.createElement('div');
  root.className = 'v2-live';
  root.setAttribute('data-sb-v2', '');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '新版場記');
  root.hidden = true;
  root.innerHTML = '<header class="v2l-head"></header><section class="v2l-board" data-v2-board aria-live="polite"></section>'
    + '<div class="v2l-main"><div class="v2l-card"></div><ol class="v2l-recent" aria-label="本半局"></ol><div class="v2l-field" aria-hidden="true"></div></div>'
    + '<div class="v2l-padwrap"></div>'
    + '<div class="v2l-snack" role="status" aria-live="assertive" hidden></div>'
    + '<div class="v2l-warnbar" role="alert" hidden><p>這台裝置的儲存空間滿了，紀錄可能沒存進本機。請先上傳本局。</p><button type="button" data-act="upload">上傳本局</button></div>'
    + '<div class="v2l-lock" role="status" aria-live="polite" hidden><div class="v2l-lockbox"><span class="v2l-spin" aria-hidden="true"></span><p>日誌同步中…<small>完成後直接打開覆盤</small></p></div></div>'
    + '<div class="v2l-setup" hidden></div>'
    + '<div class="v2l-layer" hidden><div class="v2l-scrim" data-act="close"></div><div class="v2l-sheet" role="dialog" aria-modal="true"></div></div>';
  document.body.append(root);
  const $ = sel => root.querySelector(sel);
  const els = {head: $('.v2l-head'), board: $('.v2l-board'), card: $('.v2l-card'), recent: $('.v2l-recent'), field: $('.v2l-field'),
    pad: $('.v2l-padwrap'), snack: $('.v2l-snack'), layer: $('.v2l-layer'), sheet: $('.v2l-sheet'),
    warn: $('.v2l-warnbar'), lock: $('.v2l-lock'), setup: $('.v2l-setup')};
  try { if (localStorage.getItem(HC_KEY) === '1') root.classList.add('hc'); } catch (error) { /* 沒有儲存空間：預設關 */ }

  // ---------- 球場（和舊版同一套 400×400 座標；落點存成 0–1，toFixed(3)） ----------
  // 守位判斷照抄 index.html detectPositionFromCoords（9453）。
  function zoneAt(x, y) {
    if (y > 340) return 'C';
    if (y > 230 && y <= 340 && x >= 160 && x <= 240) return 'P';
    if (y > 230 && y <= 340 && x > 240) return '1B';
    if (y > 230 && y <= 340 && x < 160) return '3B';
    if (y >= 180 && y <= 230 && x >= 200) return '2B';
    if (y >= 180 && y <= 230 && x < 200) return 'SS';
    if (y < 180) { if (x < 120) return 'LF'; if (x < 200) return 'SF'; if (x < 280) return 'RC'; return 'RF'; }
    return 'SS';
  }
  const LABELS = [['C', 200, 392], ['P', 200, 308], ['1B', 300, 292], ['2B', 246, 214], ['3B', 100, 292], ['SS', 154, 214],
    ['LF', 85, 168], ['SF', 155, 118], ['RC', 245, 118], ['RF', 315, 168]];
  function fieldSvg(dots, interactive) {
    const dotMarks = dots.map(d => `<circle class="v2f-dot tone-${d.tone}" cx="${(d.x * 400).toFixed(1)}" cy="${(d.y * 400).toFixed(1)}" r="7"/>`).join('');
    return `<svg class="v2f${interactive ? ' v2f-pick' : ''}" viewBox="0 40 400 352" preserveAspectRatio="xMidYMid meet"${interactive ? ' data-v2-field role="img" aria-label="球場，點一下標落點"' : ''}>`
      + '<path class="v2f-grass" d="M 4.1 174.1 A 215 215 0 0 1 395.9 174.1 L 200 370 Z"/>'
      + '<path class="v2f-dirt" d="M 93.9 263.9 A 107.8 107.8 0 0 1 306.1 263.9 L 200 370 Z"/>'
      + '<line class="v2f-line" x1="200" y1="370" x2="4.1" y2="174.1"/><line class="v2f-line" x1="200" y1="370" x2="395.9" y2="174.1"/>'
      + '<polygon class="v2f-diamond" points="200,370 282.5,287.5 200,205 117.5,287.5"/>'
      + LABELS.map(([k, x, y]) => `<text class="v2f-label" x="${x}" y="${y}" text-anchor="middle">${k}</text>`).join('')
      + dotMarks
      + (interactive ? '<g class="v2f-mark" hidden><line x1="-22" y1="0" x2="22" y2="0"/><line x1="0" y1="-22" x2="0" y2="22"/><circle r="13"/></g>' : '')
      + '</svg>';
  }

  // ---------- 狀態（只有畫面狀態；比賽資料都在 activeGame） ----------
  const ui = {
    sheet: null,        // 目前打開的 sheet 名稱
    pa: null,           // 打席 sheet 暫存 {code, pos, x, y, traj, trajPicked, runs}
    rec: null,          // 全部紀錄裡正在看的一筆
    sub: null,          // 換人：選好的棒次
    snack: null,        // {text, tone, undo}
    snackTimer: 0,
    flashTimer: 0,
    busyUntil: 0,       // 防連點（400 ms，CP-18）
    syncing: 0,         // 上傳中的數量
    syncGen: 0,         // 每次上傳 +1；6 秒復原只在還沒上傳時可按
    downAt: 0,          // 最近一次 pointerdown 的 event.timeStamp（量測用）
    sheetAt: 0,
    // B4
    ending: false,      // 結束並同步上傳中（A7：鎖住記分區，顯示「日誌同步中」）
    failed: '',         // 上一次上傳沒成功：'upload'｜'end'｜'end-offline'（膠囊轉紅，sheet 說明＋重試）
    storageFull: false, // 本機存不進去（CP-20）：不中斷，頁首下方一條提示＋上傳本局
    update: false,      // 有新版在等（記分中不跳更新，只在 ⋯ 標記）
    setup: null,        // 開賽設定的暫存 {date, opponent, tag, role, dh, lineup, pos, from, touched, error}
    pick: -1            // 開賽設定：正在選第幾棒
  };
  // v1：pointerdown→按下狀態畫出；v2：放開（click，紀錄成立）→比分板閃色畫出；v2Down：同一筆從 pointerdown 起算（含手指停留時間，只供參考）。
  const probe = PROBE ? (window.__v2fb = {v1: [], v2: [], v2Down: []}) : null;
  const afterTwoFrames = fn => requestAnimationFrame(() => requestAnimationFrame(fn));

  // ---------- 繪製 ----------
  // ---------- 同步膠囊（B4；D14：每種狀態都有文字或形狀，不只靠顏色） ----------
  // 已同步＝雲端最後一次確認的這場（舊版 cloudBase，上傳成功才更新）和這台裝置的一樣。待上傳 N＝不一樣的紀錄筆數
  // （打席＋防守事件；只改了換局、換投等非紀錄欄位時只寫「待上傳」）。只讀，不寫任何東西。
  const epoch = () => { try { return writeEpoch[GAMES_FILE_PATH] || 0; } catch (error) { return 0; } };
  let cloudMemo = {json: null, map: null};
  function cloudCopy(id) {
    let entry = null;
    try { entry = cloudBase[GAMES_FILE_PATH]; } catch (error) { return null; }
    if (!entry || typeof entry.json !== 'string') return null;
    if (cloudMemo.json !== entry.json) {
      let list = [];
      try { list = JSON.parse(entry.json); } catch (error) { list = []; }
      cloudMemo = {json: entry.json, map: new Map((Array.isArray(list) ? list : []).filter(Boolean).map(x => [x.id, {game: x, text: JSON.stringify(x)}]))};
    }
    return cloudMemo.map.get(id) || null;
  }
  function recordKeys(g) {
    const out = [];
    for (const inn of g.innings || []) {
      const at = `${inn.inningNum}${inn.topBottom}`;
      for (const p of inn.plateAppearances || []) out.push(`${at}p${JSON.stringify(p)}`);
      for (const e of inn.defensiveEvents || []) out.push(`${at}d${JSON.stringify(e)}`);
    }
    return out;
  }
  function unsent(g) {
    const cloud = cloudCopy(g.id);
    if (cloud && cloud.text === JSON.stringify(g)) return 0;
    const left = new Map();
    for (const key of cloud ? recordKeys(cloud.game) : []) left.set(key, (left.get(key) || 0) + 1);
    let n = 0;
    for (const key of recordKeys(g)) { const c = left.get(key); if (c) left.set(key, c - 1); else n += 1; }
    for (const c of left.values()) n += c;
    return n || -1; // -1：有差異，但不是紀錄本身
  }
  const writing = () => ui.syncing > 0 || (typeof gamesWritesInFlight !== 'undefined' && gamesWritesInFlight > 0);
  function syncState(g) {
    if (writing()) return {key: 'busy', text: '上傳中', label: '上傳中'};
    if (navigator.onLine === false) return {key: 'off', text: '離線', label: '離線：紀錄先存在這台裝置'};
    if (ui.failed) return {key: 'fail', text: '重試', label: '上傳失敗，按一下看說明並重試'};
    const n = unsent(g);
    if (!n) { return {key: 'ok', text: '已同步', label: '已同步：雲端和這台裝置一樣'}; }
    return {key: 'pend', text: n > 0 ? `待上傳 ${n}` : '待上傳', label: n > 0 ? `${n} 筆紀錄還沒上傳` : '有變更還沒上傳'};
  }
  const CAPSULE_ICON = {
    ok: '<i class="v2c-dot" aria-hidden="true"></i>',
    pend: '<i class="v2c-dot" aria-hidden="true"></i>',
    busy: '<i class="v2c-spin" aria-hidden="true"></i>',
    off: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2l12 12M5.5 8.5a4 4 0 0 1 5 0M3 6a7.5 7.5 0 0 1 3-1.7M10.5 4.4A7.5 7.5 0 0 1 13 6M8 12h0"/></svg>',
    fail: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v6M8 12.5h0"/></svg>'
  };
  function capsule(g) {
    const s = syncState(g);
    return `<button type="button" class="v2l-cap v2c-${s.key}" data-act="sync" data-v2-cap="${s.key}" aria-label="${esc(s.label)}"${s.key === 'busy' ? ' aria-disabled="true"' : ''}>${CAPSULE_ICON[s.key]}<span>${esc(s.text)}</span></button>`;
  }
  // 有新版在等：舊版 pwa.js 的「新版本已完整下載」提示條，或 service worker 已有 waiting。記分中不跳，只在 ⋯ 加小圓點。
  const hasUpdate = () => !!document.getElementById('uiUpdateBar') || !!(window.__pwaRegistration && window.__pwaRegistration.waiting);
  function renderHead(g) {
    ui.update = hasUpdate();
    els.head.innerHTML = '<button type="button" class="v2l-icon" data-act="leave" aria-label="離開場記（比賽保留）">‹</button>'
      + `<p class="v2l-vs"><span class="v2-nb">淡江航太</span> <span class="v2l-vs-sep">vs</span> <span class="v2-nb">${esc(g.opponent || '對手')}</span></p>`
      + capsule(g)
      + `<button type="button" class="v2l-icon v2l-more" data-act="menu" aria-label="${ui.update ? '更多操作（有新版）' : '更多操作'}" aria-haspopup="dialog">⋯${ui.update ? '<i class="v2l-newdot" data-v2-update aria-hidden="true"></i>' : ''}</button>`;
  }
  function renderBoard(g) {
    const bat = weBat(g);
    const outs = Math.min(3, g.currentOuts || 0);
    const b = g.currentBases || {};
    const baseNames = [['first', '一壘'], ['second', '二壘'], ['third', '三壘']].filter(([k]) => b[k]).map(([, n]) => n);
    const lights = [1, 2, 3].map(i => `<i class="v2l-out${i <= outs ? ' on' : ''}"></i>`).join('');
    els.board.innerHTML = `<div class="v2l-inn"><b>${esc(g.currentInning)}</b><span>局${g.currentHalf === 'top' ? '上' : '下'}</span><small>${bat ? '進攻' : '防守'}</small></div>`
      + `<div class="v2l-score"><span class="v2l-team">航太</span><b data-v2-us>${esc(g.finalScore?.us ?? 0)}</b><i>:</i><b data-v2-opp>${esc(g.finalScore?.opp ?? 0)}</b><span class="v2l-team">${esc(g.opponent || '對手')}</span></div>`
      + `<button type="button" class="v2l-sit" data-act="sit" aria-label="出局與壘包：${outs} 出局，${baseNames.length ? baseNames.join('、') + '有人' : '壘上無人'}">`
      + `<svg class="v2l-mini" viewBox="0 0 40 40" aria-hidden="true"><rect class="${b.second ? 'on' : ''}" x="15" y="3" width="10" height="10" transform="rotate(45 20 8)"/>`
      + `<rect class="${b.third ? 'on' : ''}" x="4" y="15" width="10" height="10" transform="rotate(45 9 20)"/><rect class="${b.first ? 'on' : ''}" x="26" y="15" width="10" height="10" transform="rotate(45 31 20)"/></svg>`
      + `<span class="v2l-lights">${lights}</span><span class="v2l-sit-txt">${outs} 出局</span></button>`;
  }
  function renderCard(g) {
    const bat = weBat(g);
    if (bat) {
      const n = (g.lineup || []).length || 1;
      const idx = (g.currentBatterIdx || 0) % n;
      const name = g.lineup[idx];
      const pos = positions(g)[idx] || '';
      const next = g.lineup[(idx + 1) % n];
      els.card.innerHTML = `<p class="v2l-card-k">第 ${idx + 1} 棒${pos ? ` · ${esc(pos)}` : ''}</p><p class="v2l-card-name">${esc(jersey(name))}${esc(name)}</p>`
        + `<p class="v2l-card-next">下一棒 <span class="v2-nb">${esc(next || '')}</span></p>`;
    } else {
      els.card.innerHTML = `<p class="v2l-card-k">登板投手</p><p class="v2l-card-name">${g.pitcherName ? esc(jersey(g.pitcherName)) + esc(g.pitcherName) : '還沒選投手'}</p>`
        + '<p class="v2l-card-next">換投在記分盤右下</p>';
    }
  }
  function halfRows(g, inn, bat) {
    if (!inn) return [];
    if (bat) return (inn.plateAppearances || []).map(p => ({tone: RESULT_TONE[p.isRunnerOut ? 'RO' : p.result] || 'on', label: RESULT_NAME[p.isRunnerOut ? 'RO' : p.result] || p.result, who: p.batterName, runs: p.runsScored || 0}));
    return (inn.defensiveEvents || []).map(e => ({tone: RESULT_TONE[e.type] || 'on', label: e.type === 'RUN' ? `失 ${e.runs} 分` : (DEF_NAME[e.type] || e.type), who: e.pitcher, runs: 0}));
  }
  function renderRecent(g) {
    const bat = weBat(g);
    const rows = halfRows(g, curHalf(g), bat);
    const phone = window.innerWidth < 768;
    const max = phone ? Math.max(1, Math.min(6, Math.floor((window.innerHeight - 560) / 48))) : 8;
    const shown = rows.slice(-max).reverse();
    els.recent.innerHTML = shown.length
      ? shown.map(r => `<li><span class="v2l-tag tone-${r.tone}">${esc(r.label)}</span><span class="v2l-who">${esc(r.who || '')}</span>${r.runs ? `<span class="v2l-runs">+${r.runs} 分</span>` : ''}</li>`).join('')
      : `<li class="v2l-empty">${esc(halfLabel(g.currentInning, g.currentHalf))}還沒有紀錄</li>`;
  }
  function renderField(g) {
    const inn = curHalf(g);
    const dots = weBat(g) && inn ? (inn.plateAppearances || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.trajectory !== 'none' && !isRunnerOutPlay(p))
      .map(p => ({x: p.x, y: p.y, tone: RESULT_TONE[p.result] || 'on'})) : [];
    els.field.innerHTML = fieldSvg(dots, false);
  }
  function renderPad(g) {
    const bat = weBat(g);
    const over = (g.currentOuts || 0) >= 3;
    if (over) {
      const inn = curHalf(g);
      const runs = inn ? inn.runs || 0 : 0;
      const nh = nextHalf(g);
      const nextBat = isInningOurBat(g.ourRole, nh.half);
      els.pad.innerHTML = '<div class="v2l-three tone-out" role="group" aria-label="三出局">'
        + `<p class="v2l-three-t">三出局 · 本半局 ${runs} 分</p>`
        // 防守半局：得分可能晚於第三個出局才登打，舊版 recordDefenseEvent 允許 3 出局後補記失分，這裡也留兩個鍵。
        + (bat ? '' : '<div class="v2l-three-row v2l-three-runs">' + DEF_PAD.filter(d => d[3] === 'RUN').map(([code, big]) =>
          `<button type="button" class="tone-run" data-act="def" data-code="${esc(code)}" data-v2-fb data-v2-hap>補記${esc(big)}</button>`).join('') + '</div>')
        + `<button type="button" class="v2l-big" data-act="inning" data-v2-fb data-v2-hap>換到 ${esc(halfLabel(nh.num, nh.half))} · ${nextBat ? '進攻' : '防守'}</button>`
        + `<div class="v2l-three-row"><button type="button" data-act="upload" data-v2-fb data-v2-hap${ui.syncing ? ' disabled' : ''}>上傳本局</button>`
        + '<button type="button" data-act="undo-last" data-v2-fb data-v2-hap>復原上一筆</button>'
        + '<button type="button" data-act="end" data-v2-fb data-v2-hap>結束比賽</button></div></div>';
    } else if (bat) {
      els.pad.innerHTML = '<div class="v2l-pad v2l-pad5" role="group" aria-label="打擊結果">' + OFF_PAD.map(([code, big, small]) =>
        `<button type="button" class="v2l-key tone-${RESULT_TONE[code]}" data-act="off" data-code="${esc(code)}" data-v2-fb data-v2-hap aria-label="${esc(RESULT_NAME[code])}"><b>${esc(big)}</b><small>${esc(small)}</small></button>`).join('') + '</div>';
    } else {
      els.pad.innerHTML = '<div class="v2l-pad v2l-pad4" role="group" aria-label="防守紀錄">' + DEF_PAD.map(([code, big, small]) =>
        `<button type="button" class="v2l-key tone-${RESULT_TONE[code]}" data-act="def" data-code="${esc(code)}" data-v2-fb data-v2-hap><b>${esc(big)}</b><small>${esc(small)}</small></button>`).join('')
        + '<button type="button" class="v2l-key v2l-key-wide tone-white" data-act="pitcher" data-v2-fb><b>換投</b><small>目前 ' + esc(g.pitcherName || '未選') + '</small></button></div>';
    }
    haptics.attach(els.pad);
  }
  function renderSnack() {
    const s = ui.snack;
    if (!s) { els.snack.hidden = true; els.snack.innerHTML = ''; return; }
    els.snack.className = `v2l-snack tone-${s.tone}`;
    els.snack.innerHTML = `<p class="v2l-snack-t">${esc(s.text)}</p>`
      + (s.undo ? '<button type="button" class="v2l-undo" data-act="snack-undo" data-v2-fb data-v2-hap>復原</button>' : '')
      + (s.undo ? (reducedMotion.matches ? '<span class="v2l-drain-txt">6 秒內可復原</span>' : '<span class="v2l-drain" aria-hidden="true"></span>') : '');
    els.snack.hidden = false;
    haptics.attach(els.snack);
  }
  function fitField() {
    // 手機：球場吃掉剩下的高度；小於 150 px 就不顯示（原型規則）。
    const h = els.field.getBoundingClientRect().height;
    els.field.classList.toggle('v2l-tiny', window.innerWidth < 768 && h > 0 && h < 150);
  }

  let shown = false;      // 新版場記（有進行中的比賽）
  let setupShown = false; // 新版開賽設定（場記頁、沒有比賽）
  const LIVE_PARTS = () => [els.head, els.board, els.card.parentElement, els.pad, els.snack, els.warn];
  function render() {
    const g = live();
    const onPage = document.body.dataset.page === 'Scorebook';
    const want = !!g && onPage;
    // 結束並同步上傳中（舊版成功後才清掉 activeGame 並切到覆盤）不顯示開賽設定，免得閃一下。
    const wantSetup = !g && onPage && !ui.ending && !finalizing();
    document.body.classList.toggle('v2-live-on', want);
    document.body.classList.toggle('v2-setup-on', wantSetup);
    root.hidden = !want && !wantSetup;
    root.classList.toggle('v2l-setupmode', wantSetup);
    if (!want) {
      if (shown) { closeSheet(); setSnack(null); ui.failed = ''; ui.storageFull = false; }
      shown = false;
      repaintLegacy();
    }
    if (wantSetup) { if (!setupShown && ui.sheet) closeSheet(); setupShown = true; renderSetup(); if (ui.sheet) drawSheet(); return; }
    if (setupShown) { setupShown = false; if (ui.sheet && SETUP_SHEETS.has(ui.sheet)) closeSheet(); els.setup.hidden = true; els.setup.innerHTML = ''; }
    if (!want) return;
    shown = true;
    els.setup.hidden = true;
    root.classList.toggle('v2l-bat', weBat(g));
    root.classList.toggle('v2l-def', !weBat(g));
    renderHead(g); renderBoard(g); renderCard(g); renderRecent(g); renderField(g); renderPad(g); renderSnack();
    // A7：結束並同步上傳中照舊版鎖住（記分盤、頁首按鈕、清單都不能點），顯示「日誌同步中」。
    const locked = ui.ending || finalizing();
    root.classList.toggle('v2l-locked', locked);
    for (const part of LIVE_PARTS()) part.inert = locked;
    els.lock.hidden = !locked;
    els.warn.hidden = !ui.storageFull;
    root.classList.toggle('v2l-warning', ui.storageFull);
    els.field.classList.remove('v2l-tiny');
    requestAnimationFrame(fitField);
    if (ui.sheet) drawSheet();
  }
  function storageFull() {
    if (ui.storageFull) return;
    ui.storageFull = true;
    if (shown) { els.warn.hidden = false; root.classList.add('v2l-warning'); haptics.fire('error'); }
  }

  // ---------- 回饋（PO-40 §0b） ----------
  function flash(tone, big) {
    clearTimeout(ui.flashTimer);
    const board = els.board;
    board.classList.remove('v2-flash', 'v2-fade');
    board.dataset.flash = tone;
    board.classList.add('v2-flash');
    if (big) board.dataset.big = big; else delete board.dataset.big;
    if (probe && ui.clickAt) { const t0 = ui.clickAt, d0 = ui.downAt; ui.clickAt = 0; afterTwoFrames(() => { const now = performance.now(); probe.v2.push(now - t0); if (d0) probe.v2Down.push(now - d0); }); }
    // 實色 300 ms（525 ms ÷1.75），再 120 ms 淡回。用 class＋計時器，不靠 CSS animation（減少動態的全域規則不會把它縮成 1 ms）。
    ui.flashTimer = setTimeout(() => {
      board.classList.remove('v2-flash');
      if (reducedMotion.matches) { delete board.dataset.flash; delete board.dataset.big; return; }
      board.classList.add('v2-fade');
      ui.flashTimer = setTimeout(() => { board.classList.remove('v2-fade'); delete board.dataset.flash; delete board.dataset.big; }, 120);
    }, 300);
  }
  function setSnack(snack) {
    clearTimeout(ui.snackTimer);
    ui.snack = snack;
    renderSnack();
    if (snack) ui.snackTimer = setTimeout(() => { ui.snack = null; renderSnack(); }, 6000);
  }
  function fail(reason, button) {
    haptics.fire('error');
    setSnack({text: reason, tone: 'error'});
    if (button) { button.classList.add('v2-err'); setTimeout(() => button.classList.remove('v2-err'), 1200); }
  }
  function done(kind, tone, text, undo, big) {
    haptics.fire(kind);
    render();
    flash(tone, big);
    setSnack({text, tone, undo});
  }
  const busy = () => performance.now() < ui.busyUntil;
  const hold = () => { ui.busyUntil = performance.now() + 400; };

  // ---------- 記錄：進攻 ----------
  function trajDefault(code, pos) {
    if (TRAJ_RULES[code]) return TRAJ_RULES[code][0];
    if (!pos || INFIELD.includes(pos)) return 'grounder';
    return HITS.includes(code) ? 'line' : 'fly';
  }
  function recordOffense(code, pa, button) {
    const g = live();
    if (!g) return;
    const inn = curHalf(g);
    const before = inn ? (inn.plateAppearances || []).length : 0;
    const outsBefore = g.currentOuts || 0;
    const batter = g.lineup[g.currentBatterIdx];
    const run = quiet(() => {
      if (code === 'K' || code === '界外K') return recordQuickStrikeout(code);
      if (code === 'BB') return recordQuickWalk();
      if (code === 'RO') return recordRunnerOut();
      // 沒標落點的安打：先清掉上一打席留下的預設落點（2B），讓舊版 selectOutcome 套它自己的安打預設落點。
      if (!pa.pos && HITS.includes(code)) window.currentPlayInput.location = '';
      selectOutcome(code);
      const input = window.currentPlayInput;
      if (pa.pos) { input.location = pa.pos; input.x = pa.x; input.y = pa.y; }
      selectTrajectory(pa.traj);
      selectRunsScored(pa.runs || 0);
      return withoutSwitchCheck(batter, () => submitBattedBallPlay());
    });
    const after = curHalf(g);
    const list = after ? after.plateAppearances || [] : [];
    if (list.length <= before) { fail(run.error || '沒有記到，請再試一次', button); return false; }
    hold();
    const record = list[list.length - 1];
    const tone = RESULT_TONE[code];
    const third = outsBefore < 3 && (g.currentOuts || 0) >= 3;
    const kind = third ? 'inning' : tone === 'out' ? 'out' : 'record';
    const text = `${RESULT_NAME[code]} · ${batter}${record.runsScored ? ` · +${record.runsScored} 分` : ''}`;
    done(kind, tone, text, {kind: 'pa', record, label: RESULT_NAME[code]}, third ? '三出局' : '');
    return true;
  }

  // ---------- 記錄：防守 ----------
  function recordDefense(code, button) {
    const g = live();
    if (!g) return;
    const def = DEF_PAD.find(d => d[0] === code);
    const inn = curHalf(g);
    const before = inn ? (inn.defensiveEvents || []).length : 0;
    const outsBefore = g.currentOuts || 0;
    const run = quiet(() => recordDefenseEvent(def[3], def[4]));
    const after = curHalf(g);
    const list = after ? after.defensiveEvents || [] : [];
    if (list.length <= before) { fail(run.error ? (/投手/.test(run.error) ? '先選登板投手（記分盤右下「換投」）' : run.error) : '沒有記到，請再試一次', button); return false; }
    hold();
    const event = list[list.length - 1];
    const tone = RESULT_TONE[code];
    const third = outsBefore < 3 && (g.currentOuts || 0) >= 3;
    const label = def[4] ? `失 ${def[4]} 分` : DEF_NAME[def[3]];
    done(third ? 'inning' : tone === 'out' ? 'out' : 'record', tone, `${label} · ${g.pitcherName || ''}`, {kind: 'def', event, label}, third ? '三出局' : '');
    return true;
  }

  // ---------- 復原 ----------
  function findRecord(g, kind, ref) {
    for (const inn of g.innings || []) {
      const list = kind === 'pa' ? inn.plateAppearances || [] : inn.defensiveEvents || [];
      const index = list.indexOf(ref);
      if (index >= 0) return {inn, list, index};
    }
    return null;
  }
  // 刪除一筆：目前半局走舊版的 deleteInningPlay／deleteDefenseEvent（跑者回原壘、最新打者重新上場，SB-55a）；
  // 前面半局（總監 D2：不鎖）照同樣的算法扣分數、安打、重算該半局出局，但不動目前的出局、壘包、打序。
  function removeRecord(kind, ref) {
    const g = live();
    if (!g) return false;
    const at = findRecord(g, kind, ref);
    if (!at) return false;
    const current = at.inn === curHalf(g);
    if (current) {
      quiet(() => kind === 'pa' ? deleteInningPlay(at.index) : deleteDefenseEvent(ref.id));
      return !findRecord(g, kind, ref);
    }
    at.list.splice(at.index, 1);
    const runs = kind === 'pa' ? ref.runsScored || 0 : ref.runs || 0;
    at.inn.runs = Math.max(0, (at.inn.runs || 0) - runs);
    if (kind === 'pa' ? HITS.includes(ref.result) : ref.type === 'HIT') at.inn.hits = Math.max(0, (at.inn.hits || 0) - 1);
    if (kind === 'pa') g.finalScore.us = Math.max(0, g.finalScore.us - runs);
    else g.finalScore.opp = Math.max(0, g.finalScore.opp - runs);
    recountHalfOuts(at.list);
    saveGame(g);
    quiet(() => renderLiveScorer());
    return true;
  }
  function undoLast(button) {
    const g = live();
    if (!g) return;
    const inn = curHalf(g);
    const bat = weBat(g);
    const list = inn ? (bat ? inn.plateAppearances : inn.defensiveEvents) || [] : [];
    if (!list.length) { fail('本半局還沒有紀錄可以復原', button); return; }
    const ref = list[list.length - 1];
    const label = bat ? RESULT_NAME[ref.isRunnerOut ? 'RO' : ref.result] : (ref.type === 'RUN' ? `失 ${ref.runs} 分` : DEF_NAME[ref.type]);
    undoRecord({kind: bat ? 'pa' : 'def', record: bat ? ref : undefined, event: bat ? undefined : ref, label}, button);
  }
  function undoRecord(undo, button) {
    const ok = removeRecord(undo.kind, undo.kind === 'pa' ? undo.record : undo.event);
    if (!ok) { fail('這一筆已經不在了', button); return; }
    hold();
    done('undo', 'neutral', `已復原：${undo.label}`, null, `已復原：${undo.label}`);
  }
  // 換投、換局：做完 6 秒內、還沒上傳前可以復原（PO-37 B）。把動作前一刻的比賽原地放回同一個物件。
  function snapshotUndo(label) {
    const g = live();
    return {kind: 'snap', json: JSON.stringify(g), gen: ui.syncGen, at: performance.now(), label};
  }
  function restoreSnapshot(undo, button) {
    const g = live();
    if (!g || ui.syncGen !== undo.gen || ui.syncing || performance.now() - undo.at > 6000) { fail('已經上傳或超過 6 秒，不能復原；請到「全部紀錄」修改', button); return; }
    const before = JSON.parse(undo.json);
    Object.keys(g).forEach(key => { delete g[key]; });
    Object.assign(g, before);
    window.activeGame = g;
    saveGame(g);
    quiet(() => renderLiveScorer());
    hold();
    done('undo', 'neutral', `已復原：${undo.label}`, null, `已復原：${undo.label}`);
  }

  // ---------- 換局、換投、換人、DH ----------
  function changeInning(button) {
    const g = live();
    if (!g) return;
    const undo = snapshotUndo('換局');
    const nh = nextHalf(g);
    quiet(() => switchInningNext());
    if (g.currentInning !== nh.num || g.currentHalf !== nh.half) { fail('沒有換成，請再試一次', button); return; }
    hold();
    closeSheet();
    const text = `${halfLabel(nh.num, nh.half)} · ${weBat(g) ? '進攻' : '防守'}`;
    done('inning', 'white', text, undo, halfLabel(nh.num, nh.half));
  }
  // 舊版 changeDefensePitcher（9074-9079）的確認條件：已有投手、換別人、目前半局已有守備紀錄。
  function pitcherNeedsConfirm(g, name) {
    const inn = curHalf(g);
    return !!(g.pitcherName && name !== g.pitcherName && (inn?.defensiveEvents || []).length);
  }
  function changePitcher(name, button) {
    const g = live();
    if (!g || !name || name === g.pitcherName) { closeSheet(); return; }
    const undo = snapshotUndo(`換投（${g.pitcherName || '未選'}）`);
    const inLineup = (g.lineup || []).includes(name);
    quiet(() => answered(true, () => {
      changeDefensePitcher(name);
      if (!inLineup) {
        // 場下或外援投手：舊版開 modal 讓人選「換掉哪一棒」。預設跟舊版一樣換掉原投手那一棒；原投手不在打線上就只換投。
        const replace = document.getElementById('pitcherModeReplace');
        const only = document.querySelector('input[name="pitcherLineupMode"]:not(#pitcherModeReplace)');
        const slot = document.getElementById('pitcherReplaceSlotSelect');
        const select = document.getElementById('modalNewPitcherSelect');
        if (select) select.value = name;
        const prev = (g.lineup || []).indexOf(g.pitcherName);
        if (prev >= 0 && replace && slot) { replace.checked = true; slot.value = String(prev); } else if (only) { only.checked = true; if (replace) replace.checked = false; }
        confirmPitcherChange();
      }
    }));
    const modal = document.getElementById('pitcherChangeModal');
    if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
    if (g.pitcherName !== name) { fail('沒有換成，請再試一次', button); return; }
    hold();
    closeSheet();
    done('record', 'white', `換投 · ${name}`, undo, '換投');
  }
  function substitute(index, name, button) {
    const g = live();
    if (!g) return;
    quiet(() => {
      openSubstituteModal(index);
      const select = document.getElementById('substituteNewPlayerSelect');
      if (select) select.value = name;
      confirmSubstitution();
    });
    const modal = document.getElementById('substituteModal');
    if (modal && !modal.classList.contains('hidden')) closeSubstituteModal();
    if (g.lineup[index] !== name) { fail('沒有換成，請再試一次', button); return; }
    hold();
    closeSheet();
    done('record', 'white', `第 ${index + 1} 棒換成 ${name}`, null, '換人');
  }
  function toggleDh(button) {
    const g = live();
    if (!g) return;
    const before = !!g.hasDh;
    quiet(() => answered(true, () => toggleActiveGameDh()));
    if (!!g.hasDh === before) { fail('沒有切換成功', button); return; }
    hold();
    closeSheet();
    done('record', 'white', g.hasDh ? '改用 DH 制' : '取消 DH 制', null, 'DH');
  }
  // PO-38：出局 ± 只改 currentOuts，不是新紀錄、不改任何一筆的 outsAdded。
  function adjustOuts(delta, button) {
    const g = live();
    if (!g) return;
    const next = Math.max(0, Math.min(3, (g.currentOuts || 0) + delta));
    if (next === (g.currentOuts || 0)) { fail(delta > 0 ? '已經 3 出局' : '已經 0 出局', button); return false; }
    g.currentOuts = next;
    saveGame(g);
    quiet(() => updateBasesAndOutsDisplay());
    done(next >= 3 ? 'inning' : 'record', 'white', `出局數改成 ${next}`, null, `${next} 出局`);
    return true;
  }
  function toggleBase(key, button) {
    const g = live();
    if (!g) return;
    const before = g.currentBases?.[key] || null;
    quiet(() => toggleBaseRunner(key));
    if ((g.currentBases?.[key] || null) === before) { fail('沒有切換成功', button); return false; }
    const name = {first: '一壘', second: '二壘', third: '三壘'}[key];
    done('record', 'white', `${name}${g.currentBases[key] ? '有人' : '無人'}`, null, '');
    return true;
  }

  // ---------- 全部紀錄：改結果 ----------
  function paDesc(p) { // 和 submitBattedBallPlay（9737-9746）同一套句子
    const name = p.batterName;
    if (p.result === 'K') return `${name} 揮棒落空遭三振 (+1 出局)`;
    if (p.result === '界外K') return `${name} 兩好球後擊出界外球，界外三振出局 (+1 出局)`;
    if (p.result === 'BB') return `${name} 選到四壞球保送上壘`;
    if (p.result === 'HR') return `${name} 掃出中外野強勁大號全壘打！(+${p.runsScored} 分)`;
    if (p.result === '1H') return `${name} 擊出 ${p.location} 方向一壘安打`;
    if (p.result === '2H') return `${name} 掃出 ${p.location} 平飛二壘安打`;
    if (p.result === '3H') return `${name} 擊出深遠三壘安打`;
    if (p.result === 'DP') return `${name} 擊出雙殺打 (+2 出局)`;
    if (p.result === 'FC') return `${name} 野手選擇上壘，壘上跑者出局 (+1 出局)`;
    return `${name} 擊出 ${p.location} 方向 ${p.result}`;
  }
  const DEF_DESC = {GO: '內野滾地刺殺 (+1 出局)', FO: '外野高飛/平飛接殺 (+1 出局)', K: '投手送出漂亮三振 K！(+1 出局)', '界外K': '投手好投逼出對手界外三振 (+1 出局)',
    DP: '內野俐落雙殺 DP！(+2 出局)', RUNNER_OUT: '我方守備觸殺/刺殺對方跑壘者出局 (+1 出局)', BB: '投手投出四壞保送', HIT: '被擊出安打'};
  const HIT_SPOT = {'1H': ['2B', 240, 220], '2H': ['LF', 85, 165], '3H': ['RC', 245, 115], HR: ['SF', 155, 115]}; // selectOutcome 的自動落點
  function editRecord(kind, ref, code, button) {
    const g = live();
    if (!g) return;
    const at = findRecord(g, kind, ref);
    if (!at) { fail('這一筆已經不在了', button); return; }
    const old = kind === 'pa' ? ref.result : ref.type;
    if (old === code) { closeSheet(); return; }
    if (kind === 'pa') {
      ref.result = code;
      if (code === 'K' || code === '界外K' || code === 'BB') { ref.trajectory = 'none'; ref.location = 'C'; ref.x = 0.5; ref.y = 0.93; }
      else {
        const rule = TRAJ_RULES[code];
        if (!ref.trajectory || ref.trajectory === 'none' || (rule && !rule.includes(ref.trajectory))) ref.trajectory = trajDefault(code, ref.location);
        if (HITS.includes(code) && (!ref.location || ref.location === 'C' || ref.location === 'Bases')) {
          const [pos, x, y] = HIT_SPOT[code];
          ref.location = pos; ref.x = parseFloat((x / 400).toFixed(3)); ref.y = parseFloat((y / 400).toFixed(3));
        }
      }
      ref.outsAdded = outsFor(code);
      ref.desc = paDesc(ref);
      at.inn.hits = (at.inn.plateAppearances || []).filter(p => HITS.includes(p.result)).length;
    } else {
      ref.type = code;
      ref.outsAdded = DEF_OUTS(code);
      ref.desc = DEF_DESC[code] || ref.desc;
      at.inn.hits = (at.inn.defensiveEvents || []).filter(e => e.type === 'HIT').length;
    }
    const outs = recountHalfOuts(at.list);
    if (at.inn === curHalf(g)) g.currentOuts = outs;
    saveGame(g);
    quiet(() => renderLiveScorer());
    hold();
    closeSheet();
    const name = kind === 'pa' ? RESULT_NAME[code] : DEF_NAME[code];
    done(RESULT_TONE[code] === 'out' ? 'out' : 'record', RESULT_TONE[code] || 'on', `改成 ${name}`, null, '');
  }

  // ---------- 上傳、結束、清除、離開 ----------
  // 語意照舊（B4）：只在按「上傳本局」「結束並同步」時呼叫舊版的同一個函式寫雲端；新版只負責顯示結果。
  // 上傳成功與否看舊版的 writeEpoch（PUT 成功才 +1），不另外判斷。
  function upload() {
    const g = live();
    if (!g || ui.syncing || ui.ending) return;
    const before = epoch();
    ui.syncing += 1; ui.syncGen += 1; ui.failed = '';
    render();
    haptics.fire('record');
    captureToasts(() => syncCurrentInningToCloud()).then(() => {
      ui.syncing -= 1;
      const ok = epoch() > before;
      if (ok) ui.storageFull = false;
      else if (navigator.onLine === false) setSnack({text: '離線中：連線後再按上傳本局', tone: 'error'});
      else { ui.failed = 'upload'; if (shown && !ui.sheet) openSheet('fail'); }
      render();
    });
  }
  function endGame() {
    if (!live() || finalizing() || ui.ending) return;
    ui.ending = true; ui.syncing += 1; ui.syncGen += 1; ui.failed = '';
    closeSheet();
    render();
    haptics.fire('record');
    captureToasts(() => answered(true, () => finishActiveGameAndSyncLogs())).then(sink => {
      ui.ending = false; ui.syncing -= 1;
      if (!live()) {
        // 成功：舊版已清掉進行中的比賽並切到覆盤（2 下：結束比賽 → 結束並同步）。舊版的完賽訊息照常顯示。
        const last = sink.filter(m => m.type !== 'error').pop();
        if (last) toast(last.message, last.type);
        render();
        return;
      }
      if (sink.some(m => m.type === 'warning')) setSnack({text: '結束時比賽內容有變動，比賽保持進行中，確認後再按一次結束', tone: 'error'});
      else if (navigator.onLine === false) { ui.failed = 'end-offline'; openSheet('fail'); }
      else { ui.failed = 'end'; openSheet('fail'); }
      render();
    });
  }
  // A8：照現況，確認後立即生效、立即同步（舊版 discardActiveGame 有上傳過才寫雲端），沒有 10 秒復原。
  function clearGame() {
    closeSheet();
    answered(true, () => discardActiveGame());
    ui.failed = ''; ui.storageFull = false;
    render();
  }
  function leave() { closeSheet(); switchMainTab('tabHome'); }

  // ---------- 開賽設定（B4；PO-30a／F2：先發打線預設帶入上一場，沒有上一場就手排，不預設最佳推薦） ----------
  // 只在畫面上暫存；按「開始比賽」時才把欄位與打線交給舊版開賽表單，呼叫同一個 startNewGameFromSetup（檢查、紀錄格式都照舊）。
  const POS_KEYS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'SF', 'RC', 'RF'];
  const POS_SHORT = {...POS_NAME, DH: '指打'};
  const SETUP_SHEETS = new Set(['su-player', 'su-pos']);
  const valueOf = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const today = () => { try { return getTaipeiDateString(); } catch (error) { return new Date().toISOString().slice(0, 10); } };
  function lastGame() {
    const list = typeof allGames !== 'undefined' && Array.isArray(allGames) ? allGames : [];
    const withLineup = list.filter(x => x && Array.isArray(x.startingLineup || x.lineup) && (x.startingLineup || x.lineup).length >= 10);
    // 和舊版覆盤清單同一個順序（日期新到舊、同日期再比 id）。
    withLineup.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));
    return withLineup[0] || null;
  }
  function initSetup() {
    const prev = lastGame();
    const s = {date: valueOf('setup_game_date') || today(), opponent: '', tag: valueOf('setup_game_tag'), role: valueOf('setup_game_role') || '先攻',
      dh: false, lineup: [], pos: [], from: null, touched: false, error: ''};
    if (prev) {
      const names = (prev.startingLineup || prev.lineup).slice();
      s.dh = names.length >= 11 && !!prev.hasDh;
      const size = s.dh ? 11 : 10;
      s.lineup = names.slice(0, size);
      s.pos = normalizeLineupPositions(s.lineup, (prev.startingPositions || prev.lineupPositions || []).slice(0, size), s.dh);
      if (s.pos.every(p => !p)) {
        // 舊紀錄沒存守位：和舊版開賽表單載入打線時一樣（suggestSetupPositions），只替這幾位配守位，不換人、不改棒次。
        try {
          const assigned = matchPositionsForLineup(s.lineup.map(name => ({name})), s.dh, s.dh ? s.lineup[(prev.dhSlot || 4) - 1] : null);
          s.pos = normalizeLineupPositions(s.lineup, s.lineup.map(name => (assigned[name] && assigned[name].posKey) || ''), s.dh);
          s.posGuess = s.pos.some(Boolean);
        } catch (error) { /* 配不出來就手選 */ }
      }
      s.from = {date: prev.date || '', opponent: prev.opponent || ''};
    } else {
      s.dh = typeof isDhEnabled !== 'undefined' ? !!isDhEnabled : false;
      s.lineup = Array(s.dh ? 11 : 10).fill('');
      s.pos = Array(s.dh ? 11 : 10).fill('');
    }
    ui.setup = s;
  }
  const shortDate = d => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${Number(m[1])}/${Number(m[2])}` : (d || ''); };
  function renderSetup() {
    if (!ui.setup || (!ui.setup.touched && !ui.setup.from && lastGame())) initSetup();
    const s = ui.setup;
    const size = s.dh ? 11 : 10;
    const update = hasUpdate();
    const filled = s.lineup.filter(Boolean).length;
    const rows = s.lineup.slice(0, size).map((name, i) => {
      const pos = s.pos[i] || '';
      return `<li class="v2u-row"><b class="v2u-n" aria-hidden="true">${i + 1}</b>`
        + `<button type="button" class="v2u-name${name ? '' : ' empty'}" data-act="su-player" data-i="${i}" aria-label="第 ${i + 1} 棒：${esc(name || '未選')}">${name ? playerName(name) : '選球員'}</button>`
        + `<button type="button" class="v2u-pos${pos ? '' : ' empty'}" data-act="su-pos" data-i="${i}" aria-label="第 ${i + 1} 棒守位：${esc(pos ? POS_SHORT[pos] : '未指定')}">${pos ? `<b>${esc(pos)}</b> ${esc(POS_SHORT[pos])}` : '守位'}</button></li>`;
    }).join('');
    const role = r => `<button type="button" role="radio" aria-checked="${s.role === r}" data-act="su-role" data-v="${r}">${r}</button>`;
    els.setup.innerHTML = '<header class="v2l-head"><button type="button" class="v2l-icon" data-act="leave" aria-label="離開場記">‹</button>'
      + '<h2 class="v2l-vs v2u-title">開賽設定</h2>'
      + (navigator.onLine === false ? '<span class="v2l-cap v2c-off" role="status">' + CAPSULE_ICON.off + '<span>離線</span></span>' : '')
      + (update ? '<button type="button" class="v2l-cap v2c-new" data-act="su-update" data-v2-update><i class="v2l-newdot" aria-hidden="true"></i><span>有新版・更新</span></button>' : '')
      + '<button type="button" class="v2u-old" data-act="old">舊版</button></header>'
      + '<div class="v2u-form">'
      + `<label class="v2u-f v2u-date"><span>日期</span><input type="date" data-su="date" value="${esc(s.date)}"></label>`
      + `<label class="v2u-f v2u-opp"><span>對手</span><input type="text" data-su="opponent" value="${esc(s.opponent)}" placeholder="對手隊名" maxlength="40" autocomplete="off"></label>`
      + `<label class="v2u-f v2u-tag"><span>賽事</span><input type="text" data-su="tag" value="${esc(s.tag)}" placeholder="系壘例行賽" maxlength="40" autocomplete="off"></label>`
      + `<div class="v2u-seg2"><div class="v2u-seg" role="radiogroup" aria-label="先攻或後攻">${role('先攻')}${role('後攻')}</div>`
      + `<button type="button" class="v2u-dh" role="switch" aria-checked="${s.dh}" data-act="su-dh"><span>DH</span><small>${s.dh ? '11 人' : '10 人'}</small></button></div>`
      + '</div>'
      + '<section class="v2u-lineup" aria-label="先發打線">'
      + `<div class="v2u-lhead"><h3>先發打線</h3><small data-v2-from>${s.from ? `帶入上一場 ${esc(shortDate(s.from.date))}${s.posGuess ? '・守位請確認' : ` vs ${esc(s.from.opponent)}`}` : '沒有上一場，請逐棒選'}</small>`
      + `<button type="button" class="v2u-clear" data-act="su-clear"${filled ? '' : ' disabled'}>清空</button></div>`
      + `<ol class="v2u-list">${rows}</ol></section>`
      + `<p class="v2u-err" role="alert"${s.error ? '' : ' hidden'}>${esc(s.error)}</p>`
      + '<button type="button" class="v2s-primary tone-white v2u-start" data-act="su-start" data-v2-fb data-v2-hap>開始比賽</button>';
    els.setup.hidden = false;
    haptics.attach(els.setup);
  }
  function setupError(text, button) {
    ui.setup.error = text;
    renderSetup();
    haptics.fire('error');
    if (button) { const b = els.setup.querySelector(`[data-act="${button.dataset.act}"]`); if (b) { b.classList.add('v2-err'); setTimeout(() => b.classList.remove('v2-err'), 1200); } }
  }
  function setupTouch() { ui.setup.touched = true; ui.setup.error = ''; }
  function setupDh() {
    const s = ui.setup;
    setupTouch();
    s.dh = !s.dh;
    if (s.dh) { while (s.lineup.length < 11) s.lineup.push(''); while (s.pos.length < 11) s.pos.push(''); }
    else { s.lineup = s.lineup.slice(0, 10); s.pos = s.pos.slice(0, 10).map(p => (p === 'DH' ? '' : p)); }
    renderSetup();
  }
  function setupPickPlayer(name) {
    const s = ui.setup, i = ui.pick;
    if (i < 0) return;
    setupTouch();
    // 和舊版 updateSetupLineupSlot 一樣：選了已在別棒的人就兩棒對調（守位跟著棒次不動）。
    const other = name ? s.lineup.indexOf(name) : -1;
    if (other >= 0 && other !== i) s.lineup[other] = s.lineup[i] || '';
    s.lineup[i] = name;
    closeSheet();
    renderSetup();
  }
  function setupPickPos(pos) {
    const s = ui.setup, i = ui.pick;
    if (i < 0) return;
    setupTouch();
    swapLineupPosition(s.pos, i, pos); // 舊版同一個函式：守位被別棒佔了就對調
    closeSheet();
    renderSetup();
  }
  async function setupAddGuest() {
    const i = ui.pick;
    closeSheet();
    let guest = null;
    try { guest = await askNewGuest('友軍支援', `新增支援選手（第 ${i + 1} 棒）`); } catch (error) { guest = null; }
    if (!guest || !ui.setup) return;
    ui.pick = i;
    setupPickPlayer(guest.name);
  }
  function startFromSetup(button) {
    const s = ui.setup;
    const size = s.dh ? 11 : 10;
    const lineup = s.lineup.slice(0, size);
    if (lineup.some(n => !n)) { setupError(`還有 ${lineup.filter(n => !n).length} 棒沒選球員`, button); return; }
    if (normalizeLineupPositions(lineup, s.pos, s.dh).some(p => !p)) { setupError('每一棒都要指定守位（不能重複）', button); return; }
    const put = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    put('setup_game_date', s.date || today());
    put('setup_game_opponent', s.opponent);
    put('setup_game_tag', s.tag);
    put('setup_game_role', s.role);
    const result = quiet(() => {
      if (typeof isDhEnabled !== 'undefined' && isDhEnabled !== s.dh) setDhRule(s.dh); // 和舊版按 DH 鈕相同（記住 rebas_has_dh）
      setupLineupList = lineup.slice();
      setupLineupPositions = s.pos.slice(0, size);
      startNewGameFromSetup();
    });
    if (!live()) { setupError(result.error || '沒有開始，請檢查欄位', button); return; }
    haptics.fire('record');
    ui.setup = null; ui.pick = -1;
    render();
  }
  els.setup.addEventListener('input', event => {
    const key = event.target.dataset && event.target.dataset.su;
    if (!key || !ui.setup) return;
    ui.setup[key] = event.target.value;
    ui.setup.touched = true;
  });

  // ---------- Sheet ----------
  const SHEET_WIDE = new Set(['pa', 'all']);
  function openSheet(name) {
    ui.sheet = name;
    ui.sheetAt = performance.now();
    els.layer.hidden = false;
    els.layer.dataset.sheet = name;
    // ⋯ 選單 0 ms 出現；其他 sheet 240 ms ease-out 升起（減少動態時原地出現）。
    els.layer.classList.toggle('v2l-rise', name !== 'menu' && !reducedMotion.matches);
    els.sheet.classList.toggle('wide', SHEET_WIDE.has(name));
    drawSheet();
    const first = els.sheet.querySelector('[data-autofocus]') || els.sheet.querySelector('button');
    if (first) first.focus({preventScroll: true});
  }
  function closeSheet() {
    ui.sheet = null; ui.pa = null; ui.rec = null; ui.sub = null;
    els.layer.hidden = true;
    els.sheet.innerHTML = '';
  }
  const sheetHead = (title, tone) => `<div class="v2s-head${tone ? ` tone-${tone}` : ''}"><h3 class="v2s-title">${title}</h3><button type="button" class="v2l-icon v2s-x" data-act="close" aria-label="關閉">×</button></div>`;
  function drawSheet() {
    const g = live();
    const draw = SHEETS[ui.sheet];
    if (!draw || (!g && !SETUP_SHEETS.has(ui.sheet)) || (g && SETUP_SHEETS.has(ui.sheet))) { closeSheet(); return; }
    els.sheet.innerHTML = draw(g);
    els.sheet.setAttribute('aria-label', els.sheet.querySelector('.v2s-title')?.textContent || '');
    haptics.attach(els.sheet);
  }
  function playerName(name) { return `<span class="v2s-jersey">${esc(jersey(name).trim())}</span> ${esc(name)}`; }
  const SHEETS = {
    pa(g) {
      const pa = ui.pa;
      const batter = g.lineup[g.currentBatterIdx];
      const rule = TRAJ_RULES[pa.code];
      const seg = ['grounder', 'line', 'fly'].map(t => {
        const off = rule && !rule.includes(t);
        return `<button type="button" role="radio" aria-checked="${pa.traj === t}" data-act="traj" data-traj="${t}"${off ? ' disabled' : ''}>${TRAJ_LABEL[t]}</button>`;
      }).join('');
      return sheetHead(`${esc(RESULT_NAME[pa.code])} · ${esc(batter)}`, RESULT_TONE[pa.code])
        + `<div class="v2s-field">${fieldSvg([], true)}</div>`
        + `<p class="v2s-hint" data-v2-loc>${pa.pos ? `落點：${esc(pa.pos)} ${esc(POS_NAME[pa.pos])}` : '點球場標落點（可略過）'}</p>`
        + `<div class="v2s-seg" role="radiogroup" aria-label="擊球型態">${seg}</div>`
        + `<div class="v2s-runs"><span class="v2s-runs-k">得分</span><button type="button" class="v2s-step" data-act="runs" data-d="-1" aria-label="少 1 分">−</button>`
        + `<b data-v2-runs>${pa.runs}</b><button type="button" class="v2s-step" data-act="runs" data-d="1" aria-label="多 1 分">＋</button>`
        + '<span class="v2s-runs-hint">預設 0，有人回來才按 ＋</span></div>'
        + `<button type="button" class="v2s-primary tone-${RESULT_TONE[pa.code]}" data-act="pa-submit" data-v2-fb data-v2-hap data-autofocus>送出</button>`;
    },
    menu(g) {
      const hapNote = haptics.note();
      const hapOff = haptics.mode === 'none';
      const item = (act, label, sub, extra = '', off = false) => `<button type="button" class="v2s-item${extra}" data-act="${act}"${off ? ' disabled' : ''}><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
      const sw = (act, label, on, note, disabled) => `<button type="button" class="v2s-item v2s-switch" role="switch" aria-checked="${on}" data-act="${act}"${disabled ? ' disabled' : ''}><span>${label}</span>${note ? `<small>${esc(note)}</small>` : ''}<i aria-hidden="true"></i></button>`;
      return sheetHead('更多操作')
        + (ui.update ? '<p class="v2s-new" data-v2-update-row><i class="v2l-newdot" aria-hidden="true"></i><span><b>有新版</b>比賽結束或離開場記後再更新，記分中不會重新整理。</span></p>' : '')
        + '<p class="v2s-group">人員</p>' + item('pitcher', '換投', `目前 ${esc(g.pitcherName || '未選')}`) + item('sub', '換人', '代打、代跑、守備換人') + item('dh', 'DH 制', g.hasDh ? '目前：有 DH' : '目前：沒有 DH')
        + '<p class="v2s-group">紀錄</p>' + item('all', '全部紀錄', '任一筆可改或刪') + item('inning-direct', '直接換局', '出局數沒記完整也能換') + item('upload', '上傳本局', ui.syncing ? '上傳中…' : navigator.onLine === false ? '連線後再按上傳本局' : '', '', !!ui.syncing)
        + '<p class="v2s-group">比賽</p>' + item('end', '結束比賽', '結束並同步')
        + sw('hc', '戶外高對比', root.classList.contains('hc'), '', false)
        + sw('haptics', '觸覺回饋', !hapOff && haptics.enabled, hapNote, hapOff)
        + item('old', '改回舊版場記', '資料是同一份') + item('clear', '清除此場', '刪掉這場比賽，不能復原', ' v2s-danger');
    },
    sit(g) {
      const b = g.currentBases || {};
      const base = (key, name) => `<button type="button" class="v2s-base${b[key] ? ' on' : ''}" aria-pressed="${!!b[key]}" data-act="base" data-base="${key}" data-v2-fb data-v2-hap><b>${name}</b><small>${b[key] ? '跑者' : '無人'}</small></button>`;
      return sheetHead('出局與壘包')
        + `<div class="v2s-bases">${base('third', '三壘')}${base('second', '二壘')}${base('first', '一壘')}</div>`
        + `<div class="v2s-outs"><span class="v2s-runs-k">出局</span><button type="button" class="v2s-step" data-act="outs" data-d="-1" aria-label="少 1 個出局" data-v2-fb data-v2-hap>−</button>`
        + `<b data-v2-outs>${Math.min(3, g.currentOuts || 0)}</b><button type="button" class="v2s-step" data-act="outs" data-d="1" aria-label="多 1 個出局" data-v2-fb data-v2-hap>＋</button></div>`
        + '<p class="v2s-hint">壘包只是備忘，記結果不會自動改。撤銷後出局數依紀錄重算。</p>';
    },
    pitcher(g) {
      const {teamNames, guestNames} = getAllAvailablePlayerNames();
      const lineup = g.lineup || [];
      const pos = positions(g);
      const onField = lineup.map((n, i) => [n, pos[i]]).filter(([n]) => n && n !== g.pitcherName);
      const bench = [...teamNames, ...guestNames].filter((n, i, all) => n && !lineup.includes(n) && n !== g.pitcherName && all.indexOf(n) === i);
      const btn = (n, sub) => `<button type="button" class="v2s-item" data-act="pick-pitcher" data-name="${esc(n)}" data-v2-fb data-v2-hap><span>${playerName(n)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
      return sheetHead('換投')
        + `<p class="v2s-hint">目前投手：${g.pitcherName ? esc(g.pitcherName) : '未選'}。點一下就換；換錯可以按「復原」。半局中換投會再問一次。</p>`
        + '<p class="v2s-group">場上</p>' + (onField.map(([n, p]) => btn(n, p ? `守 ${p}` : '')).join('') || '<p class="v2s-hint">沒有其他場上球員</p>')
        + '<p class="v2s-group">場下與支援</p>' + (bench.map(n => btn(n, guestNames.includes(n) ? '支援' : '場下')).join('') || '<p class="v2s-hint">沒有場下球員</p>');
    },
    'pitcher-confirm'(g) {
      return sheetHead('半局中換投？')
        + `<p class="v2s-body">這個半局已經有守備紀錄。確定從 ${esc(g.pitcherName)} 換成 ${esc(ui.pitcher)}？</p>`
        + `<button type="button" class="v2s-primary tone-white" data-act="pitcher-yes" data-v2-fb data-v2-hap data-autofocus>確定換投</button>`
        + '<button type="button" class="v2s-secondary" data-act="close">不換</button>';
    },
    sub(g) {
      const pos = positions(g);
      if (ui.sub == null) {
        return sheetHead('換人：換下誰？')
          + '<p class="v2s-hint">代打、代跑、守備換人都在這裡；換上的人接手同一棒與守位。</p>'
          + (g.lineup || []).map((n, i) => `<button type="button" class="v2s-item" data-act="sub-slot" data-i="${i}"><span>第 ${i + 1} 棒 · ${playerName(n)}</span>${pos[i] ? `<small>守 ${esc(pos[i])}</small>` : ''}</button>`).join('');
      }
      const {teamNames, guestNames} = getAllAvailablePlayerNames();
      const lineup = g.lineup || [];
      const pool = [...teamNames, ...guestNames].filter((n, i, all) => n && !lineup.includes(n) && all.indexOf(n) === i);
      return sheetHead(`換下第 ${ui.sub + 1} 棒 ${esc(lineup[ui.sub])}`)
        + '<button type="button" class="v2s-secondary" data-act="sub-back">‹ 重選棒次</button>'
        + (pool.map(n => `<button type="button" class="v2s-item" data-act="sub-pick" data-name="${esc(n)}" data-v2-fb data-v2-hap><span>${playerName(n)}</span><small>${guestNames.includes(n) ? '支援' : '場下'}</small></button>`).join('') || '<p class="v2s-hint">沒有可以換上的球員</p>');
    },
    dh(g) {
      return sheetHead(g.hasDh ? '取消 DH 制？' : '改用 DH 制？')
        + `<p class="v2s-body">${g.hasDh ? '打線改回 10 人，DH 那一棒的守位交給第 11 棒的球員。' : '打線加一棒（11 人），多一位只打擊的 DH。'}</p>`
        + `<button type="button" class="v2s-primary tone-white" data-act="dh-yes" data-v2-fb data-v2-hap data-autofocus>${g.hasDh ? '取消 DH' : '改用 DH'}</button>`
        + '<button type="button" class="v2s-secondary" data-act="close">先不要</button>';
    },
    end() {
      return sheetHead('結束比賽？')
        + '<p class="v2s-body">把這場標成結束，上傳比賽紀錄並更新成績。上傳中不能再記錄。</p>'
        + '<button type="button" class="v2s-primary tone-white" data-act="end-yes" data-v2-fb data-v2-hap data-autofocus>結束並同步</button>'
        + '<button type="button" class="v2s-secondary" data-act="close">先不要</button>';
    },
    clear(g) {
      return sheetHead('清除此場？', 'out')
        + `<p class="v2s-body">刪掉和 ${esc(g.opponent || '對手')} 的這場比賽（含已記的紀錄）；雲端有的話也會一起刪。</p>`
        + '<p class="v2s-warn" data-v2-irrev>確認後立即生效，不能復原</p>'
        + '<button type="button" class="v2s-primary tone-out" data-act="clear-yes">清除這場</button>'
        + '<button type="button" class="v2s-secondary" data-act="close" data-autofocus>不要清除</button>';
    },
    'su-player'() {
      const s = ui.setup, i = ui.pick;
      const {teamNames, guestNames} = getAllAvailablePlayerNames();
      const chip = name => {
        const at = s.lineup.indexOf(name);
        return `<button type="button" class="v2u-pick${at === i ? ' on' : ''}" data-act="su-pick" data-name="${esc(name)}" aria-pressed="${at === i}">${playerName(name)}${at >= 0 && at !== i ? `<small>第 ${at + 1} 棒・對調</small>` : ''}</button>`;
      };
      return sheetHead(`第 ${i + 1} 棒`)
        + `<div class="v2u-picks">${teamNames.map(chip).join('')}</div>`
        + (guestNames.length ? `<p class="v2s-group">支援選手</p><div class="v2u-picks">${guestNames.map(chip).join('')}</div>` : '')
        + '<button type="button" class="v2s-secondary" data-act="su-guest">＋ 新增支援選手</button>'
        + (s.lineup[i] ? '<button type="button" class="v2s-secondary" data-act="su-pick" data-name="">清空這一棒</button>' : '');
    },
    'su-pos'() {
      const s = ui.setup, i = ui.pick;
      const keys = POS_KEYS.concat(s.dh ? ['DH'] : []);
      return sheetHead(`第 ${i + 1} 棒守位${s.lineup[i] ? ` · ${esc(s.lineup[i])}` : ''}`)
        + '<div class="v2u-picks v2u-posgrid">' + keys.map(k => {
          const at = s.pos.indexOf(k);
          return `<button type="button" class="v2u-pick${at === i ? ' on' : ''}" data-act="su-setpos" data-pos="${k}" aria-pressed="${at === i}"><b>${k}</b> ${esc(POS_SHORT[k])}${at >= 0 && at !== i ? `<small>${esc(s.lineup[at] || `第 ${at + 1} 棒`)}・對調</small>` : ''}</button>`;
        }).join('') + '</div>'
        + (s.pos[i] ? '<button type="button" class="v2s-secondary" data-act="su-setpos" data-pos="">未指定</button>' : '');
    },
    // B4：上傳失敗（膠囊轉紅）、結束時離線。紀錄都還在這台裝置。
    fail() {
      if (ui.failed === 'end-offline') {
        return sheetHead('比賽還沒結束')
          + '<p class="v2s-body"><b>比賽還沒結束，紀錄都留在這台裝置。</b><br>現在離線，連線後再按一次「結束比賽」。</p>'
          + '<button type="button" class="v2s-primary tone-white" data-act="close" data-autofocus>知道了，繼續記錄</button>';
      }
      const end = ui.failed === 'end';
      return sheetHead(end ? '結束比賽沒有完成' : '上傳失敗', 'out')
        + `<p class="v2s-body"><b>紀錄在這台裝置，沒有遺失。</b><br>${end ? '比賽還在進行中，可以重試結束，或先繼續記錄。' : '可以現在重試，或繼續記錄、之後再上傳本局。'}</p>`
        + `<button type="button" class="v2s-primary tone-white" data-act="retry" data-v2-fb data-v2-hap data-autofocus>${end ? '重試結束並同步' : '重試上傳'}</button>`
        + '<button type="button" class="v2s-secondary" data-act="close">稍後再說</button>';
    },
    // 點膠囊：說明現在的狀態，給「上傳本局」（只在按下時上傳，語意不變）。
    sync(g) {
      const s = syncState(g);
      const off = s.key === 'off';
      const text = {ok: '這場的紀錄都已經在雲端。', pend: `${s.label}。紀錄都存在這台裝置，按「上傳本局」才會寫到雲端。`,
        off: '現在離線。紀錄照常記，先存在這台裝置；連線後再按上傳本局。', busy: '正在上傳本局。'}[s.key] || '';
      return sheetHead(s.key === 'ok' ? '已同步' : s.key === 'off' ? '離線' : s.key === 'busy' ? '上傳中' : '還沒上傳')
        + `<p class="v2s-body">${esc(text)}</p>`
        + `<button type="button" class="v2s-primary tone-white" data-act="upload"${off || s.key === 'busy' ? ' disabled' : ''} data-v2-fb data-v2-hap>${off ? '連線後再按上傳本局' : '上傳本局'}</button>`
        + '<button type="button" class="v2s-secondary" data-act="close" data-autofocus>關閉</button>';
    },
    all(g) {
      const rows = (g.innings || []).map((inn, ii) => {
        const bat = isInningOurBat(g.ourRole, inn.topBottom);
        const list = bat ? inn.plateAppearances || [] : inn.defensiveEvents || [];
        if (!list.length) return '';
        const items = list.map((r, ri) => {
          const code = bat ? (r.isRunnerOut ? 'RO' : r.result) : r.type;
          const label = bat ? RESULT_NAME[code] || code : (code === 'RUN' ? `失 ${r.runs} 分` : DEF_NAME[code] || code);
          const who = bat ? `${r.slot || ''} 棒 ${r.batterName}` : (r.pitcher || '');
          return `<button type="button" class="v2s-rec" data-act="rec" data-ii="${ii}" data-ri="${ri}"><span class="v2l-tag tone-${RESULT_TONE[code] || 'on'}">${esc(label)}</span><span class="v2l-who">${esc(who)}</span>${(bat ? r.runsScored : 0) ? `<span class="v2l-runs">+${r.runsScored} 分</span>` : ''}</button>`;
        }).join('');
        return `<p class="v2s-group">${esc(halfLabel(inn.inningNum, inn.topBottom))} · ${bat ? '進攻' : '防守'}</p>${items}`;
      }).join('');
      return sheetHead('全部紀錄') + (rows || '<p class="v2s-hint">還沒有任何紀錄</p>');
    },
    rec(g) {
      const {kind, ref, inn, pick} = ui.rec;
      if (!findRecord(g, kind, ref)) return sheetHead('這一筆已經不在了') + '<button type="button" class="v2s-secondary" data-act="all">‹ 回全部紀錄</button>';
      const code = kind === 'pa' ? (ref.isRunnerOut ? 'RO' : ref.result) : ref.type;
      const label = kind === 'pa' ? RESULT_NAME[code] : (code === 'RUN' ? `失 ${ref.runs} 分` : DEF_NAME[code]);
      const who = kind === 'pa' ? ref.batterName : ref.pitcher;
      const choices = kind === 'pa' ? (ref.isRunnerOut ? [] : OFF_PAD.map(p => p[0]).filter(c => c !== 'RO')) : (code === 'RUN' ? [] : ['K', 'GO', 'FO', 'DP', '界外K', 'RUNNER_OUT', 'BB', 'HIT']);
      const chips = choices.map(c => `<button type="button" class="v2s-chip tone-${RESULT_TONE[c]}" aria-pressed="${(pick || code) === c}" data-act="rec-pick" data-code="${esc(c)}">${esc(kind === 'pa' ? RESULT_NAME[c] : DEF_NAME[c])}</button>`).join('');
      return sheetHead(`${esc(halfLabel(inn.inningNum, inn.topBottom))} · ${esc(label)} · ${esc(who || '')}`, RESULT_TONE[code])
        + '<button type="button" class="v2s-secondary" data-act="all">‹ 回全部紀錄</button>'
        + (chips ? `<p class="v2s-group">改成</p><div class="v2s-chips">${chips}</div>`
          + `<button type="button" class="v2s-primary tone-white" data-act="rec-save" data-v2-fb data-v2-hap${pick && pick !== code ? '' : ' disabled'}>儲存</button>` : '<p class="v2s-hint">這一筆只能刪除。</p>')
        + '<button type="button" class="v2s-secondary v2s-danger" data-act="rec-del" data-v2-fb data-v2-hap>刪除這一筆</button>';
    }
  };

  // ---------- 點擊 ----------
  // ui-theme.js 的全站按下漣漪、壓縮與 vibrate(6) 掛在 document 的 pointerdown（冒泡）；在新版場記裡由 V1＋觸覺表取代，
  // 所以在根節點擋下（不改 ui-theme.js）。
  root.addEventListener('pointerdown', event => {
    event.stopPropagation();
    if (event.button > 0) return;
    const button = event.target.closest('[data-v2-fb]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    if (busy()) return; // 防連點擋下的那一下不給任何回饋
    ui.downAt = event.timeStamp;
    button.classList.add('v2-down');
    if (probe) { const t0 = event.timeStamp; afterTwoFrames(() => probe.v1.push(performance.now() - t0)); }
  });
  const release = () => root.querySelectorAll('.v2-down').forEach(el => el.classList.remove('v2-down'));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => root.addEventListener(type, release));
  window.addEventListener('blur', release);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && ui.sheet) { event.preventDefault(); closeSheet(); }
  });

  // 落點：getScreenCTM().inverse() 換算成 400 座標（放大後也準），存法和舊版 handleFieldClick 一樣。
  function pickSpot(event, svg) {
    const ctm = svg.getScreenCTM();
    if (!ctm || !ui.pa) return;
    const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const px = Math.max(0, Math.min(400, pt.x));
    const py = Math.max(0, Math.min(400, pt.y));
    const pa = ui.pa;
    pa.pos = zoneAt(px, py);
    pa.x = parseFloat((px / 400).toFixed(3));
    pa.y = parseFloat((py / 400).toFixed(3));
    if (!pa.trajPicked) pa.traj = trajDefault(pa.code, pa.pos);
    // V3：實心大點＋十字線，立刻出現，不用擴散圈。只改這幾個節點，不重畫 sheet。
    const mark = svg.querySelector('.v2f-mark');
    mark.setAttribute('transform', `translate(${px.toFixed(1)} ${py.toFixed(1)})`);
    mark.removeAttribute('hidden');
    els.sheet.querySelector('[data-v2-loc]').textContent = `落點：${pa.pos} ${POS_NAME[pa.pos]}`;
    els.sheet.querySelectorAll('[data-act="traj"]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.traj === pa.traj)));
    haptics.fire('record');
  }

  const ACTIONS = {
    close() { closeSheet(); },
    leave,
    menu() { openSheet('menu'); },
    sit() { openSheet('sit'); },
    off(btn) {
      const g = live();
      const code = btn.dataset.code;
      if (!g) return;
      if (finalizing()) { fail('正在結束比賽，請稍候', btn); return; }
      if ((g.currentOuts || 0) >= 3) { fail('已三出局，先換局', btn); return; }
      if (QUICK.has(code)) { recordOffense(code, {}, btn); return; }
      haptics.fire('select');
      ui.pa = {code, pos: '', x: null, y: null, traj: trajDefault(code, HITS.includes(code) ? HIT_SPOT[code][0] : '2B'), trajPicked: false, runs: 0};
      openSheet('pa');
    },
    def(btn) {
      const g = live();
      if (!g) return;
      if (finalizing()) { fail('正在結束比賽，請稍候', btn); return; }
      const def = DEF_PAD.find(d => d[0] === btn.dataset.code);
      if ((g.currentOuts || 0) >= 3 && def[3] !== 'RUN') { fail('已三出局，先換局', btn); return; }
      recordDefense(btn.dataset.code, btn);
    },
    traj(btn) {
      if (!ui.pa || btn.disabled) return;
      ui.pa.traj = btn.dataset.traj; ui.pa.trajPicked = true;
      els.sheet.querySelectorAll('[data-act="traj"]').forEach(b => b.setAttribute('aria-checked', String(b === btn)));
    },
    runs(btn) {
      if (!ui.pa) return;
      ui.pa.runs = Math.max(0, Math.min(4, ui.pa.runs + Number(btn.dataset.d)));
      els.sheet.querySelector('[data-v2-runs]').textContent = ui.pa.runs;
    },
    'pa-submit'(btn) {
      const pa = ui.pa;
      if (!pa) return;
      const ok = recordOffense(pa.code, pa, btn);
      if (ok) closeSheet();
    },
    'snack-undo'(btn) {
      const undo = ui.snack && ui.snack.undo;
      if (!undo) return;
      if (undo.kind === 'snap') restoreSnapshot(undo, btn); else undoRecord(undo, btn);
    },
    'undo-last'(btn) { undoLast(btn); },
    inning(btn) { changeInning(btn); },
    'inning-direct'(btn) { changeInning(btn); },
    upload() { closeSheet(); upload(); },
    sync() { const g = live(); if (!g || writing()) return; openSheet(syncState(g).key === 'fail' ? 'fail' : 'sync'); },
    retry() { const kind = ui.failed; closeSheet(); if (kind === 'end') endGame(); else upload(); },
    'su-role'(btn) { setupTouch(); ui.setup.role = btn.dataset.v; renderSetup(); },
    'su-dh'() { setupDh(); },
    'su-clear'() { setupTouch(); const n = ui.setup.dh ? 11 : 10; ui.setup.lineup = Array(n).fill(''); ui.setup.pos = Array(n).fill(''); ui.setup.from = null; renderSetup(); },
    'su-player'(btn) { ui.pick = Number(btn.dataset.i); openSheet('su-player'); },
    'su-pos'(btn) { ui.pick = Number(btn.dataset.i); openSheet('su-pos'); },
    'su-pick'(btn) { setupPickPlayer(btn.dataset.name); },
    'su-setpos'(btn) { setupPickPos(btn.dataset.pos); },
    'su-guest'() { setupAddGuest(); },
    'su-start'(btn) { startFromSetup(btn); },
    'su-update'() { const b = document.querySelector('#uiUpdateBar [data-act="update"]'); if (b) b.click(); },
    end() { openSheet('end'); },
    'end-yes'() { endGame(); },
    clear() { openSheet('clear'); },
    'clear-yes'() { clearGame(); },
    pitcher() { openSheet('pitcher'); },
    'pick-pitcher'(btn) {
      const g = live();
      const name = btn.dataset.name;
      if (!g) return;
      if (pitcherNeedsConfirm(g, name)) { ui.pitcher = name; haptics.fire('select'); openSheet('pitcher-confirm'); return; }
      changePitcher(name, btn);
    },
    'pitcher-yes'(btn) { changePitcher(ui.pitcher, btn); },
    sub() { ui.sub = null; openSheet('sub'); },
    'sub-slot'(btn) { ui.sub = Number(btn.dataset.i); drawSheet(); },
    'sub-back'() { ui.sub = null; drawSheet(); },
    'sub-pick'(btn) { substitute(ui.sub, btn.dataset.name, btn); },
    dh() { openSheet('dh'); },
    'dh-yes'(btn) { toggleDh(btn); },
    // 失敗時不重畫，按鈕上的紅色抖動（⑥）才看得到。
    outs(btn) { if (adjustOuts(Number(btn.dataset.d), btn) && ui.sheet === 'sit') drawSheet(); },
    base(btn) { if (toggleBase(btn.dataset.base, btn) && ui.sheet === 'sit') drawSheet(); },
    all() { ui.rec = null; openSheet('all'); },
    rec(btn) {
      const g = live();
      const inn = g && g.innings[Number(btn.dataset.ii)];
      if (!inn) return;
      const bat = isInningOurBat(g.ourRole, inn.topBottom);
      const ref = (bat ? inn.plateAppearances : inn.defensiveEvents)[Number(btn.dataset.ri)];
      ui.rec = {kind: bat ? 'pa' : 'def', ref, inn, pick: null};
      openSheet('rec');
    },
    'rec-pick'(btn) { if (ui.rec) { ui.rec.pick = btn.dataset.code; drawSheet(); } },
    'rec-save'(btn) { const r = ui.rec; if (r && r.pick) editRecord(r.kind, r.ref, r.pick, btn); },
    'rec-del'(btn) {
      const r = ui.rec;
      if (!r) return;
      const code = r.kind === 'pa' ? (r.ref.isRunnerOut ? 'RO' : r.ref.result) : r.ref.type;
      const label = r.kind === 'pa' ? RESULT_NAME[code] : (code === 'RUN' ? `失 ${r.ref.runs} 分` : DEF_NAME[code]);
      const ok = removeRecord(r.kind, r.ref);
      if (!ok) { fail('這一筆已經不在了', btn); return; }
      hold();
      ui.rec = null;
      openSheet('all');
      done('undo', 'neutral', `已刪除：${label}`, null, `已刪除：${label}`);
    },
    hc() {
      const on = root.classList.toggle('hc');
      try { if (on) localStorage.setItem(HC_KEY, '1'); else localStorage.removeItem(HC_KEY); } catch (error) { /* 只在本次有效 */ }
      drawSheet();
    },
    haptics() { haptics.setEnabled(!haptics.enabled); drawSheet(); },
    old() { closeSheet(); if (window.uiV2Flag) window.uiV2Flag.set(false); }
  };
  // 會寫入資料的動作：防連點 400 ms 內的第二下不處理、不給回饋。
  const GUARDED = new Set(['off', 'def', 'pa-submit', 'snack-undo', 'undo-last', 'inning', 'inning-direct', 'pick-pitcher', 'pitcher-yes', 'sub-pick', 'dh-yes', 'outs', 'base', 'rec-save', 'rec-del', 'end-yes', 'clear-yes', 'upload', 'retry', 'su-start']);
  root.addEventListener('click', event => {
    if (probe) ui.clickAt = event.timeStamp;
    const svg = event.target.closest('[data-v2-field]');
    if (svg) { pickSpot(event, svg); return; }
    const btn = event.target.closest('[data-act]');
    if (!btn || !root.contains(btn) || btn.disabled) return;
    const act = btn.dataset.act;
    if (GUARDED.has(act) && busy()) return;
    if (GUARDED.has(act) && ui.syncing && finalizing()) { fail('正在結束比賽，請稍候', btn); return; }
    const fn = ACTIONS[act];
    if (fn) fn(btn);
  });

  // ---------- 外殼（覆盤頁；B5 起放內容） ----------
  // 2026/11/18（總監 REVISION 2 追加 3）：外殼不再有「實況／覆盤」切換，進出都走既有的「比賽」群組分頁（場記／覆盤／打線）。
  // 場記頁：有進行中的比賽就是新版場記（全畫面）；沒有比賽時先用舊版開賽設定（B4 才換）。
  const VIEWS = {review: {page: 'Games', tab: 'tabGames', label: '覆盤'}};
  const renderers = {};
  const shells = {};
  function shellMarkup(view) {
    return `<div class="v2-head"><h2 class="v2-title">${VIEWS[view].label}<span class="v2-badge">新版試用</span></h2></div>`
      + '<div class="v2-body" data-v2-body></div>'
      + '<div class="v2-foot"><p>新版還在建置中。<span class="v2-nb">資料和舊版是同一份，</span><span class="v2-nb">隨時可以切回舊版。</span></p>'
      + '<button type="button" class="v2-back" data-v2-off>回到舊版</button></div>';
  }
  function mount(view) {
    if (shells[view]) return shells[view];
    // div，不用 section：全站 `main section` 的樣式（ui-theme.css）會蓋掉外殼與徽章的顏色。
    const shell = document.createElement('div');
    shell.className = 'v2-shell';
    shell.setAttribute('role', 'region');
    shell.dataset.v2View = view;
    shell.setAttribute('aria-label', `新版${VIEWS[view].label}`);
    shell.innerHTML = shellMarkup(view);
    main.append(shell);
    shells[view] = shell;
    return shell;
  }
  function renderShell(view) {
    const shell = mount(view);
    const body = shell.querySelector('[data-v2-body]');
    const draw = renderers[view];
    if (draw) { try { draw(body); } catch (error) { console.error('[ui-v2]', view, error); } }
  }
  main.addEventListener('click', event => {
    if (event.target.closest('.v2-shell [data-v2-off]') && window.uiV2Flag) window.uiV2Flag.set(false);
  });

  window.uiV2 = {
    VIEWS,
    RESULT_TONE,
    register(view, draw) { renderers[view] = draw; if (shells[view] && document.body.dataset.page === VIEWS[view].page) renderShell(view); },
    render: renderShell,
    live: {render, zoneAt, state: ui}
  };

  document.body.classList.add('ui-v2');
  const showFor = () => {
    const view = Object.keys(VIEWS).find(key => VIEWS[key].page === document.body.dataset.page);
    if (view) renderShell(view);
    render();
  };
  // ui-comfort.js 換頁後才寫 body[data-page]（MutationObserver，非同步），所以跟著這個屬性走，不掛 switchMainTab。
  new MutationObserver(showFor).observe(document.body, {attributes: true, attributeFilter: ['data-page']});
  window.siteHooks.after('renderAll', 'ui-v2', showFor);
  // 舊版開賽設定按「開始比賽」後會呼叫 renderLiveScorer，切換 #activeGameContainer；跟著它顯示新版場記。
  const liveBox = document.getElementById('activeGameContainer');
  if (liveBox) new MutationObserver(() => { if (!!live() !== shown) render(); }).observe(liveBox, {attributes: true, attributeFilter: ['class']});
  let resizeTimer = 0;
  // 全站離線提示條在新版底下看不到，離線與否改由頁首小標籤顯示。
  // 同步膠囊、「有新版」標記跟著連線、待上傳、版本狀態變：只重畫頁首（記分中）或開賽設定。
  const refreshChrome = () => { const g = live(); if (shown && g) renderHead(g); else if (setupShown && !ui.sheet) renderSetup(); };
  ['online', 'offline', 'pendingsync:change'].forEach(type => window.addEventListener(type, refreshChrome));
  // CP-20：本機快取寫不進去（儲存空間滿）也顯示同一條不打斷的提示。
  window.addEventListener('localcache:status', event => { if (event.detail && event.detail.failed && live()) storageFull(); });
  // 記分中不跳更新／安裝提示（CSS 藏 .ui-app-bar），只在「⋯」放「有新版」標記；pwa.js 把更新條加進 body 時重畫。
  let updateSeen = hasUpdate();
  new MutationObserver(() => { const now = hasUpdate(); if (now !== updateSeen) { updateSeen = now; refreshChrome(); } }).observe(document.body, {childList: true});
  // CP-19：覆盤編輯不能改到記分中的那一場（兩邊同時改會互相覆蓋）。
  const guardReview = (name, idOf) => {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (...args) {
      const g = live();
      const id = idOf(args);
      if (g && id != null && String(id) === String(g.id)) { toast('這場比賽還在記錄中：請在場記修改；結束比賽後才能在覆盤編輯。', 'warning'); return undefined; }
      return original.apply(this, args);
    };
  };
  guardReview('toggleEditCurrentReviewGame', () => (typeof selectedReviewGameId !== 'undefined' ? selectedReviewGameId : null));
  guardReview('saveEditedReviewGame', args => args[0]);
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (shown) render(); }, 120); });
  showFor();
})();
