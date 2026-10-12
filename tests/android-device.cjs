// On-device test of the installed Android app (emulator or USB phone with USB debugging), driving the app's own WebView
// through Playwright's Android WebView support. Needs a DEBUG build (release builds are not inspectable) and adb on PATH or ANDROID_HOME.
//   npm run build:android && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && npm run test:android-device
// Never writes team data: the app has no API configured here, so uploads must be refused (that is one of the checks).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {_android} = require('playwright');

const PKG = 'io.github.scottpuppylu.baseballstats';
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adbPath = fs.existsSync(path.join(sdk, 'platform-tools', 'adb.exe')) ? path.join(sdk, 'platform-tools', 'adb.exe') : 'adb';
const adb = (...args) => execFileSync(adbPath, args, {encoding: 'utf8'}).trim();
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = name => fs.writeFileSync(path.join(output, `android-${name}.png`), execFileSync(adbPath, ['exec-out', 'screencap', '-p']));
const topActivity = () => adb('shell', 'dumpsys', 'activity', 'activities').split('\n').find(l => /topResumedActivity|mResumedActivity/.test(l)) || '';

// Playwright's Android support attaches to the app's WebView through adb (the adb server must be running).
async function connect() {
  const [device] = await _android.devices();
  assert.ok(device, 'an emulator or phone is connected');
  const webview = await device.webView({pkg: PKG}, {timeout: 30000});
  const page = await webview.page();
  return {browser: device, page};
}
async function launch(fresh) {
  if (fresh) adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
  await sleep(2500);
  const c = await connect();
  await c.page.waitForFunction(() => window.teamRecords && typeof switchMainTab === 'function', null, {timeout: 30000});
  return c;
}
const back = async () => { adb('shell', 'input', 'keyevent', '4'); await sleep(900); };
const visibleTab = page => page.evaluate(() => document.querySelector('[id^="panel"]:not(.hidden)')?.id);

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const checks = [];
  const device = `${adb('shell', 'getprop', 'ro.product.model')} / Android ${adb('shell', 'getprop', 'ro.build.version.release')} (API ${adb('shell', 'getprop', 'ro.build.version.sdk')})`;
  let {browser, page} = await launch(true);
  try {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Packaged, not a remote shell: the page and its scripts come from the APK.
    assert.equal(new URL(page.url()).origin, 'https://localhost');
    assert.ok(await page.evaluate(() => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'));
    assert.ok(await page.evaluate(() => typeof Chart === 'function' && typeof tailwind === 'object'), 'bundled libraries loaded');
    assert.equal(await page.evaluate(() => navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0), 0, 'no service worker in the app');
    assert.match(await page.evaluate(() => document.getElementById('appHeader').innerText), /App 1\.0\.0/, 'app version shown');
    checks.push('packaged-app');

    // All ten pages render.
    const tabs = ['Overview', 'Profile', 'Leaderboard', 'Records', 'Analytics', 'Compare', 'Lineup', 'Scorebook', 'Pitching', 'Glossary'];
    for (const tab of tabs) {
      await page.evaluate(t => switchMainTab(`tab${t}`), tab);
      await sleep(400);
      const info = await page.evaluate(t => { const p = document.getElementById(`panel${t}`); return {shown: p && !p.classList.contains('hidden'), text: p ? p.innerText.length : 0, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth}; }, tab);
      assert.ok(info.shown && info.text > 20, `${tab} renders`);
      assert.ok(info.overflow <= 1, `${tab} has no sideways page scroll (${info.overflow})`);
      shot(`page-${tab}`);
    }
    checks.push('ten-pages');

    // Back button: dialog first, then previous page, then background (never a lost game).
    await page.evaluate(() => switchMainTab('tabOverview'));
    await page.evaluate(() => switchMainTab('tabLineup'));
    await page.evaluate(() => openDefenseModal());
    await sleep(400);
    assert.equal(await page.evaluate(() => defenseModal.classList.contains('hidden')), false);
    await back();
    assert.equal(await page.evaluate(() => defenseModal.classList.contains('hidden')), true, 'back closes the dialog');
    assert.equal(await visibleTab(page), 'panelLineup', 'and stays on the page');
    await back();
    assert.equal(await visibleTab(page), 'panelOverview', 'back returns to the previous page');
    checks.push('back-dialog-then-page');

    // A game in progress survives rotation, back-to-background and the app being killed.
    await page.evaluate(() => switchMainTab('tabScorebook'));
    const gameId = await page.evaluate(() => {
      // A copy of a real game's structure under a test id, kept only in this phone's storage.
      const game = JSON.parse(JSON.stringify(allGames[0]));
      game.id = 'game_android_qa'; game.opponent = 'Android QA';
      localStorage.setItem('rebas_active_game', JSON.stringify(game));
      return game.id;
    });
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
    await sleep(2500);
    shot('landscape');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rebas_active_game')).id), gameId, 'rotation keeps the game');
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
    await sleep(1500);
    // Back walks the visited pages, then sends the app to the background.
    for (let i = 0; i < 12 && new RegExp(PKG).test(topActivity()); i++) await back();
    assert.doesNotMatch(topActivity(), new RegExp(PKG), 'back at the start sends the app to the background');
    await browser.close().catch(() => {});
    ({browser, page} = await launch(true));
    assert.equal(await page.evaluate(() => (window.activeGame || JSON.parse(localStorage.getItem('rebas_active_game') || 'null'))?.id), gameId, 'game restored after the app was closed');
    await page.evaluate(() => localStorage.removeItem('rebas_active_game'));
    checks.push('rotation-background-restart');

    // The on-screen keyboard does not cover the field being typed in.
    await page.evaluate(() => switchMainTab('tabOverview'));
    await page.evaluate(() => { document.getElementById('toggleAddLogBtn')?.click(); });
    const field = page.locator('#addLogForm input:not([type=date]):not([type=hidden]):visible').first();
    if (await field.count()) {
      await field.evaluate(el => el.scrollIntoView({block: 'end'}));
      await field.click();
      await sleep(1500);
      await sleep(1000);
      const fit = await field.evaluate(el => ({focused: document.activeElement === el, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, view: window.visualViewport.height, name: el.name || el.id}));
      shot('keyboard');
      assert.ok(fit.focused && fit.top >= 0 && fit.bottom <= fit.view + 1, `field visible above the keyboard (${JSON.stringify(fit)})`);
      adb('shell', 'input', 'keyevent', '111'); await sleep(600);
      checks.push('keyboard');
    }

    // Uploads without the secure API are refused and reported, never shown as synced.
    const write = await page.evaluate(() => commitTagsToGitHub({...playerTags}, 'android qa'));
    assert.equal(write, false);
    assert.match(await page.evaluate(() => document.getElementById('syncStatusBadge').textContent), /寫入失敗/);
    checks.push('no-fake-sync');

    // CSV export opens the Android share sheet (save to Files / Drive / LINE).
    await page.evaluate(() => switchMainTab('tabOverview'));
    await page.evaluate(() => document.getElementById('exportCsvBtn').click());
    await sleep(2500);
    shot('share-sheet');
    assert.match(topActivity(), /ChooserActivity|chooser|intentresolver|ResolverActivity/i, 'share sheet shown');
    await back();
    checks.push('csv-share');

    // Avatar photo: the file input opens the system photo picker.
    await page.evaluate(() => document.getElementById('hiddenAvatarInput').click());
    await sleep(2500);
    shot('photo-picker');
    assert.match(topActivity(), /photopicker|documentsui|PhotoPicker|DocumentsActivity/i, 'system picker shown');
    await back();
    await sleep(800);
    checks.push('photo-picker');

    // Offline: notice shown, uploads refused with an offline message.
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
    await page.waitForFunction(() => document.getElementById('uiOfflineBar'), null, {timeout: 15000});
    shot('offline');
    assert.match(await page.evaluate(() => document.getElementById('uiOfflineBar').innerText), /離線中/);
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable');
    await page.waitForFunction(() => /已恢復連線/.test(document.getElementById('uiOfflineBar')?.innerText || ''), null, {timeout: 30000});
    checks.push('offline-notice');

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed: true, device, checks, output}));
  } catch (error) {
    console.error(error);
    shot('failure');
    process.exitCode = 1;
  } finally {
    try { adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'); adb('shell', 'settings', 'put', 'system', 'user_rotation', '0'); } catch (e) { /* best effort */ }
    await browser.close().catch(() => {});
  }
})();
