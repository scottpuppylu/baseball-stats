// Let the application's own smooth scroll finish before starting the next user interaction.
// Actual clicks still use Playwright visibility/enabled/stability/hit-target checks.
async function scrollSettled(page) {
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    let x=scrollX,y=scrollY,stable=0,done=false;const started=performance.now();
    const timer=setTimeout(()=>{done=true;reject(new Error('Application scroll did not settle'));},5000);
    const frame=()=>{
      if(done)return;
      stable=Math.abs(x-scrollX)<.25&&Math.abs(y-scrollY)<.25?stable+1:0;x=scrollX;y=scrollY;
      if(stable>=4&&performance.now()-started>=120){done=true;clearTimeout(timer);resolve();}
      else requestAnimationFrame(frame);
    };requestAnimationFrame(frame);
  }));
}
async function dataReady(page) {
  await page.waitForFunction(()=>window.LineupModel&&window.teamRecords&&!document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
}
async function scrollToRendered(page,target) {
  for(let attempt=0;attempt<4;attempt++){
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(async()=>{if(window.PageRendering)await PageRendering.settled();else await new Promise(requestAnimationFrame);});
    if(await target.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.top<innerHeight;}))return;
  }
  throw new Error('Target did not enter the viewport after deferred layout');
}
// Density/type audits require real content height, not contain-intrinsic-size estimates.
// Read every section first and retain its realized layout for the audit; restore it afterward.
async function realizeSections(page) {
  const sections=page.locator('main > [id^="panel"]:not(.hidden) > section:visible');
  for(let index=0;index<await sections.count();index++){
    const section=sections.nth(index);
    await section.evaluate(el=>{el.dataset.uiLayoutAudit=el.classList.contains('ui-section-reveal')?'keep':'remove';el.classList.add('ui-section-reveal');});
    await section.scrollIntoViewIfNeeded();
    await page.evaluate(async()=>{if(window.PageRendering)await PageRendering.settled();});
  }
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'auto'}));await scrollSettled(page);
}
async function restoreSections(page) {
  await page.evaluate(()=>document.querySelectorAll('[data-ui-layout-audit]').forEach(el=>{if(el.dataset.uiLayoutAudit==='remove')el.classList.remove('ui-section-reveal');delete el.dataset.uiLayoutAudit;}));
}
module.exports={scrollSettled,dataReady,scrollToRendered,realizeSections,restoreSections};
