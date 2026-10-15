// Repeats the complete device acceptance from empty app storage on a disposable emulator only.
// Never clears a physical phone. Each run keeps its own untruncated report and screenshots.
const {execFileSync, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-phase6-cold');
const pkg = 'io.github.scottpuppylu.baseballstats';
fs.mkdirSync(output, {recursive: true});
const devices = execFileSync(adb, ['devices'], {encoding: 'utf8'}).split('\n').map(l => l.trim()).filter(l => /\sdevice$/.test(l));
assert.equal(devices.length, 1, 'exactly one connected device required');
const serial = devices[0].split(/\s/)[0];
assert.match(serial, /^emulator-\d+$/, 'fresh-storage acceptance is only allowed on a disposable emulator');
const runs = [];
for (let i = 1; i <= 3; i++) {
  const dir = path.join(output, `fresh-${i}`);
  fs.mkdirSync(dir, {recursive: true});
  execFileSync(adb, ['-s', serial, 'shell', 'pm', 'clear', pkg]);
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, ['tests/android-device.cjs'], {
    cwd: root, env: {...process.env, UI_QA_OUTPUT: dir}, encoding: 'utf8', timeout: 420000
  });
  fs.writeFileSync(path.join(dir, 'test.log'), (result.stdout || '') + (result.stderr || '') + (result.error ? String(result.error) : ''));
  const reportPath = path.join(dir, 'android-device-result.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  runs.push({run: i, started, exitCode: result.status, passed: result.status === 0 && report?.passed === true, report});
  fs.writeFileSync(path.join(output, 'cold-start-result.json'), JSON.stringify({serial, runs, passed: runs.length === 3 && runs.every(r => r.passed)}, null, 2));
  console.log(JSON.stringify({run: i, passed: runs.at(-1).passed, output: dir}));
  if (!runs.at(-1).passed) { process.exitCode = 1; break; }
}
