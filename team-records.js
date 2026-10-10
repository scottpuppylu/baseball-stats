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
  // RBI only exist in scorebook plate appearances (manual logs have none).
  function rbiByGame() {
    const out = new Map(); // name -> Map(gameId -> rbi)
    for (const game of allGamesNow()) {
      for (const inn of game.innings || []) {
        if (!isInningOurBat(game.ourRole, inn.topBottom)) continue;
        for (const pa of inn.plateAppearances || []) {
          if (isRunnerOutPlay(pa) || !pa.batterName) continue;
          if (!out.has(pa.batterName)) out.set(pa.batterName, new Map());
          const m = out.get(pa.batterName);
          m.set(game.id, (m.get(game.id) || 0) + (pa.rbi || 0));
        }
      }
    }
    return out;
  }

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

  function playerRecord(name, rbiMap) {
    const games = TI.playerGames(name, allLogsNow());
    if (!games.length) return null;
    const career = games[games.length - 1].toDate; // includes season summaries
    const single = games.filter(g => !g.summary);
    const rbiGames = rbiMap.get(name) || new Map();
    const rbi = [...rbiGames.values()].reduce((a, b) => a + b, 0);
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
    const rbiBest = [...rbiGames.entries()].sort((a, b) => b[1] - a[1])[0];
    if (rbiBest && rbiBest[1] > 0) {
      const g = allGamesNow().find(x => x.id === rbiBest[0]);
      highs.push({key: '打點（場記）', value: rbiBest[1], date: g ? g.date : '', tag: g ? g.tag : ''});
    } else highs.push({key: '打點（場記）', value: 0});
    return {name, games, single, career, rbi, gamesPlayed: single.length, hasSummary: games.length > single.length,
      streaks: st, fun, highs, milestones: TI.milestones(games)};
  }

  function teamRecords() {
    const rbiMap = rbiByGame();
    const names = [...new Set(allLogsNow().filter(l => Number(l.pa) > 0).map(l => l.name))].filter(n => n && !isGuestPlayerName(n));
    return names.map(n => playerRecord(n, rbiMap)).filter(Boolean);
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

  function leaderList(list, value, format = v => v, limit = 5) {
    const ranked = list.map(p => ({p, v: value(p)})).filter(x => Number.isFinite(x.v) && x.v > 0).sort((a, b) => b.v - a.v || b.p.career.pa - a.p.career.pa).slice(0, limit);
    if (!ranked.length) return empty('尚無紀錄');
    let lastV = null, lastRank = 0;
    return `<ol class="space-y-1">${ranked.map((x, i) => {
      const rank = x.v === lastV ? lastRank : i + 1;
      lastV = x.v; lastRank = rank;
      return `<li class="flex items-center justify-between gap-2 text-xs" data-record-row>
        <span class="flex items-center gap-2 min-w-0"><span class="w-5 text-center font-mono ${rank === 1 ? 'text-amber-300 font-black' : 'text-slate-500'}">${rank}</span>${nameButton(x.p.name)}</span>
        <b class="font-mono text-white">${format(x.v)}</b></li>`;
    }).join('')}</ol>`;
  }

  function singleGameList(list, key, limit = 3) {
    const rows = list.flatMap(p => p.single.map(g => ({p, g, v: key === '打點（場記）' ? 0 : ({'安打': g.stats.h, '全壘打': g.stats.hr, '壘打數': tb(g.stats), '長打': g.stats.h2 + g.stats.h3 + g.stats.hr, '保送': g.stats.bb})[key]})))
      .filter(x => x.v > 0).sort((a, b) => b.v - a.v || (a.g.date < b.g.date ? -1 : 1)).slice(0, limit);
    if (!rows.length) return empty('尚無紀錄');
    return `<ol class="space-y-1">${rows.map(x => `<li class="flex items-center justify-between gap-2 text-xs" data-record-row>
        <span class="flex flex-col min-w-0">${nameButton(x.p.name)}${when({date: x.g.date, tag: x.g.tag})}</span><b class="font-mono text-white">${x.v}</b></li>`).join('')}</ol>`;
  }

  // ---------- Records page ----------
  const PAGE_ID = 'panelRecords';
  function renderRecordsPage() {
    const panel = document.getElementById(PAGE_ID);
    if (!panel) return;
    const list = teamRecords();
    const rateList = list.filter(p => p.career.pa >= MIN_RATE_PA);
    const careerCards = [
      ['安打', p => p.career.h], ['全壘打', p => p.career.hr], ['壘打數', p => tb(p.career)], ['二壘安打', p => p.career.h2],
      ['三壘安打', p => p.career.h3], ['保送', p => p.career.bb], ['打席', p => p.career.pa], ['出賽（單場紀錄）', p => p.gamesPlayed],
      ['打點（場記）', p => p.rbi]
    ].map(([title, f]) => card(title, leaderList(list, f))).join('');
    const rateCards = [['打擊率', p => p.career.avg], ['上壘率', p => p.career.obp], ['長打率', p => p.career.slg], ['OPS', p => p.career.ops]]
      .map(([title, f]) => card(`${title}<span class="text-slate-500 font-normal">（≥ ${MIN_RATE_PA} 打席）</span>`, leaderList(rateList, f, rate))).join('');
    const singleCards = ['安打', '全壘打', '壘打數', '長打', '保送'].map(k => card(`單場${k}`, singleGameList(list, k))).join('') +
      card('單場打點（場記）', (() => {
        const rows = list.flatMap(p => p.highs.filter(h => h.key === '打點（場記）' && h.value > 0).map(h => ({p, h}))).sort((a, b) => b.h.value - a.h.value).slice(0, 3);
        return rows.length ? `<ol class="space-y-1">${rows.map(x => `<li class="flex items-center justify-between gap-2 text-xs" data-record-row><span class="flex flex-col min-w-0">${nameButton(x.p.name)}${when(x.h)}</span><b class="font-mono text-white">${x.h.value}</b></li>`).join('')}</ol>`
          : empty('尚無紀錄（場記登打打點後出現）');
      })());
    const streakCards = [
      ['最長連續安打', p => p.streaks.bestHit, '場'], ['最長連續上壘', p => p.streaks.bestOnBase, '場'], ['最長連續無三振', p => p.fun.noK.best, '場'],
      ['進行中：連續安打', p => p.streaks.hit, '場'], ['進行中：連續上壘', p => p.streaks.onBase, '場']
    ].map(([title, f, unit]) => card(title, leaderList(list, f, v => `${v} ${unit}`))).join('');
    const team = teamGameRecords();
    const teamCard = card('全隊單場／單局紀錄（場記）', `<ul class="space-y-1.5">${team.map(r => `<li class="flex items-center justify-between gap-2 text-xs" data-record-row>
        <span class="flex flex-col"><span class="text-slate-300">${r.key}</span>${r.game ? when({date: r.game.date, tag: `${r.game.tag || ''} vs ${r.game.opponent || ''}`}) + (r.note ? `<span class="text-[10px] text-slate-500">${esc(r.note)}</span>` : '') : '<span class="text-[10px] text-slate-500">尚無紀錄</span>'}</span>
        <b class="font-mono text-white">${r.value || '—'}</b></li>`).join('')}</ul>`);
    const funCards = [
      ['猛打賞（單場 3 安以上）', p => p.fun.threeHit, '場'], ['多安打場（2 安以上）', p => p.fun.multiHit, '場'], ['單場多轟（2 轟以上）', p => p.fun.multiHr, '場'],
      ['安打全中（3 打數以上全部安打）', p => p.fun.perfect, '場'], ['完全打擊（一、二、三壘安打與全壘打）', p => p.fun.cycle, '次']
    ].map(([title, f, unit]) => card(title, leaderList(list, f, v => `${v} ${unit}`))).join('');
    const feed = list.flatMap(p => p.milestones.map(m => ({...m, name: p.name}))).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1)).slice(0, 12);
    const feedCard = card('最近達成的里程碑', feed.length ? `<ul class="space-y-1">${feed.map(m => `<li class="flex items-center justify-between gap-2 text-xs" data-record-row>
        <span class="flex items-center gap-2 min-w-0">${nameButton(m.name)}<span class="${m.kind === 'hr' ? 'text-amber-300' : 'text-emerald-300'}">🏅 ${esc(m.text)}</span></span>${when(m)}</li>`).join('')}</ul>` : empty('尚無里程碑'), 'md:col-span-2');
    const section = (id, title, sub, body, cols = 'sm:grid-cols-2 lg:grid-cols-3') => `<section class="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 backdrop-blur-sm" id="${id}">
        <div class="border-b border-slate-800 pb-3"><h2 class="text-lg font-black text-amber-200">${title}</h2><p class="text-xs text-slate-400 mt-1">${sub}</p></div>
        <div class="grid grid-cols-1 ${cols} gap-3">${body}</div></section>`;
    panel.innerHTML =
      section('recordsCareer', '生涯排行榜', `全部紀錄（不受頁首日期篩選影響），含年度彙總；比率類需滿 ${MIN_RATE_PA} 打席。點姓名看個人檔案。`, careerCards + rateCards) +
      section('recordsSingle', '單場紀錄', '單一比賽的最佳表現；年度彙總不算單場。打點只有場記賽事才有。', singleCards + teamCard) +
      section('recordsStreaks', '連續紀錄', '連續安打：有打數的場次連續擊出安打（只有保送的場次不中斷也不延長）；連續上壘：每場至少一次安打或保送；連續無三振：有打席的場次沒有三振。「進行中」為到最近一場仍在延續。', streakCards) +
      section('recordsFun', '趣味紀錄與里程碑', '猛打賞、多轟、安打全中與完全打擊；里程碑為每一支全壘打的序號，與第 10／25／50／75／100… 支安打。', funCards + feedCard);
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
      ['打擊率', rate(c.avg)], ['上壘率', rate(c.obp)], ['長打率', rate(c.slg)], ['OPS', rate(c.ops)], ['壘打數', tb(c)], ['打點(場記)', me.rbi], ['猛打賞', me.fun.threeHit], ['多轟場', me.fun.multiHr]
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
      <p class="text-[11px] text-slate-500">生涯數字含年度彙總（出賽數後的「+」表示另有彙總紀錄）；單場、連續與趣味紀錄只看單場紀錄。打點只有場記賽事。</p>`;
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
