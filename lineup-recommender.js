/* Batting-order recommendation driven by LineupModel (timed-game simulation).
   Attendance, the PA >= MIN_ATTENDANCE_PA preference, the pitcher requirement and fielding assignment follow the original
   rules; only the order is optimised. The original heuristic stays available as a comparison baseline.
   Coaches can lock hitters to slots; the model then orders everyone else and reports the cost against the free optimum.
   This layer stores only its own preferences (settings, locks) and never writes game data or calls the network. */
(() => {
  'use strict';
  const M = window.LineupModel;
  if (!M || typeof window.calculateRecommendedLineup !== 'function') return;
  const legacyRecommend = window.calculateRecommendedLineup;
  const SETTINGS_KEY = 'rebas_lineup_sim_settings';
  const LOCKS_KEY = 'rebas_lineup_locks';
  const HISTORY_FORMAT = {timeLimit: 90, rule: 'noNewInning', maxInnings: 7}; // format the past games were played in
  const NEAR_TIE = 0.02; // runs per game
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const r3 = v => (Number.isFinite(v) ? v : 0).toFixed(3).replace(/^0\./, '.');

  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (error) { saved = {}; }
    const timeLimit = Math.min(240, Math.max(20, Number(saved.timeLimit) || HISTORY_FORMAT.timeLimit));
    const maxInnings = Math.min(9, Math.max(1, Math.round(Number(saved.maxInnings) || HISTORY_FORMAT.maxInnings)));
    return {timeLimit, maxInnings, rule: saved.rule === 'hardStop' ? 'hardStop' : 'noNewInning'};
  }
  function saveSettings(settings) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (error) { /* preference only */ }
  }
  // Locks: {player name: 1-based slot}. At most one player per slot.
  function loadLocks() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCKS_KEY));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved).filter(([, slot]) => Number.isInteger(slot) && slot >= 1));
    } catch (error) { return {}; }
  }
  function saveLocks(locks) {
    try { localStorage.setItem(LOCKS_KEY, JSON.stringify(locks)); } catch (error) { /* preference only */ }
  }
  window.setLineupLock = function (name, slot) {
    const locks = loadLocks();
    const target = Number(slot) || 0;
    for (const other of Object.keys(locks)) if (locks[other] === target) delete locks[other];
    if (target) locks[name] = target; else delete locks[name];
    saveLocks(locks);
    renderLineupAnalysis(getFullAgg());
  };
  window.clearLineupLocks = function () {
    saveLocks({});
    renderLineupAnalysis(getFullAgg());
  };

  // Our offensive half-innings in finished games, used to calibrate minutes per plate appearance.
  function historicalInnings() {
    const counts = (allGames || [])
      .filter(g => g && g.status === 'finished' && Array.isArray(g.innings))
      .map(g => g.innings.filter(i => isInningOurBat(g.ourRole, i.topBottom) && (i.plateAppearances || []).length).length)
      .filter(n => n >= 1);
    return {games: counts.length, average: counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : null};
  }

  const cache = new Map();
  let lastResult = null;

  function modelFor(name, byName, team) {
    return M.batterModel(byName.get(name) || {name, pa: 0}, team);
  }

  function selectPlayers(players, models, targetSize, locks) {
    const historicalPaMap = {};
    allLogs.forEach(l => { historicalPaMap[l.name] = (historicalPaMap[l.name] || 0) + (Number(l.pa) || 0); });
    initAttendance(Object.values(JERSEY_TO_NAME), historicalPaMap);
    const hist = p => historicalPaMap[p.name] ?? p.pa;
    const present = players.filter(p => presentPlayersSet.has(p.name));
    const woba = p => models.get(p.name).woba;
    // Same preference as before: hitters with MIN_ATTENDANCE_PA+ career PA first (best projected bats), then the most experienced.
    const minPa = typeof MIN_ATTENDANCE_PA === 'number' ? MIN_ATTENDANCE_PA : 14;
    const primary = present.filter(p => hist(p) >= minPa).sort((a, b) => woba(b) - woba(a));
    const secondary = present.filter(p => hist(p) < minPa).sort((a, b) => hist(b) - hist(a));
    const chosen = [...primary, ...secondary].slice(0, targetSize);
    // A present hitter locked to a valid slot starts, replacing the weakest unlocked bat.
    const lockedNames = Object.keys(locks).filter(n => locks[n] <= targetSize);
    for (const name of lockedNames) {
      const player = present.find(p => p.name === name);
      if (!player || chosen.includes(player)) continue;
      if (chosen.length >= targetSize) {
        const replaceable = chosen.filter(p => !lockedNames.includes(p.name)).sort((a, b) => woba(a) - woba(b));
        if (!replaceable.length) continue;
        chosen.splice(chosen.indexOf(replaceable[0]), 1);
      }
      chosen.push(player);
    }
    // A slowpitch pitcher must bat, and the player the fielding match puts at P must be a ranked pitcher
    // (a ranked pitcher can be taken by a higher-priority position). Bring in ranked pitchers until that holds,
    // replacing the weakest bat that is not itself on the pitcher ranking.
    const pitcherRanks = defenseRankings.P || DEFAULT_DEFENSE_RANKINGS.P || [];
    const pitcherAssigned = list => {
      if (!list.length) return true;
      const assigned = matchPositionsForLineup(list, isDhEnabled);
      return pitcherRanks.includes(Object.keys(assigned).find(n => assigned[n].posKey === 'P'));
    };
    while (!pitcherAssigned(chosen)) {
      const pitcherName = pitcherRanks.find(n => present.some(p => p.name === n) && !chosen.some(p => p.name === n));
      if (!pitcherName) break;
      if (chosen.length >= targetSize) {
        const replaceable = chosen.filter(p => !pitcherRanks.includes(p.name) && !lockedNames.includes(p.name)).sort((a, b) => woba(a) - woba(b));
        if (!replaceable.length) break;
        chosen.splice(chosen.indexOf(replaceable[0]), 1);
      }
      chosen.push(present.find(p => p.name === pitcherName));
    }
    return {chosen, historicalPaMap, present};
  }

  // Valid locks as Map(0-based slot -> index in `chosen`), plus the reasons any lock could not apply.
  function resolveLocks(locks, chosen, present, targetSize) {
    const map = new Map(), ignored = [];
    for (const [name, slot] of Object.entries(locks)) {
      const index = chosen.findIndex(p => p.name === name);
      if (slot > targetSize) ignored.push(`${name}：本賽制只有 ${targetSize} 棒，未套用第 ${slot} 棒`);
      else if (!present.some(p => p.name === name)) ignored.push(`${name}：今日未出席，未套用`);
      else if (index < 0) ignored.push(`${name}：未能列入先發（投手規則優先），未套用`);
      else if (map.has(slot - 1)) ignored.push(`${name}：第 ${slot} 棒已有人鎖定，未套用`);
      else map.set(slot - 1, index);
    }
    return {map, ignored};
  }

  function optimise(players) {
    const targetSize = isDhEnabled ? 11 : 10;
    const team = M.teamRates(players);
    const byName = new Map(players.map(p => [p.name, p]));
    const models = new Map(players.map(p => [p.name, M.batterModel(p, team)]));
    const locks = loadLocks();
    const {chosen, historicalPaMap, present} = selectPlayers(players, models, targetSize, locks);
    const settings = loadSettings();
    const history = historicalInnings();
    const lockInfo = resolveLocks(locks, chosen, present, targetSize);
    const key = JSON.stringify([targetSize, settings, history, chosen.map(p => p.name), [...lockInfo.map], lockInfo.ignored,
      players.map(p => [p.name, p.pa, p.bb, p.k, p.h1, p.h2, p.h3, p.hr, p.gb, p.fb, p.ld, p.pu])]);
    let sim = cache.get(key);
    if (!sim) {
      const lineupModels = chosen.map(p => models.get(p.name));
      const minutesPerPa = history.games >= 2
        ? M.calibrateMinutesPerPa(team, HISTORY_FORMAT, targetSize, history.average)
        : M.DEFAULTS.minutesPerPa;
      const cfg = M.makeConfig({...settings, minutesPerPa}, team, targetSize);
      const nameIndex = new Map(chosen.map((p, i) => [p.name, i]));
      // The original heuristic ordering the same hitters: a start for the search and a like-for-like baseline.
      let legacy = null;
      try { legacy = legacyRecommend(chosen); } catch (error) { legacy = null; }
      const legacyNames = legacy && legacy.items ? legacy.items.map(i => i.player.name) : [];
      const legacyStart = legacyNames.length === chosen.length && legacyNames.every(n => nameIndex.has(n)) ? [legacyNames.map(n => nameIndex.get(n))] : [];
      const free = chosen.length ? M.optimizeOrder(lineupModels, cfg, legacyStart) : {order: [], runs: 0, evaluations: 0};
      const locked = lockInfo.map.size;
      const best = locked ? M.optimizeOrder(lineupModels, cfg, [...legacyStart, free.order], lockInfo.map) : free;
      const detail = chosen.length ? M.evaluateOrder(lineupModels, best.order, cfg) : null;
      const legacyRuns = legacyNames.length === targetSize
        ? M.evaluateOrder(legacyNames.map(n => modelFor(n, byName, team)), legacyNames.map((n, i) => i), cfg).runs : null;
      sim = {
        names: best.order.map(i => chosen[i].name), runs: best.runs, detail,
        freeRuns: free.runs, freeNames: free.order.map(i => chosen[i].name), lockedSlots: [...lockInfo.map.keys()],
        ignoredLocks: lockInfo.ignored, present: present.map(p => p.name),
        sensitivity: chosen.length ? M.slotSensitivity(lineupModels, best.order, cfg, lockInfo.map) : [],
        bookRuns: chosen.length >= 5 ? M.evaluateOrder(lineupModels, M.bookOrder(lineupModels), cfg).runs : null,
        randomRuns: chosen.length ? M.randomOrderMean(lineupModels, cfg) : null,
        legacyRuns, minutesPerPa, cfg, history, settings, prior: team.prior, team,
        evaluations: free.evaluations + (locked ? best.evaluations : 0)
      };
      cache.set(key, sim);
      if (cache.size > 30) cache.delete(cache.keys().next().value);
    }
    return {sim, chosenByName: byName, models, team, historicalPaMap, targetSize};
  }

  function recommend(players) {
    const targetSize = isDhEnabled ? 11 : 10;
    if (!players || !players.length) return {items: [], hasDh: isDhEnabled, targetSize};
    const {sim, chosenByName, models, historicalPaMap} = optimise(players);
    const rawBatters = sim.names.map(n => chosenByName.get(n));
    const assigned = rawBatters.length ? matchPositionsForLineup(rawBatters, isDhEnabled) : {};
    const items = rawBatters.map((p, idx) => {
      const m = models.get(p.name);
      const pa = sim.detail.paBySlot[idx];
      const onBase = sim.detail.onBaseShare[idx];
      const sens = sim.sensitivity[idx];
      const third = sim.detail.paAtLeast[idx][2];
      const posInfo = assigned[p.name] || {posKey: 'DH', label: 'DH/指定打擊', rankText: '純打擊', isDh: false};
      const own = Math.round((1 - m.shrink) * 100);
      let reason = sens.locked ? `教練鎖定第 ${idx + 1} 棒。` : '';
      reason += `校正後上壘率 ${r3(m.obp)}、長打率 ${r3(m.slg)}（${m.pa} 打席，${own}% 依本人數據）。`;
      if (sens.locked) { /* the coach's choice: no swap advice */ }
      else if (!Number.isFinite(sens.loss)) reason += '其他棒次皆已鎖定。';
      else reason += sens.loss < NEAR_TIE
        ? `與第 ${sens.partnerSlot} 棒互換幾乎無差（每場${sens.loss < 0.005 ? '不到 0.01' : ` ${sens.loss.toFixed(2)}`} 分）。`
        : `移到其他棒次每場至少少 ${sens.loss.toFixed(2)} 分。`;
      if (posInfo.isDh) reason += '專職 DH，純打擊不守備。';
      else if (posInfo.posKey === 'P') reason += '投手兼任打擊。';
      return {
        slot: idx + 1, player: p, posInfo,
        role: `${sens.locked ? '🔒 鎖定・' : ''}每場 ${pa.toFixed(1)} 打席・打到第 3 次 ${Math.round(third * 100)}%・壘上有人 ${Math.round(onBase * 100)}%`,
        reason, histPa: historicalPaMap[p.name] || p.pa,
        model: {pa, third, onBase, loss: sens.loss, partnerSlot: sens.partnerSlot, locked: !!sens.locked, obp: m.obp, slg: m.slg, own}
      };
    });
    lastResult = {items, sim, targetSize};
    return {items, hasDh: isDhEnabled, targetSize, model: sim};
  }
  window.calculateRecommendedLineup = recommend;
  window.calculateLegacyRecommendedLineup = legacyRecommend;

  // ---------- Summary under the recommended table ----------
  function slotBars(detail) {
    const max = Math.max(...detail.paBySlot, 1);
    return `<div class="flex items-end gap-1" role="img" aria-label="每棒每場預期打席與打到第 3 次的機率">${detail.paBySlot.map((pa, i) => `
      <div class="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
        <span class="text-[10px] font-mono text-slate-300">${pa.toFixed(1)}</span>
        <div class="w-full rounded-t bg-sky-500/70" style="height:${Math.max(4, (pa / max) * 48)}px"></div>
        <span class="text-[10px] font-mono text-slate-500">${i + 1}</span>
        <span class="text-[10px] font-mono text-amber-300">${Math.round(detail.paAtLeast[i][2] * 100)}%</span>
      </div>`).join('')}</div>`;
  }

  function renderSummary() {
    const anchor = document.getElementById('recDedicatedFielderInfo');
    if (!anchor) return;
    let box = document.getElementById('lineupModelSummary');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lineupModelSummary';
      box.className = 'mt-4 space-y-3';
      anchor.after(box);
    }
    const subtitle = document.getElementById('recLineupSubtitle');
    const settings = loadSettings();
    if (subtitle) subtitle.textContent = `依 ${settings.timeLimit} 分鐘計時賽逐打席模擬，推算每場預期得分最高的棒次；出席、投手與守位仍依教練團設定`;
    if (!lastResult || lastResult.items.length < lastResult.targetSize) { box.innerHTML = ''; return; }
    const {sim} = lastResult;
    const locked = sim.lockedSlots.length > 0;
    const signed = d => (d >= 0.005 ? `<span class="text-emerald-400">+${d.toFixed(2)}</span>` : d <= -0.005 ? `<span class="text-amber-300">−${(-d).toFixed(2)}</span>` : '<span class="text-slate-500">±0.00</span>');
    const compare = [
      ['舊版規則排法（同一批球員）', sim.legacyRuns], ['The Book 排法（最強打者放 1、2、4 棒）', sim.bookRuns], ['隨機排列平均', sim.randomRuns]
    ].filter(([, v]) => v != null).map(([label, v]) => `<li class="flex justify-between gap-3"><span class="text-slate-400">${label}</span><span class="font-mono text-slate-200">${v.toFixed(2)} 分（${locked ? '鎖定後' : '推薦'} ${signed(sim.runs - v)}）</span></li>`).join('');
    const lockCost = sim.freeRuns - sim.runs;
    const prior = sim.prior || {};
    box.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
        <div class="bg-slate-950/80 border ${locked ? 'border-amber-700/60' : 'border-sky-800/60'} rounded-xl p-3 space-y-2">
          <div class="text-slate-400">${locked ? '鎖定後打線預期' : '推薦打線預期'}</div>
          <div class="text-2xl font-black ${locked ? 'text-amber-300' : 'text-sky-300'} font-mono">${sim.runs.toFixed(2)} <span class="text-sm text-slate-400 font-normal">分／場</span></div>
          <div class="text-slate-400">約 ${sim.detail.innings.toFixed(1)} 個進攻局；全隊每場約 ${sim.detail.teamPa.mean.toFixed(0)} 打席（八成落在 ${sim.detail.teamPa.p10}–${sim.detail.teamPa.p90}）</div>
          ${locked ? `<div id="lineupLockCost" class="text-amber-200">完全最佳化（不鎖定）${sim.freeRuns.toFixed(2)} 分；${lockCost < 0.005 ? '鎖定後幾乎沒有損失' : `鎖定後每場少 ${lockCost.toFixed(2)} 分`}</div>` : ''}
          <ul class="space-y-1 pt-1 border-t border-slate-800">${compare}</ul>
        </div>
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
          <div class="text-slate-400">每棒每場預期打席（藍）與<span class="text-amber-300">打到第 3 次的機率</span>（計時賽越後段越少）</div>
          ${slotBars(sim.detail)}
        </div>
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
          <div class="text-slate-400">比賽設定</div>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1"><span class="text-slate-500">比賽時間（分鐘）</span>
              <input id="lineupSimTime" type="number" min="20" max="240" step="5" value="${settings.timeLimit}" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 font-mono"></label>
            <label class="flex flex-col gap-1"><span class="text-slate-500">局數上限</span>
              <input id="lineupSimInnings" type="number" min="1" max="9" step="1" value="${settings.maxInnings}" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 font-mono"></label>
            <label class="flex flex-col gap-1 col-span-2"><span class="text-slate-500">時間到時</span>
              <select id="lineupSimRule" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100">
                <option value="noNewInning" ${settings.rule === 'noNewInning' ? 'selected' : ''}>不開新局（進行中的一局打完）</option>
                <option value="hardStop" ${settings.rule === 'hardStop' ? 'selected' : ''}>立即結束</option>
              </select></label>
          </div>
        </div>
      </div>
      ${lockCard(sim, lastResult.targetSize)}
      <details class="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 leading-relaxed">
        <summary class="cursor-pointer text-slate-300 font-bold">模型如何計算？</summary>
        <ul class="list-disc pl-5 mt-2 space-y-1">
          <li>逐打席精確計算每個半局（出局數 × 壘上狀態的馬可夫鏈），包含保送推進、安打帶跑、雙殺、高飛犧牲打；再依比賽時鐘串起整場：時間到 ${settings.rule === 'hardStop' ? '立即結束' : '後不開新局'}，最多 ${settings.maxInnings} 局。</li>
          <li>比賽節奏：${sim.history.games >= 2 ? `依過去 ${sim.history.games} 場平均我方 ${sim.history.average.toFixed(1)} 個進攻局（90 分鐘賽制）校準，` : '歷史場次不足，採預設值，'}每打席平均約 ${sim.minutesPerPa.toFixed(1)} 分鐘，每半局換場 1 分鐘；對手半局假設與全隊平均打線同節奏。</li>
          <li>時間的隨機性：每個打席耗時上下約 ${Math.round(sim.cfg.paTimeCv * 100)}%，對手每半局的打席數也有長有短，所以「還能不能開新局」是機率而非一刀切，避免模型為了剛好擠進一局而排出不合理的棒次。「打到第 3 次」由全隊總打席的分布直接算出。</li>
          <li>樣本校正（經驗貝氏）：每位打者的保送、三振、各類安打率依打席數向全隊平均回歸；權重由全隊實際天分分布估計${prior.estimated ? `（安打 ${Math.round(prior.s1)}、保送 ${Math.round(prior.bb)}、三振 ${Math.round(prior.k)} 打席）` : '（人數不足，採保守預設）'}，打席越多越依本人數據。</li>
          <li>搜尋：從 The Book 排法、能力排序與舊版規則出發，反覆嘗試任兩棒互換直到無法再提高預期得分（本次比較 ${sim.evaluations} 種排列）。有鎖定時，鎖定的棒次固定不動，只在其餘棒次間搜尋，並與完全最佳化比較。</li>
          <li>限制：棒次對得分的影響通常只有幾個百分點；「幾乎無差」的棒次可依教練判斷互換。跑壘推進率為慢壘一般假設，未計盜壘與提前結束規則。</li>
        </ul>
      </details>`;
    const rerender = () => {
      saveSettings({
        timeLimit: Number(document.getElementById('lineupSimTime').value),
        maxInnings: Number(document.getElementById('lineupSimInnings').value),
        rule: document.getElementById('lineupSimRule').value
      });
      renderLineupAnalysis(getFullAgg());
    };
    for (const id of ['lineupSimTime', 'lineupSimInnings', 'lineupSimRule']) document.getElementById(id).addEventListener('change', rerender);
    for (const select of box.querySelectorAll('[data-lock-name]')) {
      select.addEventListener('change', () => window.setLineupLock(select.dataset.lockName, select.value));
    }
    box.querySelector('#lineupLockClear')?.addEventListener('click', () => window.clearLineupLocks());
  }

  // Lock controls: starters in batting order first, then present bench players (locking one makes them start).
  function lockCard(sim, targetSize) {
    const locks = loadLocks();
    const names = [...sim.names, ...sim.present.filter(n => !sim.names.includes(n))];
    const options = name => [`<option value="0">不鎖定</option>`,
      ...Array.from({length: targetSize}, (_, i) => `<option value="${i + 1}" ${locks[name] === i + 1 ? 'selected' : ''}>第 ${i + 1} 棒</option>`)].join('');
    const rows = names.map(name => {
      const starter = sim.names.includes(name);
      const isLocked = Boolean(locks[name]);
      return `<label class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 rounded-lg border px-2 py-1.5 ${isLocked ? 'border-amber-600/70 bg-amber-950/30' : 'border-slate-800 bg-slate-900/60'}">
        <span class="${starter ? 'text-slate-200' : 'text-slate-500'}">${isLocked ? '🔒 ' : ''}${esc(name)}${starter ? '' : ' <span class="text-[10px]">板凳</span>'}</span>
        <select data-lock-name="${esc(name)}" aria-label="${esc(name)} 鎖定棒次" class="w-full sm:w-auto bg-slate-950 border border-slate-700 rounded px-1 py-1 text-slate-100 text-[11px]">${options(name)}</select>
      </label>`;
    }).join('');
    const ignored = sim.ignoredLocks.length
      ? `<ul class="text-amber-300 space-y-0.5">${sim.ignoredLocks.map(t => `<li>⚠️ ${esc(t)}</li>`).join('')}</ul>` : '';
    return `<div id="lineupLockCard" class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-slate-300 font-bold">🔒 鎖定棒次</span>
        ${Object.keys(locks).length ? '<button type="button" id="lineupLockClear" class="text-[11px] text-rose-300 border border-rose-800/60 rounded-lg px-2 py-1 hover:bg-rose-950/60">清除全部鎖定</button>' : ''}
      </div>
      <p class="text-[11px] text-slate-500">先固定某些球員的棒次，模型再幫其他人排出最佳順序，並顯示與完全最佳化的差距。鎖定的板凳球員會列入先發；同一棒只能鎖定一人。設定只存在這台裝置。</p>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">${rows}</div>
      ${ignored}
    </div>`;
  }

  // ---------- Expected runs for the custom lineup ----------
  function renderCustomCard(agg) {
    const anchor = document.getElementById('lineupEvalMetrics');
    if (!anchor || !lastResult || lastResult.items.length < lastResult.targetSize) {
      document.getElementById('customLineupModelCard')?.remove();
      return;
    }
    let card = document.getElementById('customLineupModelCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'customLineupModelCard';
      card.className = 'mt-3';
      anchor.after(card);
    }
    const {sim} = lastResult;
    const players = agg.players;
    const team = M.teamRates(players);
    const byName = new Map(players.map(p => [p.name, p]));
    const names = (customLineup || []).slice(0, lastResult.targetSize);
    const result = M.evaluateOrder(names.map(n => modelFor(n, byName, team)), names.map((n, i) => i), sim.cfg);
    const diff = result.runs - sim.runs;
    const duplicate = new Set(names).size !== names.length;
    card.innerHTML = `
      <div class="bg-slate-950/80 border ${diff < -NEAR_TIE ? 'border-amber-600/60' : 'border-emerald-700/60'} rounded-xl p-3 text-xs flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
        <span class="text-slate-300">自訂打線模擬：每場預期 <b class="font-mono text-white text-sm">${result.runs.toFixed(2)}</b> 分（約 ${result.innings.toFixed(1)} 局）</span>
        <span class="${diff < -NEAR_TIE ? 'text-amber-300' : 'text-emerald-300'}">${Math.abs(diff) < NEAR_TIE ? '與推薦打線幾乎相同' : diff < 0 ? `比推薦打線少 ${(-diff).toFixed(2)} 分／場` : `比推薦打線多 ${diff.toFixed(2)} 分／場`}${duplicate ? '・有重複選手' : ''}</span>
      </div>`;
  }

  const after = (name, hook) => {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (...args) {
      const result = original.apply(this, args);
      try { hook(...args); } catch (error) { console.error(`[lineup-recommender] ${name}`, error); }
      return result;
    };
  };
  after('renderLineupAnalysis', () => renderSummary());
  after('evaluateCustomLineup', renderCustomCard);

  // The first render ran with the original algorithm before this file loaded.
  try { renderLineupAnalysis(getFullAgg()); } catch (error) { console.error('[lineup-recommender] init', error); }
})();
