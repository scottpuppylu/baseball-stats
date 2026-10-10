/* Career and fun records: a 「生涯紀錄」 page and a per-player records section on the profile.
   Read-only. Career means every record on file (not the date filter). Game grouping, streaks and milestones
   come from team-insights.js, so the numbers match the game logs everywhere else on the site. */
(() => {
  'use strict';
  const TI = window.teamInsights;
  if (!TI || typeof document === 'undefined') return;

  const MIN_RATE_PA = 30;   // career rate leaders need this many plate appearances
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const rate = value => (Number.isFinite(value) ? value : 0).toFixed(3).replace(/^0\./, '.');
  const gameLabel = tag => String(tag || '').replace(/^場記賽事:\s*/, '') || '手動紀錄';
  const tb = s => s.h + s.h2 + 2 * s.h3 + 3 * s.hr;
  const allLogsNow = () => (typeof allLogs !== 'undefined' ? allLogs : []);
  const allGamesNow = () => (typeof allGames !== 'undefined' ? allGames : []).filter(g => g && g.status !== 'in_progress');

  // ---------- Data ----------
  // Longest run of single games (with a plate appearance) without a strikeout, and the current one.
  function noKStreak(games) {
    let run = 0, best = 0;
    for (const g of games) {
      if (g.summary || !g.stats.pa) continue;
      run = g.stats.k === 0 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return {now: run, best};
  }

  function playerRecord(name) {
    const games = TI.playerGames(name, allLogsNow());
    if (!games.length) return null;
    const career = games[games.length - 1].toDate; // includes season summaries
    const single = games.filter(g => !g.summary);
    const st = TI.streaks(games);
    const nk = noKStreak(games);
    const fun = {
      multiHit: single.filter(g => g.stats.h >= 2).length,
      threeHit: single.filter(g => g.stats.h >= 3).length,
      multiHr: single.filter(g => g.stats.hr >= 2).length,
      perfect: single.filter(g => g.stats.ab >= 3 && g.stats.h === g.stats.ab).length,
      cycle: single.filter(g => g.stats.h - g.stats.h2 - g.stats.h3 - g.stats.hr >= 1 && g.stats.h2 >= 1 && g.stats.h3 >= 1 && g.stats.hr >= 1).length,
      noK: nk
    };
    const highs = [
      ['安打', s => s.h], ['全壘打', s => s.hr], ['壘打數', tb], ['長打', s => s.h2 + s.h3 + s.hr], ['保送', s => s.bb]
    ].map(([key, f]) => {
      let bestGame = null;
      for (const g of single) if (f(g.stats) > 0 && (!bestGame || f(g.stats) > f(bestGame.stats))) bestGame = g;
      return bestGame ? {key, value: f(bestGame.stats), date: bestGame.date, tag: bestGame.tag} : {key, value: 0};
    });
    return {name, games, single, career, gamesPlayed: single.length, hasSummary: games.length > single.length,
      streaks: st, fun, highs, milestones: TI.milestones(games)};
  }

  function teamRecords() {
    const names = [...new Set(allLogsNow().filter(l => Number(l.pa) > 0).map(l => l.name))].filter(n => n && !isGuestPlayerName(n));
    return names.map(n => playerRecord(n)).filter(Boolean);
  }

  // Team single-game and single-inning records from the scorebook.
  function teamGameRecords() {
    const rows = [];
    for (const game of allGamesNow()) {
      let runs = 0, hits = 0, hr = 0, bestInning = null;
      for (const inn of game.innings || []) {
        if (!isInningOurBat(game.ourRole, inn.topBottom)) continue;
        runs += inn.runs || 0;
        hits += inn.hits || 0;
        hr += (inn.plateAppearances || []).filter(p => p.result === 'HR').length;
        if (!bestInning || (inn.runs || 0) > bestInning.runs) bestInning = {runs: inn.runs || 0, inning: inn.inningNum};
      }
      rows.push({game, runs, hits, hr, bestInning});
    }
    const top = (key, value, label) => {
      const best = rows.filter(r => value(r) > 0).sort((a, b) => value(b) - value(a))[0];
      return {key, value: best ? value(best) : 0, game: best ? best.game : null, note: best && label ? label(best) : ''};
    };
    return [
      top('單場得分', r => r.runs),
      top('單場安打', r => r.hits),
      top('單場全壘打', r => r.hr),
      top('單局得分', r => (r.bestInning ? r.bestInning.runs : 0), r => `第 ${r.bestInning.inning} 局`)
    ];
  }

  // ---------- Rendering helpers ----------
  const card = (title, body, extra = '') => `<div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2 ${extra}">
      <div class="text-xs font-bold text-amber-300">${title}</div>${body}</div>`;
  const nameButton = name => `<button type="button" data-record-player="${esc(name)}" class="flex items-center gap-2 min-w-0 text-left hover:text-sky-200">
      ${renderAvatarElement(name, 'w-7 h-7 text-[10px] ring-1 ring-slate-700')}<span class="truncate">${esc(name)}</span></button>`;
  const empty = text => `<p class="text-[11px] text-slate-500">${text}</p>`;
  const when = r => (r.date ? `<span class="text-[10px] text-slate-500 font-mono">${esc(r.date)}${r.tag ? `・${esc(gameLabel(r.tag))}` : ''}</span>` : '');

  // Ranked entries ({p, v, extra}) with ties sharing a rank; at least `limit` players, ties at the cut kept.
  function ranked(list, value, limit = 5) {
    const all = list.map(p => ({p, v: value(p)})).filter(x => Number.isFinite(x.v) && x.v > 0)
      .sort((a, b) => b.v - a.v || b.p.career.pa - a.p.career.pa);
    const cut = all.length > limit ? all[limit - 1].v : -Infinity;
    let rank = 0, last = null;
    return all.filter((x, i) => i < limit || x.v === cut).map((x, i) => {
      if (x.v !== last) { rank = i + 1; last = x.v; }
      return {...x, rank};
    });
  }
  // Group equal values (streaks, counts): one row per value, every player who shares it.
  function grouped(list, value, limit = 3) {
    const by = new Map();
    for (const p of list) { const v = value(p); if (Number.isFinite(v) && v > 0) by.set(v, [...(by.get(v) || []), p]); }
    return [...by.entries()].sort((a, b) => b[0] - a[0]).slice(0, limit).map(([v, players], i) => ({v, players, rank: i + 1}));
  }
  const avatars = (players, max = 4) => `<span class="flex -space-x-2 shrink-0">${players.slice(0, max).map(p => renderAvatarElement(p.name, 'w-7 h-7 text-[10px] ring-2 ring-slate-950')).join('')}</span>`;
  const people = players => players.map(p => `<button type="button" data-record-player="${esc(p.name)}" class="hover:text-sky-200">${esc(p.name)}</button>`).join('<span class="text-slate-600">、</span>');

  // A leaderboard card: the leader large, the rest with a bar against the leader.
  function rankCard(title, list, value, format = v => v, note = '') {
    const rows = ranked(list, value);
    const body = rows.length ? `<ol class="space-y-1.5">${rows.map((x, i) => {
      const pct = Math.max(6, Math.round(x.v / rows[0].v * 100));
      if (i === 0 || x.rank === 1) return `<li class="flex items-center gap-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5" data-record-row data-value="${x.v}">
          <span class="text-amber-300 text-base" aria-label="第 1 名">👑</span>
          <button type="button" data-record-player="${esc(x.p.name)}" class="flex items-center gap-2 min-w-0 flex-1 text-left">${renderAvatarElement(x.p.name, 'w-9 h-9 text-xs ring-2 ring-amber-400/70')}<span class="font-bold text-white truncate">${esc(x.p.name)}</span></button>
          <b class="font-mono text-lg text-amber-200">${format(x.v)}</b></li>`;
      return `<li class="relative flex items-center gap-2 px-2 py-1 text-xs" data-record-row data-value="${x.v}">
          <span class="absolute inset-y-0.5 left-0 rounded-md bg-sky-500/10" style="width:${pct}%"></span>
          <span class="relative w-5 text-center font-mono text-slate-500">${x.rank}</span>
          <button type="button" data-record-player="${esc(x.p.name)}" class="relative flex items-center gap-2 min-w-0 flex-1 text-left hover:text-sky-200">${renderAvatarElement(x.p.name, 'w-6 h-6 text-[9px] ring-1 ring-slate-700')}<span class="truncate">${esc(x.p.name)}</span></button>
          <b class="relative font-mono text-slate-100">${format(x.v)}</b></li>`;
    }).join('')}</ol>` : empty('尚無紀錄');
    return `<div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5" data-record-card="${esc(title)}">
        <div class="flex items-baseline justify-between gap-2"><h4 class="text-sm font-black text-slate-100">${title}</h4>${note ? `<span class="text-[10px] text-slate-500">${note}</span>` : ''}</div>${body}</div>`;
  }

  // A card for small counts and streaks, where many players tie: one line per value.
  function groupCard(title, list, value, unit, note = '') {
    const rows = grouped(list, value);
    return `<div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5 ui-record-group" data-record-card="${esc(title)}">
        <div class="flex items-baseline justify-between gap-2"><h4 class="text-sm font-black text-slate-100">${title}</h4>${note ? `<span class="text-[10px] text-slate-500">${note}</span>` : ''}</div>
        ${rows.length ? `<ol class="space-y-2">${rows.map(r => `<li class="flex flex-wrap items-center gap-x-3 gap-y-1 ${r.rank === 1 ? 'rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5' : 'px-2'}" data-record-row data-value="${r.v}">
            <b class="font-mono ${r.rank === 1 ? 'text-xl text-amber-200' : 'text-base text-slate-200'} w-16 shrink-0">${r.v}<span class="text-[11px] font-sans font-semibold text-slate-400"> ${unit}</span></b>
            ${avatars(r.players)}<span class="text-xs text-slate-300 leading-relaxed basis-full pl-1">${people(r.players)}</span></li>`).join('')}</ol>` : empty('尚無紀錄')}</div>`;
  }

  // Single-game bests: value, player and the game.
  function singleCard(title, list, value) {
    const rows = list.flatMap(p => p.single.map(g => ({p, g, v: value(g.stats)}))).filter(x => x.v > 0)
      .sort((a, b) => b.v - a.v || (a.g.date < b.g.date ? -1 : 1)).slice(0, 3);
    return `<div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5" data-record-card="${esc(title)}">
        <h4 class="text-sm font-black text-slate-100">${title}</h4>
        ${rows.length ? `<ol class="space-y-1.5">${rows.map((x, i) => `<li class="flex items-center gap-2.5 ${i === 0 ? 'rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5' : 'px-2'}" data-record-row data-value="${x.v}">
            <b class="font-mono w-8 text-center ${i === 0 ? 'text-xl text-amber-200' : 'text-base text-slate-200'}">${x.v}</b>
            <button type="button" data-record-player="${esc(x.p.name)}" class="flex items-center gap-2 min-w-0 flex-1 text-left">${renderAvatarElement(x.p.name, 'w-7 h-7 text-[10px] ring-1 ring-slate-700')}
              <span class="flex flex-col min-w-0"><span class="text-xs font-bold text-white truncate">${esc(x.p.name)}</span><span class="text-[10px] text-slate-500 font-mono truncate">${esc(x.g.date)}・${esc(gameLabel(x.g.tag))}</span></span></button></li>`).join('')}</ol>` : empty('尚無紀錄')}</div>`;
  }

  // ---------- Records page ----------
  const PAGE_ID = 'panelRecords';
  function renderRecordsPage() {
    const panel = document.getElementById(PAGE_ID);
    if (!panel) return;
    const list = teamRecords();
    const rateList = list.filter(p => p.career.pa >= MIN_RATE_PA);
    const single = (p, f) => Math.max(0, ...p.single.map(g => f(g.stats)));

    // 隊史之最: the headline records, each with its holder(s) and the runner-up.
    const feed = list.flatMap(p => p.milestones.map(m => ({...m, name: p.name}))).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
    const heroOf = (label, pool, value, format = v => v, unit = '') => {
      const g = grouped(pool, value, 2);
      if (!g.length) return {label, empty: true};
      return {label, holders: g[0].players, value: `${format(g[0].v)}${unit}`, next: g[1] ? `第二名 ${g[1].players.map(p => p.name).join('、')}　${format(g[1].v)}${unit}` : ''};
    };
    const heroes = [
      heroOf('生涯安打王', list, p => p.career.h, v => v, ' 支'),
      heroOf('生涯全壘打王', list, p => p.career.hr, v => v, ' 支'),
      heroOf(`生涯 OPS 王`, rateList, p => p.career.ops, rate),
      heroOf('單場最多安打', list, p => single(p, s => s.h), v => v, ' 支'),
      heroOf('最長連續安打', list, p => p.streaks.bestHit, v => v, ' 場')
    ];
    const latest = feed[0];
    const heroTile = h => h.empty ? `<div class="rounded-2xl border border-slate-800 bg-slate-950/60 p-3" data-record-hero="${esc(h.label)}"><div class="text-[11px] text-slate-400">${h.label}</div><div class="text-sm text-slate-500 mt-2">尚無紀錄</div></div>`
      : `<div class="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-slate-950/80 to-slate-950 p-3 space-y-2" data-record-hero="${esc(h.label)}">
          <div class="text-[11px] font-bold text-amber-300 tracking-wide">${h.label}</div>
          <div class="flex items-center gap-2.5">${avatars(h.holders, 3)}<div class="min-w-0"><div class="text-sm font-black text-white leading-tight">${people(h.holders)}</div><div class="font-mono text-2xl font-black text-amber-200 leading-tight">${h.value}</div></div></div>
          ${h.next ? `<div class="text-[10px] text-slate-500 truncate">${esc(h.next)}</div>` : ''}</div>`;
    const latestTile = latest ? `<div class="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-slate-950/80 to-slate-950 p-3 space-y-2" data-record-hero="最新里程碑">
          <div class="text-[11px] font-bold text-emerald-300 tracking-wide">最新里程碑</div>
          <div class="flex items-center gap-2.5">${renderAvatarElement(latest.name, 'w-9 h-9 text-xs ring-2 ring-emerald-400/60')}<div class="min-w-0"><button type="button" data-record-player="${esc(latest.name)}" class="text-sm font-black text-white">${esc(latest.name)}</button><div class="text-sm font-bold text-emerald-200">🏅 ${esc(latest.text)}</div></div></div>
          <div class="text-[10px] text-slate-500 font-mono">${esc(latest.date)}・${esc(gameLabel(latest.tag))}</div></div>` : '';

    const careerCards = [
      ['安打', p => p.career.h], ['全壘打', p => p.career.hr], ['壘打數', p => tb(p.career)], ['二壘安打', p => p.career.h2],
      ['三壘安打', p => p.career.h3], ['保送', p => p.career.bb], ['打席', p => p.career.pa]
    ].map(([title, f, note]) => rankCard(title, list, f, v => v, note)).join('') +
      // Many players share the same number of games, so they are grouped.
      groupCard('出賽', list, p => p.gamesPlayed, '場', '單場紀錄');
    const rateCards = [['打擊率', p => p.career.avg], ['上壘率', p => p.career.obp], ['長打率', p => p.career.slg], ['OPS', p => p.career.ops]]
      .map(([title, f]) => rankCard(title, rateList, f, rate, `≥ ${MIN_RATE_PA} 打席`)).join('');
    const singleCards = [['單場安打', s => s.h], ['單場全壘打', s => s.hr], ['單場壘打數', tb], ['單場長打', s => s.h2 + s.h3 + s.hr], ['單場保送', s => s.bb]]
      .map(([title, f]) => singleCard(title, list, f)).join('');
    const team = teamGameRecords();
    const teamCard = `<div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 space-y-2" data-record-card="全隊單場紀錄">
        <h4 class="text-sm font-black text-slate-100">全隊單場／單局紀錄 <span class="text-[10px] font-normal text-slate-500">場記</span></h4>
        <ul class="grid grid-cols-2 gap-2">${team.map(r => `<li class="rounded-lg bg-slate-900/70 border border-slate-800 p-2" data-record-row data-value="${r.value}">
          <div class="text-[10px] text-slate-400">${r.key}</div><div class="font-mono text-xl font-black ${r.value ? 'text-white' : 'text-slate-600'}">${r.value || '—'}</div>
          <div class="text-[10px] text-slate-500 truncate">${r.game ? `${esc(r.game.date)}${r.note ? `・${esc(r.note)}` : ''}` : '尚無紀錄'}</div></li>`).join('')}</ul></div>`;
    const streakCards = [
      ['最長連續安打', p => p.streaks.bestHit], ['最長連續上壘', p => p.streaks.bestOnBase], ['最長連續無三振', p => p.fun.noK.best],
      ['進行中：連續安打', p => p.streaks.hit], ['進行中：連續上壘', p => p.streaks.onBase]
    ].map(([title, f]) => groupCard(title, list, f, '場')).join('');
    // Fun records: the ones somebody has, then the ones still waiting for a first holder.
    const FUN = [
      ['猛打賞', '單場 3 安以上', p => p.fun.threeHit, '場'], ['多安打場', '單場 2 安以上', p => p.fun.multiHit, '場'], ['單場多轟', '單場 2 轟以上', p => p.fun.multiHr, '場'],
      ['安打全中', '3 打數以上全部安打', p => p.fun.perfect, '場'], ['完全打擊', '一、二、三壘安打與全壘打', p => p.fun.cycle, '次']
    ];
    const achieved = FUN.filter(([, , f]) => list.some(p => f(p) > 0));
    const locked = FUN.filter(([, , f]) => !list.some(p => f(p) > 0));
    const funCards = achieved.map(([title, note, f, unit]) => groupCard(title, list, f, unit, note)).join('');
    const lockedRow = locked.length ? `<div class="sm:col-span-2 lg:col-span-3 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-3" data-record-locked>
        <div class="text-[11px] text-slate-400 mb-2">待解鎖：還沒有人達成</div>
        <div class="flex flex-wrap gap-2">${locked.map(([title, note]) => `<span class="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-400" data-record-card="${esc(title)}">🔒 ${title}<span class="text-slate-600">・${note}</span></span>`).join('')}</div></div>` : '';
    const timeline = feed.slice(0, 12);
    const feedCard = `<div class="sm:col-span-2 lg:col-span-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-3" data-record-card="最近達成的里程碑">
        <h4 class="text-sm font-black text-slate-100 mb-3">最近達成的里程碑</h4>
        ${timeline.length ? `<ol class="relative border-l border-slate-700 ml-3 space-y-3">${timeline.map(m => `<li class="ml-4" data-record-row>
          <span class="absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full ${m.kind === 'hr' ? 'bg-amber-400' : 'bg-emerald-400'}"></span>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5"><button type="button" data-record-player="${esc(m.name)}" class="flex items-center gap-1.5 text-sm font-bold text-white">${renderAvatarElement(m.name, 'w-6 h-6 text-[9px] ring-1 ring-slate-700')}${esc(m.name)}</button>
          <span class="text-sm ${m.kind === 'hr' ? 'text-amber-300' : 'text-emerald-300'}">🏅 ${esc(m.text)}</span>
          <span class="text-[10px] text-slate-500 font-mono">${esc(m.date)}・${esc(gameLabel(m.tag))}</span></div></li>`).join('')}</ol>` : empty('尚無里程碑')}</div>`;

    const section = (id, title, sub, body, cols = 'sm:grid-cols-2 lg:grid-cols-3') => `<section class="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 backdrop-blur-sm" id="${id}">
        <div class="border-b border-slate-800 pb-3"><h2 class="text-lg font-black text-amber-200">${title}</h2><p class="text-xs text-slate-400 mt-1">${sub}</p></div>
        <div class="grid grid-cols-1 ${cols} gap-3">${body}</div></section>`;
    panel.innerHTML =
      section('recordsHero', '隊史之最', '全部紀錄（不受頁首日期篩選影響）的代表性紀錄；並列時列出所有紀錄保持人。點姓名看個人檔案。', heroes.map(heroTile).join('') + latestTile, 'sm:grid-cols-2 lg:grid-cols-3') +
      section('recordsCareer', '生涯排行榜', `含年度彙總；比率類需滿 ${MIN_RATE_PA} 打席。長條為與第一名的比例。`, careerCards + rateCards, 'sm:grid-cols-2 lg:grid-cols-4') +
      section('recordsSingle', '單場紀錄', '單一比賽的最佳表現；年度彙總不算單場。', singleCards + teamCard) +
      section('recordsStreaks', '連續紀錄', '連續安打：有打數的場次連續擊出安打（只有保送的場次不中斷也不延長）；連續上壘：每場至少一次安打或保送；連續無三振：有打席的場次沒有三振。同場數的球員合併在同一列。', streakCards) +
      section('recordsFun', '趣味紀錄與里程碑', '猛打賞、多轟、安打全中與完全打擊；里程碑為每一支全壘打的序號，與第 10／25／50／75／100… 支安打。', funCards + lockedRow + feedCard);
  }

  // ---------- Profile section ----------
  function rankOf(list, name, value) {
    const sorted = list.map(p => value(p)).filter(v => v > 0).sort((a, b) => b - a);
    const mine = value(list.find(p => p.name === name) || {career: {}, fun: {noK: {}}, streaks: {}});
    if (!(mine > 0)) return null;
    return {rank: sorted.indexOf(mine) + 1, of: sorted.length};
  }

  // Profile order: who the player is now (profile, recent form, diagnosis), then the batted-ball detail behind
  // the diagnosis (types, then where the balls went), and history (career records) last.
  function arrangeProfile(career) {
    const panel = document.getElementById('panelProfile');
    if (!panel) return;
    const sectionOf = el => el && el.closest('#panelProfile > section');
    const order = [
      panel.querySelector(':scope > section'),
      document.getElementById('insightGameLogSection'),
      sectionOf(document.getElementById('diagnosticsCardsContainer')),
      sectionOf(document.getElementById('profileBattedBallChart')),
      sectionOf(document.getElementById('profileSprayPointsContainer')),
      career
    ].filter((el, i, all) => el && all.indexOf(el) === i);
    const current = [...panel.children].filter(el => order.includes(el));
    if (current.length === order.length && current.every((el, i) => el === order[i])) return;
    order.forEach(el => panel.append(el));
  }

  function renderProfileRecords(name) {
    const anchor = document.getElementById('insightGameLogSection') || document.getElementById('playerProfileCard')?.closest('section');
    if (!anchor) return;
    let section = document.getElementById('insightCareerSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'insightCareerSection';
      section.className = 'bg-slate-900/80 border border-amber-900/40 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 backdrop-blur-sm';
      section.addEventListener('click', openPlayer);
    }
    arrangeProfile(section);
    const list = teamRecords();
    const me = list.find(p => p.name === name);
    const head = `<div class="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <h3 class="text-lg font-black text-amber-200">${esc(name)} 生涯紀錄與趣味紀錄</h3>
        <span class="text-xs text-slate-400">全部紀錄，不受日期篩選影響</span></div>`;
    if (!me) { section.innerHTML = `${head}${empty('尚無打擊紀錄。')}`; return; }
    const c = me.career;
    const ranks = [['安打', p => p.career.h], ['全壘打', p => p.career.hr], ['壘打數', p => tb(p.career)], ['打席', p => p.career.pa]]
      .map(([k, f]) => ({k, r: rankOf(list, name, f)})).filter(x => x.r);
    const line = `<div class="grid grid-cols-4 sm:grid-cols-8 gap-2 text-center" data-career-line>${[
      ['出賽', me.gamesPlayed + (me.hasSummary ? '+' : '')], ['打席', c.pa], ['安打', c.h], ['二安', c.h2], ['三安', c.h3], ['全壘打', c.hr], ['保送', c.bb], ['三振', c.k],
      ['打擊率', rate(c.avg)], ['上壘率', rate(c.obp)], ['長打率', rate(c.slg)], ['OPS', rate(c.ops)], ['壘打數', tb(c)], ['猛打賞', me.fun.threeHit], ['多轟場', me.fun.multiHr]
    ].map(([k, v]) => `<div class="bg-slate-950/70 border border-slate-800 rounded-lg py-1.5"><div class="text-[10px] text-slate-400">${k}</div><div class="font-mono font-black text-white">${v}</div></div>`).join('')}</div>`;
    const highs = card('生涯單場最佳', `<ul class="space-y-1">${me.highs.map(h => `<li class="flex items-center justify-between gap-2 text-xs"><span class="text-slate-300">${h.key}</span><span class="flex items-center gap-2">${h.value ? when(h) : ''}<b class="font-mono text-white">${h.value || '—'}</b></span></li>`).join('')}</ul>`);
    const streaks = card('連續紀錄（生涯）', `<ul class="space-y-1 text-xs">${[
      ['最長連續安打', `${me.streaks.bestHit} 場`, `進行中 ${me.streaks.hit} 場`], ['最長連續上壘', `${me.streaks.bestOnBase} 場`, `進行中 ${me.streaks.onBase} 場`],
      ['最長連續無三振', `${me.fun.noK.best} 場`, `進行中 ${me.fun.noK.now} 場`]
    ].map(([k, v, now]) => `<li class="flex items-center justify-between gap-2"><span class="text-slate-300">${k}</span><span><b class="font-mono text-white">${v}</b> <span class="text-[10px] text-slate-500">${now}</span></span></li>`).join('')}</ul>`);
    const badges = [
      me.fun.cycle && `完全打擊 ×${me.fun.cycle}`, me.fun.perfect && `安打全中 ×${me.fun.perfect}`, me.fun.threeHit && `猛打賞 ×${me.fun.threeHit}`,
      me.fun.multiHr && `單場多轟 ×${me.fun.multiHr}`, me.fun.multiHit && `多安打場 ×${me.fun.multiHit}`,
      ...ranks.filter(x => x.r.rank <= 3).map(x => `隊史${x.k}第 ${x.r.rank} 名`)
    ].filter(Boolean);
    const fun = card('趣味紀錄與隊內排名', `${badges.length ? `<div class="flex flex-wrap gap-1.5">${badges.map(b => `<span class="text-[11px] px-2 py-0.5 rounded-full border border-amber-600/50 bg-amber-950/30 text-amber-200" data-career-badge>🏆 ${esc(b)}</span>`).join('')}</div>` : empty('還沒有趣味紀錄，繼續加油！')}
      ${ranks.length ? `<div class="text-[11px] text-slate-400">隊內生涯排名：${ranks.map(x => `${x.k}第 ${x.r.rank}／${x.r.of}`).join('・')}</div>` : ''}`);
    const marks = me.milestones.slice().reverse();
    const milestoneCard = card('生涯里程碑', marks.length ? `<ul class="space-y-1">${marks.map(m => `<li class="flex items-center justify-between gap-2 text-xs"><span class="${m.kind === 'hr' ? 'text-amber-300' : 'text-emerald-300'}">🏅 ${esc(m.text)}</span>${when(m)}</li>`).join('')}</ul>` : empty('尚未達成里程碑（首支全壘打、第 10 支安打起算）'));
    section.innerHTML = `${head}${line}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${highs}${streaks}${fun}${milestoneCard}</div>
      <p class="text-[11px] text-slate-500">生涯數字含年度彙總（出賽數後的「+」表示另有彙總紀錄）；單場、連續與趣味紀錄只看單場紀錄。</p>`;
  }

  // ---------- Page wiring: a nav button and panel added next to the others ----------
  function openPlayer(event) {
    const target = event.target.closest('[data-record-player]');
    if (!target) return;
    selectedPlayerName = target.dataset.recordPlayer;
    switchMainTab('tabProfile');
  }
  const nav = document.getElementById('mainNavigation');
  const main = document.querySelector('#appWorkspace main');
  const glossaryButton = document.getElementById('btnTabGlossary');
  const glossaryPanel = document.getElementById('panelGlossary');
  if (nav && main && glossaryButton && glossaryPanel && !document.getElementById(PAGE_ID)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'btnTabRecords';
    // The same classes the site's own switch gives its buttons.
    const ACTIVE = 'tab-active text-xs px-3 py-1.5 rounded-lg border font-bold transition flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0';
    const INACTIVE = 'text-slate-400 hover:text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-transparent font-medium transition flex items-center gap-1.5 whitespace-nowrap shrink-0';
    button.className = INACTIVE;
    button.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8 21h8m-4-4v4m-5-17h10v5a5 5 0 01-10 0V4zm10 2h3a2 2 0 01-2 4h-1M7 6H4a2 2 0 002 4h1"/></svg><span>生涯紀錄</span>';
    glossaryButton.before(button);
    const panel = document.createElement('div');
    panel.id = PAGE_ID;
    panel.className = 'hidden space-y-6';
    panel.addEventListener('click', openPlayer);
    glossaryPanel.before(panel);
    const original = window.switchMainTab;
    window.switchMainTab = function (tabId) {
      // For an id it does not know, the site's own switch hides every page and resets every button.
      const result = original.call(this, tabId);
      const on = tabId === 'tabRecords';
      panel.classList.toggle('hidden', !on);
      button.className = on ? ACTIVE : INACTIVE;
      // Hidden, the page keeps no markup (about a hundred rows with photos); it re-renders when opened.
      if (on) renderRecordsPage(); else if (panel.firstChild) panel.innerHTML = '';
      return result;
    };
    button.addEventListener('click', () => switchMainTab('tabRecords'));
  }

  // ---------- Hooks ----------
  const after = (name, hook) => {
    const fn = window[name];
    if (typeof fn !== 'function') return;
    window[name] = function (...args) {
      const result = fn.apply(this, args);
      try { hook(...args); } catch (error) { console.error(`[team-records] ${name}`, error); }
      return result;
    };
  };
  after('renderPlayerProfile', agg => renderProfileRecords(agg.players.some(p => p.name === selectedPlayerName) ? selectedPlayerName : ''));
  after('renderAll', () => { if (!document.getElementById(PAGE_ID)?.classList.contains('hidden')) renderRecordsPage(); });
  try { renderProfileRecords(selectedPlayerName); } catch (error) { console.error('[team-records] init', error); }

  window.teamRecords = {MIN_RATE_PA, teamRecords, teamGameRecords, playerRecord, noKStreak, renderRecordsPage};
})();
