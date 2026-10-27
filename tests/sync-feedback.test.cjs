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
    window: {}, PlayerHealth: require('../player-health.js'), PlayerHealthStore: {data:()=>({test_player:{bats:'R'},'正式隊員':{bats:'R'}})}, messages, statuses, removed, activeGame: game, allGames: [game], allLogs: [],
    selectedReviewGameId: game.id, isEditingReviewGame: true, pendingLogins: new Set(),
    document: { getElementById: () => null, querySelectorAll: () => [] },
    localStorage: { setItem() {}, removeItem: key => removed.push(key) },
    showToast: (message, type) => messages.push({ message, type }),
    setStatusBadge: (message, type) => statuses.push({ message, type }),
    confirm: () => true, renderAll() {}, renderLiveScorer() {}, renderGameReview() {},
    renderSelectedGameReview() {}, switchScorebookSubTab() {}, syncAllGamesToTeamLogs() {},
    commitGamesToGitHub: async () => true, rememberCloudBase() {}, DATA_BRANCH: 'data',
    ...extra,
  };
  // The page's localCache passes through to localStorage when local-cache.js is absent; mirror that here.
  ctx.localCache ||= {
    get: key => ctx.localStorage.getItem(key), set: (key, value) => ctx.localStorage.setItem(key, value),
    remove: key => ctx.localStorage.removeItem(key), ready: Promise.resolve({changed: false})
  };
  vm.createContext(ctx);
  vm.runInContext(extract('function showSyncResult(', '\n    }'), ctx);
  // Text safety helpers used by loaders and form handlers.
  for (const name of ['hasUnsafeText', 'rejectUnsafeText', 'sanitizeLoadedData']) vm.runInContext(extract(`function ${name}(`, '\n    }'), ctx);
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
      // The upload first reads the current cloud version (an empty roster), then writes.
      fetch: async (url, options = {}) => {
        if (status === 'network') throw new Error('offline');
        const body = options.method === 'PUT'
          ? { content: { sha: 'test' }, message: 'test error' }
          : { sha: 'test', encoding: 'base64', content: Buffer.from('[]').toString('base64'), message: 'test error' };
        return { ok: status === 200, status, json: async () => body };
      },
    });
    Object.assign(ctx, {AbortController, setTimeout, clearTimeout, atob, TextDecoder});
    vm.runInContext(extract('async function fetchWithTimeout(', '\n    }'), ctx);
    vm.runInContext(extract('const WRITE_TIMEOUT_MS', ';'), ctx);
    vm.runInContext(extract('async function fetchWrite(', '\n    }'), ctx);
    vm.runInContext(extract('function base64ToUtf8(', '\n    }'), ctx);
    vm.runInContext(extract('async function fetchGitHubContent(', '\n    }'), ctx);
    vm.runInContext(extract('// ★ 多裝置同時寫入保護：', '// ★ 多裝置同時寫入保護（結束）'), ctx);
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
        if (name === 'saveEditedReviewGame') {
          vm.runInContext('let reviewEditSnapshot = null; const FIELD_LOCATIONS = [];', ctx);
          vm.runInContext(extract('function applyReviewFormToGame(', '\n    }'), ctx);
          ctx.isInningOurBat = () => true;
        }
        install(ctx, name);
        await ctx.window[name](name === 'deleteSingleLog' ? 'log_game_test_game_1' : 'test_game');
        assert.equal(ctx.messages.at(-1).type === 'error', !success);
        if (!success) assert.equal(ctx.statuses.at(-1).type, 'error');
        if (name === 'finishActiveGameAndSyncLogs') {
          assert.equal(ctx.activeGame === null, success);
          assert.equal(ctx.removed.includes('rebas_active_game'), success);
          if (!success) assert.equal(ctx.activeGame.status, 'in_progress', 'failed finish remains resumable');
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
      NAME_TO_JERSEY: { test_player: 1 }, isSimulatedGame: () => false, commitLogsToGitHub: async () => success,
    });
    vm.runInContext(extract('function isRunnerOutPlay(', '\n    }'), ctx);
    vm.runInContext(extract('function buildGameLogs(', '\n    }'), ctx);
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

