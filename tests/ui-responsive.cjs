// Run against tests/ui-preview-server.cjs only. Playwright may be provided via NODE_PATH.
// Example: UI_CDP_URL=http://127.0.0.1:7293 node tests/ui-responsive.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
fs.mkdirSync(output, {recursive: true});
const pages = ['Overview','Profile','Leaderboard','Analytics','Compare','Lineup','Scorebook','Pitching','Glossary'];
const sizes = [[320,568],[390,844],[844,390],[768,1024],[1024,768],[1440,900],[1920,1080]];
const results = [];
let browser;
const contexts = [];
(async () => {
  browser = process.env.UI_CDP_URL ? await chromium.connectOverCDP(process.env.UI_CDP_URL) : await chromium.launch();
  let externalGitHub = 0;
  for (const [width, height] of sizes) {
    const context = await browser.newContext({viewport: {width,height}, isMobile: width < 768, hasTouch: width < 1024});
    contexts.push(context);
    await context.addInitScript(games => localStorage.setItem('rebas_all_games', JSON.stringify(games)), JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'games.json'), 'utf8')));
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('uiPageTitle') && document.getElementById('syncStatusBadge').textContent.includes('同步'));
    for (const name of pages) {
      if (width < 768) await page.locator('#uiMoreNavigation').click();
      else if (await page.locator('#uiDrawerToggle').isVisible()) await page.locator('#uiDrawerToggle').click();
      await page.locator(`#btnTab${name}`).click();
      await page.waitForFunction(name => !document.getElementById(`panel${name}`).classList.contains('hidden') && document.querySelector(`#btnTab${name}[aria-current="page"]`), name);
      const measure = await page.evaluate(() => {
        const clipped = [...document.querySelectorAll('main button, main input, main select')].filter(el => {
          if (!el.getClientRects().length) return false;
          const r = el.getBoundingClientRect();
          if (r.left >= -1 && r.right <= innerWidth + 1) return false;
          let parent = el.parentElement;
          while (parent && parent !== document.body) {
            if (['auto','scroll'].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth + 1) return false;
            parent = parent.parentElement;
          }
          return true;
        }).map(el => el.id || el.textContent.trim().slice(0,40));
        // clientWidth excludes a classic (Windows) scrollbar, so compare against it rather than the viewport.
        return {width: innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, clipped};
      });
      results.push({width,height,page:name,...measure});
      assert.ok(measure.scrollWidth <= measure.clientWidth, `${width}: ${name} page overflow (${measure.scrollWidth} > ${measure.clientWidth})`);
      assert.deepEqual(measure.clipped, [], `${width}: ${name} clipped controls`);
      if (name === 'Overview' || (width === 390 && ['Profile','Lineup','Scorebook'].includes(name))) await page.screenshot({path: path.join(output, `${width}-${height}-${name}.png`)});
    }
    assert.deepEqual(errors, [], `${width} runtime errors`);
    // Every original summary column remains reachable through "all".
    if (width < 768) await page.locator('.ui-mobile-nav [data-page="Overview"]').click();
    else { if (await page.locator('#uiDrawerToggle').isVisible()) await page.locator('#uiDrawerToggle').click(); await page.locator('#btnTabOverview').click(); }
    await page.locator('#uiSummaryColumns').selectOption('all');
    assert.equal(await page.locator('#viewSummary thead th:visible').count(), 23);
    if (width < 768) {
      await page.locator('#uiDateToggle').click();
      assert.ok(await page.locator('#filterStartDate').isVisible());
      await page.locator('#filterStartDate').fill('2026-09-01');
      await page.locator('#filterEndDate').fill('2026-09-30');
      await page.locator('#uiDateToggle').click();
      assert.match(await page.locator('#uiDateToggle').textContent(), /2026-09-01/);
      await page.setViewportSize({width: 844, height: 390});
      assert.equal(await page.locator('#filterStartDate').inputValue(), '2026-09-01');
      await page.setViewportSize({width, height});
      assert.equal(await page.locator('#filterEndDate').inputValue(), '2026-09-30');
      await page.locator('#uiMoreNavigation').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#uiMoreNavigation').getAttribute('aria-expanded'), 'false');
    }
    // Coach settings must fit and close without altering saved data.
    await page.locator('button[onclick="openDefenseModal()"]').click();
    const bounds = await page.locator('#defenseModal > div').boundingBox();
    await page.screenshot({path: path.join(output, `${width}-${height}-Defense.png`)});
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `${width}x${height} modal bounds ${JSON.stringify(bounds)}`);
    await page.locator('#defenseModal button[onclick="closeDefenseModal()"]').first().click();
    await context.close();
  }
  assert.equal(externalGitHub, 0, 'preview must not contact real GitHub');
  const report = {layouts: results.length, externalGitHubRequests: externalGitHub, results};
  fs.writeFileSync(path.join(output, 'responsive-report.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({layouts: results.length, output, externalGitHubRequests: externalGitHub}));
  // Disconnect only: the agent-browser session remains available for review.
  await browser.close();
})().catch(async error => {
  fs.writeFileSync(path.join(output,'failure.json'), JSON.stringify({error:error.message,results},null,2));
  console.error(error.message);
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser?.close();
  process.exitCode = 1;
});
