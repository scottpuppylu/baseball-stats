const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

// v9.1 (2026/10/20): user-requested removal of the redundant photo button and its one upload handler.
// Avatar markup, sizing, cropper and direct photo upload remain unchanged; ui-avatar verifies the retained path.
// v9 (2026/10/20): authorized health profiles and batting-side direction correction; three additive DOM IDs.
// Original handlers stay identical; pure rules, isolated profile writes, retroactive rebuild, and left/right/switch UI have behavioral tests.
// v8.1 (2026/10/19): collapsible lineup and a read-only defense field. One additive DOM ID;
// business-script and action-handler hashes remain byte-identical to v8.
// Baseline v8 (2026/10/18): authorized vertical setup, live lineup card, position snapshots,
// per-slot substitution and shared pitcher/position changes. Existing handlers remain in order;
// five new DOM IDs are additive. Behavioral coverage: ui-scorebook-lineup and scorebook-lineup.test.
// Baseline v7 (2026/10/16): restore original direct GitHub sync under explicit RISK_ACCEPTED;
// add offline/read-only-shell guards and prevent game-id collisions with random 128-bit IDs. Formulas, data formats, handlers and DOM IDs remain unchanged.
// Historical baseline v6 (2026/10/13, mobile-app branch): security fix only. The exposed GitHub credential is removed; reads try the
// secure API first (same content and sha), uploads go through cloud-sync.js → cloud-api/ (signed per-person session,
// server-held credential), and the main→data legacy merge (which needed a credential and is complete) is disabled.
// v6.1: an offline read says so (err.offline) instead of falling through to a raw network error.
// Merge, conflict retry, statistics and every renderer are unchanged. Diff and reasons: docs/MOBILE_QA.md.
// Baseline v5 (2026/10/11): authorized data-safety fixes: uploads merge with other devices' changes instead of
// overwriting them, no preset batting result and no recording after three outs, no invented pitching numbers or
// hard-coded pitcher, and the review editor resets outs when an event type changes (one new onchange handler).
// The v1-v4 baselines and authorized-diff chain remain in git history; see docs/UI_QA.md.
// 2026/11/01 (requested): the scorebook drops the 內野飛球 type and the located 界外K result buttons (two handlers, two ids).
// 2026/11/01 (requested): changing the pitcher mid-half-inning asks first (on 10/31 the pitcher menu had been switched to
// the fielder for single outs, which rewrote the pitcher and the field positions); the review editor offers to put a wrong
// one-off pitcher name back. Defense records only the pitcher (no fielder: defense has no landing points). Undo recounts every remaining record's outs;
// entering a defensive half with a different pitcher than the last one warns.
// 2026/11/04 (WO-02 V-03, authorized): deleting a game and saving a review edit send logs.json only after games.json
// reached the cloud; otherwise the logs stay a local draft and the message says so. Covered by games-logs-order.test.
const BASELINE = {
  "script": "53d7143f1bb93f8bd92518ccff81bf290affdeb63cfb8ba2fcc83b1d5a60f456",
  "handlers": "7a88628d70dca9e5a6e35724bbde5da54655d7da0ef84887ef94edcc5bc4c0f1",
  "idCount": 285,
  "ids": "5086eeeecad2a720f18bf756eb624de283f54b4c68c9a62ceec162453f52fa87"
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
test('stylesheets use holder classes instead of :has() (a :has() rule slows every style recalculation on phones)', () => {
  const styles = ['ui-theme.css', 'ui-comfort.css'].map(f => fs.readFileSync(path.join(root, f), 'utf8'))
    .concat([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]));
  for (const css of styles) assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /:has\(/);
});
