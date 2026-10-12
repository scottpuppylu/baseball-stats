// Browser adapter (cloud-sync.js): writes go only to the secure API with a personal session, and every impossible
// write is reported as a failure. Runs the real file in a sandbox with fake storage and network.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'cloud-sync.js'), 'utf8');

function sandbox({apiBase = 'https://api.example.test', session = null, online = true, fetch, hash = ''} = {}) {
  const storage = new Map();
  if (session) storage.set('rebas_cloud_session', JSON.stringify(session));
  const calls = [], toasts = [];
  const win = {
    BASEBALL_APP_CONFIG: {apiBase},
    localStorage: {getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k)},
    navigator: {onLine: online},
    location: {origin: 'https://scottpuppylu.github.io', pathname: '/baseball-stats/index.html', search: '', hash, assign: url => calls.push({assign: url})},
    history: {replaceState: () => {}},
    document: {readyState: 'complete', getElementById: () => null, addEventListener() {}},
    addEventListener() {},
    showToast: (m, t) => toasts.push({m, t}),
    fetch: async (url, init = {}) => { calls.push({url, init}); return fetch ? fetch(url, init) : new Response('{}', {status: 200}); },
    AbortController, setTimeout, clearTimeout, URLSearchParams, TextEncoder, Response, btoa, atob, crypto, confirm: () => true
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(source, win);
  return {win, api: win.cloudApi, calls, toasts, storage};
}
const live = {token: 'h.p.s', expiresAt: Date.now() + 3600e3, user: {name: '王小明', role: 'editor'}};

test('the browser bundle carries no GitHub credential and never calls GitHub to write', () => {
  assert.doesNotMatch(source, /ghp_|github_pat_|GITHUB_TOKEN|api\.github\.com/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /GITHUB_TOKEN|String\.fromCharCode\(c\)\)\.join|ghp_|github_pat_/);
  assert.doesNotMatch(html, /method:\s*'PUT'[\s\S]{0,200}api\.github\.com/);
});

test('without a configured API, writes fail clearly and the page keeps its local copy', async () => {
  const {api, calls} = sandbox({apiBase: ''});
  assert.equal(api.enabled, false);
  await assert.rejects(api.writeFile('data/logs.json', [], null, 'm', 1000), /尚未啟用/);
  assert.equal(await api.readFile('data/logs.json', 1000), null, 'reads fall back to the public copy');
  assert.equal(calls.length, 0);
});

test('without a session, writes ask for sign-in and send nothing', async () => {
  const {api, calls} = sandbox();
  await assert.rejects(api.writeFile('data/logs.json', [], null, 'm', 1000), /登入編輯/);
  assert.equal(calls.length, 0);
});

test('offline writes are refused immediately instead of pretending to sync', async () => {
  const {api, calls} = sandbox({session: live, online: false});
  await assert.rejects(api.writeFile('data/games.json', [], null, 'm', 1000), /離線/);
  assert.equal(calls.length, 0);
});

test('a signed-in write sends the personal session to the API only, with the version to replace', async () => {
  const {api, calls} = sandbox({session: live, fetch: async () => new Response('{"content":{"sha":"' + 'a'.repeat(40) + '"}}', {status: 200})});
  const res = await api.writeFile('data/logs.json', [{id: 'x'}], 'b'.repeat(40), 'msg', 1000);
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, 'https://api.example.test/api/data/logs.json');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer h.p.s');
  assert.deepEqual(JSON.parse(calls[0].init.body), {content: [{id: 'x'}], sha: 'b'.repeat(40), message: 'msg'});
  await assert.rejects(api.writeFile('data/../index.html', [], null, 'm', 1000), /不允許/);
  await assert.rejects(api.writeFile('data/legacy-main.json', {}, null, 'm', 1000), /不允許/);
});

test('a rejected session (401) is cleared so the next write asks for sign-in again', async () => {
  const {api, storage} = sandbox({session: live, fetch: async () => new Response('{"error":"unauthenticated"}', {status: 401})});
  const res = await api.writeFile('data/logs.json', [], null, 'm', 1000);
  assert.equal(res.status, 401);
  assert.equal(storage.has('rebas_cloud_session'), false);
  assert.equal(api.state().signedIn, false);
});

test('network failures and timeouts are errors, never a silent success', async () => {
  const down = sandbox({session: live, fetch: async () => { throw new TypeError('Failed to fetch'); }});
  await assert.rejects(down.api.writeFile('data/logs.json', [], null, 'm', 1000), /網路連線失敗/);
  const slow = sandbox({session: live, fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'}))))});
  await assert.rejects(slow.api.writeFile('data/logs.json', [], null, 'm', 50), /逾時/);
});

test('an expired session counts as signed out', () => {
  const {api} = sandbox({session: {...live, expiresAt: Date.now() - 1}});
  assert.equal(api.state().signedIn, false);
});

test('website sign-in returns to this page and binds the code to a verifier kept on this device', async () => {
  const {api, calls, storage} = sandbox();
  await api.login();
  const url = new URL(calls[0].assign);
  assert.equal(url.origin + url.pathname, 'https://api.example.test/api/auth/login');
  assert.equal(url.searchParams.get('return_to'), 'https://scottpuppylu.github.io/baseball-stats/');
  const pending = JSON.parse(storage.get('rebas_cloud_login'));
  const expected = require('node:crypto').createHash('sha256').update(pending.verifier).digest('base64url');
  assert.equal(url.searchParams.get('challenge'), expected);
});

test('the returned code is exchanged once and the fragment is never kept', async () => {
  const pending = {verifier: 'v'.repeat(43), at: Date.now()};
  const storage = new Map([['rebas_cloud_login', JSON.stringify(pending)]]);
  let replaced = null, exchanged = null;
  const win = {
    BASEBALL_APP_CONFIG: {apiBase: 'https://api.example.test'},
    localStorage: {getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k)},
    navigator: {onLine: true}, location: {origin: 'https://x', pathname: '/baseball-stats/', search: '', hash: '#auth_code=abc.def.ghi'},
    history: {replaceState: (a, b, url) => { replaced = url; }},
    document: {readyState: 'complete', getElementById: () => null, addEventListener() {}}, addEventListener() {}, showToast() {},
    fetch: async (url, init) => { exchanged = {url, body: JSON.parse(init.body)}; return new Response(JSON.stringify({token: 't.t.t', expiresAt: Date.now() + 1e6, user: {name: 'A', role: 'admin'}}), {status: 200}); },
    AbortController, setTimeout, clearTimeout, URLSearchParams, TextEncoder, Response, btoa, atob, crypto
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(source, win);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(replaced, '/baseball-stats/');
  assert.deepEqual(exchanged, {url: 'https://api.example.test/api/auth/exchange', body: {code: 'abc.def.ghi', verifier: pending.verifier}});
  assert.equal(storage.has('rebas_cloud_login'), false, 'verifier is single-use');
  assert.equal(JSON.parse(storage.get('rebas_cloud_session')).token, 't.t.t');
});
