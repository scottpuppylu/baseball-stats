// While the guest roster upload is in flight, the page may add, change or remove guests. When the upload had to merge
// with a newer cloud copy, the merged result replaced the roster and dropped those edits; the next upload would then
// also remove a newly added guest from the cloud (V-08).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('    async function commitGuestsToGitHub(');
assert.notEqual(start, -1);
const source = html.slice(start, html.indexOf('\n    }\n', start) + 7);

function load(cloudData, duringUpload) {
  const ctx = vm.createContext({
    window: {}, stored: null, badge: null, jerseySynced: 0,
    localStorage: {setItem(key, value) { ctx.stored = value; }},
    setStatusBadge(text, kind) { ctx.badge = kind; },
    syncJerseyMaps() { ctx.jerseySynced++; },
    async commitJsonFile(path, data) {
      const sent = cloudData(JSON.parse(JSON.stringify(data))); // merged and serialized before the PUT goes out
      await null;
      duringUpload(ctx); // the page edits the roster while the request is out
      return {sha: 'new', merged: true, data: sent};
    }
  });
  vm.runInContext(`var currentGuestsSha = null; var GUESTS_FILE_PATH = 'data/guests.json';\n${source}`, ctx);
  return ctx;
}

test('V-08: guests added or changed during a merged upload stay on the page', async () => {
  const ctx = load(
    sent => [...sent.map(g => ({...g})), {name: 'Cloud', jersey: 7}], // another device added "Cloud"
    c => {
      c.guestPlayers.push({name: 'Late', jersey: 3});
      c.guestPlayers.find(g => g.name === 'A').jersey = 99;
    });
  ctx.guestPlayers = [{name: 'A', jersey: 1}];
  const before = JSON.parse(JSON.stringify(ctx.guestPlayers));
  assert.equal(await ctx.commitGuestsToGitHub(ctx.guestPlayers), true);
  const byName = Object.fromEntries(ctx.guestPlayers.map(g => [g.name, g.jersey]));
  assert.deepEqual(byName, {A: 99, Cloud: 7, Late: 3}, 'cloud addition kept, page edits during the upload kept');
  assert.deepEqual(JSON.parse(ctx.stored).map(g => g.name).sort(), ['A', 'Cloud', 'Late']);
  assert.deepEqual(before, [{name: 'A', jersey: 1}]);
});

test('V-08: a guest removed during a merged upload stays removed; untouched guests take the cloud version', async () => {
  const ctx = load(
    sent => sent.map(g => ({...g, jersey: g.name === 'B' ? 20 : g.jersey})), // the cloud changed B's number
    c => { c.guestPlayers = c.window.guestPlayers = c.guestPlayers.filter(g => g.name !== 'A'); });
  ctx.guestPlayers = [{name: 'A', jersey: 1}, {name: 'B', jersey: 2}];
  await ctx.commitGuestsToGitHub(ctx.guestPlayers);
  assert.deepEqual(ctx.guestPlayers.map(g => [g.name, g.jersey]), [['B', 20]]);
});