test('cloud writes time out with a readable error instead of hanging', async () => {
  const ctx = context({AbortController, setTimeout, clearTimeout,
    fetch: (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'}))))});
  vm.runInContext(extract('async function fetchWithTimeout(', '\n    }'), ctx);
  vm.runInContext('const WRITE_TIMEOUT_MS = 30;', ctx);
  vm.runInContext(extract('async function fetchWrite(', '\n    }'), ctx);
  await assert.rejects(ctx.fetchWrite('https://example.test'), /網路逾時/);
});

test('corrupted browser storage falls back instead of throwing', () => {
  const ctx = context({localStorage: {getItem: key => (key === 'bad' ? '{not json' : key === 'none' ? null : '{"a":1}')}});
  vm.runInContext(extract('function readStoredJson(', '\n    }'), ctx);
  // Objects from the vm realm have a different prototype, so compare their JSON.
  assert.equal(JSON.stringify(ctx.readStoredJson('bad', {fallback: true})), '{"fallback":true}');
  assert.equal(ctx.readStoredJson('none', 'x'), 'x');
  assert.equal(JSON.stringify(ctx.readStoredJson('ok', null)), '{"a":1}');
});

test('names with quotes survive inside inline handlers', () => {
  const ctx = context({});
  vm.runInContext(extract('function jsArg(', '\n    }'), ctx);
  const attr = `toggle(${ctx.jsArg(`O'Neil "Jr" <b>`)})`;
  assert.doesNotMatch(attr, /"|</, 'no raw double quote or tag can break out of the attribute');
  // The browser decodes &quot; before running the handler, which must then be a valid call.
  const decoded = attr.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  let received;
  new vm.Script(decoded).runInNewContext({toggle: v => { received = v; }});
  assert.equal(received, `O'Neil "Jr" <b>`);
});

test('files over 1 MB are read through the raw media type instead of failing', async () => {
  const calls = [];
  const ctx = context({AbortController, setTimeout, clearTimeout, GITHUB_REPO: 'test', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'mock',
    base64ToUtf8: value => Buffer.from(value, 'base64').toString('utf8'),
    fetch: async (url, options) => {
      const accept = options.headers.Accept;
      calls.push(accept);
      if (/raw/.test(accept)) return {ok: true, status: 200, text: async () => '[{"id":"big"}]'};
      return {ok: true, status: 200, json: async () => (url.includes('small')
        ? {sha: 's1', encoding: 'base64', content: Buffer.from('[{"id":"small"}]').toString('base64')}
        : {sha: 's2', encoding: 'none', content: ''})};
    }});
  vm.runInContext(extract('async function fetchWithTimeout(', '\n    }'), ctx);
  vm.runInContext(extract('async function fetchGitHubContent(', '\n    }'), ctx);
  const small = await ctx.fetchGitHubContent('data/small.json');
  assert.equal(JSON.stringify(small), '{"content":[{"id":"small"}],"sha":"s1"}');
  assert.equal(calls.length, 1, 'small files need one request');
  const big = await ctx.fetchGitHubContent('data/big.json');
  assert.equal(JSON.stringify(big), '{"content":[{"id":"big"}],"sha":"s2"}', 'large file content comes from the raw response, sha from the metadata');
  assert.match(calls.at(-1), /application\/vnd\.github\.raw/);
});

test('review editing keeps unsaved changes on a copy that cancel restores', () => {
  assert.match(source, /reviewEditSnapshot = game \? \{ id: game\.id, json: JSON\.stringify\(game\) \}/);
  for (const name of ['addPlayToReviewInning', 'deletePlayFromReviewInning', 'addDefenseEventToReviewInning', 'deleteDefenseEventFromReviewInning']) {
    const body = extract(`window.${name} = function(`, '\n    };');
    assert.match(body, /if \(isEditingReviewGame\) applyReviewFormToGame\(game\);/, `${name} keeps typed values`);
  }
});

test('single-game login and full rebuild produce identical complete logs', async () => {
  const name='正式隊員';
  const plays=[['K','none'],['界外K','none'],['K_FOUL','none'],['1H','line',0.2],['2H','grounder',0.5],['3H','fly',0.8],['HR','fly',0.5],['GO','grounder',0.2],['FO','popup',0.8],['BB','none'],['SF','fly',0.5]]
    .map(([result,trajectory,x])=>({batterName:name,result,trajectory,x}));
  const game={id:'complete',date:'2026-10-11',opponent:'對手',tag:'聯賽',lineup:[name,'外援'],innings:[{plateAppearances:[...plays,{batterName:'外援',result:'HR',trajectory:'fly',x:0.5}]}]};
  const ctx=context({allGames:[game],allLogs:[{id:'manual',name,pa:1}],syncJerseyMaps(){},getGameAllBatters:g=>g.lineup,isGuestPlayerName:n=>n==='外援',isSimulatedGame:()=>false,NAME_TO_JERSEY:{[name]:42},commitLogsToGitHub:async()=>true});
  for(const marker of ['function isRunnerOutPlay(', 'function buildGameLogs(', 'function syncAllGamesToTeamLogs(', 'async function syncGameToTeamLogs(']) vm.runInContext(extract(marker,'\n    }'),ctx);
  ctx.syncAllGamesToTeamLogs();
  const rebuilt=JSON.parse(JSON.stringify(ctx.allLogs.filter(l=>l.gameId===game.id)));
  const expected={id:'log_game_complete_42',gameId:'complete',date:'2026-10-11',tag:'場記賽事: 聯賽 vs 對手',name,jersey:42,pa:11,ab:9,h:4,h1:1,h2:1,h3:1,hr:1,bb:1,sf:1,k:3,k_swing:1,k_foul:2,bip:7,ld:1,gb:2,fb:3,pu:1,pull:2,cent:3,oppo:2};
  assert.deepEqual(rebuilt,[expected],'independently counted strikeouts, types, directions and official roster');
  ctx.allLogs=ctx.window.allLogs=ctx.allLogs.filter(l=>!l.gameId);
  const result=await ctx.syncGameToTeamLogs(game);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.allLogs.filter(l=>l.gameId===game.id))),rebuilt);
  assert.equal(result.count,1);assert.equal(result.success,true);
  assert.ok(ctx.allLogs.some(l=>l.id==='manual'),'manual records kept');
  game.excludedFromLogs=true;ctx.syncAllGamesToTeamLogs();
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.allLogs)),[{id:'manual',name,pa:1}]);
  assert.equal(ctx.buildGameLogs(null).length,0);
});

