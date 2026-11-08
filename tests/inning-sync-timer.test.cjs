// After a successful inning upload, a 3 s timer put the button back to its idle state unconditionally: it could hide
// a later 「同步失敗」 (the scorer thinks it worked) and unlock the button while another upload was still running (V-17).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('    async function commitGamesToGitHub(');
assert.notEqual(start, -1);
const source = html.slice(start, html.indexOf('\n    }\n', start) + 7);

function load() {
  const timers = new Map();
  let nextId = 1;
  const button = {innerHTML: '', className: '', disabled: false};
  const uploads = [];
  const ctx = vm.createContext({
    button, uploads,
    document: {getElementById: id => (id === 'btnInningCloudSync' ? button : null)},
    setStatusBadge() {}, showToast() {}, syncAllGamesToTeamLogs() {}, isSimulatedGame: () => false,
    localCache: {set() {}},
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    commitJsonFile() { return new Promise((resolve, reject) => uploads.push({resolve, reject})); }
  });
  vm.runInContext(`var currentGamesSha = null, allGames = [], GAMES_FILE_PATH = 'data/games.json';\n`
    + `var inningSyncResetTimer = null, gamesWritesInFlight = 0;\n${source}`, ctx);
  ctx.runTimers = () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(fn => fn()); };
  return ctx;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('V-17: a failure after a success stays on the button after the 3 s timer', async () => {
  const ctx = load();
  const first = ctx.commitGamesToGitHub([]);
  ctx.uploads[0].resolve({sha: 'a', data: [], merged: false});
  assert.equal(await first, true);
  assert.match(ctx.button.innerHTML, /成功/);
  const second = ctx.commitGamesToGitHub([]);
  ctx.uploads[1].reject(new Error('HTTP 500'));
  assert.equal(await second, false);
  ctx.runTimers(); // the first upload's 3 s are up
  assert.match(ctx.button.innerHTML, /同步失敗/, 'the failure is still shown');
});

test('V-17: the timer does not unlock the button while another upload is running', async () => {
  const ctx = load();
  const a = ctx.commitGamesToGitHub([]);
  const b = ctx.commitGamesToGitHub([]);
  ctx.uploads[0].resolve({sha: 'a', data: [], merged: false});
  await a;
  ctx.runTimers();
  assert.equal(ctx.button.disabled, true, 'still locked: upload B is in flight');
  ctx.uploads[1].resolve({sha: 'b', data: [], merged: false});
  await b;
  await tick();
  ctx.runTimers();
  assert.equal(ctx.button.disabled, false, 'unlocked once nothing is uploading');
  assert.match(ctx.button.innerHTML, /上傳本局戰況/);
});
