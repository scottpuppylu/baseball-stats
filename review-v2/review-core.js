// review-v2/review-core.js — 新版覆盤的首屏（WO-05 B5）。只在旗標開時、scorebook-v2.js 之後載入。
//
// 畫面：場次選擇（手機與平板直是 sheet；平板橫與桌機左邊常駐清單，看別場 1 下）→ hero（比分、勝敗、line score）
// → 動作列（3D 重播、賽後圖、賽後影片）→ 分段「摘要｜逐局｜打者｜投守」，打開預設摘要（PO-39）。
// 計算沿用 game-analysis.js 的 analyse()／keyMoments()（只讀）；首屏摘要放 review-cache.js（IndexedDB），
// 版本沒變就不重算。打席詳情與編輯（review-detail.js、review-edit.js）在首屏畫完、閒置時才載入。
// spray3d／game-video 首屏不碰：按下動作鍵才取用（need()：已在頁面上就直接用，沒有才 dynamic import，失敗退回 script 標籤）。
// 外殼（scorebook-v2.js）每次換頁和每次 renderAll 都會呼叫 draw()：資料版本、分段、場次都沒變時什麼都不做。
// PO-29：只顯示允許的欄位（不含壘包推進、守備欄位）；PO-31：沒有打擊側。不用 has 選擇器。動畫 1.75×（sheet 240 ms）。
(function () {
  'use strict';
  if (!window.uiV2) return;
  const cache = window.reviewV2Cache || {get() { return null; }, put() {}, drop() {}, keyOf: g => `${g.id}|${JSON.stringify(g).length}`, version: () => ''};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const TEAM = '淡江航太', US = '航太';
  const HC_KEY = 'rebas_ui_v2_hc';
  const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};
  const TONE = Object.assign({K_FOUL: 'out', popup: 'out'}, window.uiV2.RESULT_TONE || {});
  const RESULT_NAME = {'1H': '一安', '2H': '二安', '3H': '三安', HR: '全壘打', BB: '保送', GO: '滾地出局', FO: '飛球接殺', LO: '平飛接殺', K: '三振', '界外K': '界外K',
    K_FOUL: '界外K', DP: '雙殺', FC: '野選', SF: '犧飛', RO: '跑者出局', OUT: '跑者出局', E: '失誤上壘'};
  const DEF_NAME = {K: '三振', GO: '滾地刺殺', FO: '接殺', DP: '雙殺', '界外K': '界外K', RUNNER_OUT: '跑者出局', BB: '保送', HIT: '被安打', RUN: '失分'};
  const TRAJ = {grounder: '滾地', line: '平飛', fly: '高飛', popup: '內野飛球', none: '無'};
  const PLACE = {LF: '左外野', SF: '左中外野', RC: '右中外野', RF: '右外野', '1B': '一壘', '2B': '二壘', '3B': '三壘', SS: '游擊', P: '投手', C: '捕手'};
  const HITS = ['1H', '2H', '3H', 'HR'];
  const TABS = [['summary', '摘要'], ['innings', '逐局'], ['batters', '打者'], ['pitching', '投守']];
  const RESULT = {win: ['勝', 'hit'], loss: ['敗', 'out'], tie: ['和', 'run'], none: ['未記比分', 'neutral'], live: ['進行中', 'on']};

  const games = () => (typeof allGames !== 'undefined' && Array.isArray(allGames) ? allGames : []);
  const newest = () => games().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));
  const findGame = id => games().find(g => String(g.id) === String(id)) || null;
  const scoreOf = g => ({us: Number(g?.finalScore?.us) || 0, opp: Number(g?.finalScore?.opp) || 0});
  const scored = g => (typeof isGameScoreRecorded === 'function' ? isGameScoreRecorded(g) : !!g.finalScore);
  const isRunnerOut = pa => (typeof isRunnerOutPlay === 'function' ? isRunnerOutPlay(pa) : pa.result === 'OUT');
  const ourBat = (g, inn) => (typeof isInningOurBat === 'function' ? isInningOurBat(g.ourRole, inn.topBottom) : (g.ourRole === '先攻') === (inn.topBottom === 'top'));
  const tagLabel = tag => String(tag || '').replace(/^場記賽事:\s*/, '') || '比賽';
  const halfName = (num, half) => `${num} 局${half === 'top' ? '上' : '下'}`;
  const resultOf = g => {
    if (g.status === 'in_progress') return 'live';
    if (!scored(g)) return 'none';
    const s = scoreOf(g);
    return s.us > s.opp ? 'win' : s.us < s.opp ? 'loss' : 'tie';
  };
  const isLive = id => { const g = window.activeGame; return !!(g && g.status === 'in_progress' && String(g.id) === String(id)); };
  // 同一局先上半再下半（B5）：原始 innings 的索引照局數、上下半排。
  function inningOrder(g) {
    return (g.innings || []).map((inn, i) => i)
      .sort((a, b) => (g.innings[a].inningNum - g.innings[b].inningNum) || ((g.innings[a].topBottom === 'top' ? 0 : 1) - (g.innings[b].topBottom === 'top' ? 0 : 1)) || a - b);
  }

  // ---------- 首屏摘要（快取） ----------
  const MOMENT_TONE = {'#22c55e': 'hit', '#34d399': 'hit', '#fb7185': 'out', '#38bdf8': 'on', '#a855f7': 'on', '#fbbf24': 'run'};
  function summarize(g) {
    const ga = window.gameAnalysis;
    const a = ga.analyse(g);
    const moments = ga.keyMoments(a).filter(m => !/MVP/.test(m.title)).slice(0, 6)
      .map(m => ({title: m.title, text: m.text, tone: MOMENT_TONE[m.color] || 'neutral'}));
    return {
      v: 1, id: g.id, scored: !!a.scored, score: scoreOf(g), result: resultOf(g),
      halves: a.halves.map(h => ({num: h.num, half: h.half, ours: h.ours, runs: Number(h.runs) || 0, hits: Number(h.hits) || 0, after: {us: h.after.us, opp: h.after.opp}})),
      mvp: a.mvp ? {name: a.mvp.name, line: a.mvp.line, tags: a.mvp.tags || []} : null,
      moments,
      rows: a.rows.filter(r => r.pa > 0).map(r => ({name: r.name, slot: r.slot, isSub: !!r.isSub, pa: r.pa, ab: r.ab, h: r.h, h2: r.h2, h3: r.h3, hr: r.hr, bb: r.bb, k: r.k})),
      pitchers: a.pitchers.map(p => ({name: p.name, outs: p.outs, faced: p.faced, hits: p.hits, bb: p.bb, k: p.k, runs: p.runs})),
      hits: a.hits
    };
  }
  function summaryOf(g) {
    let s = cache.get(g);
    if (!s) { s = summarize(g); cache.put(g, s); }
    return s;
  }

  // ---------- 狀態 ----------
  const ui = {id: null, tab: 'summary', page: false, sig: '', root: null, body: null, layer: null, sheet: null, snack: null, sheetName: null, snackTimer: 0};

  // ---------- 畫面片段 ----------
  const pill = (text, tone) => `<span class="v2r-pill tone-${tone}">${esc(text)}</span>`;
  function gameLine(g) {
    const r = resultOf(g), s = scoreOf(g);
    const score = ['none', 'live'].includes(r) ? '' : `${s.us}:${s.opp}`;
    return `<span class="v2r-gdate">${esc(String(g.date || '').slice(5).replace('-', '/'))}</span><span class="v2r-gopp">vs ${esc(g.opponent || '對手')}</span>`
      + `<span class="v2r-gscore">${esc(score)}</span>${pill(RESULT[r][0], RESULT[r][1])}`;
  }
  function listMarkup(list) {
    return list.map(g => `<button type="button" class="v2r-gitem${String(g.id) === String(ui.id) ? ' on' : ''}" data-r="game" data-id="${esc(g.id)}"${String(g.id) === String(ui.id) ? ' aria-current="true"' : ''}>${gameLine(g)}</button>`).join('');
  }
  // 逐局紀錄不完整（例如只記到第 2 局，總比分卻是 10:6）：不改資料，畫面上說清楚逐局只記到哪裡。
  function gapOf(s) {
    if (!s.scored || !s.halves.length || ['none', 'live'].includes(s.result)) return null;
    const sum = ours => s.halves.filter(h => h.ours === ours).reduce((t, h) => t + h.runs, 0);
    const us = sum(true), opp = sum(false);
    if (us === s.score.us && opp === s.score.opp) return null;
    return {us, opp, last: Math.max(...s.halves.map(h => h.num))};
  }
  const gapNote = s => { const gp = gapOf(s); return gp ? `<p class="v2r-note v2r-gap">逐局只記到第 ${gp.last} 局，其餘得分沒有逐局紀錄（逐局合計 ${gp.us}:${gp.opp}，總比分 ${s.score.us}:${s.score.opp}）。</p>` : ''; };
  function lineScore(g, s) {
    const nums = [...new Set(s.halves.map(h => h.num))].sort((x, y) => x - y);
    const row = (ours, name) => {
      const cells = nums.map(n => { const h = s.halves.find(z => z.num === n && z.ours === ours); return `<td>${h ? (s.scored ? h.runs : h.hits) : '–'}</td>`; }).join('');
      const halves = s.halves.filter(h => h.ours === ours);
      const total = s.scored ? (ours ? s.score.us : s.score.opp) : halves.reduce((t, h) => t + h.hits, 0);
      // 這一隊完全沒有逐局紀錄時，安打數是「沒記」而不是 0。
      const hits = halves.length ? halves.reduce((t, h) => t + h.hits, 0) : '–';
      return `<tr class="${ours ? 'v2r-us' : ''}"><th scope="row">${esc(name)}</th>${cells}<td class="v2r-tot">${total}</td><td>${hits}</td></tr>`;
    };
    const first = g.ourRole === '先攻';
    const opp = String(g.opponent || '對手');
    const body = first ? row(true, US) + row(false, opp) : row(false, opp) + row(true, US);
    return `<div class="v2r-line" role="region" aria-label="每局比分" tabindex="0"><table><thead><tr><th scope="col">${s.scored ? '局' : '安打'}</th>${nums.map(n => `<th scope="col">${n}</th>`).join('')}<th scope="col">${s.scored ? 'R' : '計'}</th><th scope="col">H</th></tr></thead><tbody>${body}</tbody></table></div>${gapNote(s)}`;
  }
  function hero(g, s) {
    const r = s.result;
    const meta = [g.date, tagLabel(g.tag), g.ourRole].filter(Boolean).map(esc).join('<i aria-hidden="true"> · </i>');
    const score = ['none', 'live'].includes(r)
      ? `<p class="v2r-noscore">${r === 'live' ? '比賽進行中' : '這場沒有記錄比分'}</p>`
      : `<div class="v2r-score"><span class="v2r-team v2r-us">${US}</span><b data-v2r-us>${s.score.us}</b><span class="v2r-colon">:</span><b>${s.score.opp}</b><span class="v2r-team">${esc(g.opponent || '對手')}</span></div>`;
    return `<section class="v2r-hero v2r-card" aria-label="比賽結果"><div class="v2r-meta"><span>${meta}</span>${pill(RESULT[r][0], RESULT[r][1])}</div>${score}${lineScore(g, s)}</section>`;
  }
  const ACTIONS = [['replay', '3D 重播', '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5"/>'],
    ['image', '賽後圖', '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="9.5" r="1.5"/>'],
    ['video', '賽後影片', '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10l5-3v10l-5-3z"/>']];
  const actions = () => `<div class="v2r-actions">${ACTIONS.map(([k, label, icon]) => `<button type="button" class="v2r-act" data-r="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></button>`).join('')}</div>`;
  const tabs = () => `<div class="v2r-tabs" role="tablist" aria-label="覆盤內容">${TABS.map(([k, label]) => `<button type="button" role="tab" id="v2r-tab-${k}" aria-controls="v2r-panel" aria-selected="${ui.tab === k}" data-r="tab" data-tab="${k}">${label}</button>`).join('')}</div>`;

  // 比分走勢：兩條線同分時也分得開——本隊實線＋圓點、對手虛線＋方點，而且上下各錯開 2 px（不只靠顏色，B5）。
  function scoreChart(s, oppName) {
    const halves = s.halves, n = halves.length;
    if (!n) return '<p class="v2r-empty">沒有逐局紀錄。</p>';
    // 字級在 SVG 單位裡放大，讓手機 390 寬（圖約 310 px）時軸字仍 ≥ 11 px。
    const W = 420, H = 210, L = 34, R = 68, T = 28, B = 32;
    const x = i => L + (W - L - R) * (n === 1 ? 0.5 : i / (n - 1));
    // 半局多、間距不夠放「7下」時，每隔幾個才標一次；最後一個一定標。
    const gapX = n > 1 ? (W - L - R) / (n - 1) : W;
    const stride = Math.max(1, Math.ceil(30 / gapX));
    const showX = i => i === n - 1 || (i % stride === 0 && n - 1 - i >= stride);
    if (!s.scored) {
      const ours = halves.filter(h => h.ours), max = Math.max(1, ...ours.map(h => h.hits));
      const bw = (W - L - R) / Math.max(1, ours.length) * 0.5;
      return `<svg class="v2r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="本隊每局安打">${ours.map((h, i) => {
        const cx = L + (W - L - R) * (i + 0.5) / ours.length, bh = (H - T - B) * h.hits / max;
        return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(H - B - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="5" class="v2r-bar"/><text x="${cx.toFixed(1)}" y="${(H - B - bh - 6).toFixed(1)}" text-anchor="middle" class="v2r-cv">${h.hits}</text>${(W - L - R) / ours.length >= 36 || i % 2 === 0 || i === ours.length - 1 ? `<text x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle" class="v2r-cx">${h.num} 局</text>` : ''}`;
      }).join('')}</svg><p class="v2r-note">這場沒有記錄比分，改顯示本隊每局安打。</p>`;
    }
    const max = Math.max(1, s.score.us, s.score.opp, ...halves.map(h => Math.max(h.after.us, h.after.opp)));
    const y = v => H - B - (H - T - B) * v / max;
    const OFF = {us: -2, opp: 2};
    const pts = key => halves.map((h, i) => [x(i), y(h.after[key]) + OFF[key]]);
    const path = key => pts(key).map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
    const step = max <= 6 ? 1 : Math.ceil(max / 6);
    const grid = []; for (let v = 0; v <= max; v += step) grid.push(v);
    const last = halves[n - 1].after;
    const tie = last.us === last.opp;
    // 線尾標籤：中心至少相隔 28（字 16，字框約 22 高，留 4 以上的空隙），分數高的在上、同分時本隊在上，避免兩個標籤或標籤和線擠在一起。
    let cu = y(last.us) + OFF.us, co = y(last.opp) + OFF.opp;
    if (tie || Math.abs(cu - co) < 28) {
      const mid = (cu + co) / 2, usTop = last.us >= last.opp;
      cu = mid + (usTop ? -14 : 14); co = mid + (usTop ? 14 : -14);
    }
    // 下限 H - B：0 分的標籤中心對齊 0 線，不往下壓到 x 軸的「2上」；線尾標籤離最後一點（逐局記到的虛線）9。
    const lo = T + 4, hi = H - B, EX = W - R + 9;
    const shift = Math.max(0, lo - Math.min(cu, co)) - Math.max(0, Math.max(cu, co) - hi);
    const endY = key => (key === 'us' ? cu : co) + shift + 5.5;
    const usPts = pts('us'), oppPts = pts('opp');
    const gp = gapOf(s), halfLabel = h => `${h.num}${h.half === 'top' ? '上' : '下'}`;
    const stop = gp ? `<line x1="${x(n - 1).toFixed(1)}" x2="${x(n - 1).toFixed(1)}" y1="${T - 6}" y2="${H - B}" class="v2r-stop"/><text x="${(x(n - 1) - 6).toFixed(1)}" y="${T - 10}" text-anchor="end" class="v2r-stop-t">逐局記到 ${halfLabel(halves[n - 1])}</text>` : '';
    return `<svg class="v2r-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="比分走勢：${US} ${last.us}、${esc(oppName)} ${last.opp}">
      ${grid.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="v2r-grid"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="v2r-cx">${v}</text>`).join('')}
      ${halves.map((h, i) => showX(i) ? `<text x="${x(i).toFixed(1)}" y="${H - 9}" text-anchor="middle" class="v2r-cx${h.ours ? ' v2r-cx-us' : ''}">${halfLabel(h)}</text>` : '').join('')}
      ${stop}
      <path d="${path('opp')}" class="v2r-l-opp" data-line="opp"/>
      <path d="${path('us')}" class="v2r-l-us" data-line="us"/>
      ${oppPts.map(([px, py], i) => halves[i].runs && !halves[i].ours ? `<rect x="${(px - 4.5).toFixed(1)}" y="${(py - 4.5).toFixed(1)}" width="9" height="9" class="v2r-m-opp"/>` : '').join('')}
      ${usPts.map(([px, py], i) => halves[i].runs && halves[i].ours ? `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" class="v2r-m-us"/>` : '').join('')}
      <text x="${EX}" y="${endY('us').toFixed(1)}" class="v2r-end v2r-end-us">${US} ${last.us}</text>
      <text x="${EX}" y="${endY('opp').toFixed(1)}" class="v2r-end v2r-end-opp">對 ${last.opp}</text>
    </svg>
    <div class="v2r-legend"><span><i class="v2r-k-us" aria-hidden="true"></i>${TEAM}（實線、圓點）</span><span><i class="v2r-k-opp" aria-hidden="true"></i>${esc(oppName)}（虛線、方點）</span><span>點：該半局得分</span></div>${gp ? `<p class="v2r-note v2r-gap">走勢只畫到 ${halfLabel(halves[n - 1])}（逐局 ${last.us}:${last.opp}）；最終比分 ${s.score.us}:${s.score.opp}，其餘得分沒有逐局紀錄。</p>` : ''}`;
  }
  // 關鍵時刻的字不拆開：「簡承均（第 1 局全壘打，2 分）」這種一段一個不斷行單位，段與段（「、」）之間才換行；
  // 其他地方的「第 N 局（上／下）」也整組不斷。分段只看括號外的分隔符號。
  function keepTogether(text) {
    const inning = t => esc(t).replace(/第 \d+ 局[上下]?/g, m => `<span class="v2-nb">${m}</span>`);
    // 段內的「第 N 局」也包一層：全站 ui-comfort.js 的 markNote 會把「字（短括號）」結尾的文字節點改成小字註解（換行），
    // 拆開後段尾的文字節點不再是「（…）」整句，就不會被改。
    const nb = t => `<span class="v2-nb">${inning(t)}</span>`;
    const parts = []; let cur = '', depth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '（') depth++; else if (ch === '）') depth = Math.max(0, depth - 1);
      cur += ch;
      if (!depth && ch === '、') { parts.push(cur); cur = ''; }
    }
    if (cur) parts.push(cur);
    return parts.length > 1 || /（/.test(text) ? parts.map(p => /（/.test(p) ? nb(p) : inning(p)).join('') : inning(text);
  }
  function summaryPanel(g, s) {
    const mvp = s.mvp ? `<div class="v2r-mvp v2r-card"><span class="v2r-kicker">本場 MVP</span><b>${esc(s.mvp.name)}</b><span>${esc(s.mvp.line)}${s.mvp.tags.length ? `・${esc(s.mvp.tags.join('、'))}` : ''}</span></div>` : '';
    const moments = s.moments.length
      ? `<ul class="v2r-moments">${s.moments.map(m => `<li class="tone-${m.tone}"><b>${keepTogether(m.title)}</b><span>${keepTogether(m.text)}</span></li>`).join('')}</ul>`
      : '<p class="v2r-empty">這場比賽沒有特別的紀錄。</p>';
    return `${mvp}<section class="v2r-card"><h3 class="v2r-h">關鍵時刻</h3>${moments}</section>`
      + `<section class="v2r-card"><h3 class="v2r-h">比分走勢</h3>${scoreChart(s, g.opponent || '對手')}</section>`;
  }
  function paRow(g, innIdx, paIdx, pa) {
    const runner = isRunnerOut(pa);
    const code = runner ? 'OUT' : pa.result;
    const how = runner ? '壘上跑者出局' : [TRAJ[pa.trajectory] && pa.trajectory !== 'none' ? TRAJ[pa.trajectory] : '', PLACE[pa.location] && pa.trajectory !== 'none' ? PLACE[pa.location] : ''].filter(Boolean).join('・');
    const runs = Number(pa.runsScored) || 0;
    // 舊資料沒有 slot、只有 batterOrder（只讀來顯示）；兩個都沒有時留白，不標成替補。
    const slot = runner ? '—' : pa.slot ? (pa.slot < 90 ? pa.slot : '替') : (pa.batterOrder || '');
    return `<button type="button" class="v2r-row" data-r="pa" data-inn="${innIdx}" data-i="${paIdx}">`
      + `<span class="v2r-slot">${esc(slot)}</span><span class="v2r-who"><b>${esc(pa.batterName || '跑者')}</b><small>${esc(how || '—')}</small></span>`
      + `<span class="v2r-tag tone-${TONE[code] || 'out'}">${esc(RESULT_NAME[code] || code || '—')}</span>${runs ? `<span class="v2r-run">+${runs}</span>` : ''}<span class="v2r-go" aria-hidden="true">›</span></button>`;
  }
  function defRow(g, innIdx, i, d) {
    const label = d.type === 'RUN' && d.runs ? `失 ${d.runs} 分` : (DEF_NAME[d.type] || d.type || '—');
    const note = [Number(d.outsAdded) ? `+${d.outsAdded} 出局` : '', d.type !== 'RUN' && Number(d.runs) ? `失 ${d.runs} 分` : '', d.pitcher && d.pitcher !== g.pitcherName ? `投手 ${d.pitcher}` : ''].filter(Boolean).join('・');
    return `<button type="button" class="v2r-row" data-r="def" data-inn="${innIdx}" data-i="${i}">`
      + `<span class="v2r-slot">${i + 1}</span><span class="v2r-who"><b>${esc(label)}</b><small>${esc(note || d.desc || '—')}</small></span>`
      + `<span class="v2r-tag tone-${TONE[d.type] || 'neutral'}">${esc(DEF_NAME[d.type] || d.type || '—')}</span><span class="v2r-go" aria-hidden="true">›</span></button>`;
  }
  function inningsPanel(g, s) {
    const order = inningOrder(g);
    if (!order.length) return '<p class="v2r-empty">沒有逐局紀錄。</p>';
    const editable = !isLive(g.id);
    return gapNote(s) + order.map(idx => {
      const inn = g.innings[idx], ours = ourBat(g, inn);
      const list = ours ? (inn.plateAppearances || []) : (inn.defensiveEvents || []);
      const head = `<div class="v2r-half-h"><span class="v2r-half-n">${halfName(inn.inningNum, inn.topBottom)}</span>`
        + `<span class="v2r-half-k">${ours ? '本隊進攻' : '防守'}${s.scored ? `・${ours ? '得' : '失'} ${Number(inn.runs) || 0} 分` : ''}・${Number(inn.hits) || 0} 安</span>`
        + (editable ? `<button type="button" class="v2r-add" data-r="${ours ? 'add-pa' : 'add-def'}" data-inn="${idx}" aria-label="${halfName(inn.inningNum, inn.topBottom)}新增${ours ? '打席' : '防守事件'}">＋新增</button>` : '') + '</div>';
      const rows = list.length ? list.map((x, i) => (ours ? paRow(g, idx, i, x) : defRow(g, idx, i, x))).join('') : `<p class="v2r-empty">這半局沒有${ours ? '打席' : '防守事件'}紀錄。</p>`;
      return `<section class="v2r-half v2r-card${ours ? ' v2r-half-us' : ''}" data-half="${inn.inningNum}-${inn.topBottom}">${head}<div class="v2r-rows">${rows}</div></section>`;
    }).join('') + (editable ? '' : '<p class="v2r-note">這場比賽還在記錄中：請在場記修改；結束比賽後才能在覆盤編輯。</p>');
  }
  function battersPanel(g, s) {
    if (!s.rows.length) return '<p class="v2r-empty">這場沒有打席紀錄。</p>';
    const byName = new Map();
    for (const idx of inningOrder(g)) {
      const inn = g.innings[idx];
      if (!ourBat(g, inn)) continue;
      for (const pa of inn.plateAppearances || []) if (!isRunnerOut(pa)) { if (!byName.has(pa.batterName)) byName.set(pa.batterName, []); byName.get(pa.batterName).push({...pa, inning: inn.inningNum}); }
    }
    const head = '<thead><tr><th scope="col">打者</th><th scope="col">打席</th><th scope="col">打數</th><th scope="col">安打</th><th scope="col">長打</th><th scope="col">保送</th><th scope="col">三振</th></tr></thead>';
    const body = s.rows.map(r => {
      const mvp = s.mvp && s.mvp.name === r.name;
      const chips = (byName.get(r.name) || []).map(p => `<span class="v2r-chip tone-${TONE[p.result] || 'out'}">${p.inning}局 ${esc(RESULT_NAME[p.result] || p.result)}</span>`).join('');
      return `<tr${mvp ? ' class="v2r-mvp-row"' : ''}><th scope="row"><span class="v2r-bslot">${esc(r.isSub ? '替' : r.slot)}</span>${esc(r.name)}${mvp ? ' <em>MVP</em>' : ''}</th><td>${r.pa}</td><td>${r.ab}</td><td>${r.h}</td><td>${r.h2 + r.h3 + r.hr}</td><td>${r.bb}</td><td>${r.k}</td></tr>`
        + `<tr class="v2r-chips-row"><td colspan="7"><div class="v2r-chips">${chips}</div></td></tr>`;
    }).join('');
    return `<section class="v2r-card"><h3 class="v2r-h">打者表現</h3><div class="v2r-table" tabindex="0" role="region" aria-label="打者表現"><table>${head}<tbody>${body}</tbody></table></div></section>`;
  }
  function pitchingPanel(g, s) {
    if (!s.pitchers.length) return '<section class="v2r-card"><h3 class="v2r-h">投手與防守</h3><p class="v2r-empty">這場沒有防守事件紀錄。</p></section>';
    const ip = outs => `${Math.floor(outs / 3)}.${outs % 3}`;
    const rows = s.pitchers.map(p => `<tr><th scope="row">${esc(p.name)}</th><td>${ip(p.outs)}</td><td>${p.faced}</td><td>${p.hits}</td><td>${p.bb}</td><td>${p.k}</td><td>${p.runs}</td></tr>`).join('');
    const halves = s.halves.filter(h => !h.ours).map(h => `<span class="v2r-chip tone-${h.runs ? 'run' : 'hit'}">${halfName(h.num, h.half)}${s.scored ? ` 失 ${h.runs}` : ''}・被 ${h.hits} 安</span>`).join('');
    return `<section class="v2r-card"><h3 class="v2r-h">投手與防守</h3><div class="v2r-table" tabindex="0" role="region" aria-label="投手成績"><table><thead><tr><th scope="col">投手</th><th scope="col">局數</th><th scope="col">面對</th><th scope="col">被安打</th><th scope="col">保送</th><th scope="col">三振</th><th scope="col">失分</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + `<div class="v2r-chips">${halves}</div><p class="v2r-note">依場記的防守事件計算；面對打席不含單獨記錄的失分事件。</p></section>`;
  }
  const PANELS = {summary: summaryPanel, innings: inningsPanel, batters: battersPanel, pitching: pitchingPanel};

  // ---------- 畫 ----------
  const hc = () => { try { return localStorage.getItem(HC_KEY) === '1'; } catch (error) { return false; } };
  function pickId(list) {
    if (ui.id && list.some(g => String(g.id) === String(ui.id))) return ui.id;
    const ga = window.gameAnalysis && window.gameAnalysis.current && window.gameAnalysis.current();
    if (ga && list.some(g => String(g.id) === String(ga))) return ga;
    return (list.find(g => g.status !== 'in_progress') || list[0]).id;
  }
  function draw(body, force) {
    if (body) ui.body = body;
    body = ui.body;
    if (!body) return;
    const onPage = document.body.dataset.page === 'Games';
    const shown = onPage && !ui.page;
    if (shown) ui.tab = 'summary'; // 每次打開覆盤都從摘要開始（PO-39）
    ui.page = onPage;
    const list = newest();
    if (!body.classList.contains('v2r-host')) body.classList.add('v2r-host');
    if (!list.length) {
      if (ui.sig !== 'empty') { body.innerHTML = '<div class="v2r v2r-none"><p class="v2r-empty">還沒有已記錄的比賽。完成一場比賽後，這裡會自動出現覆盤。</p></div>'; ui.sig = 'empty'; ui.root = null; }
      return;
    }
    ui.id = pickId(list);
    const g = findGame(ui.id);
    const sig = `${cache.keyOf(g)}|${ui.tab}|${list.length}|${list.map(x => `${x.id}:${resultOf(x)}:${x.date}:${x.opponent}`).join(',').length}|${hc()}|${isLive(g.id)}`;
    if (!force && sig === ui.sig && ui.root && body.contains(ui.root)) { if (shown) paintMark(); return; } // 內容沒變也要記開頁時間（AC-2）
    const s = summaryOf(g);
    ui.sig = sig;
    body.innerHTML = `<div class="v2r${hc() ? ' hc' : ''}" data-v2r data-tab="${ui.tab}">`
      + `<aside class="v2r-list" aria-label="選擇比賽"><h3 class="v2r-h">比賽</h3><div class="v2r-glist">${listMarkup(list)}</div></aside>`
      + '<div class="v2r-main">'
      + `<div class="v2r-pick"><button type="button" class="v2r-step" data-r="step" data-d="1" aria-label="上一場（較早）"${list.findIndex(x => String(x.id) === String(ui.id)) >= list.length - 1 ? ' disabled' : ''}>‹</button>`
      + `<button type="button" class="v2r-cur" data-r="picker" aria-haspopup="dialog">${gameLine(g)}<span class="v2r-caret" aria-hidden="true">▾</span></button>`
      + `<button type="button" class="v2r-step" data-r="step" data-d="-1" aria-label="下一場（較新）"${list.findIndex(x => String(x.id) === String(ui.id)) <= 0 ? ' disabled' : ''}>›</button>`
      + '<button type="button" class="v2r-step v2r-more" data-r="menu" aria-label="更多：比賽資訊、日誌、刪除" aria-haspopup="dialog">⋯</button></div>'
      + hero(g, s) + actions() + tabs()
      + `<div class="v2r-panel" id="v2r-panel" role="tabpanel" aria-labelledby="v2r-tab-${ui.tab}">${PANELS[ui.tab](g, s)}</div>`
      + '</div></div>';
    ui.root = body.firstElementChild;
    if (ui.layer) ui.layer.classList.toggle('hc', hc());
    paintMark();
  }
  // AC-2：首屏畫完（內容進 DOM）與下一個畫格（雙 rAF）各打一個 mark，量測從換頁到這裡。
  function paintMark() {
    try { performance.mark('review-v2:drawn'); } catch (error) { /* ignore */ }
    requestAnimationFrame(() => requestAnimationFrame(() => { try { performance.mark('review-v2:paint'); } catch (error) { /* ignore */ } }));
    if (!ui.lazy) {
      ui.lazy = true;
      const idle = window.requestIdleCallback || (fn => setTimeout(fn, 400));
      idle(() => need.files(['review-v2/review-detail.js', 'review-v2/review-edit.js']).catch(() => {}), {timeout: 2000});
    }
  }
  const redraw = () => draw(null, true);

  // ---------- 載入（spray3d、game-video、詳情與編輯） ----------
  const loading = {};
  function script(src) {
    if (loading[src]) return loading[src];
    loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => resolve(); s.onerror = () => { delete loading[src]; reject(new Error(`load ${src}`)); };
      document.body.appendChild(s);
    });
    return loading[src];
  }
  // 已在頁面上（index.html 一直同步載入 spray3d.js、game-video.js）就直接用；沒有才 dynamic import，失敗退回 script 標籤。
  async function need(name, src) {
    if (window[name]) return window[name];
    try { await import(new URL(src, document.baseURI).href); } catch (error) { await script(src); }
    if (!window[name]) await script(src);
    return window[name];
  }
  need.files = files => Promise.all(files.map(script));
  async function needEdit() {
    if (!window.reviewV2Detail || !window.reviewV2Edit) await need.files(['review-v2/review-detail.js', 'review-v2/review-edit.js']);
    return {detail: window.reviewV2Detail, edit: window.reviewV2Edit};
  }

  // ---------- Sheet 與復原提示（掛在 body 下，蓋整個畫面） ----------
  function ensureLayer() {
    if (ui.layer) return;
    const layer = document.createElement('div');
    layer.className = `v2r-layer${hc() ? ' hc' : ''}`;
    layer.hidden = true;
    layer.innerHTML = '<div class="v2r-scrim" data-r="close"></div><div class="v2r-sheet" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(layer);
    const snack = document.createElement('div');
    snack.className = `v2r-snackbox${hc() ? ' hc' : ''}`;
    snack.hidden = true;
    snack.setAttribute('role', 'status');
    snack.setAttribute('aria-live', 'polite');
    document.body.appendChild(snack);
    ui.layer = layer; ui.sheet = layer.querySelector('.v2r-sheet'); ui.snack = snack;
    layer.addEventListener('click', onClick);
    snack.addEventListener('click', onClick);
  }
  const sheetHead = (title, tone) => `<div class="v2s-head${tone ? ` tone-${tone}` : ''}"><h3 class="v2s-title">${title}</h3><button type="button" class="v2s-x v2r-x" data-r="close" aria-label="關閉">×</button></div>`;
  const sheetHandlers = {};
  // 全站的點擊光暈（ui-theme.js 的 #flRipple，560 ms）蓋在最上層、固定在按下的位置。sheet 內容一換，按下的按鈕
  // 已經不在那裡，光暈會變成浮在別的控制項（例如「無」和得分列）上的白霧，所以開新 sheet（含「編輯」換成表單）時一併收掉；表單內點選項（setSheet，原位重畫）照常保留光暈。
  const dropRipple = () => { try { const o = document.getElementById('flRipple'); if (o) o.getAnimations({subtree: true}).forEach(a => a.cancel()); } catch (error) { /* ignore */ } };
  function openSheet(name, html, handlers) {
    dropRipple();
    ensureLayer();
    ui.layer.classList.toggle('hc', hc());
    ui.sheetName = name;
    ui.sheetFocus = document.activeElement;
    Object.keys(sheetHandlers).forEach(k => delete sheetHandlers[k]);
    Object.assign(sheetHandlers, handlers || {});
    ui.sheet.innerHTML = html;
    ui.sheet.setAttribute('aria-label', ui.sheet.querySelector('.v2s-title')?.textContent || '');
    ui.layer.dataset.sheet = name;
    ui.layer.classList.toggle('v2r-rise', !reducedMotion.matches);
    ui.layer.hidden = false;
    document.body.classList.add('v2r-sheet-on');
    const first = ui.sheet.querySelector('[data-autofocus]') || ui.sheet.querySelector('button:not([disabled])');
    if (first) first.focus({preventScroll: true});
    try { performance.mark('review-v2:sheet'); } catch (error) { /* ignore */ }
  }
  function setSheet(html) { if (ui.sheet) { const top = ui.sheet.scrollTop; ui.sheet.innerHTML = html; ui.sheet.scrollTop = top; } }
  function closeSheet() {
    if (!ui.layer || ui.layer.hidden) return;
    ui.layer.hidden = true;
    ui.sheet.innerHTML = '';
    ui.sheetName = null;
    Object.keys(sheetHandlers).forEach(k => delete sheetHandlers[k]);
    document.body.classList.remove('v2r-sheet-on');
    const back = ui.sheetFocus;
    ui.sheetFocus = null;
    if (back && document.body.contains(back)) back.focus({preventScroll: true});
  }
  // 復原提示：6 秒，可按「復原」。
  function snack(text, onUndo, tone) {
    ensureLayer();
    clearTimeout(ui.snackTimer);
    ui.snackUndo = onUndo || null;
    ui.snack.classList.toggle('hc', hc());
    ui.snack.className = `v2r-snackbox${hc() ? ' hc' : ''} tone-${tone || 'neutral'}`;
    ui.snack.innerHTML = `<span class="v2r-snack-t">${esc(text)}</span>${onUndo ? '<button type="button" class="v2r-undo" data-r="undo">復原</button>' : ''}<i class="v2r-drain" aria-hidden="true"></i>`;
    ui.snack.hidden = false;
    ui.snackTimer = setTimeout(hideSnack, 6000);
  }
  function hideSnack() { clearTimeout(ui.snackTimer); ui.snackUndo = null; if (ui.snack) { ui.snack.hidden = true; ui.snack.innerHTML = ''; } }
  function toast(text, type) { if (typeof showToast === 'function') showToast(text, type || 'info'); }

  // ---------- 動作 ----------
  function choose(id) {
    if (!id || String(id) === String(ui.id)) { closeSheet(); return; }
    ui.id = id;
    closeSheet();
    redraw();
    ui.root?.querySelector('.v2r-pick')?.scrollIntoView?.({block: 'nearest'});
  }
  function pickerSheet() {
    openSheet('picker', sheetHead('選擇比賽') + `<div class="v2r-glist v2r-glist-sheet">${listMarkup(newest())}</div>`);
    ui.sheet.querySelector('.v2r-gitem.on')?.scrollIntoView({block: 'nearest'});
  }
  function menuSheet() {
    const g = findGame(ui.id);
    if (!g) return;
    const live = isLive(g.id);
    const logged = typeof isGameAlreadyLogged === 'function' && isGameAlreadyLogged(g.id);
    const item = (act, label, note, danger) => `<button type="button" class="v2s-item${danger ? ' v2s-danger' : ''}" data-r="${act}"${live && act !== 'download' ? ' disabled' : ''}><span>${label}</span>${note ? `<small>${note}</small>` : ''}</button>`;
    openSheet('menu', sheetHead(`${esc(g.date)} vs ${esc(g.opponent || '對手')}`)
      + (live ? '<p class="v2s-hint">這場比賽還在記錄中：請在場記修改；結束比賽後才能在覆盤編輯。</p>' : '')
      + '<div class="v2r-menu">'
      + item('info', '編輯比賽資訊', '對手、日期、標籤、先發投手、比分')
      + (logged ? item('unlog', '自全隊日誌撤銷', '扣除本場成績') : item('log', '登入全隊日誌', '把本場成績算進全隊與個人數據'))
      + item('download', '下載賽後圖', 'PNG 圖片')
      + item('delete', '刪除這場比賽', '連同日誌一起刪除，無法復原', true)
      + '</div>');
  }
  // 日誌登入／撤銷、刪除：沿用舊版的函式（確認對話框、上傳與失敗處理都相同）；先把舊版選中的場次指到這一場。
  async function legacy(fnName, id) {
    const fn = window[fnName];
    if (typeof fn !== 'function') return;
    closeSheet();
    if (isLive(id)) { toast('這場比賽還在記錄中：請在場記修改；結束比賽後才能在覆盤編輯。', 'warning'); return; }
    if (typeof selectedReviewGameId !== 'undefined') selectedReviewGameId = id; // eslint-disable-line no-global-assign
    try { await (fnName === 'undoGameFromTeamLogs' ? fn(id) : fn()); } finally { cache.drop(id); redraw(); }
  }
  async function media(kind) {
    const g = findGame(ui.id);
    if (!g) return;
    const title = `${g.date} vs ${g.opponent || '對手'}`;
    try {
      if (kind === 'replay') { const s3 = await need('spray3d', 'spray3d.js'); s3.open({title: `${title} 3D 擊球重播`, gameId: g.id}); return; }
      if (kind === 'image') { if (window.teamInsights) teamInsights.openImageModal(g.id); return; }
      if (kind === 'video') { const gv = await need('gameVideo', 'game-video.js'); const result = await gv.gameVideoFor(g.id); if (result) gv.showResult(result, `${title} 賽後影片`); return; }
      if (kind === 'download') {
        closeSheet();
        if (!window.teamInsights) return;
        const gv = await need('gameVideo', 'game-video.js');
        const assets = gv.prepareAssets ? await gv.prepareAssets(g) : {mvpPhoto: null};
        const canvas = teamInsights.drawGameImage(g, {mvpPhoto: assets.mvpPhoto});
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (blob) gv.download(blob, `淡江航太系壘_${g.date}_vs_${g.opponent || '對手'}.png`.replace(/[\\/:*?"<>|\s]+/g, '_'));
      }
    } catch (error) { console.error('[review-v2]', kind, error); toast('這個功能暫時無法使用，請稍後再試。', 'error'); }
  }

  async function onClick(event) {
    const t = event.target.closest('[data-r]');
    if (!t || t.disabled) return;
    const act = t.dataset.r;
    if (sheetHandlers[act]) { sheetHandlers[act](t, event); return; }
    const id = ui.id;
    switch (act) {
      case 'close': closeSheet(); break;
      case 'undo': { const fn = ui.snackUndo; hideSnack(); if (fn) fn(); break; }
      case 'game': choose(t.dataset.id); break;
      case 'picker': pickerSheet(); break;
      case 'step': {
        const list = newest(), i = list.findIndex(x => String(x.id) === String(id)), next = list[i + Number(t.dataset.d)];
        if (next) choose(next.id);
        break;
      }
      case 'tab':
        if (ui.tab !== t.dataset.tab) {
          ui.tab = t.dataset.tab; redraw();
          ui.root?.querySelector(`[data-tab="${ui.tab}"]`)?.focus({preventScroll: true});
        }
        break;
      case 'menu': menuSheet(); break;
      case 'replay': case 'image': case 'video': case 'download': media(act); break;
      case 'log': legacy('syncReviewGameToTeamLogs', id); break;
      case 'unlog': legacy('undoGameFromTeamLogs', id); break;
      case 'delete': legacy('deleteReviewGame', id); break;
      case 'info': { const m = await needEdit(); m.edit.openInfo(id); break; }
      case 'pa': { const m = await needEdit(); m.detail.openPa(id, Number(t.dataset.inn), Number(t.dataset.i)); break; }
      case 'def': { const m = await needEdit(); m.detail.openDef(id, Number(t.dataset.inn), Number(t.dataset.i)); break; }
      case 'add-pa': { const m = await needEdit(); m.edit.openPa(id, Number(t.dataset.inn), null); break; }
      case 'add-def': { const m = await needEdit(); m.edit.openDef(id, Number(t.dataset.inn), null); break; }
      default: break;
    }
  }
  const mainEl = document.querySelector('#appWorkspace main');
  if (mainEl) mainEl.addEventListener('click', event => { if (event.target.closest('.v2r')) onClick(event); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && ui.layer && !ui.layer.hidden) { event.preventDefault(); closeSheet(); } });
  // 離開覆盤頁就收起 sheet 與提示。
  new MutationObserver(() => { if (document.body.dataset.page !== 'Games') { closeSheet(); ui.page = false; } }).observe(document.body, {attributes: true, attributeFilter: ['data-page']});

  window.reviewV2 = {
    ui, esc, TONE, RESULT_NAME, DEF_NAME, TRAJ, PLACE, HITS, US,
    games, findGame, isLive, ourBat, isRunnerOut, halfName, inningOrder, summarize, summaryOf,
    draw, redraw, need, sheet: {open: openSheet, set: setSheet, close: closeSheet, head: sheetHead, handlers: sheetHandlers}, snack, hideSnack, toast,
    cache
  };
  window.uiV2.register('review', body => draw(body));
})();
