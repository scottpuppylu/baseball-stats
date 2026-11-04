/* 3D batted-ball animation. Everything is drawn in code on a 2D canvas with a perspective camera: the field is built from
   the same geometry as the site's 2D spray charts (home plate at (200, 370) on their 400×400 field), so a ball lands
   exactly where the dot is. A play shows only its batter: how the ball was hit and where it went, then the batter running
   to the base he reached; the next play starts after it fades. The same engine draws video frames (spray3d.engine). */
(function() {
  'use strict';

  // ---------- Data ----------
  const HITS = {'1H': 1, '2H': 2, '3H': 3, HR: 4};
  const REACH = {...HITS, BB: 1, FC: 1, E: 1}; // E: safe at first on an error, as in game-analysis.js
  const LABEL = {'1H': '一壘安打', '2H': '二壘安打', '3H': '三壘安打', HR: '全壘打', BB: '四壞保送', K: '三振', '界外K': '界外三振', K_FOUL: '界外三振',
    GO: '滾地出局', FO: '飛球出局', LO: '平飛出局', FC: '野手選擇', E: '失誤上壘', DP: '雙殺打', SF: '高飛犧牲打'};
  const TRAJ = {line: '平飛', grounder: '滾地', fly: '高飛', popup: '內野飛球'};
  // Same colours as the 2D spray dots.
  const COLOR = {HR: '#f59e0b', '3H': '#a855f7', '2H': '#38bdf8', '1H': '#22c55e', BB: '#cbd5e1', out: '#f43f5e'};
  const colorOf = r => COLOR[r] || COLOR.out;
  const isHit = r => r in HITS;
  const hasFlight = pa => Number.isFinite(pa.x) && Number.isFinite(pa.y) && pa.trajectory && pa.trajectory !== 'none';

  // Plays for one player ('all' for the team) in the header's date range, or every plate appearance of one game.
  // all: also plate appearances without a landing point (walks, strikeouts) outside a single game, for the player video.
  function collectPlays({player = 'all', gameId = null, all = false} = {}) {
    const out = [];
    const games = (typeof allGames !== 'undefined' ? allGames : []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    for (const game of games) {
      if (gameId ? game.id !== gameId : (typeof isGameInDateRange === 'function' && !isGameInDateRange(game))) continue;
      const archived = typeof isSprayChartArchived === 'function' && isSprayChartArchived(game);
      for (const inn of game.innings || []) {
        for (const pa of inn.plateAppearances || []) {
          if (typeof isRunnerOutPlay === 'function' && isRunnerOutPlay(pa)) continue;
          if (player !== 'all' && pa.batterName !== player) continue;
          const flight = !archived && hasFlight(pa);
          if (!gameId && !all && !flight) continue; // outside a single game only batted balls with a landing point are shown
          out.push({batterName: pa.batterName, slot: pa.slot, result: pa.result, trajectory: flight ? pa.trajectory : 'none',
            x: flight ? pa.x : null, y: flight ? pa.y : null, location: pa.location, outsAtEnd: pa.outsAtEnd, outsAdded: pa.outsAdded,
            inningNum: inn.inningNum, gameId: game.id, gameDate: game.date, opponent: game.opponent});
        }
      }
    }
    return out;
  }

  // ---------- Field geometry (world units = the 2D chart's pixels; x right, z toward centre field, y up) ----------
  const toWorld = (sx, sy) => ({x: sx - 200, z: 370 - sy});
  const FENCE = {cx: 0, cz: 107.4, r: 215, a0: Math.atan2(88.5, -195.9), a1: Math.atan2(88.5, 195.9)}; // where the 45° foul lines meet the wall
  const FOUL_L = toWorld(4.1, 174.1), FOUL_R = toWorld(395.9, 174.1); // 90° apart
  const BASES = [{x: 0, z: 0}, toWorld(282.5, 287.5), toWorld(200, 205), toWorld(117.5, 287.5)]; // a square, first and third on the foul lines
  const MOUND = toWorld(200, 287.5); // the centre of the square diamond
  const WALL_H = 9;
  const fenceAt = a => ({x: FENCE.cx + FENCE.r * Math.cos(a), z: FENCE.cz + FENCE.r * Math.sin(a)});
  // Distance from home to the fence along a direction (unit dx, dz).
  function fenceDistance(dx, dz) {
    const b = -(dx * FENCE.cx + dz * FENCE.cz), c = FENCE.cx ** 2 + FENCE.cz ** 2 - FENCE.r ** 2;
    return -b + Math.sqrt(Math.max(0, b * b - c));
  }
  const insideFair = p => {
    const cross = (a, b) => a.x * b.z - a.z * b.x;
    return cross(FOUL_L, p) <= 0 && cross(p, FOUL_R) <= 0;
  };
  // Infield dirt: everything between home and the far side of the 2D chart's dirt circle, inside the foul lines.
  const DIRT_C = toWorld(200, 282.8), DIRT_R = 107.8;
  const DIRT = (() => {
    const arc = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const p = {x: DIRT_C.x + DIRT_R * Math.cos(a), z: DIRT_C.z + DIRT_R * Math.sin(a)};
      // The far side faces away from home (its outward normal points the same way as the ray from home).
      if (insideFair(p) && (p.x - DIRT_C.x) * p.x + (p.z - DIRT_C.z) * p.z > 0) arc.push(p);
    }
    arc.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
    // Close along the foul lines back to home.
    const along = (line, p) => { const t = (p.x * line.x + p.z * line.z) / (line.x ** 2 + line.z ** 2); return {x: line.x * t, z: line.z * t}; };
    return [{x: 0, z: 0}, along(FOUL_R, arc[0]), ...arc, along(FOUL_L, arc[arc.length - 1])];
  })();
  const FAN = (() => {
    const pts = [{x: 0, z: 0}, FOUL_R];
    for (let i = 0; i <= 64; i++) pts.push(fenceAt(FENCE.a1 + (FENCE.a0 - FENCE.a1) * i / 64));
    pts.push(FOUL_L);
    return pts;
  })();
  // Mowing stripes: wedges from home, alternating shades.
  const STRIPES = (() => {
    const list = [], n = 14;
    const aL = Math.atan2(FOUL_L.z, FOUL_L.x), aR = Math.atan2(FOUL_R.z, FOUL_R.x);
    for (let i = 0; i < n; i += 2) {
      const a = aR + (aL - aR) * i / n, b = aR + (aL - aR) * (i + 1) / n;
      const ray = ang => { const dx = Math.cos(ang), dz = Math.sin(ang), d = fenceDistance(dx, dz); return {x: dx * d, z: dz * d}; };
      const pts = [{x: 0, z: 0}];
      for (let k = 0; k <= 6; k++) pts.push(ray(a + (b - a) * k / 6));
      list.push(pts);
    }
    return list;
  })();

  // ---------- Flight and running ----------
  const RUN_LEG = 0.62; // seconds per base
  const STRIKEOUTS = ['K', '界外K', 'K_FOUL'];
  const PACE = 1.75; // the viewer plays at 1.75× (its 1× button means this pace)
  // Path of the ball: positions over time, plus when it lands and what happens there.
  function planBall(pa) {
    if (!hasFlight(pa)) return null;
    const L = toWorld(pa.x * 400, pa.y * 400);
    let d = Math.hypot(L.x, L.z) || 1;
    const dx = L.x / d, dz = L.z / d;
    const out = !(pa.result in REACH) || pa.result === 'FC';
    const start = {x: 0, y: 5, z: 2};
    const segs = [];
    const add = (from, to, T, apex) => segs.push({from, to, T, apex});
    let end = {x: L.x, y: 0, z: L.z};
    if (pa.result === 'HR') {
      d = Math.max(d, fenceDistance(dx, dz) * 1.1);
      end = {x: dx * d, y: 0, z: dz * d};
    }
    const traj = pa.trajectory;
    if (traj === 'grounder') {
      // Hops that shrink as the ball skips through the infield.
      const marks = [0, 0.18, 0.42, 0.64, 0.83, 1], apexes = [6, 4, 2.4, 1.3, 0.6];
      const T = 0.75 + d / 420;
      for (let i = 0; i < 5; i++) {
        const f0 = marks[i], f1 = marks[i + 1];
        const p0 = i ? {x: end.x * f0, y: 0, z: end.z * f0} : start, p1 = {x: end.x * f1, y: out && i === 4 ? 3 : 0, z: end.z * f1};
        add(p0, p1, T * (f1 - f0) * (1 + i * 0.12), apexes[i]);
      }
    } else {
      const shape = traj === 'line' ? {T: 0.8 + d / 520, apex: 8 + d * 0.09} : traj === 'popup' ? {T: 2.3, apex: 95 + d * 0.5}
        : {T: 1.5 + d / 380, apex: 26 + d * 0.33};
      if (pa.result === 'HR') shape.apex += 30;
      const to = out ? {...end, y: 6} : end; // a caught ball ends in the glove
      add(start, to, shape.T, shape.apex);
      if (!out && pa.result !== 'HR') {
        // A hit keeps rolling a little after it lands.
        const roll = Math.min(32, d * 0.12);
        const r1 = {x: end.x + dx * roll * 0.6, y: 0, z: end.z + dz * roll * 0.6}, r2 = {x: end.x + dx * roll, y: 0, z: end.z + dz * roll};
        add(end, r1, 0.32, Math.min(7, shape.apex * 0.12));
        add(r1, r2, 0.3, 1.5);
      }
    }
    const landAt = segs[0].T + (traj === 'grounder' ? segs.slice(1).reduce((a, s) => a + s.T, 0) : 0);
    // A ground-ball out is thrown to first.
    let throwAt = null;
    if (out && traj === 'grounder') {
      const b1 = {x: BASES[1].x, y: 6, z: BASES[1].z};
      const T = 0.3 + Math.hypot(end.x - b1.x, end.z - b1.z) / 900;
      segs.push({from: {x: end.x, y: 3, z: end.z}, to: b1, T, apex: 4, delay: 0.18});
      throwAt = segs.reduce((a, s) => a + s.T + (s.delay || 0), 0);
    }
    const total = segs.reduce((a, s) => a + s.T + (s.delay || 0), 0);
    return {segs, land: {x: L.x, z: L.z}, landAt, total, out, throwAt, end};
  }
  function ballAt(plan, t) {
    let acc = 0;
    for (const s of plan.segs) {
      acc += s.delay || 0;
      if (t < acc) return {x: s.from.x, y: s.from.y, z: s.from.z};
      if (t <= acc + s.T) {
        const u = (t - acc) / s.T;
        return {x: s.from.x + (s.to.x - s.from.x) * u, y: s.from.y + (s.to.y - s.from.y) * u + 4 * s.apex * u * (1 - u), z: s.from.z + (s.to.z - s.from.z) * u};
      }
      acc += s.T;
    }
    const last = plan.segs[plan.segs.length - 1].to;
    return {...last};
  }
  // When the play is decided (catch, throw at first, or the ball stops) and how long it lasts.
  function planPlay(pa) {
    const ball = planBall(pa);
    const bases = REACH[pa.result] || 0;
    const runStart = ball ? 0.15 : 0.35;
    const legT = pa.result === 'HR' ? RUN_LEG * 1.25 : pa.result === 'BB' ? RUN_LEG * 1.6 : RUN_LEG;
    // Outs: the batter runs until the ball is caught or reaches first, then the play is over.
    // A strikeout is decided at the plate; any other out still runs all the way to first, where he turns red and fades.
    const decided = !ball ? runStart + (bases ? bases * legT : 0.45) : ball.out ? (ball.throwAt ?? ball.landAt) : Math.max(ball.total, runStart + bases * legT);
    const runEnd = bases ? runStart + bases * legT : ball ? runStart + legT : decided;
    const done = Math.max(decided, runEnd);
    // A strikeout stays a little longer so its big K can land and leave before the next batter.
    const strikeout = STRIKEOUTS.includes(pa.result);
    return {pa, ball, bases, runStart, legT, decided, done, strikeout, length: done + (strikeout ? 1.6 : 1.1)};
  }
  function runnerAt(play, t) {
    const {bases, runStart, legT} = play;
    const legs = bases ? Math.min(bases, Math.max(0, (t - runStart) / legT)) : play.ball ? Math.min(1, Math.max(0, (t - runStart) / legT)) : 0;
    const i = Math.min(3, Math.floor(legs)), f = legs - i;
    const a = BASES[i], b = BASES[(i + 1) % 4];
    return {x: a.x + (b.x - a.x) * f, y: 0, z: a.z + (b.z - a.z) * f, legs};
  }

  // ---------- Engine ----------
  const SANS = '"Serif Flight","PingFang TC","TK Gothic","Noto Sans TC","Microsoft JhengHei",sans-serif';
  const MINCHO = '"TK Mincho","Noto Serif TC","Songti TC",serif';
  const CAMERAS = {auto: {az: 0, el: 22, label: '自動運鏡'}, home: {az: 0, el: 21, label: '本壘後方'}, top: {az: 0, el: 68, label: '高空'}, first: {az: 48, el: 24, label: '一壘側'}, third: {az: -48, el: 24, label: '三壘側'}};
  const TARGET = {x: 0, y: 0, z: 128};
  const FIT_POINTS = [{x: 0, y: 0, z: -6}, {...FOUL_L, y: 0}, {...FOUL_R, y: 0}, ...[0.15, 0.5, 0.85].map(f => ({...fenceAt(FENCE.a1 + (FENCE.a0 - FENCE.a1) * f), y: WALL_H}))];
  const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norm = a => { const l = Math.hypot(a.x, a.y, a.z) || 1; return {x: a.x / l, y: a.y / l, z: a.z / l}; };
  const cross3 = (a, b) => ({x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x});

  function engine(canvas) {
    const c = canvas.getContext('2d');
    // target: the point the camera orbits; follow (0–1) moves the screen centre from the whole field to that point.
    const view = {az: 0, el: 21, zoom: 1, target: {...TARGET}, follow: 0};
    let cam = null;
    // Camera on a sphere around the target, scaled so the whole field fits the canvas at zoom 1.
    function orbit(T) {
      const az = view.az * Math.PI / 180, el = view.el * Math.PI / 180, dist = 330;
      const eye = {x: T.x + dist * Math.sin(az) * Math.cos(el), y: T.y + dist * Math.sin(el), z: T.z - dist * Math.cos(az) * Math.cos(el)};
      const f = norm(sub(T, eye)), r = norm(cross3({x: 0, y: 1, z: 0}, f)), u = cross3(f, r); // screen right = +x (first-base side)
      return {eye, f, r, u, F: 1, cx: 0, cy: 0};
    }
    function setCamera(w, h, pad) {
      // The scale that fits the whole field is measured from the standard viewpoint (orbiting the infield), so moving
      // the target pans the shot instead of changing how big the field looks; zoom then pushes in. The camera looks at
      // its target, which therefore projects to (0, 0): without follow it sits where the infield sits in the standard
      // framing, with follow it comes to the centre.
      cam = orbit(TARGET);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of FIT_POINTS) { const q = rawProject(p); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      const F = Math.min((w - pad.l - pad.r) / (x1 - x0), (h - pad.t - pad.b) / (y1 - y0)) * view.zoom;
      const mx = pad.l + (w - pad.l - pad.r) / 2, my = pad.t + (h - pad.t - pad.b) / 2;
      cam = orbit(view.target);
      cam.F = F;
      cam.cx = mx - F * (x0 + x1) / 2 * (1 - view.follow);
      cam.cy = my - F * (y0 + y1) / 2 * (1 - view.follow);
    }
    function rawProject(p) {
      const d = sub(p, cam.eye), z = Math.max(1, dot(d, cam.f));
      return {x: dot(d, cam.r) / z, y: -dot(d, cam.u) / z, z};
    }
    const project = p => { const q = rawProject(p); return {x: cam.cx + q.x * cam.F, y: cam.cy + q.y * cam.F, z: q.z, s: cam.F / q.z}; };
    const ground = (x, z, y = 0) => project({x, y, z});
    function poly(points, fill, stroke, width) {
      c.beginPath();
      points.forEach((p, i) => { const q = ground(p.x, p.z, p.y || 0); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); });
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
    }
    function line(a, b, color, width) {
      const p = ground(a.x, a.z, a.y || 0), q = ground(b.x, b.z, b.y || 0);
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.strokeStyle = color; c.lineWidth = width; c.stroke();
    }
    function ring(x, z, r, color, width, fill) {
      c.beginPath();
      for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2, q = ground(x + r * Math.cos(a), z + r * Math.sin(a)); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (color) { c.strokeStyle = color; c.lineWidth = width; c.stroke(); }
    }
    const STARS = Array.from({length: 70}, (_, i) => ({x: (Math.sin(i * 12.9898) * 43758.5453) % 1, y: (Math.sin(i * 78.233) * 12543.1) % 1, r: (i % 3) * 0.4 + 0.5}));

    function drawField(w, h, k) {
      // Sky and ground.
      const sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#04060b'); sky.addColorStop(0.55, '#070b10'); sky.addColorStop(1, '#0a0f0c');
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      const horizon = ground(0, 2000).y;
      c.fillStyle = 'rgba(255,255,255,0.5)';
      for (const s of STARS) { const y = Math.abs(s.y) * Math.max(0, horizon); if (y < horizon - 6) { c.globalAlpha = 0.25 + Math.abs(s.x) * 0.5; c.beginPath(); c.arc(Math.abs(s.x) * w, y, s.r * k, 0, 7); c.fill(); } }
      c.globalAlpha = 1;
      // Foul ground, fair grass with mowing stripes, the warning glow at the wall.
      poly([{x: -420, z: -60}, {x: 420, z: -60}, {x: 420, z: 520}, {x: -420, z: 520}], '#0a1410');
      poly(FAN, '#103222');
      for (const s of STRIPES) poly(s, 'rgba(255,255,255,0.025)');
      poly(DIRT, '#3b2619');
      // Infield grass inside the base paths.
      const inset = BASES.map(b => ({x: MOUND.x + (b.x - MOUND.x) * 0.72, z: MOUND.z + (b.z - MOUND.z) * 0.72}));
      poly(inset, '#12382a');
      ring(MOUND.x, MOUND.z, 10, null, 0, '#4a3020');
      line({x: MOUND.x - 3, z: MOUND.z}, {x: MOUND.x + 3, z: MOUND.z}, '#f1f5f9', 1.6 * k);
      // Base paths and foul lines.
      for (let i = 0; i < 4; i++) line(BASES[i], BASES[(i + 1) % 4], 'rgba(241,245,249,0.55)', 1.4 * k);
      line({x: 0, z: 0}, FOUL_L, 'rgba(248,250,252,0.85)', 1.8 * k);
      line({x: 0, z: 0}, FOUL_R, 'rgba(248,250,252,0.85)', 1.8 * k);
      // The wall: a dark band with a green top rail, and the foul poles.
      c.beginPath();
      for (let i = 0; i <= 64; i++) { const p = fenceAt(FENCE.a1 + (FENCE.a0 - FENCE.a1) * i / 64), q = ground(p.x, p.z, 0); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }
      for (let i = 64; i >= 0; i--) { const p = fenceAt(FENCE.a1 + (FENCE.a0 - FENCE.a1) * i / 64), q = ground(p.x, p.z, WALL_H); c.lineTo(q.x, q.y); }
      c.closePath(); c.fillStyle = 'rgba(8,24,17,0.92)'; c.fill();
      c.beginPath();
      for (let i = 0; i <= 64; i++) { const p = fenceAt(FENCE.a1 + (FENCE.a0 - FENCE.a1) * i / 64), q = ground(p.x, p.z, WALL_H); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }
      c.strokeStyle = '#34d399'; c.lineWidth = 2 * k; c.shadowColor = 'rgba(52,211,153,0.6)'; c.shadowBlur = 8 * k; c.stroke(); c.shadowBlur = 0;
      for (const p of [fenceAt(FENCE.a0), fenceAt(FENCE.a1)]) line({x: p.x, z: p.z, y: 0}, {x: p.x, z: p.z, y: 60}, '#fbbf24', 1.6 * k);
      // Bases and home plate.
      for (let i = 1; i < 4; i++) {
        const b = BASES[i], s = 4;
        poly([{x: b.x - s, z: b.z}, {x: b.x, z: b.z + s}, {x: b.x + s, z: b.z}, {x: b.x, z: b.z - s}], '#f8fafc');
      }
      poly([{x: -4, z: 2}, {x: 4, z: 2}, {x: 4, z: -1}, {x: 0, z: -4}, {x: -4, z: -1}], '#f8fafc');
    }

    // A big red K in the middle of the field: it springs in as the batter is rung up (a slight overshoot, a soft glow and
    // a ring that opens outward), holds, then lifts away and is fully gone before the play ends.
    function drawStrikeout(play, t, w, h, k) {
      const start = play.decided - 0.2, end = play.length - 0.15;
      if (t < start || t > end) return;
      const u = Math.min(1, (t - start) / 0.42);
      const back = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
      const out = Math.max(0, Math.min(1, (t - (end - 0.38)) / 0.38));
      const scale = (0.55 + 0.45 * back(u)) * (1 + 0.1 * out);
      const alpha = Math.min(1, u * 2.2) * (1 - out);
      if (alpha <= 0) return;
      const cx = w / 2, cy = h * 0.4, size = Math.min(w, h) * 0.34;
      c.save();
      c.globalAlpha = alpha * 0.55;
      const glow = c.createRadialGradient(cx, cy, 0, cx, cy, size * 1.1);
      glow.addColorStop(0, 'rgba(244,63,94,0.5)'); glow.addColorStop(1, 'rgba(244,63,94,0)');
      c.fillStyle = glow; c.fillRect(cx - size * 1.2, cy - size * 1.2, size * 2.4, size * 2.4);
      // The ring opens once, as the K arrives.
      if (u < 1) { c.globalAlpha = alpha * (1 - u); c.strokeStyle = '#fb7185'; c.lineWidth = 3 * k; c.beginPath(); c.arc(cx, cy, size * (0.45 + 0.55 * u), 0, 7); c.stroke(); }
      c.globalAlpha = alpha;
      c.translate(cx, cy); c.scale(scale, scale);
      c.font = `900 ${size}px ${MINCHO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const fill = c.createLinearGradient(0, -size / 2, 0, size / 2);
      fill.addColorStop(0, '#ff7a8c'); fill.addColorStop(1, '#e11d48');
      c.shadowColor = 'rgba(244,63,94,0.75)'; c.shadowBlur = 26 * k;
      c.fillStyle = fill; c.fillText('K', 0, 0);
      c.shadowBlur = 0; c.lineWidth = 1.5 * k; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.strokeText('K', 0, 0);
      c.font = `700 ${size * 0.13}px ${SANS}`; c.fillStyle = '#fecdd3';
      c.fillText(play.pa.result === 'K' ? '三振' : '界外三振', 0, size * 0.62);
      c.restore();
    }
    function pill(text, x, y, color, k, size = 13) {
      c.font = `700 ${size * k}px ${SANS}`;
      const w = c.measureText(text).width + 16 * k, h = (size + 10) * k;
      c.beginPath(); c.roundRect(x - w / 2, y - h, w, h, h / 2);
      c.fillStyle = 'rgba(6,9,14,0.82)'; c.fill(); c.lineWidth = 1.2 * k; c.strokeStyle = color; c.stroke();
      c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y - h / 2 + 0.5 * k);
      c.textBaseline = 'alphabetic';
    }
    // The ball's trail up to time t, the ball and its shadow.
    function drawBall(plan, t, color, k, alpha, keepTrail) {
      if (!plan) return;
      const tt = Math.min(t, plan.total), steps = Math.max(8, Math.ceil(tt * 40));
      c.lineCap = 'round';
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const p = ballAt(plan, tt * i / steps), q = project(p);
        if (prev) {
          c.beginPath(); c.moveTo(prev.x, prev.y); c.lineTo(q.x, q.y);
          c.strokeStyle = color; c.globalAlpha = alpha * (keepTrail ? 0.55 : 0.15 + 0.75 * i / steps); c.lineWidth = 2.6 * k; c.stroke();
        }
        prev = q;
      }
      c.globalAlpha = alpha;
      if (t < plan.total + 0.05) {
        const p = ballAt(plan, tt), s = ground(p.x, p.z), q = project(p);
        c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.ellipse(s.x, s.y, Math.max(2, 3 * s.s), Math.max(1, 1.4 * s.s), 0, 0, 7); c.fill();
        const r = Math.max(3 * k, 2.4 * q.s);
        const g = c.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * 3.2);
        g.addColorStop(0, color + 'cc'); g.addColorStop(1, color + '00');
        c.fillStyle = g; c.beginPath(); c.arc(q.x, q.y, r * 3.2, 0, 7); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(q.x, q.y, r, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    }
    function drawLanding(plan, color, k, alpha, pulse) {
      if (!plan) return;
      c.globalAlpha = alpha;
      const p = plan.out ? plan.land : plan.end;
      ring(p.x, p.z, 5, null, 0, color);
      if (pulse > 0) ring(p.x, p.z, 5 + pulse * 16, color, 2 * k);
      c.globalAlpha = 1;
    }
    function drawRunner(play, t, k, alpha) {
      const r = runnerAt(play, t), q = project({x: r.x, y: 4, z: r.z});
      const out = !play.bases && t > play.decided;
      c.globalAlpha = alpha;
      c.fillStyle = 'rgba(0,0,0,0.4)'; const s = ground(r.x, r.z); c.beginPath(); c.ellipse(s.x, s.y, 4 * k, 1.8 * k, 0, 0, 7); c.fill();
      c.fillStyle = out ? '#f43f5e' : '#f8fafc'; c.shadowColor = out ? 'rgba(244,63,94,0.8)' : 'rgba(255,255,255,0.8)'; c.shadowBlur = 10 * k;
      c.beginPath(); c.arc(q.x, q.y, 5 * k, 0, 7); c.fill(); c.shadowBlur = 0;
      c.font = `700 ${12 * k}px ${SANS}`; c.textAlign = 'center'; c.fillStyle = '#f8fafc';
      c.fillText(play.pa.batterName, q.x, q.y - 10 * k);
      c.globalAlpha = 1;
    }

    // Draws the scene. state: {plays (planned), mode 'seq' | 'all', time}. Returns what is on screen now.
    function draw(state, w, h, opts = {}) {
      const k = opts.scale || 1;
      setCamera(w, h, opts.pad || {l: 12 * k, r: 12 * k, t: 18 * k, b: 12 * k});
      drawField(w, h, k);
      const plays = state.plays;
      if (state.mode === 'all') {
        const step = Math.min(0.14, 3.2 / Math.max(1, plays.length));
        plays.forEach((p, i) => {
          const t = state.time - i * step;
          if (t <= 0 || !p.ball) return;
          const color = colorOf(p.pa.result);
          drawBall(p.ball, t, color, k, 0.9, t > p.ball.total);
          if (t > p.ball.landAt) drawLanding(p.ball, color, k, 1, 0);
        });
        return {index: -1};
      }
      // Sequential: earlier plays stay as faint dots; the current one plays out, then fades.
      const {index, t} = locate(state);
      for (let i = 0; i < index; i++) drawLanding(plays[i].ball, colorOf(plays[i].pa.result), k, 0.38, 0);
      const play = plays[index];
      if (!play) return {index: -1};
      const fade = Math.max(0, Math.min(1, (play.length - t) / 0.45));
      const color = colorOf(play.pa.result);
      drawBall(play.ball, t, color, k, fade, false);
      if (play.ball && t > play.ball.landAt) drawLanding(play.ball, color, k, fade, Math.max(0, 1 - (t - play.ball.landAt) / 0.6));
      drawRunner(play, t, k, fade);
      if (play.strikeout) drawStrikeout(play, t, w, h, k);
      if (t > play.decided && opts.labels !== false && !play.strikeout) {
        const anchor = play.ball ? (play.ball.out ? play.ball.land : play.ball.end) : runnerAt(play, t);
        const q = ground(anchor.x, anchor.z, 14);
        pill(LABEL[play.pa.result] || play.pa.result, q.x, q.y, color, k);
      }
      return {index, t, play, fade};
    }
    return {draw, view, project};
  }

  // Which play is on screen at state.time (sequential mode) and how far into it.
  function locate(state) {
    let t = state.time, index = 0;
    const plays = state.plays;
    while (index < plays.length - 1 && t > plays[index].length) { t -= plays[index].length; index++; }
    return {index, t, play: plays[index]};
  }

  // ---------- Automatic camera ----------
  // A broadcast angle behind home before contact; then it leans toward where the ball is going and rises for fly
  // balls, pushes in on the catch or the landing, swings around with a runner taking extra bases, and eases back for
  // the next batter. In 全部軌跡 it slowly sweeps across the outfield. Values glide toward the shot (damped by dt), so
  // the same code drives both the live viewer and fixed-step video frames.
  const lerp = (a, b, f) => a + (b - a) * f;
  function shot(state, portrait) {
    const lift = portrait ? 9 : 0;
    if (state.mode === 'all') {
      const s = Math.sin(state.time / 3.2);
      return {az: s * 30, el: 30 + lift, zoom: 1.02, target: {...TARGET}, follow: 0};
    }
    const {t, play} = locate(state);
    const base = {az: 0, el: 22 + lift, zoom: 1, target: {...TARGET}, follow: 0};
    if (!play) return base;
    const ball = play.ball;
    if (!ball) {
      // Walks and strikeouts: a closer look at home plate and the way to first.
      return {az: -12, el: 28 + lift, zoom: 1.4, target: {x: 34, y: 0, z: 40}, follow: 0.7};
    }
    const dir = Math.atan2(ball.land.x, ball.land.z) * 180 / Math.PI; // left field negative, right field positive
    // To look toward where the ball went, the camera slides the other way around home (less for balls close to the plate).
    const reach = Math.min(1, Math.hypot(ball.land.x, ball.land.z) / 140);
    const turn = a => Math.max(-32, Math.min(32, a));
    const far = Math.min(1, Math.hypot(ball.land.x, ball.land.z) / 260);
    const fly = ['fly', 'popup'].includes(play.pa.trajectory);
    const fadeOut = Math.max(0, Math.min(1, (t - (play.length - 0.6)) / 0.6));
    let s;
    if (t < 0.12) s = base;
    else if (t < play.decided) {
      // In flight: the target slides along with the ball.
      const u = Math.min(1, (t - 0.12) / Math.max(0.3, ball.landAt - 0.12));
      const p = ballAt(ball, Math.min(t, ball.total));
      s = {az: turn(-dir * 0.4 * reach * u), el: (fly ? 30 : 20) + lift + (fly ? 8 * Math.sin(u * Math.PI) : 0), zoom: 1 + (0.12 + 0.3 * far) * u,
        target: {x: lerp(TARGET.x, p.x, 0.55 * u), y: 0, z: lerp(TARGET.z, p.z, 0.55 * u)}, follow: 0.6 * u};
    } else {
      // Decided: frame the landing (or the catch) together with the batter.
      const r = runnerAt(play, t), L = ball.out ? ball.land : ball.end;
      const extra = play.bases >= 2;
      s = {az: turn(extra ? lerp(-dir * 0.35 * reach, -Math.atan2(r.x, r.z + 40) * 180 / Math.PI * 0.5, 0.7) : -dir * 0.35 * reach), el: 26 + lift, zoom: 1.12 + 0.36 * far,
        target: {x: lerp(L.x, r.x, extra ? 0.6 : 0.35), y: 0, z: lerp(L.z, r.z, extra ? 0.6 : 0.35)}, follow: 0.75};
    }
    if (fadeOut) s = {az: lerp(s.az, 0, fadeOut), el: lerp(s.el, base.el, fadeOut), zoom: lerp(s.zoom, 1, fadeOut),
      target: {x: lerp(s.target.x, TARGET.x, fadeOut), y: 0, z: lerp(s.target.z, TARGET.z, fadeOut)}, follow: lerp(s.follow, 0, fadeOut)};
    return s;
  }
  function glide(view, s, dt, rate = 3.2) {
    const f = 1 - Math.exp(-rate * dt);
    view.az = lerp(view.az, s.az, f); view.el = lerp(view.el, s.el, f); view.zoom = lerp(view.zoom, s.zoom, f);
    view.follow = lerp(view.follow, s.follow, f);
    view.target = {x: lerp(view.target.x, s.target.x, f), y: 0, z: lerp(view.target.z, s.target.z, f)};
  }

  const plan = plays => plays.map(planPlay);
  const sequenceLength = planned => planned.reduce((a, p) => a + p.length, 0);
  const allLength = planned => Math.min(0.14, 3.2 / Math.max(1, planned.length)) * planned.length + Math.max(0, ...planned.map(p => p.ball ? p.ball.total : 0)) + 0.5;

  // ---------- Viewer ----------
  const RESULT_FILTERS = [['all', '全部'], ['hits', '安打'], ['extra', '長打'], ['outs', '出局']];
  const TYPE_FILTERS = [['all', '全部型態'], ['line', '平飛'], ['grounder', '滾地'], ['fly', '高飛'], ['popup', '內野飛球']];
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let viewer = null;

  function close() {
    if (!viewer) return;
    cancelAnimationFrame(viewer.raf);
    viewer.modal.remove();
    document.removeEventListener('keydown', viewer.onKey);
    viewer = null;
  }

  // scope: {title, player?, gameId?, result?, type?, mode?}
  function open(scope) {
    close();
    const all = collectPlays(scope);
    const modal = document.createElement('div');
    modal.id = 'spray3dModal';
    modal.className = 'fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-2 sm:p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '3D 擊球落點動畫');
    const chip = (group, value, label) => `<button type="button" data-s3-${group}="${value}" class="s3-chip">${label}</button>`;
    const batters = [...new Set(all.map(p => p.batterName))];
    modal.innerHTML = `
      <div class="s3-panel bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-full flex flex-col overflow-hidden">
        <div class="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
          <h3 class="text-sm font-black text-sky-200 truncate">${escape(scope.title || '3D 擊球落點')}</h3>
          <button type="button" data-s3="close" class="text-slate-400 hover:text-white px-2 py-1" aria-label="關閉">✕</button>
        </div>
        <div class="s3-stage relative mx-3 rounded-xl overflow-hidden border border-slate-800">
          <canvas class="block w-full h-full touch-none"></canvas>
          <div class="s3-hud absolute left-3 top-2 right-3 pointer-events-none text-[12px] font-bold text-slate-100"></div>
          <div class="s3-empty hidden absolute inset-0 flex items-center justify-center text-sm text-slate-400">沒有符合條件的擊球</div>
        </div>
        <div class="px-3 py-3 space-y-2 overflow-y-auto">
          <div class="s3-row">
            <button type="button" data-s3="play" class="s3-chip s3-primary" aria-label="播放或暫停">❚❚ 暫停</button>
            <button type="button" data-s3="replay" class="s3-chip">↻ 重播</button>
            <button type="button" data-s3="speed" class="s3-chip">1×</button>
            ${window.gameVideo ? '<button type="button" data-s3="export" class="s3-chip">🎬 匯出影片</button>' : ''}
            <span class="mx-1 h-5 w-px bg-slate-700"></span>
            ${chip('mode', 'seq', '逐球播放')}${chip('mode', 'all', '全部軌跡')}
          </div>
          <div class="s3-row">${RESULT_FILTERS.map(([v, l]) => chip('result', v, l)).join('')}</div>
          <div class="s3-row">${TYPE_FILTERS.map(([v, l]) => chip('type', v, l)).join('')}</div>
          <div class="s3-row">
            ${Object.entries(CAMERAS).map(([v, cfg]) => chip('cam', v, cfg.label)).join('')}
            ${batters.length > 1 && !scope.gameId ? `<select data-s3="batter" class="ml-auto bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-2 py-1.5 text-xs"><option value="all">全部打者</option>${batters.map(n => `<option value="${escape(n)}">${escape(n)}</option>`).join('')}</select>` : ''}
          </div>
          <div class="flex flex-wrap gap-3 text-[11px] text-slate-400 pt-1">
            <span><i class="s3-dot" style="background:${COLOR['1H']}"></i>一安</span><span><i class="s3-dot" style="background:${COLOR['2H']}"></i>二安</span>
            <span><i class="s3-dot" style="background:${COLOR['3H']}"></i>三安</span><span><i class="s3-dot" style="background:${COLOR.HR}"></i>全壘打</span>
            <span><i class="s3-dot" style="background:${COLOR.out}"></i>出局</span><span class="text-slate-500">手指滑動可旋轉、雙指或滾輪縮放</span>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const canvas = modal.querySelector('canvas');
    const stage = modal.querySelector('.s3-stage');
    const hud = modal.querySelector('.s3-hud');
    const eng = engine(canvas);
    const state = {result: scope.result || 'all', type: 'all', batter: 'all', mode: scope.mode || (reduceMotion() ? 'all' : 'seq'), cam: 'home',
      playing: true, speed: 1, time: 0, plays: [], length: 0, single: !!scope.gameId};
    viewer = {modal, state, eng, raf: 0, onKey: e => { if (e.key === 'Escape') close(); }};
    document.addEventListener('keydown', viewer.onKey);

    const pass = p => (state.batter === 'all' || p.batterName === state.batter)
      && (state.type === 'all' || p.trajectory === state.type)
      && (state.result === 'all' || (state.result === 'hits' ? isHit(p.result) : state.result === 'extra' ? ['2H', '3H', 'HR'].includes(p.result) : !(p.result in REACH)));
    function rebuild(restart = true) {
      state.plays = plan(all.filter(p => pass(p) && (state.mode === 'seq' || p.trajectory !== 'none')));
      state.length = state.mode === 'seq' ? sequenceLength(state.plays) : allLength(state.plays);
      if (restart) state.time = reduceMotion() && state.mode === 'all' ? state.length : 0;
      modal.querySelector('.s3-empty').classList.toggle('hidden', state.plays.length > 0);
      modal.querySelectorAll('[data-s3-mode],[data-s3-result],[data-s3-type],[data-s3-cam]').forEach(b => {
        const [group, value] = Object.entries(b.dataset)[0];
        const key = group.replace('s3', '').toLowerCase();
        b.classList.toggle('s3-on', state[key] === value);
        b.setAttribute('aria-pressed', String(state[key] === value));
      });
      state.playing = true;
      syncPlay();
    }
    const syncPlay = () => { modal.querySelector('[data-s3="play"]').textContent = state.playing ? '❚❚ 暫停' : '▶ 播放'; };
    function setCam(name) {
      state.cam = name;
      Object.assign(eng.view, {az: CAMERAS[name].az, el: CAMERAS[name].el + (portrait() ? 9 : 0), zoom: 1, target: {...TARGET}, follow: 0});
      rebuild(false);
    }

    // Size the stage: tall on phones (portrait), wide on tablets and desktops.
    const portrait = () => innerWidth < 640;
    function size() {
      const width = stage.clientWidth;
      const height = Math.round(Math.min(innerHeight * (portrait() ? 0.54 : 0.62), width * (portrait() ? 0.98 : 0.6)));
      stage.style.height = height + 'px';
      const dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    size();
    const onResize = () => size();
    addEventListener('resize', onResize);
    const observer = new MutationObserver(() => { if (!document.body.contains(modal)) { removeEventListener('resize', onResize); observer.disconnect(); } });
    observer.observe(document.body, {childList: true});

    // Drag to orbit, wheel or pinch to zoom; the camera drifts slowly when left alone.
    let drag = null, pinch = null, idle = 0;
    const pointers = new Map();
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, e); drag = {x: e.clientX, y: e.clientY, az: eng.view.az, el: eng.view.el}; idle = 0; });
    canvas.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (!pinch) pinch = {d, zoom: eng.view.zoom};
        eng.view.zoom = Math.max(0.8, Math.min(2.6, pinch.zoom * d / pinch.d));
      } else if (drag) {
        eng.view.az = Math.max(-85, Math.min(85, drag.az + (e.clientX - drag.x) * 0.35));
        eng.view.el = Math.max(8, Math.min(82, drag.el + (e.clientY - drag.y) * 0.25));
      }
      idle = 0;
    });
    const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) drag = null; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { e.preventDefault(); eng.view.zoom = Math.max(0.8, Math.min(2.6, eng.view.zoom * (e.deltaY > 0 ? 0.92 : 1.08))); idle = 0; }, {passive: false});
    canvas.addEventListener('dblclick', () => setCam(state.cam));

    modal.addEventListener('click', e => {
      const t = e.target.closest('button,[data-s3]');
      if (e.target === modal) return close();
      if (!t) return;
      const d = t.dataset;
      if (d.s3 === 'close') close();
      else if (d.s3 === 'play') { if (!state.playing && state.time >= state.length) state.time = 0; state.playing = !state.playing; syncPlay(); }
      else if (d.s3 === 'replay') { state.time = 0; state.playing = true; syncPlay(); }
      else if (d.s3 === 'export') exportVideo();
      else if (d.s3 === 'speed') { state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 0.5 : 1; t.textContent = `${state.speed}×`; }
      else if (d.s3Mode) { state.mode = d.s3Mode; rebuild(); }
      else if (d.s3Result) { state.result = d.s3Result; rebuild(); }
      else if (d.s3Type) { state.type = d.s3Type; rebuild(); }
      else if (d.s3Cam) setCam(d.s3Cam);
    });
    // A game exports its postgame video; a player (or the batter picked here) exports his history.
    async function exportVideo() {
      const gv = window.gameVideo;
      if (scope.gameId) {
        const result = await gv.gameVideoFor(scope.gameId);
        if (result) gv.showResult(result, scope.title.replace('3D 擊球重播', '賽後影片'));
        return;
      }
      const player = state.batter !== 'all' ? state.batter : scope.player;
      if (!player || player === 'all') { if (typeof showToast === 'function') showToast('請先選一位打者再匯出影片'); return; }
      state.playing = false; syncPlay();
      const result = await gv.withProgress(`正在製作 ${player} 的擊球回顧影片…`, opts => gv.makePlayerVideo(player, opts));
      if (result) gv.showResult(result, `${player} 擊球回顧`);
    }
    modal.querySelector('[data-s3="batter"]')?.addEventListener('change', e => { state.batter = e.target.value; rebuild(); });

    let last = performance.now(), hudShown = null;
    const drift = reduceMotion() ? 0 : 1;
    function frame(now) {
      if (!viewer || viewer.modal !== modal) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (state.playing && !document.hidden) {
        state.time = Math.min(state.length, state.time + dt * state.speed * PACE);
        if (state.time >= state.length) { state.playing = false; syncPlay(); }
      }
      idle += dt;
      // The automatic camera directs every shot; a fixed angle only drifts a little. Dragging takes over for a few seconds.
      if (!drag && idle > 3) {
        if (state.cam === 'auto' && drift) glide(eng.view, shot(state, portrait()), dt);
        else if (drift) { const base = CAMERAS[state.cam]; eng.view.az += ((base.az + Math.sin(now / 5200) * 7) - eng.view.az) * Math.min(1, dt * 0.8); }
      }
      const ctx = canvas.getContext('2d'), k = canvas.width / Math.max(1, stage.clientWidth);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const shown = eng.draw(state, canvas.width, canvas.height, {scale: k});
      // Rebuilt only when its text changes: replacing the same markup every frame cost a style and layout pass each time.
      const text = hudText(state, shown);
      if (text !== hudShown) { hud.innerHTML = text; hudShown = text; }
      viewer.raf = requestAnimationFrame(frame);
    }
    setCam(drift ? 'auto' : 'home');
    idle = 3;
    viewer.raf = requestAnimationFrame(frame);
    modal.querySelector('[data-s3="close"]').focus();
    return viewer;
  }

  function hudText(state, shown) {
    if (!state.plays.length) return '';
    if (state.mode === 'all') {
      const hits = state.plays.filter(p => isHit(p.pa.result)).length;
      return `<span class="s3-tag">${state.plays.length} 球</span> <span class="s3-tag">安打 ${hits}</span>`;
    }
    const play = shown.play, p = play && play.pa;
    if (!p) return '';
    const s = situation(play, shown.t);
    const where = state.single ? '' : `${p.gameDate ? p.gameDate.slice(5) : ''} vs ${escape(p.opponent || '')}`;
    const dots = [0, 1, 2].map(i => `<i class="s3-out${i < s.outs ? ' s3-out-on' : ''}"></i>`).join('');
    const color = colorOf(p.result);
    return `<div class="flex items-center justify-between gap-2">
        <span class="s3-tag">${s.inning}${where ? ` · ${where}` : ''}</span>
        <span class="s3-tag">${dots}<span class="ml-1">${s.outs} 出局</span></span>
      </div>
      <div class="mt-1 flex items-center justify-between gap-2">
        <span class="s3-tag" style="border-color:${color}">${escape(p.batterName)} · ${escape(s.hit)}${s.decided ? ` · <b style="color:${color}">${escape(s.result)}</b>` : ''}</span>
        <span class="s3-tag">${shown.index + 1} / ${state.plays.length}</span>
      </div>`;
  }
  const PLACE = {LF: '左外野', SF: '左中外野', RC: '右中外野', RF: '右外野', '1B': '一壘', '2B': '二壘', '3B': '三壘', SS: '游擊', P: '投手', C: '捕手'};
  // What the top bar says at time t of a play: inning, outs (before the play until it is decided), and how it was hit.
  function situation(play, t) {
    const p = play.pa, decided = t > play.decided;
    const after = Number.isFinite(p.outsAtEnd) ? p.outsAtEnd : null;
    const before = after == null ? null : Math.max(0, after - (Number(p.outsAdded) || 0));
    const outs = Math.min(3, (decided ? after : before) ?? 0);
    const hit = p.trajectory && p.trajectory !== 'none'
      ? `${TRAJ[p.trajectory] || ''}${PLACE[p.location] ? `・${PLACE[p.location]}方向` : ''}`
      : p.result === 'BB' ? '選到保送' : ['K', '界外K', 'K_FOUL'].includes(p.result) ? '未擊出' : '打擊';
    return {inning: p.inningNum ? `第 ${p.inningNum} 局` : '', outs, hit, result: LABEL[p.result] || p.result, decided};
  }
  function escape(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch])); }

  // ---------- Entry points next to the spray charts ----------
  function addButton(svgId, scopeOf) {
    const svg = document.getElementById(svgId);
    const box = svg && svg.parentElement;
    if (!box || box.querySelector('[data-spray3d]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.spray3d = svgId;
    button.className = 's3-launch';
    button.textContent = '▶ 3D 動畫';
    button.addEventListener('click', () => open(scopeOf()));
    box.appendChild(button);
  }
  const resultOf = value => (['hits', 'extra', 'outs'].includes(value) ? value : 'all');
  function install() {
    addButton('profileSprayChartSvg', () => ({title: `${selectedPlayerName} 3D 擊球落點`, player: selectedPlayerName}));
    addButton('teamSpatialSvg', () => {
      const player = document.getElementById('teamSprayPlayerFilter')?.value || 'all';
      return {title: player === 'all' ? '全隊 3D 擊球落點' : `${player} 3D 擊球落點`, player, result: resultOf(document.getElementById('teamSprayTypeFilter')?.value)};
    });
    addButton('sprayChartSvg', () => ({title: selectedSprayPlayer === 'all' ? '全隊 3D 擊球落點' : `${selectedSprayPlayer} 3D 擊球落點`,
      player: selectedSprayPlayer, result: resultOf(typeof currentSprayFilter !== 'undefined' ? currentSprayFilter : 'all')}));
  }
  // The game review gets a replay of every plate appearance, in order.
  function addReplayButton(gameId) {
    const group = document.querySelector('#reviewGameSummaryBadge > div');
    if (!group || (typeof isEditingReviewGame !== 'undefined' && isEditingReviewGame) || group.querySelector('[data-spray3d-game]')) return;
    const game = (typeof allGames !== 'undefined' ? allGames : []).find(g => g.id === gameId);
    if (!game) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.spray3dGame = gameId;
    button.className = 'bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-600/70 text-emerald-300 text-xs px-3 py-1 rounded-lg transition font-bold';
    button.textContent = '🎬 3D 擊球重播';
    button.addEventListener('click', () => open({title: `${game.date} vs ${game.opponent || '對手'} 3D 擊球重播`, gameId}));
    group.appendChild(button);
  }

  if (window.siteHooks) {
    window.siteHooks.after('renderSelectedGameReview', 'spray3d', addReplayButton);
    window.siteHooks.after('renderAll', 'spray3d', install);
  }
  try {
    install();
    if (typeof selectedReviewGameId !== 'undefined' && selectedReviewGameId) addReplayButton(selectedReviewGameId);
  } catch (error) { console.error('[spray3d] init', error); }

  window.spray3d = {collectPlays, planPlay, plan, locate, shot, glide, sequenceLength, allLength, engine, open, close, state: () => viewer && viewer.state, viewer: () => viewer, situation, LABEL, TRAJ, COLOR, fenceDistance, toWorld};
})();
