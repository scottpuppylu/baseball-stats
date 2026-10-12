// Runs Gradle for the Android project and lists what was built (path, size, SHA-256).
// Finds JDK 21 and the Android SDK from JAVA_HOME / ANDROID_HOME, or the usual per-user install folders on Windows.
// Usage: node scripts/gradle.mjs assembleDebug [more tasks]
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(root, 'android');
const tasks = process.argv.slice(2);
if (!tasks.length) { console.error('usage: node scripts/gradle.mjs <task> [...]'); process.exit(2); }

const env = {...process.env};
const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
if (!env.JAVA_HOME) {
  const programs = path.join(local, 'Programs');
  const jdk = fs.existsSync(programs) && fs.readdirSync(programs).filter(d => /^jdk-21/.test(d)).sort().pop();
  if (jdk) env.JAVA_HOME = path.join(programs, jdk);
}
if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
  const sdk = path.join(local, 'Android', 'Sdk');
  if (fs.existsSync(sdk)) env.ANDROID_HOME = sdk;
}
const sdkDir = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
if (!env.JAVA_HOME) { console.error('JDK 21 not found: set JAVA_HOME (see docs/MOBILE_APP.md)'); process.exit(1); }
if (!sdkDir) { console.error('Android SDK not found: set ANDROID_HOME (see docs/MOBILE_APP.md)'); process.exit(1); }
// Windows keeps the search path as "Path"; update whichever spelling exists so there is only one.
const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
env[pathKey] = `${path.join(env.JAVA_HOME, 'bin')}${path.delimiter}${env[pathKey] || ''}`;
// local.properties is machine-specific and git-ignored.
const props = path.join(android, 'local.properties');
if (!fs.existsSync(props)) fs.writeFileSync(props, `sdk.dir=${sdkDir.replace(/\\/g, '/')}\n`);

const gradlew = path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(process.platform === 'win32' ? `"${gradlew}"` : gradlew, [...tasks, '--no-daemon', '--console=plain'], {cwd: android, env, stdio: 'inherit', shell: process.platform === 'win32'});
if (result.status !== 0) process.exit(result.status || 1);

const outputs = path.join(android, 'app', 'build', 'outputs');
const found = [];
const walk = dir => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, {withFileTypes: true})) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(apk|aab)$/.test(e.name)) found.push(p); } };
walk(outputs);
for (const file of found) {
  const data = fs.readFileSync(file);
  console.log(`${file}\n  ${(data.length / 1048576).toFixed(2)} MB  sha256 ${crypto.createHash('sha256').update(data).digest('hex')}`);
}
