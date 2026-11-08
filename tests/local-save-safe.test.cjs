// localStorage.setItem throws when the device storage is full or blocked (private mode). Thrown out of these flows it
// (a) dropped a tag silently, (b) reported a tag that reached the cloud as "同步失敗", and (c) left a game start, a
// pitching change or a position change in memory without updating the screen. The flow now goes on and the scorer is
// told the local copy failed (V-09).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const read = file => readFileSync(join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
function extract(source, marker, endMarker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, marker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end + endMarker.length);
}
const fullStorage = () => ({setItem() { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }, getItem: () => null});
const storeLocalSource = () => extract(html, '    function storeLocal(', '\n    }\n');

test('V-09: storeLocal reports a failed local save and does not throw', () => {
  const toasts = [];
  const ctx = vm.createContext({localStorage: fullStorage(), Date, showToast: (m, t) => toasts.push([m, t])});
  vm.runInContext(`var localSaveWarnedAt = 0;\n${storeLocalSource()}`, ctx);
  assert.equal(ctx.storeLocal('k', 'v'), false);
  assert.equal(ctx.storeLocal('k', 'v'), false);
  assert.equal(toasts.length, 1, 'one notice, not one per write');
  assert.match(toasts[0][0], /本機暫存失敗/);
  assert.equal(toasts[0][1], 'error');
  const ok = vm.createContext({localStorage: {setItem(k, v) { ok.saved = [k, v]; }}, Date, showToast() { throw new Error('no toast'); }});
  vm.runInContext(`var localSaveWarnedAt = 0;\n${storeLocalSource()}`, ok);
  assert.equal(ok.storeLocal('k', 'v'), true);
  assert.deepEqual([...ok.saved], ['k', 'v']);
});

test('V-09: a tag that reached the cloud is reported as synced even when the local save fails', async () => {
  const ctx = vm.createContext({
    localStorage: fullStorage(), Date, badges: [], toasts: [],
    setStatusBadge(text, kind) { ctx.badges.push(kind); }, showToast(m, t) { ctx.toasts.push(m); },
    commitJsonFile: async (path, data) => ({sha: 's', data}),
    getAggregatedStats: () => ({}), getFilteredLogs: () => [], renderPlayerProfile() { ctx.rendered = true; }
  });
  vm.runInContext(`var localSaveWarnedAt = 0, currentTagsSha = null, playerTags = {}, TAGS_FILE_PATH = 'data/tags.json';\n${storeLocalSource()}\n`
    + extract(html, '    async function commitTagsToGitHub(', '\n    }\n'), ctx);
  assert.equal(await ctx.commitTagsToGitHub({A: ['x']}), true);
  assert.equal(ctx.badges.at(-1), 'success');
  assert.equal(ctx.rendered, true);
});

test('V-09: a position change still redraws the scorer when the local save fails', () => {
  const source = read('scorebook-lineup.js');
  const ctx = vm.createContext({
    localStorage: fullStorage(), Date, toasts: [], showToast(m) { ctx.toasts.push(m); }, confirm: () => true,
    POSITIONS: [{key: 'P'}, {key: 'C'}], gameDefenseSnapshot: () => ({}), saveLineupDefenseChange() {},
    swapLineupPosition(list, i, pos) { const j = list.indexOf(pos); if (j >= 0) list[j] = list[i]; list[i] = pos; },
    renderLiveScorer() { ctx.redrawn = true; }
  });
  vm.runInContext(`var localSaveWarnedAt = 0;\n${storeLocalSource()}\n`
    + extract(source, 'function changeLiveLineupPosition(', '\n}\n'), ctx);
  ctx.activeGame = {lineup: ['a', 'b'], lineupPositions: ['P', 'C'], pitcherName: 'a', innings: []};
  vm.runInContext('var activeGame = this.activeGame;', ctx);
  ctx.changeLiveLineupPosition(1, 'P');
  assert.equal(ctx.redrawn, true);
  assert.match(ctx.toasts.join(), /本機暫存失敗/);
});

test('V-09: the listed flows save through storeLocal, not a bare localStorage.setItem', () => {
  const flows = [
    extract(html, '    async function commitTagsToGitHub(', '\n    }\n'),
    extract(html, '    window.addPlayerTag = ', '\n    };\n'),
    extract(html, '    window.removePlayerTag = ', '\n    };\n'),
    extract(html, '    window.toggleChienFilter = ', '\n    };\n'),
    extract(html, '    window.startNewGameFromSetup = ', '\n    };\n'),
    extract(html, '    window.changeDefensePitcher = ', '\n    };\n'),
    extract(read('scorebook-lineup.js'), 'function changeLiveLineupPosition(', '\n}\n')
  ];
  for (const flow of flows) {
    assert.doesNotMatch(flow, /localStorage\.setItem/, flow.split('\n')[0]);
    assert.match(flow, /storeLocal\(/, flow.split('\n')[0]);
  }
});
