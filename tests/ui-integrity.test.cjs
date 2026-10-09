const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

// Digests from 903cf977 before the UI edit: protect the entire business script
// and every existing inline event handler, rather than sample calculations.
test('business script outside the authorized spray archive, Taiwan date, live data binding and attendance changes remains byte-identical to the approved baseline', () => {
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]
    .replace('    // Archived estimated coordinates remain stored; fielding locations and stats stay intact.\n    function isSprayChartArchived(game) {\n      return game?.sprayChartArchive?.excluded === true;\n    }\n\n', '')
    .replace(/^ +if \(isSprayChartArchived\((?:g|game)\)\) return;\n/gm, '')
    .replace('!isSprayChartArchived(game) && pa.x', 'pa.x')
    .replace("${isSprayChartArchived(game) ? '推估座標已封存，不納入噴流圖；守位與成績保留' : `共 ${sprayPointsHtml.length} 顆擊球`}", '共 ${sprayPointsHtml.length} 顆擊球')
    .replace("    // Default dates follow Taiwan time; toISOString() is UTC and lags a day before 08:00.\n    function getTaipeiDateString() {\n      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());\n    }\n\n", '')
    .replace('_${getTaipeiDateString()}.csv', '_${new Date().toISOString().slice(0,10)}.csv')
    .replaceAll('getTaipeiDateString()', 'new Date().toISOString().slice(0, 10)')
    .replace("    // Several paths reassign only the local binding; keep window.allGames / window.allLogs live so stats never read a stale copy.\n    Object.defineProperty(window, 'allGames', { get: () => allGames, set: value => { allGames = value; }, configurable: true });\n    Object.defineProperty(window, 'allLogs', { get: () => allLogs, set: value => { allLogs = value; }, configurable: true });\n", '')
    // Attendance: PA threshold 15 -> 14, re-pick defaults after the cloud load unless the coach edited them.
    .replace("    // Default attendance and lineup priority threshold; set once the coach changes attendance by hand.\n    const MIN_ATTENDANCE_PA = 14;\n    let attendanceEdited = false;\n", '')
    .replace(/^ {6}attendanceEdited = true;\n/gm, '')
    .replace("      // The first render picked default attendance from cached data; redo it with cloud data unless edited.\n      if (!attendanceEdited) attendanceInitialized = false;\n", '')
    .replace("      initAttendance(Object.values(JERSEY_TO_NAME), historicalPaMap);\n      renderAttendanceGrid(historicalPaMap);", '      renderAttendanceGrid(historicalPaMap);')
    .replaceAll('MIN_ATTENDANCE_PA', '15')
    .replaceAll('(歷史PA ≥ 14)', '(歷史PA ≥ 15)');
  assert.equal(hash(script), '6fb7e6ffe46cd4c480889a2a0d88025f0f32810dd4226a31b5b5ad157f5832a8');
});
test('all original inline action handlers remain identical and in order', () => {
  const handlers = [...html.matchAll(/\bon(?:click|change|submit|input|mouseover|mouseout|mouseenter|mouseleave)\s*=\s*"([^"]*)"/g)].map(x => x[0]).join('\n');
  assert.equal(hash(handlers), '6fcf56a7dd0885fc827fa02aca175a1d16d1af0503b8a5616a50a4e59fdefb23');
});
test('all nine page panels and their original controls remain present', () => {
  for (const name of ['Overview','Profile','Leaderboard','Analytics','Compare','Lineup','Scorebook','Pitching','Glossary']) {
    assert.ok(html.includes(`id="panel${name}"`));
    assert.ok(html.includes(`id="btnTab${name}"`));
  }
  for (const id of ['filterStartDate','filterEndDate','addLogForm','setupLineupGrid','interactiveFieldSvg','trajectoryButtonGroup','rbiButtonGroup','runsScoredButtonGroup','defenseModal','guestModal','substituteModal','pitcherChangeModal','cropModal','gameReviewDetailContainer']) assert.ok(html.includes(`id="${id}"`), id);
});
test('all 282 original static and template DOM identifiers remain intact', () => {
  const added = new Set(['appHeader','mainNavigation','appWorkspace']);
  const ids = [...html.matchAll(/\bid="([^"]*)"/g)].map(match=>match[1]).filter(id=>!added.has(id));
  assert.equal(ids.length,282);
  assert.equal(hash(ids.join('\n')), 'e255c808cc91b83a7b850fe954e4fd5c7073db4286b42db1699d70c4b1da237d');
});
test('insight script parses, only reads data, and never writes or calls the network', () => {
  const script = fs.readFileSync(path.join(root, 'team-insights.js'), 'utf8');
  new vm.Script(script);
  assert.doesNotMatch(script, /\b(?:fetch|localStorage|XMLHttpRequest|GITHUB_TOKEN|commit\w*ToGitHub)\b/);
  assert.doesNotMatch(script, /\b(?:allLogs|allGames|activeGame)\s*=(?!=)/);
});
test('lineup model is pure and the recommender never writes game data or calls the network', () => {
  const model = fs.readFileSync(path.join(root, 'lineup-model.js'), 'utf8');
  new vm.Script(model);
  assert.doesNotMatch(model, /\b(?:document|window\.(?!LineupModel)|fetch|localStorage|XMLHttpRequest|allLogs|allGames)\b/);
  const recommender = fs.readFileSync(path.join(root, 'lineup-recommender.js'), 'utf8');
  new vm.Script(recommender);
  assert.doesNotMatch(recommender, /\b(?:fetch|XMLHttpRequest|GITHUB_TOKEN|commit\w*ToGitHub)\b/);
  assert.doesNotMatch(recommender, /\b(?:allLogs|allGames|activeGame|customLineup|presentPlayersSet)\s*=(?!=)/);
  // Its only storage is its own preferences: simulation settings and slot locks.
  assert.deepEqual([...recommender.matchAll(/localStorage\.(\w+)\(([^,)]+)/g)].map(m => m[2]).filter(k => !['SETTINGS_KEY', 'LOCKS_KEY'].includes(k)), []);
});
test('presentation script parses and does not directly access persistent data or network', () => {
  const script = fs.readFileSync(path.join(root, 'ui-comfort.js'), 'utf8');
  new vm.Script(script);
  assert.doesNotMatch(script, /\b(?:fetch|localStorage|allLogs|allGames|activeGame|GITHUB_TOKEN)\b/);
});
