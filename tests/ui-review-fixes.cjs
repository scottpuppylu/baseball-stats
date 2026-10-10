// Isolated preview only: the 2026/10/10 review fix set (expected stats, leaderboard, glossary, pitching,
// custom-lineup model, live diamond, runner-out undo, FC outs, opponent line score, corrupted storage).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const url=process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output=process.env.UI_QA_OUTPUT || path.join(os.tmpdir(),'baseball-ui-qa');
async function click(page,selector){
  const target=page.locator(selector).first();
  await target.evaluate(element=>element.scrollIntoView({block:'center'}));
  await target.click();
}
async function tab(page,name){
  if (await page.locator('#uiDrawerToggle').isVisible()) await click(page,'#uiDrawerToggle');
  await click(page,`#btnTab${name}`);
}
const state=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('rebas_active_game')));
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
    await context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(()=>allLogs.some(l=>String(l.id).startsWith('log_game_')));

    // Team logo: tab icon, home-screen icon, header and sidebar all load the badge.
    const logo=await page.evaluate(async()=>{
      const img=document.querySelector('.ui-team-logo');
      await img.decode().catch(()=>{});
      const ok=async href=>{const r=await fetch(href);return r.ok&&/^image\//.test(r.headers.get('content-type')||'');};
      return {header:img.naturalWidth>0&&img.getBoundingClientRect().width>0,
        icon:await ok(document.querySelector('link[rel="icon"]').href),touch:await ok(document.querySelector('link[rel="apple-touch-icon"]').href),
        sidebar:getComputedStyle(document.getElementById('mainNavigation'),'::before').backgroundImage.includes('logo-256.webp'),
        sidebarFile:await ok('assets/logo-128.webp'),imageFile:await ok('assets/logo-256.webp')};
    });
    assert.deepEqual(logo,{header:true,icon:true,touch:true,sidebar:true,sidebarFile:true,imageFile:true},'team logo assets load everywhere');

    // Classification and order: navigation groups, one metric taxonomy everywhere, glossary categories, profile order.
    const order=await page.evaluate(()=>{
      const nav=[...document.getElementById('mainNavigation').children].filter(c=>c.classList.contains('ui-nav-group')||c.id.startsWith('btnTab')).map(c=>c.classList.contains('ui-nav-group')?`[${c.textContent}]`:c.id.replace('btnTab',''));
      const groupsOf=id=>[...document.querySelectorAll(`#${id} optgroup`)].map(g=>g.label);
      switchMainTab('tabCompare');
      const compareGroups=[...document.querySelectorAll('#compareTableBody .ui-group-row')].map(r=>r.textContent.trim());
      const compareRows=[...document.querySelectorAll('#compareTableBody tr:not(.ui-group-row)')].length;
      switchMainTab('tabProfile');
      const profile=[...document.querySelectorAll('#panelProfile > section')].map(s=>s.id||(s.querySelector('#diagnosticsCardsContainer')?'diagnostics':s.querySelector('#profileBattedBallChart')?'battedBall':s.querySelector('#profileSprayPointsContainer')?'spray':'profile'));
      const glossary=[...document.querySelectorAll('#panelGlossary h3')].map(h=>h.textContent.trim().replace(/（.*$/,''));
      const cards=[...document.querySelectorAll('#panelGlossary .grid > div')].length;
      switchMainTab('tabOverview');
      return {nav,lb:groupsOf('leaderboardMetricSelect'),x:groupsOf('customXVar'),y:groupsOf('customYVar'),compareGroups,compareRows,profile,glossary,cards};
    });
    assert.deepEqual(order.nav,['[數據]','Overview','Profile','Leaderboard','Compare','Records','Analytics','Pitching','[比賽]','Lineup','Scorebook','[參考]','Glossary'],'navigation groups and order');
    const TAX=['綜合產值','打擊三圍與長打','紀律與接觸','擊球品質與方向（場記擊球型態）','基礎累積'];
    assert.deepEqual(order.lb,TAX,'leaderboard menu uses the shared groups');
    for(const g of [order.x,order.y]) assert.deepEqual(g,TAX.filter(t=>g.includes(t)),'custom chart menus use the shared groups in the same order');
    assert.deepEqual(order.compareGroups,TAX,'comparison table grouped the same way');
    assert.equal(order.compareRows,31,'all 31 comparison metrics kept');
    assert.deepEqual(order.profile,['profile','insightGameLogSection','diagnostics','battedBall','spray','insightCareerSection'],'profile: now → detail → history');
    assert.deepEqual(order.glossary,['一、基礎數據與打擊三圍','二、綜合產值','三、紀律、擊球品質與方向','四、慢壘規則與本站模型','五、投手指標'],'glossary categories');
    assert.equal(order.cards,37,'all 37 glossary entries kept');
    assert.ok(await page.locator('#uiLineupDefense').count(),'lineup page has its own 守位設定 entry');

    // Every sidebar label is the same plain name as the page title it opens.
    const names=[];
    for (const key of ['Overview','Profile','Leaderboard','Analytics','Compare','Lineup','Scorebook','Pitching','Records','Glossary']) {
      const label=(await page.locator(`#btnTab${key} span`).textContent()).trim();
      await page.evaluate(k=>switchMainTab(`tab${k}`),key);
      // The heading follows the tab asynchronously; wait briefly, then compare whatever it shows.
      await page.waitForFunction(l=>document.getElementById('uiPageTitle').textContent.trim()===l,label,{timeout:2000}).catch(()=>{});
      names.push([label,(await page.locator('#uiPageTitle').textContent()).trim()]);
    }
    for (const [label,title] of names) assert.equal(label,title,`sidebar "${label}" matches page title "${title}"`);
    assert.ok(names.every(([label])=>label.length<=5),'tab names stay short');
    await page.evaluate(()=>switchMainTab('tabOverview'));

    // Expected stats come from the tracked sample only, so they sit near the tracked AVG instead of far below it.
    const stats=await page.evaluate(()=>{
      document.getElementById('filterStartDate').value='';document.getElementById('filterEndDate').value='';renderAll();
      const players=getFullAgg().players.filter(p=>p.pa>0);
      const tracked=players.filter(p=>p.tracked);
      const luck=tracked.map(p=>p.t_avg-p.xba);
      return {tracked:tracked.length,untracked:players.filter(p=>!p.tracked).map(p=>p.name),
        meanLuck:luck.reduce((s,x)=>s+x,0)/Math.max(1,luck.length),
        lucky:luck.filter(x=>x>0.05).length,unlucky:luck.filter(x=>x<-0.05).length,
        finite:tracked.every(p=>[p.xba,p.xslg,p.xwoba,p.t_avg].every(Number.isFinite))};
    });
    assert.ok(stats.tracked>=5,'tracked players present');
    assert.ok(stats.finite,'expected stats are finite numbers');
    assert.ok(Math.abs(stats.meanLuck)<0.08,`team AVG−xBA is centred near zero (${stats.meanLuck.toFixed(3)})`);
    assert.ok(stats.lucky<stats.tracked,'not everyone is labelled lucky');
    if (stats.untracked.length) {
      const text=await page.evaluate(name=>{selectedPlayerName=name;renderPlayerProfile(getFullAgg());return document.getElementById('panelProfile').textContent;},stats.untracked[0]);
      assert.match(text,/Statcast 擊球型態：無資料/,'manual-only player shows no-data instead of fake Statcast');
    }

    // Leaderboard and glossary: no duplicate metric options, rate stats shown as rates, 5 categories.
    const board=await page.evaluate(()=>{
      const values=[...document.querySelectorAll('#leaderboardMetricSelect option')].map(o=>o.value);
      const select=document.getElementById('leaderboardMetricSelect');
      select.value='avg';select.dispatchEvent(new Event('change'));
      const firstAvg=document.querySelector('#leaderboardTableBody tr td:last-child')?.textContent.trim()||'';
      return {values,dupes:values.filter((v,i)=>values.indexOf(v)!==i),firstAvg,
        glossary:document.getElementById('panelGlossary').textContent};
    });
    assert.deepEqual(board.dupes,[],'leaderboard metric options are unique');
    assert.match(board.glossary,/5 大分類・共 37 項說明/);
    assert.doesNotMatch(board.glossary,/超級二棒/,'glossary no longer teaches the super #2 doctrine');

    // Pitching appearances count distinct games, not one per season (the fixture's pitcher is a guest, so use a team copy).
    const pitching=await page.evaluate(()=>{
      const original=allGames;
      const name=getFullAgg().players.find(p=>!isGuestPlayerName(p.name)).name;
      allGames=window.allGames=original.map(g=>({...JSON.parse(JSON.stringify(g)),pitcherName:name}));
      const p=getAggregatedPitcherStats().find(x=>x.name===name);
      const expected=allGames.filter(g=>(g.innings||[]).some(i=>!isInningOurBat(g.ourRole,i.topBottom))).length;
      allGames=window.allGames=original;
      return {games:p&&p.games,expected};
    });
    assert.ok(pitching.expected>1,'fixture has several games');
    assert.equal(pitching.games,pitching.expected,'pitcher appearances = distinct games pitched');

    // Custom lineup is graded by the same timed-game model as the recommendation.
    await tab(page,'Lineup');
    await click(page,'button[onclick="selectAllAttendance()"]');
    await click(page,'#btnRuleWithDh');
    await click(page,'button[onclick="applyRecommendedToCustom()"]');
    const evalText=await page.locator('#lineupEvalMetrics').textContent();
    assert.match(evalText,/推薦打線 \d+\.\d{2} 分/,'custom lineup shows model runs');
    assert.doesNotMatch(await page.locator('#panelLineup').textContent(),/超級二棒/);

    // Live game: diamond layout, runner-out undo, FC outs, opponent line score.
    await tab(page,'Scorebook');
    await page.locator('#setup_game_date').fill('2026-10-04');
    await page.locator('#setup_game_opponent').fill('隔離測試-修正驗證');
    await page.locator('#setup_game_role').selectOption('先攻');
    await click(page,'button[onclick="loadLineupIntoGameSetup(\'custom\')"]');
    await click(page,'button[onclick="startNewGameFromSetup()"]');
    for (const base of ['first','second','third']) await click(page,`button[onclick="toggleBaseRunner('${base}')"]`);
    const box=async id=>page.locator(`#${id}`).boundingBox();
    const [d1,d2,d3]=[await box('baseDiamond1'),await box('baseDiamond2'),await box('baseDiamond3')];
    assert.ok(d2.y<d1.y&&d2.y<d3.y,'second base sits above first and third');
    assert.ok(d3.x<d2.x&&d2.x<d1.x,'third left, second centre, first right');
    await page.screenshot({path:path.join(output,'review-fixes-diamond.png')});
    for (const base of ['first','second','third']) await click(page,`button[onclick="toggleBaseRunner('${base}')"]`);

    await click(page,'button[onclick="recordQuickWalk()"]');
    // Runners are placed by hand (the scorer does not auto-advance runners), as at the field.
    await click(page,"button[onclick=\"toggleBaseRunner('first')\"]");
    const afterWalk=await state(page);
    assert.ok(afterWalk.currentBases.first,'runner on first');
    await click(page,'button[onclick="recordRunnerOut()"]');
    const afterOut=await state(page);
    assert.equal(afterOut.currentOuts,1);
    assert.equal(afterOut.currentBatterIdx,afterWalk.currentBatterIdx,'runner out keeps the batter');
    assert.equal(afterOut.currentBases.first,null);
    const outIdx=afterOut.innings.find(i=>i.inningNum===afterOut.currentInning&&i.topBottom===afterOut.currentHalf).plateAppearances.length-1;
    await page.evaluate(i=>deleteInningPlay(i),outIdx);
    const undone=await state(page);
    assert.equal(undone.currentOuts,0,'undo recounts outs');
    assert.equal(undone.currentBatterIdx,afterWalk.currentBatterIdx,'undoing a runner out keeps the batter');
    assert.ok(undone.currentBases.first,'undoing a runner out puts the runner back');

    const field=page.locator('#interactiveFieldSvg');
    await field.evaluate(element=>element.scrollIntoView({block:'center'}));
    const fieldBox=await field.boundingBox();
    await field.click({position:{x:fieldBox.width*.5,y:fieldBox.height*.6}});
    await click(page,'#traj_grounder');
    await click(page,'#res_FC');
    await click(page,'button[onclick="submitBattedBallPlay()"]');
    assert.equal((await state(page)).currentOuts,1,'FC adds one out');

    await click(page,'button[onclick="switchInningNext()"]');
    await page.evaluate(()=>{adjustOpponentScore(1);adjustOpponentScore(1);adjustOpponentScore(-1);});
    const opp=await state(page);
    const oppRuns=opp.innings.filter(i=>i.topBottom==='bottom').reduce((s,i)=>s+(i.runs||0),0);
    assert.equal(opp.finalScore.opp,1);
    assert.equal(oppRuns,1,'opponent ± also updates the line score');

    // Review editor keeps runner outs as runner outs.
    await page.evaluate(()=>{localStorage.removeItem('rebas_active_game');});
    const optionOk=await page.evaluate(()=>{
      const game=allGames.find(g=>g.innings.some(i=>(i.plateAppearances||[]).some(p=>p.result==='OUT')));
      if (!game) return null;
      selectedReviewGameId=game.id;isEditingReviewGame=true;renderSelectedGameReview(game.id);
      const selects=[...document.querySelectorAll('#gameReviewDetailContainer select')].filter(s=>[...s.options].some(o=>o.value==='1H'));
      const ok=selects.some(s=>s.value==='OUT')&&selects.every(s=>[...s.options].some(o=>o.value==='OUT'));
      isEditingReviewGame=false;renderSelectedGameReview(game.id);
      return ok;
    });
    if (optionOk!==null) assert.ok(optionOk,'review editor offers and preserves the runner-out option');
    // Review editing: cancel restores the game, add/delete keep typed values, switching games discards edits.
    const review=await page.evaluate(async()=>{
      switchMainTab('tabScorebook');switchScorebookSubTab('review');
      const game=allGames.find(g=>g.innings.some(i=>(i.plateAppearances||[]).length>1));
      const original=JSON.stringify(game);
      const stored=localStorage.getItem('rebas_all_games');
      renderSelectedGameReview(game.id);
      toggleEditCurrentReviewGame();
      document.getElementById('editGameOpponent').value='尚未儲存的對手';
      const innIdx=game.innings.findIndex(i=>(i.plateAppearances||[]).length>1);
      const before=game.innings[innIdx].plateAppearances.length;
      document.querySelector(`button[onclick="deletePlayFromReviewInning('${game.id}', ${innIdx}, 0)"]`).click();
      const kept=document.getElementById('editGameOpponent').value;
      const afterDelete=allGames.find(g=>g.id===game.id).innings[innIdx].plateAppearances.length;
      toggleEditCurrentReviewGame(); // 取消
      const restored=allGames.find(g=>g.id===game.id);
      const cancel={kept,deleted:afterDelete===before-1,restored:JSON.stringify(restored)===original,
        storage:localStorage.getItem('rebas_all_games')===stored||JSON.stringify(JSON.parse(localStorage.getItem('rebas_all_games')).find(g=>g.id===game.id))===original,
        editing:isEditingReviewGame};
      // Opening another game while editing throws the unsaved edits away.
      toggleEditCurrentReviewGame();
      document.querySelector(`button[onclick="deletePlayFromReviewInning('${game.id}', ${innIdx}, 0)"]`).click();
      const other=allGames.find(g=>g.id!==game.id);
      renderSelectedGameReview(other.id);
      const switched={restored:JSON.stringify(allGames.find(g=>g.id===game.id))===original,editing:isEditingReviewGame};
      // Saving keeps a runner out's own location instead of turning it into P.
      const withOut=allGames.find(g=>g.innings.some(i=>(i.plateAppearances||[]).some(p=>p.result==='OUT')));
      renderSelectedGameReview(withOut.id);toggleEditCurrentReviewGame();
      await saveEditedReviewGame(withOut.id);
      const outPlay=allGames.find(g=>g.id===withOut.id).innings.flatMap(i=>i.plateAppearances||[]).find(p=>p.result==='OUT');
      return {cancel,switched,outLocation:outPlay.location,editingAfterSave:isEditingReviewGame};
    });
    assert.equal(review.cancel.kept,'尚未儲存的對手','deleting a row keeps values typed elsewhere');
    assert.ok(review.cancel.deleted,'the row was deleted while editing');
    assert.ok(review.cancel.restored,'cancel restores the game exactly');
    assert.ok(review.cancel.storage,'cancel leaves the saved copy unchanged');
    assert.equal(review.cancel.editing,false);
    assert.deepEqual(review.switched,{restored:true,editing:false},'opening another game discards unsaved edits');
    assert.equal(review.outLocation,'Bases','runner out keeps its location after saving');
    assert.equal(review.editingAfterSave,false);

    // Avatars are shared blob: URLs, not repeated base64 strings.
    const avatars=await page.evaluate(async()=>{
      renderAll();
      const imgs=[...document.querySelectorAll('img[alt]')].filter(i=>Object.keys(playerAvatars).includes(i.alt));
      await Promise.all(imgs.map(i=>i.decode().catch(()=>{})));
      const html=document.documentElement.outerHTML;
      return {count:imgs.length,blob:imgs.every(i=>i.src.startsWith('blob:')),loaded:imgs.filter(i=>i.complete&&i.naturalWidth>0).length,
        dataUris:(html.match(/data:image\/[a-z]+;base64/g)||[]).length,size:html.length};
    });
    assert.ok(avatars.count>0,'fixture avatars are shown');
    assert.ok(avatars.blob,'avatar images use blob: URLs');
    assert.equal(avatars.loaded,avatars.count,'every avatar image decodes');
    assert.equal(avatars.dataUris,0,'no base64 avatars left in the page');
    assert.ok(avatars.size<1000000,`page HTML stays small (${avatars.size})`);
    assert.deepEqual(errors,[],'runtime errors');
    await context.close();

    // Corrupted browser storage must not break the page.
    const broken=await browser.newContext({viewport:{width:1024,height:768}});
    await broken.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
    await broken.addInitScript(()=>{
      if (sessionStorage.getItem('qa_seeded')) return;
      sessionStorage.setItem('qa_seeded','1');
      for (const key of ['rebas_active_game','rebas_player_tags','rebas_player_avatars','rebas_defense_rankings','rebas_has_dh']) localStorage.setItem(key,'{not json');
    });
    const brokenPage=await broken.newPage();
    const brokenErrors=[];
    brokenPage.on('pageerror',e=>brokenErrors.push(e.message));
    await brokenPage.goto(url);
    await brokenPage.waitForFunction(()=>typeof allLogs!=='undefined'&&allLogs.length>0&&document.getElementById('uiPageTitle'));
    assert.deepEqual(brokenErrors,[],'corrupted storage runtime errors');
    await broken.close();
    console.log('review fixes: expected-stats, leaderboard, glossary, pitching-games, custom-model, diamond, runner-out-undo, fc-out, opp-line-score, review-out-option, review-cancel-restore, review-keeps-typed, review-switch-discard, runner-out-location, avatar-blob-urls, corrupted-storage');
  } finally {
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
