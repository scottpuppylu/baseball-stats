const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {extras, publicOnly} = require('../scripts/build-pwa.cjs');
const root = path.join(__dirname, '..');
// Images referenced only from stylesheets are not discovered from the HTML; the build must list them or the
// deployed site serves 404s (the page scenes went missing this way once).
test('every image a stylesheet references is published by the build', () => {
  const published = new Set([...extras, ...publicOnly]);
  for (const css of ['ui-theme.css', 'ui-comfort.css']) {
    const refs = [...fs.readFileSync(path.join(root, css), 'utf8').matchAll(/url\(\s*["']?(assets\/[^"')]+)["']?\s*\)/g)].map(m => m[1]);
    for (const ref of new Set(refs)) {
      assert.ok(published.has(ref), `${css} uses ${ref}, which the build does not publish`);
      assert.ok(fs.existsSync(path.join(root, ref)), `${ref} exists`);
    }
  }
});
