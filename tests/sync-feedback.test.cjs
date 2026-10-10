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
    selectedReviewGameId: game.id, isEditingReviewGame: true, pendingLogins: new Set(),
    document: { getElementById: () => null },
    localStorage: { setItem() {}, removeItem: key => removed.push(key) },
    showToast: (message, type) => messages.push({ message, type }),
    setStatusBadge: (message, type) => statuses.push({ message, type }),
    confirm: () => true, renderAll() {}, renderLiveScorer() {}, renderGameReview() {},
    renderSelectedGameReview() {}, switchScorebookSubTab() {}, syncAllGamesToTeamLogs() {},
    commitGamesToGitHub: async () => true,
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
    Object.assign(ctx, {AbortController, setTimeout, clearTimeout});
    vm.runInContext(extract('async function fetchWithTimeout(', '\n    }'), ctx);
    vm.runInContext(extract('const WRITE_TIMEOUT_MS', ';'), ctx);
    vm.runInContext(extract('async function fetchWrite(', '\n    }'), ctx);
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
    assert.equal(ctx.allGames[0].excludedFromLogs,true);
    assert.equal(saved.rebas_all_games[0].excludedFromLogs,true);
    assert.equal(ctx.allLogs.some(l=>l.id.startsWith('log_game_')),false);
    assert.deepEqual(uploads,['games','logs']);
    assert.equal(ctx.messages.at(-1).type==='error',!(gamesSynced&&logsSynced));
    ctx.syncGameToTeamLogs=async()=>({count:3,success:logsSynced});
    install(ctx,'syncReviewGameToTeamLogs');await ctx.window.syncReviewGameToTeamLogs();
    assert.equal('excludedFromLogs' in ctx.allGames[0],false);
    assert.equal(ctx.pendingLogins.has('test_game'),!(gamesSynced&&logsSynced),'partial login keeps retry state');
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
