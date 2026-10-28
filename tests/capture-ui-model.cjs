// One-time pre/post presentation regression snapshot against a fresh isolated fixture preview.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const url=process.env.UI_PREVIEW_URL||'http://127.0.0.1:54321';
const output=process.env.UI_MODEL_OUTPUT||path.join(os.tmpdir(),'baseball-ui-model.json');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',r=>!['GET','HEAD'].includes(r.request().method())||/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(r.request().url())?r.abort():r.continue());
    const page=await context.newPage();await page.goto(url);
    await page.waitForFunction(()=>window.teamRecords&&!syncStatusBadge.textContent.includes('連線同步中'));
    const captures=[];
    for(const scenario of ['default','ten-batters','date-filter','exclude-chien','eleven-batters']){
      captures.push(await page.evaluate(scenario=>{
        if(scenario==='ten-batters')setDhRule(false);
        if(scenario==='date-filter'){filterStartDate.value='2026-09-20';renderAll();}
        if(scenario==='exclude-chien'){includeChien=false;renderAll();}
        if(scenario==='eleven-batters')setDhRule(true);
        return{scenario,state:{full:getFullAgg(),analysis:getAnalysisAgg(),pitching:getAggregatedPitcherStats(),lineup:[...customLineup],dh:customDhSlot,enabled:isDhEnabled,present:[...presentPlayersSet].sort()}};
      },scenario));
    }
    const result={head:execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}).trim(),release:await page.locator('meta[name="baseball-release"]').getAttribute('content'),captures};
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));
    console.log(JSON.stringify({scenarios:captures.length,output,release:result.release}));await context.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
