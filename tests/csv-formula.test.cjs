// A player name starting with = + - @ in the 成績匯總 CSV was read by Excel or Sheets as a formula (V-59). Such a cell
// now starts with ' so it stays text.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('    function csvCell(');
assert.notEqual(start, -1);
const source = html.slice(start, html.indexOf('\n    }\n', start) + 7);
const ctx = vm.createContext({RATE_KEYS: ['avg']});
vm.runInContext(source, ctx);

test('V-59: names that start with = + - @ stay text in the CSV', () => {
  assert.equal(ctx.csvCell({name: '=HYPERLINK("http://x","y")'}, 'name'), '"\'=HYPERLINK(""http://x"",""y"")"');
  for (const lead of ['+', '-', '@']) assert.equal(ctx.csvCell({name: `${lead}1+1`}, 'name'), `"'${lead}1+1"`);
});

test('ordinary names and numbers are unchanged', () => {
  assert.equal(ctx.csvCell({name: '王小明'}, 'name'), '"王小明"');
  assert.equal(ctx.csvCell({name: 'A "B"'}, 'name'), '"A ""B"""');
  assert.equal(ctx.csvCell({avg: 0.3333}, 'avg'), '0.333');
  assert.equal(ctx.csvCell({pa: 4}, 'pa'), '4');
});
