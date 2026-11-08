// A player photo is shown and kept only when it is an image data URL (V-58). Before, any text in avatars.json became
// an <img src>: a web address loaded a picture from another site, and "javascript:" or "data:text/html" was placed
// on the page as is.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const fn = marker => {
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, marker);
  return html.slice(start, html.indexOf('\n    }\n', start) + 7);
};
const helpers = () => (html.includes('    function isImageAvatar(') ? fn('    function isImageAvatar(') + fn('    function imageAvatarsOnly(') : '');
const GOOD = 'data:image/jpeg;base64,/9j/AAAA';
const BAD = {web: 'https://example.com/x.png', js: 'javascript:alert(1)', page: 'data:text/html,<b>x</b>', num: 7};

test('V-58: only an image data URL is drawn as a photo; anything else shows the initial', () => {
  const ctx = vm.createContext({playerAvatars: {ok: GOOD, ...BAD}, avatarSrc: data => data});
  vm.runInContext(helpers() + fn('    function escHtml(') + fn('    function renderAvatarElement('), ctx);
  assert.match(ctx.renderAvatarElement('ok'), /<img src="data:image\/jpeg/);
  for (const name of Object.keys(BAD)) assert.doesNotMatch(ctx.renderAvatarElement(name), /<img/, name);
});

test('V-58: loading avatars keeps only image data URLs', async () => {
  const ctx = vm.createContext({
    loadDatabaseSource: async (_path, _key, apply) => { apply({ok: GOOD, ...BAD}, 'cloud'); return 'cloud'; },
    AVATARS_FILE_PATH: 'avatars.json'
  });
  vm.runInContext('var playerAvatars = {}; var currentAvatarsSha = null;\n' + helpers() + fn('    async function loadAvatarsFromGitHub('), ctx);
  await ctx.loadAvatarsFromGitHub();
  assert.deepEqual(Object.keys(ctx.playerAvatars), ['ok']);
});
