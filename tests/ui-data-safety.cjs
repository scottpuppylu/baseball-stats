// Data-safety fixes (2026/10/11), in the isolated preview only:
// 1. two devices saving: uploads merge with what another device saved instead of overwriting it;
// 2. live scorer: no preset batting result, and nothing new is recorded after three outs;
// 3. pitching: half-innings without fielding events are "資料不足", never invented numbers; no hard-coded pitcher;
// 4. review editor: changing a fielding event's type resets its outs to that type's default.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const hashes = () => Object.fromEntries(fs.readdirSync(path.join(root, 'data')).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', f))).digest('hex')]));
const diskBefore = hashes();
const ready = page => page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
const toasts = page => page.evaluate(() => document.getElementById('globalToastContainer')?.textContent || '');
// What the (simulated) cloud holds right now, read straight from the preview's memory store.
const cloud = (page, file) => page.evaluate(async file => {
  const res = await fetch(`/__mock-api/${file}`);
  return res.ok ? JSON.parse(base64ToUtf8((await res.json()).content)) : null;
}, file);

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  let externalGitHub = 0;
  const device = async (width = 1440) => {
    const context = await browser.newContext({viewport: {width, height: 900}});
    await context.addInitScript(() => { window.confirm = () => true; window.alert = () => {}; });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => { externalGitHub++; return r.abort(); });
    await page.goto(url);
    await ready(page);
    return {context, page};
  };
  const checks = [];
  // UI_SAFETY_CASES=1,2,3 runs only those sections (3 also covers 4).
  const want = id => !process.env.UI_SAFETY_CASES || process.env.UI_SAFETY_CASES.split(',').includes(id);
  try {
    // Independent games must never alias the same merge key, even with a frozen clock / ten-second wraparound.
    if (want('5')) {
      const A = await device(), B = await device();
      const create = (page, opponent, offset) => page.evaluate(({opponent, offset}) => {
        Date.now = () => 1792098000000 + offset;
        document.getElementById('setup_game_date').value = '2026-10-16';
        document.getElementById('setup_game_opponent').value = opponent;
        switchMainTab('tabScorebook'); startNewGameFromSetup();
        return activeGame.id;
      }, {opponent, offset});
      const a = await create(A.page, 'Clock QA A', 0), b = await create(B.page, 'Clock QA B', 10000);
      assert.notEqual(a, b, 'two devices starting independent games have distinct IDs');
      assert.equal(await A.page.evaluate(() => commitGamesToGitHub([...allGames, activeGame], 'clock QA A')), true);
      assert.equal(await B.page.evaluate(() => commitGamesToGitHub([...allGames, activeGame], 'clock QA B')), true);
      const saved = await cloud(B.page, 'data/games.json');
      assert.equal(saved.find(g => g.id === a)?.opponent, 'Clock QA A');
      assert.equal(saved.find(g => g.id === b)?.opponent, 'Clock QA B');
      await A.context.close(); await B.context.close();
      checks.push('5-distinct-games-two-devices');
    }
    // ---------- 2. Live scorer ----------
    if (want('2')) {
    const L = await device(390);
    await L.page.evaluate(() => { switchMainTab('tabScorebook'); switchScorebookSubTab('live'); startNewGameFromSetup(); });
    const startState = await L.page.evaluate(() => ({result: currentPlayInput.result, pitcher: activeGame.pitcherName, lineup: activeGame.lineup, positions: activeGame.lineupPositions}));
    assert.equal(startState.result, null, 'no preset result');
    assert.equal(startState.pitcher, startState.lineup[startState.positions.indexOf('P')], 'starting pitcher = explicitly confirmed P in setup');
    await L.page.locator('button[onclick="submitBattedBallPlay()"]').click();
    assert.equal(await L.page.evaluate(() => activeGame.innings[0].plateAppearances.length), 0, 'submit without a result records nothing');
    assert.match(await toasts(L.page), /請先選擇打擊結果/);
    await L.page.locator('#res_GO').click();
    await L.page.locator('button[onclick="submitBattedBallPlay()"]').click();
    const afterPlay = await L.page.evaluate(() => ({plays: activeGame.innings[0].plateAppearances.map(p => p.result), result: currentPlayInput.result,
      ringed: document.querySelectorAll('[id^="res_"].ring-2').length}));
    assert.deepEqual(afterPlay, {plays: ['GO'], result: null, ringed: 0}, 'recorded, then the result is cleared again');
    await L.page.locator('button[onclick="recordQuickStrikeout(\'K\')"]').click();
    await L.page.locator('button[onclick="recordQuickStrikeout(\'界外K\')"]').click();
    assert.equal(await L.page.evaluate(() => activeGame.currentOuts), 3);
    const before3 = await L.page.evaluate(() => JSON.stringify(activeGame));
    await L.page.locator('button[onclick="recordQuickStrikeout(\'K\')"]').click();
    await L.page.locator('button[onclick="recordQuickWalk()"]').click();
    await L.page.locator('button[onclick="recordRunnerOut()"]').click();
    await L.page.locator('#res_1H').click();
    await L.page.locator('button[onclick="submitBattedBallPlay()"]').click();
    assert.equal(await L.page.evaluate(() => JSON.stringify(activeGame)), before3, 'nothing recorded after three outs');
    assert.match(await toasts(L.page), /已 3 出局/);
    // Undoing a play reopens the half-inning.
    await L.page.evaluate(() => deleteInningPlay(2));
    assert.equal(await L.page.evaluate(() => activeGame.currentOuts), 2);
    await L.page.evaluate(() => { selectOutcome(null); switchInningNext(); if (!activeGame.pitcherName) changeDefensePitcher(activeGame.lineup[0]); });
    // Defence: three outs block new batters and outs, but a run can still be entered.
    for (const t of ['GO', 'FO', 'K']) await L.page.locator(`button[onclick="recordDefenseEvent('${t}')"]`).click();
    const d3 = await L.page.evaluate(() => JSON.stringify(activeGame.innings.at(-1).defensiveEvents.length));
    await L.page.locator(`button[onclick="recordDefenseEvent('BB')"]`).click();
    await L.page.locator(`button[onclick="recordDefenseEvent('DP')"]`).click();
    assert.equal(await L.page.evaluate(() => JSON.stringify(activeGame.innings.at(-1).defensiveEvents.length)), d3, 'no new batter or out after three outs');
    await L.page.locator(`button[onclick="recordDefenseEvent('RUN', 1)"]`).click();
    assert.equal(await L.page.evaluate(() => activeGame.finalScore.opp), 1, 'a run can still be recorded');
    // No pitcher chosen: defensive events are refused instead of credited to someone.
    const noPitcher = await L.page.evaluate(() => {
      activeGame.pitcherName = null; updateLivePitcherCard();
      const count = activeGame.innings.at(-1).defensiveEvents.length;
      recordDefenseEvent('RUN', 1);
      return {count, after: activeGame.innings.at(-1).defensiveEvents.length, title: defensePitcherNameTitle.textContent,
        placeholder: defensePitcherSelect.options[0]?.textContent || ''};
    });
    assert.equal(noPitcher.after, noPitcher.count);
    assert.equal(noPitcher.title, '登板投手：尚未選擇');
    assert.match(noPitcher.placeholder, /請選擇登板投手/);
    // The confirmed P can be any selected fielder, even outside the pitching rankings.
    const selectedPitcher = await L.page.evaluate(() => {
      discardActiveGame();
      const ranked = new Set(defenseRankings.P || []);
      const idx = setupLineupList.findIndex(n => !ranked.has(n));
      changeSetupLineupPosition(idx, 'P'); startNewGameFromSetup();
      return {actual: activeGame.pitcherName, expected: setupLineupList[idx]};
    });
    assert.equal(selectedPitcher.actual, selectedPitcher.expected);
    await L.page.screenshot({path: path.join(output, '390-LiveNoPitcher.png')});
    checks.push('2-live-scorer');
    await L.context.close();
    }

    // ---------- 3 & 4. Pitching and the review editor ----------
    if (want('3')) {
    const P = await device();
    const pitching = await P.page.evaluate(() => {
      const original = allGames;
      // Team pitchers with no fielding events at all.
      allGames = window.allGames = original.map((g, i) => ({...JSON.parse(JSON.stringify(g)), pitcherName: i % 2 ? '田耕宇' : '盧宣嘉'}));
      switchMainTab('tabPitching');
      const empty = {list: getAggregatedPitcherStats().map(p => ({name: p.name, tracked: p.tracked, zcr: p.zcr, sFip: p.sFip, outs: p.outs, games: p.games})),
        noData: !!document.querySelector('#pitchingHeroCards [data-pitching-no-data]'), praise: document.getElementById('panelPitching').textContent.includes('極限好球帶控制'),
        option: pitchingPlayerSelect.options[0].textContent.trim(), ipCell: pitchingTableBody.rows[0].cells[2].textContent.trim(),
        advisory: !!document.querySelector('#pitchingTacticalAdvisoryCard [data-pitching-no-data]'), radar: !!Object.values(Chart.instances).find(c => c.canvas.id === 'pitcherRadarChart')};
      // One pitcher with events in the first game only: metrics from those events, plus a note about the rest.
      allGames = window.allGames = allGames.map((g, i) => {
        const c = JSON.parse(JSON.stringify(g));
        if (i === 0) c.innings.forEach(inn => { if (!isInningOurBat(c.ourRole, inn.topBottom)) inn.defensiveEvents = [{pitcher: c.pitcherName, type: 'GO', outsAdded: 1}, {pitcher: c.pitcherName, type: 'BB', outsAdded: 0}, {pitcher: c.pitcherName, type: 'K', outsAdded: 1}, {pitcher: c.pitcherName, type: '界外K', outsAdded: 1}]; });
        return c;
      });
      const defenceHalves = g => g.innings.filter(inn => !isInningOurBat(g.ourRole, inn.topBottom)).length;
      const halves = defenceHalves(allGames[0]);
      const otherHalves = allGames.slice(1).filter(g => g.pitcherName === allGames[0].pitcherName).reduce((n, g) => n + defenceHalves(g), 0);
      selectedPitcherName = allGames[0].pitcherName; renderPitchingStudio();
      const p = getAggregatedPitcherStats().find(x => x.name === allGames[0].pitcherName);
      const mixed = {tracked: p.tracked, outs: p.outs, tbf: p.tbf, zcr: p.zcr, untracked: p.untrackedHalves, halves, otherHalves,
        note: !!document.querySelector('[data-pitching-untracked]'), heroText: pitchingHeroCards.textContent.replace(/\s+/g, ' ')};
      // A game with no recorded pitcher: its events are not credited to anyone.
      allGames = window.allGames = original.map(g => { const c = JSON.parse(JSON.stringify(g)); c.pitcherName = ''; c.innings.forEach(inn => { if (!isInningOurBat(c.ourRole, inn.topBottom)) inn.defensiveEvents = [{type: 'GO', outsAdded: 1}]; }); return c; });
      const unattributed = getAggregatedPitcherStats().length;
      allGames = window.allGames = original; renderPitchingStudio();
      return {empty, mixed, unattributed};
    });
    assert.ok(pitching.empty.list.length === 2 && pitching.empty.list.every(p => !p.tracked && p.zcr === null && p.sFip === null && p.outs === 0 && p.games === 2), 'no invented numbers');
    assert.ok(pitching.empty.noData && pitching.empty.advisory && !pitching.empty.praise && !pitching.empty.radar);
    assert.match(pitching.empty.option, /資料不足/);
    assert.equal(pitching.empty.ipCell, '資料不足');
    assert.equal(pitching.mixed.tracked, true);
    assert.equal(pitching.mixed.outs, 3 * pitching.mixed.halves);
    assert.equal(pitching.mixed.tbf, 4 * pitching.mixed.halves);
    assert.equal(pitching.mixed.zcr, 0.75);
    assert.ok(pitching.mixed.otherHalves > 0); assert.equal(pitching.mixed.untracked, pitching.mixed.otherHalves, 'the second game of the same pitcher is untracked');
    assert.ok(pitching.mixed.note && pitching.mixed.heroText.includes('75.0%'));
    assert.equal(pitching.unattributed, 0, 'events without a pitcher are not credited to anyone');
    await P.page.screenshot({path: path.join(output, '1440-PitchingNoData.png'), fullPage: false});

    // Review editor: changing the type resets the outs; a legacy event without outsAdded shows its type's default.
    const review = await P.page.evaluate(async () => {
      const game = JSON.parse(JSON.stringify(allGames[0])); game.id = 'game_review_outs'; game.pitcherName = '田耕宇'; game.ourRole = '後攻';
      game.innings = [{inningNum: 1, topBottom: 'top', runs: 0, hits: 0, plateAppearances: [], defensiveEvents: [{pitcher: '田耕宇', type: 'GO', outsAdded: 1, runs: 0}, {pitcher: '田耕宇', type: 'BB', runs: 0}]}];
      allGames = window.allGames = [game, ...allGames];
      selectedReviewGameId = game.id; switchMainTab('tabScorebook'); switchScorebookSubTab('review'); renderSelectedGameReview(game.id); toggleEditCurrentReviewGame();
      const out = {legacy: edit_def_outs_0_1.value};
      const type = edit_def_type_0_0;
      const pick = v => { type.value = v; type.dispatchEvent(new Event('change')); return edit_def_outs_0_0.value; };
      out.bb = pick('BB'); out.dp = pick('DP'); out.hit = pick('HIT'); out.runnerOut = pick('RUNNER_OUT'); out.go = pick('GO');
      edit_def_outs_0_0.value = '2'; out.manual = edit_def_outs_0_0.value; // still adjustable by hand
      pick('BB');
      await saveEditedReviewGame(game.id);
      const p = getAggregatedPitcherStats().find(x => x.name === '田耕宇');
      out.saved = allGames.find(g => g.id === game.id).innings[0].defensiveEvents.map(e => [e.type, e.outsAdded]);
      out.outs = p.outs; out.bbCount = p.bb;
      return out;
    });
    assert.deepEqual(review, {legacy: '0', bb: '0', dp: '2', hit: '0', runnerOut: '1', go: '1', manual: '2', saved: [['BB', 0], ['BB', 0]], outs: 0, bbCount: 2});
    const editorPitcher = await P.page.evaluate(() => {
      const g = allGames.find(x => x.id === 'game_review_outs'); g.pitcherName = ''; g.innings[0].defensiveEvents[0].pitcher = '';
      isEditingReviewGame = false; renderSelectedGameReview(g.id); toggleEditCurrentReviewGame();
      return {game: editGamePitcher.value, gameLabel: editGamePitcher.selectedOptions[0].textContent.trim(), event: edit_def_pitcher_0_0.value};
    });
    assert.deepEqual(editorPitcher, {game: '', gameLabel: '— 未記錄 —', event: ''}, 'no pitcher is filled in for the coach');
    checks.push('3-pitching-no-data', '4-review-outs');
    await P.context.close();
    }

    // ---------- 1. Two devices ----------
    if (want('1')) {
    const A = await device(), B = await device();
    // Logs: B adds a log after A loaded; A then adds its own through the form. Both must survive.
    await B.page.evaluate(() => commitLogsToGitHub([...allLogs, {id: 'log_device_b', date: '2026-10-11', tag: '裝置B補登', name: '洪銘駿', jersey: 30, pa: 2, ab: 2, h: 1, h1: 1, h2: 0, h3: 0, hr: 0, bb: 0, sf: 0, k: 0}], 'device B'));
    await A.page.evaluate(() => {
      document.getElementById('toggleAddLogBtn').click();
      new_date.value = '2026-10-11'; new_tag.value = '裝置A補登'; new_jersey.value = '44'; new_pa.value = '3'; new_h1.value = '1'; new_k.value = '1';
      document.getElementById('addLogForm').requestSubmit();
    });
    await A.page.waitForFunction(() => allLogs.some(l => l.tag === '裝置A補登'));
    let logs = await cloud(A.page, 'data/logs.json');
    assert.ok(logs.some(l => l.id === 'log_device_b'), 'device B\'s log is still in the cloud after A saved');
    assert.ok(logs.some(l => l.tag === '裝置A補登'), 'device A\'s log was saved');
    assert.ok(await A.page.evaluate(() => allLogs.some(l => l.id === 'log_device_b')), 'A now shows B\'s log too');
    assert.match(await toasts(A.page), /合併/, 'A is told that it merged');
    // Deletion on one device, addition on the other: the deleted log stays deleted, the added one stays.
    await B.page.reload(); await ready(B.page); // B deletes A's log, so B must have seen it
    await B.page.evaluate(() => commitLogsToGitHub([...allLogs.filter(l => l.tag !== '裝置A補登'), {id: 'log_device_b2', date: '2026-10-11', tag: '裝置B第二筆', name: '洪銘駿', jersey: 30, pa: 1, ab: 1, h: 0, h1: 0, h2: 0, h3: 0, hr: 0, bb: 0, sf: 0, k: 1}], 'device B again'));
    await A.page.evaluate(() => deleteSingleLog('log_device_b'));
    logs = await cloud(A.page, 'data/logs.json');
    assert.ok(!logs.some(l => l.id === 'log_device_b'), 'A\'s deletion applied');
    assert.ok(!logs.some(l => l.tag === '裝置A補登'), 'B\'s deletion is not undone by A');
    assert.ok(logs.some(l => l.id === 'log_device_b2'), 'B\'s newer log kept');
    // Games: B saves an extra game, A edits a different game in review. Both kept; A's team logs include B's game.
    const newGameId = await B.page.evaluate(async () => {
      const g = JSON.parse(JSON.stringify(allGames.find(x => x.innings.some(i => (i.plateAppearances || []).length)))); g.id = 'game_device_b'; g.date = '2026-10-11'; g.opponent = '裝置B對手';
      await commitGamesToGitHub([g, ...allGames], 'device B game');
      return g.id;
    });
    await A.page.evaluate(async () => {
      const g = allGames[1];
      selectedReviewGameId = g.id; switchMainTab('tabScorebook'); switchScorebookSubTab('review'); renderSelectedGameReview(g.id); toggleEditCurrentReviewGame();
      editGameOpponent.value = '裝置A改名'; await saveEditedReviewGame(g.id);
    });
    const games = await cloud(A.page, 'data/games.json');
    assert.ok(games.some(g => g.id === newGameId), 'B\'s game kept');
    assert.ok(games.some(g => g.opponent === '裝置A改名'), 'A\'s edit saved');
    assert.ok(await A.page.evaluate(id => allGames.some(g => g.id === id) && allLogs.some(l => l.gameId === id), newGameId), 'A shows B\'s game and its logs');
    // Objects: tags and defense rankings merge key by key.
    await B.page.evaluate(() => commitTagsToGitHub({...playerTags, 謝承祐: ['裝置B標籤']}, 'device B tag'));
    await A.page.evaluate(() => commitTagsToGitHub({...playerTags, 孫煜哲: ['裝置A標籤']}, 'device A tag'));
    const tags = await cloud(A.page, 'data/tags.json');
    assert.deepEqual([tags.謝承祐, tags.孫煜哲], [['裝置B標籤'], ['裝置A標籤']]);
    await B.page.evaluate(() => commitDefenseToGitHub({...defenseRankings, C: ['陳泓銘']}, 'device B C'));
    await A.page.evaluate(() => commitDefenseToGitHub({...defenseRankings, '1B': ['吳侑宸']}, 'device A 1B'));
    const defense = await cloud(A.page, 'data/defense.json');
    assert.deepEqual([defense.C, defense['1B']], [['陳泓銘'], ['吳侑宸']]);
    // A write that loses a race between its read and its write (409) reads again and still keeps both.
    let raced = false;
    await A.page.route('**/__mock-api/data/logs.json?*', async route => {
      if (route.request().method() === 'PUT' && !raced) {
        raced = true;
        await B.page.evaluate(() => commitLogsToGitHub([...allLogs, {id: 'log_race_b', date: '2026-10-11', tag: '競速', name: '洪銘駿', jersey: 30, pa: 1, ab: 1, h: 0, h1: 0, h2: 0, h3: 0, hr: 0, bb: 0, sf: 0, k: 0}], 'race'));
      }
      return route.continue();
    });
    await A.page.evaluate(() => commitLogsToGitHub([...allLogs, {id: 'log_race_a', date: '2026-10-11', tag: '競速', name: '盧宣嘉', jersey: 44, pa: 1, ab: 1, h: 1, h1: 1, h2: 0, h3: 0, hr: 0, bb: 0, sf: 0, k: 0}], 'race A'));
    logs = await cloud(A.page, 'data/logs.json');
    assert.ok(raced && logs.some(l => l.id === 'log_race_a') && logs.some(l => l.id === 'log_race_b'), 'race: both writes kept');
    // A single device with nothing new in the cloud writes exactly its own data, with no merge notice.
    const solo = await device();
    const soloResult = await solo.page.evaluate(async () => {
      const local = [...allLogs, {id: 'log_solo', date: '2026-10-11', tag: '單機', name: '盧宣嘉', jersey: 44, pa: 1, ab: 1, h: 0, h1: 0, h2: 0, h3: 0, hr: 0, bb: 0, sf: 0, k: 1}];
      await commitLogsToGitHub(local, 'solo');
      return {same: JSON.stringify(allLogs) === JSON.stringify(local), toast: document.getElementById('globalToastContainer')?.textContent || ''};
    });
    assert.ok(soloResult.same && !/合併/.test(soloResult.toast), 'no merge when nothing changed elsewhere');
    checks.push('1-two-devices');
    for (const d of [A, B, solo]) await d.context.close();
    }

    assert.deepEqual(errors, [], 'no pageerror');
    assert.equal(externalGitHub, 0, 'no real GitHub traffic');
    assert.deepEqual(hashes(), diskBefore, 'formal data files untouched');
    console.log(JSON.stringify({passed: true, checks, output}));
  } catch (error) {
    console.error(error);
    if (errors.length) console.error('pageerrors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
