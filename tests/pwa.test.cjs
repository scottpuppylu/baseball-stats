// PWA files: manifest, icons, the service worker's cache list and what it refuses to cache. No browser needed.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pngSize = file => { const b = fs.readFileSync(path.join(root, file)); assert.equal(b.toString('ascii', 1, 4), 'PNG', file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest: names, standalone display, GitHub Pages sub-path and icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, '淡江航太系壘');
  assert.equal(m.short_name, '航太系壘');
  assert.equal(m.display, 'standalone');
  // Relative to the manifest, so they resolve to https://scottpuppylu.github.io/baseball-stats/ on GitHub Pages.
  for (const key of ['id', 'start_url', 'scope']) assert.equal(m[key], './', key);
  const scope = new URL(m.scope, 'https://scottpuppylu.github.io/baseball-stats/manifest.webmanifest').href;
  assert.equal(scope, 'https://scottpuppylu.github.io/baseball-stats/');
  assert.equal(m.background_color, '#070a12');
  const sizes = m.icons.map(i => `${i.sizes}:${i.purpose}`);
  for (const need of ['192x192:any', '512x512:any', '192x192:maskable', '512x512:maskable']) assert.ok(sizes.includes(need), need);
  for (const icon of m.icons) assert.deepEqual(pngSize(icon.src).join('x'), icon.sizes, icon.src);
});

test('page head links the manifest, iOS home-screen settings and local copies of its libraries', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title" content="航太系壘"/);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /<script src="https?:\/\//, 'no remote scripts: the app must work offline and inside the APK');
  for (const file of ['vendor/tailwindcss-play-3.4.17.js', 'vendor/chart.umd-4.5.1.min.js']) assert.ok(fs.statSync(path.join(root, file)).size > 100000, file);
});

test('service worker pre-caches exactly the program files the page loads', () => {
  const html = read('index.html');
  const sw = read('sw.js');
  const shell = vm.runInNewContext(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
  const local = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u));
  for (const url of local) assert.ok(shell.includes(url), `sw.js SHELL is missing ${url}`);
  for (const url of shell) {
    const file = url === './' ? 'index.html' : url.split('?')[0];
    assert.ok(fs.existsSync(path.join(root, file)), `cached file exists: ${file}`);
  }
  assert.ok(!shell.some(u => u.startsWith('data/')), 'team data is never pre-cached');
});

// Runs sw.js with a fake worker scope and records what each request would get.
function loadWorker() {
  const handlers = {};
  const self = {
    location: {origin: 'https://scottpuppylu.github.io'},
    registration: {scope: 'https://scottpuppylu.github.io/baseball-stats/'},
    addEventListener: (type, fn) => { handlers[type] = fn; },
    clients: {claim: async () => {}}, skipWaiting() { self.skipped = true; }
  };
  vm.runInNewContext(read('sw.js'), {self, caches: {open: async () => ({addAll: async () => {}}), keys: async () => [], match: async () => undefined}, fetch: async () => new Response(''), URL, Request, Response});
  const decide = (url, {method = 'GET', mode = 'cors'} = {}) => {
    let responded = false;
    handlers.fetch({request: {url, method, mode}, respondWith: p => { responded = true; Promise.resolve(p).catch(() => {}); }});
    return responded;
  };
  return {handlers, self, decide};
}

test('service worker never handles team data, sign-in, cloud API or GitHub traffic', () => {
  const {decide} = loadWorker();
  const base = 'https://scottpuppylu.github.io/baseball-stats/';
  for (const url of [
    'https://api.github.com/repos/scottpuppylu/baseball-stats/contents/data/logs.json?ref=data',
    'https://raw.githubusercontent.com/scottpuppylu/baseball-stats/data/data/logs.json',
    'https://baseball-stats-api.vercel.app/api/data/logs.json',
    'https://baseball-stats-api.vercel.app/api/auth/login?return_to=x',
    'https://accounts.google.com/o/oauth2/v2/auth',
    `${base}data/logs.json?t=1`,
    `${base}api/anything.js`,
    'https://scottpuppylu.github.io/other-project/app.js'
  ]) assert.equal(decide(url), false, url);
  assert.equal(decide(`${base}team-insights.js?v=1`, {method: 'POST'}), false, 'non-GET passes through');
});

test('service worker serves the app shell and versioned program files', () => {
  const {decide} = loadWorker();
  const base = 'https://scottpuppylu.github.io/baseball-stats/';
  assert.equal(decide(base, {mode: 'navigate'}), true);
  assert.equal(decide(`${base}team-insights.js?v=20261011-audit2`), true);
  assert.equal(decide(`${base}assets/logo-128.webp`), true);
});

test('updates wait for the page: no automatic skipWaiting on install', () => {
  const {handlers, self} = loadWorker();
  let waited = null;
  handlers.install({waitUntil: p => { waited = p; }});
  assert.ok(waited, 'install pre-caches');
  waited.catch(() => {});
  assert.equal(self.skipped, undefined);
  handlers.message({data: {type: 'SKIP_WAITING'}});
  assert.equal(self.skipped, true);
});

test('no GitHub write credential in anything the website, PWA or APK ships', () => {
  const shipped = ['index.html', 'app-config.js', 'cloud-sync.js', 'pwa.js', 'sw.js', 'ui-comfort.js', 'team-insights.js', 'team-records.js', 'lineup-model.js', 'lineup-recommender.js', 'player-diagnostics.js'];
  for (const file of shipped) {
    const text = read(file);
    assert.doesNotMatch(text, /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/, file);
    assert.doesNotMatch(text, /GITHUB_TOKEN|GITHUB_DATA_TOKEN|GOOGLE_CLIENT_SECRET|SESSION_SECRET/, file);
    assert.doesNotMatch(text, /\[(?:\d{2,3},){20,}\d{2,3}\]\.map\(c\s*=>\s*String\.fromCharCode/, `${file}: encoded string arrays`);
  }
});
