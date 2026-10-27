const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium,webkit}=require('playwright');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
const output=process.env.UI_QA_OUTPUT||path.join(os.tmpdir(),'baseball-ui-qa');
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  for(const [name,launch]of[['chrome',()=>chromium.launch({channel:'chrome',headless:true})],['webkit',()=>webkit.launch()]]){
    const browser=await launch();try{
      const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,r=>r.abort());
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url);await page.waitForFunction(()=>window.teamRecords&&!syncStatusBadge.textContent.includes('連線同步中'));
      await page.evaluate(()=>{
        const game=JSON.parse(JSON.stringify(allGames[0]));game.id='qa-review-real-coordinates';game.date='2026-10-28';delete game.sprayChartArchive;
        game.ourRole='先攻';game.innings=[{inningNum:1,topBottom:'top',runs:0,hits:1,plateAppearances:[{id:'old-point',batterName:game.lineup[0],result:'1H',trajectory:'line',location:'LF',x:.2,y:.35,runsScored:0}]}];
        allGames.unshift(game);selectedReviewGameId=game.id;
        switchMainTab('tabScorebook');switchScorebookSubTab('review');renderSelectedGameReview(game.id);toggleEditCurrentReviewGame();
        addPlayToReviewInning(game.id,0);
      });
      const point=()=>page.evaluate(()=>allGames.find(g=>g.id==='qa-review-real-coordinates').innings[0].plateAppearances[1]);
      const pointCount=()=>page.locator('#gameReviewDetailContainer svg circle[stroke="#ffffff"]').count();
      const save=()=>page.evaluate(()=>saveEditedReviewGame('qa-review-real-coordinates'));
      assert.equal(Object.hasOwn(await point(),'x'),false);assert.equal(Object.hasOwn(await point(),'y'),false);
      await save();assert.equal(await pointCount(),1,'adding a play creates no invented spray point');
      await page.evaluate(()=>toggleEditCurrentReviewGame());
      await page.locator('#edit_play_loc_0_1').selectOption('RF');
      await page.evaluate(()=>applyReviewFormToGame(allGames.find(g=>g.id==='qa-review-real-coordinates')));
      assert.equal((await point()).location,'RF');assert.equal(Object.hasOwn(await point(),'x'),false);
      await save();assert.equal(await pointCount(),1,'a position-only edit creates no point');
      await page.evaluate(()=>toggleEditCurrentReviewGame());
      await page.evaluate(()=>editReviewLandingPoint('qa-review-real-coordinates',0,1));
      const field=page.locator('#reviewLandingPointModal svg'),rect=await field.boundingBox();
      await field.click({position:{x:rect.width*.75,y:rect.height*.3}});
      assert.equal(Object.hasOwn(await point(),'x'),false,'a preview click alone does not change the record');
      await page.locator('#reviewLandingPointModal').screenshot({path:path.join(output,name+'-review-real-point.png')});
      await page.locator('[data-point-accept]').click();
      const saved=await point();assert.ok(saved.x>.73&&saved.x<.77&&saved.y>.28&&saved.y<.32);assert.equal(saved.location,'RF');
      await save();assert.equal(await pointCount(),2,'only a confirmed actual coordinate adds a point');
      const old=await page.evaluate(()=>allGames.find(g=>g.id==='qa-review-real-coordinates').innings[0].plateAppearances[0]);
      assert.deepEqual([old.x,old.y],[.2,.35],'an old matching coordinate is never cleared automatically');
      await page.evaluate(()=>{
        const game=allGames.find(g=>g.id==='qa-review-real-coordinates'),plays=game.innings[0].plateAppearances;
        plays.push({...plays[0],x:null},{...plays[0],x:NaN},{...plays[0],x:Infinity});renderSelectedGameReview(game.id);
      });
      assert.equal(await pointCount(),2,'null, NaN and infinite coordinates are not plotted');
      await page.evaluate(()=>{allGames.find(g=>g.id==='qa-review-real-coordinates').innings[0].plateAppearances.length=2;toggleEditCurrentReviewGame();});
      // Native dialog cancellation and review cancellation both retain the established snapshot semantics.
      await page.evaluate(()=>editReviewLandingPoint('qa-review-real-coordinates',0,0));
      await page.locator('[data-point-cancel]').click();
      assert.equal(await page.evaluate(()=>allGames.find(g=>g.id==='qa-review-real-coordinates').innings[0].plateAppearances[0].x),.2);
      await page.evaluate(()=>addPlayToReviewInning('qa-review-real-coordinates',0));
      await page.evaluate(()=>toggleEditCurrentReviewGame());
      assert.equal(await page.evaluate(()=>allGames.find(g=>g.id==='qa-review-real-coordinates').innings[0].plateAppearances.length),2);
      assert.equal(await pointCount(),2);
      await page.evaluate(()=>{toggleEditCurrentReviewGame();editReviewLandingPoint('qa-review-real-coordinates',0,1);});
      await page.locator('#reviewLandingPointModal svg').press('ArrowRight');
      await page.locator('[data-point-accept]').click();
      assert.ok(Math.abs((await point()).x-saved.x-.0125)<1e-9,'keyboard micro-adjustment follows the selected point');
      await page.evaluate(()=>toggleEditCurrentReviewGame());
      assert.equal((await point()).x,saved.x);
      await page.evaluate(()=>{toggleEditCurrentReviewGame();editReviewLandingPoint('qa-review-real-coordinates',0,1);});
      await page.locator('[data-point-clear]').click();
      assert.equal(Object.hasOwn(await point(),'x'),false,'explicit clearing is limited to the selected play');
      await page.evaluate(()=>toggleEditCurrentReviewGame());
      assert.equal((await point()).x,saved.x,'cancel restores a point cleared in an unsaved review');
      assert.equal(await pointCount(),2);
      assert.deepEqual(errors,[]);await context.close();console.log(name+': absent coordinates/position-only/explicit selection/historical preservation/cancel PASS');
    }finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
