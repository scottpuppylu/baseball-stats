// Secure data API (cloud-api/lib/core.mjs): identity, roles, scope, conflicts and failures, against a fake GitHub
// and a fake Google. No network; no real credentials; nothing touches the real repository.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const load = () => import('../cloud-api/lib/core.mjs');
const SECRET = 'unit-test-session-secret-0123456789abcdef';
const ENV = {
  SESSION_SECRET: SECRET, GITHUB_DATA_TOKEN: 'unit-test-not-a-token', GITHUB_REPO: 'owner/repo',
  GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'unit-test', API_PUBLIC_URL: 'https://api.example.test',
  ADMIN_EMAILS: 'Admin@Example.test', EDITOR_EMAILS: 'editor@example.test',
  ALLOWED_ORIGINS: 'https://site.example.test', ALLOWED_RETURN_URLS: 'https://site.example.test/app/,io.github.scottpuppylu.baseballstats://auth'
};
const sha1 = text => crypto.createHash('sha1').update(text).digest('hex');
const b64u = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

// Fake GitHub contents API with per-branch files and sha checks like the real one.
function fakeGitHub(files = {'data/logs.json': '[{"id":"a"}]', 'data/defense.json': '{}'}) {
  const branches = {data: new Map(Object.entries(files)), main: new Map(Object.entries(files))};
  const calls = [];
  const gh = {branches, calls, failNext: 0};
  gh.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({host: u.hostname, path: u.pathname, method: init.method || 'GET', auth: init.headers && init.headers.Authorization, body: init.body});
    if (u.hostname !== 'api.github.com') throw new Error('unexpected host ' + u.hostname);
    if (gh.failNext) { gh.failNext--; return new Response('{"message":"boom"}', {status: 500}); }
    const file = u.pathname.split('/contents/')[1];
    if ((init.method || 'GET') === 'PUT') {
      const body = JSON.parse(init.body);
      const store = branches[body.branch];
      if (store.has(file) && !body.sha) return new Response('{}', {status: 422});
      if (store.has(file) && body.sha !== sha1(store.get(file))) return new Response('{}', {status: 409});
      store.set(file, Buffer.from(body.content, 'base64').toString());
      return new Response(JSON.stringify({content: {sha: sha1(store.get(file))}}), {status: 200});
    }
    const store = branches[u.searchParams.get('ref')];
    if (!store.has(file)) return new Response('{}', {status: 404});
    return new Response(JSON.stringify({sha: sha1(store.get(file)), encoding: 'base64', content: Buffer.from(store.get(file)).toString('base64')}), {status: 200});
  };
  return gh;
}
async function sessionFor(core, email, name = 'Tester', exp = Math.floor(Date.now() / 1000) + 3600) {
  return core.signToken(SECRET, {purpose: 'session', email, name, exp});
}
const req = (path, {method = 'GET', token, body, headers = {}} = {}) => new Request(`https://api.example.test${path}`, {
  method, headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers},
  body: body === undefined ? undefined : JSON.stringify(body)
});
const put = (file, content, sha, token, extra = {}) => req(`/api/data/${file}`, {method: 'PUT', token, body: {content, sha, message: 'test write', ...extra}});

test('reads need no login and return content with its version sha (no credential reaches the client)', async () => {
  const core = await load(); const gh = fakeGitHub();
  const res = await core.handle(req('/api/data/logs.json'), ENV, {fetch: gh.fetch});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {content: [{id: 'a'}], sha: sha1('[{"id":"a"}]')});
  assert.ok(!JSON.stringify(body).includes(ENV.GITHUB_DATA_TOKEN));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(gh.calls[0].path, '/repos/owner/repo/contents/data/logs.json');
});

test('unauthenticated, tampered, expired and wrongly-signed sessions cannot write', async () => {
  const core = await load(); const gh = fakeGitHub();
  const sha = sha1('[{"id":"a"}]');
  const good = await sessionFor(core, 'editor@example.test');
  const [h, p] = good.split('.');
  const tampered = `${h}.${b64u({purpose: 'session', email: 'admin@example.test', name: 'x', exp: 9e9})}.${good.split('.')[2]}`;
  const expired = await sessionFor(core, 'editor@example.test', 'x', Math.floor(Date.now() / 1000) - 1);
  const otherSecret = await core.signToken('another-secret-another-secret-123456', {purpose: 'session', email: 'editor@example.test', name: 'x', exp: 9e9});
  const handoffAsSession = await core.signToken(SECRET, {purpose: 'handoff', email: 'editor@example.test', name: 'x', exp: 9e9});
  const none = `${b64u({alg: 'none'})}.${p}.`;
  for (const token of [undefined, tampered, expired, otherSecret, handoffAsSession, none, 'garbage']) {
    const res = await core.handle(put('logs.json', [{id: 'a'}, {id: 'b'}], sha, token), ENV, {fetch: gh.fetch});
    assert.equal(res.status, 401, String(token).slice(0, 20));
    assert.equal((await res.json()).error, 'unauthenticated');
  }
  assert.equal(gh.calls.filter(c => c.method === 'PUT').length, 0, 'nothing reached GitHub');
});

