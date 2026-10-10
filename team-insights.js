/* Read-only insight layer: game logs, small-sample notes and post-game images.
   It reuses the site's own aggregation, never writes game data and never calls cloud APIs. */
(() => {
  'use strict';
  // Rate stats below this many PA swing heavily; about six or seven games for this team.
  const SAMPLE_PA = 20;
  const RECENT_GAMES = 5;
  const TEAM_NAME = '淡江航太系壘';
  const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  // Team badge for the post-game image; loaded once, and the image is drawn without it if it fails.
  const LOGO = typeof Image === 'function' ? new Image() : null;
  const logoReady = LOGO ? new Promise(resolve => { LOGO.onload = LOGO.onerror = resolve; LOGO.src = 'assets/logo-256.webp'; }) : Promise.resolve();
  const logoLoaded = () => !!(LOGO && LOGO.complete && LOGO.naturalWidth > 0);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const rate = value => (Number.isFinite(value) ? value : 0).toFixed(3).replace(/^0\./, '.');
  const gameLabel = tag => String(tag || '').replace(/^場記賽事:\s*/, '') || '手動紀錄';
  const statsFor = logs => getAggregatedStats(logs).players[0];

  function sampleNoteHtml(name, pa) {
    return `<div class="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
      <span aria-hidden="true">⚠️</span>
      <span><b>${esc(name)}</b> 目前 ${pa} 個打席，未滿 ${SAMPLE_PA}：打擊率等比率與進階指標（wRC+、xwOBA、PR 百分位…）波動大，僅供參考。</span>
    </div>`;
  }

  // ---------- 1. Player game log and recent form ----------
  // Scorebook logs carry their game id (field or id prefix), so two games on one day stay apart.
  const gameIdOf = log => log.gameId || (String(log.id || '').match(/^log_(?:game|auto)_(.+)_[^_]+$/) || [])[1] || '';
  // Manual season totals such as "114年度總數據" are not single games.
  const isSummaryTag = tag => /總數據|彙總|總計/.test(String(tag || ''));

  function playerGames(name, logs = getFilteredLogs()) {
    const groups = new Map();
    for (const log of logs) {
      if (log.name !== name) continue;
      const key = gameIdOf(log) || `${log.date}|${log.tag || ''}`;
      if (!groups.has(key)) groups.set(key, {key, date: log.date, tag: log.tag, summary: isSummaryTag(log.tag), logs: []});
      groups.get(key).logs.push(log);
    }
    const games = [...groups.values()]
      .filter(g => g.logs.some(l => Number(l.pa) > 0)) // registration entries have no plate appearances
      .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
    const running = [];
    return games.map(game => {
      running.push(...game.logs);
      return {...game, stats: statsFor(game.logs), toDate: statsFor(running)};
    });
  }

  // ---------- 1b. Streaks, single-game highs and career milestones ----------
  const HIT_MILESTONES = [10, 25, 50, 75, 100, 150, 200, 300];
  const totalBases = s => s.h + s.h2 + 2 * s.h3 + 3 * s.hr;

  // Streaks over single games in order. A game with no at-bat (only walks or sacrifice flies) neither
  // extends nor breaks a hitting streak; any game with a plate appearance counts for the on-base streak.
  function streaks(games) {
    const run = {hit: 0, onBase: 0}, best = {hit: 0, onBase: 0};
    for (const g of games) {
      if (g.summary) continue;
      const s = g.stats;
      if (s.ab > 0) run.hit = s.h > 0 ? run.hit + 1 : 0;
      if (s.pa > 0) run.onBase = s.h + s.bb > 0 ? run.onBase + 1 : 0;
      best.hit = Math.max(best.hit, run.hit);
      best.onBase = Math.max(best.onBase, run.onBase);
    }
    return {hit: run.hit, onBase: run.onBase, bestHit: best.hit, bestOnBase: best.onBase};
  }

  function singleGameHighs(games) {
    const single = games.filter(g => !g.summary);
    const top = (key, value) => {
      let bestGame = null;
      for (const g of single) if (value(g.stats) > 0 && (!bestGame || value(g.stats) > value(bestGame.stats))) bestGame = g;
      return bestGame ? {key, value: value(bestGame.stats), date: bestGame.date, tag: bestGame.tag} : null;
    };
    return [top('安打', s => s.h), top('全壘打', s => s.hr), top('壘打數', totalBases), top('保送', s => s.bb)].filter(Boolean);
  }

  // Career milestones reached in single games: every home run number and hit totals at fixed marks.
  // Season summaries count toward the totals but are not games where a milestone happened.
  function milestones(careerGames) {
    const out = [];
    let hr = 0, h = 0;
    for (const g of careerGames) {
      const s = g.stats;
      if (!g.summary) {
        for (let n = hr + 1; n <= hr + s.hr; n++) out.push({key: g.key, date: g.date, tag: g.tag, kind: 'hr', n, text: n === 1 ? '生涯首支全壘打' : `生涯第 ${n} 支全壘打`});
        for (const mark of HIT_MILESTONES) if (h < mark && h + s.h >= mark) out.push({key: g.key, date: g.date, tag: g.tag, kind: 'h', n: mark, text: `生涯第 ${mark} 支安打`});
      }
      hr += s.hr;
      h += s.h;
    }
    return out;
  }

  const careerGamesOf = name => playerGames(name, typeof allLogs !== 'undefined' ? allLogs : []);

  function recordsHtml(name, games) {
    const single = games.filter(g => !g.summary);
    if (!single.length) return '';
    const st = streaks(games);
    const highs = singleGameHighs(games);
    const career = careerGamesOf(name);
    const marks = milestones(career).slice(-6).reverse();
    const streakCell = (label, now, best) => `<div class="bg-slate-900/70 rounded-lg p-2 text-center">
        <div class="text-[10px] text-slate-400">${label}</div>
        <div class="font-mono font-black text-lg ${now >= 3 ? 'text-amber-300' : 'text-white'}">${now}<span class="text-xs text-slate-400 font-semibold"> 場</span></div>
        <div class="text-[10px] text-slate-500">本期最長 ${best} 場</div>
      </div>`;
    return `<div class="grid grid-cols-1 md:grid-cols-3 gap-3" data-records>
      <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2">
        <div class="text-[11px] text-slate-400">目前連續紀錄（本期，由最近一場往回算）</div>
        <div class="grid grid-cols-2 gap-2">${streakCell('連續安打', st.hit, st.bestHit)}${streakCell('連續上壘', st.onBase, st.bestOnBase)}</div>
      </div>
      <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
        <div class="text-[11px] text-slate-400 mb-1">本期單場最佳</div>
        ${highs.length ? `<ul class="text-xs space-y-1">${highs.map(x => `<li class="flex justify-between gap-2"><span class="text-slate-300">${x.key}</span><span class="font-mono"><b class="text-white">${x.value}</b> <span class="text-slate-500">${esc(x.date)}</span></span></li>`).join('')}</ul>` : '<div class="text-xs text-slate-500">尚無</div>'}
      </div>
      <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
        <div class="text-[11px] text-slate-400 mb-1">生涯里程碑（全部紀錄）</div>
        ${marks.length ? `<ul class="text-xs space-y-1">${marks.map(m => `<li class="flex justify-between gap-2"><span class="${m.kind === 'hr' ? 'text-amber-300' : 'text-emerald-300'}">🏅 ${esc(m.text)}</span><span class="font-mono text-slate-500">${esc(m.date)}</span></li>`).join('')}</ul>` : '<div class="text-xs text-slate-500">尚未達成里程碑（首支全壘打、第 10 支安打起算）</div>'}
      </div>
    </div>`;
  }

  function sparkline(games) {
    if (games.length < 2) return '';
    // Cumulative over single games only, so a season summary row does not flatten the line.
    const running = [];
    const values = games.map(g => { running.push(...g.logs); return statsFor(running).ops; });
    const max = Math.max(1, ...values);
    const step = 300 / (values.length - 1);
    const points = values.map((v, i) => `${(i * step).toFixed(1)},${(56 - (v / max) * 52).toFixed(1)}`).join(' ');
    return `<svg viewBox="-4 0 308 60" class="w-full h-16" role="img" aria-label="累計 OPS 走勢">
      <polyline points="${points}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${values.map((v, i) => `<circle cx="${(i * step).toFixed(1)}" cy="${(56 - (v / max) * 52).toFixed(1)}" r="3" fill="#38bdf8"/>`).join('')}
    </svg>`;
  }

  // Recent form against the whole period; season summaries never count as recent games.
  function form(games) {
    const season = games[games.length - 1].toDate;
    const played = games.filter(g => !g.summary);
    const recentCount = Math.min(RECENT_GAMES, played.length);
    const recent = recentCount ? statsFor(played.slice(-RECENT_GAMES).flatMap(g => g.logs)) : null;
    const diff = recent ? recent.ops - season.ops : 0;
    const trend = played.length <= RECENT_GAMES ? '<span class="text-slate-400">場數不足以比較近況</span>'
      : Math.abs(diff) < 0.05 ? '<span class="text-slate-300">與本期相近</span>'
        : diff > 0 ? `<span class="text-emerald-400">▲ 近況較佳（OPS +${rate(diff)}）</span>`
          : `<span class="text-rose-400">▼ 近況下滑（OPS −${rate(-diff)}）</span>`;
    return {season, played, recentCount, recent, diff, trend};
  }
  const line = s => `${rate(s.avg)} / ${rate(s.obp)} / ${rate(s.slg)}`;

  function renderGameLog(name) {
    const anchor = document.getElementById('playerProfileCard');
    if (!anchor) return;
    const profileSection = anchor.closest('section');
    let section = document.getElementById('insightGameLogSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'insightGameLogSection';
      section.className = 'bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 backdrop-blur-sm';
      profileSection.after(section);
    }
    const games = name ? playerGames(name) : [];
    if (!games.length) {
      section.innerHTML = '<p class="text-xs text-slate-500">此日期範圍內沒有逐場紀錄。</p>';
      return;
    }
    const {season, played, recentCount, recent, trend} = form(games);
    const marksByGame = new Map();
    for (const m of milestones(careerGamesOf(name))) marksByGame.set(m.key, [...(marksByGame.get(m.key) || []), m.text]);
    const rows = games.slice().reverse().map(g => `
      <tr class="hover:bg-slate-800/50 ${g.summary ? 'bg-slate-800/40' : ''}">
        <td class="p-2 font-mono whitespace-nowrap">${esc(g.date)}</td>
        <td class="p-2 text-slate-300 whitespace-nowrap">${esc(gameLabel(g.tag))}${g.summary ? ' <span class="text-[10px] text-slate-400 border border-slate-600 rounded px-1">年度彙總</span>' : ''}${(marksByGame.get(g.key) || []).map(t => ` <span class="text-[10px] text-amber-300 border border-amber-500/40 rounded px-1" data-milestone>🏅 ${esc(t)}</span>`).join('')}</td>
        <td class="p-2 text-center font-mono">${g.stats.pa}</td>
        <td class="p-2 text-center font-mono font-bold text-white">${g.stats.h}-${g.stats.ab}</td>
        <td class="p-2 text-center font-mono">${g.stats.h2}</td>
        <td class="p-2 text-center font-mono">${g.stats.h3}</td>
        <td class="p-2 text-center font-mono text-amber-300">${g.stats.hr}</td>
        <td class="p-2 text-center font-mono">${g.stats.bb}</td>
        <td class="p-2 text-center font-mono text-rose-300">${g.stats.k}</td>
        <td class="p-2 text-center font-mono text-emerald-300">${rate(g.toDate.avg)}</td>
        <td class="p-2 text-center font-mono text-sky-300">${rate(g.toDate.ops)}</td>
      </tr>`).join('');
    section.innerHTML = `
      <div class="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <span class="bg-sky-500/10 text-sky-400 border border-sky-500/30 text-xs px-2.5 py-0.5 rounded-full font-mono font-bold">GAME LOG</span>
        <h3 class="text-lg font-black text-sky-200">${esc(name)} 逐場成績與近況</h3>
        <span class="text-xs text-slate-400">依目前日期範圍，共 ${played.length} 場${games.length > played.length ? '＋年度彙總' : ''}</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
          ${recent ? `<div class="text-[11px] text-slate-400">近 ${recentCount} 場（${recent.pa} 打席）AVG / OBP / SLG</div>
          <div class="font-mono font-black text-white text-lg">${line(recent)}</div>
          <div class="text-xs mt-1">${trend}</div>` : '<div class="text-xs text-slate-400">此範圍只有年度彙總，沒有單場紀錄可看近況。</div>'}
        </div>
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
          <div class="text-[11px] text-slate-400">本期全部（${season.pa} 打席）AVG / OBP / SLG</div>
          <div class="font-mono font-black text-slate-200 text-lg">${line(season)}</div>
          <div class="text-xs mt-1 text-slate-400">OPS ${rate(season.ops)}</div>
        </div>
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
          <div class="text-[11px] text-slate-400">累計 OPS 走勢（由舊到新）</div>
          ${sparkline(played) || '<div class="text-xs text-slate-500 mt-2">至少兩場才有走勢</div>'}
        </div>
      </div>
      ${recordsHtml(name, games)}
      <div class="overflow-x-auto rounded-xl border border-slate-800" tabindex="0">
        <table class="w-full text-xs text-slate-200 min-w-[640px]">
          <thead class="bg-slate-950 text-slate-400">
            <tr><th class="p-2 text-left">日期</th><th class="p-2 text-left">賽事</th><th class="p-2">打席</th><th class="p-2">安打-打數</th><th class="p-2">二安</th><th class="p-2">三安</th><th class="p-2">全壘打</th><th class="p-2">保送</th><th class="p-2">三振</th><th class="p-2">累計 AVG</th><th class="p-2">累計 OPS</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-800/80">${rows}</tbody>
        </table>
      </div>
      <p class="text-[11px] text-slate-500">場記賽事依比賽區分；手動補登以同一天同一標籤視為一場。年度彙總不列入近況與走勢。「累計」為本期到該列為止的成績，打數 = 打席 − 保送 − 高飛犧牲打，與全站算法相同。</p>`;
  }

  // ---------- 2. Small-sample notes ----------
  function renderProfileNote(agg) {
    const anchor = document.getElementById('playerProfileCard');
    if (!anchor) return;
    let note = document.getElementById('insightSampleNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'insightSampleNote';
      anchor.before(note);
    }
    const player = agg.players.find(p => p.name === selectedPlayerName);
    note.innerHTML = player && player.pa < SAMPLE_PA ? sampleNoteHtml(player.name, player.pa) : '';
  }

  function renderCompareNote(agg) {
    const head = document.querySelector('#panelCompare > section > div');
    if (!head || !agg.players.length) return;
    let note = document.getElementById('insightCompareSampleNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'insightCompareSampleNote';
      note.className = 'space-y-2';
      head.after(note);
    }
    // Same fallback the comparison itself uses when nobody is selected yet.
    const list = agg.players;
    const a = list.find(p => p.name === comparePlayerAName) || list[0];
    const b = list.find(p => p.name === comparePlayerBName) || (list.length > 1 ? list[1] : list[0]);
    note.innerHTML = [...new Set([a, b])].filter(p => p && p.pa < SAMPLE_PA).map(p => sampleNoteHtml(p.name, p.pa)).join('');
  }

  // ---------- 2b. Head-to-head game log and recent form (compare page) ----------
  const COLORS = {a: '#38bdf8', b: '#fbbf24'};

  // Both players' cumulative OPS on one timeline of every game either of them played.
  function dualSparkline(timeline, byKeyA, byKeyB) {
    if (timeline.length < 2) return '';
    const series = [byKeyA, byKeyB].map(byKey => {
      const running = [];
      return timeline.map((key, i) => {
        const game = byKey.get(key);
        if (!game) return null;
        running.push(...game.logs);
        return {i, v: statsFor(running).ops};
      }).filter(Boolean);
    });
    const max = Math.max(1, ...series.flat().map(p => p.v));
    const step = 300 / (timeline.length - 1);
    const xy = p => `${(p.i * step).toFixed(1)},${(56 - (p.v / max) * 52).toFixed(1)}`;
    const draw = (points, color) => points.length ? `
      <polyline points="${points.map(xy).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map(p => `<circle cx="${xy(p).split(',')[0]}" cy="${xy(p).split(',')[1]}" r="3" fill="${color}"/>`).join('')}` : '';
    return `<svg viewBox="-4 0 308 60" class="w-full h-16" role="img" aria-label="雙人累計 OPS 走勢">${draw(series[0], COLORS.a)}${draw(series[1], COLORS.b)}</svg>`;
  }

  function compareCard(name, games, color, better) {
    if (!games.length) return `<div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs text-slate-400"><b style="color:${color}">${esc(name)}</b>：此日期範圍內沒有逐場紀錄。</div>`;
    const {season, played, recentCount, recent, trend} = form(games);
    return `<div class="bg-slate-950/70 border rounded-xl p-3 space-y-1.5 ${better ? 'border-emerald-500/50' : 'border-slate-800'}" data-h2h-card>
      <div class="flex items-center justify-between gap-2">
        <b class="text-sm" style="color:${color}">${esc(name)}</b>
        ${better ? '<span class="text-[10px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-600/50 rounded px-1.5 py-0.5">近況較熱</span>' : ''}
      </div>
      ${recent ? `<div class="text-[11px] text-slate-400">近 ${recentCount} 場（${recent.pa} 打席）AVG / OBP / SLG</div>
      <div class="font-mono font-black text-white text-base">${line(recent)}<span class="text-xs text-slate-400 font-semibold">　OPS ${rate(recent.ops)}</span></div>
      <div class="text-xs">${trend}</div>` : '<div class="text-xs text-slate-400">只有年度彙總，沒有單場紀錄可看近況。</div>'}
      <div class="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">本期 ${played.length} 場${games.length > played.length ? '＋年度彙總' : ''}・${season.pa} 打席　${line(season)}　OPS ${rate(season.ops)}</div>
    </div>`;
  }

  function compareCells(game, other) {
    if (!game) return '<td class="p-2 text-center text-slate-600" colspan="5">未出賽</td>';
    const s = game.stats;
    const win = other && !game.summary && s.ops > other.stats.ops;
    return `<td class="p-2 text-center font-mono font-bold text-white">${s.h}-${s.ab}</td>
      <td class="p-2 text-center font-mono text-amber-300">${s.hr}</td>
      <td class="p-2 text-center font-mono">${s.bb}</td>
      <td class="p-2 text-center font-mono text-rose-300">${s.k}</td>
      <td class="p-2 text-center font-mono ${win ? 'text-emerald-300 font-black' : 'text-slate-300'}">${game.summary ? '—' : rate(s.ops)}${win ? ' ▲' : ''}</td>`;
  }

  function renderCompareGameLog(agg) {
    const panel = document.getElementById('panelCompare');
    if (!panel || !agg.players.length) return;
    let section = document.getElementById('insightCompareGameLogSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'insightCompareGameLogSection';
      section.className = 'bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 backdrop-blur-sm';
      panel.appendChild(section);
    }
    // Same fallback the comparison itself uses when nobody is selected yet.
    const list = agg.players;
    const a = (list.find(p => p.name === comparePlayerAName) || list[0]).name;
    const b = (list.find(p => p.name === comparePlayerBName) || (list.length > 1 ? list[1] : list[0])).name;
    const head = `<div class="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <span class="bg-purple-500/10 text-purple-400 border border-purple-500/30 text-xs px-2.5 py-0.5 rounded-full font-mono font-bold">GAME LOG H2H</span>
        <h3 class="text-lg font-black text-purple-200">逐場成績與近況對決</h3>
      </div>`;
    if (a === b) {
      section.innerHTML = `${head}<p class="text-xs text-slate-400">請在上方選擇兩位不同的球員。</p>`;
      return;
    }
    const gamesA = playerGames(a), gamesB = playerGames(b);
    const byKeyA = new Map(gamesA.map(g => [g.key, g])), byKeyB = new Map(gamesB.map(g => [g.key, g]));
    const all = new Map([...gamesA, ...gamesB].map(g => [g.key, g]));
    const keys = [...all.values()].sort((x, y) => (x.date === y.date ? x.key.localeCompare(y.key) : x.date < y.date ? -1 : 1)).map(g => g.key);
    const timeline = keys.filter(k => !all.get(k).summary);
    // Shared single games, compared by that game's OPS.
    const shared = timeline.filter(k => byKeyA.has(k) && byKeyB.has(k));
    let winsA = 0, winsB = 0;
    for (const k of shared) {
      const diff = byKeyA.get(k).stats.ops - byKeyB.get(k).stats.ops;
      if (diff > 0) winsA++; else if (diff < 0) winsB++;
    }
    const recentOps = games => { const f = games.length ? form(games) : null; return f && f.recent ? f.recent.ops : null; };
    const opsA = recentOps(gamesA), opsB = recentOps(gamesB);
    const hotter = opsA !== null && opsB !== null && Math.abs(opsA - opsB) >= 0.05 ? (opsA > opsB ? 'a' : 'b') : '';
    const rows = keys.slice().reverse().map(k => {
      const g = all.get(k), ga = byKeyA.get(k), gb = byKeyB.get(k);
      return `<tr class="hover:bg-slate-800/50 ${g.summary ? 'bg-slate-800/40' : ''}">
        <td class="p-2 font-mono whitespace-nowrap">${esc(g.date)}</td>
        <td class="p-2 text-slate-300 whitespace-nowrap">${esc(gameLabel(g.tag))}${g.summary ? ' <span class="text-[10px] text-slate-400 border border-slate-600 rounded px-1">年度彙總</span>' : ''}</td>
        ${compareCells(ga, gb)}${compareCells(gb, ga)}
      </tr>`;
    }).join('');
    // Phone version of the same table: one block per game, each player on one line (every value kept).
    const phoneLine = (name, color, game, other) => {
      if (!game) return `<div class="flex justify-between gap-2"><span style="color:${color}">● ${esc(name)}</span><span class="text-slate-500">未出賽</span></div>`;
      const st = game.stats;
      const win = other && !game.summary && st.ops > other.stats.ops;
      return `<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"><span style="color:${color}" class="font-bold">● ${esc(name)}</span>
        <span class="font-mono text-slate-200"><b class="text-white">${st.h}-${st.ab}</b>　HR ${st.hr}　BB ${st.bb}　K ${st.k}　OPS <b class="${win ? 'text-emerald-300' : ''}">${game.summary ? '—' : rate(st.ops)}${win ? ' ▲' : ''}</b></span></div>`;
    };
    const phoneList = keys.slice().reverse().map(k => {
      const g = all.get(k), ga = byKeyA.get(k), gb = byKeyB.get(k);
      return `<div class="py-2 space-y-1" data-h2h-phone-row>
        <div class="text-[11px] text-slate-400 font-mono">${esc(g.date)}・${esc(gameLabel(g.tag))}${g.summary ? '・年度彙總' : ''}</div>
        ${phoneLine(a, COLORS.a, ga, gb)}${phoneLine(b, COLORS.b, gb, ga)}
      </div>`;
    }).join('');
    const sub = '<th class="p-2">安打-打數</th><th class="p-2">全壘打</th><th class="p-2">保送</th><th class="p-2">三振</th><th class="p-2">單場 OPS</th>';
    section.innerHTML = `${head}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${compareCard(a, gamesA, COLORS.a, hotter === 'a')}
        ${compareCard(b, gamesB, COLORS.b, hotter === 'b')}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3" data-h2h-shared>
          <div class="text-[11px] text-slate-400">同場出賽 ${shared.length} 場・單場 OPS 較高</div>
          ${shared.length ? `<div class="font-mono font-black text-lg"><span style="color:${COLORS.a}">${winsA}</span><span class="text-slate-500"> : </span><span style="color:${COLORS.b}">${winsB}</span>${shared.length - winsA - winsB ? `<span class="text-xs text-slate-400 font-semibold">　平 ${shared.length - winsA - winsB}</span>` : ''}</div>
          <div class="text-[11px] text-slate-500">${esc(a)} 對 ${esc(b)}</div>` : '<div class="text-xs text-slate-400 mt-1">此範圍內兩人沒有同場出賽紀錄。</div>'}
        </div>
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 md:col-span-2">
          <div class="text-[11px] text-slate-400 flex flex-wrap gap-x-3">累計 OPS 走勢（由舊到新）
            <span style="color:${COLORS.a}">● ${esc(a)}</span><span style="color:${COLORS.b}">● ${esc(b)}</span></div>
          ${dualSparkline(timeline, byKeyA, byKeyB) || '<div class="text-xs text-slate-500 mt-2">至少兩場才有走勢</div>'}
        </div>
      </div>
      <div class="overflow-x-auto rounded-xl border border-slate-800 ui-wide-only" tabindex="0">
        <table class="w-full text-xs text-slate-200 min-w-[760px]">
          <thead class="bg-slate-950 text-slate-400">
            <tr><th class="p-2 text-left" rowspan="2">日期</th><th class="p-2 text-left" rowspan="2">賽事</th>
              <th class="p-2" colspan="5" style="color:${COLORS.a}">${esc(a)}</th><th class="p-2" colspan="5" style="color:${COLORS.b}">${esc(b)}</th></tr>
            <tr>${sub}${sub}</tr>
          </thead>
          <tbody class="divide-y divide-slate-800/80">${rows}</tbody>
        </table>
      </div>
      <div class="ui-phone-only rounded-xl border border-slate-800 px-3 divide-y divide-slate-800/80 text-xs" data-h2h-phone>${phoneList}</div>
      <p class="text-[11px] text-slate-500">依目前日期範圍；與個人頁「逐場成績與近況」同一套分場與算法。▲ 為同場單場 OPS 較高者；「近況較熱」為近 ${RECENT_GAMES} 場 OPS 相差 .050 以上的一方。年度彙總不列入近況、走勢與同場比較。</p>`;
  }

  // ---------- 2c. Team game log and player form board (analytics page) ----------
  // One combined batting line for a set of logs (team totals), with the site's own formulas.
  const teamStats = logs => statsFor(logs.map(l => ({...l, name: '__team__'})));

  function teamGames(names) {
    const groups = new Map();
    for (const log of getFilteredLogs()) {
      if (!names.has(log.name) || isSummaryTag(log.tag)) continue;
      const key = gameIdOf(log) || `${log.date}|${log.tag || ''}`;
      if (!groups.has(key)) groups.set(key, {key, date: log.date, tag: log.tag, logs: []});
      groups.get(key).logs.push(log);
    }
    const games = [...groups.values()]
      .filter(g => g.logs.some(l => Number(l.pa) > 0))
      .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
    const running = [];
    return games.map(game => {
      running.push(...game.logs);
      const scored = (typeof allGames !== 'undefined' ? allGames : []).find(g => g.id === game.key);
      return {...game, game: scored || null, stats: teamStats(game.logs), toDate: teamStats(running)};
    });
  }

  // Per-game team OPS bars with the cumulative OPS line on top.
  function teamTrendSvg(games) {
    if (games.length < 2) return '';
    const max = Math.max(1, ...games.map(g => Math.max(g.stats.ops, g.toDate.ops)));
    const W = 300, H = 80, step = W / games.length, bar = Math.max(4, step * 0.6);
    const y = v => (H - 4 - (v / max) * (H - 10)).toFixed(1);
    const cx = i => (i * step + step / 2).toFixed(1);
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-24" role="img" aria-label="全隊單場與累計 OPS">
      ${games.map((g, i) => `<rect x="${(i * step + (step - bar) / 2).toFixed(1)}" y="${y(g.stats.ops)}" width="${bar.toFixed(1)}" height="${(H - 4 - y(g.stats.ops)).toFixed(1)}" rx="2" fill="#334155"><title>${esc(g.date)} 單場 OPS ${rate(g.stats.ops)}</title></rect>`).join('')}
      <polyline points="${games.map((g, i) => `${cx(i)},${y(g.toDate.ops)}`).join(' ')}" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${games.map((g, i) => `<circle cx="${cx(i)}" cy="${y(g.toDate.ops)}" r="2.5" fill="#34d399"/>`).join('')}
    </svg>`;
  }

  // Players' last five games against their own period, hottest first.
  function formBoard(agg) {
    return agg.players.map(p => {
      const games = playerGames(p.name);
      const f = games.length ? form(games) : null;
      if (!f || !f.recent) return null;
      return {name: p.name, games: f.played.length, recentCount: f.recentCount, recent: f.recent, season: f.season,
        diff: f.recent.ops - f.season.ops, comparable: f.played.length > RECENT_GAMES};
    }).filter(Boolean).sort((a, b) => (b.comparable - a.comparable) || (b.diff - a.diff) || (b.recent.ops - a.recent.ops));
  }

  function renderTeamGameLog(agg) {
    const panel = document.getElementById('panelAnalytics');
    if (!panel) return;
    let section = document.getElementById('insightTeamGameLogSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'insightTeamGameLogSection';
      section.className = 'bg-slate-900/80 border border-emerald-900/50 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 backdrop-blur-sm';
      const first = panel.querySelector(':scope > section');
      if (first) first.after(section); else panel.appendChild(section);
      // Names open the player's profile; delegated so no inline handlers are added.
      section.addEventListener('click', event => {
        const target = event.target.closest('[data-insight-player]');
        if (!target) return;
        selectedPlayerName = target.dataset.insightPlayer;
        switchMainTab('tabProfile');
      });
    }
    const head = `<div class="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs px-2.5 py-0.5 rounded-full font-mono font-bold">TEAM GAME LOG</span>
        <h3 class="text-base sm:text-lg font-black text-emerald-300 tracking-tight">逐場成績與近況</h3>
        <span class="text-xs text-slate-400">全隊與每位球員近 ${RECENT_GAMES} 場走勢</span>
      </div>`;
    const games = teamGames(new Set(agg.players.map(p => p.name)));
    if (!games.length) {
      section.innerHTML = `${head}<p class="text-xs text-slate-500">此日期範圍內沒有逐場紀錄。</p>`;
      return;
    }
    const season = games[games.length - 1].toDate;
    const recentGames = games.slice(-RECENT_GAMES);
    const recent = teamStats(recentGames.flatMap(g => g.logs));
    const diff = recent.ops - season.ops;
    const trend = games.length <= RECENT_GAMES ? '<span class="text-slate-400">場數不足以比較近況</span>'
      : Math.abs(diff) < 0.05 ? '<span class="text-slate-300">與本期相近</span>'
        : diff > 0 ? `<span class="text-emerald-400">▲ 近況較佳（OPS +${rate(diff)}）</span>`
          : `<span class="text-rose-400">▼ 近況下滑（OPS −${rate(-diff)}）</span>`;
    // A 0:0 final means no score was kept for that game (not a real softball result).
    const hasScore = g => !!(g.game && g.game.finalScore && ((g.game.finalScore.us || 0) + (g.game.finalScore.opp || 0) > 0));
    const scored = games.filter(hasScore);
    const record = scored.reduce((r, g) => {
      const s = g.game.finalScore;
      if (s.us > s.opp) r.w++; else if (s.us < s.opp) r.l++; else r.t++;
      r.rs += s.us || 0; r.ra += s.opp || 0;
      return r;
    }, {w: 0, l: 0, t: 0, rs: 0, ra: 0});
    const result = g => {
      if (!hasScore(g)) return '<span class="text-slate-600">—</span>';
      const s = g.game.finalScore;
      const [label, cls] = s.us > s.opp ? ['勝', 'text-emerald-300'] : s.us < s.opp ? ['敗', 'text-rose-300'] : ['和', 'text-amber-300'];
      return `<span class="${cls} font-bold">${label}</span> <span class="font-mono">${s.us}:${s.opp}</span>`;
    };
    const rows = games.slice().reverse().map(g => `
      <tr class="hover:bg-slate-800/50">
        <td class="p-2 font-mono whitespace-nowrap">${esc(g.date)}</td>
        <td class="p-2 text-slate-300 whitespace-nowrap">${esc(gameLabel(g.tag))}</td>
        <td class="p-2 text-center whitespace-nowrap">${result(g)}</td>
        <td class="p-2 text-center font-mono">${new Set(g.logs.filter(l => Number(l.pa) > 0).map(l => l.name)).size}</td>
        <td class="p-2 text-center font-mono">${g.stats.pa}</td>
        <td class="p-2 text-center font-mono font-bold text-white">${g.stats.h}-${g.stats.ab}</td>
        <td class="p-2 text-center font-mono text-amber-300">${g.stats.h2 + g.stats.h3 + g.stats.hr}</td>
        <td class="p-2 text-center font-mono">${g.stats.bb}</td>
        <td class="p-2 text-center font-mono text-rose-300">${g.stats.k}</td>
        <td class="p-2 text-center font-mono">${line(g.stats)}</td>
        <td class="p-2 text-center font-mono text-sky-300">${rate(g.stats.ops)}</td>
        <td class="p-2 text-center font-mono text-emerald-300">${rate(g.toDate.ops)}</td>
      </tr>`).join('');
    const board = formBoard(agg);
    const boardRows = board.map(p => {
      const tag = !p.comparable ? '<span class="text-slate-500">場數不足</span>'
        : p.diff >= 0.05 ? `<span class="text-emerald-300 font-bold">▲ 手感火熱</span>`
          : p.diff <= -0.05 ? `<span class="text-rose-300 font-bold">▼ 手感下滑</span>` : '<span class="text-slate-300">持平</span>';
      return `<tr class="hover:bg-slate-800/50" data-form-row>
        <td class="p-2 whitespace-nowrap"><button type="button" data-insight-player="${esc(p.name)}" class="font-bold text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline">${esc(p.name)}</button>${p.recent.pa < 10 ? ' <span class="text-[10px] text-amber-300/80">小樣本</span>' : ''}</td>
        <td class="p-2 text-center font-mono">${p.recentCount}／${p.games}</td>
        <td class="p-2 text-center font-mono">${p.recent.pa}</td>
        <td class="p-2 text-center font-mono">${line(p.recent)}</td>
        <td class="p-2 text-center font-mono text-white font-bold">${rate(p.recent.ops)}</td>
        <td class="p-2 text-center font-mono text-slate-400">${rate(p.season.ops)}</td>
        <td class="p-2 text-center font-mono ${p.comparable ? (p.diff >= 0 ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-500'}">${p.comparable ? `${p.diff >= 0 ? '+' : '−'}${rate(Math.abs(p.diff))}` : '—'}</td>
        <td class="p-2 text-center whitespace-nowrap">${tag}</td>
      </tr>`;
    }).join('');
    section.innerHTML = `${head}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3" data-team-recent>
          <div class="text-[11px] text-slate-400">全隊近 ${recentGames.length} 場（${recent.pa} 打席）AVG / OBP / SLG</div>
          <div class="font-mono font-black text-white text-lg">${line(recent)}</div>
          <div class="text-xs mt-1">OPS ${rate(recent.ops)}　${trend}</div>
        </div>
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3" data-team-season>
          <div class="text-[11px] text-slate-400">全隊本期 ${games.length} 場（${season.pa} 打席）AVG / OBP / SLG</div>
          <div class="font-mono font-black text-slate-200 text-lg">${line(season)}</div>
          <div class="text-xs mt-1 text-slate-400">OPS ${rate(season.ops)}${scored.length ? `　場記戰績 ${record.w} 勝 ${record.l} 敗${record.t ? ` ${record.t} 和` : ''}・得失分 ${record.rs}:${record.ra}` : ''}</div>
        </div>
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
          <div class="text-[11px] text-slate-400 flex flex-wrap gap-x-3">由舊到新 <span class="text-slate-300">▮ 單場 OPS</span><span class="text-emerald-300">● 累計 OPS</span></div>
          ${teamTrendSvg(games) || '<div class="text-xs text-slate-500 mt-2">至少兩場才有走勢</div>'}
        </div>
      </div>
      <div class="overflow-x-auto rounded-xl border border-slate-800" tabindex="0">
        <table class="w-full text-xs text-slate-200 min-w-[860px]" data-team-log>
          <thead class="bg-slate-950 text-slate-400">
            <tr><th class="p-2 text-left">日期</th><th class="p-2 text-left">賽事</th><th class="p-2">比分</th><th class="p-2">上場</th><th class="p-2">打席</th><th class="p-2">安打-打數</th><th class="p-2">長打</th><th class="p-2">保送</th><th class="p-2">三振</th><th class="p-2">AVG / OBP / SLG</th><th class="p-2">單場 OPS</th><th class="p-2">累計 OPS</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-800/80">${rows}</tbody>
        </table>
      </div>
      <div class="space-y-2">
        <h4 class="text-sm font-bold text-slate-200">球員近況榜 <span class="text-xs text-slate-400 font-normal">近 ${RECENT_GAMES} 場 OPS 對比本期，點姓名看個人逐場成績</span></h4>
        <div class="overflow-x-auto rounded-xl border border-slate-800" tabindex="0">
          <table class="w-full text-xs text-slate-200 min-w-[680px]" data-form-board>
            <thead class="bg-slate-950 text-slate-400">
              <tr><th class="p-2 text-left">球員</th><th class="p-2">近況場數／本期</th><th class="p-2">近況打席</th><th class="p-2">近況 AVG / OBP / SLG</th><th class="p-2">近況 OPS</th><th class="p-2">本期 OPS</th><th class="p-2">差距</th><th class="p-2">狀態</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-800/80">${boardRows}</tbody>
          </table>
        </div>
      </div>
      <p class="text-[11px] text-slate-500">依目前日期範圍與「納入常模」設定，與個人頁「逐場成績與近況」同一套分場與算法；年度彙總不列入逐場與近況，但會算進球員的「本期 OPS」。比分只有記了最終比分的場記賽事才有（0:0 視為未記比分）。本期不足 ${RECENT_GAMES + 1} 場時，近況等於全部單場，不判斷升降；近況打席未滿 10 標示小樣本。</p>`;
  }

  // ---------- 2d. Attendance (overview page) ----------
  // Games in the date range: finished scorebook games (lineups and substitutes count as appearances) plus
  // manually logged games (a plate appearance counts). Season summaries are not games.
  function attendance() {
    const s = document.getElementById('filterStartDate')?.value || '';
    const e = document.getElementById('filterEndDate')?.value || '';
    const inRange = date => (!s || date >= s) && (!e || date <= e);
    const games = new Map();
    for (const game of (typeof allGames !== 'undefined' ? allGames : [])) {
      if (!game || game.status === 'in_progress' || !inRange(game.date)) continue;
      const players = new Map();
      for (const b of getGameOrderedBatters(game)) if (!players.has(b.name)) players.set(b.name, b.isSub ? 'sub' : 'start');
      games.set(game.id, {key: game.id, date: game.date, players});
    }
    for (const log of getFilteredLogs()) {
      if (isSummaryTag(log.tag) || !(Number(log.pa) > 0)) continue;
      const key = gameIdOf(log) || `${log.date}|${log.tag || ''}`;
      if (gameIdOf(log)) continue; // scorebook games are counted from their lineups above
      if (!games.has(key)) games.set(key, {key, date: log.date, players: new Map()});
      games.get(key).players.set(log.name, 'log');
    }
    const ordered = [...games.values()].sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
    const roster = [...new Set(Object.values(typeof JERSEY_TO_NAME !== 'undefined' ? JERSEY_TO_NAME : {}))]
      .filter(name => isOfficialTeamPlayer(name) && !isGuestPlayerName(name));
    const rows = roster.map(name => {
      let played = 0, start = 0, sub = 0, last = '', since = 0;
      for (const g of ordered) {
        const role = g.players.get(name);
        if (role) { played++; if (role === 'start') start++; if (role === 'sub') sub++; last = g.date; since = 0; } else since++;
      }
      return {name, jersey: typeof NAME_TO_JERSEY !== 'undefined' ? NAME_TO_JERSEY[name] : undefined, played, start, sub, last, since: played ? since : ordered.length,
        rate: ordered.length ? played / ordered.length : 0};
    }).sort((a, b) => b.played - a.played || a.since - b.since || a.name.localeCompare(b.name));
    const appearances = ordered.reduce((sum, g) => sum + [...g.players.keys()].filter(n => roster.includes(n)).length, 0);
    return {games: ordered.length, rows, perGame: ordered.length ? appearances / ordered.length : 0, range: [s, e]};
  }

  function renderAttendance() {
    const anchor = document.getElementById('summaryTableBody')?.closest('section');
    if (!anchor) return;
    let section = document.getElementById('insightAttendanceSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'insightAttendanceSection';
      section.className = 'bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4 backdrop-blur-sm';
      anchor.after(section);
    }
    const a = attendance();
    const range = a.range[0] || a.range[1] ? `${a.range[0] || '最早'} ～ ${a.range[1] || '最新'}` : '全部日期';
    const head = `<div class="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <span class="bg-teal-500/10 text-teal-400 border border-teal-500/30 text-xs px-2.5 py-0.5 rounded-full font-mono font-bold">ATTENDANCE</span>
        <h3 class="text-base sm:text-lg font-black text-teal-200">出賽率</h3>
        <span class="text-xs text-slate-400">${esc(range)}・共 ${a.games} 場${a.games ? `・平均每場 ${a.perGame.toFixed(1)} 位隊員上場` : ''}</span>
      </div>`;
    if (!a.games) {
      section.innerHTML = `${head}<p class="text-xs text-slate-500">此日期範圍內沒有比賽紀錄。</p>`;
      return;
    }
    const rows = a.rows.map(r => {
      const pct = Math.round(r.rate * 100);
      const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-sky-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-700';
      return `<tr class="hover:bg-slate-800/50" data-attendance-row>
        <td class="p-2 whitespace-nowrap"><span class="text-slate-500 font-mono">${r.jersey !== undefined ? `#${esc(r.jersey)}` : ''}</span> <b class="text-slate-100">${esc(r.name)}</b></td>
        <td class="p-2 text-center font-mono font-bold text-white">${r.played}／${a.games}</td>
        <td class="p-2 min-w-[140px]"><div class="flex items-center gap-2"><div class="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden"><div class="${color} h-full rounded-full" style="width:${pct}%"></div></div><span class="font-mono text-xs w-10 text-right">${pct}%</span></div></td>
        <td class="p-2 text-center font-mono">${r.start}</td>
        <td class="p-2 text-center font-mono">${r.sub}</td>
        <td class="p-2 text-center font-mono text-slate-300 whitespace-nowrap">${r.last ? esc(r.last) : '—'}</td>
        <td class="p-2 text-center font-mono ${r.since >= 3 ? 'text-rose-300 font-bold' : 'text-slate-400'}">${r.since}</td>
      </tr>`;
    }).join('');
    section.innerHTML = `${head}
      <div class="overflow-x-auto rounded-xl border border-slate-800" tabindex="0">
        <table class="w-full text-xs text-slate-200 min-w-[640px]" data-attendance>
          <thead class="bg-slate-950 text-slate-400">
            <tr><th class="p-2 text-left">隊員</th><th class="p-2">出賽／總場數</th><th class="p-2">出賽率</th><th class="p-2">先發</th><th class="p-2">替補</th><th class="p-2">最近出賽</th><th class="p-2">連續未出賽</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-800/80">${rows}</tbody>
        </table>
      </div>
      <p class="text-[11px] text-slate-500">依頁首日期範圍（可用學年按鈕切換學期）。場記賽事以先發打線與替補名單計算出場（未打到打席的替補也算）；手動補登以有打席計算，先發／替補欄只統計場記賽事。進行中的比賽與年度彙總不列入。只列正式隊員；支援選手不列入。</p>`;
  }

  // ---------- 3. Post-game image ----------
  function gameSummary(game) {
    const ourRuns = {}, ourHits = {}, oppRuns = {};
    for (const inn of game.innings || []) {
      if (isInningOurBat(game.ourRole, inn.topBottom)) {
        ourRuns[inn.inningNum] = (ourRuns[inn.inningNum] || 0) + (inn.runs || 0);
        ourHits[inn.inningNum] = (ourHits[inn.inningNum] || 0) + (inn.hits || 0);
      } else {
        oppRuns[inn.inningNum] = (oppRuns[inn.inningNum] || 0) + (inn.runs || 0);
      }
    }
    const batters = getGameOrderedBatters(game).map(b => ({...b}));
    const box = new Map(batters.map(b => [b.name, {pa: 0, ab: 0, h: 0, h2: 0, h3: 0, hr: 0, bb: 0, k: 0}]));
    // Mirrors the review box score: runner outs never count as the batter's plate appearance.
    for (const inn of game.innings || []) {
      for (const pa of inn.plateAppearances || []) {
        if (isRunnerOutPlay(pa)) continue;
        if (!box.has(pa.batterName)) {
          box.set(pa.batterName, {pa: 0, ab: 0, h: 0, h2: 0, h3: 0, hr: 0, bb: 0, k: 0});
          batters.push({slot: pa.slot || 99, name: pa.batterName, isSub: true});
        }
        const p = box.get(pa.batterName);
        p.pa++;
        if (!['BB', 'SF'].includes(pa.result)) p.ab++;
        if (['1H', '2H', '3H', 'HR'].includes(pa.result)) p.h++;
        if (pa.result === '2H') p.h2++;
        if (pa.result === '3H') p.h3++;
        if (pa.result === 'HR') p.hr++;
        if (pa.result === 'BB') p.bb++;
        if (['K', 'K_FOUL', '界外K'].includes(pa.result)) p.k++;
      }
    }
    const maxInning = Math.max(7, ...(game.innings || []).map(i => i.inningNum));
    return {ourRuns, ourHits, oppRuns, maxInning, rows: batters.map(b => ({...b, ...box.get(b.name)}))};
  }

  // Milestones reached and streaks alive as of this game, using everything recorded before it plus this
  // game's own box score (so it works before the game is posted to the team logs).
  const STREAK_SHOW = {hit: 3, onBase: 5};
  function gameRecords(game, rows) {
    const out = {marks: [], hitStreaks: [], onBaseStreaks: []};
    const before = g => g.date < game.date || (g.date === game.date && g.key.localeCompare(game.id) < 0);
    for (const r of rows) {
      if (!r.pa || isGuestPlayerName(r.name)) continue;
      const history = careerGamesOf(r.name).filter(g => g.key !== game.id && before(g));
      const current = {key: game.id, date: game.date, tag: game.tag, summary: false, stats: {pa: r.pa, ab: r.ab, h: r.h, h2: r.h2, h3: r.h3, hr: r.hr, bb: r.bb}};
      const games = [...history, current];
      for (const m of milestones(games)) if (m.key === game.id) out.marks.push(`${r.name} ${m.text}`);
      const st = streaks(games);
      if (r.h > 0 && st.hit >= STREAK_SHOW.hit) out.hitStreaks.push(`${r.name} ${st.hit} 場`);
      if (r.h + r.bb > 0 && st.onBase >= STREAK_SHOW.onBase) out.onBaseStreaks.push(`${r.name} ${st.onBase} 場`);
    }
    return out;
  }

  // ---------- Game MVP ----------
  // Each batting event is worth its run value (the site's wOBA weights). A player's game score is the runs he
  // produced above what an average team batter would have produced in the same plate appearances, with a
  // strikeout costing a little more than other outs (in slowpitch it moves no runner). RBI are not recorded,
  // so they play no part. Ties: more total bases, more hits, fewer strikeouts, earlier in the order.
  const EVENT_RUNS = {bb: 0.69, h1: 0.89, h2: 1.27, h3: 1.62, hr: 2.10};
  const WOBA_SCALE = 1.2, K_COST = 0.1;
  function teamWobaBaseline() {
    let num = 0, pa = 0;
    for (const l of (typeof allLogs !== 'undefined' ? allLogs : [])) {
      if (!(Number(l.pa) > 0) || isGuestPlayerName(l.name)) continue;
      const h = +l.h || 0, h2 = +l.h2 || 0, h3 = +l.h3 || 0, hr = +l.hr || 0;
      num += EVENT_RUNS.bb * (+l.bb || 0) + EVENT_RUNS.h1 * (h - h2 - h3 - hr) + EVENT_RUNS.h2 * h2 + EVENT_RUNS.h3 * h3 + EVENT_RUNS.hr * hr;
      pa += +l.pa;
    }
    return pa ? num / pa : 0.45;
  }
  function mvpScore(r, base) {
    const h1 = r.h - r.h2 - r.h3 - r.hr;
    const produced = EVENT_RUNS.bb * r.bb + EVENT_RUNS.h1 * h1 + EVENT_RUNS.h2 * r.h2 + EVENT_RUNS.h3 * r.h3 + EVENT_RUNS.hr * r.hr;
    return (produced - base * r.pa) / WOBA_SCALE - K_COST * r.k;
  }
  function gameMvp(game, rows) {
    const base = teamWobaBaseline();
    const ranked = rows.filter(r => r.pa > 0 && !isGuestPlayerName(r.name))
      .map(r => ({...r, tb: r.h + r.h2 + 2 * r.h3 + 3 * r.hr, xbh: r.h2 + r.h3 + r.hr, score: mvpScore(r, base)}))
      .sort((a, b) => b.score - a.score || b.tb - a.tb || b.h - a.h || a.k - b.k || (a.slot || 99) - (b.slot || 99));
    const m = ranked[0];
    if (!m || m.score <= 0) return null;
    // What made the game, strongest first: milestones, a perfect day, home runs, three hits, extra bases,
    // the team's best total, walks, then streaks still going.
    const rec = gameRecords(game, rows);
    const own = list => list.filter(t => t.startsWith(`${m.name} `)).map(t => t.slice(m.name.length + 1));
    const tags = [...own(rec.marks)];
    if (m.ab >= 2 && m.h === m.ab) tags.push(`${m.ab} 打數全部安打`);
    else if (m.pa >= 2 && m.h + m.bb === m.pa) tags.push('每個打席都上壘');
    if (m.hr > 1) tags.push(`單場 ${m.hr} 轟`);
    else if (m.hr && !tags.some(t => t.includes('全壘打'))) tags.push('擊出全壘打'); // a home-run milestone already says it
    if (m.h >= 3) tags.push(`猛打賞（${m.h} 安）`);
    if (m.xbh >= 2) tags.push(`${m.xbh} 支長打`);
    if (m.tb > 0 && m.tb === Math.max(...ranked.map(r => r.tb))) tags.push(`全隊最多壘打數（${m.tb}）`);
    if (m.bb >= 2) tags.push(`${m.bb} 次保送`);
    tags.push(...own(rec.hitStreaks).map(t => `連續 ${t}安打`));
    if (!tags.length) tags.push(`全隊最高打擊貢獻`);
    const line = `${m.ab} 打數 ${m.h} 安打${m.xbh ? `・${m.xbh} 長打` : ''}${m.bb ? `・${m.bb} 保送` : ''}・壘打數 ${m.tb}`;
    return {name: m.name, slot: m.slot, score: m.score, line, tags: [...new Set(tags)].slice(0, 3), ranked, baseline: base};
  }

  // ---------- Post-game image ----------
  // Team colours (from the badge): navy, red and white, with gold reserved for the MVP.
  const IMG = {
    bgTop: '#0a1a44', bgBottom: '#060d22', panel: '#0f1f45', panelEdge: '#ffffff1f', row: '#13254f',
    red: '#e11d48', redSoft: '#fda4af', white: '#f8fafc', muted: '#94a3b8', dim: '#64748b',
    green: '#34d399', amber: '#fbbf24', sky: '#7dd3fc', gold: '#fbbf24'
  };

  function drawGameImage(game, options = {}) {
    const s = gameSummary(game);
    const score = game.finalScore || {us: 0, opp: 0};
    // A 0:0 final means the score was not kept (as in the stats pages): show hits instead of a fake tie.
    const scored = (score.us || 0) + (score.opp || 0) > 0;
    const result = !scored ? null : score.us > score.opp ? ['勝', IMG.green] : score.us < score.opp ? ['敗', IMG.red] : ['和', IMG.amber];
    const W = 1080, P = 48, rowH = 50;
    const mvp = gameMvp(game, s.rows);
    const teamHits = s.rows.reduce((a, r) => a + r.h, 0), teamXbh = s.rows.reduce((a, r) => a + r.h2 + r.h3 + r.hr, 0);

    // Highlights as labelled chips.
    const chips = [];
    const hr = s.rows.filter(r => r.hr > 0).map(r => `${r.name}${r.hr > 1 ? ` ×${r.hr}` : ''}`);
    if (hr.length) chips.push({label: '全壘打', color: IMG.red, body: hr.join('、')});
    const multi = s.rows.filter(r => r.h >= 2).map(r => `${r.name} ${r.h}安`);
    if (multi.length) chips.push({label: '多安打', color: '#22c55e', body: multi.join('、')});
    const records = gameRecords(game, s.rows);
    if (records.marks.length) chips.push({label: '里程碑', color: '#a78bfa', body: records.marks.join('、')});
    if (records.hitStreaks.length) chips.push({label: '連續安打', color: '#38bdf8', body: records.hitStreaks.join('、')});
    if (records.onBaseStreaks.length) chips.push({label: '連續上壘', color: '#38bdf8', body: records.onBaseStreaks.join('、')});

    const canvas = document.createElement('canvas');
    const c = canvas.getContext('2d');
    const font = (size, weight = 700) => `${weight} ${size}px ${FONT}`;
    const text = (str, x, y, size, color, align = 'left', weight = 700) => {
      c.font = font(size, weight);
      c.fillStyle = color;
      c.textAlign = align;
      c.fillText(String(str), x, y);
    };
    const width = (str, size, weight = 700) => { c.font = font(size, weight); return c.measureText(String(str)).width; };
    const round = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    const panel = (x, y, w, h, r = 24, fill = IMG.panel) => { round(x, y, w, h, r); c.fillStyle = fill; c.fill(); c.lineWidth = 2; c.strokeStyle = IMG.panelEdge; c.stroke(); };
    // Wrap at 「、」, or by character when one item is still too long.
    const wrap = (line, maxWidth, size, weight = 600, indent = '') => {
      c.font = font(size, weight);
      const out = [''];
      for (const part of line.split(/(?<=、)/)) {
        if (out[out.length - 1] && c.measureText(out[out.length - 1] + part).width > maxWidth) out.push(indent + part);
        else out[out.length - 1] += part;
      }
      return out.flatMap(seg => {
        const pieces = [''];
        for (const ch of seg) { if (c.measureText(pieces[pieces.length - 1] + ch).width > maxWidth) pieces.push(ch); else pieces[pieces.length - 1] += ch; }
        return pieces;
      });
    };

    // Vertical plan.
    const CARD_W = 440, GAP = 24;
    const chipsW = mvp ? W - P * 2 - CARD_W - GAP : W - P * 2;
    const chipLines = chips.map(ch => wrap(ch.body, chipsW - 40, 25));
    const chipsH = chipLines.reduce((a, lines) => a + 62 + lines.length * 36 + 14, 0) + Math.max(0, chips.length - 1) * 14;
    const tagLines = mvp ? mvp.tags.flatMap(t => wrap(t, CARD_W - 96, 23, 600)) : [];
    const cardH = mvp ? 330 + tagLines.length * 40 + 20 : 0;
    const HEAD = 160, HERO = {y: 182, h: 236}, LINE = {y: 444, h: scored ? 176 : 132};
    const BOX = {y: LINE.y + LINE.h + 26, h: 70 + (s.rows.length + 1) * rowH + 16};
    const BAND = {y: BOX.y + BOX.h + 26, h: Math.max(chipsH, cardH)};
    const H = BAND.y + BAND.h + 110;
    canvas.width = W;
    canvas.height = H;

    // Background: navy gradient, a faint diamond behind the score, red/white/navy top stripe.
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, IMG.bgTop); bg.addColorStop(1, IMG.bgBottom);
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.save(); c.globalAlpha = 0.06; c.translate(W / 2, HERO.y + HERO.h / 2 + 10); c.rotate(Math.PI / 4);
    c.strokeStyle = IMG.white; c.lineWidth = 6; c.strokeRect(-150, -150, 300, 300); c.restore();
    c.save(); c.globalAlpha = 0.035; c.strokeStyle = IMG.white; c.lineWidth = 2;
    for (let x = -H; x < W; x += 46) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + H, H); c.stroke(); }
    c.restore();
    const stripe = c.createLinearGradient(0, 0, W, 0);
    stripe.addColorStop(0, IMG.red); stripe.addColorStop(0.5, IMG.white); stripe.addColorStop(1, '#1d4ed8');
    c.fillStyle = stripe; c.fillRect(0, 0, W, 10);

    // Header: badge, team, date and event.
    const logoSize = 112;
    if (logoLoaded()) c.drawImage(LOGO, P, 26, logoSize, logoSize);
    const tx = logoLoaded() ? P + logoSize + 22 : P;
    text(TEAM_NAME, tx, 84, 38, IMG.white, 'left', 900);
    text('TKU AEROSPACE SOFTBALL・賽後成績', tx, 120, 18, IMG.redSoft, 'left', 700);
    text(game.date || '', W - P, 80, 32, IMG.white, 'right', 800);
    const tag = gameLabel(game.tag || '');
    if (tag) {
      const tw = width(tag, 20, 700) + 32;
      round(W - P - tw, 96, tw, 36, 18); c.fillStyle = '#ffffff14'; c.fill();
      text(tag, W - P - tw / 2, 121, 20, IMG.sky, 'center', 700);
    }
    const sep = c.createLinearGradient(P, 0, W - P, 0);
    sep.addColorStop(0, '#e11d4800'); sep.addColorStop(0.5, '#e11d48aa'); sep.addColorStop(1, '#e11d4800');
    c.fillStyle = sep; c.fillRect(P, HEAD, W - P * 2, 2);

    // Hero: the score (or the team's hits when no score was kept).
    const heroFill = c.createLinearGradient(0, HERO.y, 0, HERO.y + HERO.h);
    heroFill.addColorStop(0, '#16306b'); heroFill.addColorStop(1, '#0d1b3e');
    panel(P, HERO.y, W - P * 2, HERO.h, 30, heroFill);
    const ourName = TEAM_NAME.replace('系壘', '');
    const oppName = game.opponent || '對手';
    const shorten = (str, max) => (str.length > max ? `${str.slice(0, max)}…` : str);
    text(shorten(ourName, 6), P + 44, HERO.y + 104, 44, IMG.white, 'left', 900);
    text(game.ourRole ? `${game.ourRole}・本隊` : '本隊', P + 44, HERO.y + 144, 20, IMG.muted, 'left', 600);
    text(shorten(oppName, 6), W - P - 44, HERO.y + 104, 44, IMG.white, 'right', 900);
    text('對手', W - P - 44, HERO.y + 144, 20, IMG.muted, 'right', 600);
    if (scored) {
      text(String(score.us), W / 2 - 46, HERO.y + 150, 124, IMG.white, 'right', 900);
      text(':', W / 2, HERO.y + 136, 84, '#475569', 'center', 900);
      text(String(score.opp), W / 2 + 46, HERO.y + 150, 124, IMG.white, 'left', 900);
      round(W / 2 - 64, HERO.y + 172, 128, 44, 22); c.fillStyle = result[1]; c.fill();
      text(`${result[0]}・FINAL`, W / 2, HERO.y + 203, 22, '#06101f', 'center', 900);
    } else {
      text(`${teamHits}`, W / 2 - 8, HERO.y + 140, 108, IMG.white, 'right', 900);
      text('安打', W / 2 + 2, HERO.y + 136, 40, IMG.white, 'left', 800);
      text(`${teamXbh} 支長打・比分未記錄`, W / 2, HERO.y + 196, 22, IMG.muted, 'center', 600);
    }

    // Line score: runs by inning, or our hits by inning when no score was kept.
    panel(P, LINE.y, W - P * 2, LINE.h, 22);
    const innings = Array.from({length: s.maxInning}, (_, i) => i + 1);
    const nameW = 210, totalsW = scored ? 150 : 90;
    const colW = (W - P * 2 - 40 - nameW - totalsW) / innings.length;
    const ix = i => P + 20 + nameW + i * colW + colW / 2;
    const headY = LINE.y + 44;
    text(scored ? '局' : '每局安打', P + 28, headY, 18, IMG.dim, 'left', 700);
    innings.forEach((n, i) => text(n, ix(i), headY, 20, IMG.dim, 'center', 700));
    const rX = P + 20 + nameW + innings.length * colW;
    if (scored) {
      text('R', rX + 40, headY, 20, IMG.redSoft, 'center', 800);
      text('H', rX + 110, headY, 20, IMG.dim, 'center', 700);
      const ours = {name: ourName, runs: s.ourRuns, r: score.us, h: teamHits, us: true};
      const opp = {name: oppName, runs: s.oppRuns, r: score.opp, h: '-', us: false};
      (game.ourRole === '先攻' ? [ours, opp] : [opp, ours]).forEach((team, row) => {
        const y = headY + 50 + row * 50;
        if (team.us) { round(P + 12, y - 34, W - P * 2 - 24, 46, 12); c.fillStyle = '#ffffff0d'; c.fill(); }
        text(shorten(team.name, 6), P + 28, y, 24, team.us ? IMG.white : '#cbd5e1', 'left', 800);
        innings.forEach((n, i) => text(team.runs[n] ?? 0, ix(i), y, 24, '#cbd5e1', 'center', 600));
        round(rX + 14, y - 32, 52, 42, 10); c.fillStyle = '#e11d4826'; c.fill();
        text(team.r, rX + 40, y, 28, IMG.white, 'center', 900);
        text(team.h, rX + 110, y, 24, '#cbd5e1', 'center', 600);
      });
    } else {
      const y = headY + 52;
      round(P + 12, y - 34, W - P * 2 - 24, 46, 12); c.fillStyle = '#ffffff0d'; c.fill();
      text(shorten(ourName, 6), P + 28, y, 24, IMG.white, 'left', 800);
      innings.forEach((n, i) => { const v = s.ourHits[n]; text(v ?? '–', ix(i), y, 24, v ? IMG.green : IMG.dim, 'center', v ? 800 : 500); });
      text('H', rX + 45, headY, 20, IMG.dim, 'center', 700);
      text(teamHits, rX + 45, y, 28, IMG.white, 'center', 900);
    }

    // Box score.
    panel(P, BOX.y, W - P * 2, BOX.h, 22);
    const cols = [['棒', P + 34, 'center'], ['打者', P + 78, 'left'], ['打席', 520, 'center'], ['打數', 610, 'center'], ['安打', 700, 'center'], ['長打', 790, 'center'], ['保送', 880, 'center'], ['三振', 970, 'center']];
    const hy = BOX.y + 44;
    round(P + 12, BOX.y + 12, W - P * 2 - 24, 46, 14); c.fillStyle = '#0a1633'; c.fill();
    cols.forEach(([label, x, align]) => text(label, x, hy, 19, IMG.muted, align, 700));
    const totals = {pa: 0, ab: 0, h: 0, xb: 0, bb: 0, k: 0};
    s.rows.forEach((r, i) => {
      const y = BOX.y + 70 + (i + 1) * rowH - 14;
      const isMvp = mvp && r.name === mvp.name;
      if (isMvp) {
        round(P + 12, y - 34, W - P * 2 - 24, rowH - 4, 12); c.fillStyle = '#fbbf2424'; c.fill();
        c.fillStyle = IMG.gold; c.fillRect(P + 12, y - 30, 5, rowH - 12);
      } else if (i % 2) { round(P + 12, y - 34, W - P * 2 - 24, rowH - 4, 12); c.fillStyle = '#ffffff08'; c.fill(); }
      const xb = r.h2 + r.h3 + r.hr;
      for (const [k, v] of Object.entries({pa: r.pa, ab: r.ab, h: r.h, xb, bb: r.bb, k: r.k})) totals[k] += v;
      text(r.isSub ? '替' : r.slot, cols[0][1], y, 22, r.isSub ? '#c4b5fd' : IMG.redSoft, 'center', 800);
      text(r.name + (isMvp ? '  🏆' : ''), cols[1][1], y, 25, IMG.white, 'left', isMvp ? 900 : 700);
      [r.pa, r.ab, r.h, xb, r.bb, r.k].forEach((v, j) => {
        const color = j === 2 && v > 0 ? IMG.green : j === 3 && v > 0 ? IMG.amber : j === 5 && v > 0 ? '#fda4af' : '#e2e8f0';
        text(v, cols[j + 2][1], y, 25, color, 'center', j === 2 && v > 0 ? 900 : 600);
      });
    });
    const ty = BOX.y + 70 + (s.rows.length + 1) * rowH - 10;
    c.fillStyle = '#ffffff26'; c.fillRect(P + 20, ty - 38, W - P * 2 - 40, 2);
    text('合計', cols[1][1], ty, 24, IMG.white, 'left', 900);
    [totals.pa, totals.ab, totals.h, totals.xb, totals.bb, totals.k].forEach((v, j) => text(v, cols[j + 2][1], ty, 25, IMG.white, 'center', 900));

    // Highlights (left) and the MVP (bottom-right).
    let cy = BAND.y;
    chips.forEach((ch, i) => {
      const h = 62 + chipLines[i].length * 36 + 14;
      panel(P, cy, chipsW, h, 20, '#0d1b3e');
      round(P + 18, cy + 16, width(ch.label, 19, 800) + 28, 34, 17); c.fillStyle = ch.color + '33'; c.fill();
      text(ch.label, P + 32, cy + 40, 19, ch.color, 'left', 800);
      chipLines[i].forEach((line, j) => text(line, P + 20, cy + 88 + j * 36, 25, '#e2e8f0', 'left', 600));
      cy += h + 14;
    });
    if (mvp) drawMvpCard(c, text, round, mvp, W - P - CARD_W, BAND.y + BAND.h - cardH, CARD_W, cardH, tagLines, options.mvpPhoto);

    // Footer.
    c.fillStyle = '#ffffff1a'; c.fillRect(P, H - 76, W - P * 2, 2);
    text(`${TEAM_NAME} 數據中心`, W / 2, H - 40, 20, IMG.muted, 'center', 700);
    text('長打含二壘安打、三壘安打、全壘打', W / 2, H - 14, 15, IMG.dim, 'center', 500);
    return canvas;
  }

  function drawMvpCard(c, text, round, mvp, x, y, w, h, tagLines, photo) {
    // Gold frame with a soft glow.
    c.save();
    c.shadowColor = '#fbbf2466'; c.shadowBlur = 36;
    const frame = c.createLinearGradient(x, y, x + w, y + h);
    frame.addColorStop(0, '#fde68a'); frame.addColorStop(0.5, '#f59e0b'); frame.addColorStop(1, '#fbbf24');
    round(x, y, w, h, 28); c.fillStyle = frame; c.fill();
    c.restore();
    const inner = c.createLinearGradient(x, y, x, y + h);
    inner.addColorStop(0, '#1d2a55'); inner.addColorStop(1, '#0b1430');
    round(x + 4, y + 4, w - 8, h - 8, 25); c.fillStyle = inner; c.fill();
    // Watermark and title.
    c.save(); c.globalAlpha = 0.08; text('MVP', x + w - 26, y + 150, 140, '#fbbf24', 'right', 900); c.restore();
    text('★ GAME MVP', x + 30, y + 52, 20, '#fcd34d', 'left', 900);
    text('本場最有價值球員', x + 30, y + 80, 18, '#fde68a', 'left', 600);
    // Photo with a gold ring (or the initial, as on the site).
    const size = 128, cx = x + 30 + size / 2, cy = y + 100 + size / 2;
    c.save(); c.shadowColor = '#fbbf2480'; c.shadowBlur = 24;
    c.beginPath(); c.arc(cx, cy, size / 2 + 6, 0, Math.PI * 2); c.fillStyle = '#fbbf24'; c.fill();
    c.restore();
    c.save(); c.beginPath(); c.arc(cx, cy, size / 2, 0, Math.PI * 2); c.closePath(); c.clip();
    if (photo && photo.complete && photo.naturalWidth) {
      const scale = Math.max(size / photo.naturalWidth, size / photo.naturalHeight);
      const dw = photo.naturalWidth * scale, dh = photo.naturalHeight * scale;
      c.drawImage(photo, cx - dw / 2, cy - dh / 2, dw, dh);
    } else {
      const g = c.createLinearGradient(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
      g.addColorStop(0, '#0284c7'); g.addColorStop(1, '#312e81');
      c.fillStyle = g; c.fillRect(cx - size / 2, cy - size / 2, size, size);
      text(mvp.name.slice(0, 1), cx, cy + 18, 54, '#ffffff', 'center', 900);
    }
    c.restore();
    // Name, number and index.
    const nx = x + 30 + size + 26;
    const jersey = typeof NAME_TO_JERSEY !== 'undefined' && NAME_TO_JERSEY[mvp.name] !== undefined ? `#${NAME_TO_JERSEY[mvp.name]}` : '';
    if (jersey) { round(nx, y + 116, 70, 34, 17); c.fillStyle = '#fbbf2433'; c.fill(); text(jersey, nx + 35, y + 140, 20, '#fcd34d', 'center', 900); }
    text(mvp.name, nx, y + 196, 44, '#ffffff', 'left', 900);
    text(`MVP 指數 +${mvp.score.toFixed(1)}`, nx, y + 228, 20, '#fcd34d', 'left', 700);
    // Game line and what stood out.
    c.fillStyle = '#fbbf2440'; c.fillRect(x + 30, y + 256, w - 60, 2);
    text(mvp.line, x + 30, y + 296, 23, '#f8fafc', 'left', 700);
    tagLines.forEach((t, i) => {
      const ty = y + 336 + i * 40;
      c.beginPath(); c.arc(x + 42, ty - 8, 9, 0, Math.PI * 2); c.fillStyle = '#fbbf24'; c.fill();
      text('★', x + 42, ty - 1, 13, '#1c1203', 'center', 900);
      text(t, x + 62, ty, 23, '#fde68a', 'left', 600);
    });
  }

  function closeImageModal() {
    document.getElementById('insightImageModal')?.remove();
    document.removeEventListener('keydown', onModalKey);
  }
  function onModalKey(event) {
    if (event.key === 'Escape') closeImageModal();
  }

  async function openImageModal(gameId) {
    // Wait briefly for the badge so the first image already carries it.
    await Promise.race([logoReady, new Promise(resolve => setTimeout(resolve, 1500))]);
    const game = allGames.find(g => g.id === gameId);
    if (!game) return;
    closeImageModal();
    const s0 = gameSummary(game);
    const mvp = gameMvp(game, s0.rows);
    let mvpPhoto = null;
    const photoData = mvp && typeof playerAvatars !== 'undefined' ? playerAvatars[mvp.name] : null;
    if (photoData) {
      mvpPhoto = new Image();
      mvpPhoto.src = photoData;
      await Promise.race([mvpPhoto.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
    }
    const canvas = drawGameImage(game, {mvpPhoto});
    const filename = `${TEAM_NAME}_${game.date}_vs_${game.opponent || '對手'}.png`.replace(/[\\/:*?"<>|\s]+/g, '_');
    const modal = document.createElement('div');
    modal.id = 'insightImageModal';
    modal.className = 'fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '賽後成績圖');
    modal.innerHTML = `
      <div class="bg-slate-900 border border-slate-700 rounded-2xl p-4 w-full max-w-md max-h-full flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-black text-sky-200">賽後成績圖</h3>
          <button type="button" data-insight="close" class="text-slate-400 hover:text-white px-2 py-1" aria-label="關閉">✕</button>
        </div>
        <div class="overflow-auto rounded-lg border border-slate-800"><img alt="賽後成績圖預覽" class="w-full block"></div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" data-insight="share" class="bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold rounded-lg py-2.5">分享</button>
          <button type="button" data-insight="download" class="bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold rounded-lg py-2.5">下載圖片</button>
        </div>
        <p class="text-[11px] text-slate-500">手機上「分享」可直接傳到 LINE；若裝置不支援，請用「下載圖片」。</p>
      </div>`;
    modal.querySelector('img').src = canvas.toDataURL('image/png');
    document.body.appendChild(modal);
    document.addEventListener('keydown', onModalKey);
    modal.addEventListener('click', async event => {
      const action = event.target.closest('[data-insight]')?.dataset.insight || (event.target === modal ? 'close' : '');
      if (action === 'close') closeImageModal();
      if (action === 'download') {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = filename;
        link.click();
      }
      if (action === 'share') {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const file = new File([blob], filename, {type: 'image/png'});
        if (navigator.canShare && navigator.canShare({files: [file]})) {
          try { await navigator.share({files: [file], title: `${TEAM_NAME} vs ${game.opponent || ''}`}); } catch (error) { /* user cancelled */ }
        } else {
          showToast('此裝置不支援直接分享，請改用「下載圖片」');
        }
      }
    });
    modal.querySelector('[data-insight="close"]').focus();
  }

  function addImageButton(gameId) {
    const group = document.querySelector('#reviewGameSummaryBadge > div');
    if (!group || isEditingReviewGame || group.querySelector('[data-insight-image]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.insightImage = '';
    button.className = 'bg-sky-950/60 hover:bg-sky-900/80 border border-sky-600/70 text-sky-300 text-xs px-3 py-1 rounded-lg transition font-bold';
    button.textContent = '🖼️ 賽後成績圖';
    button.addEventListener('click', () => openImageModal(gameId));
    group.appendChild(button);
  }

  // ---------- Hooks: run after the original renderers, never instead of them ----------
  const after = (name, hook) => {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (...args) {
      const result = original.apply(this, args);
      try { hook(...args); } catch (error) { console.error(`[team-insights] ${name}`, error); }
      return result;
    };
  };
  after('renderPlayerProfile', agg => {
    renderProfileNote(agg);
    renderGameLog(agg.players.some(p => p.name === selectedPlayerName) ? selectedPlayerName : '');
  });
  after('renderComparison', agg => {
    renderCompareNote(agg);
    renderCompareGameLog(agg);
  });
  after('renderSelectedGameReview', addImageButton);
  after('renderLuckRegressionChart', renderTeamGameLog);
  after('renderSummaryTable', renderAttendance);

  // The first render happened before this file loaded.
  try {
    renderProfileNote(getAnalysisAgg());
    renderGameLog(selectedPlayerName);
    renderCompareNote(getFullAgg());
    renderCompareGameLog(getFullAgg());
    renderTeamGameLog(getAnalysisAgg());
    renderAttendance();
    if (selectedReviewGameId) addImageButton(selectedReviewGameId);
  } catch (error) { console.error('[team-insights] init', error); }

  window.teamInsights = {SAMPLE_PA, RECENT_GAMES, playerGames, form, teamGames, formBoard, streaks, milestones, gameRecords, gameMvp, mvpScore, teamWobaBaseline, attendance, gameSummary, drawGameImage, openImageModal};
})();
