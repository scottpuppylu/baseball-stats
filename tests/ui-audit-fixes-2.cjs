// Audit #1-15: each case gets fresh browser storage and a memory-only GitHub mock.
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
const selected = process.env.UI_AUDIT_CASES?.split(',');
const report = {};
let externalGitHub = 0;

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  async function check(name, run, width = 1440) {
    if (selected && !selected.includes(name)) return;
    const context = await browser.newContext({viewport: {width, height: 900}});
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    console.log(`▶ ${name}`);
    const errors = [], writes = [];
    const state = {failPut: new Set(), failGet: new Set(), files: new Map()};
    for (const f of fs.readdirSync(path.join(root, 'tests', 'fixtures', 'data'))) state.files.set(`data/${f}`, fs.readFileSync(path.join(root, 'tests', 'fixtures', 'data', f)));
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => { externalGitHub++; return r.abort(); });
    await page.route('**/__mock-api/**', async route => {
      const req = route.request(), file = new URL(req.url()).pathname.split('/__mock-api/')[1];
      if (req.method() === 'PUT') {
        const body = req.postDataJSON();
        writes.push({file, body});
        if (state.failPut.has(file)) return route.fulfill({status: 500, body: '{}'});
        state.files.set(file, Buffer.from(body.content, 'base64'));
        return route.fulfill({status: 200, contentType: 'application/json', body: '{"content":{"sha":"memory-only"}}'});
      }
      if (state.failGet.has(file)) return route.fulfill({status: 500, body: '{}'});
      if (!state.files.has(file)) return route.fulfill({status: 404, body: '{}'});
      const raw = (req.headers()['x-mock-accept'] || '').includes('vnd.github.raw');
      const data = state.files.get(file);
      return route.fulfill({status: 200, contentType: 'application/json', body: raw ? data.toString() : JSON.stringify({sha: 'memory-only', encoding: 'base64', content: data.toString('base64')})});
    });
    await page.addInitScript(() => {
      window.confirm = () => true;
      // Messages that used to be alert() are toasts since 2026/10/11; __lastToast() reads the newest one.
      window.__lastToast = () => [...document.querySelectorAll('#globalToastContainer span')].at(-1)?.textContent || '';
    });
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
      await run(page, state, writes);
      assert.deepEqual(errors, [], `${name}: no pageerror`);
      assert.equal(externalGitHub, 0, `${name}: no real GitHub traffic`);
      assert.deepEqual(hashes(), diskBefore, `${name}: formal data files untouched`);
      report[name] = {passed: true, mockWrites: writes.map(w => w.file)};
    } catch (error) {
      report[name] = {passed: false, error: error.message, pageerrors: errors};
      console.error(`${name}: ${error.message}`);
    } finally { await context.close(); }
  }
  try {
    await check('1-sync-order', async (page, state, writes) => {
      const before = await page.evaluate(() => ({id: allGames[0].id, count: allLogs.filter(l => l.gameId === allGames[0].id).length}));
      state.failPut.add('data/games.json');
      await page.evaluate(id => undoGameFromTeamLogs(id), before.id);
      assert.equal(writes.filter(w => w.file === 'data/logs.json').length, 0, 'games failure must not upload logs');
      assert.equal(await page.evaluate(id => !!allGames.find(g => g.id === id).excludedFromLogs, before.id), false);
      await page.reload();
      await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
      assert.equal(await page.evaluate(id => allLogs.filter(l => l.gameId === id).length, before.id), before.count);
      state.failPut.clear(); state.failPut.add('data/logs.json');
      await page.evaluate(id => undoGameFromTeamLogs(id), before.id);
      await page.reload();
      await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
      assert.equal(await page.evaluate(id => !!allGames.find(g => g.id === id).excludedFromLogs, before.id), true);
      assert.equal(await page.evaluate(id => allLogs.filter(l => l.gameId === id).length, before.id), 0);
      state.failPut.clear(); state.failPut.add('data/games.json'); const prior = writes.length;
      await page.evaluate(async id => { selectedReviewGameId = id; await syncReviewGameToTeamLogs(); }, before.id);
      assert.equal(writes.slice(prior).some(w => w.file === 'data/logs.json'), false, 'failed reverse operation leaves logs excluded');
      assert.equal(await page.evaluate(id => !!allGames.find(g => g.id === id).excludedFromLogs, before.id), true);
      state.failPut.clear();
      await page.evaluate(async id => { selectedReviewGameId = id; await syncReviewGameToTeamLogs(); }, before.id);
      assert.equal(await page.evaluate(id => allLogs.filter(l => l.gameId === id).length, before.id), before.count);
    });
    await check('2-first-load-ids', async page => {
      const actual = await page.evaluate(() => ({duplicates: allLogs.filter((l, i) => allLogs.findIndex(x => x.id === l.id) !== i).map(l => l.id), jerseys: allLogs.filter(l => l.gameId && ['林志豪', '楊喬豐'].includes(l.name)).map(l => [l.name, l.jersey])}));
      assert.deepEqual(actual.duplicates, []);
      assert.ok(actual.jerseys.length >= 3);
      assert.ok(actual.jerseys.every(([name, jersey]) => jersey === (name === '林志豪' ? 95 : 46)));
      const fallback = await page.evaluate(() => {
        const game = JSON.parse(JSON.stringify(allGames[0])); const names = ['洪銘駿', '盧宣嘉'];
        game.lineup = names; game.substitutions = []; game.innings = [{inningNum: 1, topBottom: 'top', plateAppearances: names.map(batterName => ({batterName, result: '1H'}))}];
        NAME_TO_JERSEY[names[0]] = 0; NAME_TO_JERSEY[names[1]] = 0;
        const duplicateJersey = buildGameLogs(game);
        delete NAME_TO_JERSEY[names[0]]; delete NAME_TO_JERSEY[names[1]];
        return [duplicateJersey, buildGameLogs(game)].map(logs => ({ids: logs.map(l => l.id), parsed: logs.map(l => l.id.match(/^log_(?:game|auto)_(.+)_[^_]+$/)?.[1]), id: game.id}));
      });
      for (const f of fallback) { assert.equal(new Set(f.ids).size, 2); assert.ok(f.parsed.every(id => id === f.id)); }
    });
    await check('3-registration-retry', async page => {
      await page.evaluate(() => { __previewFailWrites = true; reg_jersey.value = '77'; reg_name.value = '重試新人'; reg_date.value = '2026-10-11'; addPlayerForm.dispatchEvent(new Event('submit', {cancelable: true})); });
      await page.waitForFunction(() => __lastToast().includes('失敗'));
      assert.equal(await page.locator('#reg_name').inputValue(), '重試新人');
      await page.evaluate(() => { __previewFailWrites = false; addPlayerForm.dispatchEvent(new Event('submit', {cancelable: true})); });
      await page.waitForFunction(() => allLogs.some(l => l.id.startsWith('reg_') && l.name === '重試新人'), null, {timeout: 5000});
      assert.equal(await page.evaluate(() => allLogs.filter(l => l.id.startsWith('reg_') && l.name === '重試新人').length), 1);
    });
    await check('4-guest-collision', async (page, state, writes) => {
      const result = await page.evaluate(() => {
        const before = {jersey: NAME_TO_JERSEY['盧宣嘉'], pa: getFullAgg().players.find(p => p.name === '盧宣嘉').pa, games: teamRecords.playerRecord('盧宣嘉').gamesPlayed, guests: JSON.stringify(guestPlayers)};
        const added = addGuestPlayer('盧宣嘉', 99);
        const after = {jersey: NAME_TO_JERSEY['盧宣嘉'], pa: getFullAgg().players.find(p => p.name === '盧宣嘉')?.pa, games: teamRecords.playerRecord('盧宣嘉')?.gamesPlayed, guests: JSON.stringify(guestPlayers)};
        guestPlayers.push({name: '盧宣嘉', jersey: 99}); syncJerseyMaps();
        return {before, after, added, legacyJersey: NAME_TO_JERSEY['盧宣嘉'], legacyGuest: isGuestPlayerName('盧宣嘉'), available: getAllAvailablePlayerNames()};
      });
      assert.equal(result.added, null); assert.deepEqual(result.after, result.before);
      assert.equal(result.legacyJersey, 44); assert.equal(result.legacyGuest, false);
      assert.ok(result.available.teamNames.includes('盧宣嘉')); assert.ok(!result.available.guestNames.includes('盧宣嘉'));
      assert.equal(writes.some(w => w.file === 'data/guests.json'), false);
      // All five entry points stop before assigning the rejected name or closing the modal.
      const callers = await page.evaluate(async () => {
        // Fill the guest form with the official player's name and submit it.
        const answer = async pending => {
          await new Promise(resolve => setTimeout(resolve, 0));
          const dialog = document.getElementById('uiFormDialog');
          dialog.querySelector('[data-dialog-field="0"]').value = '盧宣嘉';
          dialog.querySelector('[data-dialog-field="1"]').value = '99';
          dialog.querySelector('form').requestSubmit();
          await pending;
        };
        guestInputName.value = '盧宣嘉'; submitAddGuestForm({preventDefault() {}});
        activeGame = window.activeGame = JSON.parse(JSON.stringify(allGames[0])); activeGame.currentBatterIdx = 0;
        const original = JSON.stringify(activeGame);
        openSubstituteModal(); substituteNewPlayerSelect.value = '__NEW_GUEST__'; await answer(confirmSubstitution());
        const subUnchanged = JSON.stringify(activeGame) === original && !substituteModal.classList.contains('hidden'); closeSubstituteModal();
        const pitchBefore = JSON.stringify(activeGame); await answer(changeDefensePitcher('__NEW_GUEST_PITCHER__'));
        renderSetupLineupGrid(); // the grid fills an empty lineup to full length; the snapshot is taken after that
        const setupBefore = JSON.stringify(setupLineupList); await answer(updateSetupLineupSlot(0, "__ADD_GUEST__"));
        openPitcherChangeModal(); const modalBefore = JSON.stringify(activeGame); await answer(handleModalNewPitcherChange('__NEW_GUEST_PITCHER__'));
        return {input: guestInputName.value, subUnchanged, pitchUnchanged: JSON.stringify(activeGame) === pitchBefore, setupUnchanged: JSON.stringify(setupLineupList) === setupBefore, modalUnchanged: JSON.stringify(activeGame) === modalBefore && !pitcherChangeModal.classList.contains('hidden'),
          dialogClosed: !document.getElementById('uiFormDialog')};
      });
      assert.equal(callers.input, "盧宣嘉"); assert.ok(callers.subUnchanged && callers.pitchUnchanged && callers.setupUnchanged && callers.modalUnchanged && callers.dialogClosed);
    });
    await check('5-manual-validation', async (page, state, writes) => {
      await page.evaluate(() => { new_date.value = '2026-10-11'; new_jersey.value = '30'; new_tag.value = '隔離補登'; new_pa.value = '3'; new_h1.value = '4'; ['new_bb', 'new_sf', 'new_h2', 'new_h3', 'new_hr', 'new_k'].forEach(id => document.getElementById(id).value = '0'); addLogForm.dispatchEvent(new Event('submit', {cancelable: true})); });
      assert.equal(writes.length, 0); assert.match(await page.evaluate(() => __lastToast()), /安打/);
      for (const [field, value, message] of [['new_h1', '-1', /整數/], ['new_h1', '1.5', /整數/], ['new_bb', '4', /保送/], ['new_k', '3', /三振/]]) {
        await page.evaluate(([f, v]) => { new_h1.value = '1'; new_bb.value = '0'; new_k.value = '0'; document.getElementById(f).value = v; addLogForm.dispatchEvent(new Event('submit', {cancelable: true})); }, [field, value]);
        assert.equal(writes.length, 0); assert.match(await page.evaluate(() => __lastToast()), message);
      }
      await page.evaluate(() => { new_h1.value = '1'; new_k.value = '1'; addLogForm.dispatchEvent(new Event('submit', {cancelable: true})); });
      await page.waitForFunction(() => allLogs.some(l => l.tag === '隔離補登'));
      assert.equal(writes.filter(w => w.file === 'data/logs.json').length, 1);
    });
    await check('6-pitcher-outs', async page => {
      // Captured on 964b134 before changing the implementation: the real data has no official pitchers.
      assert.deepEqual(await page.evaluate(() => getAggregatedPitcherStats()), []);
      const before = await page.evaluate(() => {
        allGames = window.allGames = allGames.map((g, i) => { const c = JSON.parse(JSON.stringify(g)); c.pitcherName = i % 2 ? '田耕宇' : '盧宣嘉'; c.innings.forEach(inn => (inn.defensiveEvents || []).forEach(e => e.pitcher = c.pitcherName)); return c; });
        return getAggregatedPitcherStats().map(p => ({name: p.name, outs: p.outs, sFip: p.sFip, tracked: p.tracked, untrackedHalves: p.untrackedHalves}));
      });
      // These half-innings have no fielding events. They used to be counted as 3 outs, 0 BB, 0 K (21 / 18 outs, sFIP 4.50);
      // since 2026/10/11 nothing is invented: the appearances count, the metrics are "資料不足" (null).
      assert.deepEqual(before, [{name: '田耕宇', outs: 0, sFip: null, tracked: false, untrackedHalves: 7}, {name: '盧宣嘉', outs: 0, sFip: null, tracked: false, untrackedHalves: 6}]);
      const changed = await page.evaluate(async () => {
        const game = JSON.parse(JSON.stringify(allGames[0])); game.pitcherName = '盧宣嘉'; game.ourRole = '後攻'; game.innings = [{inningNum: 1, topBottom: 'top', runs: 0, hits: 0, plateAppearances: [], defensiveEvents: [{pitcher: '盧宣嘉', type: 'GO', outsAdded: 1, runs: 0}]}];
        allGames = window.allGames = [game]; selectedReviewGameId = game.id; switchMainTab('tabScorebook'); switchScorebookSubTab('review'); renderSelectedGameReview(game.id); toggleEditCurrentReviewGame();
        const initial = getAggregatedPitcherStats()[0]; edit_def_outs_0_0.value = '0'; await saveEditedReviewGame(game.id);
        return {initial, after: getAggregatedPitcherStats()[0], saved: allGames[0].innings[0].defensiveEvents[0].outsAdded};
      });
      assert.equal(changed.saved, 0); assert.equal(changed.initial.outs - changed.after.outs, 1);
      assert.equal(changed.after.ipDisplay, '0.0'); assert.equal(changed.after.tbf, changed.initial.tbf);
    });
    await check('7-unrecorded-diagnosis', async page => {
      const labels = await page.evaluate(() => { switchMainTab('tabScorebook'); switchScorebookSubTab('review'); return allGames.map(g => { g.finalScore = {us: 0, opp: 0}; renderSelectedGameReview(g.id); return gameReviewDetailContainer.textContent; }); });
      assert.ok(labels.every(t => t.includes('比分未記錄，無法評估得分效率')));
      assert.ok(labels.every(t => !/攻下 0 分|換得 0 分/.test(t)));
      const recorded = await page.evaluate(() => { const g = allGames[0]; g.finalScore = {us: 8, opp: 3}; renderSelectedGameReview(g.id); return gameReviewDetailContainer.textContent; });
      assert.match(recorded, /攻下 8 分/); assert.doesNotMatch(recorded, /比分未記錄，無法/);
    });
    await check('8-final-score-record', async page => {
      const result = await page.evaluate(async () => { const g = allGames[0]; selectedReviewGameId = g.id; switchMainTab('tabScorebook'); switchScorebookSubTab('review'); renderSelectedGameReview(g.id); toggleEditCurrentReviewGame(); editGameScoreUs.value = '12'; editGameScoreOpp.value = '8'; await saveEditedReviewGame(g.id); const recorded = teamRecords.teamGameRecords()[0].value; const saved = allGames.find(x => x.id === g.id); saved.finalScore = {us: 0, opp: 0}; saved.innings.find(i => isInningOurBat(saved.ourRole, i.topBottom)).runs = 6; return {recorded, fallback: teamRecords.teamGameRecords()[0].value}; });
      assert.equal(result.recorded, 12); assert.equal(result.fallback, 6);
    });
    await check('9-annual-fallback', async page => {
      const result = await page.evaluate(() => { allLogs = window.allLogs = JSON.parse(JSON.stringify(baseline2025Logs)); allGames = window.allGames = []; const r = teamRecords.playerRecord('簡承均'); return {games: r.gamesPlayed, summary: r.hasSummary, highs: r.highs, fun: r.fun, careerHr: r.career.hr, milestones: teamInsights.milestones(r.games)}; });
      assert.equal(result.games, 0); assert.equal(result.summary, true); assert.equal(result.careerHr, 7);
      assert.ok(result.highs.every(h => h.value === 0)); assert.equal(result.fun.threeHit, 0); assert.equal(result.fun.multiHr, 0); assert.deepEqual(result.milestones, []);
    });
    await check('10-mobile-fold-navigation', async page => {
      await page.evaluate(() => switchMainTab('tabLeaderboard'));
      await page.waitForFunction(() => document.querySelector('#leaderboardTableBody')?.closest('table').classList.contains('ui-fold-table'));
      const row = page.locator('#leaderboardTableBody tr').first();
      const col = await row.evaluate(r => [...r.cells].findIndex((c, i) => !c.classList.contains('ui-col-folded') && i !== Number(r.closest('table').dataset.uiNameCol) - 1));
      await row.locator('td').nth(col).click();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#panelLeaderboard').isVisible(), true);
      assert.equal(await page.locator('#leaderboardTableBody .ui-row-detail').isVisible(), true);
      await page.locator('#leaderboardTableBody .ui-row-detail button').click();
      assert.equal(await page.locator('#panelProfile').isVisible(), true);
      await page.evaluate(() => switchMainTab('tabLeaderboard'));
      const nameCol = await page.locator('#leaderboardTableBody').evaluate(b => Number(b.closest('table').dataset.uiNameCol) - 1);
      await page.locator('#leaderboardTableBody tr').first().locator('td').nth(nameCol).click();
      assert.equal(await page.locator('#panelProfile').isVisible(), true);
      await page.setViewportSize({width: 1440, height: 900}); await page.evaluate(() => switchMainTab('tabLeaderboard')); await page.waitForTimeout(100);
      await page.locator('#leaderboardTableBody tr').first().locator('td').first().click(); assert.equal(await page.locator('#panelProfile').isVisible(), true);
      // At least three pitchers make the pitching table fold rather than become a two-row card.
      await page.setViewportSize({width: 390, height: 900});
      await page.evaluate(() => { allGames = window.allGames = allGames.map((g, i) => { const c = JSON.parse(JSON.stringify(g)); c.pitcherName = ['盧宣嘉', '田耕宇', '洪銘駿'][i % 3]; c.innings.forEach(inn => { if (!isInningOurBat(c.ourRole, inn.topBottom)) inn.defensiveEvents = [{pitcher: c.pitcherName, type: 'GO', outsAdded: 1}]; }); return c; }); switchMainTab('tabPitching'); renderPitchingStudio(); });
      await page.waitForFunction(() => pitchingTableBody.closest('table').classList.contains('ui-fold-table'));
      const pitcherRow = page.locator('#pitchingTableBody tr').first();
      const pitcherCol = await pitcherRow.evaluate(r => [...r.cells].findIndex((c, i) => !c.classList.contains('ui-col-folded') && i !== Number(r.closest('table').dataset.uiNameCol) - 1));
      await pitcherRow.locator('td').nth(pitcherCol).click(); await page.waitForTimeout(100);
      assert.equal(await page.locator('#pitchingTableBody .ui-row-detail').isVisible(), true);
      assert.equal(await page.locator('#panelPitching').isVisible(), true);
    }, 390);
    await check('11-zero-jersey', async page => {
      await page.evaluate(() => { reg_jersey.value = '0'; reg_name.value = '零號新人'; reg_date.value = '2026-10-11'; addPlayerForm.dispatchEvent(new Event('submit', {cancelable: true})); });
      await page.waitForFunction(() => allLogs.some(l => l.name === '零號新人'));
      assert.equal(await page.evaluate(() => JERSEY_TO_NAME[0]), '零號新人');
      await page.evaluate(() => { new_jersey.value = '0'; new_jersey.dispatchEvent(new Event('input')); });
      assert.match(await page.locator('#jerseyMatchHint').textContent(), /#0 零號新人/);
      await page.evaluate(() => { new_date.value = '2026-10-11'; new_pa.value = '1'; new_h1.value = '1'; ['new_bb', 'new_sf', 'new_h2', 'new_h3', 'new_hr', 'new_k'].forEach(id => document.getElementById(id).value = '0'); addLogForm.dispatchEvent(new Event('submit', {cancelable: true})); });
      await page.waitForFunction(() => allLogs.some(l => l.name === '零號新人' && l.pa === 1));
      await page.evaluate(() => {renderAll();switchMainTab('tabOverview');}); assert.match(await page.locator('#playerSelect').textContent(), /#0 零號新人/);
      assert.match(await page.locator('#summaryTableBody').textContent(), /#0/);
    });
    await check('12-bubble-zero', async page => {
      const values = await page.evaluate(() => { customChartType.value = 'bubble'; customXVar.value = 'avg'; customYVar.value = 'ops'; customZVar.value = 'hr'; const agg = getFullAgg(); const zero = agg.players.find(p => p.hr === 0); renderCustomChart(agg); const c = Chart.getChart('customChart'); const point = c.data.datasets[0].data.find(p => p.name === zero.name); const tooltip = c.options.plugins.tooltip.callbacks.label({raw: point}); zero.hr = null; renderCustomChart(agg); const missing = Chart.getChart('customChart'); const m = missing.data.datasets[0].data.find(p => p.name === zero.name); return {point, tooltip, min: Math.min(...c.data.datasets[0].data.map(p => p.r)), missing: missing.options.plugins.tooltip.callbacks.label({raw: m})}; });
      assert.equal(values.point.rawZ, 0); assert.equal(values.point.r, values.min); assert.match(values.tooltip, /全壘打 \(HR\) 0$/); assert.match(values.missing, /全壘打 \(HR\) —$/);
    });
    await check('13-unused-z', async page => {
      const values = await page.evaluate(() => ['scatter', 'dual_axis'].map(type => { customChartType.value = type; customXVar.value = 'avg'; customYVar.value = 'ops'; const counts = ['hr', 'xba'].map(z => { customZVar.value = z; renderCustomChart(getFullAgg()); const c = Chart.getChart('customChart'); return type === 'scatter' ? c.data.datasets[0].data.length : c.data.labels.length; }); const disabled = customZVar.disabled; customChartType.value = 'bubble'; renderCustomChart(getFullAgg()); return {counts, disabled, restored: !customZVar.disabled, selected: customZVar.value}; }));
      for (const v of values) { assert.equal(v.counts[0], v.counts[1]); assert.equal(v.disabled, true); assert.equal(v.restored, true); assert.equal(v.selected, 'xba'); }
    });
    await check('14-empty-pitching', async page => {
      await page.evaluate(() => { allGames = window.allGames = allGames.map((g, i) => { const c = JSON.parse(JSON.stringify(g)); c.pitcherName = i % 2 ? '田耕宇' : '盧宣嘉'; c.innings.forEach(inn => (inn.defensiveEvents || []).forEach(e => e.pitcher = c.pitcherName)); return c; }); selectedPitcherName = '田耕宇'; switchMainTab('tabPitching'); renderPitchingStudio(); filterStartDate.value = '2099-01-01'; filterEndDate.value = '2099-12-31'; renderAll(); });
      assert.match(await page.locator('#pitchingPlayerSelect').textContent(), /此區間無投手紀錄/);
      assert.equal(await page.locator('#pitcherSelectAvatarBadge').textContent(), ''); assert.equal(await page.locator('#pitcherSelectAvatarBadge').locator('img, div').count(), 0);
      assert.equal(await page.evaluate(() => !!Chart.getChart('pitcherRadarChart') || !!Chart.getChart('pitcherOutProfileChart')), false);
      await page.evaluate(() => { filterStartDate.value = ''; filterEndDate.value = ''; renderAll(); });
      assert.equal(await page.locator('#pitchingPlayerSelect').inputValue(), '田耕宇');
    });
    await check('15-optional-guest-file', async (page, state, writes) => {
      assert.equal((await fetch(`${url}/__mock-api/data/guests.json`)).status, 404, 'preview must return a real missing-file response');
      assert.match(await page.locator('#syncStatusBadge').textContent(), /連線正常.*雲端已同步/);
      await page.evaluate(async () => { guestPlayers = window.guestPlayers = [{name: '裝置支援', jersey: 0}]; localStorage.setItem('rebas_guest_players', JSON.stringify(guestPlayers)); await loadLogsFromGitHub(); });
      assert.equal(await page.evaluate(() => guestPlayers[0]?.name), '裝置支援');
      await page.evaluate(() => addGuestPlayer('記憶體支援', 88));
      await page.waitForFunction(() => document.getElementById('syncStatusBadge').textContent.includes('支援名冊已同步'));
      const put = writes.find(w => w.file === 'data/guests.json'); assert.ok(put); assert.equal('sha' in put.body, false);
      await page.reload(); await page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
      assert.ok(await page.evaluate(() => guestPlayers.some(g => g.name === '記憶體支援')));
      state.failGet.add('data/guests.json'); await page.evaluate(() => loadLogsFromGitHub());
      assert.match(await page.locator('#syncStatusBadge').textContent(), /部分同步.*支援名冊/);
    });
    assert.equal(externalGitHub, 0); assert.deepEqual(hashes(), diskBefore);
    fs.mkdirSync(output, {recursive: true}); fs.writeFileSync(path.join(output, 'audit-fixes-2-report.json'), JSON.stringify(report, null, 2));
    const failures = Object.entries(report).filter(([, r]) => !r.passed);
    console.log(JSON.stringify({passed: failures.length === 0, cases: Object.keys(report).length, failures: failures.map(([name]) => name), externalGitHub, output}));
    if (failures.length) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