test('roles: an editor cannot change the coach-only rankings, an admin can; unknown accounts are rejected', async () => {
  const core = await load(); const gh = fakeGitHub();
  const sha = sha1('{}');
  const editor = await sessionFor(core, 'editor@example.test');
  const admin = await sessionFor(core, 'admin@example.test');
  const stranger = await sessionFor(core, 'someone@example.test');
  assert.equal((await core.handle(put('defense.json', {SS: ['x']}, sha, editor), ENV, {fetch: gh.fetch})).status, 403);
  assert.equal((await core.handle(put('defense.json', {SS: ['x']}, sha, stranger), ENV, {fetch: gh.fetch})).status, 401);
  const ok = await core.handle(put('defense.json', {SS: ['x']}, sha, admin), ENV, {fetch: gh.fetch});
  assert.equal(ok.status, 200);
  assert.equal(gh.branches.data.get('data/defense.json'), JSON.stringify({SS: ['x']}, null, 2));
});

test('removing someone from the allowlist revokes their unexpired session at once', async () => {
  const core = await load(); const gh = fakeGitHub();
  const token = await sessionFor(core, 'editor@example.test');
  const res = await core.handle(put('logs.json', [{id: 'a'}], sha1('[{"id":"a"}]'), token), {...ENV, EDITOR_EMAILS: ''}, {fetch: gh.fetch});
  assert.equal(res.status, 401);
});

test('a valid edit writes only data/<file> on the data branch, with the server credential and an audit name', async () => {
  const core = await load(); const gh = fakeGitHub();
  const token = await sessionFor(core, 'editor@example.test', '王小明');
  const res = await core.handle(put('logs.json', [{id: 'a'}, {id: 'new'}], sha1('[{"id":"a"}]'), token), ENV, {fetch: gh.fetch});
  assert.equal(res.status, 200);
  const {content} = await res.json();
  assert.match(content.sha, /^[0-9a-f]{40}$/);
  const write = gh.calls.find(c => c.method === 'PUT');
  assert.equal(write.path, '/repos/owner/repo/contents/data/logs.json');
  assert.equal(write.auth, `Bearer ${ENV.GITHUB_DATA_TOKEN}`);
  const body = JSON.parse(write.body);
  assert.equal(body.branch, 'data');
  assert.match(body.message, /^test write \[via app: 王小明 \(editor\)\]$/);
  assert.equal(gh.branches.main.get('data/logs.json'), '[{"id":"a"}]', 'main untouched');
});

test('scope: unknown files, path tricks and a non-data branch setting are refused', async () => {
  const core = await load(); const gh = fakeGitHub();
  const token = await sessionFor(core, 'admin@example.test');
  for (const path of ['/api/data/legacy-main.json', '/api/data/..%2Findex.html', '/api/data/LOGS.json', '/api/data/logs.json/x', '/api/contents/index.html']) {
    const res = await core.handle(req(path, {method: 'PUT', token, body: {content: []}}), ENV, {fetch: gh.fetch});
    assert.equal(res.status, 404, path);
  }
  const res = await core.handle(put('logs.json', [{id: 'a'}], sha1('[{"id":"a"}]'), token), {...ENV, GITHUB_DATA_BRANCH: 'main'}, {fetch: gh.fetch});
  assert.equal(res.status, 500);
  assert.equal(gh.calls.filter(c => c.method === 'PUT').length, 0);
});