for(const gamesSynced of [false,true]) for(const logsSynced of [false,true]) {
  test(`log exclusion persists and reports both uploads: games=${gamesSynced}, logs=${logsSynced}`,async()=>{
    const saved={};const uploads=[];
    const ctx=context({allLogs:[{id:'log_game_test_game_1'},{id:'manual'}],
      localStorage:{setItem:(key,value)=>{saved[key]=JSON.parse(value);}},
      commitGamesToGitHub:async()=>{uploads.push('games');return gamesSynced;},
      commitLogsToGitHub:async()=>{uploads.push('logs');return logsSynced;}});
    install(ctx,'undoGameFromTeamLogs');await ctx.window.undoGameFromTeamLogs('test_game');
    // Audit #1: a failed games upload rolls back the flag and never touches the logs.
    assert.equal(!!ctx.allGames[0].excludedFromLogs,gamesSynced);
    assert.equal(!!saved.rebas_all_games[0].excludedFromLogs,gamesSynced);
    assert.equal(ctx.allLogs.some(l=>l.id.startsWith('log_game_')),!gamesSynced);
    assert.deepEqual(uploads,gamesSynced?['games','logs']:['games']);
    assert.equal(ctx.messages.at(-1).type==='error',!(gamesSynced&&logsSynced));
    ctx.syncGameToTeamLogs=async()=>({count:3,success:logsSynced});
    install(ctx,'syncReviewGameToTeamLogs');await ctx.window.syncReviewGameToTeamLogs();
    assert.equal('excludedFromLogs' in ctx.allGames[0],false);
    assert.equal(ctx.pendingLogins.has('test_game'),gamesSynced&&!logsSynced,'only a successful games upload can leave a partial login');
    assert.equal(ctx.messages.at(-1).type==='error',!(gamesSynced&&logsSynced));
  });
}

for(const [name,c,key,content]of [
  ['Games','GAMES','rebas_all_games',[{id:'real_game'}]],['Guests','GUESTS','rebas_guest_players',[{name:'外援'}]],
  ['Avatars','AVATARS','rebas_player_avatars',{球員:'photo'}],['Tags','TAGS','rebas_player_tags',{球員:['標籤']}],
  ['Defense','DEFENSE','rebas_defense_rankings',{P:['球員']}]
]) for(const sourceName of ['cloud','static','cache','failed']) {
  test(`${name} loader identifies ${sourceName} source`,async()=>{
    const ctx=context({[c+'_FILE_PATH']:'data/'+name.toLowerCase()+'.json',
      fetchGitHubContent:async()=>{if(sourceName!=='cloud')throw Error('cloud offline');return{content,sha:'cloud-sha'};},
      fetchLocalContent:async()=>{if(sourceName!=='static')throw Error('static offline');return content;},
      localStorage:{setItem(){},getItem:k=>sourceName==='cache'&&k===key?JSON.stringify(content):null},
      isSimulatedGame:()=>false,guestPlayers:[],playerAvatars:{},playerTags:{},defenseRankings:{},DEFAULT_DEFENSE_RANKINGS:{}});
    vm.runInContext(extract('function readStoredJson(','\n    }'),ctx);
    vm.runInContext(extract('async function loadDatabaseSource(','\n    }'),ctx);
    vm.runInContext(extract(`async function load${name}FromGitHub(`,'\n    }'),ctx);
    assert.equal(await ctx[`load${name}FromGitHub`](),sourceName);
  });
}

