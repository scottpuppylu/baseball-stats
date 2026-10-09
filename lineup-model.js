/* Batting-order model for timed slowpitch games. Pure functions only: no DOM, storage or network.
 *
 * 1. Each hitter's per-PA event rates are regressed toward the team average by sample size.
 * 2. A half-inning is an exact Markov chain over (outs, bases) that follows the actual batting order.
 * 3. The game is a chain of innings driven by the clock: every PA and half-inning change costs minutes,
 *    and no new inning starts once the time limit is reached (or the game stops at once, if chosen).
 * 4. The order is chosen by local search (pair swaps) over exact expected runs per game.
 */
(function (root) {
  'use strict';

  const EVENTS = ['bb', 'k', 's1', 's2', 's3', 'hr', 'go', 'fo', 'po'];
  // Fallback prior weight in PA when regressing toward the team rate (used when too few hitters to estimate).
  const PRIOR_PA = {bb: 60, k: 40, s1: 120, s2: 120, s3: 120, hr: 120};
  // Empirical-Bayes weights are clamped: a department team spreads talent far wider than MLB,
  // but 10-20 hitters give noisy variance estimates.
  const PRIOR_LIMITS = [20, 120];
  const MIN_PA_FOR_PRIOR = 10, MIN_HITTERS_FOR_PRIOR = 8;
  const PRIOR_BIP = 20; // batted balls, for the ground/fly/pop-up split of outs
  // Runner advancement assumptions for slowpitch (no stealing, deep outfield).
  const ADVANCE = {
    s1R2Scores: 0.65, // single: runner on 2nd scores
    s1R1ToThird: 0.30, // single: runner on 1st reaches 3rd when it is open
    s2R1Scores: 0.45, // double: runner on 1st scores
    doublePlay: 0.30, // ground out with a runner on 1st and fewer than two outs
    goR3Scores: 0.50, // ground out: runner on 3rd scores
    foR3Scores: 0.55, // fly out: sacrifice fly from 3rd
    foR2ToThird: 0.30 // fly out: runner on 2nd tags to 3rd
  };
  const DEFAULTS = {
    timeLimit: 90, // minutes for the whole game
    rule: 'noNewInning', // or 'hardStop': the game ends the moment time is up
    maxInnings: 7,
    minutesPerPa: 1.8,
    changeoverMinutes: 1.0, // per half-inning
    role: '先攻'
  };
  const MAX_PA_PER_INNING = 30;
  const WOBA = {bb: 0.69, s1: 0.89, s2: 1.27, s3: 1.62, hr: 2.10};

  const num = v => Number(v) || 0;

  function teamRates(players) {
    const t = {pa: 0, bb: 0, k: 0, s1: 0, s2: 0, s3: 0, hr: 0, gb: 0, fb: 0, ld: 0, pu: 0};
    for (const p of players) {
      if (num(p.pa) <= 0) continue;
      t.pa += num(p.pa); t.bb += num(p.bb); t.k += num(p.k);
      t.s1 += num(p.h1); t.s2 += num(p.h2); t.s3 += num(p.h3); t.hr += num(p.hr);
      t.gb += num(p.gb); t.fb += num(p.fb); t.ld += num(p.ld); t.pu += num(p.pu);
    }
    const pa = Math.max(1, t.pa);
    const bip = t.gb + t.fb + t.ld + t.pu;
    return {
      bb: t.bb / pa, k: t.k / pa, s1: t.s1 / pa, s2: t.s2 / pa, s3: t.s3 / pa, hr: t.hr / pa,
      gbShare: bip ? t.gb / bip : 0.45, puShare: bip ? t.pu / bip : 0.10,
      prior: estimatePriorPa(players)
    };
  }

  // Empirical Bayes: k = p(1-p) / talent variance, where talent variance = observed spread minus binomial noise.
  function estimatePriorPa(players) {
    const hitters = players.filter(p => num(p.pa) >= MIN_PA_FOR_PRIOR);
    if (hitters.length < MIN_HITTERS_FOR_PRIOR) return {...PRIOR_PA, estimated: false};
    const total = hitters.reduce((s, p) => s + num(p.pa), 0);
    const weight = count => {
      const mean = hitters.reduce((s, p) => s + count(p), 0) / total;
      if (!(mean > 0 && mean < 1)) return PRIOR_LIMITS[1];
      const observed = hitters.reduce((s, p) => s + num(p.pa) * (count(p) / num(p.pa) - mean) ** 2, 0) / total;
      const noise = hitters.length * mean * (1 - mean) / total;
      const talent = observed - noise;
      const k = talent > 0 ? mean * (1 - mean) / talent : Infinity;
      return Math.min(PRIOR_LIMITS[1], Math.max(PRIOR_LIMITS[0], k));
    };
    const hits = weight(p => num(p.h1) + num(p.h2) + num(p.h3) + num(p.hr));
    const extra = weight(p => num(p.h2) + num(p.h3) + num(p.hr));
    return {bb: weight(p => num(p.bb)), k: weight(p => num(p.k)), s1: hits, s2: extra, s3: extra, hr: extra, estimated: true};
  }

  // Per-PA event probabilities for one hitter, regressed toward the team.
  function batterModel(player, team) {
    const pa = Math.max(0, num(player.pa));
    const counts = {bb: num(player.bb), k: num(player.k), s1: num(player.h1), s2: num(player.h2), s3: num(player.h3), hr: num(player.hr)};
    const prior = team.prior || PRIOR_PA;
    const p = {};
    for (const e of Object.keys(PRIOR_PA)) p[e] = (counts[e] + prior[e] * team[e]) / (pa + prior[e]);
    let safe = p.bb + p.k + p.s1 + p.s2 + p.s3 + p.hr;
    if (safe > 0.95) { // keep at least 5% in-play outs so every inning ends
      for (const e of Object.keys(PRIOR_PA)) p[e] *= 0.95 / safe;
      safe = 0.95;
    }
    const inPlayOuts = 1 - safe;
    const bip = num(player.gb) + num(player.fb) + num(player.ld) + num(player.pu);
    const gbShare = (num(player.gb) + PRIOR_BIP * team.gbShare) / (bip + PRIOR_BIP);
    const puShare = (num(player.pu) + PRIOR_BIP * team.puShare) / (bip + PRIOR_BIP);
    p.go = inPlayOuts * gbShare;
    p.po = inPlayOuts * puShare;
    p.fo = Math.max(0, inPlayOuts - p.go - p.po);
    const obp = p.bb + p.s1 + p.s2 + p.s3 + p.hr;
    const ab = 1 - p.bb; // per PA, ignoring sacrifice flies
    return {
      name: player.name, pa, probs: p,
      obp, slg: ab > 0 ? (p.s1 + 2 * p.s2 + 3 * p.s3 + 4 * p.hr) / ab : 0,
      woba: WOBA.bb * p.bb + WOBA.s1 * p.s1 + WOBA.s2 * p.s2 + WOBA.s3 * p.s3 + WOBA.hr * p.hr,
      shrink: prior.s1 / (pa + prior.s1) // share of the hit rate that comes from the team prior
    };
  }

  function averageBatter(team) {
    return batterModel({name: '全隊平均', pa: 0}, team);
  }

  // ---------- Base/out transitions ----------
  // State index = outs * 8 + bases; bases bit 1 = 1st, 2 = 2nd, 4 = 3rd. Outcomes: [prob, outs, bases, runs].
  function eventOutcomes(outs, bases, event, A) {
    const r1 = bases & 1, r2 = bases & 2, r3 = bases & 4;
    const runners = (r1 ? 1 : 0) + (r2 ? 1 : 0) + (r3 ? 1 : 0);
    const out = [];
    switch (event) {
      case 'bb': {
        let b = bases, runs = 0;
        if (r1) { if (r2) { if (r3) runs = 1; b = 7; } else b = bases | 3; } else b = bases | 1;
        out.push([1, outs, b, runs]);
        break;
      }
      case 's1': {
        const base = r3 ? 1 : 0;
        const r2Branches = r2 ? [[A.s1R2Scores, 1, 0], [1 - A.s1R2Scores, 0, 4]] : [[1, 0, 0]];
        for (const [p2, scored, third] of r2Branches) {
          if (r1) {
            if (third) out.push([p2, outs, 1 | 2 | 4, base + scored]);
            else {
              out.push([p2 * A.s1R1ToThird, outs, 1 | 4, base + scored]);
              out.push([p2 * (1 - A.s1R1ToThird), outs, 1 | 2, base + scored]);
            }
          } else out.push([p2, outs, 1 | third, base + scored]);
        }
        break;
      }
      case 's2': {
        const base = (r3 ? 1 : 0) + (r2 ? 1 : 0);
        if (r1) {
          out.push([A.s2R1Scores, outs, 2, base + 1]);
          out.push([1 - A.s2R1Scores, outs, 2 | 4, base]);
        } else out.push([1, outs, 2, base]);
        break;
      }
      case 's3': out.push([1, outs, 4, runners]); break;
      case 'hr': out.push([1, outs, 0, runners + 1]); break;
      case 'k':
      case 'po': out.push([1, outs + 1, bases, 0]); break;
      case 'go': {
        let pDp = 0;
        if (r1 && outs < 2) {
          pDp = A.doublePlay;
          // Double play: batter and runner from 1st out; others move up if the inning goes on.
          if (outs + 2 >= 3) out.push([pDp, 3, 0, 0]);
          else out.push([pDp, outs + 2, r2 ? 4 : 0, r3 ? 1 : 0]);
        }
        const rest = 1 - pDp;
        if (outs + 1 >= 3) { out.push([rest, 3, 0, 0]); break; }
        // Productive out: lead runner from 3rd may score; others move up into open bases.
        const branches = r3 ? [[A.goR3Scores, true], [1 - A.goR3Scores, false]] : [[1, false]];
        for (const [p3, scores] of branches) {
          let b = 0, runs = 0;
          if (r3) { if (scores) runs = 1; else b |= 4; }
          if (r2) b |= (b & 4) ? 2 : 4;
          if (r1) b |= (b & 2) ? 1 : 2;
          out.push([rest * p3, outs + 1, b, runs]);
        }
        break;
      }
      case 'fo': {
        if (outs + 1 >= 3) { out.push([1, 3, 0, 0]); break; }
        const branches3 = r3 ? [[A.foR3Scores, 1, 0], [1 - A.foR3Scores, 0, 4]] : [[1, 0, 0]];
        for (const [p3, runs, third] of branches3) {
          if (r2 && !third) {
            out.push([p3 * A.foR2ToThird, outs + 1, 4 | (r1 ? 1 : 0), runs]);
            out.push([p3 * (1 - A.foR2ToThird), outs + 1, 2 | (r1 ? 1 : 0), runs]);
          } else out.push([p3, outs + 1, third | (r2 ? 2 : 0) | (r1 ? 1 : 0), runs]);
        }
        break;
      }
    }
    return out;
  }

  // Merged transition list per state for one hitter: flat arrays of [target (-1 = inning over), prob, runs].
  function compileBatter(model, A) {
    const lists = [];
    for (let s = 0; s < 24; s++) {
      const outs = s >> 3, bases = s & 7;
      const targets = [], probs = [], runs = [];
      for (const e of EVENTS) {
        const pe = model.probs[e];
        if (!(pe > 0)) continue;
        for (const [p, o2, b2, r] of eventOutcomes(outs, bases, e, A)) {
          if (!(p > 0)) continue;
          targets.push(o2 >= 3 ? -1 : o2 * 8 + b2);
          probs.push(pe * p);
          runs.push(r);
        }
      }
      lists.push({targets: Int8Array.from(targets), probs: Float64Array.from(probs), runs: Float64Array.from(runs)});
    }
    return lists;
  }

  // Exact half-inning starting with batter `lead`. alive[j] = P(PA j happens); end[m] = P(inning uses m PAs);
  // runs[j] = expected runs scored on PA j; onBase[j] = P(PA j happens with someone on base).
  function halfInning(compiled, lead) {
    const L = compiled.length;
    let cur = new Float64Array(24), next = new Float64Array(24);
    cur[0] = 1;
    const alive = new Float64Array(MAX_PA_PER_INNING + 1);
    const onBase = new Float64Array(MAX_PA_PER_INNING + 1);
    const runs = new Float64Array(MAX_PA_PER_INNING + 1);
    const end = new Float64Array(MAX_PA_PER_INNING + 1);
    for (let j = 0; j < MAX_PA_PER_INNING; j++) {
      let mass = 0, occupied = 0;
      for (let s = 0; s < 24; s++) { mass += cur[s]; if (s & 7) occupied += cur[s]; }
      if (mass < 1e-12) break;
      alive[j] = mass;
      onBase[j] = occupied;
      next.fill(0);
      const lists = compiled[(lead + j) % L];
      let r = 0, ended = 0;
      for (let s = 0; s < 24; s++) {
        const p = cur[s];
        if (p === 0) continue;
        const t = lists[s];
        for (let i = 0; i < t.targets.length; i++) {
          const q = p * t.probs[i];
          r += q * t.runs[i];
          if (t.targets[i] < 0) ended += q; else next[t.targets[i]] += q;
        }
      }
      runs[j] = r;
      end[j + 1] = ended;
      const swap = cur; cur = next; next = swap;
    }
    let left = 0;
    for (let s = 0; s < 24; s++) left += cur[s];
    end[MAX_PA_PER_INNING] += left; // practically zero; closes the distribution
    return {alive, onBase, runs, end};
  }

  // Expected PAs one opponent-like half-inning takes (opponent assumed to hit like the team average).
  function averageHalfInningPa(team, A, lineupSize) {
    const avg = compileBatter(averageBatter(team), A);
    const h = halfInning(Array.from({length: lineupSize}, () => avg), 0);
    return h.alive.reduce((a, b) => a + b, 0);
  }

  // Exact expected value of one batting order under the clock.
  function evaluateCompiled(compiled, cfg) {
    const L = compiled.length;
    const innings = [];
    for (let b = 0; b < L; b++) innings.push(halfInning(compiled, b));
    const t = cfg.minutesPerPa, c = cfg.changeoverMinutes;
    const oppHalf = cfg.oppHalfPa * t + c;
    const weFirst = cfg.role !== '後攻';
    const NMAX = MAX_PA_PER_INNING * cfg.maxInnings + 1;
    let state = new Map([[0, 1]]); // key = n * L + lead -> probability; n = our PAs so far
    let expRuns = 0, expInnings = 0;
    const paBySlot = new Float64Array(L), onBaseBySlot = new Float64Array(L);
    for (let k = 1; k <= cfg.maxInnings && state.size; k++) {
      const nextState = new Map();
      for (const [key, p] of state) {
        const n = Math.floor(key / L), lead = key % L;
        const inningStart = n * t + (k - 1) * (oppHalf + c);
        if (k > 1 && inningStart >= cfg.timeLimit) continue; // time is up: no new inning
        // Minutes available to our half under a hard stop.
        let ourStart = inningStart + (weFirst ? 0 : oppHalf);
        let cap = MAX_PA_PER_INNING;
        if (cfg.rule === 'hardStop') {
          if (ourStart >= cfg.timeLimit) continue;
          cap = Math.min(MAX_PA_PER_INNING, Math.ceil((cfg.timeLimit - ourStart) / t));
        }
        expInnings += p;
        const h = innings[lead];
        for (let j = 0; j < cap; j++) {
          if (h.alive[j] === 0) break;
          expRuns += p * h.runs[j];
          paBySlot[(lead + j) % L] += p * h.alive[j];
          onBaseBySlot[(lead + j) % L] += p * h.onBase[j];
        }
        for (let m = 1; m <= MAX_PA_PER_INNING; m++) {
          let pm = h.end[m];
          if (!pm) continue;
          if (m > cap) continue; // the clock stopped the game mid-inning
          const n2 = Math.min(n + m, NMAX - 1);
          const k2 = n2 * L + (lead + m) % L;
          nextState.set(k2, (nextState.get(k2) || 0) + p * pm);
        }
        // Under a hard stop, an inning cut off by the clock ends the game (mass dropped from nextState).
      }
      state = nextState;
    }
    const onBaseShare = Array.from(paBySlot, (pa, i) => (pa > 0 ? onBaseBySlot[i] / pa : 0));
    return {runs: expRuns, innings: expInnings, paBySlot: Array.from(paBySlot), onBaseShare};
  }

  function makeConfig(settings, team, lineupSize) {
    const cfg = {...DEFAULTS, ...settings};
    const A = {...ADVANCE, ...(settings && settings.advance)};
    cfg.advance = A;
    cfg.oppHalfPa = averageHalfInningPa(team, A, lineupSize);
    return cfg;
  }

  // Minutes per PA such that a team-average lineup plays `targetInnings` offensive innings on average.
  function calibrateMinutesPerPa(team, settings, lineupSize, targetInnings) {
    const cfg = makeConfig(settings, team, lineupSize);
    const avg = compileBatter(averageBatter(team), cfg.advance);
    const compiled = Array.from({length: lineupSize}, () => avg);
    if (!(targetInnings > 1) || targetInnings >= cfg.maxInnings) return cfg.minutesPerPa;
    let lo = 0.2, hi = 8;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const innings = evaluateCompiled(compiled, {...cfg, minutesPerPa: mid}).innings;
      if (innings > targetInnings) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function evaluateOrder(models, order, cfg) {
    const compiledByModel = cfg._compiled || models.map(m => compileBatter(m, cfg.advance));
    return evaluateCompiled(order.map(i => compiledByModel[i]), cfg);
  }

  // Sabermetric starting point (The Book): best three hitters in slots 1, 2 and 4, next two in 3 and 5.
  function bookOrder(models) {
    const ranked = models.map((m, i) => i).sort((a, b) => models[b].woba - models[a].woba || a - b);
    const top = ranked.slice(0, 3);
    if (top.length < 3) return ranked;
    const lead = top.slice().sort((a, b) => models[b].obp - models[a].obp || a - b)[0];
    const rest = top.filter(i => i !== lead);
    const clean = rest.slice().sort((a, b) => (models[b].slg - models[b].obp) - (models[a].slg - models[a].obp) || a - b)[0];
    const second = rest.find(i => i !== clean);
    const order = [lead, second, ranked[4], clean, ranked[3], ...ranked.slice(5)].filter(v => v !== undefined);
    return order.length === models.length ? order : ranked;
  }

  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Pair-swap hill climbing from several starts; exact evaluation keeps results deterministic.
  function optimizeOrder(models, cfg, extraStarts = []) {
    const compiled = models.map(m => compileBatter(m, cfg.advance));
    const run = order => evaluateCompiled(order.map(i => compiled[i]), cfg).runs;
    const starts = [bookOrder(models), models.map((m, i) => i).sort((a, b) => models[b].woba - models[a].woba || a - b), ...extraStarts];
    let best = null, bestRuns = -Infinity, evaluations = 0;
    const seen = new Set();
    for (const start of starts) {
      const key = start.join(',');
      if (seen.has(key) || start.length !== models.length) continue;
      seen.add(key);
      let order = start.slice(), value = run(order);
      evaluations++;
      for (let improved = true; improved;) {
        improved = false;
        for (let i = 0; i < order.length - 1; i++) {
          for (let j = i + 1; j < order.length; j++) {
            [order[i], order[j]] = [order[j], order[i]];
            const v = run(order);
            evaluations++;
            if (v > value + 1e-9) { value = v; improved = true; }
            else [order[i], order[j]] = [order[j], order[i]];
          }
        }
      }
      if (value > bestRuns + 1e-12) { best = order; bestRuns = value; }
    }
    return {order: best, runs: bestRuns, evaluations};
  }

  function randomOrderMean(models, cfg, samples = 200, seed = 20261010) {
    const compiled = models.map(m => compileBatter(m, cfg.advance));
    const rand = mulberry32(seed);
    let total = 0;
    for (let s = 0; s < samples; s++) {
      const order = models.map((m, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      total += evaluateCompiled(order.map(i => compiled[i]), cfg).runs;
    }
    return total / samples;
  }

  // Runs lost by the best single swap away from each slot: small values mean the slot is a near tie.
  function slotSensitivity(models, order, cfg) {
    const compiled = models.map(m => compileBatter(m, cfg.advance));
    const base = evaluateCompiled(order.map(i => compiled[i]), cfg).runs;
    return order.map((_, i) => {
      let minLoss = Infinity, partner = -1;
      for (let j = 0; j < order.length; j++) {
        if (j === i) continue;
        const o = order.slice();
        [o[i], o[j]] = [o[j], o[i]];
        const loss = base - evaluateCompiled(o.map(x => compiled[x]), cfg).runs;
        if (loss < minLoss) { minLoss = loss; partner = j; }
      }
      return {loss: minLoss, partnerSlot: partner + 1};
    });
  }

  const api = {
    EVENTS, PRIOR_PA, PRIOR_LIMITS, ADVANCE, DEFAULTS, MAX_PA_PER_INNING,
    teamRates, estimatePriorPa, batterModel, averageBatter, eventOutcomes, compileBatter, halfInning,
    makeConfig, calibrateMinutesPerPa, evaluateOrder, evaluateCompiled, bookOrder,
    optimizeOrder, randomOrderMean, slotSensitivity
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LineupModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
