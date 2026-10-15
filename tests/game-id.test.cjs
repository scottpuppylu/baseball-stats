const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const expression = html.slice(html.indexOf('window.startNewGameFromSetup = function()')).match(/const gameId = ([^\r\n]+);/)[1];
test('new game IDs remain distinct with a frozen clock on multiple devices', () => {
  const ids = new Set();
  const script = new vm.Script(expression);
  for (const offset of [0, 10000]) {
    const device = vm.createContext({date: '2026-10-16', crypto: webcrypto, Date: {now: () => 1792098000000 + offset}});
    for (let n = 0; n < 100; n++) {
      const id = script.runInContext(device);
      assert.ok(typeof id === 'string' && id.startsWith('game_20261016_'));
      ids.add(id);
    }
  }
  assert.equal(ids.size, 200, 'different games must not alias the same cloud merge key');
});
