// Real UI interactions against the isolated preview; all cloud writes stay in memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('rebas_active_game')));
async function click(page, selector) { await page.locator(selector).first().click(); }
async function newGame(page, dh, role = '先攻') {
  await page.evaluate(({dh,role}) => {
    activeGame = window.activeGame = null;
    localStorage.removeItem('rebas_active_game');
    setDhRule(dh);
    switchMainTab('tabScorebook');
    loadLineupIntoGameSetup('recommended');
    document.getElementById('setup_game_role').value = role;
  }, {dh,role});
}
(async () => {
  fs.mkdirSync(output, {recursive:true});
  const results = [];
  for (const [engine,width,height] of [['chrome',320,740],['chrome',390,844],['chrome',768,1024],['chrome',1440,1000],['webkit',390,844]]) {
    const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({channel:'chrome',headless:true}));
    try {
      const context = await browser.newContext({viewport:{width,height},hasTouch:width<1024});
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => d.accept());
      await page.goto(url);
      await page.waitForFunction(() => window.LineupModel && allLogs.some(l => String(l.id).startsWith('log_game_')));
      await newGame(page, true);
      assert.equal(await page.locator('#setupLineupGrid .lineup-row').count(), 11);
      assert.equal(await page.locator('#setupLineupGrid .lineup-avatar').count(), 11);
      const rows = await page.locator('#setupLineupGrid .lineup-row').evaluateAll(nodes => nodes.map(n => {const r=n.getBoundingClientRect();return {x:r.x,y:r.y,b:r.bottom};}));
      assert.ok(rows.every((r,i) => r.x === rows[0].x && (!i || r.y >= rows[i-1].b)), 'one slot per row');
      // Name swaps preserve unique hitters and update the field immediately.
      const initial = await page.evaluate(() => ({names:[...setupLineupList],positions:[...setupLineupPositions]}));
      await page.locator('.lineup-player-select').nth(0).selectOption(initial.names[1]);
      assert.deepEqual(await page.evaluate(() => setupLineupList.slice(0,2)), [initial.names[1],initial.names[0]]);
      const position = initial.positions[0];
      const fieldText = await page.locator(`#setupLineupField [data-position="${position === 'DH' ? initial.positions[1] : position}"]`).textContent();
      assert.ok(fieldText.includes(position === 'DH' ? initial.names[0] : initial.names[1]));
      // Swapping P with DH changes both positions and uses the actual P at start.
      const dhIdx = initial.positions.indexOf('DH');
      const oldPitcher = initial.positions.indexOf('P');
      await page.locator('#setupLineupGrid .lineup-position').nth(dhIdx).selectOption('');
      await click(page,'button[onclick="startNewGameFromSetup()"]');
      assert.equal(await state(page),null,'missing position blocks setup');
      await page.locator('#setupLineupGrid .lineup-position').nth(dhIdx).selectOption('DH');
      await page.locator('#setupLineupGrid .lineup-position').nth(dhIdx).selectOption('P');
      assert.equal(await page.locator('#setupLineupGrid .lineup-position').nth(oldPitcher).inputValue(), 'DH');
      await page.screenshot({path:path.join(output,`${engine}-${width}-lineup-setup.png`),fullPage:true});
      await page.locator('#setupLineupField').screenshot({path:path.join(output,`${engine}-${width}-lineup-field.png`)});
      await click(page,'button[onclick="startNewGameFromSetup()"]');
      let game = await state(page);
      assert.equal(game.pitcherName,game.lineup[dhIdx]);
      assert.equal(game.dhSlot,oldPitcher+1);
      assert.deepEqual(game.lineupPositions,game.startingPositions);
      const starters = game.startingLineup, startingPositions = game.startingPositions;
      assert.equal(await page.locator('.lineup-current').getAttribute('data-slot'),'1');
      await click(page,'button[onclick="recordQuickWalk()"]');
      game = await state(page);
      const play = JSON.stringify(game.innings[0].plateAppearances[0]);
      assert.equal(await page.locator('.lineup-current').getAttribute('data-slot'),'2');
      // Replace a non-current slot through its row. The current batter must not move.
      await click(page,'#liveLineupRows [data-slot="6"] .lineup-substitute');
      assert.ok((await page.locator('#substituteTargetInfo').textContent()).includes('第 6 棒'));
      const replacement = await page.locator('#substituteNewPlayerSelect option').evaluateAll((opts, names) => opts.find(o => !o.value.startsWith('__') && !names.includes(o.value)).value, game.lineup);
      await page.locator('#substituteNewPlayerSelect').selectOption(replacement);
      await click(page,'button[onclick="confirmSubstitution()"]');
      game = await state(page);
      assert.equal(game.lineup[5],replacement);
      assert.equal(game.currentBatterIdx,1);
      assert.equal(game.substitutions.at(-1).slot,6);
      assert.deepEqual(game.startingLineup,starters);
      assert.deepEqual(game.startingPositions,startingPositions);
      assert.equal(JSON.stringify(game.innings[0].plateAppearances[0]),play);
      // Fielding edits and pitcher UI use one source of truth.
      await page.locator('#liveLineupRows [data-slot="6"] .lineup-position').selectOption('P');
      game = await state(page);
      assert.equal(game.pitcherName,replacement);
      assert.equal(new Set(game.lineupPositions).size,11);
      await click(page,'button[onclick="switchInningNext()"]');
      assert.ok((await page.locator('#liveLineupStatus').textContent()).includes('下次打擊'));
      await page.locator('#defensePitcherSelect').selectOption(game.lineup[2]);
      game = await state(page);
      assert.equal(game.lineupPositions[2],'P');
      await click(page,'button[onclick="recordDefenseEvent(\'GO\')"]');
      const defense = (await state(page)).innings.at(-1).defensiveEvents[0];
      assert.equal(defense.pitcher,game.lineup[2]);
      // Reload restores the edited order and position history.
      const saved = await state(page);
      await page.reload();
      await page.waitForFunction(() => window.LineupModel);
      await page.evaluate(() => switchMainTab('tabScorebook'));
      assert.deepEqual(await state(page),saved);
      assert.equal(await page.locator('#liveLineupRows .lineup-position').nth(2).inputValue(),'P');
      await page.locator('#liveLineupCard').screenshot({path:path.join(output,`${engine}-${width}-lineup-live.png`)});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1);
      assert.equal(overflow,false,'no horizontal page overflow');
      const controls = await page.locator('#liveLineupRows select, #liveLineupRows button').evaluateAll(nodes => nodes.map(n => { const r=n.getBoundingClientRect();return {w:r.width,h:r.height};}));
      assert.ok(controls.every(r => r.w >= 75 && r.h >= 44), 'usable controls');
      // In-game DH toggle preserves the original snapshots and normalizes current positions.
      await click(page,'#btnLiveToggleDh');
      game = await state(page);
      assert.equal(game.lineup.length,10);
      assert.equal(game.lineupPositions.includes('DH'),false);
      assert.deepEqual(game.startingPositions,startingPositions);
      await click(page,'#btnLiveToggleDh');
      game = await state(page);
      assert.equal(game.lineup.length,11);
      assert.equal(game.lineupPositions.filter(p=>p==='DH').length,1);
      // Runner outs do not advance the highlight; undo restores the correct batter.
      await click(page,'button[onclick="switchInningNext()"]');
      await click(page,'button[onclick="recordQuickWalk()"]');
      const beforeRunner = (await state(page)).currentBatterIdx;
      await click(page,'button[onclick="recordRunnerOut()"]');
      assert.equal((await state(page)).currentBatterIdx,beforeRunner);
      await page.evaluate(() => {const inn=activeGame.innings.at(-1); deleteInningPlay(inn.plateAppearances.length-1); deleteInningPlay(inn.plateAppearances.length-1);});
      assert.equal(Number(await page.locator('.lineup-current').getAttribute('data-slot')),beforeRunner);
      // Guest replacement uses the same row/position path and stays outside the official roster.
      await page.evaluate(() => {guestPlayers.push({name:'測試支援',jersey:'999'});syncJerseyMaps();});
      await click(page,'#liveLineupRows [data-slot="3"] .lineup-substitute');
      await page.locator('#substituteNewPlayerSelect').selectOption('測試支援');
      await click(page,'button[onclick="confirmSubstitution()"]');
      game = await state(page);
      assert.equal(game.pitcherName,'測試支援');
      assert.equal(game.lineup[2],'測試支援');
      assert.equal(await page.evaluate(() => Object.values(JERSEY_TO_NAME).includes('測試支援')),false);
      // Duplicate substitution is blocked even if injected into the select, and no-op is not recorded.
      const beforeDuplicate = JSON.stringify(await state(page));
      await click(page,'#liveLineupRows [data-slot="3"] .lineup-substitute');
      await page.evaluate(() => {
        const select=document.getElementById('substituteNewPlayerSelect');
        select.add(new Option(activeGame.lineup[0],activeGame.lineup[0])); select.value=activeGame.lineup[0];
      });
      await click(page,'button[onclick="confirmSubstitution()"]');
      assert.equal(JSON.stringify(await state(page)),beforeDuplicate);
      await page.locator('#substituteNewPlayerSelect').selectOption('測試支援');
      await click(page,'button[onclick="confirmSubstitution()"]');
      assert.equal(JSON.stringify(await state(page)),beforeDuplicate);
      // Advancing across 11 -> 1 keeps the highlight visible within the scrolling card.
      await page.evaluate(() => changeCurrentBatterIndex(10));
      assert.equal(await page.locator('.lineup-current').getAttribute('data-slot'),'11');
      assert.ok(await page.locator('#liveLineupRows').evaluate(el => el.scrollTop > 0));
      await page.reload(); await page.waitForFunction(() => window.LineupModel);
      await page.evaluate(() => switchMainTab('tabScorebook'));
      assert.ok(await page.locator('#liveLineupRows').evaluate(el => el.scrollTop > 0),'restored current slot is visible');
      await click(page,'button[onclick="recordQuickWalk()"]');
      assert.equal(await page.locator('.lineup-current').getAttribute('data-slot'),'1');
      // Legacy games show only known positions, never invented assignments.
      await page.evaluate(() => {delete activeGame.lineupPositions; delete activeGame.startingPositions; renderLiveScorer();});
      assert.ok(await page.locator('#liveLineupRows .lineup-position').evaluateAll(nodes => nodes.filter(n=>n.value==='').length >= 8));
      // No-DH home start: 10 unique fielders and a next-up label during our defense.
      await newGame(page,false,'後攻');
      await click(page,'button[onclick="startNewGameFromSetup()"]');
      game = await state(page);
      assert.equal(game.lineupPositions.length,10);
      assert.equal(new Set(game.lineupPositions).size,10);
      assert.ok((await page.locator('#liveLineupStatus').textContent()).includes('下次打擊'));
      assert.deepEqual(errors,[]);
      results.push({engine,width,passed:true});
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({passed:true,results}));
})().catch(e => {console.error(e);process.exitCode=1;});
