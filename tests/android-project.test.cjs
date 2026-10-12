// Android (Capacitor) project settings: a real packaged app, not a remote-URL shell; minimal permissions; no secrets.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Capacitor config: app id and name, bundled web files, no remote server URL', () => {
  const config = JSON.parse(read('capacitor.config.json'));
  assert.equal(config.appId, 'io.github.scottpuppylu.baseballstats');
  assert.equal(config.appName, '淡江航太系壘');
  assert.equal(config.webDir, 'www');
  assert.equal(config.server && config.server.url, undefined, 'the app must run its own files, not a website address');
  assert.equal(config.android.allowMixedContent, false);
  // Unset = Capacitor's default: inspectable in debug builds (for tests), never in release builds.
  assert.notEqual(config.android.webContentsDebuggingEnabled, true);
});

test('Android manifest: network permission only, no backup of the sign-in session, sign-in return link', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const permissions = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(permissions, ['android.permission.INTERNET']);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:scheme="io\.github\.scottpuppylu\.baseballstats" android:host="auth"/);
});

test('Gradle: Capacitor 8 SDK levels, versioned app, release signing only from an ignored local file', () => {
  const vars = read('android/variables.gradle');
  assert.match(vars, /minSdkVersion = 24/);
  assert.match(vars, /targetSdkVersion = 36/);
  const app = read('android/app/build.gradle');
  assert.match(app, /applicationId "io\.github\.scottpuppylu\.baseballstats"/);
  assert.match(app, /versionName "\d+\.\d+\.\d+"/);
  assert.match(app, /rootProject\.file\('keystore\.properties'\)/);
  assert.doesNotMatch(app, /storePassword\s+['"]/, 'no password written in the build file');
});

test('nothing secret or machine-specific is tracked by git', () => {
  const tracked = execFileSync('git', ['ls-files'], {cwd: root, encoding: 'utf8'}).split('\n');
  for (const file of tracked) {
    assert.doesNotMatch(file, /(^|\/)(local\.properties|keystore\.properties|\.env(\.local)?)$|\.(jks|keystore|apk|aab)$/, file);
    assert.doesNotMatch(file, /^www\/|^android\/app\/build\/|^android\/app\/src\/main\/assets\/public\//, file);
  }
});

test('build:web output: the site files, no team data, no credentials', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-web.mjs')], {cwd: root});
  const www = path.join(root, 'www');
  for (const file of ['index.html', 'cloud-sync.js', 'app-native.js', 'vendor/chart.umd-4.5.1.min.js', 'assets/logo-128.webp']) assert.ok(fs.existsSync(path.join(www, file)), file);
  assert.equal(fs.existsSync(path.join(www, 'data')), false, 'team data is read from the cloud, not bundled');
  assert.equal(fs.existsSync(path.join(www, 'cloud-api')), false, 'server code is not shipped');
  assert.equal(fs.existsSync(path.join(www, 'sw.js')), false, 'no service worker inside the app');
  const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script src="https?:/, 'no remote scripts');
  assert.ok(html.indexOf('capacitor.js') < html.indexOf('app-config.js') && html.indexOf('capacitor.js') > 0, 'Capacitor runtime loads first');
});
