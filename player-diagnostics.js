/* Player batting diagnostics 3.0: read-only, replaces the original renderDiagnostics.
   Every judgement is relative to this team (slowpitch norms are far from MLB), shrunk toward the team
   average by sample size, and cross-checks two or more stats before naming a cause. It never claims
   things the scorebook does not record (pitch locations, counts, swing mechanics measured by sensors). */
(() => {
  'use strict';

  // ---------- Pure analysis (no DOM) ----------
  // Prior weights: how many PA / AB / balls in play of "team average" each rate is blended with.
  // Strikeouts and walks settle fastest, power slower, batted-ball mix in between (cf. MLB stabilisation
  // research, scaled down for a team that plays a few dozen PA per player a season).
  const PRIOR = {k: 20, bb: 30, iso: 40, bip: 6};
  const MIN_PA = 10;          // players below this are shown, but not used for team percentiles
  const sum = (list, key) => list.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  const shrink = (count, n, prior, weight) => (count + prior * weight) / (n + weight);

  // Team totals (not averages of averages) over everyone in the current view.
  function teamContext(players, rates) {
    const pa = sum(players, 'pa') || 1, ab = sum(players, 'ab') || 1, bip = sum(players, 'bip');
    const h = sum(players, 'h'), tb = sum(players, 'h') + sum(players, 'h2') + 2 * sum(players, 'h3') + 3 * sum(players, 'hr');
    const qualified = players.filter(p => p.pa >= MIN_PA);
    return {
      k: sum(players, 'k') / pa, bb: sum(players, 'bb') / pa, iso: (tb - h) / ab, avg: h / ab,
      ld: bip ? sum(players, 'ld') / bip : 0, gb: bip ? sum(players, 'gb') / bip : 0,
      air: bip ? (sum(players, 'fb') + sum(players, 'pu')) / bip : 0,
      bip, rates: rates || null, qualified: qualified.length ? qualified : players
    };
  }

  // Share of qualified teammates this value beats (0–1); `lowerIsBetter` flips it.
  function percentile(value, list, key, lowerIsBetter = false) {
    const values = list.map(p => (typeof key === 'function' ? key(p) : p[key])).filter(Number.isFinite);
    if (!values.length || !Number.isFinite(value)) return null;
    const below = values.filter(v => (lowerIsBetter ? v > value : v < value)).length;
    const equal = values.filter(v => v === value).length;
    return Math.min(1, (below + Math.max(0, equal - 1) / 2) / Math.max(1, values.length - 1));
  }

  const pct = x => `${(x * 100).toFixed(0)}%`;
  const r3 = x => (Number.isFinite(x) ? x : 0).toFixed(3).replace(/^0\./, '.').replace(/^-0\./, '-.');

  function reliability(p) {
    const bip = p.bip || 0;
    if (p.pa >= 40 && bip >= 15) return {level: 'high', label: '樣本充足', note: '打席與擊球樣本都夠，判讀可作為訓練依據。'};
    if (p.pa >= 20) return {level: 'mid', label: '樣本中等', note: `打擊結果可參考；擊球型態只有 ${bip} 球，型態判讀先當方向。`};
    return {level: 'low', label: '樣本不足', note: `只有 ${p.pa} 打席、${bip} 球有型態紀錄，數字容易被一兩個打席左右，以下多半先列為觀察。`};
  }

  // The core: returns archetype, strengths, issues (with the evidence behind them), cross-checked
  // insights and a prioritised plan with measurable targets.
  function diagnose(p, team) {
    const rel = reliability(p);
    const bip = p.bip || 0;
    const air = (p.fb || 0) + (p.pu || 0);
    const kRate = shrink(p.k || 0, p.pa || 0, team.k, PRIOR.k);
    const bbRate = shrink(p.bb || 0, p.pa || 0, team.bb, PRIOR.bb);
    const isoRate = ((p.iso || 0) * (p.ab || 0) + team.iso * PRIOR.iso) / ((p.ab || 0) + PRIOR.iso);
    const ldRate = bip ? shrink(p.ld || 0, bip, team.ld, PRIOR.bip) : null;
    const airRate = bip ? shrink(air, bip, team.air, PRIOR.bip) : null;
    const gbRate = bip ? shrink(p.gb || 0, bip, team.gb, PRIOR.bip) : null;
    const q = team.qualified;
    const scores = {
      contact: percentile(p.k_pct, q, 'k_pct', true),
      discipline: percentile(p.bb_pct, q, 'bb_pct'),
      power: percentile(p.iso, q, 'iso'),
      quality: p.tracked && bip ? percentile(p.ld_pct, q.filter(x => x.bip > 0), 'ld_pct') : null,
      value: percentile(p.wrc_plus, q, 'wrc_plus')
    };
    const issues = [], strengths = [], insights = [], plan = [];
    const rates = team.rates;
    const lineHit = rates && rates.line ? rates.line.hit : null;
    const flyHit = rates && rates.fly ? rates.fly.hit : null;
    const groundHit = rates && rates.grounder ? rates.grounder.hit : null;

    // 1. Strikeouts. In slowpitch almost every K is avoidable; a foul third strike (界外K) is a separate cause.
    const kHigh = (p.k || 0) >= 2 && kRate >= team.k * 1.4 && kRate - team.k >= 0.03;
    if (kHigh) {
      const foulShare = p.k ? (p.k_foul || 0) / p.k : 0;
      issues.push({key: 'k', group: 'contact', severity: kRate >= team.k * 2 ? 3 : 2,
        title: `三振偏多（K% ${pct(p.k_pct)}，全隊 ${pct(team.k)}）`,
        evidence: `${p.k} 次三振／${p.pa} 打席${p.k_foul ? `，其中界外K ${p.k_foul} 次` : ''}。慢壘幾乎每球都能擊進場內，三振等於直接送出一個出局且跑者無法推進。`});
      if (foulShare >= 0.5) {
        insights.push({title: '三振主要來自兩好球後的界外', text: `界外K 占三振 ${pct(foulShare)}：不是揮空，而是兩好球後打成界外。問題在擊球時機與擊球點，而非選球。`});
        plan.push({key: 'k', focus: '兩好球後把球打進界內', drill: '兩好球後握短棒、站位略靠近本壘板，以「打向中外野」為目標；打擊練習用兩好球情境，每輪只計界內球。', target: `界外K 降為 0、K% 降到 ${pct(team.k)} 以下`});
      } else {
        plan.push({key: 'k', focus: '減少揮空', drill: '兩好球後縮短揮棒、以接觸為先；T座與拋打練習把目標放在「每球都碰到球心」，再逐步加速。', target: `K% 降到 ${pct(team.k)} 以下（全隊平均）`});
      }
    } else if ((p.k || 0) === 0 && p.pa >= 15) {
      strengths.push({title: '零三振', evidence: `${p.pa} 打席沒有三振：每個打席都讓守備必須處理球。`});
    }

    // 2. Walks: in slowpitch walks are rare and not a goal in themselves; only flag when combined with outs on early contact.
    const bbHigh = bbRate >= team.bb * 1.5 && (p.bb || 0) >= 3;
    if (bbHigh) strengths.push({title: '選球上壘', evidence: `BB% ${pct(p.bb_pct)}（全隊 ${pct(team.bb)}）：上壘不只靠安打。`});

    // 3. Batted-ball mix cross-checked with the team's own hit rate per ball type.
    const airHeavy = bip >= 4 && air >= 2 && airRate >= team.air * 1.3 && airRate - team.air >= 0.08;
    const gbHeavy = bip >= 4 && (p.gb || 0) >= 2 && gbRate >= team.gb * 1.4 && gbRate - team.gb >= 0.08;
    const ldStrong = bip >= 4 && ldRate !== null && ldRate >= team.ld * 1.12 && (p.ld_pct || 0) >= team.ld;
    if (airHeavy) {
      // Hits these balls would have produced as line drives, at this team's own hit rate per ball type.
      const popHit = rates && rates.popup ? rates.popup.hit : flyHit;
      const lost = lineHit !== null && flyHit !== null ? (p.fb || 0) * (lineHit - flyHit) + (p.pu || 0) * (lineHit - popHit) : null;
      const power = isoRate >= team.iso * 1.15 && (p.hr || 0) >= 2;
      issues.push({key: 'air', group: 'trajectory', severity: power ? 1 : 2,
        title: `高飛球比例偏高（${pct(air / bip)}，全隊 ${pct(team.air)}）`,
        evidence: `${bip} 球中有 ${air} 球高飛${p.pu ? `（內野飛球 ${p.pu}）` : ''}。本隊高飛球只有 ${flyHit !== null ? pct(flyHit) : '少數'} 成為安打，平飛球 ${lineHit !== null ? pct(lineHit) : '高得多'}${lost !== null && lost >= 0.5 ? `；這些球若是平飛，依全隊比例約多 ${lost.toFixed(1)} 支安打` : ''}。`});
      insights.push(power
        ? {title: '高飛＋長打：力量型打者的取捨', text: `ISO ${r3(p.iso)}、全壘打 ${p.hr}：高飛帶來長打，但沒飛出去的多半被接殺。目標是把仰角壓低成強勁平飛，保留距離、減少被接殺。`}
        : {title: '高飛但沒有長打：擊球點偏下', text: `高飛多但 ISO ${r3(p.iso)} 不高，代表球打得高卻不遠——常見於擊球點在球的下半部或揮棒軌跡過度上撈。`});
      plan.push({key: 'air', focus: '把高飛壓成平飛', drill: '擊球點瞄準球的中線偏上、揮棒平面與來球軌跡貼合；T座把球放胸高，以打到正前方網子中段為目標，打到上方網子不算。', target: `高飛＋內飛比例降到 ${pct(team.air)} 以下`});
    }
    if (gbHeavy) {
      const power = isoRate <= team.iso * 0.8;
      issues.push({key: 'gb', group: 'trajectory', severity: 2,
        title: `滾地球比例偏高（${pct((p.gb || 0) / bip)}，全隊 ${pct(team.gb)}）`,
        evidence: `${bip} 球中有 ${p.gb} 球滾地。本隊滾地球安打率 ${groundHit !== null ? pct(groundHit) : '偏低'}，而且容易形成封殺或雙殺。`});
      insights.push({title: power ? '滾地＋缺乏長打：擊球點太前或砍得太下' : '滾地多但仍有長打：時機不穩', text: power
        ? '球多半被打進地面且沒有長打，通常是出棒太早（在身體前方就擊球）或刻意往下砍。'
        : '有長打能力，滾地球多半來自時機忽早忽晚，修正節奏就能把部分滾地變成平飛。'});
      plan.push({key: 'gb', focus: '把滾地抬成平飛', drill: '等球進到前腳附近再擊球、保持頭部穩定；拋打練習以「打過內野手頭頂」為目標。', target: `滾地比例降到 ${pct(team.gb)} 以下`});
    }
    if (ldStrong) strengths.push({title: '平飛球比例高', evidence: `平飛 ${pct(p.ld_pct)}（全隊 ${pct(team.ld)}）：本隊平飛球安打率 ${lineHit !== null ? pct(lineHit) : '最高'}，這是最穩定的安打來源。`});

    // 4. Power.
    const isoLow = (p.ab || 0) >= 8 && isoRate <= team.iso * 0.6;
    const isoHigh = (p.ab || 0) >= 8 && isoRate >= team.iso * 1.3 && (p.h2 + p.h3 + p.hr) >= 3;
    if (isoHigh) strengths.push({title: '長打火力', evidence: `ISO ${r3(p.iso)}（全隊 ${r3(team.iso)}）：二安 ${p.h2}、三安 ${p.h3}、全壘打 ${p.hr}，一棒就能把跑者送回。`});
    if (isoLow) {
      issues.push({key: 'iso', group: 'power', severity: (p.avg || 0) >= team.avg ? 1 : 2,
        title: `長打不足（ISO ${r3(p.iso)}，全隊 ${r3(team.iso)}）`,
        evidence: `${p.h} 支安打中長打 ${p.h2 + p.h3 + p.hr} 支。外野可以前移防守，安打很難把一壘跑者送回本壘。`});
      if ((p.avg || 0) >= team.avg) insights.push({title: '安打多但都是短打：能碰到球，缺的是擊球強度', text: `打擊率 ${r3(p.avg)} 不低於全隊，但 ISO 偏低，代表接觸沒問題，球打不遠。優先練下半身帶動，而不是改變擊球點。`});
      plan.push({key: 'iso', focus: '提升擊球強度', drill: '後腳蹬地帶動轉髖、完整送棒（follow-through）；以平飛打向外野手之間（左中、右中）為目標。', target: `ISO 提高到 ${r3(team.iso * 0.8)} 以上`});
    }

    // 5. Luck: same tracked sample, actual AVG vs what those ball types usually produce for this team.
    if (p.tracked && bip >= 5 && Number.isFinite(p.xba) && Number.isFinite(p.t_avg)) {
      const diff = p.t_avg - p.xba;
      if (Math.abs(diff) >= 0.12) insights.push(diff > 0
        ? {title: '結果好於擊球品質（運氣偏好）', text: `這 ${bip} 球的打擊率 ${r3(p.t_avg)}，依擊球型態預期 ${r3(p.xba)}。高出的部分多半會回落；別因目前數字放掉擊球型態的修正。`}
        : {title: '擊球品質好於結果（運氣偏差）', text: `這 ${bip} 球的打擊率 ${r3(p.t_avg)}，依擊球型態預期 ${r3(p.xba)}。打得比數字好，維持現在的擊球方式，結果通常會追上來。`});
    }

    // 6. Direction.
    if (bip >= 5) {
      if ((p.pull_pct || 0) >= 0.75) insights.push({title: `幾乎都往拉打方向（${pct(p.pull_pct)}）`, text: (p.gb || 0) / bip >= 0.4
        ? '拉打又多滾地，守備可以整體往拉打側站位。練習把外角球推向中間與反方向，讓守備不能偏站。'
        : '方向集中，對手容易針對站位。拉打本身沒問題，但加入中間方向能讓防守無法偏移。'});
      else if ((p.oppo_pct || 0) >= 0.5) insights.push({title: `以反方向為主（${pct(p.oppo_pct)}）`, text: '多半是晚一點出棒或刻意推打；若長打偏少，可試著提早一點擊球，用拉打側換取距離。'});
    }

    // 7. Overall value.
    if (p.pa >= MIN_PA && Number.isFinite(p.wrc_plus)) {
      if (p.wrc_plus >= 120) strengths.push({title: '進攻產值高於全隊', evidence: `wRC+ ${p.wrc_plus.toFixed(0)}（100 = 全隊平均）。`});
      else if (p.wrc_plus < 75 && !issues.length) issues.push({key: 'value', group: 'value', severity: 1, title: `整體產值偏低（wRC+ ${p.wrc_plus.toFixed(0)}）`, evidence: '單項指標沒有明顯缺口，但整體上壘與長打都略低於全隊，先從最容易改善的擊球型態開始。'});
    }

    // Archetype from the strongest signal, in order of how much it shapes the at-bat.
    let archetype;
    if (rel.level === 'low') archetype = {label: '樣本累積中', tone: 'slate'};
    else if (isoHigh && (p.hr || 0) >= 2) archetype = {label: '長打重砲型', tone: 'sky'};
    else if (kHigh) archetype = {label: '三振風險型', tone: 'rose'};
    else if (ldStrong && (p.avg || 0) >= team.avg) archetype = {label: '平飛安打型', tone: 'emerald'};
    else if (airHeavy) archetype = {label: '高飛風險型', tone: 'amber'};
    else if (gbHeavy) archetype = {label: '滾地型', tone: 'amber'};
    else if (bbHigh) archetype = {label: '選球上壘型', tone: 'sky'};
    else if (isoLow && (p.avg || 0) >= team.avg) archetype = {label: '短打安打型', tone: 'amber'};
    else if ((p.wrc_plus || 0) >= 110) archetype = {label: '全能穩定型', tone: 'emerald'};
    else archetype = {label: '均衡發展型', tone: 'slate'};

    issues.sort((a, b) => b.severity - a.severity);
    const order = new Map(issues.map((x, i) => [x.key, i]));
    plan.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
    if (issues.some(x => x.key === 'value')) plan.push({key: 'value', focus: '先提高擊球強度與平飛比例', drill: '固定打擊練習以強勁平飛打向外野手之間為目標，每輪記錄平飛球數；比賽中鎖定好打的球全力擊出，不求推打。', target: `wRC+ 提高到 90 以上、平飛比例達 ${pct(team.ld)}`});
    if (!plan.length && rel.level === 'low') plan.push({key: 'sample', focus: '先累積樣本', drill: '目前數字還不足以判斷弱點；每場確實記錄擊球型態與落點，累積後診斷會自動更新。', target: `累積 20 打席、10 球擊球型態紀錄（目前 ${p.pa} 打席、${bip} 球）`});
    if (!plan.length) plan.push({key: 'keep', focus: '維持目前打法', drill: '各項沒有明顯缺口；固定打擊練習以平飛打向外野空檔為主，維持節奏。', target: '維持目前平飛比例與三振率'});
    const severity = issues.reduce((s, x) => s + x.severity, 0) * (rel.level === 'low' ? 0.5 : 1);
    return {name: p.name, archetype, reliability: rel, scores, strengths, issues, insights, plan: plan.slice(0, 3), severity,
      groups: [...new Set(issues.map(x => x.group))], luck: insights.some(x => x.title.includes('運氣'))};
  }

  function analyze(agg, rates) {
    const players = agg.players.filter(p => p.pa > 0);
    const team = teamContext(players, rates);
    return {team, results: players.map(p => diagnose(p, team))};
  }

  const api = {PRIOR, MIN_PA, shrink, teamContext, percentile, reliability, diagnose, analyze};
  if (typeof window !== 'undefined') window.PlayerDiagnostics = api;
  if (typeof document === 'undefined' || typeof window === 'undefined' || typeof window.renderDiagnostics !== 'function') return;

  // ---------- Rendering ----------
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const TONES = {
    slate: 'border-slate-600 bg-slate-800 text-slate-300', sky: 'border-sky-700/60 bg-sky-950/40 text-sky-300',
    rose: 'border-rose-700/60 bg-rose-950/40 text-rose-300', emerald: 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300',
    amber: 'border-amber-700/60 bg-amber-950/40 text-amber-300'
  };
  const REL_TONES = {high: 'text-emerald-300 border-emerald-700/50', mid: 'text-sky-300 border-sky-700/50', low: 'text-amber-300 border-amber-700/50'};
  const DIMENSIONS = [['contact', '避免三振', 'K% 越低越好'], ['discipline', '選球', 'BB%'], ['power', '長打', 'ISO'], ['quality', '擊球品質', '平飛比例'], ['value', '綜合產值', 'wRC+']];
  const MODES = {
    single: r => r.name === selectedPlayerName,
    all: () => true,
    urgent: r => r.issues.some(x => x.severity >= 2),
    power: r => r.groups.includes('power'),
    contact: r => r.groups.includes('contact'),
    trajectory: r => r.groups.includes('trajectory'),
    luck: r => r.luck
  };

  function bars(scores) {
    return `<div class="grid grid-cols-5 gap-1.5" data-diag-scores>${DIMENSIONS.map(([key, label, hint]) => {
      const v = scores[key];
      const width = v === null ? 0 : Math.round(v * 100);
      const color = v === null ? 'bg-slate-700' : v >= 0.67 ? 'bg-emerald-500' : v >= 0.34 ? 'bg-sky-500' : 'bg-rose-500';
      return `<div class="text-center" title="${esc(hint)}：隊內百分位">
        <div class="h-12 w-full bg-slate-900 rounded-md overflow-hidden flex items-end border border-slate-800"><div class="${color} w-full" style="height:${width}%"></div></div>
        <div class="text-[10px] text-slate-400 mt-1 leading-tight">${label}</div>
        <div class="text-[10px] font-mono ${v === null ? 'text-slate-600' : 'text-slate-200'}">${v === null ? '無資料' : `PR ${width}`}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function card(r, p, wide) {
    const list = (items, cls, render) => items.length ? `<ul class="space-y-1.5">${items.map(render).join('')}</ul>` : `<p class="text-[11px] text-slate-500">${cls}</p>`;
    return `<div class="bg-slate-950/90 p-3.5 sm:p-4 rounded-2xl border border-slate-800/80 space-y-3 shadow-lg ${wide ? 'md:col-span-2' : ''}" data-diag-card="${esc(r.name)}">
      <div class="flex items-center gap-3 border-b border-slate-800/80 pb-3">
        <button type="button" class="shrink-0" data-diag-player="${esc(r.name)}" title="開啟 ${esc(r.name)} 的檔案">${renderAvatarElement(r.name, 'w-14 h-14 text-xl ring-2 ring-rose-500/50 shadow-md')}</button>
        <div class="flex-1 min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="font-black text-white text-sm sm:text-base">#${esc(NAME_TO_JERSEY[r.name] ?? '--')} ${esc(r.name)}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full border ${TONES[r.archetype.tone]}" data-diag-archetype>${esc(r.archetype.label)}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded border ${REL_TONES[r.reliability.level]}" title="${esc(r.reliability.note)}">${esc(r.reliability.label)}</span>
          </div>
          <div class="text-[10px] text-slate-400 font-mono">PA ${p.pa}・擊球型態 ${p.bip || 0} 球・AVG ${(p.avg || 0).toFixed(3)}・OPS ${(p.ops || 0).toFixed(3)}・wRC+ ${Number.isFinite(p.wrc_plus) ? p.wrc_plus.toFixed(0) : '—'}</div>
        </div>
      </div>
      ${bars(r.scores)}
      ${r.reliability.level !== 'high' ? `<p class="text-[11px] text-amber-200/80 bg-amber-950/20 border border-amber-900/40 rounded-lg px-2.5 py-1.5">${esc(r.reliability.note)}</p>` : ''}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div class="text-[11px] font-bold text-emerald-400 mb-1">優勢</div>
          ${list(r.strengths, '暫無明顯突出的項目', s => `<li class="bg-emerald-950/20 border border-emerald-900/30 rounded-lg p-2" data-diag-strength><b class="text-emerald-300 text-[11px] block">${esc(s.title)}</b><span class="text-[11px] text-slate-400">${esc(s.evidence)}</span></li>`)}
        </div>
        <div>
          <div class="text-[11px] font-bold text-rose-400 mb-1">弱點</div>
          ${list(r.issues, '沒有明顯弱點', s => `<li class="bg-rose-950/20 border border-rose-900/30 rounded-lg p-2" data-diag-issue="${esc(s.key)}"><b class="text-rose-300 text-[11px] block">${'●'.repeat(s.severity)} ${esc(s.title)}</b><span class="text-[11px] text-slate-400">${esc(s.evidence)}</span></li>`)}
        </div>
      </div>
      ${r.insights.length ? `<div>
        <div class="text-[11px] font-bold text-purple-300 mb-1">交叉判讀</div>
        <ul class="space-y-1.5">${r.insights.map(s => `<li class="bg-purple-950/20 border border-purple-900/30 rounded-lg p-2" data-diag-insight><b class="text-purple-200 text-[11px] block">${esc(s.title)}</b><span class="text-[11px] text-slate-400">${esc(s.text)}</span></li>`).join('')}</ul>
      </div>` : ''}
      <div class="border-t border-slate-800/80 pt-2.5">
        <div class="text-[11px] font-bold text-sky-300 mb-1">改善方針（依優先順序）</div>
        <ol class="space-y-1.5">${r.plan.map((s, i) => `<li class="text-[11px] text-slate-300" data-diag-plan><b class="text-sky-200">${i + 1}. ${esc(s.focus)}</b>：${esc(s.drill)}<span class="block text-[10px] text-sky-300/80 font-mono">目標：${esc(s.target)}</span></li>`).join('')}</ol>
      </div>
    </div>`;
  }

  const GUIDE = `<details class="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400" data-diag-guide>
    <summary class="cursor-pointer text-slate-300 font-bold">怎麼讀這份診斷？（指標意義與交叉判讀）</summary>
    <ul class="mt-2 space-y-1.5 leading-relaxed">
      <li><b class="text-slate-200">比較基準</b>：一律與本隊同期比較（慢壘的打擊率、長打率遠高於棒球，套用大聯盟標準會失真）。PR 是隊內百分位，滿 ${MIN_PA} 打席的隊員才列入比較基準。</li>
      <li><b class="text-slate-200">樣本修正</b>：判斷前先把個人數字向全隊平均「拉回」，打席越少拉得越多（三振、保送較快穩定，長打與擊球型態較慢），避免一兩個打席就下結論。</li>
      <li><b class="text-slate-200">K%（三振率）</b>：慢壘幾乎每球都能打進場內，三振是最可避免的出局；界外K 多代表兩好球後時機或擊球點問題，而非選球。</li>
      <li><b class="text-slate-200">BB%（保送率）</b>：慢壘保送少，高 BB% 是加分，但低 BB% 本身不是問題。</li>
      <li><b class="text-slate-200">ISO（純長打率）</b>：長打率減打擊率，只看長打；搭配打擊率可分出「碰得到但打不遠」與「打得遠但不穩」。</li>
      <li><b class="text-slate-200">擊球型態</b>：平飛、滾地、高飛、內飛的比例，並用本隊實際的各型態安打率換算——平飛最容易成為安打，高飛除非飛出去，多半被接殺。</li>
      <li><b class="text-slate-200">xBA 與運氣</b>：同一批擊球，用型態預期的打擊率對照實際打擊率；差距大代表運氣成分，數字之後多半往預期靠攏。</li>
      <li><b class="text-slate-200">方向</b>：拉打／中間／反方向比例；過度集中會讓守備可以偏站。</li>
      <li><b class="text-slate-200">wRC+</b>：整體進攻產值，100 = 全隊平均。</li>
      <li><b class="text-slate-200">限制</b>：場記沒有球路、球數、揮棒速度，因此不判斷「追打壞球」或動作細節；改善方針是依結果推定的訓練方向，請搭配教練實際觀察。</li>
    </ul>
  </details>`;

  function renderDiagnostics(agg) {
    const container = document.getElementById('diagnosticsCardsContainer');
    const select = document.getElementById('diagFilterMode');
    if (!container || !select) return;
    const {results} = analyze(agg, typeof getBattedBallRates === 'function' ? getBattedBallRates() : null);
    const byName = new Map(agg.players.map(p => [p.name, p]));
    const mode = MODES[select.value] ? select.value : 'single';
    let shown = results.filter(MODES[mode]);
    if (mode !== 'single') shown = shown.sort((a, b) => b.severity - a.severity || byName.get(b.name).pa - byName.get(a.name).pa);
    let guide = document.getElementById('diagnosticsGuide');
    if (!guide) {
      guide = document.createElement('div');
      guide.id = 'diagnosticsGuide';
      guide.innerHTML = GUIDE;
      container.before(guide);
    }
    container.innerHTML = shown.length ? shown.map(r => card(r, byName.get(r.name), mode === 'single')).join('')
      : `<p class="text-xs text-slate-500 md:col-span-2 p-4 text-center">${mode === 'single' ? '目前選取的球員在此範圍內沒有打擊紀錄。' : '目前沒有符合此條件的球員。'}</p>`;
  }

  // Replace the original renderer (renderAll and the mode selector both call the global name).
  window.renderDiagnostics = renderDiagnostics;
  document.getElementById('diagnosticsCardsContainer')?.addEventListener('click', event => {
    const target = event.target.closest('[data-diag-player]');
    if (!target) return;
    selectedPlayerName = target.dataset.diagPlayer;
    renderAll(); // keeps the player selector, profile and this panel in step
    document.getElementById('playerProfileCard')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  });
  try { renderDiagnostics(getAnalysisAgg()); } catch (error) { console.error('[player-diagnostics] init', error); }
})();
