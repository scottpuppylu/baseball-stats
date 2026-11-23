// review-v2/review-detail.js — 打席與防守事件的詳情 sheet（WO-05 B5）。首屏畫完、閒置時才載入。
//
// 打席詳情：結果、型態、落點、得分，有座標時畫落點（沿用 index.html 的 FIELD_BASE_SVG／sprayDotsSvg，只讀）。
// 「3D 看這一球」：開單場 3D 重播，把時間軸跳到這一球之前（state.time＝前面每一球的長度總和），不改 spray3d.js。
// 「編輯」：交給 review-edit.js。點擊數：逐局(1) → 打席(2) → 編輯(3) → 選結果(4) → 儲存(5)。
// PO-29：只顯示允許的欄位（不含壘包推進、守備欄位）。
(function () {
  'use strict';
  const R = window.reviewV2;
  if (!R) return;
  const {esc, TONE, RESULT_NAME, DEF_NAME, TRAJ, PLACE} = R;

  function field(pa) {
    if (!Number.isFinite(pa.x) || !Number.isFinite(pa.y) || pa.trajectory === 'none' || R.isRunnerOut(pa)) return '';
    const base = typeof FIELD_BASE_SVG === 'string' ? FIELD_BASE_SVG : '<rect width="400" height="400" fill="#0d1712"/>';
    const dot = typeof sprayDotsSvg === 'function' ? sprayDotsSvg([pa], {scale: 1.3, opacity: 1}) : `<circle cx="${pa.x * 400}" cy="${pa.y * 400}" r="8" fill="#f43f5e"/>`;
    return `<svg class="v2r-field" viewBox="0 0 400 400" role="img" aria-label="落點">${base}${dot}</svg>`;
  }
  const fact = (k, v) => `<div class="v2r-fact"><span>${k}</span><b>${esc(v)}</b></div>`;

  function openPa(id, innIdx, i) {
    const g = R.findGame(id), inn = g && g.innings && g.innings[innIdx], pa = inn && (inn.plateAppearances || [])[i];
    if (!pa) return;
    const runner = R.isRunnerOut(pa), code = runner ? 'OUT' : pa.result;
    const live = R.isLive(id);
    const facts = [
      fact('結果', RESULT_NAME[code] || code || '—'),
      runner ? '' : fact('型態', TRAJ[pa.trajectory] || pa.trajectory || '—'),
      runner || pa.trajectory === 'none' ? '' : fact('落點', PLACE[pa.location] || pa.location || '—'),
      fact('得分', String(Number(pa.runsScored) || 0))
    ].join('');
    const can3d = !runner && pa.trajectory !== 'none' && Number.isFinite(pa.x) && Number.isFinite(pa.y);
    R.sheet.open('pa', R.sheet.head(`${R.halfName(inn.inningNum, inn.topBottom)}・${esc(pa.batterName || '跑者')}`, TONE[code] || 'out')
      + `<div class="v2r-detail">${field(pa)}<div class="v2r-facts">${facts}</div>${pa.desc ? `<p class="v2r-desc">${esc(pa.desc)}</p>` : ''}</div>`
      + (live ? '<p class="v2s-hint">這場比賽還在記錄中：請在場記修改；結束比賽後才能在覆盤編輯。</p>' : '')
      + '<div class="v2r-sheet-foot">'
      + (can3d ? '<button type="button" class="v2s-secondary" data-r="ball3d">3D 看這一球</button>' : '')
      + `<button type="button" class="v2s-primary" data-r="edit"${live ? ' disabled' : ''} data-autofocus>編輯</button></div>`, {
      ball3d: () => ball3d(id, innIdx, i),
      edit: () => window.reviewV2Edit.openPa(id, innIdx, i)
    });
  }

  function openDef(id, innIdx, i) {
    const g = R.findGame(id), inn = g && g.innings && g.innings[innIdx], d = inn && (inn.defensiveEvents || [])[i];
    if (!d) return;
    const live = R.isLive(id);
    const facts = [fact('類型', DEF_NAME[d.type] || d.type || '—'), fact('出局', String(Number(d.outsAdded) || 0)), fact('失分', String(Number(d.runs) || 0)), fact('投手', d.pitcher || g.pitcherName || '—')].join('');
    R.sheet.open('def', R.sheet.head(`${R.halfName(inn.inningNum, inn.topBottom)}・防守第 ${i + 1} 筆`, TONE[d.type] || 'neutral')
      + `<div class="v2r-detail"><div class="v2r-facts">${facts}</div>${d.desc ? `<p class="v2r-desc">${esc(d.desc)}</p>` : ''}</div>`
      + (live ? '<p class="v2s-hint">這場比賽還在記錄中：請在場記修改；結束比賽後才能在覆盤編輯。</p>' : '')
      + `<div class="v2r-sheet-foot"><button type="button" class="v2s-primary" data-r="edit"${live ? ' disabled' : ''} data-autofocus>編輯</button></div>`, {
      edit: () => window.reviewV2Edit.openDef(id, innIdx, i)
    });
  }

  // 3D 看這一球：spray3d 依 innings 陣列順序收集打席（略過跑者出局），單場以連播（seq）開啟。
  // 這裡算出這一球在連播中的序號，把時間軸放到它之前所有球的長度總和。
  async function ball3d(id, innIdx, i) {
    const g = R.findGame(id);
    if (!g) return;
    let order = -1, n = 0;
    (g.innings || []).forEach((inn, a) => (inn.plateAppearances || []).forEach((pa, b) => {
      if (R.isRunnerOut(pa)) return;
      if (a === innIdx && b === i) order = n;
      n++;
    }));
    R.sheet.close();
    try {
      const s3 = await R.need('spray3d', 'spray3d.js');
      s3.open({title: `${g.date} vs ${g.opponent || '對手'} 3D 擊球重播`, gameId: g.id, mode: 'seq'});
      const st = s3.state && s3.state();
      if (st && Array.isArray(st.plays) && order >= 0) {
        // 單場連播的 plays 與收集順序相同；找不到對應長度時就從頭播。
        let t = 0;
        for (let k = 0; k < Math.min(order, st.plays.length); k++) t += Number(st.plays[k] && st.plays[k].length) || 0;
        st.time = order > 0 ? t + 0.01 : 0; // locate() 用「大於」判斷換球，多 0.01 秒才會落在這一球
      }
    } catch (error) { console.error('[review-v2] 3D', error); R.toast('3D 重播暫時無法使用，請稍後再試。', 'error'); }
  }

  window.reviewV2Detail = {openPa, openDef, ball3d};
})();
