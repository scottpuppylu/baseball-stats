// `npm test`: unit tests, then every browser test against its own fresh isolated preview and Chrome.
// A fresh preview per test keeps one test's simulated writes from leaking into the next.
// Needs Google Chrome installed (tests use Playwright's `chrome` channel); never writes data/*.json.
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
// Defense in depth: never persist a credential or its legacy declaration if a failing assertion quotes page source.
const redact = value => String(value).replace(/const GITHUB_TOKEN = [^;]*;/g, 'const GITHUB_TOKEN = [REDACTED];')
  .replace(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]');

const root = path.resolve(__dirname, '..');
const output = process.env.UI_QA_OUTPUT || path.join(os.tmpdir(), 'baseball-ui-qa');
const browserTests = ['ui-integrity-browser', 'ui-pwa', 'ui-pwa-rollback', 'ui-startup', 'ui-workflows', 'ui-audit-fixes', 'ui-audit-fixes-2', 'ui-data-safety', 'ui-round3', 'spray-archive-browser', 'ui-insights', 'ui-lineup', 'ui-data-fixes', 'ui-review-fixes', 'ui-records', 'ui-responsive', 'ui-mobile-comfort', 'ui-avatar', 'ui-tablet']
  .filter(name => fs.existsSync(path.join(__dirname, `${name}.cjs`)))
  // `node tests/run-all.cjs ui-avatar ui-tablet` runs only the named browser tests (the unit tests always run).
  .filter(name => process.argv.length <= 2 || process.argv.slice(2).includes(name));

// Windows can allocate port 2049 for listen(0); Fetch/Chrome reject it even when the preview is healthy.
// Probe an unprivileged high port instead of a browser-restricted service port.
const reserved = new Set();
async function freePort() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const port = crypto.randomInt(20000, 60000);
    if (reserved.has(port)) continue;
    const available = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) { reserved.add(port); return port; }
  }
  throw new Error('No available browser-safe test port');
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return; } catch (error) { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`preview did not start: ${url}`);
}

function run(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {cwd: root, env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { text += chunk; });
    child.on('close', code => resolve({code, text: redact(text)}));
  });
}

(async () => {
  fs.mkdirSync(output, {recursive: true});
  const results = [];
  const units = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.cjs')).map(f => path.join('tests', f));
  console.log(`▶ unit tests (${units.length} files)`);
  const unit = spawnSync(process.execPath, ['--test', ...units], {cwd: root, encoding: 'utf8'});
  unit.stdout = redact(unit.stdout);
  unit.stderr = redact(unit.stderr);
  const summary = (unit.stdout.match(/^ℹ (tests|pass|fail) \d+$/gm) || []).join(', ');
  results.push({name: 'unit', ok: unit.status === 0, detail: summary});
  if (unit.status !== 0) console.log(unit.stdout.split('\n').filter(l => /✖|Error|expected|actual/.test(l)).slice(0, 30).join('\n'));

  for (const name of browserTests) {
    const port = await freePort(), cdpPort = await freePort();
    const preview = spawn(process.execPath, [path.join('tests', 'ui-preview-server.cjs')], {cwd: root, env: {...process.env, UI_PREVIEW_PORT: String(port)}, stdio: 'ignore'});
    let browser;
    try {
      await waitFor(`http://127.0.0.1:${port}/`);
      browser = await chromium.launch({channel: 'chrome', headless: true, args: [`--remote-debugging-port=${cdpPort}`]});
      await waitFor(`http://127.0.0.1:${cdpPort}/json/version`);
      console.log(`▶ ${name}`);
      const {code, text} = await run([path.join('tests', `${name}.cjs`)], {
        UI_PREVIEW_URL: `http://127.0.0.1:${port}`, UI_CDP_URL: `http://127.0.0.1:${cdpPort}`, UI_QA_OUTPUT: output
      });
      const last = text.trim().split('\n').slice(-1)[0] || '';
      results.push({name, ok: code === 0, detail: code === 0 ? last.slice(0, 140) : text.trim().split('\n').slice(-12).join('\n')});
    } catch (error) {
      results.push({name, ok: false, detail: error.message});
    } finally {
      if (browser) await browser.close().catch(() => {});
      preview.kill();
    }
  }

  console.log('\n結果：');
  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}  ${r.ok ? r.detail : `\n${r.detail}`}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 通過；截圖與報告：${output}`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
