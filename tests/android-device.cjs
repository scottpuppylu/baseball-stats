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
  try {
    // Fail closed even if someone enables an API in a future local configuration.
    await c.page.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method())
      || !/^https?:/.test(route.request().url()) ? route.continue() : route.abort());
    // Modules are available before the initial parallel data reads and native plugin callbacks finish.
    // Waiting only for teamRecords made a fresh install race with empty allGames / the version label.
    await c.page.waitForFunction(() => window.teamRecords && typeof switchMainTab === 'function'
      && !/連線同步中/.test(document.getElementById('syncStatusBadge')?.textContent || '')
      && /App 1\.0\.0/.test(document.getElementById('appHeader')?.innerText || ''), null, {timeout: 45000});
    return c;
  } catch (error) {
    await c.browser.close().catch(() => {});
    throw error;
  }
}
const back = async () => { adb('shell', 'input', 'keyevent', '4'); await sleep(900); };
const visibleTab = page => page.evaluate(() => document.querySelector('[id^="panel"]:not(.hidden)')?.id);

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const checks = [];
  const mark = name => { checks.push(name); console.log(`PASS ${name}`); };
  const device = `${adb('shell', 'getprop', 'ro.product.model')} / Android ${adb('shell', 'getprop', 'ro.build.version.release')} (API ${adb('shell', 'getprop', 'ro.build.version.sdk')})`;
  let browser, page;
  const errors = [];
  try {
    ({browser, page} = await launch(true));
    page.on('pageerror', e => errors.push(e.message));
    // Packaged, not a remote shell: the page and its scripts come from the APK.
    assert.equal(new URL(page.url()).origin, 'https://localhost');
    assert.ok(await page.evaluate(() => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'));
    assert.ok(await page.evaluate(() => typeof Chart === 'function' && typeof tailwind === 'object'), 'bundled libraries loaded');
    assert.equal(await page.evaluate(() => navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0), 0, 'no service worker in the app');
    assert.match(await page.evaluate(() => document.getElementById('appHeader').innerText), /App 1\.0\.0/, 'app version shown');
    mark('packaged-app');

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
    mark('ten-pages');

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
    mark('back-dialog-then-page');

    // A game in progress survives rotation, back-to-background and the app being killed.
    await page.evaluate(() => switchMainTab('tabScorebook'));
    const gameId = await page.evaluate(() => {
      // A copy of a real game's structure under a test id, kept only in this phone's storage.
      if (!allGames[0]) throw new Error('No game loaded: initial data must finish before recovery acceptance');
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
    page.on('pageerror', e => errors.push(e.message));
    assert.equal(await page.evaluate(() => (window.activeGame || JSON.parse(localStorage.getItem('rebas_active_game') || 'null'))?.id), gameId, 'game restored after the app was closed');
    await page.evaluate(() => localStorage.removeItem('rebas_active_game'));
    mark('rotation-background-restart');

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
      mark('keyboard');
    }
    else throw new Error('Keyboard test input missing; must not silently skip acceptance');

    // Uploads without the secure API are refused and reported, never shown as synced.
    assert.equal(await page.evaluate(() => cloudApi.enabled), false, 'no configured write service in device acceptance');
    const write = await page.evaluate(() => commitTagsToGitHub({...playerTags}, 'android qa'));
    assert.equal(write, false);
    assert.match(await page.evaluate(() => document.getElementById('syncStatusBadge').textContent), /寫入失敗/);
    mark('no-fake-sync');

    // CSV export opens the Android share sheet (save to Files / Drive / LINE).
    await page.evaluate(() => switchMainTab('tabOverview'));
    await page.evaluate(() => document.getElementById('exportCsvBtn').click());
    await sleep(2500);
    shot('share-sheet');
    assert.match(topActivity(), /ChooserActivity|chooser|intentresolver|ResolverActivity/i, 'share sheet shown');
    await back();
    mark('csv-share');

    // Complete JSON backup uses the same native save/share path as CSV.
    await page.evaluate(() => document.getElementById('downloadBackupBtn').click());
    await sleep(2500);
    shot('json-share-sheet');
    assert.match(topActivity(), /ChooserActivity|chooser|intentresolver|ResolverActivity/i, 'JSON share sheet shown');
    await back();
    mark('json-share');

    // Avatar photo: the file input opens the system photo picker.
    await page.evaluate(() => document.getElementById('hiddenAvatarInput').click());
    await sleep(2500);
    shot('photo-picker');
    assert.match(topActivity(), /photopicker|documentsui|PhotoPicker|DocumentsActivity/i, 'system picker shown');
    await back();
    await sleep(800);
    mark('photo-picker');

    // Exercise an actual image file through the WebView input, decoder, cropper and local save.
    // Selecting via Playwright bypasses system picker taps (the picker opening is checked above).
    const avatarPlayer = await page.evaluate(() => selectedPlayerName);
    assert.ok(avatarPlayer, 'a player is selected before editing the avatar');
    await page.locator('#hiddenAvatarInput').setInputFiles(path.join(__dirname, '..', 'assets', 'icons', 'icon-192.png'));
    await page.waitForFunction(() => !document.getElementById('cropModal').classList.contains('hidden'));
    await page.evaluate(() => { rotateCropImage(); resetCropTransform(); });
    await page.locator('#cropCanvas').waitFor({state: 'visible'});
    await sleep(600); // let Android's compositor present the cropper before the native screenshot
    shot('photo-crop');
    await page.evaluate(() => confirmCropAndSave());
    assert.ok(await page.evaluate(name => /^data:image\//.test(JSON.parse(localStorage.getItem('rebas_player_avatars'))[name]), avatarPlayer), 'cropped image saved locally');
    assert.match(await page.evaluate(() => document.getElementById('syncStatusBadge').textContent), /寫入失敗/, 'unavailable cloud upload is never reported as successful');
    mark('image-file-crop-local-save');

    // Offline: notice shown, uploads refused with an offline message.
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
    await page.waitForFunction(() => document.getElementById('uiOfflineBar'), null, {timeout: 15000});
    shot('offline');
    assert.match(await page.evaluate(() => document.getElementById('uiOfflineBar').innerText), /離線中/);
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable');
    await page.waitForFunction(() => /已恢復連線/.test(document.getElementById('uiOfflineBar')?.innerText || ''), null, {timeout: 30000});
    mark('offline-notice');

    assert.deepEqual(errors, []);
    const report = {passed: true, device, checks, output};
    fs.writeFileSync(path.join(output, 'android-device-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = {passed: false, device, checks, error: String(error.stack || error), errors};
    fs.writeFileSync(path.join(output, 'android-device-result.json'), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report, null, 2));
    try { shot('failure'); } catch (_) { /* a disconnected device must not hide the original failure */ }
    process.exitCode = 1;
  } finally {
    try { adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'); adb('shell', 'settings', 'put', 'system', 'user_rotation', '0'); } catch (e) { /* best effort */ }
    if (browser) await browser.close().catch(() => {});
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
