// review-v2/review-edit.js — 新版覆盤的編輯（WO-05 B6）。首屏畫完、閒置時才載入。
//
// 一筆一筆改：打席（結果、型態、落點、得分、打者）、防守事件（類型、出局、失分、投手、說明）、比賽資訊。
// 儲存鍵固定在 sheet 底部，不用捲就按得到；按下就寫入，跳出「已儲存・復原」提示 6 秒。
// 復原＝把編輯前的整場資料放回去，再完整同步一次（雲端會看到第二次寫入，內容等於編輯前）。
// 寫入與同步照抄舊版 saveEditedReviewGame：本機快取 → commitGamesToGitHub → syncAllGamesToTeamLogs → commitLogsToGitHub
// （賽事失敗就不送日誌，日誌改存本機草稿）；失敗訊息相同。所有寫入排成一條佇列依序執行。
// 和舊版的差別（B6）：只寫有改的欄位、只重算被改的那個半局，而且值不同才寫；不碰 battingSide（PO-31：新紀錄不寫）。
// 新增打席／防守事件的預設內容與舊版相同（G-30／G-32）。比賽還在記錄中時不能改（CP-19）。
(function () {
  'use strict';
  const R = window.reviewV2;
  if (!R) return;
  const {esc, TONE, RESULT_NAME, DEF_NAME, TRAJ, PLACE, HITS} = R;
  const RESULTS = ['1H', '2H', '3H', 'HR', 'BB', 'K', '界外K', 'GO', 'FO', 'LO', 'SF', 'E', 'FC', 'DP', 'OUT'];
  const DEF_TYPES = ['GO', 'FO', 'K', '界外K', 'DP', 'RUNNER_OUT', 'BB', 'HIT', 'RUN'];
  const LOCS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'SF', 'RC', 'RF'];
  const LIVE_MSG = '這場比賽還在記錄中：請在場記修改；結束比賽後才能在覆盤編輯。';
  const defaultOuts = type => (typeof defaultOutsForDefenseEvent === 'function' ? defaultOutsForDefenseEvent(type) : ({DP: 2, GO: 1, FO: 1, K: 1, '界外K': 1, RUNNER_OUT: 1}[type] || 0));

  // ---------- 名單 ----------
  function names(g, current) {
    const list = [];
    const add = n => { if (n && !list.includes(n)) list.push(n); };
    (g.lineup || []).forEach(add);
    if (typeof getAllAvailablePlayerNames === 'function') { const all = getAllAvailablePlayerNames(); all.teamNames.forEach(add); all.guestNames.forEach(add); }
    add(current);
    return list;
  }
  const options = (list, value) => list.map(n => `<option value="${esc(n)}"${n === value ? ' selected' : ''}>${esc(n)}</option>`).join('');

  // ---------- 寫入佇列與同步 ----------
  let chain = Promise.resolve();
  const queue = job => (chain = chain.then(job, job));
  const stats = {writes: 0, undos: 0};
  async function sync(id) {
    const g = R.findGame(id) || {};
    const label = `${g.date} vs ${g.opponent}`;
    localCache.set('rebas_all_games', JSON.stringify(allGames));
    const gamesSynced = await commitGamesToGitHub(allGames, `修改賽事紀錄(含投手數據): ${label}`);
    syncAllGamesToTeamLogs();
    const logsSynced = gamesSynced ? await commitLogsToGitHub(allLogs, `連動更新賽事日誌: ${label}`) : (stagePendingChanges(DATA_FILE_PATH, allLogs), false);
    stats.writes++;
    R.cache.drop(id);
    if (!gamesSynced || !logsSynced) {
      showSyncResult(false, '', gamesSynced ? '修改資料尚未完整同步；已保留本機變更，請再次點擊儲存重試。' : '修改資料尚未完整同步：賽事上傳失敗，日誌也先不送出；已保留本機變更，請再次點擊儲存重試。');
    }
    if (typeof renderAll === 'function') renderAll();
    R.redraw();
    return gamesSynced && logsSynced;
  }
  // 改一場：mutate(game) 回傳 false 表示沒有變更。成功後跳出可復原的提示。
  function commit(id, mutate, text) {
    if (R.isLive(id)) { R.toast(LIVE_MSG, 'warning'); return Promise.resolve(false); }
    return queue(async () => {
      const g = R.findGame(id);
      if (!g) return false;
      const before = JSON.stringify(g);
      if (mutate(g) === false || JSON.stringify(g) === before) { R.sheet.close(); return false; }
      R.sheet.close();
      R.snack(`${text}，正在同步…`, null, 'neutral');
      const ok = await sync(id);
      R.snack(ok ? `${text}` : `${text}（尚未完整同步）`, () => undo(id, before), ok ? 'hit' : 'run');
      return ok;
    });
  }
  function undo(id, before) {
    return queue(async () => {
      const i = allGames.findIndex(x => String(x.id) === String(id));
      if (i < 0) return false;
      allGames[i] = JSON.parse(before);
      stats.undos++;
      R.snack('正在復原…', null, 'neutral');
      const ok = await sync(id);
      R.snack(ok ? '已復原' : '已復原（尚未完整同步）', null, ok ? 'neutral' : 'run');
      return ok;
    });
  }
  // 只重算被改的半局；值不同才寫（舊資料原樣保留）。
  function recount(g, inn) {
    const ours = R.ourBat(g, inn);
    const list = ours ? (inn.plateAppearances || []) : (inn.defensiveEvents || []);
    const runs = ours ? list.reduce((t, p) => t + (p.runsScored || 0), 0) : list.reduce((t, e) => t + (e.runs || 0), 0);
    const hits = ours ? list.filter(p => HITS.includes(p.result)).length : list.filter(e => e.type === 'HIT').length;
    if ((Number(inn.runs) || 0) !== runs || inn.runs === undefined) inn.runs = runs;
    if ((Number(inn.hits) || 0) !== hits || inn.hits === undefined) inn.hits = hits;
  }
  const setIf = (obj, key, value) => { if (obj[key] !== value) obj[key] = value; };

  // ---------- 共用的 sheet 片段 ----------
  const chips = (key, list, value, label, tone) => `<div class="v2s-group" role="group" aria-label="${label}"><span class="v2s-label">${label}</span><div class="v2s-chips">${list.map(([v, text]) => `<button type="button" class="v2s-chip${tone ? ` tone-${tone(v)}` : ''}" data-r="set" data-k="${key}" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(text)}</button>`).join('')}</div></div>`;
  const stepper = (key, value, max, label) => `<div class="v2s-group v2s-runs"><span class="v2s-label">${label}</span><div class="v2r-stepper"><button type="button" class="v2s-step" data-r="inc" data-k="${key}" data-d="-1" aria-label="${label}減一"${value <= 0 ? ' disabled' : ''}>−</button><b aria-live="polite">${value}</b><button type="button" class="v2s-step" data-r="inc" data-k="${key}" data-d="1" aria-label="${label}加一"${value >= max ? ' disabled' : ''}>＋</button></div></div>`;
  const foot = (adding, canDelete) => `<div class="v2r-sheet-foot v2r-save-bar">${canDelete ? '<button type="button" class="v2s-danger" data-r="del">刪除</button>' : ''}<button type="button" class="v2s-primary" data-r="save">${adding ? '新增' : '儲存'}</button></div>`;
  function form(state, render, handlers) {
    // 選單與文字欄在重畫前先記下來
    const read = () => R.ui.sheet.querySelectorAll('[data-f]').forEach(el => { state[el.dataset.f] = el.type === 'number' ? el.value : el.value; });
    return Object.assign({
      set: t => { read(); const k = t.dataset.k; state[k] = t.dataset.v; if (handlers.onSet) handlers.onSet(k); R.sheet.set(render()); },
      inc: t => { read(); const k = t.dataset.k; state[k] = Math.max(0, Math.min(state[`${k}Max`] ?? 4, (Number(state[k]) || 0) + Number(t.dataset.d))); R.sheet.set(render()); },
      read
    }, handlers);
  }

  // ---------- 打席 ----------
  function openPa(id, innIdx, i) {
    if (R.isLive(id)) { R.toast(LIVE_MSG, 'warning'); return; }
    const g = R.findGame(id), inn = g && g.innings && g.innings[innIdx];
    if (!inn) return;
    const adding = i === null || i === undefined;
    const pa = adding ? null : (inn.plateAppearances || [])[i];
    if (!adding && !pa) return;
    const batter0 = (g.lineup && g.lineup[0]) || '廖仲毅';
    const state = adding
      ? {result: '1H', trajectory: 'line', location: 'LF', runsScored: 0, batterName: batter0}
      : {result: pa.result, trajectory: pa.trajectory, location: pa.location, runsScored: Number(pa.runsScored) || 0, batterName: pa.batterName};
    const trajs = ['grounder', 'line', 'fly'].concat(state.trajectory === 'popup' ? ['popup'] : [], ['none']);
    const locs = LOCS.includes(state.location) || !state.location ? LOCS : LOCS.concat([state.location]);
    const render = () => R.sheet.head(`${R.halfName(inn.inningNum, inn.topBottom)}・${adding ? '新增打席' : `編輯 ${esc(pa.batterName || '打席')}`}`)
      + '<div class="v2r-form">'
      + chips('result', RESULTS.map(v => [v, v === 'OUT' ? '跑者出局' : (RESULT_NAME[v] || v)]), state.result, '結果', v => TONE[v] || 'out')
      + chips('trajectory', trajs.map(v => [v, TRAJ[v] || v]), state.trajectory, '型態')
      + (state.trajectory === 'none' ? '' : chips('location', locs.map(v => [v, PLACE[v] || v]), state.location, '落點'))
      + stepper('runsScored', state.runsScored, 4, '得分')
      + `<label class="v2s-group v2r-field-row"><span class="v2s-label">打者</span><select class="v2r-select" data-f="batterName">${options(names(g, state.batterName), state.batterName)}</select></label>`
      + '</div>' + foot(adding, !adding);
    const h = form(state, render, {
      save: () => {
        h.read();
        commit(id, game => {
          const half = game.innings[innIdx];
          if (!half) return false;
          if (adding) {
            // 與舊版「＋新增打席」相同的預設物件（G-30），再套上這次選的值。
            const def = {playId: 'play_' + Date.now(), batterName: batter0, slot: 1, result: '1H', trajectory: 'line', location: 'LF', runsScored: 0, outsAdded: 0, outsAtEnd: 0, desc: `${batter0} 擊出一壘安打`};
            def.batterName = state.batterName; def.result = state.result; def.trajectory = state.trajectory;
            if (state.trajectory !== 'none') def.location = state.location;
            def.runsScored = Number(state.runsScored) || 0;
            if (!half.plateAppearances) half.plateAppearances = [];
            half.plateAppearances.push(def);
          } else {
            const p = half.plateAppearances[i];
            setIf(p, 'batterName', state.batterName);
            setIf(p, 'result', state.result);
            setIf(p, 'trajectory', state.trajectory);
            if (state.location && state.trajectory !== 'none') setIf(p, 'location', state.location);
            if ((Number(p.runsScored) || 0) !== (Number(state.runsScored) || 0)) p.runsScored = Number(state.runsScored) || 0;
          }
          recount(game, half);
          return true;
        }, adding ? '已新增打席' : '已儲存');
      },
      del: () => commit(id, game => { const half = game.innings[innIdx]; half.plateAppearances.splice(i, 1); recount(game, half); return true; }, '已刪除打席')
    });
    R.sheet.open('edit-pa', render(), h);
  }

  // ---------- 防守事件 ----------
  function openDef(id, innIdx, i) {
    if (R.isLive(id)) { R.toast(LIVE_MSG, 'warning'); return; }
    const g = R.findGame(id), inn = g && g.innings && g.innings[innIdx];
    if (!inn) return;
    const adding = i === null || i === undefined;
    const d = adding ? null : (inn.defensiveEvents || [])[i];
    if (!adding && !d) return;
    const state = adding
      ? {type: 'GO', outsAdded: 1, runs: 0, pitcher: g.pitcherName || '', desc: '內野滾地刺殺 (+1 出局)'}
      : {type: d.type, outsAdded: Number(d.outsAdded) || 0, runs: Number(d.runs) || 0, pitcher: d.pitcher || '', desc: d.desc || ''};
    state.outsAddedMax = 2;
    const render = () => R.sheet.head(`${R.halfName(inn.inningNum, inn.topBottom)}・${adding ? '新增防守事件' : `編輯防守第 ${i + 1} 筆`}`)
      + '<div class="v2r-form">'
      + chips('type', DEF_TYPES.map(v => [v, DEF_NAME[v] || v]), state.type, '類型', v => TONE[v] || 'neutral')
      + stepper('outsAdded', state.outsAdded, 2, '出局')
      + stepper('runs', state.runs, 4, '失分')
      + `<label class="v2s-group v2r-field-row"><span class="v2s-label">投手</span><select class="v2r-select" data-f="pitcher"><option value=""${state.pitcher ? '' : ' selected'}>—</option>${options(names(g, state.pitcher), state.pitcher)}</select></label>`
      + `<label class="v2s-group v2r-field-row"><span class="v2s-label">說明</span><input class="v2r-input" data-f="desc" maxlength="60" value="${esc(state.desc)}"></label>`
      + '</div>' + foot(adding, !adding);
    const h = form(state, render, {
      onSet: k => { if (k === 'type') state.outsAdded = defaultOuts(state.type); }, // 換類型時出局數回到預設（同舊版）
      save: () => {
        h.read();
        const desc = String(state.desc || '').trim();
        if (typeof rejectUnsafeText === 'function' && rejectUnsafeText(desc)) return;
        commit(id, game => {
          const half = game.innings[innIdx];
          if (!half) return false;
          if (adding) {
            // 與舊版「＋新增防守事件」相同的預設物件（G-32），再套上這次的值。
            const def = {id: 'def_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4), pitcher: game.pitcherName || '', type: 'GO', runs: 0, outsAdded: 1, outsAtEnd: 1, desc: '內野滾地刺殺 (+1 出局)'};
            def.pitcher = state.pitcher; def.type = state.type; def.runs = Number(state.runs) || 0; def.outsAdded = Number(state.outsAdded) || 0; def.desc = desc;
            if (!half.defensiveEvents) half.defensiveEvents = [];
            half.defensiveEvents.push(def);
          } else {
            const e = half.defensiveEvents[i];
            setIf(e, 'pitcher', state.pitcher);
            setIf(e, 'type', state.type);
            if ((Number(e.outsAdded) || 0) !== (Number(state.outsAdded) || 0)) e.outsAdded = Number(state.outsAdded) || 0;
            if ((Number(e.runs) || 0) !== (Number(state.runs) || 0)) e.runs = Number(state.runs) || 0;
            if ((e.desc || '') !== desc) e.desc = desc;
          }
          recount(game, half);
          return true;
        }, adding ? '已新增防守事件' : '已儲存');
      },
      del: () => commit(id, game => { const half = game.innings[innIdx]; half.defensiveEvents.splice(i, 1); recount(game, half); return true; }, '已刪除防守事件')
    });
    R.sheet.open('edit-def', render(), h);
  }

  // ---------- 比賽資訊 ----------
  function openInfo(id) {
    if (R.isLive(id)) { R.toast(LIVE_MSG, 'warning'); return; }
    const g = R.findGame(id);
    if (!g) return;
    const fs = g.finalScore || null;
    const state = {opponent: g.opponent || '', date: g.date || '', tag: g.tag || '', pitcherName: g.pitcherName || '', us: fs ? String(fs.us ?? '') : '', opp: fs ? String(fs.opp ?? '') : ''};
    const input = (f, label, type, extra) => `<label class="v2s-group v2r-field-row"><span class="v2s-label">${label}</span><input class="v2r-input" data-f="${f}" type="${type}" value="${esc(state[f])}"${extra || ''}></label>`;
    const render = () => R.sheet.head('比賽資訊')
      + '<div class="v2r-form">'
      + input('opponent', '對手', 'text', ' maxlength="30"') + input('date', '日期', 'date', '') + input('tag', '標籤', 'text', ' maxlength="40"')
      + `<label class="v2s-group v2r-field-row"><span class="v2s-label">先發投手</span><select class="v2r-select" data-f="pitcherName"><option value=""${state.pitcherName ? '' : ' selected'}>—</option>${options(names(g, state.pitcherName), state.pitcherName)}</select></label>`
      + `<div class="v2s-group v2r-score-row"><span class="v2s-label">比分</span><input class="v2r-input" data-f="us" type="number" inputmode="numeric" min="0" max="99" aria-label="${R.US}得分" value="${esc(state.us)}"><span>:</span><input class="v2r-input" data-f="opp" type="number" inputmode="numeric" min="0" max="99" aria-label="對手得分" value="${esc(state.opp)}"></div>`
      + '</div>' + foot(false, false);
    const h = form(state, render, {
      save: () => {
        h.read();
        const opponent = String(state.opponent).trim(), tag = String(state.tag).trim();
        if (typeof rejectUnsafeText === 'function' && rejectUnsafeText(opponent, tag)) return;
        commit(id, game => {
          setIf(game, 'opponent', opponent);
          if (state.date) setIf(game, 'date', state.date);
          setIf(game, 'tag', tag);
          if ((game.pitcherName || '') !== state.pitcherName) game.pitcherName = state.pitcherName;
          const us = parseInt(state.us, 10), opp = parseInt(state.opp, 10);
          if (game.finalScore) {
            const nu = Number.isFinite(us) ? us : 0, no = Number.isFinite(opp) ? opp : 0;
            if ((Number(game.finalScore.us) || 0) !== nu || game.finalScore.us === undefined) game.finalScore.us = nu;
            if ((Number(game.finalScore.opp) || 0) !== no || game.finalScore.opp === undefined) game.finalScore.opp = no;
          } else if (Number.isFinite(us) || Number.isFinite(opp)) {
            game.finalScore = {us: Number.isFinite(us) ? us : 0, opp: Number.isFinite(opp) ? opp : 0};
          }
          return true;
        }, '已儲存比賽資訊');
      }
    });
    R.sheet.open('edit-info', render(), h);
  }

  window.reviewV2Edit = {openPa, openDef, openInfo, commit, undo, sync, recount, stats, idle: () => chain};
})();
