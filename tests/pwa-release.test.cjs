const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {build, digest} = require('../scripts/build-pwa.cjs');
const root = path.resolve(__dirname, '..');
const read = file => {
  const bytes = fs.readFileSync(path.join(root, file));
  return file === 'index.html' ? Buffer.from(bytes.toString().replace(/const GITHUB_TOKEN = [^;\r\n]*;/g, 'const GITHUB_TOKEN = "unit-fixture";')) : bytes;
};
test('automatic release is reproducible, idempotent, and covers every resource with SHA-256', () => {
  const a = build(read), b = build(read), c = build(file => a.files.get(file) || read(file));
  assert.equal(a.version, b.version); assert.equal(a.version, c.version);
  for (const entry of a.release.files) assert.equal(digest(a.files.get(entry.file)), entry.sha256);
  for (const file of a.files.keys()) if (file !== 'index.html') assert.equal(a.files.get(file).includes('unit-fixture'), false);
});
test('JS-only and CSS-only changes change the release and HTML URLs without manual versions', () => {
  const a = build(read);
  for (const target of ['ui-comfort.js', 'ui-comfort.css', 'sw.js']) {
    const b = build(file => file === target ? Buffer.concat([read(file), Buffer.from('\n/* changed */')]) : read(file));
    assert.notEqual(a.version, b.version);
    assert.notEqual(digest(a.files.get('index.html')), digest(b.files.get('index.html')));
  }
});
test('release changes only resource links and release meta, preserving all inline business code', () => {
  const before = read('index.html').toString().replace(/\r\n/g, '\n');
  const after = build(read).files.get('index.html').toString();
  const inline = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => digest(m[1]));
  assert.deepEqual(inline(after), inline(before));
  assert.equal((after.match(/const GITHUB_TOKEN =/g) || []).length, 1);
});

test('activation preserves another in-flight installer while removing completed old and legacy caches', async () => {
  const vm = require('node:vm');
  const release = build(read);
  const scope = 'https://example.test/baseball-stats/';
  const old = 'tkaero-shell-' + 'a'.repeat(24), downloading = 'tkaero-shell-' + 'b'.repeat(24), legacy = 'tkaero-shell-20261016-pwa1';
  const deleted = [];
  const handlers = {};
  const self = {registration:{scope}, addEventListener:(key,fn)=>handlers[key]=fn, clients:{claim:async()=>{}}};
  vm.runInNewContext(release.files.get('sw.js').toString(), {self, URL, caches:{keys:async()=>[old,downloading,legacy,'other-app'],open:async key=>({match:async()=>key===old?new Response('complete'):undefined}),delete:async key=>deleted.push(key)}});
  let completion;handlers.activate({waitUntil:promise=>completion=promise});await completion;
  assert.deepEqual(deleted,[old,legacy]);
});
