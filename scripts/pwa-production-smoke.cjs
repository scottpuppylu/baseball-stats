// Read-only production verification. Block every non-GET/HEAD request before loading the page.
// Never save HTML or headers: the approved legacy credential exists only in the original page.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'https://scottpuppylu.github.io/baseball-stats/';
const output = process.env.PWA_SMOKE_OUTPUT || path.join(root, 'outputs', 'pwa-release');
const expected = process.env.PWA_EXPECTED_COMMIT || 'HEAD';
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const normalized = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
// Build expected bytes in memory from exact Git blobs; never create another credential-bearing HTML file.
const built = require('./build-pwa.cjs').build(file => execFileSync('git', ['show', `${expected}:${file}`], {cwd: root}));
(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const report = {at: new Date().toISOString(), url: base, expectedCommit: git('rev-parse', expected), readOnly: true, assets: [], pages: [], errors: [], blockedWrites: []};
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({viewport: {width, height: 900}});
      // Page fetch is guarded before a worker can see the request; routing below is a second barrier.
      await context.exposeBinding('__recordReadOnlyBlock', (_source, record) => report.blockedWrites.push(record));
      await context.addInitScript(() => {
        const readFetch = window.fetch.bind(window);
        window.fetch = async (input, options = {}) => {
          const method = String(options.method || (input && input.method) || 'GET').toUpperCase();
          if (!['GET', 'HEAD'].includes(method)) {
            await window.__recordReadOnlyBlock({method, path: new URL(typeof input === 'string' ? input : input.url, location.href).pathname});
            throw new Error('Production smoke test is read-only');
          }
          return readFetch(input, options);
        };
      });
      await context.route('**/*', route => {
        const req = route.request();
        if (!['GET', 'HEAD'].includes(req.method())) {
          report.blockedWrites.push({method: req.method(), path: new URL(req.url()).pathname});
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      if (width === 390) {
        for (const file of ['index.html', 'manifest.webmanifest', 'app-config.js', 'pwa.js', 'sw.js', 'ui-comfort.css', 'scorebook-lineup.js']) {
          const response = await page.request.get(base + file + '?release-check=' + Date.now());
          const body = await response.text();
          const source = built.files.get(file).toString();
          const matches = response.status() === 200 && normalized(body) === normalized(source);
          report.assets.push({file, status: response.status(), matches, sha256: crypto.createHash('sha256').update(body).digest('hex')});
          assert.ok(matches, `published ${file} must match the expected commit`);
        }
      }
      assert.equal((await page.goto(base)).status(), 200);
      assert.equal(await page.locator('meta[name="baseball-release"]').getAttribute('content'), built.version);
      report.releaseVersion = built.version;
      await page.waitForFunction(() => window.teamRecords && !/連線同步中/.test(syncStatusBadge.textContent));
      for (const tab of ['Overview', 'Profile', 'Leaderboard', 'Records', 'Analytics', 'Compare', 'Lineup', 'Scorebook', 'Pitching', 'Glossary']) {
        await page.evaluate(name => switchMainTab('tab' + name), tab);
        // Table folding/layout is scheduled by ui-comfort's MutationObserver + requestAnimationFrame.
        // Measure after it has rendered, not in the same synchronous task as switching tabs.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const state = await page.evaluate(name => {
          const panel = document.getElementById('panel' + name);
          return {shown: !panel.classList.contains('hidden'), textLength: panel.innerText.length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};
        }, tab);
        report.pages.push({width, tab, ...state});
        assert.ok(state.shown && state.textLength > 20 && state.overflow <= 1, `${width}px ${tab}`);
        if (tab === 'Scorebook') {
          const lineup = await page.evaluate(() => ({
            rows: document.querySelectorAll('#setupLineupGrid .lineup-row').length,
            players: document.querySelectorAll('#setupLineupGrid .lineup-player-select').length,
            positions: document.querySelectorAll('#setupLineupGrid .lineup-position').length,
            fielders: document.querySelectorAll('#setupLineupField [data-position]').length,
            liveCardPresent: !!document.getElementById('liveLineupCard')
          }));
          assert.ok([10,11].includes(lineup.rows));
          assert.equal(lineup.players,lineup.rows); assert.equal(lineup.positions,lineup.rows);
          assert.equal(lineup.fielders,10); assert.ok(lineup.liveCardPresent);
          report.pages.at(-1).lineup = lineup;
          await page.screenshot({path:path.join(output, `production-lineup-${width}.png`)});
        }
      }
      if (width === 390) {
        report.data = await page.evaluate(() => ({logs: allLogs.length, games: allGames.length, status: syncStatusBadge.textContent}));
        assert.ok(report.data.logs > 0 && report.data.games > 0 && /連線正常/.test(report.data.status));
        await page.waitForFunction(() => window.__pwaRegistration?.active);
        await page.reload();
        await page.waitForFunction(() => navigator.serviceWorker.controller && window.teamRecords);
        report.offlineCache = await page.evaluate(async () => {
          const keys = await caches.keys(); let safeHtml = false;
          for (const key of keys) {
            const cache = await caches.open(key);
            for (const req of await cache.keys()) {
              if (/\/data\/|api\.github/.test(req.url)) return {safe: false, keys};
              if (new URL(req.url).pathname.endsWith('/index.html')) {
                const text = await (await cache.match(req)).text();
                safeHtml = text.includes("const GITHUB_TOKEN = ''; window.BASEBALL_OFFLINE_SHELL = true;")
                  && !/const GITHUB_TOKEN = \[/.test(text);
              }
            }
          }
          return {safe: safeHtml, keys};
        });
        assert.ok(report.offlineCache.safe);
        await context.setOffline(true);
        await page.reload();
        await page.waitForFunction(() => window.teamRecords && document.getElementById('uiOfflineBar'));
        report.offlineStart = await page.evaluate(() => ({notice: uiOfflineBar.innerText, logs: allLogs.length}));
        assert.ok(/離線/.test(report.offlineStart.notice) && report.offlineStart.logs > 0);
        await context.setOffline(false);
        await page.goto(base);
        await page.waitForFunction(() => window.teamRecords && !/連線同步中/.test(syncStatusBadge.textContent));
        await page.evaluate(() => switchMainTab('tabOverview'));
        await page.screenshot({path: path.join(output, 'production-pwa-390.png')});
      }
      await context.close();
    }
    assert.equal(report.errors.length, 0);
    assert.equal(report.blockedWrites.length, 0);
    report.remoteRefs = git('ls-remote', 'origin', 'refs/heads/main', 'refs/heads/data');
    report.physicalAndroid = 'UNVERIFIED'; report.physicalIPhone = 'UNVERIFIED';
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = error.message; process.exitCode = 1; }
  finally {
    fs.writeFileSync(path.join(output, 'production-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
