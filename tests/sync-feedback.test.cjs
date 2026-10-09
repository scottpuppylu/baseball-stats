const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');

// Evaluate only selected functions, with no network, real credentials, or browser storage.
function extract(marker, ending) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const end = source.indexOf(ending, start);
  assert.notEqual(end, -1, marker);
  return source.slice(start, end + ending.length);
}
function context(extra = {}) {
  const messages = [], statuses = [], removed = [];
  const game = { id: 'test_game', opponent: 'test', date: '2026-10-04', finalScore: { us: 1, opp: 0 }, innings: [], lineup: ['test_player'] };
  const ctx = {
    window: {}, messages, statuses, removed, activeGame: game, allGames: [game], allLogs: [],
    selectedReviewGameId: game.id, isEditingReviewGame: true,
    document: { getElementById: () => null },
    localStorage: { setItem() {}, removeItem: key => removed.push(key) },
    showToast: (message, type) => messages.push({ message, type }),
    setStatusBadge: (message, type) => statuses.push({ message, type }),
    confirm: () => true, renderAll() {}, renderLiveScorer() {}, renderGameReview() {},
    renderSelectedGameReview() {}, switchScorebookSubTab() {}, syncAllGamesToTeamLogs() {},
    ...extra,
  };
  vm.createContext(ctx);
  vm.runInContext(extract('function showSyncResult(', '\n    }'), ctx);
  return ctx;
}
function install(ctx, name) {
  vm.runInContext(extract(`window.${name} =`, '\n    };'), ctx);
}

test('complete inline script parses', () => { new vm.Script(source); });

for (const status of [200, 403, 409, 500, 'network']) {
  test(`guest upload reports ${status} accurately`, async () => {
    const ctx = context({
      GITHUB_REPO: 'test', GITHUB_BRANCH: 'test', GUESTS_FILE_PATH: 'test',
      GITHUB_TOKEN: 'mock', currentGuestsSha: null, utf8ToBase64: value => value,
      fetch: async () => {
        if (status === 'network') throw new Error('offline');
        return { ok: status === 200, status, json: async () => ({ sha: 'test', content: { sha: 'test' }, message: 'test error' }) };
      },
    });
    vm.runInContext(extract('async function commitGuestsToGitHub(', '\n    }'), ctx);
    assert.equal(await ctx.commitGuestsToGitHub([]), status === 200);
    assert.equal(ctx.statuses.at(-1).type, status === 200 ? 'success' : 'error');
  });
}

for (const success of [false, true]) {
  test(`inning sync success=${success}`, async () => {
    const ctx = context({ commitGamesToGitHub: async () => success });
    install(ctx, 'syncCurrentInningToCloud');
    await ctx.window.syncCurrentInningToCloud();
    assert.equal(ctx.messages.at(-1).message.includes('成功'), success);
    if (!success) assert.equal(ctx.messages.at(-1).type, 'error');
    assert.ok(ctx.activeGame);
  });
  test(`review sync awaits result and displays numeric count, success=${success}`, async () => {
    const ctx = context({ syncGameToTeamLogs: async () => ({ count: 3, success }) });
    install(ctx, 'syncReviewGameToTeamLogs');
    await ctx.window.syncReviewGameToTeamLogs();
    assert.equal(ctx.messages.at(-1).message.includes('成功'), success);
    assert.ok(!ctx.messages.at(-1).message.includes('[object Promise]'));
    if (success) assert.ok(ctx.messages.at(-1).message.includes('3 位'));
  });
  test(`manual log deletion success=${success}`, async () => {
    const ctx = context({ allLogs: [{ id: 'manual', name: 'test', jersey: 1 }], commitLogsToGitHub: async () => success });
    install(ctx, 'deleteSingleLog');
    await ctx.window.deleteSingleLog('manual');
    assert.equal(ctx.messages.at(-1).type === 'error', !success);
  });
}

for (const gamesSynced of [false, true]) {
  for (const logsSynced of [false, true]) {
    const success = gamesSynced && logsSynced;
    for (const name of ['finishActiveGameAndSyncLogs', 'saveEditedReviewGame', 'deleteReviewGame', 'deleteSingleLog']) {
      test(`${name}: games=${gamesSynced}, logs=${logsSynced}`, async () => {
        const ctx = context({
          allLogs: [{ id: 'log_game_test_game_1', gameId: 'test_game' }],
          commitGamesToGitHub: async () => gamesSynced,
          commitLogsToGitHub: async () => logsSynced,
        });
        install(ctx, name);
        await ctx.window[name](name === 'deleteSingleLog' ? 'log_game_test_game_1' : 'test_game');
        assert.equal(ctx.messages.at(-1).type === 'error', !success);
        if (!success) assert.equal(ctx.statuses.at(-1).type, 'error');
        if (name === 'finishActiveGameAndSyncLogs') {
          assert.equal(ctx.activeGame === null, success);
          assert.equal(ctx.removed.includes('rebas_active_game'), success);
        }
        if (name === 'saveEditedReviewGame') assert.equal(ctx.isEditingReviewGame, !success);
      });
    }
  }
}

for (const success of [false, true]) {
  test(`game-to-log sync returns count and upload result, success=${success}`, async () => {
    const ctx = context({
      getGameAllBatters: () => ['test_player'], isGuestPlayerName: () => false,
      NAME_TO_JERSEY: { test_player: 1 }, commitLogsToGitHub: async () => success,
    });
    vm.runInContext(extract('function isRunnerOutPlay(', '\n    }'), ctx);
    vm.runInContext(extract('async function syncGameToTeamLogs(', '\n    }'), ctx);
    const result = await ctx.syncGameToTeamLogs({
      id: 'test_game', innings: [{ plateAppearances: [{ batterName: 'test_player', result: '1H' }] }],
    });
    assert.equal(result.count, 1);
    assert.equal(result.success, success);
  });
}

test('runner outs, including the legacy OUT records, never count as the batter\'s plate appearance', () => {
  const ctx = context({});
  vm.runInContext(extract('function isRunnerOutPlay(', '\n    }'), ctx);
  for (const pa of [{result: 'RUNNER_OUT'}, {result: 'OUT'}, {result: 'OUT', isRunnerOut: true}, {result: 'GO', isRunnerOut: true}]) assert.equal(ctx.isRunnerOutPlay(pa), true, JSON.stringify(pa));
  for (const result of ['1H', '2H', '3H', 'HR', 'BB', 'SF', 'K', '界外K', 'GO', 'FO', 'LO', 'E', 'FC', 'DP']) assert.equal(ctx.isRunnerOutPlay({result}), false, result);
  // The runner-out button now also stores the flag.
  assert.match(source, /result: 'OUT',\n\s+isRunnerOut: true,/);
});
