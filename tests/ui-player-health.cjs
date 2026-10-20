// UI + cloud + statistics integration, isolated in-memory preview only.
const assert = require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), os=require('node:os'), crypto=require('node:crypto');
const {chromium,webkit}=require('playwright');
const url=process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output=process.env.UI_QA_OUTPUT || path.join(os.tmpdir(),'baseball-ui-qa');
const formal=path.join(__dirname,'../data');
const hashes=()=>Object.fromEntries(fs.readdirSync(formal).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(formal,f))).digest('hex')]));
const before=hashes();
const ready=p=>p.waitForFunction(()=>window.teamRecords && PlayerHealthStore.status().ready && !syncStatusBadge.textContent.includes('連線同步中'));
const open=p=>p.evaluate(()=>switchMainTab('tabHealth'));
const player=p=>p.evaluate(()=>getFullAgg().players.find(p=>p.bip>2).name);
const stats=(p,name)=>p.evaluate(n=>{const p=getFullAgg().players.find(p=>p.name===n);return Object.fromEntries(['pa','ab','h','bip','pull','cent','oppo','direction_n','directionTracked','avg','ops','xba'].map(k=>[k,p[k]]));},name);
async function save(p,bats) {
  await p.locator('[name="bats"]').selectOption(bats);
  await p.locator('[data-health-form] button[type="submit"]').click();
  await p.waitForFunction(()=>!PlayerHealthStore.status().busy && !PlayerHealthStore.status().pending);
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});const results=[];
  for(const [engine,width] of [['chrome',320],['chrome',390],['chrome',768],['chrome',1440],['webkit',390]]) {
    const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome',headless:true}));
    try {
      const c=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024});
      let external=0;await c.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,r=>{external++;return r.abort();});
      const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await ready(p);await open(p);
      const name=await player(p);await p.locator('[data-health-player]').selectOption(name);
      assert.match(await p.locator('#panelHealth').textContent(),/公開讀取/);
      assert.equal(await p.locator('#btnTabGlossary').evaluate(e=>e.nextElementSibling.id),'btnTabHealth');
      await p.waitForFunction(()=>uiPageTitle.textContent==='球員健康資料');
      await p.locator('[name="heightCm"]').fill('178.5');await p.locator('[name="weightKg"]').fill('72.3');
      await p.locator('[name="birthDate"]').fill('2004-02-29');await p.locator('[name="throws"]').selectOption('R');
      await save(p,'R');const right=await stats(p,name);
      await save(p,'L');const left=await stats(p,name);
      assert.equal(left.pull,right.oppo);assert.equal(left.oppo,right.pull);assert.equal(left.cent,right.cent);
      for(const k of ['pa','ab','h','bip','avg','ops','xba'])assert.equal(left[k],right[k],k+' unchanged');
      const cloud=await p.evaluate(async()=> (await fetchGitHubContent('data/health.json')).content);
      assert.equal(cloud[name].heightCm,178.5);assert.equal(cloud[name].weightKg,72.3);assert.equal(cloud[name].birthDate,'2004-02-29');
      assert.match(await p.locator('[data-health-birthday]').textContent(),/雙魚座/);
      const rosterBirthday = await p.locator(`[data-health-name="${name}"] [data-roster-birthday]`).textContent();
      assert.match(rosterBirthday,/\d+ 歲/);assert.match(rosterBirthday,/♓ 雙魚座/);
      await p.screenshot({path:path.join(output,`${engine}-${width}-health.png`),fullPage:true});
      await p.evaluate(n=>{selectedPlayerName=n;switchMainTab('tabProfile');},name);
      const bio = p.locator('#playerProfileBio [data-profile-health]');
      assert.match(await bio.textContent(),/身高 178\.5 cm/);assert.match(await bio.textContent(),/體重 72\.3 kg/);
      assert.match(await bio.textContent(),/\d+ 歲/);assert.match(await bio.textContent(),/♓ 雙魚座/);
      const portrait = p.locator('#playerProfileBio div[onclick="triggerAvatarUpload()"] > :first-child');
      // Existing hover:scale-105 is animated. Compare fixed layout dimensions, not a mid-transition transform.
      await p.mouse.move(0,0);
      const layoutSize = () => portrait.evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight}));
      const withInfo = await layoutSize();
      assert.deepEqual([withInfo.width,withInfo.height],width<768 ? [120,120] : [144,144]);
      await bio.evaluate(el=>el.remove());
      const withoutInfo = await layoutSize();
      assert.deepEqual([withInfo.width,withInfo.height],[withoutInfo.width,withoutInfo.height],'health info must not resize the original avatar');
      await p.evaluate(()=>renderPlayerProfile(getAnalysisAgg()));
      assert.equal(await p.locator('#playerProfileBio [data-profile-health]').count(),1,'rerender never duplicates health information');
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'profile health fits viewport');
      await portrait.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
      await p.locator('#playerProfileBio').screenshot({path:path.join(output,`${engine}-${width}-profile-health.png`)});
      await open(p);
      await p.reload();await ready(p);await open(p);await p.locator('[data-health-player]').selectOption(name);
      assert.equal(await p.locator('[name="heightCm"]').inputValue(),'178.5');assert.equal(await p.locator('[name="bats"]').inputValue(),'L');
      // Unknown sides show missing values instead of classifying everyone as right handed.
      await save(p,'U');assert.equal((await stats(p,name)).directionTracked,false);
      const unknown=await p.evaluate(n=>{selectedPlayerName=n;renderPlayerProfile(getFullAgg());return playerProfileCard.textContent;},name);
      assert.match(unknown,/打擊側或方向樣本待補/);
      // A failed write survives a reload and can be retried without losing entered measurements.
      await open(p);await p.evaluate(()=>window.__previewFailWrites=true);
      await p.locator('[name="weightKg"]').fill('74.5');await p.locator('[data-health-form] button[type="submit"]').click();
      await p.waitForFunction(()=>PlayerHealthStore.status().pending===1 && !PlayerHealthStore.status().busy);
      await p.reload();await ready(p);await open(p);await p.locator('[data-health-player]').selectOption(name);
      assert.equal(await p.locator('[name="weightKg"]').inputValue(),'74.5');
      await p.locator('[data-health-retry]').click();await p.waitForFunction(()=>!PlayerHealthStore.status().pending);
      await save(p,'S');
      await p.evaluate(n=>{setDhRule(false);switchMainTab('tabScorebook');loadLineupIntoGameSetup('recommended');const i=setupLineupList.indexOf(n);if(i>=0)[setupLineupList[0],setupLineupList[i]]=[setupLineupList[i],setupLineupList[0]];else setupLineupList[0]=n;renderSetupLineupGrid();},name);
      await p.locator('#setup_game_opponent').fill('隔離健康資料QA');await p.locator('button[onclick="startNewGameFromSetup()"]').click();
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'live card has no page overflow');
      await p.locator('#liveCurrentBatterCard').screenshot({path:path.join(output,`${engine}-${width}-health-live-side.png`)});
      await p.evaluate(()=>{selectFieldPosition('RF');selectTrajectory('line');selectOutcome('1H');submitBattedBallPlay();});
      assert.equal(await p.evaluate(()=>activeGame.innings[0].plateAppearances.length),0,'switch hitter must specify side');
      await p.locator('[data-live-batting-side]').selectOption('L');
      await p.locator('button[onclick="submitBattedBallPlay()"]').click();
      const pa=await p.evaluate(()=>activeGame.innings[0].plateAppearances[0]);assert.equal(pa.battingSide,'L');
      assert.equal(await p.locator('[data-live-batting-side]').inputValue(),'','override does not leak to next batter');
      // Review side is editable and read by the shared form reader.
      const review=await p.evaluate(()=>{const g=JSON.parse(JSON.stringify(activeGame));allGames.push(g);selectedReviewGameId=g.id;isEditingReviewGame=true;renderSelectedGameReview(g.id);const s=document.getElementById('edit_play_side_0_0');s.value='R';applyReviewFormToGame(g);return {side:g.innings[0].plateAppearances[0].battingSide,direction:buildGameLogs(g)[0]};});
      assert.equal(review.side,'R');
      if(engine==='chrome' && width===1440) {
        // An independent device loaded before A saves must preserve A's profile when saving another player.
        const other=await browser.newContext({viewport:{width:1440,height:900}});
        await other.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,r=>r.abort());
        const b=await other.newPage();await b.goto(url);await ready(b);await open(b);
        const names=await b.locator('[data-health-player] option').evaluateAll(o=>o.map(x=>x.value));
        const second=names.find(n=>n!==name);await b.locator('[data-health-player]').selectOption(second);
        await open(p);await p.locator('[data-health-player]').selectOption(name);await p.locator('[name="weightKg"]').fill('79.1');await save(p,'R');
        await b.locator('[name="weightKg"]').fill('81.2');await save(b,'L');
        const merged=await b.evaluate(async()=> (await fetchGitHubContent('data/health.json')).content);
        assert.equal(merged[name].weightKg,79.1);assert.equal(merged[second].weightKg,81.2);
        await other.close();
      }
      // Health page is usable at narrow widths, with all ten existing pages still present.
      await open(p);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow');
      assert.deepEqual(errors,[]);assert.equal(external,0);
      results.push({engine,width,passed:true});await c.close();
    }finally{await browser.close();}
  }
  assert.deepEqual(hashes(),before,'formal data files stay byte-identical');
  console.log(JSON.stringify({passed:results.length,results}));
})().catch(e=>{console.error(e);process.exitCode=1;});
