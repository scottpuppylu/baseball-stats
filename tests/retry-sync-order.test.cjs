// 「重新同步」 (retryPendingSync) uploads the drafts kept on this device. Like V-03, the team logs follow the games
// file: when the games upload fails, the logs are not sent (the cloud would hold logs that no longer match its games);
// they stay a draft for the next try and the page says why (V-03b).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
const marker = 'window.retryPendingSync = async function() {';
const start = source.indexOf(marker);
assert.notEqual(start, -1, marker);
const CODE = source.slice(start, source.indexOf('\n    };\n', start) + 7);

function page({pending, gamesOk = true, logsOk = true, guestsOk = true}) {
  const calls = [], results = [];
  const ctx = {
    window: {}, allGames: [], allLogs: [], guestPlayers: [],
    GAMES_FILE_PATH: 'data/games.json', DATA_FILE_PATH: 'data/logs.json', GUESTS_FILE_PATH: 'data/guests.json',
    pendingStore: () => Object.fromEntries(pending.map(file => [file, {}])),
    commitGamesToGitHub: async () => { calls.push('games'); return gamesOk; },
    commitLogsToGitHub: async () => { calls.push('logs'); return logsOk; },
    commitGuestsToGitHub: async () => { calls.push('guests'); return guestsOk; },
    renderAll() {},
    showSyncResult: (ok, okMessage, failMessage) => results.push({ok, okMessage, failMessage})
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return {ctx, calls, results};
}
const ALL = ['data/games.json', 'data/logs.json', 'data/guests.json'];

test('V-03b: 重新同步 sends no logs after the games upload failed, and says why', async () => {
  const p = page({pending: ALL, gamesOk: false});
  assert.equal(await p.ctx.window.retryPendingSync(), false);
  assert.deepEqual(p.calls, ['games', 'guests'], 'logs.json is not uploaded; the support roster does not depend on games');
  assert.equal(p.results.length, 1);
  assert.equal(p.results[0].ok, false);
  assert.match(p.results[0].failMessage, /^仍有修改尚未同步/, 'keeps the old opening');
  assert.match(p.results[0].failMessage, /賽事上傳失敗，日誌也先不送出/);
});

test('V-03b: when the games upload succeeds, or no games draft is pending, the logs are sent (unchanged)', async () => {
  const both = page({pending: ALL});
  assert.equal(await both.ctx.window.retryPendingSync(), true);
  assert.deepEqual(both.calls, ['games', 'logs', 'guests']);
  assert.equal(both.results[0].ok, true);

  const logsOnly = page({pending: ['data/logs.json']});
  assert.equal(await logsOnly.ctx.window.retryPendingSync(), true);
  assert.deepEqual(logsOnly.calls, ['logs']);

  const logsFail = page({pending: ALL, logsOk: false});
  assert.equal(await logsFail.ctx.window.retryPendingSync(), false);
  assert.deepEqual(logsFail.calls, ['games', 'logs', 'guests']);
  assert.equal(logsFail.results[0].failMessage, '仍有修改尚未同步；資料保留在這台裝置，請稍後再試。', 'other failures keep the old message');
});
