// An empty jersey field became Number('') = 0, so a record went silently to player #0; a new player with an empty or
// decimal jersey was created as #0 or #1.5; the new player's date was not required (V-41).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
function extract(marker, endMarker) {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, marker);
  return html.slice(start, html.indexOf(endMarker, start) + endMarker.length);
}

test('V-41: a jersey is an integer from 0 to 999, and an empty field is not 0', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract('    function parseJersey(', '\n    }\n'), ctx);
  for (const [text, want] of [['0', 0], ['7', 7], [' 42 ', 42], ['999', 999], ['', null], ['   ', null], ['1.5', null],
    ['-1', null], ['1000', null], ['abc', null], ['1e2', null], [undefined, null]]) assert.equal(ctx.parseJersey(text), want, String(text));
});

test('V-41: both forms reject an invalid jersey, and the new player form requires a date', () => {
  const addLog = extract("    document.getElementById('addLogForm').addEventListener('submit'", '\n    });\n');
  const addPlayer = extract("    document.getElementById('addPlayerForm').addEventListener('submit'", '\n    });\n');
  assert.match(addLog, /const jerseyNum = parseJersey\(document\.getElementById\('new_jersey'\)\.value\);\n\s*if \(jerseyNum === null\)/);
  assert.match(addPlayer, /const num = parseJersey\(document\.getElementById\('reg_jersey'\)\.value\);/);
  assert.match(addPlayer, /if \(num === null\)/);
  assert.match(addPlayer, /if \(!date\) \{\n\s*showToast\(/, 'date required');
  assert.ok(addPlayer.indexOf('if (!date)') < addPlayer.indexOf('const regLog'), 'checked before the record is built');
});
