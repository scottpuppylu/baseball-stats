// Presentation cache contract: no hidden chart work, stable chart instances, fresh data after invalidation.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {scrollToRendered}=require('./ui-wait.cjs');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
(async()=>{
  for(const [name,launch]of[['chrome',()=>chromium.launch({channel:'chrome',headless:true})],['webkit',()=>webkit.launch()]]){
    const browser=await launch();try{
      const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
      await context.route('**/*',r=>!['GET','HEAD'].includes(r.request().method())||/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(r.request().url())?r.abort():r.continue());
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(url);await page.waitForFunction(()=>window.teamRecords&&!syncStatusBadge.textContent.includes('連線同步中'));
      assert.equal(await page.evaluate(()=>Object.keys(Chart.instances).length),0,'startup does not build charts on hidden pages');
      for(const [tab,ids]of[['Analytics',['quadrantChart','customChart','luckRegressionChart']],['Profile',['radarChart','donutChart','profileBattedBallChart','profileSprayPolarChart','profileExpectedChart']]]){
        await page.evaluate(tab=>switchMainTab('tab'+tab),tab);
        for(const id of ids){
          await scrollToRendered(page,page.locator('#'+id));
          await page.waitForFunction(id=>!!Chart.getChart(id),id,{timeout:10000}).catch(async error=>{
            error.chartId=id;
            error.geometry=await page.locator('#'+id).evaluate(el=>{const r=el.getBoundingClientRect(),s=el.closest('section');return{top:r.top,height:r.height,width:r.width,sectionVisibility:s?getComputedStyle(s).contentVisibility:'none',scrollY};});
            throw error;
          });
        }
        await page.evaluate(()=>PageRendering.settled());
        const before=await page.evaluate(ids=>({ids:ids.map(id=>Chart.getChart(id).id),creates:PageRendering.stats.chartCreates}),ids);
        await page.evaluate(()=>switchMainTab('tabHome'));await page.evaluate(tab=>switchMainTab('tab'+tab),tab);
        await page.evaluate(()=>PageRendering.settled());
        const after=await page.evaluate(ids=>({ids:ids.map(id=>Chart.getChart(id).id),creates:PageRendering.stats.chartCreates}),ids);
        assert.deepEqual(after,before,'returning to unchanged '+tab+' keeps the same chart instances');
      }
      await page.evaluate(()=>{switchMainTab('tabRecords');document.querySelector('#panelRecords > :first-child').dataset.cacheProof='kept';});
      await page.evaluate(()=>switchMainTab('tabOverview'));await page.evaluate(()=>switchMainTab('tabRecords'));
      assert.equal(await page.locator('#panelRecords > :first-child').getAttribute('data-cache-proof'),'kept','record markup is restored from its detached cache');
      await page.evaluate(()=>{filterStartDate.value='2099-01-01';renderAll();switchMainTab('tabProfile');});
      assert.equal(await page.evaluate(()=>getAnalysisAgg().players.length),0);
      assert.equal(await page.evaluate(()=>!!Chart.getChart('radarChart')),false,'a dirty empty profile cannot retain its old chart');
      await page.evaluate(()=>{filterStartDate.value='';renderAll();switchMainTab('tabAnalytics');});
      await page.locator('#quadrantChart').scrollIntoViewIfNeeded();await page.waitForFunction(()=>Chart.getChart('quadrantChart')?.data.datasets[0].data.length>0);
      assert.deepEqual(errors,[]);await context.close();console.log(name+': hidden work/cached charts/cached records/filter invalidation PASS');
    }catch(error){error.testCase=name;throw error;}finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