test('data validation: wrong shapes, missing ids and prototype keys are rejected (duplicates stay accepted as before)', async () => {
  const core = await load(); const gh = fakeGitHub();
  const token = await sessionFor(core, 'admin@example.test');
  const sha = sha1('[{"id":"a"}]');
  const cases = [
    ['logs.json', {id: 'a'}], ['logs.json', [{name: 'no id'}]], ['logs.json', [{id: ''}]], ['games.json', [null]], ['logs.json', ['x']],
    ['tags.json', []], ['guests.json', [{jersey: 1}]]
  ];
  for (const [file, content] of cases) {
    const res = await core.handle(put(file, content, sha, token), ENV, {fetch: gh.fetch});
    assert.equal(res.status, 400, `${file} ${JSON.stringify(content)}`);
  }
  const proto = new Request('https://api.example.test/api/data/tags.json', {method: 'PUT', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: '{"content":{"__proto__":{"x":1}},"sha":null}'});
  assert.equal((await core.handle(proto, ENV, {fetch: gh.fetch})).status, 400);
  const text = await core.handle(new Request('https://api.example.test/api/data/tags.json', {method: 'PUT', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain'}, body: '{}'}), ENV, {fetch: gh.fetch});
  assert.equal(text.status, 415);
  const big = await core.handle(put('tags.json', {x: 'y'.repeat(4_100_000)}, null, token), ENV, {fetch: gh.fetch});
  assert.equal(big.status, 413);
  assert.equal(gh.calls.filter(c => c.method === 'PUT').length, 0);
});

test('version conflicts: a stale or missing sha returns 409 so the page re-reads and merges', async () => {
  const core = await load(); const gh = fakeGitHub();
  const token = await sessionFor(core, 'editor@example.test');
  const stale = await core.handle(put('logs.json', [{id: 'a'}, {id: 'b'}], 'f'.repeat(40), token), ENV, {fetch: gh.fetch});
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'conflict');
  const missing = await core.handle(put('logs.json', [{id: 'a'}, {id: 'b'}], null, token), ENV, {fetch: gh.fetch});
  assert.equal(missing.status, 409);
  assert.equal(gh.branches.data.get('data/logs.json'), '[{"id":"a"}]', 'nothing overwritten');
  const bad = await core.handle(put('logs.json', [{id: 'a'}], 'not-a-sha', token), ENV, {fetch: gh.fetch});
  assert.equal(bad.status, 400);
});

test('upstream failures are reported as failures, never as success', async () => {
  const core = await load(); const gh = fakeGitHub();
  const token = await sessionFor(core, 'editor@example.test');
  gh.failNext = 1;
  const res = await core.handle(put('logs.json', [{id: 'a'}, {id: 'b'}], sha1('[{"id":"a"}]'), token), ENV, {fetch: gh.fetch});
  assert.equal(res.status, 502);
  const thrown = await core.handle(put('logs.json', [{id: 'a'}], sha1('[{"id":"a"}]'), token), ENV, {fetch: async () => { throw new Error('ECONNRESET secret-detail'); }});
  assert.equal(thrown.status, 500);
  assert.doesNotMatch(await thrown.text(), /secret-detail|ECONNRESET/);
  const weird = await core.handle(put('logs.json', [{id: 'a'}], sha1('[{"id":"a"}]'), token), ENV, {fetch: async (url, init) => init.method === 'PUT' ? new Response('{}', {status: 200}) : gh.fetch(url, init)});
  assert.equal(weird.status, 502, 'a success without a new version is not treated as saved');
});

test('not configured: reads and writes say so (503) instead of pretending', async () => {
  const core = await load(); const gh = fakeGitHub();
  const token = await sessionFor(core, 'editor@example.test');
  const env = {...ENV, GITHUB_DATA_TOKEN: ''};
  assert.equal((await core.handle(put('logs.json', [{id: 'a'}], null, token), env, {fetch: gh.fetch})).status, 503);
  const health = await (await core.handle(req('/api/health'), env, {fetch: gh.fetch})).json();
  assert.deepEqual(health, {ok: true, auth: true, writes: false, branch: 'data'});
  const noAuth = {...ENV, SESSION_SECRET: 'short'};
  assert.equal((await core.handle(req('/api/auth/login?return_to=x&challenge=y'), noAuth, {fetch: gh.fetch})).status, 503);
  assert.equal((await core.handle(put('logs.json', [{id: 'a'}], null, token), noAuth, {fetch: gh.fetch})).status, 503);
});

test('CORS headers only for listed sites, and never grant access by themselves', async () => {
  const core = await load(); const gh = fakeGitHub();
  const listed = await core.handle(req('/api/health', {headers: {Origin: 'https://site.example.test'}}), ENV, {fetch: gh.fetch});
  assert.equal(listed.headers.get('Access-Control-Allow-Origin'), 'https://site.example.test');
  const other = await core.handle(req('/api/health', {headers: {Origin: 'https://evil.example'}}), ENV, {fetch: gh.fetch});
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
  const write = await core.handle(req('/api/data/logs.json', {method: 'PUT', headers: {Origin: 'https://site.example.test'}, body: {content: []}}), ENV, {fetch: gh.fetch});
  assert.equal(write.status, 401, 'an allowed origin without a session still cannot write');
});

// ---------- sign-in flow ----------
async function startLogin(core, returnTo = 'https://site.example.test/app/') {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const res = await core.handle(req(`/api/auth/login?${new URLSearchParams({return_to: returnTo, challenge})}`), ENV, {fetch: async () => { throw new Error('no network'); }});
  return {res, verifier, challenge};
}
function fakeGoogle(claims) {
  return async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('redirect_uri'), 'https://api.example.test/api/auth/callback');
    return new Response(JSON.stringify({id_token: `${b64u({alg: 'RS256'})}.${b64u(claims)}.sig`}), {status: 200});
  };
}
const fragment = res => new URLSearchParams(new URL(res.headers.get('Location')).hash.slice(1));