// Multi-device safety: an upload never overwrites what another device saved after this page loaded.
function mergeContext(extra = {}) {
  const ctx = context({utf8ToBase64: value => Buffer.from(value).toString('base64'), GITHUB_REPO: 'test', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'mock', ...extra});
  Object.assign(ctx, {AbortController, setTimeout, clearTimeout, atob, TextDecoder, JSON});
  vm.runInContext(extract('async function fetchWithTimeout(', '\n    }'), ctx);
  vm.runInContext(extract('const WRITE_TIMEOUT_MS', ';'), ctx);
  vm.runInContext(extract('async function fetchWrite(', '\n    }'), ctx);
  vm.runInContext(extract('function base64ToUtf8(', '\n    }'), ctx);
  vm.runInContext(extract('async function fetchGitHubContent(', '\n    }'), ctx);
  vm.runInContext(extract('// ★ 多裝置同時寫入保護：', '// ★ 多裝置同時寫入保護（結束）'), ctx);
  return ctx;
}
const byId = item => item.id;
const ids = list => list.map(x => x.id).sort().join(',');

test('merge keeps the other device\'s additions and applies this device\'s additions, edits and deletions', () => {
  const ctx = mergeContext();
  const base = [{id: 'a', v: 1}, {id: 'b', v: 1}, {id: 'c', v: 1}];
  const local = [{id: 'a', v: 2}, {id: 'c', v: 1}, {id: 'mine', v: 1}];   // edited a, deleted b, added mine
  const remote = [{id: 'a', v: 1}, {id: 'b', v: 1}, {id: 'c', v: 9}, {id: 'theirs', v: 1}]; // edited c, added theirs
  const {data, conflicts} = ctx.mergeCloudChanges(base, local, remote, byId);
  assert.equal(ids(data), 'a,c,mine,theirs');
  assert.equal(data.find(x => x.id === 'a').v, 2, 'this device\'s edit');
  assert.equal(data.find(x => x.id === 'c').v, 9, 'the other device\'s edit of an item unchanged here');
  assert.equal(conflicts, 0);
});
test('merge respects deletions made on the other device and counts true conflicts', () => {
  const ctx = mergeContext();
  const base = [{id: 'x', v: 1}, {id: 'y', v: 1}];
  const local = [{id: 'x', v: 1}, {id: 'y', v: 2}];
  const remote = [{id: 'y', v: 3}];                                       // they deleted x, both edited y
  const {data, conflicts} = ctx.mergeCloudChanges(base, local, remote, byId);
  assert.equal(ids(data), 'y');
  assert.equal(data[0].v, 2, 'both edited: this device wins');
  assert.equal(conflicts, 1);
});
test('objects (avatars, tags, defense rankings) merge key by key', () => {
  const ctx = mergeContext();
  const {data} = ctx.mergeCloudChanges({A: ['x'], B: ['y']}, {A: ['x', 'new'], B: ['y']}, {A: ['x'], B: ['y'], C: ['theirs']}, null);
  assert.deepEqual(JSON.parse(JSON.stringify(data)), {A: ['x', 'new'], B: ['y'], C: ['theirs']});
  const removed = ctx.mergeCloudChanges({A: 1, B: 1}, {B: 1}, {A: 1, B: 1, C: 1}, null).data;
  assert.deepEqual(Object.keys(removed).sort(), ['B', 'C'], 'deleted here stays deleted, added there stays');
});
test('without a known base, merge only adds and overwrites (nothing counts as deleted here)', () => {
  const ctx = mergeContext();
  const {data} = ctx.mergeCloudChanges(null, [{id: 'a', v: 2}], [{id: 'a', v: 1}, {id: 'b', v: 1}], byId);
  assert.equal(ids(data), 'a,b');
  assert.equal(data.find(x => x.id === 'a').v, 2);
});

