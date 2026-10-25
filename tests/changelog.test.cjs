const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {CHANGELOG, dateOf} = require('../changelog.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
test('every release adds a changelog entry for the header version, newest first', () => {
  const badge = html.match(/>(v\d{6}\.\d{4})</)[1];
  assert.equal(CHANGELOG[0].v, badge, 'add an entry for the new version at the top of changelog.js');
  assert.equal(new Set(CHANGELOG.map(e => e.v)).size, CHANGELOG.length, 'versions are unique');
  for (const entry of CHANGELOG) {
    assert.match(entry.v, /^v\d{4}(\d{2})?\.\d{4}$/, entry.v);
    assert.ok(dateOf(entry.v), entry.v);
    assert.ok(entry.items.length && entry.items.every(item => typeof item === 'string' && item.trim()), entry.v);
  }
  const dated = CHANGELOG.map(e => dateOf(e.v));
  assert.deepEqual(dated, [...dated].sort().reverse(), 'entries are ordered newest first');
});
test('the changelog script is loaded by the page', () => {
  assert.match(html, /<script src="changelog\.js"><\/script>/);
});