test('login only returns to listed addresses and needs a challenge', async () => {
  const core = await load();
  for (const bad of ['https://evil.example/', 'https://site.example.test/app/../x', 'javascript:alert(1)']) {
    assert.equal((await startLogin(core, bad)).res.status, 400, bad);
  }
  const noChallenge = await core.handle(req('/api/auth/login?return_to=https%3A%2F%2Fsite.example.test%2Fapp%2F'), ENV, {});
  assert.equal(noChallenge.status, 400);
  const {res} = await startLogin(core);
  assert.equal(res.status, 302);
  const google = new URL(res.headers.get('Location'));
  assert.equal(google.origin, 'https://accounts.google.com');
  assert.equal(google.searchParams.get('client_id'), ENV.GOOGLE_CLIENT_ID);
  assert.ok(!res.headers.get('Location').includes(ENV.GOOGLE_CLIENT_SECRET));
});

test('full sign-in: Google identity → allowlisted role → one-time code bound to this device → session that can write', async () => {
  const core = await load(); const gh = fakeGitHub();
  const {res, verifier} = await startLogin(core);
  const google = new URL(res.headers.get('Location'));
  const state = google.searchParams.get('state'), nonce = google.searchParams.get('nonce');
  const now = Math.floor(Date.now() / 1000);
  const claims = {iss: 'https://accounts.google.com', aud: ENV.GOOGLE_CLIENT_ID, exp: now + 300, nonce, email: 'editor@example.test', email_verified: true, name: '王小明'};
  const cb = await core.handle(req(`/api/auth/callback?${new URLSearchParams({code: 'g-code', state})}`), ENV, {fetch: fakeGoogle(claims)});
  assert.equal(cb.status, 302);
  assert.ok(cb.headers.get('Location').startsWith('https://site.example.test/app/#'), 'code travels in the fragment');
  const code = fragment(cb).get('auth_code');
  assert.ok(code);
  // Another device (or app) that intercepted the code cannot redeem it without the verifier.
  const stolen = await core.handle(req('/api/auth/exchange', {method: 'POST', body: {code, verifier: crypto.randomBytes(32).toString('base64url')}}), ENV, {});
  assert.equal(stolen.status, 401);
  const ex = await core.handle(req('/api/auth/exchange', {method: 'POST', body: {code, verifier}}), ENV, {});
  assert.equal(ex.status, 200);
  const {token, user} = await ex.json();
  assert.deepEqual(user, {email: 'editor@example.test', name: '王小明', role: 'editor'});
  const me = await core.handle(req('/api/me', {token}), ENV, {});
  assert.equal((await me.json()).user.role, 'editor');
  const write = await core.handle(put('logs.json', [{id: 'a'}, {id: 'x'}], sha1('[{"id":"a"}]'), token), ENV, {fetch: gh.fetch});
  assert.equal(write.status, 200);
});

test('sign-in refuses accounts not on the list, unverified emails, wrong audience, wrong nonce and forged state', async () => {
  const core = await load();
  const {res} = await startLogin(core);
  const google = new URL(res.headers.get('Location'));
  const state = google.searchParams.get('state'), nonce = google.searchParams.get('nonce');
  const now = Math.floor(Date.now() / 1000);
  const base = {iss: 'https://accounts.google.com', aud: ENV.GOOGLE_CLIENT_ID, exp: now + 300, nonce, email: 'editor@example.test', email_verified: true};
  const cases = [
    [{...base, email: 'stranger@example.test'}, 'not_allowed'],
    [{...base, email_verified: false}, 'unverified'],
    [{...base, aud: 'other-client'}, 'provider'],
    [{...base, nonce: 'other'}, 'provider'],
    [{...base, iss: 'https://evil.example'}, 'provider'],
    [{...base, exp: now - 1}, 'provider']
  ];
  for (const [claims, expected] of cases) {
    const cb = await core.handle(req(`/api/auth/callback?${new URLSearchParams({code: 'c', state})}`), ENV, {fetch: fakeGoogle(claims)});
    assert.equal(fragment(cb).get('auth_error'), expected, JSON.stringify(claims));
    assert.equal(fragment(cb).get('auth_code'), null);
  }
  const forged = await core.signToken('another-secret-another-secret-123456', {purpose: 'state', returnTo: 'https://site.example.test/app/', challenge: 'x'.repeat(43), nonce, exp: now + 300});
  const bad = await core.handle(req(`/api/auth/callback?${new URLSearchParams({code: 'c', state: forged})}`), ENV, {fetch: fakeGoogle(base)});
  assert.equal(bad.status, 400);
});
