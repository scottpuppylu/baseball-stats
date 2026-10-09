/* Batting-order recommendation driven by LineupModel (timed-game simulation).
   Attendance, the PA >= MIN_ATTENDANCE_PA preference, the pitcher requirement and fielding assignment follow the original
   rules; only the order is optimised. The original heuristic stays available as a comparison baseline.
   This layer stores only its own simulation settings and never writes game data or calls the network. */
(() => {
  'use strict';
  const M = window.LineupModel;
  if (!M || typeof window.calculateRecommendedLineup !== 'function') return;
  const legacyRecommend = window.calculateRecommendedLineup;
  const SETTINGS_KEY = 'rebas_lineup_sim_settings';
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

  function selectPlayers(players, models, targetSize) {
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
        const replaceable = chosen.filter(p => !pitcherRanks.includes(p.name)).sort((a, b) => woba(a) - woba(b));
        if (!replaceable.length) break;
        chosen.splice(chosen.indexOf(replaceable[0]), 1);
      }
      chosen.push(present.find(p => p.name === pitcherName));
    }
    return {chosen, historicalPaMap};
  }

  function optimise(players) {
    const targetSize = isDhEnabled ? 11 : 10;
    const team = M.teamRates(players);
    const byName = new Map(players.map(p => [p.name, p]));
    const models = new Map(players.map(p => [p.name, M.batterModel(p, team)]));
    const {chosen, historicalPaMap} = selectPlayers(players, models, targetSize);
    const settings = loadSettings();
    const history = historicalInnings();
    const key = JSON.stringify([targetSize, settings, history, chosen.map(p => p.name),
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
      const best = chosen.length ? M.optimizeOrder(lineupModels, cfg, legacyStart) : {order: [], runs: 0};
      const detail = chosen.length ? M.evaluateOrder(lineupModels, best.order, cfg) : null;
      const legacyRuns = legacyNames.length === targetSize
        ? M.evaluateOrder(legacyNames.map(n => modelFor(n, byName, team)), legacyNames.map((n, i) => i), cfg).runs : null;
      sim = {
        names: best.order.map(i => chosen[i].name), runs: best.runs, detail,
        sensitivity: chosen.length ? M.slotSensitivity(lineupModels, best.order, cfg) : [],
        bookRuns: chosen.length >= 5 ? M.evaluateOrder(lineupModels, M.bookOrder(lineupModels), cfg).runs : null,
        randomRuns: chosen.length ? M.randomOrderMean(lineupModels, cfg) : null,
        legacyRuns, minutesPerPa, cfg, history, settings, prior: team.prior, team, evaluations: best.evaluations
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
      const posInfo = assigned[p.name] || {posKey: 'DH', label: 'DH/指定打擊', rankText: '純打擊', isDh: false};
      const own = Math.round((1 - m.shrink) * 100);
      let reason = `校正後上壘率 ${r3(m.obp)}、長打率 ${r3(m.slg)}（${m.pa} 打席，${own}% 依本人數據）。`;
      reason += sens.loss < NEAR_TIE
        ? `與第 ${sens.partnerSlot} 棒互換幾乎無差（每場${sens.loss < 0.005 ? '不到 0.01' : ` ${sens.loss.toFixed(2)}`} 分）。`
        : `移到其他棒次每場至少少 ${sens.loss.toFixed(2)} 分。`;
      if (posInfo.isDh) reason += '專職 DH，純打擊不守備。';
      else if (posInfo.posKey === 'P') reason += '投手兼任打擊。';
      return {
        slot: idx + 1, player: p, posInfo,
        role: `每場 ${pa.toFixed(1)} 打席・壘上有人 ${Math.round(onBase * 100)}%`,
        reason, histPa: historicalPaMap[p.name] || p.pa,
        model: {pa, onBase, loss: sens.loss, partnerSlot: sens.partnerSlot, obp: m.obp, slg: m.slg, own}
      };
    });
    lastResult = {items, sim, targetSize};
    return {items, hasDh: isDhEnabled, targetSize, model: sim};
  }
  window.calculateRecommendedLineup = recommend;
  window.calculateLegacyRecommendedLineup = legacyRecommend;

  // ---------- Summary under the recommended table ----------
  function slotBars(paBySlot) {
    const max = Math.max(...paBySlot, 1);
    return `<div class="flex items-end gap-1 h-20" role="img" aria-label="每棒每場預期打席">${paBySlot.map((pa, i) => `
      <div class="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
        <span class="text-[10px] font-mono text-slate-300">${pa.toFixed(1)}</span>
        <div class="w-full rounded-t bg-sky-500/70" style="height:${Math.max(4, (pa / max) * 48)}px"></div>
        <span class="text-[10px] font-mono text-slate-500">${i + 1}</span>
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
    const compare = [
      ['舊版規則排法（同一批球員）', sim.legacyRuns], ['The Book 排法（最強打者放 1、2、4 棒）', sim.bookRuns], ['隨機排列平均', sim.randomRuns]
    ].filter(([, v]) => v != null).map(([label, v]) => `<li class="flex justify-between gap-3"><span class="text-slate-400">${label}</span><span class="font-mono text-slate-200">${v.toFixed(2)} 分 <span class="${sim.runs - v > 0.005 ? 'text-emerald-400' : 'text-slate-500'}">（推薦 +${Math.max(0, sim.runs - v).toFixed(2)}）</span></span></li>`).join('');
    const prior = sim.prior || {};
    box.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
        <div class="bg-slate-950/80 border border-sky-800/60 rounded-xl p-3 space-y-2">
          <div class="text-slate-400">推薦打線預期</div>
          <div class="text-2xl font-black text-sky-300 font-mono">${sim.runs.toFixed(2)} <span class="text-sm text-slate-400 font-normal">分／場</span></div>
          <div class="text-slate-400">約 ${sim.detail.innings.toFixed(1)} 個進攻局</div>
          <ul class="space-y-1 pt-1 border-t border-slate-800">${compare}</ul>
        </div>
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
          <div class="text-slate-400">每棒每場預期打席（計時賽越後段越少）</div>
          ${slotBars(sim.detail.paBySlot)}
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
      <details class="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 leading-relaxed">
        <summary class="cursor-pointer text-slate-300 font-bold">模型如何計算？</summary>
        <ul class="list-disc pl-5 mt-2 space-y-1">
          <li>逐打席精確計算每個半局（出局數 × 壘上狀態的馬可夫鏈），包含保送推進、安打帶跑、雙殺、高飛犧牲打；再依比賽時鐘串起整場：時間到 ${settings.rule === 'hardStop' ? '立即結束' : '後不開新局'}，最多 ${settings.maxInnings} 局。</li>
          <li>比賽節奏：${sim.history.games >= 2 ? `依過去 ${sim.history.games} 場平均我方 ${sim.history.average.toFixed(1)} 個進攻局（90 分鐘賽制）校準，` : '歷史場次不足，採預設值，'}每打席約 ${sim.minutesPerPa.toFixed(1)} 分鐘，每半局換場 1 分鐘；對手半局假設與全隊平均打線同節奏。</li>
          <li>樣本校正（經驗貝氏）：每位打者的保送、三振、各類安打率依打席數向全隊平均回歸；權重由全隊實際天分分布估計${prior.estimated ? `（安打 ${Math.round(prior.s1)}、保送 ${Math.round(prior.bb)}、三振 ${Math.round(prior.k)} 打席）` : '（人數不足，採保守預設）'}，打席越多越依本人數據。</li>
          <li>搜尋：從 The Book 排法、能力排序與舊版規則出發，反覆嘗試任兩棒互換直到無法再提高預期得分（本次比較 ${sim.evaluations} 種排列）。</li>
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
