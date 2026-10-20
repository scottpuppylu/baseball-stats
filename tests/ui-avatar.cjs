// Focused regression for mobile portrait size, unobstructed photo, and upload access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(),'baseball-ui-qa');
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser = await chromium.connectOverCDP(process.env.UI_CDP_URL || 'http://127.0.0.1:7293');
  const results=[];
  try {
    for (const [width,height] of [[320,568],[390,844],[430,932],[1440,900]]) {
      const context=await browser.newContext({viewport:{width,height},hasTouch:width<768});
      try {
        await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//,route=>route.abort());
        const page=await context.newPage();
        await page.goto(process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321');
        await page.waitForFunction(()=>window.teamRecords && PlayerHealthStore.status().ready && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
        if(width<768) await page.locator('#uiMoreNavigation').click();
        await page.locator('#btnTabProfile').click();
        assert.equal(await page.getByRole('button',{name:'更換選手照片',exact:true}).count(),0,'redundant photo button is removed');
        const portrait=page.locator('#playerProfileBio div[onclick="triggerAvatarUpload()"]');
        await portrait.scrollIntoViewIfNeeded();
        const photo=await portrait.locator(':scope > :first-child').boundingBox();
        const camera=await portrait.locator(':scope > :last-child').boundingBox();
        assert.ok(photo.width>=120 && photo.height>=120,'portrait should be large enough to recognize');
        assert.deepEqual([photo.width,photo.height],width<768 ? [120,120] : [144,144],'preserve the approved avatar dimensions');
        if(width<768) {
          // Beside or below the photo, never on top of it.
          assert.ok(camera.x>=photo.x+photo.width||camera.y>=photo.y+photo.height,'camera must not overlap portrait');
          assert.ok(camera.x+camera.width<=width,'camera remains inside viewport');
          assert.equal(await portrait.locator(':scope > :nth-child(2)').isVisible(),false,'touch hover overlay must not obscure portrait');
        }
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'page must not overflow');
        await page.screenshot({path:path.join(output,`${width}-Avatar.png`)});
        const chooser=page.waitForEvent('filechooser');
        // Desktop's existing hover overlay covers the image but is inside this clickable avatar wrapper.
        await portrait.click({position:{x:photo.width/2,y:photo.height/2}});
        assert.equal((await chooser).isMultiple(),false,'clicking the avatar still opens original upload control');
        assert.deepEqual(await page.evaluate(()=>window.__previewWrites),[],'inspection must not write data');
        results.push({width,height,photo,camera,uploadAccessible:true});
      } finally {await context.close();}
    }
    fs.writeFileSync(path.join(output,'avatar-report.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({passed:results.length,output}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
