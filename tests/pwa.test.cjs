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
  assert.ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(html));
  assert.ok(/apple-mobile-web-app-capable" content="yes"/.test(html));
  assert.ok(/apple-mobile-web-app-title" content="航太系壘"/.test(html));
  assert.ok(/viewport-fit=cover/.test(html));
  assert.ok(!/<script src="https?:\/\//.test(html), 'PWA program dependencies are local');
  for (const file of ['vendor/tailwindcss-play-3.4.17.js', 'vendor/chart.umd-4.5.1.min.js']) assert.ok(fs.statSync(path.join(root, file)).size > 100000, file);
});

test('release pre-caches exactly the program files the generated page loads', () => {
  const release = require('../scripts/build-pwa.cjs').build(file => fs.readFileSync(path.join(root, file)));
  const html = release.files.get('index.html').toString();
  const shell = release.release.files.map(entry => entry.url);
  for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) assert.ok(shell.includes(m[1]), 'resource included');
  assert.ok(!shell.some(url => url.startsWith('data/')));
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
  const built = require('../scripts/build-pwa.cjs').build(file => fs.readFileSync(path.join(root, file)));
  vm.runInNewContext(built.files.get('sw.js').toString(), {self, caches: {open: async () => ({addAll: async () => {}, put: async () => {}}), delete: async () => {}, keys: async () => [], match: async () => undefined}, fetch: async () => new Response('const GITHUB_TOKEN = "unit-only";'), URL, Request, Response, Headers});
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
  assert.equal(decide(`${base}team-insights.js`), true);
  assert.equal(decide(`${base}unrelated.js`), false, 'only explicit static resources may be cached');
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
  assert.equal(self.skipped, undefined, 'unguarded legacy update message refused');
});

test('accepted legacy declaration is unchanged; no credential copies in other shipped programs', () => {
  const {execFileSync} = require('node:child_process');
  const main = execFileSync('git', ['show', '40f2c23:index.html'], {encoding: 'utf8', cwd: root});
  const declaration = /const GITHUB_TOKEN = [^;\r\n]*;/g;
  const original = main.match(declaration), current = read('index.html').match(declaration);
  // Boolean assertion avoids printing a credential-bearing actual/expected value on failure.
  assert.ok(original?.length === 1 && current?.length === 1 && original[0] === current[0], 'only the existing declaration may be retained (RISK_ACCEPTED)');
  const shipped = ['app-config.js', 'local-cache.js', 'pwa.js', 'sw.js', 'ui-comfort.js', 'team-insights.js', 'team-records.js', 'lineup-model.js', 'lineup-recommender.js', 'player-diagnostics.js'];
  for (const file of shipped) {
    const text = read(file);
    assert.doesNotMatch(text, /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/, file);
    assert.doesNotMatch(text, /GITHUB_DATA_TOKEN|GOOGLE_CLIENT_SECRET|SESSION_SECRET/, file);
    assert.doesNotMatch(text, /\[(?:\d{2,3},){20,}\d{2,3}\]\.map\(c\s*=>\s*String\.fromCharCode/, `${file}: encoded string arrays`);
  }
});

test('offline HTML strips the credential and fails closed on an unknown declaration', async () => {
  const code = read('sw.js').match(/async function offlinePage\(response\) \{[\s\S]*?\n\}/)[0];
  const ctx = vm.createContext({Response, Headers});
  vm.runInContext('const declaration = /const GITHUB_TOKEN = [^;\\r\\n]*;/g;\n' + code, ctx);
  const cached = await ctx.offlinePage(new Response('<script>const GITHUB_TOKEN = "test-only-value";</script>'));
  const html = await cached.text();
  assert.ok(!html.includes('test-only-value'));
  assert.ok(html.includes("const GITHUB_TOKEN = ''; window.BASEBALL_OFFLINE_SHELL = true;"));
  await assert.rejects(ctx.offlinePage(new Response('<script>unknown declaration</script>')), /refused to cache/);
  await assert.rejects(ctx.offlinePage(new Response('const GITHUB_TOKEN = "a"; const GITHUB_TOKEN = "b";')), /refused to cache/);
});

test('PWA release has no native framework, backend, OAuth or native CI dependency', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!Object.keys({...pkg.dependencies, ...pkg.devDependencies}).some(name => name.startsWith('@capacitor/')));
  assert.ok(!Object.keys(pkg.scripts).some(name => /android|cap:|build:web/.test(name)));
  assert.ok(!fs.existsSync(path.join(root, '.github/workflows/android.yml')));
  for (const file of ['capacitor.config.json', 'cloud-sync.js', 'app-native.js', 'cloud-api/api/index.mjs']) assert.ok(!fs.existsSync(path.join(root, file)), `${file} removed from product`);
  assert.ok(!/cloud-sync|app-native|cloudApi|apiBase|GOOGLE_CLIENT/.test(read('index.html') + read('app-config.js')));
});
