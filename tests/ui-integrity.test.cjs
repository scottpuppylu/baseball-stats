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
// v10: authorized durable local persistence and failure feedback; existing controls and formulas retained.
// v11: authorized persistent pending-sync intents and retry UI; original controls and scoring formulas retained.
// v11a: authorized draft loading, acknowledgements, durable retry and manual record identity.
// v11b: pending snapshots precede stale fallback copies; record contents and scoring remain unchanged.
// v12: authorized finalization lock and snapshot comparison; all existing scoring formulas and controls retained.
// v12a: reject stale cloud responses and retain the operation baseline across local persistence awaits.
// v13: authorized explicit review landing-point input; existing recorded coordinates and scoring formulas retained.
// v14: authorized visible-page rendering, cached charts, and lazy presentation; all data writers and scoring formulas retained.
// A: visible-page rendering with stable chart instances; IDs and existing handlers retained
// A: primary analytics tables render with the page, independently of deferred charts
// A: current-page primary tables, original hooks and deferred charts
const BASELINE = {
  "script": "c1b2caa81427cdbc79db3c347f8286f8475e0e1857b9d687c80c6ab82709117b",
  "handlers": "06f31722ae03f6405ff1766863227b0da05590e698ae93309d09a4c27692b7f0",
  "idCount": 287,
  "ids": "e1b62e847fd8004849d2c7337c37dad708f6922e32e6108cd2110d0b0ed9b4a8"
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
