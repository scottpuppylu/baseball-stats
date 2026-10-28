// Third review round (2026/10/11), isolated preview only: qualifying PA, one percentile rank, consistent thresholds and
// per-3-out rates, safe names, hooks registry, dead code, shared spray drawing, Esc and in-page dialogs, refreshed lists,
// readable chart labels, CSV and backup, and the move of the data to the `data` branch (old pages writing to main).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const hashes = () => Object.fromEntries(fs.readdirSync(path.join(root, 'data')).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', f))).digest('hex')]));
const diskBefore = hashes();
const ready = page => page.waitForFunction(() => window.teamRecords && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
const lastToast = page => page.evaluate(() => [...document.querySelectorAll('#globalToastContainer span')].at(-1)?.textContent || '');
// Read or write a file in the simulated cloud directly (branch `data` or `main`).
const cloudRead = (page, file, ref = 'data') => page.evaluate(async ([file, ref]) => {
  const res = await fetch(`/__mock-api/${file}?ref=${ref}`);
  if (!res.ok) return null;
  const body = await res.json();
  return {sha: body.sha, data: JSON.parse(base64ToUtf8(body.content))};
}, [file, ref]);
const cloudWrite = (page, file, data, ref) => page.evaluate(async ([file, data, ref]) => {
  const current = await fetch(`/__mock-api/${file}?ref=${ref}`).then(r => r.ok ? r.json() : null);
  const res = await fetch(`/__mock-api/${file}?ref=${ref}`, {method: 'PUT', body: JSON.stringify({branch: ref, sha: current && current.sha, content: utf8ToBase64(JSON.stringify(data, null, 2))})});
  return res.status;
}, [file, data, ref]);

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  let externalGitHub = 0;
  const open = async (width = 1440, height = 900) => {
    const context = await browser.newContext({viewport: {width, height}, acceptDownloads: true, isMobile: width < 768, hasTouch: width < 768});
    await context.addInitScript(() => { window.confirm = () => true; });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { errors.push(`unexpected browser dialog: ${d.message()}`); d.dismiss(); });
    await page.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, r => { externalGitHub++; return r.abort(); });
    await page.goto(url);
    await ready(page);
    return {context, page};
  };
  const checks = [];
  try {
    const {context, page} = await open();

    // ---------- 8. Qualifying plate appearances ----------
    const q = await page.evaluate(() => {
      const agg = getAnalysisAgg();
      const minPa = rateQualifyingPa(agg.players);
      const expectedKing = agg.players.filter(p => p.pa >= minPa).sort((a, b) => b.avg - a.avg)[0];
      switchMainTab('tabOverview'); // the summary cards are drawn when the page is shown
      const cards = [...teamSummaryCards.children].map(c => c.innerText.replace(/\s+/g, ' '));
      switchMainTab('tabLeaderboard');
      const metric = leaderboardMetricSelect;
      const pick = value => { metric.value = value; metric.dispatchEvent(new Event('change')); return {min: Number(leaderboardMinPa.value), rows: leaderboardTableBody.rows.length}; };
      const rate = pick('avg'), counting = pick('hr');
      leaderboardMinPa.value = '3'; leaderboardMinPa.dispatchEvent(new Event('input'));
      const edited = pick('obp');
      return {minPa, maxPa: Math.max(...agg.players.map(p => p.pa)), king: expectedKing.name, card: cards.find(c => c.includes('區間打擊王')), rate, counting, edited, players: agg.players.length,
        tinyPlayers: agg.players.filter(p => p.pa < minPa).length};
    });
    assert.equal(q.minPa, Math.max(5, Math.ceil(q.maxPa / 2)));
    assert.ok(q.card.includes(`≥${q.minPa} 打席`) && q.card.includes(q.king), `打擊王 needs ${q.minPa} PA: ${q.card}`);
    assert.equal(q.rate.min, q.minPa, 'rate metrics default to the qualifying PA');
    assert.equal(q.rate.rows, q.players - q.tinyPlayers);
    assert.equal(q.counting.min, 0, 'counting metrics have no minimum');
    assert.equal(q.edited.min, 3, 'a coach-entered minimum is kept');
    checks.push('8-qualifying-pa');

    // ---------- 9. One percentile rank ----------
    const pr = await page.evaluate(() => {
      const list = [{pa: 20, v: 1}, {pa: 20, v: 2}, {pa: 20, v: 3}, {pa: 20, v: 4}, {pa: 20, v: 5}, {pa: 2, v: 99}];
      const pitchers = [{v: 1}, {v: 2}];
      return {
        top: getPercentile(5, 'v', list), bottom: getPercentile(1, 'v', list), middle: getPercentile(3, 'v', list),
        unqualifiedIgnored: getPercentile(5, 'v', list) === 100, invert: getPercentile(1, 'v', list, true),
        twoPitchers: [getPercentile(1, 'v', pitchers), getPercentile(2, 'v', pitchers)],
        sameAsDiagnostics: (() => { const agg = getAnalysisAgg(); const p = agg.players.find(x => x.pa >= 10); const q = agg.players.filter(x => x.pa >= 10);
          return getPercentile(p.wrc_plus, 'wrc_plus', agg.players) === Math.round(PlayerDiagnostics.percentile(p.wrc_plus, q, 'wrc_plus') * 100); })()
      };
    });
    assert.deepEqual([pr.top, pr.bottom, pr.middle, pr.invert], [100, 0, 50, 100], 'share of qualified teammates beaten');
    assert.ok(pr.unqualifiedIgnored, 'a 2-PA player is not part of the comparison');
    assert.deepEqual(pr.twoPitchers, [38, 63], 'two pitchers: pulled toward 50 instead of 0 / 100');
    assert.ok(pr.sameAsDiagnostics, 'radar PR equals the diagnostics PR');
    checks.push('9-percentile');

    // ---------- 10. Thresholds, per-3-out rates, data-based wording ----------
    const wording = await page.evaluate(() => {
      const text = () => document.body.innerText;
      const pages = {};
      document.documentElement.classList.add('fl-full-layout'); // innerText needs every section laid out
      for (const t of ['Overview', 'Profile', 'Leaderboard', 'Analytics', 'Compare', 'Pitching', 'Glossary']) { switchMainTab('tab' + t); pages[t] = text(); }
      const agg = getAnalysisAgg();
      const tracked = agg.players.filter(p => p.tracked);
      const expected = p => ({pull: '強力拉打型', oppo: '反向推打型', balanced: '全方位廣角型'})[sprayTendency(p.pull_pct, p.oppo_pct)];
      selectedPlayerName = tracked[0].name; switchMainTab('tabProfile');
      const profileType = playerProfileCard.innerText.includes(expected(tracked[0]));
      return {
        rc27: Object.values(pages).some(t => /RC\/27|27出局|9局單兵/.test(t)), per7: Object.values(pages).some(t => /每7局|BB\/7|R\/7|7 局 \(21/.test(t)),
        rcPer3: pages.Leaderboard.includes('每局創造得分') && pages.Glossary.includes('RC/3出局'), pitchingHeader: pages.Pitching.includes('每局保送 (BB/3出局)') && pages.Pitching.includes('每局失分 (R/3出局)'),
        claim: Object.values(pages).some(t => /統計證實|\+0\.42|\.700\+|\(\.680\)/.test(t)),
        ownRates: pages.Analytics.includes('依本隊場記實際結果') && playerProfileCard.innerText.includes('本隊安打率'),
        rc3: agg.players.every(p => Math.abs(p.rc_3 - p.rc * 3 / p.outs) < 1e-9), profileType
      };
    });
    assert.deepEqual(wording, {rc27: false, per7: false, rcPer3: true, pitchingHeader: true, claim: false, ownRates: true, rc3: true, profileType: true});
    checks.push('10-wording');

    // ---------- 12. Names cannot break the page ----------
    await page.evaluate(() => { addGuestPlayer('外援"<b>X</b>', 5); });
    assert.match(await lastToast(page), /不能包含/);
    assert.equal(await page.evaluate(() => guestPlayers.some(g => g.name.includes('<'))), false);
    // Old data with such characters (written before the check) is cleaned when loaded.
    const logs = (await cloudRead(page, 'data/logs.json')).data;
    logs.push({id: 'log_unsafe', date: '2026-10-11', tag: '舊資料"<i>', name: '洪銘駿', jersey: 30, pa: 1, ab: 1, h: 1, h1: 1, h2: 0, h3: 0, hr: 0, bb: 0, sf: 0, k: 0});
    const tags = (await cloudRead(page, 'data/tags.json')).data;
    tags['洪銘駿'] = ['"><img src=x>'];
    assert.equal(await cloudWrite(page, 'data/logs.json', logs, 'data'), 200);
    assert.equal(await cloudWrite(page, 'data/tags.json', tags, 'data'), 200);
    await page.reload(); await ready(page);
    const safe = await page.evaluate(() => {
      selectedPlayerName = '洪銘駿'; switchMainTab('tabProfile'); tabLogsBtn.click(); switchMainTab('tabOverview');
      return {injected: document.querySelectorAll('main img[src="x"], main i, #logsTableBody b').length, tag: allLogs.find(l => l.id === 'log_unsafe')?.tag, nick: playerTags['洪銘駿']};
    });
    assert.deepEqual(safe, {injected: 0, tag: '舊資料i', nick: ['img src=x']});
    checks.push('12-safe-names');

    // ---------- 13 & 15. Hooks registry, dead code ----------
    const hooks = await page.evaluate(() => siteHooks.list());
    assert.deepEqual(hooks.after.renderPlayerProfile, ['player-health', 'team-insights', 'team-records']);
    assert.deepEqual(hooks.after.switchMainTab, ['player-health', 'team-records', 'ui-app', 'ui-app', 'ui-app-tools', 'ui-app', 'ui-app-chip', 'ui-app-lens']); // ui-app: Home, 版本紀錄, tools panel, back button, chart card
    assert.deepEqual(hooks.after.renderLineupAnalysis, ['lineup-recommender']);
    assert.deepEqual(hooks.replaced, {calculateRecommendedLineup: 'lineup-recommender', renderDiagnostics: 'player-diagnostics'});
    const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(source, /\brbi\b|selectRbi|currentSelectedRbi/, 'no RBI leftovers');
    assert.doesNotMatch(source, /\bprompt\(|\balert\(/, 'no prompt() or alert()');
    for (const file of ['team-insights.js', 'team-records.js', 'lineup-recommender.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /window\[name\] = function/, `${file} registers hooks`);
    checks.push('13-15-structure');

    // ---------- 14. Shared spray drawing ----------
    const spray = await page.evaluate(() => {
      switchMainTab('tabAnalytics');
      const bases = [...document.querySelectorAll('svg[data-field-base]')].map(svg => svg.querySelectorAll(':scope > path').length === 2 && svg.querySelectorAll(':scope > polygon').length === 1);
      const dot = sprayDotsSvg([{x: .5, y: .5, result: 'HR', batterName: 'A', trajectory: 'fly', location: 'SF'}], {tooltipId: 'teamSpatialPointTooltip'});
      return {bases, dot, oldTooltips: ['showProfileSprayTooltip', 'showTeamSpatialTooltip', 'showSprayTooltip'].some(n => typeof window[n] === 'function')};
    });
    assert.ok(spray.bases.length === 5 && spray.bases.every(Boolean), 'five charts share the field background');
    assert.match(spray.dot, /r="8.5" fill="#f59e0b"[^>]*showSprayPointTooltip/);
    assert.equal(spray.oldTooltips, false);
    checks.push('14-spray');

    // ---------- 18. Esc and the in-page dialog ----------
    for (const [openFn, id] of [['openDefenseModal', 'defenseModal'], ['openGuestModal', 'guestModal']]) {
      await page.evaluate(fn => window[fn](), openFn);
      await page.keyboard.press('Escape');
      assert.ok(await page.evaluate(id => document.getElementById(id).classList.contains('hidden'), id), `${id} closes with Esc`);
    }
    await page.evaluate(() => { switchMainTab('tabProfile'); openGuestModal(); addPlayerTag(selectedPlayerName); });
    await page.waitForSelector('#uiFormDialog');
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => [!!document.getElementById('uiFormDialog'), guestModal.classList.contains('hidden')]), [false, false], 'Esc closes only the dialog on top');
    await page.evaluate(() => closeGuestModal());
    const before = await page.evaluate(() => (playerTags[selectedPlayerName] || []).length);
    await page.evaluate(() => { addPlayerTag(selectedPlayerName); }); // waits on the dialog; not awaited here
    await page.fill('#uiFormDialog [data-dialog-field="0"]', '測試綽號');
    await page.click('#uiFormDialog button[type="submit"]');
    await page.waitForFunction(n => (playerTags[selectedPlayerName] || []).length === n + 1, before);
    checks.push('18-esc-dialog');

    // ---------- 19. Lists stay current; review newest first ----------
    const lists = await page.evaluate(() => {
      switchMainTab('tabAnalytics');
      const all = teamSprayPlayerFilter.options.length;
      filterStartDate.value = '2026-09-20'; filterEndDate.value = '2026-09-20'; renderAll();
      const narrowed = teamSprayPlayerFilter.options.length;
      const expected = getAnalysisAgg().players.length + 1;
      filterStartDate.value = ''; filterEndDate.value = ''; renderAll();
      switchMainTab('tabScorebook'); switchScorebookSubTab('review');
      const dates = [...reviewGameSelect.options].map(o => o.textContent.trim().slice(0, 10));
      return {all, narrowed, expected, sorted: dates.join() === [...dates].sort().reverse().join(), firstSelected: reviewGameSelect.selectedIndex === 0};
    });
    assert.ok(lists.narrowed === lists.expected && lists.narrowed < lists.all, 'team spray player list follows the date range');
    assert.ok(lists.sorted && lists.firstSelected, 'review list newest first');
    checks.push('19-lists');

    // ---------- 20. Chart labels ----------
    const chart = await page.evaluate(() => {
      switchMainTab('tabAnalytics');
      customChartType.value = 'scatter'; customXVar.value = 'avg'; customYVar.value = 'wrc_plus'; renderCustomChart(getAnalysisAgg());
      const c = Chart.getChart('customChart');
      return {x: c.options.scales.x.title.text, y: c.options.scales.y.title.text, tip: c.options.plugins.tooltip.callbacks.label({raw: c.data.datasets[0].data[0]})};
    });
    assert.deepEqual([chart.x, chart.y], ['打擊率 (AVG)', '加權得分創造 (wRC+)']);
    assert.match(chart.tip, /：打擊率 \(AVG\) \d\.\d{3}、加權得分創造 \(wRC\+\) \d+\.\d$/);
    checks.push('20-chart-labels');

    // ---------- 21. CSV and full backup ----------
    await page.evaluate(() => switchMainTab('tabOverview'));
    await page.click('#flToolsButton'); // CSV export lives in the tools panel
    const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsvBtn')]);
    await page.click('#flTools .fl-tools-done');
    const csv = fs.readFileSync(await csvDownload.path(), 'utf8').replace(/^﻿/, '').trim().split('\n');
    assert.match(csv[0], /^選手,打席,打數,安打,.*,wOBA,wRC\+,.*,RC\/局,SDI,xBA,xSLG,xwOBA$/);
    const header = csv[0].split(',');
    const values = csv.slice(1).map(line => line.split(','));
    assert.ok(values.every(v => /^\d\.\d{3}$/.test(v[header.indexOf('打擊率')]) && /^-?\d+\.\d$/.test(v[header.indexOf('wRC+')])), 'rounded values');
    const [backupDownload] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBackupBtn')]);
    const backup = JSON.parse(fs.readFileSync(await backupDownload.path(), 'utf8'));
    assert.match(backupDownload.suggestedFilename(), /^淡江航太系壘_完整備份_\d{4}-\d{2}-\d{2}\.json$/);
    assert.deepEqual(Object.keys(backup.files), ['data/logs.json', 'data/games.json', 'data/avatars.json', 'data/tags.json', 'data/defense.json', 'data/guests.json', 'data/health.json']);
    assert.deepEqual(backup.files['data/health.json'], await page.evaluate(() => PlayerHealthStore.data()), 'backup includes all entered health fields');
    assert.equal(backup.files['data/games.json'].length, await page.evaluate(() => allGames.length));
    checks.push('21-csv-backup');
    await context.close();

    // ---------- 17. Data on the data branch; writes from old pages on main are merged in ----------
    const A = await open();
    const writes = [];
    A.page.on('request', req => { if (req.method() === 'PUT' && req.url().includes('/__mock-api/')) writes.push(JSON.parse(req.postData()).branch); });
    await A.page.evaluate(() => commitTagsToGitHub({...playerTags, 謝承祐: ['新版標籤']}, 'new page'));
    assert.deepEqual(writes, ['data'], 'the site writes to the data branch');
    assert.ok(!JSON.stringify((await cloudRead(A.page, 'data/tags.json', 'main')).data).includes('新版標籤'), 'main is not touched');
    // An old page (opened before the move) adds a log and deletes another on main.
    const mainLogs = (await cloudRead(A.page, 'data/logs.json', 'main')).data;
    const removed = mainLogs.find(l => !String(l.id).startsWith('log_game_')).id;
    const oldPageLogs = [...mainLogs.filter(l => l.id !== removed), {id: 'log_old_page', date: '2026-10-11', tag: '舊版頁面', name: '洪銘駿', jersey: 30, pa: 2, ab: 2, h: 1, h1: 1, h2: 0, h3: 0, hr: 0, bb: 0, sf: 0, k: 0}];
    assert.equal(await cloudWrite(A.page, 'data/logs.json', oldPageLogs, 'main'), 200);
    const B = await open();
    await B.page.waitForFunction(() => allLogs.some(l => l.id === 'log_old_page'));
    const merged = (await cloudRead(B.page, 'data/logs.json')).data;
    assert.ok(merged.some(l => l.id === 'log_old_page') && !merged.some(l => l.id === removed), 'the old page\'s addition and deletion reach the data branch');
    assert.match(await lastToast(B.page), /舊版頁面/);
    const marker = (await cloudRead(B.page, 'data/legacy-main.json')).data;
    assert.equal(marker['data/logs.json'], (await cloudRead(B.page, 'data/logs.json', 'main')).sha, 'marker records the merged main version');
    // Already merged: the next page does not merge again, so a later deletion on the data branch sticks.
    await B.page.evaluate(() => deleteSingleLog('log_old_page'));
    const C = await open();
    await C.page.waitForTimeout(1000);
    assert.equal(await C.page.evaluate(() => allLogs.some(l => l.id === 'log_old_page')), false, 'no second merge');
    for (const d of [A, B, C]) await d.context.close();
    checks.push('17-data-branch');

    // ---------- CI finding: Android/Linux monospace digits are wider than Windows Consolas ----------
    // Courier New has the same 0.6em digits as DejaVu Sans Mono / Droid Sans Mono; the overview table must still fit at 360px.
    {
      const {context, page} = await open(360, 740);
      await page.addStyleTag({content: '.font-mono { font-family: "Courier New", monospace !important; }'});
      const fit = await page.evaluate(() => ({client: viewSummary.clientWidth, scroll: viewSummary.scrollWidth}));
      assert.ok(fit.scroll <= fit.client + 4, `overview table fits 360px with wide digits (${fit.scroll}/${fit.client})`);
      await context.close();
    }
    checks.push('wide-digits-360');

    assert.deepEqual(errors, [], 'no pageerror or browser dialog');
    assert.equal(externalGitHub, 0, 'no real GitHub traffic');
    assert.deepEqual(hashes(), diskBefore, 'formal data files untouched');
    console.log(JSON.stringify({passed: true, checks, output}));
  } catch (error) {
    console.error(error);
    if (errors.length) console.error('pageerrors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
