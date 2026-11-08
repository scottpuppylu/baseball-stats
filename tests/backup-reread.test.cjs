// When the GitHub API does not answer within 3.5 s, the page shows a backup copy (the raw file, the site's own data/
// or the device cache) and the badge says 備援. Editing that older copy risks overwriting newer cloud items, so the page
// reads the cloud once more in the background with a longer limit and replaces the backup when it answers (V-04).
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
function extract(marker, endMarker) {
  const start = source.indexOf(marker);
  if (start === -1) return '';
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, marker);
  return source.slice(start, end + endMarker.length);
}
const CODE = [
  extract('// ★ 備援後重讀雲端', '// ★ 備援後重讀雲端（結束）'),
  extract('async function loadLogsFromGitHub() {', '\n    }\n')
].join('\n');
assert.ok(CODE.includes('async function loadLogsFromGitHub'));

// plan[n] lists the sources of the seven files on the n-th load (the last entry repeats).
function page(plan, {online = true} = {}) {
  const badges = [], timeouts = [], queued = [];
  let loads = 0;
  const ctx = {
    window: {}, navigator: {onLine: online}, DATA_FILE_PATH: 'data/logs.json', allLogs: [], baseline2025Logs: [], attendanceEdited: false,
    attendanceInitialized: true, selectedPlayerName: 'x', currentFileSha: null,
    setStatusBadge(message) { if (message.includes('連線同步中')) loads++; badges.push(message); },
    syncJerseyMaps() {}, syncAllGamesToTeamLogs() {}, updateDhRuleButtons() {}, renderAll() {}, showToast() {},
    mergeLegacyMainWrites: async () => false,
    setTimeout: fn => { queued.push(fn); return queued.length; },
    record: ms => timeouts.push(ms), answer: i => plan[Math.min(loads, plan.length) - 1][i]
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  // The loaders run inside the page, so they see the read limit the page uses at that moment.
  vm.runInContext(`
    const limit = () => typeof cloudReadTimeoutMs === 'undefined' ? 3500 : cloudReadTimeoutMs;
    const loader = i => async () => { record(limit()); return answer(i); };
    var loadAvatarsFromGitHub = loader(0), loadTagsFromGitHub = loader(1), loadDefenseFromGitHub = loader(2),
      loadGamesFromGitHub = loader(3), loadGuestsFromGitHub = loader(4);
    var loadDatabaseSource = async () => { record(limit()); return answer(5); };
    var PlayerHealthStore = {load: async () => answer(6)};`, ctx);
  const settle = async () => { while (queued.length) await queued.shift()(); };
  return {ctx, badges, timeouts, settle, loads: () => loads};
}
const CLOUD = ['cloud', 'cloud', 'cloud', 'cloud', 'missing', 'cloud', 'cloud'];
const BACKUP = ['cloud', 'cloud', 'cloud', 'static', 'missing', 'cache', 'cloud'];

test('V-04: after a backup copy was shown, the cloud is read again in the background with a longer limit', async () => {
  const p = page([BACKUP, CLOUD]);
  await p.ctx.loadLogsFromGitHub();
  assert.match(p.badges.at(-1), /備援/, 'the badge says a backup copy is shown');
  await p.settle();
  assert.equal(p.loads(), 2, 'one background re-read');
  assert.ok(p.timeouts.slice(6).every(ms => ms >= 10000), `the re-read waits longer (${p.timeouts.slice(6)})`);
  assert.match(p.badges.at(-1), /連線正常/, 'the cloud copy replaces the backup and the badge says so');
  // Later loads use the normal limit again.
  await p.ctx.loadLogsFromGitHub();
  assert.equal(p.timeouts.at(-1), 3500);
});

test('V-04: the background re-read happens once, and not when everything came from the cloud or the device is offline', async () => {
  const stillBackup = page([BACKUP]);
  await stillBackup.ctx.loadLogsFromGitHub();
  await stillBackup.settle();
  assert.equal(stillBackup.loads(), 2, 'one re-read, no endless retries');
  assert.match(stillBackup.badges.at(-1), /備援/, 'still a backup: the badge keeps saying so');

  const fine = page([CLOUD]);
  await fine.ctx.loadLogsFromGitHub();
  await fine.settle();
  assert.equal(fine.loads(), 1);

  const offline = page([BACKUP], {online: false});
  await offline.ctx.loadLogsFromGitHub();
  await offline.settle();
  assert.equal(offline.loads(), 1);
});
