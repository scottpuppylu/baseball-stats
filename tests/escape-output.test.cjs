// Text from the records reached the page as markup at the listed output points (V-56): a name, a jersey slot, an
// inning number or a score holding "<img src=x onerror=…>" became a real element. Each point now escapes it, and
// unsent drafts from this device are cleaned like the cloud copy before they are shown.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const root = join(__dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const fn = (text, marker) => {
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, marker);
  return text.slice(start, text.indexOf('\n    }\n', start) + 7);
};
const BAD = '<img src=x onerror=alert(1)>';
const noMarkup = (out, where) => assert.ok(!out.includes('<img src=x'), `${where}: ${out.slice(0, 300)}`);

// Loads an IIFE file and hands back the inner functions named in `names` (the file itself is unchanged).
function loadInner(file, names, extra = {}) {
  const source = read(file).replace(/\n\}\)\(\);\s*$/, `\nwindow.__inner = {${names.join(', ')}};\n})();\n`);
  const el = () => ({style: {}, classList: {toggle() {}, add() {}, remove() {}, contains: () => true}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], remove() {}, appendChild() {}, insertAdjacentHTML() {}, setAttribute() {}});
  const window = {siteHooks: {after() {}, before() {}}, addEventListener() {}, matchMedia: () => ({matches: false, addEventListener() {}})};
  const document = {getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el(), body: {appendChild() {}}, readyState: 'complete', fonts: {ready: Promise.resolve()}};
  const ctx = vm.createContext({window, document, console, navigator: {}, AbortController, TextEncoder, setTimeout, clearTimeout, ...extra});
  vm.runInContext(source, ctx);
  return window.__inner;
}

test('V-56: a photo-less avatar and a photo avatar escape the name and the photo value', () => {
  const ctx = vm.createContext({playerAvatars: {'A"B': 'data:image/png;base64,x" onerror="alert(1)'}, avatarSrc: data => data});
  // V-58 later added isImageAvatar, which renderAvatarElement calls.
  const guard = html.includes('    function isImageAvatar(') ? fn(html, '    function isImageAvatar(') : '';
  vm.runInContext(guard + fn(html, '    function escHtml(') + fn(html, '    function renderAvatarElement('), ctx);
  const photo = ctx.renderAvatarElement('A"B');
  assert.ok(!photo.includes('" onerror="'), photo);
  assert.ok(!photo.includes('alt="A"B"'), photo);
  noMarkup(ctx.renderAvatarElement('<img src=x>'), 'initial');
});

test('V-56: unsent drafts are cleaned before they are shown, like the cloud copy', async () => {
  let shown = null;
  const ctx = vm.createContext({
    localCache: {ready: Promise.resolve(), set() {}}, writeEpoch: {}, cloudReadTimeoutMs: 1,
    fetchGitHubContent: async () => ({content: [{name: 'A'}], sha: 's1'}),
    applyPendingChanges: (_path, content) => content.concat([{name: BAD}]),
    rememberCloudBase() {}, readStoredJson: () => null, fetchLocalContent: async () => []
  });
  vm.runInContext(fn(html, '    function sanitizeLoadedData(') + fn(html, '    async function loadDatabaseSource('), ctx);
  await ctx.loadDatabaseSource('players.json', 'k', value => { shown = value; }, () => {});
  assert.equal(shown.length, 2);
  assert.ok(!JSON.stringify(shown).includes('<'), JSON.stringify(shown));
});

function analysisCase() {
  const ga = loadInner('game-analysis.js', ['hero', 'scoreChart', 'timeline', 'batters']);
  const half = {num: BAD, half: 'top', ours: true, runs: 0, hits: BAD, after: {us: 0, opp: 0}, pas: [{slot: 3, batterName: 'A', result: '1H', runsScored: BAD}], defs: [], subs: [{slot: BAD, outPlayer: 'A', inPlayer: 'B'}]};
  const a = {game: {date: '2026-10-04', opponent: 'X'}, scored: true, score: {us: 1, opp: 0}, halves: [half], batting: [], plays: [], hits: 0, ab: 0,
    rows: [{name: 'A', pa: 1, ab: 1, h: 0, h2: 0, h3: 0, hr: 0, bb: 0, k: 0, slot: BAD, isSub: false}]};
  return {ga, a};
}
test('V-56: the game analysis hero escapes the score (:177)', () => {
  const {ga, a} = analysisCase();
  noMarkup(ga.hero({...a, score: {us: BAD, opp: 0}}), 'hero score');
});
test('V-56: the score charts escape inning numbers and hit counts (:199, :208)', () => {
  const {ga, a} = analysisCase();
  noMarkup(ga.scoreChart(a), 'score chart');
  noMarkup(ga.scoreChart({...a, scored: false}), 'hits chart');
});
test('V-56: the half-inning timeline escapes substitution slots and runs scored (:243, :250)', () => {
  const {ga, a} = analysisCase();
  // The head line (:240/:242) is not one of the listed points; it gets plain numbers here.
  noMarkup(ga.timeline({...a, halves: [{...a.halves[0], num: 1, hits: 0}]}), 'timeline');
});
test('V-56: the batter cards escape the batting slot (:278)', () => {
  const {ga, a} = analysisCase();
  noMarkup(ga.batters(a), 'batters');
});

test('V-56: the 3D replay top bar escapes the inning and the game date', () => {
  const s3 = loadInner('spray3d.js', ['hudText', 'situation']);
  const pa = {result: '1H', inningNum: BAD, gameDate: `2026-${BAD}`, opponent: 'X', batterName: 'A', outsAtEnd: 0};
  const out = s3.hudText({plays: [{pa}], mode: 'one', single: false}, {play: {pa, decided: 0}, t: 1, index: 0});
  noMarkup(out, 'hud');
});

test('V-56: the video progress sheet escapes its label (it carries a player name)', async () => {
  let markup = '';
  const sheet = {style: {}, set innerHTML(v) { markup = v; }, get innerHTML() { return markup; }, querySelector: () => ({style: {}, addEventListener() {}}), remove() {}};
  const document = {getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => sheet, body: {appendChild() {}}, readyState: 'complete'};
  const gv = loadInner('game-video.js', ['withProgress'], {document});
  await gv.withProgress(`正在製作 ${BAD} 的擊球回顧影片…`, async () => 1);
  noMarkup(markup, 'progress');
});
