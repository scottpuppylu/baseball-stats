/* Read-only insight layer: game logs, small-sample notes and post-game images.
   It reuses the site's own aggregation, never writes game data and never calls cloud APIs. */
(() => {
  'use strict';
  // Rate stats below this many PA swing heavily; about six or seven games for this team.
  const SAMPLE_PA = 20;
  const RECENT_GAMES = 5;
  const TEAM_NAME = '淡江航太系壘';
  const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

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

  function playerGames(name) {
    const groups = new Map();
    for (const log of getFilteredLogs()) {
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
    const season = games[games.length - 1].toDate;
    const played = games.filter(g => !g.summary);
    const recentCount = Math.min(RECENT_GAMES, played.length);
    const recent = recentCount ? statsFor(played.slice(-RECENT_GAMES).flatMap(g => g.logs)) : null;
    const diff = recent ? recent.ops - season.ops : 0;
    const trend = played.length <= RECENT_GAMES ? '<span class="text-slate-400">場數不足以比較近況</span>'
      : Math.abs(diff) < 0.05 ? '<span class="text-slate-300">與本期相近</span>'
        : diff > 0 ? `<span class="text-emerald-400">▲ 近況較佳（OPS +${rate(diff)}）</span>`
          : `<span class="text-rose-400">▼ 近況下滑（OPS −${rate(-diff)}）</span>`;
    const line = s => `${rate(s.avg)} / ${rate(s.obp)} / ${rate(s.slg)}`;
    const rows = games.slice().reverse().map(g => `
      <tr class="hover:bg-slate-800/50 ${g.summary ? 'bg-slate-800/40' : ''}">
        <td class="p-2 font-mono whitespace-nowrap">${esc(g.date)}</td>
        <td class="p-2 text-slate-300 whitespace-nowrap">${esc(gameLabel(g.tag))}${g.summary ? ' <span class="text-[10px] text-slate-400 border border-slate-600 rounded px-1">年度彙總</span>' : ''}</td>
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
    const box = new Map(batters.map(b => [b.name, {pa: 0, ab: 0, h: 0, h2: 0, h3: 0, hr: 0, bb: 0, k: 0, rbi: 0}]));
    // Mirrors the review box score: runner outs never count as the batter's plate appearance.
    for (const inn of game.innings || []) {
      for (const pa of inn.plateAppearances || []) {
        if (pa.result === 'RUNNER_OUT' || pa.isRunnerOut) continue;
        if (!box.has(pa.batterName)) {
          box.set(pa.batterName, {pa: 0, ab: 0, h: 0, h2: 0, h3: 0, hr: 0, bb: 0, k: 0, rbi: 0});
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
        p.rbi += pa.rbi || 0;
      }
    }
    const maxInning = Math.max(7, ...(game.innings || []).map(i => i.inningNum));
    return {ourRuns, ourHits, oppRuns, maxInning, rows: batters.map(b => ({...b, ...box.get(b.name)}))};
  }

  function drawGameImage(game) {
    const s = gameSummary(game);
    const score = game.finalScore || {us: 0, opp: 0};
    const result = score.us > score.opp ? ['勝', '#34d399'] : score.us < score.opp ? ['敗', '#fb7185'] : ['和', '#fbbf24'];
    const W = 1080, rowH = 52, pad = 56;
    const highlights = [];
    const hr = s.rows.filter(r => r.hr > 0).map(r => `${r.name}${r.hr > 1 ? ` ×${r.hr}` : ''}`);
    if (hr.length) highlights.push(`全壘打：${hr.join('、')}`);
    const multi = s.rows.filter(r => r.h >= 2).map(r => `${r.name} ${r.h}安`);
    if (multi.length) highlights.push(`多安打：${multi.join('、')}`);
    const rbi = s.rows.filter(r => r.rbi >= 2).map(r => `${r.name} ${r.rbi}分打點`);
    if (rbi.length) highlights.push(`打點：${rbi.join('、')}`);
    const canvas = document.createElement('canvas');
    const c = canvas.getContext('2d');
    // Wrap highlight lines at "、" so long lists stay readable instead of being cut off.
    c.font = `600 26px ${FONT}`;
    const wrapped = highlights.flatMap(line => {
      const out = [''];
      for (const part of line.split(/(?<=、)/)) {
        if (out[out.length - 1] && c.measureText(out[out.length - 1] + part).width > W - pad * 2) out.push('　　' + part);
        else out[out.length - 1] += part;
      }
      return out;
    });
    const H = 560 + (s.rows.length + 1) * rowH + wrapped.length * 42 + 120;
    canvas.width = W;
    canvas.height = H;
    const text = (str, x, y, size, color, align = 'left', weight = 700) => {
      c.font = `${weight} ${size}px ${FONT}`;
      c.fillStyle = color;
      c.textAlign = align;
      c.fillText(String(str), x, y);
    };
    c.fillStyle = '#0b1120';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#38bdf8';
    c.fillRect(0, 0, W, 10);

    text(TEAM_NAME, pad, 86, 30, '#7dd3fc');
    text(`${game.date}　${game.tag || ''}`, W - pad, 86, 26, '#94a3b8', 'right', 500);
    text(TEAM_NAME.replace('系壘', ''), pad, 200, 44, '#f8fafc');
    text(String(score.us), W / 2 - 70, 210, 96, '#f8fafc', 'right', 900);
    text(':', W / 2, 200, 70, '#64748b', 'center', 900);
    text(String(score.opp), W / 2 + 70, 210, 96, '#f8fafc', 'left', 900);
    text(game.opponent || '對手', W - pad, 200, 44, '#f8fafc', 'right');
    c.fillStyle = result[1];
    c.beginPath();
    c.arc(W / 2, 268, 30, 0, Math.PI * 2);
    c.fill();
    text(result[0], W / 2, 280, 32, '#0b1120', 'center', 900);

    // Line score, visiting team on top.
    let y = 350;
    const innings = Array.from({length: s.maxInning}, (_, i) => i + 1);
    const colW = Math.min(64, (W - pad * 2 - 300) / innings.length);
    const x0 = pad + 180;
    const ours = {name: TEAM_NAME.replace('系壘', ''), runs: s.ourRuns, r: score.us, h: Object.values(s.ourHits).reduce((a, b) => a + b, 0)};
    const opp = {name: game.opponent || '對手', runs: s.oppRuns, r: score.opp, h: '-'};
    const order = game.ourRole === '先攻' ? [ours, opp] : [opp, ours];
    innings.forEach((n, i) => text(n, x0 + i * colW + colW / 2, y, 22, '#64748b', 'center', 600));
    text('R', x0 + innings.length * colW + 40, y, 22, '#64748b', 'center', 600);
    text('H', x0 + innings.length * colW + 100, y, 22, '#64748b', 'center', 600);
    order.forEach((team, row) => {
      const ty = y + 50 + row * 48;
      text(team.name.length > 6 ? `${team.name.slice(0, 6)}…` : team.name, pad, ty, 26, '#e2e8f0');
      innings.forEach((n, i) => text(team.runs[n] ?? 0, x0 + i * colW + colW / 2, ty, 26, '#cbd5e1', 'center', 600));
      text(team.r, x0 + innings.length * colW + 40, ty, 28, '#f8fafc', 'center', 900);
      text(team.h, x0 + innings.length * colW + 100, ty, 26, '#cbd5e1', 'center', 600);
    });

    // Batting box score.
    y = 540;
    const cols = [['棒', 70], ['打者', 250], ['打席', 470], ['打數', 560], ['安打', 650], ['長打', 750], ['打點', 850], ['保送', 930], ['三振', 1010]];
    c.fillStyle = '#111c33';
    c.fillRect(pad - 16, y - 36, W - (pad - 16) * 2, rowH);
    cols.forEach(([label, x]) => text(label, x, y, 22, '#94a3b8', x > 400 ? 'center' : 'left', 600));
    const totals = {pa: 0, ab: 0, h: 0, xb: 0, rbi: 0, bb: 0, k: 0};
    s.rows.forEach((r, i) => {
      const ry = y + (i + 1) * rowH;
      const xb = r.h2 + r.h3 + r.hr;
      for (const [k, v] of Object.entries({pa: r.pa, ab: r.ab, h: r.h, xb, rbi: r.rbi, bb: r.bb, k: r.k})) totals[k] += v;
      text(r.isSub ? '替' : r.slot, 70, ry, 24, r.isSub ? '#c4b5fd' : '#fbbf24');
      text(r.name, 130, ry, 26, '#f1f5f9');
      [r.pa, r.ab, r.h, xb, r.rbi, r.bb, r.k].forEach((v, j) => text(v, cols[j + 2][1], ry, 26, j === 2 && v > 0 ? '#34d399' : j === 3 && v > 0 ? '#fbbf24' : '#e2e8f0', 'center', j === 2 ? 800 : 600));
    });
    const ty = y + (s.rows.length + 1) * rowH;
    c.fillStyle = '#334155';
    c.fillRect(pad - 16, ty - 38, W - (pad - 16) * 2, 2);
    text('合計', 130, ty, 26, '#fbbf24');
    [totals.pa, totals.ab, totals.h, totals.xb, totals.rbi, totals.bb, totals.k].forEach((v, j) => text(v, cols[j + 2][1], ty, 26, '#fbbf24', 'center', 800));

    let hy = ty + 70;
    wrapped.forEach(line => {
      text(line, pad, hy, 26, '#e2e8f0', 'left', 600);
      hy += 42;
    });
    text(`${TEAM_NAME} 數據中心 · 長打含二壘安打、三壘安打、全壘打`, W / 2, H - 40, 20, '#475569', 'center', 500);
    return canvas;
  }

  function closeImageModal() {
    document.getElementById('insightImageModal')?.remove();
    document.removeEventListener('keydown', onModalKey);
  }
  function onModalKey(event) {
    if (event.key === 'Escape') closeImageModal();
  }

  function openImageModal(gameId) {
    const game = allGames.find(g => g.id === gameId);
    if (!game) return;
    closeImageModal();
    const canvas = drawGameImage(game);
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
  after('renderComparison', renderCompareNote);
  after('renderSelectedGameReview', addImageButton);

  // The first render happened before this file loaded.
  try {
    renderProfileNote(getAnalysisAgg());
    renderGameLog(selectedPlayerName);
    renderCompareNote(getFullAgg());
    if (selectedReviewGameId) addImageButton(selectedReviewGameId);
  } catch (error) { console.error('[team-insights] init', error); }

  window.teamInsights = {SAMPLE_PA, RECENT_GAMES, playerGames, gameSummary, drawGameImage, openImageModal};
})();
