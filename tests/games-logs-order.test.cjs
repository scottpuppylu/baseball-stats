// Deleting a game (from a log or from the review page) and saving a review edit change both cloud files. The team
// logs follow the games file: when the games upload fails, the logs must not be sent either (the cloud would hold
// logs that no longer match its games); both stay a draft on this device and the page says so (V-03).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
function extract(marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const end = source.indexOf('\n    };\n', start);
  assert.notEqual(end, -1, marker);
  return source.slice(start, end + 7);
}
const CODE = [
  extract('window.deleteSingleLog = async (id) => {'),
  extract('window.deleteReviewGame = async function() {'),
  extract('window.saveEditedReviewGame = async function(gameId) {')
].join('\n');

function page({gamesOk, logsOk}) {
  const game = {id: 'g1', date: '2026-10-04', opponent: 'test', innings: []};
  const calls = [], staged = [], results = [], cache = {};
  const ctx = {
    window: {}, allGames: [game, {id: 'g2', date: '2026-10-05', opponent: 'other'}],
    allLogs: [{id: 'log_game_g1_7', gameId: 'g1', jersey: 7}, {id: 'log_manual_1', jersey: 8}],
    selectedReviewGameId: 'g1', reviewEditSnapshot: null, isEditingReviewGame: true,
    GAMES_FILE_PATH: 'data/games.json', DATA_FILE_PATH: 'data/logs.json',
    localCache: {set: (key, value) => { cache[key] = value; }},
    confirm: () => true, renderAll() {}, renderGameReview() {}, showToast() {},
    document: {getElementById: () => null, querySelectorAll: () => []},
    rejectUnsafeText: () => false, applyReviewFormToGame: g => { g.opponent = 'edited'; },
    syncAllGamesToTeamLogs() { calls.push('rebuild logs'); },
    commitGamesToGitHub: async () => { calls.push('games'); return gamesOk; },
    commitLogsToGitHub: async () => { calls.push('logs'); return logsOk; },
    stagePendingChanges: (file, data) => { staged.push({file, data: JSON.parse(JSON.stringify(data))}); return null; },
    showSyncResult: (ok, okMessage, failMessage) => results.push({ok, okMessage, failMessage})
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return {ctx, calls, staged, results, cache};
}
const ACTIONS = {
  'delete a game from its log': p => p.ctx.window.deleteSingleLog('log_game_g1_7'),
  'delete a game on the review page': p => p.ctx.window.deleteReviewGame(),
  'save a review edit': p => p.ctx.window.saveEditedReviewGame('g1')
};

for (const [name, run] of Object.entries(ACTIONS)) {
  test(`V-03: ${name}: a failed games upload sends no logs; both stay drafts here and the page says so`, async () => {
    const p = page({gamesOk: false, logsOk: true});
    await run(p);
    assert.equal(p.calls.filter(c => c === 'games').length, 1);
    assert.equal(p.calls.includes('logs'), false, 'logs.json is not uploaded after games.json failed');
    const logsDraft = p.staged.find(s => s.file === 'data/logs.json');
    assert.ok(logsDraft, 'the logs change is kept as a draft for 重新同步');
    assert.deepEqual(logsDraft.data, JSON.parse(JSON.stringify(p.ctx.allLogs)), 'the draft is this device\'s logs');
    if (p.cache.rebas_logs) assert.deepEqual(logsDraft.data, JSON.parse(p.cache.rebas_logs));
    assert.equal(p.results.length, 1);
    assert.equal(p.results[0].ok, false);
    assert.match(p.results[0].failMessage, /賽事/, 'the message names the games upload');
    assert.match(p.results[0].failMessage, /日誌/, 'and says the logs were not sent');
  });

  test(`${name}: when only the logs upload fails, the games are in the cloud and the failure is shown (unchanged)`, async () => {
    const p = page({gamesOk: true, logsOk: false});
    await run(p);
    assert.deepEqual(p.calls.filter(c => c !== 'rebuild logs'), ['games', 'logs']);
    assert.equal(p.results.length, 1);
    assert.equal(p.results[0].ok, false);
  });

  test(`${name}: both uploads succeed (unchanged)`, async () => {
    const p = page({gamesOk: true, logsOk: true});
    await run(p);
    assert.deepEqual(p.calls.filter(c => c !== 'rebuild logs'), ['games', 'logs']);
    assert.equal(p.staged.length, 0);
  });
}
