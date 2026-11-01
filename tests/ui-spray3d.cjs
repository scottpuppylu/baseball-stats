// 3D batted-ball animation and the postgame video: entry points, a game replay with every plate appearance, the field
// the right way round with the bases on the foul lines, the animated postgame card, and a short video that encodes and
// plays at story size. Isolated preview only.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';

(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.spray3d && window.gameVideo && window.allGames && allGames.length);

    // A 3D button on each spray chart, and the replay button on a game review.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-spray3d]')].map(b => b.dataset.spray3d).sort()),
      ['profileSprayChartSvg', 'sprayChartSvg', 'teamSpatialSvg']);
    const gameId = await page.evaluate(() => { const g = allGames[0]; switchMainTab('tabScorebook'); switchScorebookSubTab('review'); renderSelectedGameReview(g.id); return g.id; });
    await page.locator(`[data-spray3d-game="${gameId}"]`).click();
    await page.waitForSelector('#spray3dModal canvas');
    // The top bar is filled by the first animation frame.
    await page.waitForFunction(() => document.querySelector('#spray3dModal .s3-hud').textContent.trim().length > 0);

    const replay = await page.evaluate(id => {
      const v = spray3d.viewer(), g = allGames.find(x => x.id === id);
      const pas = g.innings.flatMap(i => i.plateAppearances || []).filter(p => !isRunnerOutPlay(p)).length;
      // Screen right is first base: project first base and third base from the standard angle.
      const eng = v.eng;
      Object.assign(eng.view, {az: 0, el: 22, zoom: 1, target: {x: 0, y: 0, z: 128}, follow: 0});
      eng.draw({plays: [], mode: 'all', time: 0}, 1000, 1000, {scale: 1});
      const first = eng.project({x: 72.9, y: 0, z: 91.1}), third = eng.project({x: -72.9, y: 0, z: 91.1});
      return {plays: v.state.plays.length, pas, firstRight: first.x > third.x, hud: document.querySelector('#spray3dModal .s3-hud').textContent.length > 0};
    }, gameId);
    assert.equal(replay.plays, replay.pas, 'the game replay plays every plate appearance');
    assert.ok(replay.firstRight, 'first base is on the right (the field is not mirrored)');
    assert.ok(replay.hud, 'the top bar shows the situation');
    // Strikeouts and walks have no flight; outs end red at first; the situation updates the outs when a play is decided.
    const plays = await page.evaluate(() => {
      const planned = spray3d.plan([{batterName: 'A', result: 'FO', trajectory: 'fly', x: 0.5, y: 0.3, outsAtEnd: 1, outsAdded: 1},
        {batterName: 'B', result: 'BB', trajectory: 'none', outsAtEnd: 1, outsAdded: 0}, {batterName: 'C', result: '2H', trajectory: 'line', x: 0.2, y: 0.35}]);
      const [fo, bb, dbl] = planned;
      return {foBefore: spray3d.situation(fo, 0.1).outs, foAfter: spray3d.situation(fo, fo.decided + 0.1).outs, bbBall: bb.ball, bbBases: bb.bases, dblBases: dbl.bases, foRuns: fo.length > fo.decided};
    });
    assert.deepEqual([plays.foBefore, plays.foAfter], [0, 1], 'outs change when the catch is made');
    assert.equal(plays.bbBall, null);
    assert.deepEqual([plays.bbBases, plays.dblBases], [1, 2]);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#spray3dModal').count(), 0);

    // The bases make a square and first and third sit on the foul lines, in the shared 2D field.
    const onLines = await page.evaluate(() => {
      const pts = document.querySelector('#profileSprayChartSvg polygon').getAttribute('points').split(' ').map(p => p.split(',').map(Number));
      const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const side = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const square = Math.abs(side(pts[0], pts[1]) - side(pts[1], pts[2])) < 0.5 && Math.abs(side(pts[0], pts[2]) - side(pts[1], pts[3])) < 0.5;
      return [Math.abs(cross([200, 370], [395.9, 174.1], pts[1])), Math.abs(cross([200, 370], [4.1, 174.1], pts[3])), square ? 0 : 99].map(v => v / 277);
    });
    assert.ok(onLines.every(d => d < 0.5), `a square diamond with first and third on the foul lines (${onLines})`);

    // The postgame card animates in and ends identical to the still image.
    const card = await page.evaluate(id => {
      const g = allGames.find(x => x.id === id), still = teamInsights.drawGameImage(g);
      const early = teamInsights.drawGameImage(g, {reveal: 0.2}), done = teamInsights.drawGameImage(g, {reveal: 60});
      return {end: still.revealEnd > 2, same: done.toDataURL() === still.toDataURL(), differs: early.toDataURL() !== still.toDataURL()};
    }, gameId);
    assert.deepEqual(card, {end: true, same: true, differs: true});

    // A one-second clip encodes at story size and the browser can play it.
    const clip = await page.evaluate(async () => {
      const r = await gameVideo.encode({duration: 1, draw: (c, t) => { c.fillStyle = `hsl(${t * 200},60%,40%)`; c.fillRect(0, 0, 1080, 1920); }});
      const head = new TextDecoder().decode(new Uint8Array(await r.blob.slice(4, 8).arrayBuffer()));
      const v = document.createElement('video');
      v.muted = true; v.src = URL.createObjectURL(r.blob);
      const meta = await new Promise(resolve => { v.onloadedmetadata = () => resolve({w: v.videoWidth, h: v.videoHeight, d: v.duration}); v.onerror = () => resolve({error: true}); setTimeout(() => resolve({timeout: true}), 8000); });
      return {ext: r.ext, head, ...meta};
    });
    assert.ok(clip.ext === 'webm' || clip.head === 'ftyp', `MP4 starts with ftyp (${JSON.stringify(clip)})`);
    assert.deepEqual([clip.w, clip.h], [1080, 1920], 'story size');
    assert.ok(Math.abs(clip.d - 1) < 0.2 || clip.ext === 'webm', `about one second long (${clip.d})`);
    // The game video's length follows its plate appearances.
    const length = await page.evaluate(async id => {
      const g = allGames.find(x => x.id === id), assets = await gameVideo.prepareAssets(g);
      const full = gameVideo.buildGameVideo(g, assets);
      const short = JSON.parse(JSON.stringify(g)); short.innings = short.innings.slice(0, 2);
      allGames.push(short); short.id = 'short-copy';
      const less = gameVideo.buildGameVideo(short, assets);
      allGames.pop();
      return {full: full.duration, less: less.duration, intro: full.segments[0].type, outro: full.segments.at(-1).type};
    }, gameId);
    assert.ok(length.full > length.less, `more plate appearances, a longer video (${length.full} > ${length.less})`);
    assert.deepEqual([length.intro, length.outro], ['intro', 'outro']);

    // The mound sits at the centre of the square.
    const mound = await page.evaluate(() => { const c = document.querySelector('#profileSprayChartSvg circle'); return [+c.getAttribute('cx'), +c.getAttribute('cy')]; });
    assert.deepEqual(mound, [200, 287.5], 'mound halfway from home to second');

    // 賽事分析: the third page of 比賽, reached from the game review, with every plate appearance in order.
    await page.evaluate(id => { switchMainTab('tabScorebook'); switchScorebookSubTab('review'); renderSelectedGameReview(id); }, gameId);
    // The old way into the review (場記 → 歷史賽事覆盤) opens this page with that game.
    await page.evaluate(() => switchScorebookSubTab('review'));
    await page.waitForSelector('#panelGames .ga-hero');
    const analysis = await page.evaluate(id => {
      const g = allGames.find(x => x.id === id);
      const pas = g.innings.flatMap(i => i.plateAppearances || []).length;
      const halves = g.innings.length;
      return {visible: !document.getElementById('panelGames').classList.contains('hidden'), sections: document.querySelectorAll('#panelGames > section').length,
        rows: document.querySelectorAll('#panelGames .ga-pa').length, pas, halves: document.querySelectorAll('#panelGames .ga-half').length, expectedHalves: halves,
        picked: gameAnalysis.current(), active: document.getElementById('btnTabGames').classList.contains('tab-active'),
        review: !!document.querySelector('#panelGames #gaReviewSection #gameReviewDetailContainer') && document.getElementById('scoreSubPanelReview').offsetParent !== null,
        oldTab: getComputedStyle(document.getElementById('btnScoreSubReview')).display};
    }, gameId);
    assert.ok(analysis.visible && analysis.active, 'the page and its button are on');
    assert.equal(analysis.sections, 11, 'picker, summary, video, six analysis sections, the moved review and 其他下載');
    assert.ok(analysis.review, 'the scorebook review (with its editor) is on this page');
    assert.equal(analysis.oldTab, 'none', '場記 no longer shows its own review tab');
    // The postgame card appears on the page.
    await page.waitForSelector('#panelGames .ga-card-img[src]', {state: 'attached', timeout: 20000});

    // Defense records only the pitcher. A mid-half-inning pitcher change asks first (on 10/31 the menu was switched to the
    // fielder for single outs), and the review editor offers to put a wrong one-off name back.
    const pitcher = await page.evaluate(() => {
      const saved = localStorage.getItem('rebas_active_game');
      activeGame = window.activeGame = {id: 'pitcher-test', lineup: ['甲', '乙', '丙'], lineupPositions: ['P', 'SS', 'LF'], pitcherName: '甲', innings: [], currentInning: 1, currentHalf: 'top', currentOuts: 0, finalScore: {us: 0, opp: 0}, ourRole: '後攻'};
      updateLivePitcherCard();
      const noFielderRow = !document.getElementById('defenseFielderChips');
      recordDefenseEvent('FO');
      // Undoing an earlier event recounts the outs of the ones after it.
      recordDefenseEvent('HIT'); recordDefenseEvent('GO');
      deleteDefenseEvent(activeGame.innings[0].defensiveEvents[0].id);
      const recount = {outs: activeGame.currentOuts, atEnd: activeGame.innings[0].defensiveEvents.map(e => e.outsAtEnd)};
      const asked = [];
      const confirmBefore = window.confirm;
      window.confirm = message => { asked.push(message); return false; };
      changeDefensePitcher('乙');
      // A position change that moves P mid-half-inning asks too.
      changeLiveLineupPosition(1, 'P');
      window.confirm = confirmBefore;
      // Entering a defensive half with a different pitcher than last time warns.
      activeGame.pitcherName = '乙';
      switchInningNext(); switchInningNext();
      const warned = /請確認登板投手/.test(document.getElementById('globalToastContainer')?.textContent || '');
      activeGame.pitcherName = '甲'; activeGame.lineupPositions = ['P', 'SS', 'LF'];
      const after = {pitcher: activeGame.pitcherName, positions: activeGame.lineupPositions.join(), event: Object.keys(activeGame.innings[0].defensiveEvents[0]).sort().join()};
      window.activeGame = null; activeGame = null;
      if (saved == null) localStorage.removeItem('rebas_active_game'); else localStorage.setItem('rebas_active_game', saved);
      const fixes = suggestPitcherFixes([{type: 'HIT', pitcher: 'A'}, {type: 'FO', pitcher: 'X'}, {type: 'HIT', pitcher: 'A'}, {type: 'GO', pitcher: 'Y'},
        {type: 'BB', pitcher: 'B'}, {type: 'HIT', pitcher: 'B'}]);
      return {noFielderRow, asked: asked.length, mentions: /只記登板投手/.test(asked[0] || ''), after, fixes, recount, warned};
    });
    assert.ok(pitcher.noFielderRow, 'no fielder row: defense does not record who handled the ball');
    assert.deepEqual([pitcher.asked, pitcher.mentions], [2, true], 'a mid-half-inning pitcher change asks first (menu and position change)');
    assert.deepEqual(pitcher.recount, {outs: 1, atEnd: [0, 1]}, 'undoing an earlier out recounts the later events');
    assert.ok(pitcher.warned, 'a different pitcher at the start of a defensive half is flagged');
    assert.deepEqual(pitcher.after, {pitcher: '甲', positions: 'P,SS,LF', event: 'desc,id,outsAdded,outsAtEnd,pitcher,runs,type'}, 'cancelled: pitcher and positions untouched; the event has no fielder field');
    assert.deepEqual(pitcher.fixes, {1: {pitcher: 'A', wrong: 'X'}, 3: {pitcher: 'A', wrong: 'Y'}}, 'one-off names on outs are flagged; a real change (B, B) is not');
    assert.equal(analysis.rows, analysis.pas, 'every plate appearance in the play-by-play');
    assert.equal(analysis.halves, analysis.expectedHalves, 'every half-inning');
    assert.equal(analysis.picked, gameId, 'the game from the review is selected');
    // Another game from the picker.
    // Older game with the arrow; then the list, searched by date, picks a game and the review follows.
    // Whichever arrow is enabled (the oldest game has no older one).
    const step = await page.evaluate(() => document.querySelector('#panelGames [data-ga-step="1"]').disabled ? '-1' : '1');
    await page.locator(`#panelGames [data-ga-step="${step}"]`).click();
    const older = await page.evaluate(() => ({id: gameAnalysis.current(), review: selectedReviewGameId}));
    assert.equal(older.review, older.id, 'the review follows the picker');
    await page.locator('#panelGames [data-ga="browse"]').click();
    const target = await page.evaluate(() => allGames.find(g => g.id !== gameAnalysis.current()));
    await page.fill('#panelGames [data-ga-search]', target.date.slice(5).replace('-', '/'));
    const listed = await page.evaluate(() => [...document.querySelectorAll('#panelGames .ga-browse-list [data-ga-game]')].map(b => b.dataset.gaGame));
    assert.ok(listed.includes(target.id), 'search by date finds the game');
    await page.locator(`#panelGames .ga-browse-list [data-ga-game="${target.id}"]`).click();
    assert.deepEqual(await page.evaluate(() => [gameAnalysis.current(), selectedReviewGameId, !!document.querySelector('#panelGames .ga-browse')]), [target.id, target.id, false]);

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed: true, plays: replay.plays, clip: `${clip.w}x${clip.h} ${clip.ext}`, video: Math.round(length.full)}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
