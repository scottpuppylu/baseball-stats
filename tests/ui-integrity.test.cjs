const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

// Baseline v2 (2026/10/10): the business script, inline handlers and DOM identifiers after the authorized
// 1-15 fix set (see docs/UI_QA.md). The v1 baseline from 903cf977 and its authorized-diff chain are in git history.
// Any further change to these must be authorized and the digests updated together with the QA document.
const BASELINE = {
  script: '8ad648ad6800039126c0dc30de1f97cbfa7045df444446f050cb26d09617308b',
  handlers: 'fd15b9c7acc8502bc8e68493b2e9beb6aa64972911a9a6e4d4e5be66f4875291',
  idCount: 276,
  ids: '4f99927a9810284481320e0caa44f463b5701ea968699aafef142e49064dab18'
};
test('business script is byte-identical to the approved baseline', () => {
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  assert.equal(hash(script), BASELINE.script);
});
test('all inline action handlers remain identical and in order', () => {
  const handlers = [...html.matchAll(/\bon(?:click|change|submit|input|mouseover|mouseout|mouseenter|mouseleave)\s*=\s*"([^"]*)"/g)].map(x => x[0]).join('\n');
  assert.equal(hash(handlers), BASELINE.handlers);
});
test('all nine page panels and their original controls remain present', () => {
  for (const name of ['Overview','Profile','Leaderboard','Analytics','Compare','Lineup','Scorebook','Pitching','Glossary']) {
    assert.ok(html.includes(`id="panel${name}"`));
    assert.ok(html.includes(`id="btnTab${name}"`));
  }
  // rbiButtonGroup was removed on request (2026/10/10): the team does not record RBI.
  for (const id of ['filterStartDate','filterEndDate','addLogForm','setupLineupGrid','interactiveFieldSvg','trajectoryButtonGroup','runsScoredButtonGroup','defenseModal','guestModal','substituteModal','pitcherChangeModal','cropModal','gameReviewDetailContainer']) assert.ok(html.includes(`id="${id}"`), id);
});
test('all static and template DOM identifiers remain intact', () => {
  const added = new Set(['appHeader','mainNavigation','appWorkspace']);
  const ids = [...html.matchAll(/\bid="([^"]*)"/g)].map(match=>match[1]).filter(id=>!added.has(id));
  assert.equal(ids.length, BASELINE.idCount);
  assert.equal(hash(ids.join('\n')), BASELINE.ids);
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
test('player diagnostics only read data and never write, store or call the network', () => {
  const script = fs.readFileSync(path.join(root, 'player-diagnostics.js'), 'utf8');
  new vm.Script(script);
  assert.doesNotMatch(script, /\b(?:fetch|localStorage|XMLHttpRequest|GITHUB_TOKEN|commit\w*ToGitHub)\b/);
  assert.doesNotMatch(script, /\b(?:allLogs|allGames|activeGame|playerAvatars)\s*=(?!=)/);
  assert.ok(html.includes('<script src="player-diagnostics.js?v='), 'loaded by the page');
});
test('career records only read data and never write, store or call the network', () => {
  const script = fs.readFileSync(path.join(root, 'team-records.js'), 'utf8');
  new vm.Script(script);
  assert.doesNotMatch(script, /\b(?:fetch|localStorage|XMLHttpRequest|GITHUB_TOKEN|commit\w*ToGitHub)\b/);
  assert.doesNotMatch(script, /\b(?:allLogs|allGames|activeGame|playerAvatars)\s*=(?!=)/);
  assert.ok(html.includes('<script src="team-records.js?v='), 'loaded by the page');
});
test('presentation script parses and does not directly access persistent data or network', () => {
  const script = fs.readFileSync(path.join(root, 'ui-comfort.js'), 'utf8');
  new vm.Script(script);
  assert.doesNotMatch(script, /\b(?:fetch|localStorage|allLogs|allGames|activeGame|GITHUB_TOKEN)\b/);
});
