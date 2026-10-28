// Presentation-only checks against isolated fixtures; every external write is blocked.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {dataReady,scrollSettled}=require('./ui-wait.cjs');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
(async()=>{
 for(const [engine,touch,width]of [['chrome',true,390],['webkit',true,390],['chrome',true,1024],['chrome',false,1440]]){
  const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch());
  try{
   const context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,serviceWorkers:'block'});
   await context.route('**/*',r=>!['GET','HEAD'].includes(r.request().method())||/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(r.request().url())?r.abort():r.continue());
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url);await dataReady(page);await page.evaluate(()=>switchMainTab('tabOverview'));
   await page.waitForTimeout(800);
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundAttachment),'scroll','body has no repainting fixed background');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.body,'::before').position),'fixed','scene uses a fixed surface');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#teamSummaryCards > div')).textShadow),'none','content text does not carry glass-bar shadows');
   await page.locator('#flToolsButton').click();await page.waitForSelector('body.fl-tools-open');
   if(touch)assert.equal(await page.evaluate(()=>document.querySelectorAll('.fl-lens-on').length),0,'touch surfaces do not generate SVG lenses');
   await page.keyboard.press('Escape');await page.waitForSelector('body:not(.fl-tools-open)');
   if(width<768){await page.locator('#uiMoreNavigation').click();assert.equal(await page.locator('#mainNavigation').isVisible(),true);await page.keyboard.press('Escape');}
   await page.evaluate(()=>window.scrollTo({top:300,behavior:'instant'}));
   await page.waitForFunction(()=>document.documentElement.hasAttribute('data-fl-scrolling'));
   const lens=await page.evaluate(()=>{
    const el=document.getElementById('appHeader');return {active:getComputedStyle(el).getPropertyValue('--fl-active-lens'),value:getComputedStyle(el).backdropFilter};
   });
   if(!touch)assert.ok(lens.active.includes('blur('));
   assert.ok(!lens.value.includes('url('),'scrolling uses blur even when a desktop lens is applied inline');
   await scrollSettled(page);await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-fl-scrolling'));
   if(engine==='chrome'){
    const releases=await page.evaluate(async()=>{
     const original=ResizeObserver.prototype.unobserve;let count=0;
     ResizeObserver.prototype.unobserve=function(el){count++;return original.call(this,el);};
     try{const node=document.createElement('div');node.style.cssText='width:80px;height:40px';document.body.append(node);flRefract(node);node.remove();switchMainTab('tabAnalytics');await PageRendering.settled();return count;}
     finally{ResizeObserver.prototype.unobserve=original;}
    });
    assert.ok(releases>0,'page navigation releases detached lens observers');
   }
   await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>document.querySelectorAll('.fl-lens-on').length),0,'reduce-motion preference clears lenses');
   assert.deepEqual(errors,[]);await context.close();console.log(engine+' '+width+' glass fallback and scroll lifecycle PASS');
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