function fakeCloud(initial, {conflictsBeforeWrite = 0} = {}) {
  const cloud = {data: initial, sha: 's0', puts: [], conflicts: conflictsBeforeWrite};
  cloud.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if (cloud.conflicts > 0) { // another device writes between our read and our write
        cloud.conflicts--; cloud.data = [...cloud.data, {id: `race${cloud.conflicts}`}]; cloud.sha += 'x';
        return {ok: false, status: 409, json: async () => ({message: 'conflict'})};
      }
      if (body.sha !== cloud.sha) return {ok: false, status: 409, json: async () => ({message: 'conflict'})};
      cloud.data = JSON.parse(Buffer.from(body.content, 'base64').toString());
      cloud.sha = `s${cloud.puts.length + 1}`;
      cloud.puts.push(cloud.data);
      return {ok: true, status: 200, json: async () => ({content: {sha: cloud.sha}})};
    }
    return {ok: true, status: 200, json: async () => ({sha: cloud.sha, encoding: 'base64', content: Buffer.from(JSON.stringify(cloud.data)).toString('base64')})};
  };
  return cloud;
}
test('an upload with no change in the cloud sends exactly this device\'s data and shows no merge notice', async () => {
  const cloud = fakeCloud([{id: 'a'}]);
  const ctx = mergeContext({fetch: cloud.fetch});
  ctx.rememberCloudBase('data/logs.json', 's0', [{id: 'a'}]);
  const local = [{id: 'a'}, {id: 'mine'}];
  const result = await ctx.commitJsonFile('data/logs.json', local, 'test', byId);
  assert.equal(result.merged, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), local, 'same record content, captured independently');
  assert.notEqual(result.data, local, 'the upload owns a snapshot, not a mutable caller array');
  assert.equal(ids(cloud.data), 'a,mine');
  assert.equal(ctx.messages.length, 0);
});
test('an upload snapshots the caller before any asynchronous cloud reads', async () => {
  const cloud = fakeCloud([{id:'a',score:0}]);
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const ctx = mergeContext({fetch:async (...args)=>{await gate;return cloud.fetch(...args);}});
  ctx.rememberCloudBase('data/logs.json','s0',[{id:'a',score:0}]);
  const local=[{id:'a',score:1}];
  const pending=ctx.commitJsonFile('data/logs.json',local,'snapshot',byId);
  local[0].score=2;release();await pending;
  assert.equal(cloud.data[0].score,1,'an in-flight request cannot silently pick up later edits');
});
test('an upload after another device saved merges instead of overwriting', async () => {
  const cloud = fakeCloud([{id: 'a'}, {id: 'theirs'}]);
  cloud.sha = 's-other';
  const ctx = mergeContext({fetch: cloud.fetch});
  ctx.rememberCloudBase('data/logs.json', 's0', [{id: 'a'}]);
  const result = await ctx.commitJsonFile('data/logs.json', [{id: 'a'}, {id: 'mine'}], 'test', byId);
  assert.equal(result.merged, true);
  assert.equal(ids(cloud.data), 'a,mine,theirs');
  assert.ok(ctx.messages.at(-1).message.includes('合併'));
  // The next upload starts from what was written, so it does not merge again.
  const again = await ctx.commitJsonFile('data/logs.json', [...result.data, {id: 'later'}], 'test', byId);
  assert.equal(again.merged, false);
  assert.equal(ids(cloud.data), 'a,later,mine,theirs');
});
test('a write that loses a race (409) reads again, merges and retries', async () => {
  const cloud = fakeCloud([{id: 'a'}], {conflictsBeforeWrite: 1});
  const ctx = mergeContext({fetch: cloud.fetch});
  ctx.rememberCloudBase('data/logs.json', 's0', [{id: 'a'}]);
  const result = await ctx.commitJsonFile('data/logs.json', [{id: 'a'}, {id: 'mine'}], 'test', byId);
  assert.equal(ids(cloud.data), 'a,mine,race0');
  assert.equal(result.merged, true);
});
test('a missing file is created without a sha', async () => {
  let putBody = null;
  const ctx = mergeContext({fetch: async (url, options = {}) => {
    if (options.method === 'PUT') { putBody = JSON.parse(options.body); return {ok: true, status: 201, json: async () => ({content: {sha: 'new'}})}; }
    return {ok: false, status: 404, json: async () => ({})};
  }});
  const result = await ctx.commitJsonFile('data/guests.json', [{name: '外援'}], 'test', g => g.name);
  assert.equal('sha' in putBody, false);
  assert.equal(result.sha, 'new');
});
