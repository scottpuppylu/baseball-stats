/* 賽事分析: the third page of 比賽. One game at a time, everything that happened in it: the result and the MVP, key
   moments, the score by half-inning, every plate appearance and every defensive event in order (with substitutions and
   pitching changes), each batter's line, batted balls and how the outs were made, and the pitchers. Built from the
   scorebook record when the page opens, so a new or corrected game shows up by itself. */
(function() {
  'use strict';

  const PAGE_ID = 'panelGames';
  const TEAM = '淡江航太';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const HITS = ['1H', '2H', '3H', 'HR'];
  const REACH = [...HITS, 'BB', 'FC', 'E'];
  const LABEL = {'1H': '一壘安打', '2H': '二壘安打', '3H': '三壘安打', HR: '全壘打', BB: '保送', K: '三振', '界外K': '界外三振', K_FOUL: '界外三振',
    GO: '滾地出局', FO: '飛球出局', LO: '平飛出局', FC: '野手選擇', E: '失誤上壘', DP: '雙殺打', SF: '高飛犧牲打', OUT: '跑壘出局', RUNNER_OUT: '跑壘出局'};
  const SHORT = {'1H': '一安', '2H': '二安', '3H': '三安', HR: '全壘打', BB: '保送', K: '三振', '界外K': '界外K', K_FOUL: '界外K', GO: '滾地', FO: '飛球', LO: '平飛', FC: '野選', DP: '雙殺', SF: '犧飛', E: '失誤'};
  const TRAJ = {line: '平飛', grounder: '滾地', fly: '高飛', popup: '內野飛球'};
  const PLACE = {LF: '左外野', SF: '左中外野', RC: '右中外野', RF: '右外野', '1B': '一壘', '2B': '二壘', '3B': '三壘', SS: '游擊', P: '投手', C: '捕手'};
  const COLOR = {HR: '#f59e0b', '3H': '#a855f7', '2H': '#38bdf8', '1H': '#22c55e', BB: '#cbd5e1', FC: '#cbd5e1', E: '#fbbf24', out: '#fb7185'};
  const DEF = {HIT: ['被安打', '#fb7185'], BB: ['保送', '#fbbf24'], RUN: ['失分', '#f43f5e'], K: ['三振', '#34d399'], '界外K': ['界外三振', '#34d399'],
    FO: ['飛球出局', '#34d399'], GO: ['滾地出局', '#34d399'], LO: ['平飛出局', '#34d399'], DP: ['雙殺', '#34d399'], E: ['失誤', '#fbbf24']};
  const colorOf = r => COLOR[r] || COLOR.out;
  const isRunnerOut = pa => (typeof isRunnerOutPlay === 'function' ? isRunnerOutPlay(pa) : pa.result === 'OUT');
  const tagLabel = tag => String(tag || '').replace(/^場記賽事:\s*/, '') || '比賽';
  let currentId = null;

  // ---------- Analysis ----------
  function finishedGames() {
    return (typeof allGames !== 'undefined' ? allGames : []).filter(g => g.status !== 'in_progress' && (g.innings || []).length)
      .slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.id).localeCompare(String(a.id)));
  }
  function analyse(game) {
    const ourBat = inn => (typeof isInningOurBat === 'function' ? isInningOurBat(game.ourRole, inn.topBottom) : (inn.plateAppearances || []).length > 0);
    const halfIdx = inn => (inn.topBottom === 'top' ? 0 : 1);
    const order = (game.innings || []).slice().sort((a, b) => a.inningNum - b.inningNum || halfIdx(a) - halfIdx(b));
    const scored = typeof isGameScoreRecorded === 'function' ? isGameScoreRecorded(game) : true;
    let us = 0, opp = 0;
    const halves = order.map(inn => {
      const ours = ourBat(inn), before = {us, opp};
      if (ours) us += inn.runs || 0; else opp += inn.runs || 0;
      const subs = (game.substitutions || []).filter(s => s.inning === inn.inningNum && s.half === inn.topBottom);
      return {num: inn.inningNum, half: inn.topBottom, ours, runs: inn.runs || 0, hits: inn.hits || 0, before, after: {us, opp},
        pas: inn.plateAppearances || [], defs: inn.defensiveEvents || [], subs};
    });
    // Plate appearances in order, with the outs before each.
    const plays = [];
    for (const h of halves) for (const pa of h.pas) {
      const after = Number.isFinite(pa.outsAtEnd) ? pa.outsAtEnd : null;
      plays.push({...pa, inning: h.num, outsBefore: after == null ? null : Math.max(0, after - (Number(pa.outsAdded) || 0)), runner: isRunnerOut(pa)});
    }
    const batting = plays.filter(p => !p.runner);
    // Pitchers, from the defensive events.
    const pitchers = new Map();
    for (const h of halves) for (const d of h.defs) {
      const name = d.pitcher || game.pitcherName || '投手';
      if (!pitchers.has(name)) pitchers.set(name, {name, faced: 0, outs: 0, hits: 0, bb: 0, k: 0, runs: 0, innings: new Set()});
      const p = pitchers.get(name);
      p.innings.add(h.num);
      if (d.type !== 'RUN') p.faced++;
      p.outs += Number(d.outsAdded) || 0;
      if (d.type === 'HIT') p.hits++;
      if (d.type === 'BB') p.bb++;
      if (d.type === 'K' || d.type === '界外K') p.k++;
      p.runs += Number(d.runs) || 0;
    }
    const summary = window.teamInsights ? teamInsights.gameSummary(game) : {rows: []};
    const mvp = window.teamInsights ? teamInsights.gameMvp(game, summary.rows) : null;
    const score = game.finalScore || {us: 0, opp: 0};
    return {game, halves, plays, batting, pitchers: [...pitchers.values()], rows: summary.rows, mvp, scored, score,
      hits: batting.filter(p => HITS.includes(p.result)).length, ab: summary.rows.reduce((a, r) => a + (r.ab || 0), 0)};
  }

  // What stood out, strongest first.
  function keyMoments(a) {
    const out = [];
    const ourHalves = a.halves.filter(h => h.ours), oppHalves = a.halves.filter(h => !h.ours);
    const halfName = h => `第 ${h.num} 局${h.half === 'top' ? '上' : '下'}`;
    if (a.mvp) out.push({icon: '🏆', color: '#fbbf24', title: `本場 MVP：${a.mvp.name}`, text: `${a.mvp.line}${a.mvp.tags.length ? `・${a.mvp.tags.join('、')}` : ''}`});
    const best = ourHalves.filter(h => h.runs > 0).sort((x, y) => y.runs - x.runs || y.hits - x.hits)[0];
    if (best && a.scored) out.push({icon: '🔥', color: '#22c55e', title: `${halfName(best)} 攻下 ${best.runs} 分`, text: `這半局 ${best.hits} 支安打，比分來到 ${best.after.us} : ${best.after.opp}`});
    const worst = oppHalves.filter(h => h.runs > 0).sort((x, y) => y.runs - x.runs)[0];
    if (worst && a.scored) out.push({icon: '⚠️', color: '#fb7185', title: `${halfName(worst)} 失 ${worst.runs} 分`, text: `對手這半局 ${worst.defs.filter(d => d.type === 'HIT').length} 支安打、${worst.defs.filter(d => d.type === 'BB').length} 次保送`});
    for (const p of a.batting.filter(p => ['HR', '3H', '2H'].includes(p.result)).slice(0, 4)) {
      out.push({icon: p.result === 'HR' ? '💥' : '⚡', color: colorOf(p.result), title: `${p.batterName} ${LABEL[p.result]}`, text: `第 ${p.inning} 局・${[TRAJ[p.trajectory], PLACE[p.location] && `${PLACE[p.location]}方向`].filter(Boolean).join('・')}`});
    }
    const clutch = a.batting.filter(p => p.outsBefore === 2 && HITS.includes(p.result));
    if (clutch.length) out.push({icon: '🎯', color: '#38bdf8', title: `兩出局後的安打 ${clutch.length} 支`, text: clutch.map(p => `${p.batterName}（第 ${p.inning} 局${SHORT[p.result]}）`).join('、')});
    // Three or more straight batters on base within a half-inning.
    for (const h of ourHalves) {
      let run = 0, best = 0, names = [], bestNames = [];
      for (const p of h.pas.filter(p => !isRunnerOut(p))) {
        if (REACH.includes(p.result)) { run++; names.push(p.batterName); if (run > best) { best = run; bestNames = names.slice(); } } else { run = 0; names = []; }
      }
      if (best >= 3) out.push({icon: '🔗', color: '#a855f7', title: `第 ${h.num} 局連續 ${best} 人上壘`, text: bestNames.join(' → ')});
    }
    const multi = a.rows.filter(r => r.h >= 2);
    if (multi.length) out.push({icon: '✨', color: '#22c55e', title: '單場多安打', text: multi.map(r => `${r.name} ${r.h} 安`).join('、')});
    const rbi = a.batting.filter(p => (Number(p.runsScored) || 0) > 0);
    if (rbi.length) out.push({icon: '🏃', color: '#34d399', title: '有得分的打席', text: rbi.map(p => `${p.batterName}（第 ${p.inning} 局${SHORT[p.result] || p.result}，${p.runsScored} 分）`).join('、')});
    return out.slice(0, 8);
  }

  // ---------- Drawing helpers ----------
  const section = (title, sub, body, extra = '') => `<section class="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4" ${extra}>
      <div><h2 class="text-base sm:text-lg font-black text-white">${title}</h2>${sub ? `<p class="text-xs text-slate-400 mt-1">${sub}</p>` : ''}</div>${body}</section>`;
  const chip = (text, color) => `<span class="ga-chip" style="color:${color};border-color:${color}66;background:${color}14">${esc(text)}</span>`;
  const outsDots = n => `<span class="ga-outs" aria-label="${n} 出局">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  const empty = text => `<p class="text-xs text-slate-500">${text}</p>`;

  // ---------- Game picker: the current game with older / newer, and a searchable list grouped by month ----------
  const pick = {open: false, q: '', year: 'all', tag: 'all', result: 'all'};
  const RESULTS = {win: ['勝', '#22c55e'], loss: ['敗', '#fb7185'], tie: ['和', '#fbbf24'], none: ['未記比分', '#94a3b8'], live: ['進行中', '#38bdf8']};
  function resultOf(g) {
    if (g.status === 'in_progress') return 'live';
    const s = g.finalScore || {us: 0, opp: 0};
    if (typeof isGameScoreRecorded === 'function' && !isGameScoreRecorded(g)) return 'none';
    return s.us > s.opp ? 'win' : s.us < s.opp ? 'loss' : 'tie';
  }
  const scoreText = g => (['none', 'live'].includes(resultOf(g)) ? '' : `${(g.finalScore || {}).us} : ${(g.finalScore || {}).opp} `);
  function filtered(games) {
    const q = pick.q.trim().toLowerCase();
    return games.filter(g => (pick.year === 'all' || (g.date || '').startsWith(pick.year))
      && (pick.tag === 'all' || tagLabel(g.tag) === pick.tag)
      && (pick.result === 'all' || resultOf(g) === pick.result)
      && (!q || `${g.date} ${(g.date || '').slice(5).replace('-', '/')} ${g.opponent || ''} ${tagLabel(g.tag)}`.toLowerCase().includes(q)));
  }
  function browseList(games) {
    const list = filtered(games);
    if (!list.length) return '<p class="text-xs text-slate-500 py-3 text-center">沒有符合的比賽，試試別的關鍵字或篩選。</p>';
    const months = [];
    for (const g of list) {
      const key = (g.date || '').slice(0, 7);
      if (!months.length || months[months.length - 1].key !== key) months.push({key, games: []});
      months[months.length - 1].games.push(g);
    }
    return months.map(m => `<div class="ga-month"><p class="ga-month-head">${esc(m.key.slice(0, 4))} 年 ${Number(m.key.slice(5, 7))} 月 · ${m.games.length} 場</p>${m.games.map(g => {
      const [label, color] = RESULTS[resultOf(g)];
      return `<button type="button" class="ga-row${g.id === currentId ? ' ga-on' : ''}" data-ga-game="${esc(g.id)}" aria-current="${g.id === currentId}">
          <span class="ga-row-date">${esc((g.date || '').slice(5).replace('-', '/'))}</span>
          <span class="ga-row-main"><b>vs ${esc(g.opponent || '對手')}</b><small>${esc(tagLabel(g.tag))}</small></span>
          <span class="ga-row-res" style="color:${color}">${esc(scoreText(g))}${label}</span>
        </button>`;
    }).join('')}</div>`).join('');
  }
  function pickerSection(games) {
    const i = games.findIndex(g => g.id === currentId), g = games[i];
    const [label, color] = RESULTS[resultOf(g)];
    const chips = (kind, values) => values.map(([v, text]) => `<button type="button" class="s3-chip${pick[kind] === v ? ' s3-on' : ''}" data-ga-filter="${kind}:${esc(v)}">${esc(text)}</button>`).join('');
    const years = [...new Set(games.map(x => (x.date || '').slice(0, 4)).filter(Boolean))];
    const tags = [...new Set(games.map(x => tagLabel(x.tag)))];
    return `<section data-ga-part="picker" class="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-3">
        <div class="flex items-center justify-between gap-2"><h2 class="text-base sm:text-lg font-black text-white">選擇比賽</h2>
          <button type="button" class="s3-chip" data-ga="browse" aria-expanded="${pick.open}">${pick.open ? '收合列表' : `全部比賽（${games.length} 場）`}</button></div>
        <div class="ga-current">
          <button type="button" class="ga-step" data-ga-step="1" aria-label="上一場（較舊）"${i >= games.length - 1 ? ' disabled' : ''}>‹</button>
          <div class="ga-current-info"><small>${esc(g.date)} · ${esc(tagLabel(g.tag))}</small><b>vs ${esc(g.opponent || '對手')}</b><span style="color:${color}">${esc(scoreText(g))}${label}</span></div>
          <button type="button" class="ga-step" data-ga-step="-1" aria-label="下一場（較新）"${i <= 0 ? ' disabled' : ''}>›</button>
        </div>
        ${pick.open ? `<div class="ga-browse">
          <input type="search" data-ga-search value="${esc(pick.q)}" placeholder="搜尋對手、日期或賽事（例如 運管、10/31）" class="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-xl px-3 py-2.5 text-sm" aria-label="搜尋比賽">
          <div class="s3-row">${chips('year', [['all', '全部年份'], ...years.map(y => [y, `${y} 年`])])}</div>
          <div class="s3-row">${chips('tag', [['all', '全部賽事'], ...tags.map(t => [t, t])])}</div>
          <div class="s3-row">${chips('result', [['all', '全部結果'], ['win', '勝'], ['loss', '敗'], ['tie', '和'], ['none', '未記比分'], ['live', '進行中']])}</div>
          <div class="ga-browse-list" role="list">${browseList(games)}</div>
        </div>` : ''}
      </section>`;
  }

  function hero(a) {
    const g = a.game, s = a.score;
    const res = !a.scored ? ['比分未記錄', '#94a3b8'] : s.us > s.opp ? ['勝利', '#22c55e'] : s.us < s.opp ? ['落敗', '#fb7185'] : ['平手', '#fbbf24'];
    const avg = a.ab ? (a.hits / a.ab).toFixed(3).replace(/^0/, '') : '—';
    const stat = (v, label, color = '#f3f5f8') => `<div class="ga-stat"><b style="color:${color}">${v}</b><span>${label}</span></div>`;
    return `<div class="ga-hero">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div><p class="text-xs text-slate-400">${esc(g.date)} · ${esc(tagLabel(g.tag))} · ${esc(g.ourRole || '')}</p>
            <p class="text-xl sm:text-2xl font-black text-white mt-1">${TEAM} <span class="text-slate-500 font-medium">vs</span> ${esc(g.opponent || '對手')}</p></div>
          <div class="text-right">${a.scored ? `<p class="ga-score">${s.us}<span>:</span>${s.opp}</p>` : ''}<p class="text-sm font-bold" style="color:${res[1]}">${res[0]}</p></div>
        </div>
        <div class="ga-stats">${stat(a.batting.length, '打席')}${stat(a.hits, '安打', '#22c55e')}${stat(avg, '打擊率')}${stat(a.batting.filter(p => ['2H', '3H', 'HR'].includes(p.result)).length, '長打', '#f3c766')}${stat(a.batting.filter(p => p.result === 'BB').length, '保送', '#cbd5e1')}${stat(a.mvp ? esc(a.mvp.name) : '—', 'MVP', '#fbbf24')}</div>
        <div class="flex flex-wrap gap-2">
          ${window.spray3d ? '<button type="button" class="s3-chip s3-primary" data-ga="replay">🎬 3D 擊球重播</button>' : ''}
          <button type="button" class="s3-chip" data-ga="download-video">⬇ 下載賽後影片</button>
          <button type="button" class="s3-chip" data-ga="review">📋 場記覆盤與編輯</button>
        </div>
      </div>`;
  }

  // Score after every half-inning (or our hits by inning when no score was kept).
  function scoreChart(a) {
    const halves = a.halves, n = halves.length;
    if (!n) return empty('沒有逐局紀錄。');
    const W = 420, H = 210, L = 28, R = 14, T = 22, B = 30;
    const x = i => L + (W - L - R) * (n === 1 ? 0.5 : i / (n - 1));
    if (!a.scored) {
      const ours = halves.filter(h => h.ours), max = Math.max(1, ...ours.map(h => h.hits));
      const bw = (W - L - R) / Math.max(1, ours.length) * 0.55;
      return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="每局安打">
        ${ours.map((h, i) => { const cx = L + (W - L - R) * (i + 0.5) / ours.length, bh = (H - T - B) * h.hits / max;
          return `<rect x="${cx - bw / 2}" y="${H - B - bh}" width="${bw}" height="${bh}" rx="5" fill="#22c55e" opacity="0.75"/><text x="${cx}" y="${H - B - bh - 6}" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="700">${h.hits}</text><text x="${cx}" y="${H - 10}" text-anchor="middle" fill="#94a3b8" font-size="13">${h.num} 局</text>`; }).join('')}
      </svg><p class="text-[11px] text-slate-500">這場沒有記錄比分，改顯示本隊每局安打。</p>`;
    }
    const max = Math.max(1, a.score.us, a.score.opp);
    const y = v => H - B - (H - T - B) * v / max;
    const path = key => halves.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h.after[key]).toFixed(1)}`).join(' ');
    const grid = Array.from({length: Math.min(max, 6) + 1}, (_, i) => Math.round(max * i / Math.min(max, 6)));
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="比分走勢">
        ${grid.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,0.07)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" fill="#64748b" font-size="12">${v}</text>`).join('')}
        ${halves.map((h, i) => `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" fill="${h.ours ? '#7dd3fc' : '#94a3b8'}" font-size="12">${h.num}${h.half === 'top' ? '上' : '下'}</text>`).join('')}
        <path d="${path('opp')}" fill="none" stroke="#fb7185" stroke-width="3" stroke-linejoin="round"/>
        <path d="${path('us')}" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linejoin="round"/>
        ${halves.map((h, i) => h.runs ? `<circle cx="${x(i)}" cy="${y(h.after[h.ours ? 'us' : 'opp'])}" r="5" fill="${h.ours ? '#38bdf8' : '#fb7185'}"/><text x="${x(i)}" y="${y(h.after[h.ours ? 'us' : 'opp']) - 9}" text-anchor="middle" fill="${h.ours ? '#bae6fd' : '#fecdd3'}" font-size="13" font-weight="700">+${h.runs}</text>` : '').join('')}
      </svg>
      <div class="flex gap-4 text-[11px] text-slate-400"><span><i class="ga-key" style="background:#38bdf8"></i>${TEAM}</span><span><i class="ga-key" style="background:#fb7185"></i>${esc(a.game.opponent || '對手')}</span><span>圓點：該半局得分</span></div>`;
  }
  function lineScore(a) {
    const innings = [...new Set(a.halves.map(h => h.num))].sort((x, y) => x - y);
    const row = (ours, name) => {
      const cells = innings.map(n => { const h = a.halves.find(z => z.num === n && z.ours === ours); return `<td>${h ? (a.scored ? h.runs : h.hits) : '–'}</td>`; }).join('');
      const total = a.scored ? (ours ? a.score.us : a.score.opp) : a.halves.filter(h => h.ours === ours).reduce((s, h) => s + h.hits, 0);
      const hits = a.halves.filter(h => h.ours === ours).reduce((s, h) => s + h.hits, 0);
      return `<tr class="${ours ? 'ga-us' : ''}"><th>${esc(name)}</th>${cells}<td class="ga-total">${total}</td><td>${hits}</td></tr>`;
    };
    const first = a.game.ourRole === '先攻';
    return `<div class="overflow-x-auto"><table class="ga-line"><thead><tr><th>${a.scored ? '局' : '每局安打'}</th>${innings.map(n => `<th>${n}</th>`).join('')}<th>${a.scored ? 'R' : '合計'}</th><th>H</th></tr></thead>
      <tbody>${first ? row(true, TEAM) + row(false, a.game.opponent || '對手') : row(false, a.game.opponent || '對手') + row(true, TEAM)}</tbody></table></div>`;
  }

  // Older records sometimes carry a fielder's name on a single out (the pitcher menu was switched to whoever caught the
  // ball, 2026/10/31). A name is the pitcher when it is on an event only a pitcher has (hit, walk, run, strikeout) or on
  // two events in a row; the half-inning starts with the first such name.
  const FIELDED = ['GO', 'FO', 'DP', 'RUNNER_OUT'];
  const pitches = (defs, i) => !FIELDED.includes(defs[i].type) || (defs[i + 1] && defs[i + 1].pitcher === defs[i].pitcher);
  function startingPitcher(defs) {
    for (let i = 0; i < defs.length; i++) if (defs[i].pitcher && pitches(defs, i)) return defs[i].pitcher;
    return defs[0]?.pitcher || '';
  }
  // Every half-inning, in order.
  function timeline(a) {
    return a.halves.map(h => {
      const head = `<div class="ga-half-head"><span class="ga-inning">${h.num} 局${h.half === 'top' ? '上' : '下'}</span>
          <span class="text-xs ${h.ours ? 'text-sky-300' : 'text-slate-400'}">${h.ours ? '本隊進攻' : `防守${startingPitcher(h.defs) ? `・投手 ${esc(startingPitcher(h.defs))}` : ''}`}</span>
          <span class="ml-auto text-xs font-bold ${h.runs ? 'text-white' : 'text-slate-500'}">${a.scored ? `${h.ours ? '得' : '失'} ${h.runs} 分 · ` : ''}${h.hits} 安</span></div>`;
      const subs = h.subs.map(s => `<div class="ga-note">🔄 換人：第 ${s.slot} 棒 ${esc(s.outPlayer)} → ${esc(s.inPlayer)}</div>`).join('');
      let body;
      if (h.ours) {
        body = h.pas.length ? h.pas.map(pa => {
          const after = Number.isFinite(pa.outsAtEnd) ? Math.min(3, pa.outsAtEnd) : null;
          if (isRunnerOut(pa)) return `<div class="ga-pa"><span class="ga-slot">—</span><span class="ga-name">${esc(pa.batterName || '跑者')}</span>${chip('跑壘出局', COLOR.out)}<span class="ga-how">壘上跑者出局</span>${after != null ? outsDots(after) : ''}</div>`;
          const how = [TRAJ[pa.trajectory], PLACE[pa.location] && pa.trajectory !== 'none' ? `${PLACE[pa.location]}方向` : ''].filter(Boolean).join('・');
          return `<div class="ga-pa"><span class="ga-slot">${pa.slot && pa.slot < 90 ? pa.slot : '替'}</span><span class="ga-name">${esc(pa.batterName)}</span>${chip(LABEL[pa.result] || pa.result, colorOf(pa.result))}<span class="ga-how">${esc(how)}${pa.runsScored ? ` · <b class="text-emerald-300">+${pa.runsScored} 分</b>` : ''}</span>${after != null ? outsDots(after) : ''}</div>`;
        }).join('') : empty('這半局沒有逐打席紀錄。');
      } else {
        // A pitching change is shown only when the new name stays for two events in a row; a name that appears on a single
        // event is shown on that event, as recorded.
        let current = startingPitcher(h.defs);
        body = h.defs.length ? `<div class="flex flex-wrap gap-1.5 items-center">${h.defs.map((d, i) => {
          const [label, color] = DEF[d.type] || [d.desc || d.type, '#94a3b8'];
          let change = '', note = '';
          if (d.pitcher && current && d.pitcher !== current) {
            if (pitches(h.defs, i)) { change = `<span class="ga-note w-full">🔁 換投：${esc(current)} → ${esc(d.pitcher)}</span>`; current = d.pitcher; }
            else note = `・${d.pitcher}`;
          }
          return `${change}${chip(`${d.type === 'RUN' && d.runs ? `失 ${d.runs} 分` : label}${note}`, color)}`;
        }).join('')}</div>` : empty('這半局沒有防守事件紀錄。');
      }
      return `<div class="ga-half${h.ours ? ' ga-half-ours' : ''}">${head}${subs}${body}</div>`;
    }).join('');
  }

  function batters(a) {
    const byName = new Map();
    for (const p of a.plays) if (!p.runner) { if (!byName.has(p.batterName)) byName.set(p.batterName, []); byName.get(p.batterName).push(p); }
    return `<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">${a.rows.filter(r => r.pa > 0).map(r => {
      const list = byName.get(r.name) || [];
      const isMvp = a.mvp && a.mvp.name === r.name;
      const xb = r.h2 + r.h3 + r.hr;
      return `<div class="ga-batter${isMvp ? ' ga-mvp' : ''}">
          <div class="flex items-center gap-2"><span class="ga-slot">${r.isSub ? '替' : r.slot}</span><b class="text-sm text-white">${esc(r.name)}</b>${isMvp ? '<span class="text-[11px] text-amber-300">🏆 MVP</span>' : ''}
            <span class="ml-auto text-xs text-slate-300">${r.ab} 打數 ${r.h} 安${xb ? `・${xb} 長打` : ''}${r.bb ? `・${r.bb} 保送` : ''}${r.k ? `・${r.k} 三振` : ''}</span></div>
          <div class="flex flex-wrap gap-1.5 mt-2">${list.map(p => chip(`${p.inning}局 ${SHORT[p.result] || p.result}`, colorOf(p.result))).join('')}</div>
        </div>`;
    }).join('')}</div>`;
  }

  function battedBalls(a) {
    const balls = a.batting.filter(p => Number.isFinite(p.x) && p.trajectory && p.trajectory !== 'none');
    const archived = typeof isSprayChartArchived === 'function' && isSprayChartArchived(a.game);
    const types = ['line', 'grounder', 'fly', 'popup'].map(k => {
      const list = a.batting.filter(p => p.trajectory === k);
      return {k, n: list.length, h: list.filter(p => HITS.includes(p.result)).length};
    }).filter(t => t.n);
    const max = Math.max(1, ...types.map(t => t.n));
    const outs = {};
    for (const p of a.batting) if (!REACH.includes(p.result)) outs[p.result] = (outs[p.result] || 0) + 1;
    const field = typeof FIELD_BASE_SVG === 'string' && typeof sprayDotsSvg === 'function' && !archived && balls.length
      ? `<div class="relative w-full max-w-[320px] mx-auto aspect-square"><svg viewBox="0 0 400 400" class="w-full h-full rounded-xl border border-slate-800/80">${FIELD_BASE_SVG}${typeof FIELD_LABELS_SVG === 'string' ? FIELD_LABELS_SVG : ''}${sprayDotsSvg(balls, {scale: 0.9, opacity: 0.9, withInning: true})}</svg></div>`
      : empty(archived ? '這場的落點為估計值，已封存不顯示。' : '這場沒有落點紀錄。');
    return `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">${field}
        <div class="space-y-4">
          <div class="space-y-2"><p class="text-xs font-bold text-slate-300">擊球型態（安打 / 擊球）</p>
            ${types.length ? types.map(t => `<div class="ga-bar"><span>${TRAJ[t.k]}</span><div><i style="width:${(t.n / max * 100).toFixed(0)}%"></i><i class="ga-bar-hit" style="width:${(t.h / max * 100).toFixed(0)}%"></i></div><b>${t.h} / ${t.n}</b></div>`).join('') : empty('沒有擊球型態紀錄。')}</div>
          <div class="space-y-2"><p class="text-xs font-bold text-slate-300">出局方式</p>
            <div class="flex flex-wrap gap-1.5">${Object.entries(outs).sort((x, y) => y[1] - x[1]).map(([r, n]) => chip(`${LABEL[r] || r} ${n}`, COLOR.out)).join('') || empty('沒有出局紀錄。')}</div></div>
        </div></div>`;
  }

  function pitching(a) {
    if (!a.pitchers.length) return empty('這場沒有防守事件紀錄。');
    const ip = outs => `${Math.floor(outs / 3)}.${outs % 3}`;
    const oppHalves = a.halves.filter(h => !h.ours);
    return `<div class="overflow-x-auto"><table class="ga-table"><thead><tr><th>投手</th><th>局數</th><th>面對</th><th>被安打</th><th>保送</th><th>三振</th><th>失分</th></tr></thead>
        <tbody>${a.pitchers.map(p => `<tr><th>${esc(p.name)}</th><td>${ip(p.outs)}</td><td>${p.faced}</td><td>${p.hits}</td><td>${p.bb}</td><td>${p.k}</td><td>${p.runs}</td></tr>`).join('')}</tbody></table></div>
      <div class="flex flex-wrap gap-1.5">${oppHalves.map(h => chip(`${h.num} 局${a.scored ? ` 失 ${h.runs}` : ''}・被 ${h.defs.filter(d => d.type === 'HIT').length} 安`, h.runs ? '#fb7185' : '#34d399')).join('')}</div>
      <p class="text-[11px] text-slate-500">依場記的防守事件計算；面對打席不含單獨記錄的失分事件。</p>`;
  }

  // ---------- Postgame image and video, on the page ----------
  const media = new Map(); // game id + record → {image: {url, blob}, video: {url, result}}
  const mediaKey = g => `${g.id}|${JSON.stringify(g.innings)}|${JSON.stringify(g.finalScore)}`;
  const fileBase = g => `淡江航太系壘_${g.date}_vs_${g.opponent || '對手'}`.replace(/[\\/:*?"<>|\s]+/g, '_');
  function videoSection(g) {
    if (!window.gameVideo) return '';
    const m = media.get(mediaKey(g)) || {};
    const ready = !!m.video;
    return section('賽後影片', '每局每個打席的 3D 動畫，最後是賽後成績卡；IG 限動規格、30fps。下載後可直接發限動。', `
      <div class="ga-media">${ready
        ? `<video class="ga-video" controls playsinline muted autoplay loop src="${m.video.url}"></video>`
        : `<div class="ga-video-wait">${m.image ? `<img class="ga-card-img ga-dim" src="${m.image.url}" alt="">` : ''}<button type="button" class="ga-play" data-ga="make-video">▶ 製作並播放賽後影片</button><p class="ga-media-note">影片在這台裝置上製作，不會上傳。</p></div>`}</div>
      <button type="button" class="ga-download" data-ga="download-video">⬇ 下載賽後影片</button>
      <div class="flex flex-wrap gap-2 justify-center">
        <button type="button" class="s3-chip" data-ga="share-video">分享影片</button>
      </div>${ready ? `<p class="text-[11px] text-slate-500 text-center">長 ${Math.round(m.video.result.duration)} 秒；超過 60 秒時 IG 會自動分段。</p>` : ''}`, 'data-ga-part="body"');
  }
  // The postgame image is still here, folded at the end: the video is what people should share.
  function extrasSection(g) {
    const m = media.get(mediaKey(g)) || {};
    return `<section data-ga-part="extras" class="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl">
        <details class="ga-more"><summary><h2 class="inline text-base sm:text-lg font-black text-white">其他下載</h2><span class="text-xs text-slate-400 ml-2">賽後分析圖（圖片）</span></summary>
          <div class="space-y-3 pt-3">
            <div class="ga-media"><img data-ga-card alt="賽後成績圖" class="ga-card-img"${m.image ? ` src="${m.image.url}"` : ''}>${m.image ? '' : '<p class="ga-media-wait">正在產生成績圖…</p>'}</div>
            <div class="flex flex-wrap gap-2 justify-center">
              <button type="button" class="s3-chip" data-ga="download-image">下載圖片</button>
              <button type="button" class="s3-chip" data-ga="share-image">分享圖片</button>
              <button type="button" class="s3-chip" data-ga="download-both">下載圖片＋影片</button>
              <button type="button" class="s3-chip" data-ga="image">放大檢視</button>
            </div>
          </div>
        </details></section>`;
  }
  // The card is drawn once per version of the game and kept while the page is open.
  async function ensureImage(g) {
    const key = mediaKey(g), m = media.get(key) || {};
    if (m.image) return m.image;
    if (!window.teamInsights) return null;
    const assets = window.gameVideo ? await gameVideo.prepareAssets(g) : {mvpPhoto: null};
    const canvas = teamInsights.drawGameImage(g, {mvpPhoto: assets.mvpPhoto});
    await new Promise(resolve => setTimeout(resolve, 0)); // drawing and encoding in separate tasks: taps get answered in between
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    m.image = {blob, url: URL.createObjectURL(blob)};
    media.set(key, m);
    return m.image;
  }
  async function ensureVideo(g) {
    const key = mediaKey(g), m = media.get(key) || {};
    if (m.video) return m.video;
    const result = await gameVideo.gameVideoFor(g.id);
    if (!result) return null;
    m.video = {result, url: URL.createObjectURL(result.blob)};
    media.set(key, m);
    return m.video;
  }
  async function shareFile(blob, name, title) {
    const file = new File([blob], name, {type: blob.type});
    if (navigator.canShare && navigator.canShare({files: [file]})) { try { await navigator.share({files: [file], title}); } catch (error) { /* cancelled */ } return; }
    gameVideo.download(blob, name);
    if (typeof showToast === 'function') showToast('此裝置不支援直接分享，已改為下載');
  }
  async function mediaAction(act, g) {
    const title = `${g.date} vs ${g.opponent || '對手'}`;
    if (act === 'download-image' || act === 'share-image') {
      const img = await ensureImage(g);
      if (!img) return;
      if (act === 'download-image') gameVideo.download(img.blob, `${fileBase(g)}.png`); else await shareFile(img.blob, `${fileBase(g)}.png`, title);
      return;
    }
    if (act === 'make-video' || act === 'download-both') {
      if (act === 'download-both') { const img = await ensureImage(g); if (img) gameVideo.download(img.blob, `${fileBase(g)}.png`); }
      const v = await ensureVideo(g);
      if (v && act === 'download-both') gameVideo.download(v.result.blob, v.result.filename);
      if (v) render();
      return;
    }
    const v = media.get(mediaKey(g))?.video || ((act === 'download-video' || act === 'share-video') ? await ensureVideo(g) : null);
    if (!v) return;
    if (!document.querySelector('#panelGames video.ga-video')) render();
    if (act === 'download-video') gameVideo.download(v.result.blob, v.result.filename);
    if (act === 'share-video') await shareFile(v.result.blob, v.result.filename, `${title} 賽後影片`);
  }

  // ---------- Page ----------
  // The page is direct child sections (the section bar reads them): the picker, the analysis, the scorebook review moved
  // here from 場記 (it keeps its own markup and editing code, so it is never re-rendered by this file), and the extras.
  let reviewSection = null;
  function allGamesNewest() {
    return (typeof allGames !== 'undefined' ? allGames : []).slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.id).localeCompare(String(a.id)));
  }
  function render() {
    const panel = document.getElementById(PAGE_ID);
    if (!panel) return;
    panel.querySelectorAll('[data-ga-part]').forEach(el => el.remove());
    const games = allGamesNewest();
    if (!games.length) {
      panel.insertAdjacentHTML('afterbegin', section('賽事分析', '', empty('還沒有場記比賽。完成一場比賽後，這裡會自動出現詳細分析。'), 'data-ga-part="body"'));
      return;
    }
    if (!games.some(g => g.id === currentId)) currentId = (games.find(g => g.status !== 'in_progress') || games[0]).id;
    // The review below follows the chosen game.
    if (typeof renderSelectedGameReview === 'function' && typeof selectedReviewGameId !== 'undefined' && selectedReviewGameId !== currentId) renderSelectedGameReview(currentId);
    const a = analyse(games.find(g => g.id === currentId));
    const moments = keyMoments(a);
    const part = 'data-ga-part="body"';
    panel.insertAdjacentHTML('afterbegin', pickerSection(games));
    reviewSection.insertAdjacentHTML('beforebegin', [
      section('比賽總覽', '', hero(a), part),
      videoSection(a.game),
      section('關鍵時刻', '這場比賽最值得記住的打席與半局。', moments.length ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">${moments.map(m => `<div class="ga-moment" style="border-color:${m.color}55"><span class="text-xl">${m.icon}</span><div><b class="text-sm" style="color:${m.color}">${esc(m.title)}</b><p class="text-xs text-slate-300 mt-0.5">${esc(m.text)}</p></div></div>`).join('')}</div>` : empty('這場比賽沒有特別的紀錄。'), part),
      section('比分走勢', a.scored ? '每個半局結束後的比分。' : '', scoreChart(a) + lineScore(a), part),
      section('逐局經過', '依時間順序列出每個打席與防守事件；圓點是打席結束時的出局數。', `<div class="space-y-3">${timeline(a)}</div>`, part),
      section('打者表現', '每位打者依序的打席結果。', batters(a), part),
      section('擊球與出局', '本場擊球落點、擊球型態與出局方式。', battedBalls(a), part),
      section('投手與防守', '', pitching(a), part)
    ].join(''));
    reviewSection.insertAdjacentHTML('afterend', extrasSection(a.game));
    // The card is drawn in the background once the page has settled (not during the switch): the video's poster and
    // the image in 其他下載.
    const game = a.game;
    const whenIdle = fn => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(fn, {timeout: 2000}) : fn()), 600);
    if (!media.get(mediaKey(game))?.image) whenIdle(() => currentId === game.id && ensureImage(game).then(img => {
      if (!img || currentId !== game.id) return;
      panel.querySelectorAll('[data-ga-card]').forEach(el => { el.src = img.url; });
      panel.querySelectorAll('.ga-media-wait').forEach(el => el.remove());
      const wait = panel.querySelector('.ga-video-wait');
      if (wait && !wait.querySelector('img')) wait.insertAdjacentHTML('afterbegin', `<img class="ga-card-img ga-dim" src="${img.url}" alt="">`);
    }).catch(error => console.error('[game-analysis] image', error)));
  }
  function choose(id) {
    if (!id) return;
    pick.open = false;
    currentId = id;
    render();
    document.getElementById(PAGE_ID)?.querySelector('[data-ga-part="picker"]')?.scrollIntoView({block: 'nearest'});
  }
  function open(gameId) {
    if (gameId) currentId = gameId;
    switchMainTab('tabGames');
  }

  const nav = document.getElementById('mainNavigation');
  const scorebookButton = document.getElementById('btnTabScorebook');
  const glossaryPanel = document.getElementById('panelGlossary');
  const reviewPanel = document.getElementById('scoreSubPanelReview');
  if (nav && scorebookButton && glossaryPanel && reviewPanel && !document.getElementById(PAGE_ID)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'btnTabGames';
    // The same classes the site's own switch gives its buttons.
    const ACTIVE = 'tab-active text-xs px-3 py-1.5 rounded-lg border font-bold transition flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0';
    const INACTIVE = 'text-slate-400 hover:text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-transparent font-medium transition flex items-center gap-1.5 whitespace-nowrap shrink-0';
    button.className = INACTIVE;
    button.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M7 15l4-4 3 3 5-6"/></svg><span>賽事分析</span>';
    scorebookButton.after(button);
    const panel = document.createElement('div');
    panel.id = PAGE_ID;
    panel.className = 'hidden space-y-6';
    glossaryPanel.before(panel);
    // 歷史賽事覆盤 (with its editor) moves here from 場記; the picker above replaces its game list.
    reviewSection = document.createElement('section');
    reviewSection.id = 'gaReviewSection';
    reviewSection.className = 'bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4';
    reviewSection.innerHTML = '<div><h2 class="text-base sm:text-lg font-black text-white">場記覆盤與編輯</h2><p class="text-xs text-slate-400 mt-1">本場完整場記；按「編輯」可修改打席、守備事件與比分，按儲存後才會寫入。</p></div>';
    reviewSection.appendChild(reviewPanel);
    reviewPanel.classList.remove('hidden');
    reviewPanel.querySelector('#reviewGameSelect')?.parentElement?.classList.add('hidden');
    panel.appendChild(reviewSection);
    // 場記's own tab switch rewrites the button's classes, so it is hidden with a style.
    const oldReviewTab = document.getElementById('btnScoreSubReview');
    if (oldReviewTab) oldReviewTab.style.display = 'none';
    // Any way into 歷史賽事覆盤 (a finished game, an old link) opens this page; 實況 and 噴流圖 switch as before, and the
    // moved review stays visible here.
    const switchSub = window.switchScorebookSubTab;
    window.siteHooks.replace('switchScorebookSubTab', 'game-analysis', subTab => {
      if (subTab !== 'review') { switchSub(subTab); reviewPanel.classList.remove('hidden'); return; }
      if (typeof renderGameReview === 'function') renderGameReview();
      open(typeof selectedReviewGameId !== 'undefined' ? selectedReviewGameId : null);
    });

    panel.addEventListener('click', event => {
      const row = event.target.closest('[data-ga-game]');
      if (row) { choose(row.dataset.gaGame); return; }
      const step = event.target.closest('[data-ga-step]');
      if (step) {
        const games = allGamesNewest(), i = games.findIndex(g => g.id === currentId), next = games[i + Number(step.dataset.gaStep)];
        if (next) choose(next.id);
        return;
      }
      const filter = event.target.closest('[data-ga-filter]');
      if (filter) {
        const [kind, value] = filter.dataset.gaFilter.split(':');
        pick[kind] = value;
        const games = allGamesNewest();
        panel.querySelectorAll('[data-ga-filter]').forEach(b => b.classList.toggle('s3-on', b.dataset.gaFilter === `${b.dataset.gaFilter.split(':')[0]}:${pick[b.dataset.gaFilter.split(':')[0]]}`));
        const list = panel.querySelector('.ga-browse-list');
        if (list) list.innerHTML = browseList(games);
        return;
      }
      const act = event.target.closest('[data-ga]')?.dataset.ga;
      if (act === 'browse') {
        pick.open = !pick.open;
        const old = panel.querySelector('[data-ga-part="picker"]');
        old.insertAdjacentHTML('beforebegin', pickerSection(allGamesNewest()));
        old.remove();
        if (pick.open) panel.querySelector('[data-ga-search]')?.focus({preventScroll: true});
        return;
      }
      const g = (typeof allGames !== 'undefined' ? allGames : []).find(x => x.id === currentId);
      if (!act || !g) return;
      if (act === 'replay') spray3d.open({title: `${g.date} vs ${g.opponent || '對手'} 3D 擊球重播`, gameId: g.id});
      if (act === 'image') teamInsights.openImageModal(g.id);
      if (['download-image', 'share-image', 'make-video', 'download-both', 'download-video', 'share-video'].includes(act)) { mediaAction(act, g); return; }
      if (act === 'review') reviewSection.scrollIntoView({behavior: 'smooth', block: 'start'});
    });
    panel.addEventListener('input', event => {
      if (!event.target.matches('[data-ga-search]')) return;
      pick.q = event.target.value;
      const list = panel.querySelector('.ga-browse-list');
      if (list) list.innerHTML = browseList(allGamesNewest());
    });
    // After the site's own switch (which, for an id it does not know, hides every page and resets every button).
    window.siteHooks.after('switchMainTab', 'game-analysis', tabId => {
      const on = tabId === 'tabGames';
      panel.classList.toggle('hidden', !on);
      button.className = on ? ACTIVE : INACTIVE;
      // Hidden, the page keeps only the review (its editor may hold unsaved changes); the rest is rebuilt when opened.
      if (on) render(); else panel.querySelectorAll('[data-ga-part]').forEach(el => el.remove());
    });
    button.addEventListener('click', () => switchMainTab('tabGames'));
  }
  // The review switching games (its own controls, or after an edit) moves the analysis with it.
  window.siteHooks.after('renderSelectedGameReview', 'game-analysis', gameId => {
    if (!gameId || gameId === currentId) return;
    currentId = gameId;
    if (!document.getElementById(PAGE_ID)?.classList.contains('hidden')) render();
  });
  window.siteHooks.after('renderAll', 'game-analysis', () => { if (!document.getElementById(PAGE_ID)?.classList.contains('hidden')) render(); });

  window.gameAnalysis = {analyse, keyMoments, finishedGames, render, open, choose, current: () => currentId};
})();
