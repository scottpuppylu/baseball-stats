const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sources = ['index.html', ...fs.readdirSync(root).filter(f => f.endsWith('.js'))];
// The page uses prebuilt Tailwind (no runtime compiler watching the DOM: that was most of the scroll-time CPU on phones).
test('the page loads the prebuilt Tailwind CSS, not the Play compiler', () => {
  const html = read('index.html');
  assert.ok(!/tailwindcss-play/.test(html), 'no Tailwind Play script');
  assert.ok(/<link rel="stylesheet" href="vendor\/tailwind-site\.css">/.test(html));
  assert.ok(html.indexOf('ui-theme.css') < html.indexOf('vendor/tailwind-site.css'), 'Tailwind stays after the site styles (same cascade as before)');
});
test('class names are written out in full, so the static build can see them', () => {
  for (const file of sources) assert.doesNotMatch(read(file), /["'`\s](?:text|bg|border|from|to|via|ring|grid-cols|col-span)-\$\{/, `${file}: assembled Tailwind class name`);
});
test('the prebuilt CSS covers the common utilities the source uses (rebuild with node scripts/build-tailwind.cjs)', () => {
  const css = read('vendor/tailwind-site.css');
  const esc = t => t.replace(/([:/.[\]#%!(),])/g, '\\$1');
  const re = /^(?:(?:sm|md|lg|xl|hover|focus):)?(?:bg|text|border|grid-cols|col-span|gap|rounded|px|py|p|mt|mb|space-y|space-x)-[a-z0-9./[\]#%-]+$/;
  const missing = new Set();
  for (const file of sources) for (const t of read(file).split(/[\s"'`<>=;{}\\]+/)) if (re.test(t) && !css.includes('.' + esc(t) + '{') && !css.includes('.' + esc(t) + ':')) missing.add(t);
  // Tokens that look like utilities but are not classes (e.g. inside text) are tolerated if Tailwind itself has no such utility.
  const known = [...missing].filter(t => !/^(?:text|bg|border)-(?:\d|\[)/.test(t) || /\]$/.test(t));
  assert.ok(known.length < 25, `utilities missing from vendor/tailwind-site.css: ${known.slice(0, 20).join(' ')}`);
});
