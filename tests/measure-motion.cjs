// Read-only isolated preview benchmark, never a real-device or production-write claim.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
const output=process.env.UI_METRICS_OUTPUT||path.join(os.tmpdir(),'baseball-motion-metrics.json');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1,serviceWorkers:'block'});
    await context.route('**/*',r=>!['GET','HEAD'].includes(r.request().method())||/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(r.request().url())?r.abort():r.continue());
    const page=await context.newPage();
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.goto(url);await page.waitForFunction(()=>window.teamRecords&&!syncStatusBadge.textContent.includes('連線同步中'));
    await page.waitForTimeout(1200);
    await page.evaluate(()=>{
      window.__motion={frames:[],events:[],charts:0};
      new PerformanceObserver(list=>list.getEntries().forEach(e=>__motion.events.push(e.duration))).observe({type:'event',durationThreshold:16,buffered:true});
      Chart.register({id:'motion-measure',beforeInit(){__motion.charts++;}});
    });
    const changes=[];
    for(const round of ['cold','warm'])for(const tab of ['Analytics','Records','Profile','Scorebook']){
      changes.push(await page.evaluate(async({tab,round})=>{
        const frames=[];let last=performance.now(),running=true;
        const frame=now=>{frames.push(now-last);last=now;if(running)requestAnimationFrame(frame);};requestAnimationFrame(frame);
        const charts=__motion.charts,start=performance.now();switchMainTab('tab'+tab);const syncMs=performance.now()-start;
        if(window.PageRendering?.settled)await PageRendering.settled();
        await new Promise(resolve=>setTimeout(resolve,700));running=false;
        return{tab,round,syncMs:+syncMs.toFixed(1),maxFrameMs:+Math.max(...frames).toFixed(1),newCharts:__motion.charts-charts};
      },{tab,round}));
    }
    await page.evaluate(()=>switchMainTab('tabProfile'));await page.waitForTimeout(600);
    const scroll=await page.evaluate(()=>new Promise(resolve=>{
      const frames=[];let last=performance.now(),start=last;const frame=now=>{frames.push(now-last);last=now;window.scrollBy(0,18);if(now-start<3000)requestAnimationFrame(frame);else resolve({maxFrameMs:+Math.max(...frames).toFixed(1),framesOver25:frames.filter(n=>n>25).length,frames:frames.length});};requestAnimationFrame(frame);
    }));
    const drawer=[];
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);
    for(let i=0;i<3;i++){
      await page.evaluate(()=>{window.__drawerFrames=new Promise(resolve=>{
        const frames=[];let last=performance.now(),start=last;
        const frame=now=>{frames.push(now-last);last=now;if(now-start<700)requestAnimationFrame(frame);else resolve(frames);};requestAnimationFrame(frame);
      });});
      await page.locator('#uiMoreNavigation').click();
      drawer.push(...await page.evaluate(()=>window.__drawerFrames));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    drawer.sort((a,b)=>a-b);
    const result={viewport:'390x844',cpuThrottling:4,engine:'desktop Chrome headless; physical devices NOT_TESTED',changes,scroll,drawer:{p95Ms:+drawer[Math.floor(drawer.length*.95)].toFixed(1),maxFrameMs:+Math.max(...drawer).toFixed(1)},events:await page.evaluate(()=>__motion.events)};
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    await context.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
