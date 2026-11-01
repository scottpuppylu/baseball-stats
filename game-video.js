/* Postgame and player-history videos for Instagram stories (1080×1920, 30 fps), drawn in code and encoded in the
   browser. A game video opens with a title, plays every plate appearance inning by inning on the 3D field (spray3d.js)
   with the inning, outs, batter and how the ball was hit across the bottom, and ends with the postgame card animating
   in (team-insights.js). Its length follows the number of plate appearances. Encoding uses WebCodecs (H.264) and a small
   MP4 writer; where that is missing it records the canvas in real time instead. Nothing is uploaded or saved anywhere. */
(function() {
  'use strict';

  const W = 1080, H = 1920, FPS = 30;
  const SAFE = {top: 160, bottom: 1730};
  const SANS = '"Serif Flight","PingFang TC","TK Gothic","Noto Sans TC","Microsoft JhengHei",sans-serif';
  const MINCHO = '"TK Mincho","Noto Serif TC","Songti TC",serif';
  const TEAM = '淡江航太系壘';
  const INK = '#f3f5f8', SOFT = '#d6dce4', MUTED = '#a3adbb', DIM = '#7c8796', LINE = 'rgba(255,255,255,0.16)';
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = u => 1 - Math.pow(1 - clamp(u), 3);
  const tagLabel = tag => String(tag || '').replace(/^場記賽事:\s*/, '') || '';

  // ---------- MP4 writer (one H.264 track, constant frame rate, index at the front) ----------
  const enc = new TextEncoder();
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function cat(parts) {
    const len = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const bytes = arr => (arr instanceof Uint8Array ? arr : new Uint8Array(arr));
  function box(type, ...payload) {
    const body = cat(payload.map(bytes));
    return cat([new Uint8Array(u32(body.length + 8)), enc.encode(type), body]);
  }
  const full = (type, version, flags, ...payload) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...payload);
  const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);
  function muxMp4({width, height, fps, samples, avcC}) {
    const timescale = fps * 1000, delta = 1000, n = samples.length, duration = n * delta;
    // Presentation offsets, in case the encoder reordered frames (B-frames).
    const offsets = samples.map((smp, i) => Math.round(smp.ts * timescale / 1e6) - i * delta);
    const reordered = offsets.some(o => o !== 0);
    const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2avc1mp41'));
    const stbl = offset => box('stbl',
      full('stsd', 0, 0, u32(1), box('avc1', new Array(6).fill(0), u16(1), new Array(16).fill(0), u16(width), u16(height),
        u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff), box('avcC', avcC))),
      full('stts', 0, 0, u32(1), u32(n), u32(delta)),
      ...(reordered ? [full('ctts', 1, 0, u32(n), ...offsets.map(o => [...u32(1), ...u32(o >>> 0)]))] : []),
      full('stss', 0, 0, u32(samples.filter(s => s.key).length), ...samples.map((s, i) => (s.key ? u32(i + 1) : [])).filter(a => a.length)),
      full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
      full('stsz', 0, 0, u32(0), u32(n), ...samples.map(s => u32(s.data.length))),
      full('stco', 0, 0, u32(1), u32(offset)));
    const moov = offset => box('moov',
      full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(Math.round(n * 1000 / fps)), u32(0x00010000), u16(0x0100), new Array(10).fill(0), MATRIX, new Array(24).fill(0), u32(2)),
      box('trak',
        full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(Math.round(n * 1000 / fps)), new Array(8).fill(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
        box('mdia',
          full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)),
          full('hdlr', 0, 0, u32(0), enc.encode('vide'), new Array(12).fill(0), enc.encode('VideoHandler\0')),
          box('minf', full('vmhd', 0, 1, new Array(8).fill(0)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl(offset)))));
    const size = moov(0).length;
    const data = cat(samples.map(s => s.data));
    const mdat = cat([new Uint8Array(u32(data.length + 8)), enc.encode('mdat'), data]);
    return new Blob([ftyp, moov(ftyp.length + size + 8), mdat], {type: 'video/mp4'});
  }

  // ---------- Encoding ----------
  const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032', 'avc1.42e032'];
  async function pickConfig() {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    for (const codec of CODECS) {
      const config = {codec, width: W, height: H, bitrate: 3_200_000, framerate: FPS, latencyMode: 'quality', avc: {format: 'avc'}};
      try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch (error) { /* try the next */ }
    }
    return null;
  }
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  // draw(ctx, t) paints frame t (seconds) on a 1080×1920 canvas.
  async function encode({duration, draw, onProgress, signal}) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const frames = Math.max(1, Math.round(duration * FPS));
    const config = await pickConfig();
    if (!config) return record({canvas, ctx, frames, draw, onProgress, signal});
    const samples = [];
    let avcC = null, failure = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !avcC) {
          const d = meta.decoderConfig.description;
          avcC = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d);
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({data, key: chunk.type === 'key', ts: chunk.timestamp});
      },
      error: error => { failure = error; }
    });
    encoder.configure(config);
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) { encoder.close(); throw new DOMException('cancelled', 'AbortError'); }
      if (failure) throw failure;
      draw(ctx, i / FPS);
      const frame = new VideoFrame(canvas, {timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS)});
      encoder.encode(frame, {keyFrame: i % (FPS * 2) === 0});
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise(resolve => setTimeout(resolve, 4));
      if (i % 6 === 0) { onProgress && onProgress(i / frames); await tick(); }
    }
    await encoder.flush();
    encoder.close();
    if (failure) throw failure;
    if (!avcC) throw new Error('no decoder configuration');
    onProgress && onProgress(1);
    return {blob: muxMp4({width: W, height: H, fps: FPS, samples, avcC}), ext: 'mp4'};
  }
  // Fallback: record the canvas while frames are drawn on time (takes as long as the video).
  async function record({canvas, ctx, frames, draw, onProgress, signal}) {
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('此瀏覽器無法產生影片');
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error('此瀏覽器無法產生影片');
    const stream = canvas.captureStream(FPS), chunks = [];
    const recorder = new MediaRecorder(stream, {mimeType: type, videoBitsPerSecond: 3_200_000});
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(resolve => { recorder.onstop = resolve; });
    draw(ctx, 0);
    recorder.start(250);
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) { recorder.stop(); throw new DOMException('cancelled', 'AbortError'); }
      const wait = start + i * 1000 / FPS - performance.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      draw(ctx, i / FPS);
      if (i % 6 === 0) onProgress && onProgress(i / frames);
    }
    recorder.stop();
    await done;
    return {blob: new Blob(chunks, {type: type.split(';')[0]}), ext: type.includes('mp4') ? 'mp4' : 'webm'};
  }

  // ---------- Shared drawing ----------
  const images = {};
  function loadImage(src) {
    if (!images[src]) {
      const img = new Image();
      images[src] = {img, ready: new Promise(resolve => { img.onload = img.onerror = resolve; img.src = src; })};
    }
    return images[src];
  }
  const ok = img => img && img.complete && img.naturalWidth > 0;
  function makeBackground() {
    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    const c = bg.getContext('2d');
    c.fillStyle = '#05070b'; c.fillRect(0, 0, W, H);
    const scene = loadImage('assets/bg-orbit-portrait.webp').img;
    if (ok(scene)) {
      const s = Math.max(W / scene.naturalWidth, H / scene.naturalHeight);
      c.drawImage(scene, (W - scene.naturalWidth * s) / 2, H - scene.naturalHeight * s, scene.naturalWidth * s, scene.naturalHeight * s);
    }
    const veil = c.createLinearGradient(0, 0, 0, H);
    veil.addColorStop(0, 'rgba(4,6,10,0.55)'); veil.addColorStop(0.5, 'rgba(4,6,10,0.68)'); veil.addColorStop(1, 'rgba(4,6,10,0.4)');
    c.fillStyle = veil; c.fillRect(0, 0, W, H);
    return bg;
  }
  function painter(c) {
    const text = (str, x, y, size, color, align = 'left', weight = 700, family = SANS) => {
      c.font = `${weight} ${size}px ${family}`; c.fillStyle = color; c.textAlign = align; c.fillText(String(str), x, y);
    };
    const title = (str, x, y, size, color = INK, align = 'left') => text(str, x, y, size, color, align, 900, MINCHO);
    const round = (x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
    const panel = (x, y, w, h, r = 28) => {
      round(x, y, w, h, r);
      c.fillStyle = 'rgba(8,10,15,0.5)'; c.fill();
      const sheen = c.createLinearGradient(0, y, 0, y + h);
      sheen.addColorStop(0, 'rgba(255,255,255,0.09)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.02)'); sheen.addColorStop(1, 'rgba(255,255,255,0.04)');
      c.fillStyle = sheen; c.fill(); c.lineWidth = 1.5; c.strokeStyle = LINE; c.stroke();
    };
    const pill = (str, x, y, size, color, align = 'left') => {
      c.font = `700 ${size}px ${SANS}`;
      const w = c.measureText(str).width + size * 1.4, h = size * 1.75, x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      round(x0, y - h * 0.72, w, h, h / 2); c.fillStyle = color + '2a'; c.fill(); c.lineWidth = 2; c.strokeStyle = color + 'cc'; c.stroke();
      text(str, x0 + w / 2, y + size * 0.1, size, color, 'center', 700);
      return w;
    };
    return {text, title, round, panel, pill};
  }

  // The 3D stage: a square scene from spray3d with its own camera, shown inside a rounded frame.
  const STAGE = {x: 40, y: 344, w: 1000, h: 1000};
  function makeStage() {
    const canvas = document.createElement('canvas');
    canvas.width = STAGE.w; canvas.height = STAGE.h;
    const engine = window.spray3d.engine(canvas);
    return {canvas, engine, ctx: canvas.getContext('2d')};
  }
  function drawStage(c, stage) {
    c.save();
    c.beginPath(); c.roundRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 30); c.clip();
    c.drawImage(stage.canvas, STAGE.x, STAGE.y);
    c.restore();
    c.beginPath(); c.roundRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 30); c.lineWidth = 1.5; c.strokeStyle = LINE; c.stroke();
  }
  const K = 2.3; // line and label scale inside the 1000 px stage
  // A dark veil over the stage with centred content (titles over the field).
  function overlayStage(c, alpha, lines) {
    if (alpha <= 0) return;
    c.save(); c.globalAlpha = alpha;
    c.beginPath(); c.roundRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 30);
    const g = c.createLinearGradient(0, STAGE.y, 0, STAGE.y + STAGE.h);
    g.addColorStop(0, 'rgba(4,6,10,0.25)'); g.addColorStop(0.5, 'rgba(4,6,10,0.72)'); g.addColorStop(1, 'rgba(4,6,10,0.25)');
    c.fillStyle = g; c.fill();
    lines(STAGE.y + STAGE.h / 2);
    c.restore();
  }
  function renderScene(stage, state, dt, director = true) {
    if (director) window.spray3d.glide(stage.engine.view, window.spray3d.shot(state, false), dt);
    return stage.engine.draw(state, STAGE.w, STAGE.h, {scale: K, pad: {l: 30, r: 30, t: 60, b: 30}});
  }

  // ---------- Game video ----------
  function inningOrder(game) {
    const half = inn => (inn.topBottom === 'top' ? 0 : 1);
    return (game.innings || []).slice().sort((a, b) => a.inningNum - b.inningNum || half(a) - half(b));
  }
  function gamePlan(game) {
    const all = window.spray3d.collectPlays({gameId: game.id});
    const ourBat = inn => (typeof isInningOurBat === 'function' ? isInningOurBat(game.ourRole, inn.topBottom) : (inn.plateAppearances || []).length > 0);
    const order = inningOrder(game);
    const scored = typeof isGameScoreRecorded === 'function' ? isGameScoreRecorded(game) : true;
    let us = 0, opp = 0;
    const innings = [];
    for (const inn of order) {
      if (ourBat(inn)) {
        const plays = window.spray3d.plan(all.filter(p => p.inningNum === inn.inningNum));
        if (plays.length) {
          const hits = plays.filter(p => p.pa.result in {'1H': 1, '2H': 1, '3H': 1, HR: 1}).length;
          innings.push({num: inn.inningNum, plays, before: {us, opp}, runs: inn.runs || 0, hits});
        }
        us += inn.runs || 0;
      } else opp += inn.runs || 0;
    }
    return {innings, scored, total: all.length};
  }
  // The opening with the badge plays at 1.2× (2.4 s → 2 s); plays at PLAY_SPEED. HOLD_T: the finished postgame card stays still.
  const TITLE_T = 0.8, END_T = 0.75, INTRO_T = 2.0, HOLD_T = 10;
  const PLAY_SPEED = 1.75; // plays always run at 1.75× (the same pace as the 3D viewer), whatever the length

  async function prepareAssets(game) {
    const logo = loadImage('assets/logo-256.webp'), scene = loadImage('assets/bg-orbit-portrait.webp');
    const fonts = document.fonts ? Promise.all(['900 40px "TK Mincho"', '600 24px "Serif Flight"', '700 24px "TK Gothic"'].map(f => document.fonts.load(f, '淡江航太系壘第局出局安打0123456789').catch(() => {}))) : Promise.resolve();
    await Promise.race([Promise.all([logo.ready, scene.ready, fonts]), new Promise(resolve => setTimeout(resolve, 2500))]);
    let mvpPhoto = null;
    if (game && window.teamInsights) {
      const s = teamInsights.gameSummary(game), m = teamInsights.gameMvp(game, s.rows);
      const data = m && typeof playerAvatars !== 'undefined' ? playerAvatars[m.name] : null;
      if (data) { mvpPhoto = new Image(); mvpPhoto.src = data; await Promise.race([mvpPhoto.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]); }
    }
    return {logo: logo.img, mvpPhoto};
  }

  function buildGameVideo(game, assets) {
    const plan = gamePlan(game);
    const speed = PLAY_SPEED;
    const segments = [{type: 'intro', len: INTRO_T}];
    for (const inn of plan.innings) segments.push({type: 'inning', inn, len: TITLE_T + inn.plays.reduce((a, p) => a + p.length, 0) / speed + END_T});
    const card = document.createElement('canvas');
    window.teamInsights.drawGameImage(game, {mvpPhoto: assets.mvpPhoto, canvas: card, reveal: 0});
    const outroLen = (card.revealEnd || 5) + HOLD_T;
    segments.push({type: 'outro', len: outroLen});
    let at = 0;
    for (const s of segments) { s.start = at; at += s.len; }
    const duration = at;
    const bg = makeBackground(), stage = makeStage(), p0 = {last: -1};
    const ourName = TEAM.replace('系壘', ''), oppName = game.opponent || '對手';
    const score = game.finalScore || {us: 0, opp: 0};

    function header(c, P, s) {
      P.panel(40, 172, 1000, 150, 30);
      if (ok(assets.logo)) c.drawImage(assets.logo, 68, 192, 110, 110);
      const tx = ok(assets.logo) ? 196 : 72;
      P.title(`${ourName} vs ${oppName.length > 7 ? oppName.slice(0, 7) + '…' : oppName}`, tx, 240, 40);
      P.text([game.date, tagLabel(game.tag)].filter(Boolean).join(' · '), tx, 286, 24, MUTED, 'left', 600);
      // The score as it stood when this inning began (or the final score in the ending).
      if (plan.scored && s) {
        P.text('比分', 1010, 214, 20, DIM, 'right', 600);
        P.text(`${s.us} : ${s.opp}`, 1010, 290, 64, INK, 'right', 600);
      }
    }
    function bottomBar(c, P, inn, shown, idx) {
      P.panel(40, 1366, 1000, 340, 30);
      if (!shown || !shown.play) return;
      const play = shown.play, sit = window.spray3d.situation(play, shown.t), pa = play.pa;
      P.title(`第 ${inn.num} 局`, 76, 1432, 44);
      // Outs as three dots.
      for (let i = 0; i < 3; i++) {
        c.beginPath(); c.arc(860 + i * 44, 1418, 15, 0, Math.PI * 2);
        if (i < sit.outs) { c.fillStyle = '#f43f5e'; c.fill(); } else { c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.5)'; c.stroke(); }
      }
      P.text(`${sit.outs} 出局`, 1004, 1474, 22, MUTED, 'right', 600);
      // Batter with his slot.
      c.beginPath(); c.arc(104, 1530, 30, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.1)'; c.fill(); c.lineWidth = 2; c.strokeStyle = LINE; c.stroke();
      P.text(pa.slot && pa.slot < 90 ? pa.slot : '替', 104, 1541, 28, '#ffa3b1', 'center', 700);
      P.title(pa.batterName, 154, 1552, 60);
      P.text(sit.hit, 76, 1622, 30, SOFT, 'left', 600);
      if (sit.decided) {
        const color = window.spray3d.COLOR[pa.result] || window.spray3d.COLOR.out;
        const u = ease((shown.t - play.decided) / 0.3);
        c.save(); c.globalAlpha = u; P.pill(sit.result, 76, 1682, 30, color); c.restore();
      }
      P.text(`第 ${idx} / ${plan.total} 打席`, 1004, 1682, 22, DIM, 'right', 600);
    }
    function overlay(c, P, alpha, lines) {
      if (alpha <= 0) return;
      c.save(); c.globalAlpha = alpha;
      c.beginPath(); c.roundRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 30);
      const g = c.createLinearGradient(0, STAGE.y, 0, STAGE.y + STAGE.h);
      g.addColorStop(0, 'rgba(4,6,10,0.25)'); g.addColorStop(0.5, 'rgba(4,6,10,0.72)'); g.addColorStop(1, 'rgba(4,6,10,0.25)');
      c.fillStyle = g; c.fill();
      const cy = STAGE.y + STAGE.h / 2;
      lines(cy);
      c.restore();
    }

    let prevT = 0;
    function draw(c, t) {
      const dt = Math.max(1 / FPS, Math.min(0.2, t - prevT)); prevT = t;
      const P = painter(c);
      const seg = segments.find(s => t < s.start + s.len) || segments[segments.length - 1];
      const u = t - seg.start;
      c.drawImage(bg, 0, 0);
      if (seg.type === 'outro') {
        window.teamInsights.drawGameImage(game, {mvpPhoto: assets.mvpPhoto, canvas: card, reveal: u});
        c.drawImage(card, 0, 0);
        // Cross-fade from the last inning.
        if (u < 0.45) { c.save(); c.globalAlpha = 1 - u / 0.45; c.fillStyle = '#05070b'; c.fillRect(0, 0, W, H); c.restore(); }
        return;
      }
      if (seg.type === 'intro') {
        renderScene(stage, {plays: [], mode: 'all', time: u}, dt);
        header(c, P, plan.scored ? {us: 0, opp: 0} : null);
        drawStage(c, stage);
        P.panel(40, 1366, 1000, 340, 30);
        const a = ease(u / 0.5); // the badge settles at the opening's 1.2× pace
        overlay(c, P, Math.min(1, u / 0.3) * (1 - clamp((u - INTRO_T + 0.4) / 0.4)), cy => {
          if (ok(assets.logo)) { const s = 180 * (0.85 + 0.15 * a); c.drawImage(assets.logo, W / 2 - s / 2, cy - 230, s, s); }
          P.title('賽後重播', W / 2, cy + 40, 72, INK, 'center');
          c.save(); c.font = `600 22px ${SANS}`; c.letterSpacing = '8px'; c.fillStyle = MUTED; c.textAlign = 'center'; c.fillText('GAME REPLAY', W / 2, cy + 92); c.restore();
        });
        c.save(); c.globalAlpha = a;
        P.title(`${ourName}  vs  ${oppName}`, W / 2, 1500, 52, INK, 'center');
        P.text([game.date, tagLabel(game.tag), `${plan.total} 個打席`].filter(Boolean).join(' · '), W / 2, 1570, 26, MUTED, 'center', 600);
        c.restore();
        return;
      }
      // An inning: its title, each plate appearance, then how the inning went.
      const inn = seg.inn;
      const playLen = seg.len - TITLE_T - END_T;
      const local = clamp(u - TITLE_T, 0, playLen) * (inn.plays.reduce((a, p) => a + p.length, 0) / Math.max(0.001, playLen));
      const state = {plays: inn.plays, mode: 'seq', time: local};
      const shown = renderScene(stage, state, dt, true);
      header(c, P, plan.scored ? inn.before : null);
      drawStage(c, stage);
      const index = segments.filter(s => s.type === 'inning' && s.start < seg.start).reduce((a, s) => a + s.inn.plays.length, 0) + (shown.index >= 0 ? shown.index + 1 : 1);
      bottomBar(c, P, inn, u >= TITLE_T ? shown : null, index);
      if (u < TITLE_T) {
        P.title(`第 ${inn.num} 局`, 76, 1432, 44);
        P.text('本隊進攻', 76, 1500, 30, MUTED, 'left', 600);
      }
      const titleA = u < TITLE_T ? Math.min(1, u / 0.25) * (1 - clamp((u - TITLE_T + 0.3) / 0.3)) : 0;
      overlay(c, P, titleA, cy => {
        P.title(`第 ${inn.num} 局`, W / 2, cy + 20, 110, INK, 'center');
        P.text(plan.scored ? `本隊進攻 · 比分 ${inn.before.us} : ${inn.before.opp}` : '本隊進攻', W / 2, cy + 90, 32, SOFT, 'center', 600);
      });
      const endU = u - (seg.len - END_T);
      if (endU > 0) {
        const a = Math.min(1, endU / 0.25) * (1 - clamp((endU - END_T + 0.25) / 0.25));
        overlay(c, P, a, cy => {
          P.title(`第 ${inn.num} 局結束`, W / 2, cy, 72, INK, 'center');
          P.text(`${inn.hits} 安打${plan.scored ? ` · 得 ${inn.runs} 分` : ''}`, W / 2, cy + 70, 34, SOFT, 'center', 600);
        });
      }
    }
    return {duration, draw, speed, segments: segments.map(s => ({type: s.type, len: s.len}))};
  }

  // ---------- Player history video ----------
  function buildPlayerVideo(player, assets) {
    const all = window.spray3d.collectPlays({player, all: true}); // every plate appearance, strikeouts and walks too
    const balls = all.filter(p => p.trajectory && p.trajectory !== 'none');
    const byGame = [];
    for (const p of all) {
      let g = byGame[byGame.length - 1];
      if (!g || g.gameId !== p.gameId) { g = {gameId: p.gameId, date: p.gameDate, opponent: p.opponent, plays: []}; byGame.push(g); }
      g.plays.push(p);
    }
    byGame.forEach(g => { g.plays = window.spray3d.plan(g.plays); });
    const speed = PLAY_SPEED;
    const segments = [{type: 'intro', len: INTRO_T}];
    for (const g of byGame) segments.push({type: 'game', g, len: 1.2 + g.plays.reduce((a, p) => a + p.length, 0) / speed});
    segments.push({type: 'summary', len: 7});
    let at = 0;
    for (const s of segments) { s.start = at; at += s.len; }
    const bg = makeBackground(), stage = makeStage();
    const photoSrc = typeof playerAvatars !== 'undefined' ? playerAvatars[player] : null;
    const photo = photoSrc ? Object.assign(new Image(), {src: photoSrc}) : null;
    const jersey = typeof NAME_TO_JERSEY !== 'undefined' && NAME_TO_JERSEY[player] !== undefined ? `#${NAME_TO_JERSEY[player]}` : '';
    const hits = all.filter(p => ['1H', '2H', '3H', 'HR'].includes(p.result)).length;
    const xbh = all.filter(p => ['2H', '3H', 'HR'].includes(p.result)).length;
    const counts = ['line', 'grounder', 'fly', 'popup'].map(k => [k, balls.filter(p => p.trajectory === k).length]);
    const strikeouts = all.filter(p => ['K', '界外K', 'K_FOUL'].includes(p.result)).length, walks = all.filter(p => p.result === 'BB').length;
    const planned = window.spray3d.plan(balls);

    function head(c, P) {
      P.panel(40, 172, 1000, 150, 30);
      c.save(); c.beginPath(); c.arc(130, 247, 56, 0, Math.PI * 2); c.clip();
      if (ok(photo)) { const s = Math.max(112 / photo.naturalWidth, 112 / photo.naturalHeight); c.drawImage(photo, 130 - photo.naturalWidth * s / 2, 247 - photo.naturalHeight * s / 2, photo.naturalWidth * s, photo.naturalHeight * s); }
      else { c.fillStyle = '#1f2a3d'; c.fillRect(74, 191, 112, 112); P.title(player.slice(0, 1), 130, 268, 54, INK, 'center'); }
      c.restore();
      P.title(player, 210, 244, 50);
      P.text([jersey, '擊球落點紀錄'].filter(Boolean).join(' · '), 210, 292, 24, MUTED, 'left', 600);
      P.text(`${all.length} 打席 · ${hits} 安打`, 1010, 268, 30, SOFT, 'right', 600);
    }
    let prevT = 0;
    function draw(c, t) {
      const dt = Math.max(1 / FPS, Math.min(0.2, t - prevT)); prevT = t;
      const P = painter(c);
      const seg = segments.find(s => t < s.start + s.len) || segments[segments.length - 1];
      const u = t - seg.start;
      c.drawImage(bg, 0, 0);
      head(c, P);
      if (seg.type === 'intro') {
        renderScene(stage, {plays: [], mode: 'all', time: u}, dt);
        drawStage(c, stage);
        P.panel(40, 1366, 1000, 340, 30);
        // The team badge and the title over the field, as in the game video's opening.
        const a = ease(u / 0.5); // the badge settles at the opening's 1.2× pace
        overlayStage(c, Math.min(1, u / 0.3) * (1 - clamp((u - INTRO_T + 0.4) / 0.4)), cy => {
          if (ok(assets.logo)) { const s = 180 * (0.85 + 0.15 * a); c.drawImage(assets.logo, W / 2 - s / 2, cy - 230, s, s); }
          P.title('個人擊球回顧', W / 2, cy + 40, 72, INK, 'center');
          c.save(); c.font = `600 22px ${SANS}`; c.letterSpacing = '8px'; c.fillStyle = MUTED; c.textAlign = 'center'; c.fillText('PLAYER REPLAY', W / 2, cy + 92); c.restore();
        });
        c.save(); c.globalAlpha = a;
        P.title(player, W / 2, 1500, 56, INK, 'center');
        P.text(`${byGame.length} 場比賽 · ${all.length} 個打席 · ${balls.length} 顆擊球`, W / 2, 1570, 28, MUTED, 'center', 600);
        c.restore();
        return;
      }
      if (seg.type === 'game') {
        const playLen = seg.len - 1.2;
        const local = clamp(u - 1.2, 0, playLen) * (seg.g.plays.reduce((a, p) => a + p.length, 0) / Math.max(0.001, playLen));
        const shown = renderScene(stage, {plays: seg.g.plays, mode: 'seq', time: local, single: true}, dt);
        drawStage(c, stage);
        P.panel(40, 1366, 1000, 340, 30);
        P.title(`${(seg.g.date || '').slice(5).replace('-', '/')} vs ${seg.g.opponent || '對手'}`, 76, 1432, 40);
        if (u >= 1.2 && shown.play) {
          const sit = window.spray3d.situation(shown.play, shown.t), pa = shown.play.pa;
          P.text(sit.inning, 1004, 1432, 26, MUTED, 'right', 600);
          P.text(sit.hit, 76, 1530, 34, SOFT, 'left', 600);
          if (sit.decided) P.pill(sit.result, 76, 1620, 32, window.spray3d.COLOR[pa.result] || window.spray3d.COLOR.out);
          P.text(`第 ${shown.index + 1} / ${seg.g.plays.length} 打席`, 1004, 1620, 22, DIM, 'right', 600);
        }
        return;
      }
      // Summary: every ball at once, the camera sweeping, and the totals.
      renderScene(stage, {plays: planned, mode: 'all', time: u * 1.2}, dt);
      drawStage(c, stage);
      P.panel(40, 1366, 1000, 340, 30);
      const a = ease(u / 0.6);
      c.save(); c.globalAlpha = a;
      const tiles = [['打席', all.length, INK], ['安打', hits, '#22c55e'], ['長打', xbh, '#f3c766']];
      tiles.forEach(([label, v, color], i) => { const x = W / 2 + (i - 1) * 280; P.text(v, x, 1490, 76, color, 'center', 600); P.text(label, x, 1536, 24, MUTED, 'center', 600); });
      P.text([...counts.filter(([, n]) => n).map(([k, n]) => `${window.spray3d.TRAJ[k]} ${n}`), strikeouts ? `三振 ${strikeouts}` : '', walks ? `保送 ${walks}` : ''].filter(Boolean).join(' · '), W / 2, 1640, 28, SOFT, 'center', 600);
      c.restore();
    }
    return {duration: at, draw, speed, segments: segments.map(s => ({type: s.type, len: s.len}))};
  }

  // ---------- Public ----------
  async function makeGameVideo(gameId, opts = {}) {
    const game = (typeof allGames !== 'undefined' ? allGames : []).find(g => g.id === gameId);
    if (!game) throw new Error('找不到這場比賽');
    const assets = await prepareAssets(game);
    const video = buildGameVideo(game, assets);
    const out = await encode({duration: video.duration, draw: video.draw, onProgress: opts.onProgress, signal: opts.signal});
    return {...out, duration: video.duration, filename: `${TEAM}_${game.date}_vs_${game.opponent || '對手'}_賽後影片.${out.ext}`.replace(/[\\/:*?"<>|\s]+/g, '_')};
  }
  async function makePlayerVideo(player, opts = {}) {
    const assets = await prepareAssets(null);
    const video = buildPlayerVideo(player, assets);
    const out = await encode({duration: video.duration, draw: video.draw, onProgress: opts.onProgress, signal: opts.signal});
    return {...out, duration: video.duration, filename: `${TEAM}_${player}_擊球回顧.${out.ext}`.replace(/[\\/:*?"<>|\s]+/g, '_')};
  }

  // A small progress sheet over whatever is open; resolves with the result or null when cancelled.
  async function withProgress(label, run) {
    const sheet = document.createElement('div');
    sheet.className = 'fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-6';
    sheet.innerHTML = `<div class="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-sm space-y-3">
        <p class="text-sm font-bold text-slate-100">${label}</p>
        <div class="h-2 rounded-full bg-slate-800 overflow-hidden"><div class="gv-bar h-full bg-emerald-400" style="width:0%"></div></div>
        <div class="flex items-center justify-between text-xs text-slate-400"><span class="gv-pct">0%</span><button type="button" class="s3-chip">取消</button></div>
        <p class="text-[11px] text-slate-500">影片在這台裝置上製作，不會上傳；製作期間請保持此頁開啟。</p>
      </div>`;
    document.body.appendChild(sheet);
    const controller = new AbortController();
    sheet.querySelector('button').addEventListener('click', () => controller.abort());
    try {
      return await run({signal: controller.signal, onProgress: p => {
        sheet.querySelector('.gv-bar').style.width = `${Math.round(p * 100)}%`;
        sheet.querySelector('.gv-pct').textContent = `${Math.round(p * 100)}%`;
      }});
    } catch (error) {
      if (error.name !== 'AbortError') { console.error('[game-video]', error); if (typeof showToast === 'function') showToast(`影片製作失敗：${error.message}`, 'error'); }
      return null;
    } finally { sheet.remove(); }
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function share(files, title) {
    if (navigator.canShare && navigator.canShare({files})) {
      try { await navigator.share({files, title}); return true; } catch (error) { return error.name === 'AbortError'; }
    }
    return false;
  }

  // The finished video: play it here, share it (straight to an IG story from the phone's share sheet) or save it.
  function showResult(result, title) {
    const url = URL.createObjectURL(result.blob);
    const sheet = document.createElement('div');
    sheet.id = 'gameVideoResult';
    sheet.className = 'fixed inset-0 z-[90] bg-black/85 flex items-center justify-center p-3';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', title);
    sheet.innerHTML = `<div class="bg-slate-900 border border-slate-700 rounded-2xl p-3 w-full max-w-sm max-h-full flex flex-col gap-3">
        <div class="flex items-center justify-between"><h3 class="text-sm font-black text-sky-200 truncate"></h3><button type="button" data-gv="close" class="text-slate-400 hover:text-white px-2 py-1" aria-label="關閉">✕</button></div>
        <video class="w-full rounded-lg bg-black" style="aspect-ratio:9/16;max-height:62vh" controls playsinline autoplay muted loop></video>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" data-gv="share" class="bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold rounded-lg py-2.5">分享影片</button>
          <button type="button" data-gv="download" class="bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold rounded-lg py-2.5">下載影片</button>
        </div>
        <p class="text-[11px] text-slate-500">IG 限動規格 1080×1920、30fps，長 ${Math.round(result.duration)} 秒；超過 60 秒時 IG 會自動分段。</p>
      </div>`;
    sheet.querySelector('h3').textContent = title;
    sheet.querySelector('video').src = url;
    document.body.appendChild(sheet);
    const close = () => { sheet.remove(); URL.revokeObjectURL(url); };
    sheet.addEventListener('click', async e => {
      const action = e.target.closest('[data-gv]')?.dataset.gv || (e.target === sheet ? 'close' : '');
      if (action === 'close') close();
      if (action === 'download') download(result.blob, result.filename);
      if (action === 'share') {
        const file = new File([result.blob], result.filename, {type: result.blob.type});
        if (!(await share([file], title))) { download(result.blob, result.filename); if (typeof showToast === 'function') showToast('此裝置不支援直接分享，已改為下載影片'); }
      }
    });
    sheet.querySelector('[data-gv="close"]').focus();
    return sheet;
  }
  const videoCache = new Map(); // gameId → result, so 下載 and 分享 reuse one render while the page stays open
  async function gameVideoFor(gameId) {
    const game = (typeof allGames !== 'undefined' ? allGames : []).find(g => g.id === gameId);
    const key = `${gameId}|${JSON.stringify(game && game.innings)}`; // an edited game renders again
    if (videoCache.has(key)) return videoCache.get(key);
    const result = await withProgress('正在製作賽後影片…', opts => makeGameVideo(gameId, opts));
    if (result) videoCache.set(key, result);
    return result;
  }

  window.gameVideo = {makeGameVideo, gameVideoFor, showResult, makePlayerVideo, buildGameVideo, buildPlayerVideo, prepareAssets, encode, muxMp4, withProgress, download, share, W, H, FPS, SAFE};
})();
