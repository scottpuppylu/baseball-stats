// Secure data API for the website, PWA and Android app.
// The GitHub credential lives only in server environment variables; browsers and the APK never see it.
// Identity: Google OpenID Connect (authorization code flow, server side). Authorization: the email allowlists below,
// re-checked on every write so removing someone from the list takes effect immediately.
// Scope: one repository, the `data` branch, and the six team data files. Nothing else can be read or written here.
//
// Runtime-agnostic: handle(request, env, deps) takes a Web Request and returns a Web Response (Vercel, Node, tests).

export const DATA_FILES = Object.freeze({
  'logs.json': {kind: 'list', key: 'id'},
  'games.json': {kind: 'list', key: 'id'},
  'guests.json': {kind: 'list', key: 'name'},
  'avatars.json': {kind: 'map'},
  'tags.json': {kind: 'map'},
  'defense.json': {kind: 'map'}
});
// Which role may write which file. Editors record games and logs; the coach-only position rankings need an admin.
export const WRITE_ROLES = Object.freeze({
  'logs.json': ['editor', 'admin'], 'games.json': ['editor', 'admin'], 'guests.json': ['editor', 'admin'],
  'avatars.json': ['editor', 'admin'], 'tags.json': ['editor', 'admin'], 'defense.json': ['admin']
});
const MAX_BODY_BYTES = 4_000_000; // Vercel's request limit is 4.5 MB; today's largest file is about 0.2 MB.
const SESSION_TTL_S = 12 * 3600;
const HANDOFF_TTL_S = 120;
const STATE_TTL_S = 600;

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = text => b64url(enc.encode(text));
const fromB64url = text => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};
const utf8ToBase64 = text => {
  const bytes = enc.encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
export const sha256 = async text => b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };

// ---------- configuration ----------
const list = value => String(value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
export function readConfig(env) {
  const origins = list(env.ALLOWED_ORIGINS);
  const returnTargets = String(env.ALLOWED_RETURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    repo: env.GITHUB_REPO || 'scottpuppylu/baseball-stats',
    branch: env.GITHUB_DATA_BRANCH || 'data',
    githubToken: env.GITHUB_DATA_TOKEN || '',
    sessionSecret: env.SESSION_SECRET || '',
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    publicUrl: String(env.API_PUBLIC_URL || '').replace(/\/+$/, ''),
    admins: list(env.ADMIN_EMAILS),
    editors: list(env.EDITOR_EMAILS),
    origins, returnTargets
  };
}
export function roleFor(config, email) {
  const e = String(email || '').toLowerCase();
  if (config.admins.includes(e)) return 'admin';
  if (config.editors.includes(e)) return 'editor';
  return null;
}
const authReady = c => Boolean(c.sessionSecret.length >= 32 && c.googleClientId && c.googleClientSecret && c.publicUrl);
const writeReady = c => Boolean(authReady(c) && c.githubToken);
// The branch is fixed to `data`; even a misconfigured environment cannot point writes at main.
const assertSafeTarget = c => { if (c.branch !== 'data' || !/^[\w.-]+\/[\w.-]+$/.test(c.repo)) fail(500, 'misconfigured', '伺服器設定錯誤'); };

// ---------- signed tokens (HS256 JWT) ----------
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
export async function signToken(secret, payload) {
  const head = b64urlText(JSON.stringify({alg: 'HS256', typ: 'JWT'}));
  const body = b64urlText(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
export async function verifyToken(secret, token, purpose, nowS) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(fromB64url(parts[0]));
    if (header.alg !== 'HS256') return null;
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - parts[2].length % 4) % 4)), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(fromB64url(parts[1]));
    if (payload.purpose !== purpose || typeof payload.exp !== 'number' || payload.exp <= nowS) return null;
    return payload;
  } catch { return null; }
}

// ---------- HTTP helpers ----------
function corsHeaders(config, request) {
  // CORS only lets the listed sites read responses; it is not access control (the Bearer session is).
  const origin = request.headers.get('Origin');
  if (!origin || !config.origins.includes(origin.toLowerCase())) return {};
  return {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Max-Age': '600'};
}
const baseHeaders = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};
const json = (body, status, extra) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json; charset=utf-8', ...baseHeaders, ...extra}});
const redirect = (location, extra) => new Response(null, {status: 302, headers: {Location: location, ...baseHeaders, ...extra}});

async function readJsonBody(request) {
  if (!String(request.headers.get('Content-Type') || '').startsWith('application/json')) fail(415, 'bad_content_type', '需要 JSON 格式');
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) fail(413, 'too_large', '資料過大');
  const raw = await request.text();
  if (enc.encode(raw).length > MAX_BODY_BYTES) fail(413, 'too_large', '資料過大');
  try { return JSON.parse(raw); } catch { fail(400, 'bad_json', 'JSON 格式錯誤'); }
}

// ---------- data validation ----------
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function checkKeys(value, depth = 0) {
  if (depth > 12) fail(400, 'invalid_data', '資料巢狀過深');
  if (Array.isArray(value)) { value.forEach(v => checkKeys(v, depth + 1)); return; }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (UNSAFE_KEYS.has(key)) fail(400, 'invalid_data', '資料含不允許的欄位');
      checkKeys(value[key], depth + 1);
    }
  }
}
export function validateData(file, content) {
  const spec = DATA_FILES[file];
  if (spec.kind === 'list') {
    if (!Array.isArray(content)) fail(400, 'invalid_data', `${file} 必須是陣列`);
    // Duplicate keys are not rejected: the site has always accepted them, and refusing a save in the field would only
    // strand the scorer's data on one phone. The shape checks below are what keeps the file loadable.
    for (const item of content) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, 'invalid_data', `${file} 每筆資料必須是物件`);
      const key = item[spec.key];
      if ((typeof key !== 'string' && typeof key !== 'number') || String(key) === '') fail(400, 'invalid_data', `${file} 每筆資料都需要 ${spec.key}`);
    }
  } else if (!content || typeof content !== 'object' || Array.isArray(content)) {
    fail(400, 'invalid_data', `${file} 必須是物件`);
  }
  checkKeys(content);
}

// ---------- GitHub ----------
async function github(deps, config, path, init = {}) {
  const res = await deps.fetch(`https://api.github.com/repos/${config.repo}/${path}`, {
    ...init,
    headers: {'Authorization': `Bearer ${config.githubToken}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'baseball-stats-cloud-api', ...(init.headers || {})}
  });
  return res;
}
async function readFile(deps, config, file) {
  const path = `contents/data/${file}?ref=${config.branch}`;
  const res = await github(deps, config, path);
  if (res.status === 404) fail(404, 'not_found', '雲端尚無此資料檔');
  if (!res.ok) fail(502, 'upstream', `GitHub 讀取失敗 (HTTP ${res.status})`);
  const meta = await res.json();
  let text;
  if (meta.encoding === 'base64' && meta.content) {
    text = new TextDecoder().decode(Uint8Array.from(atob(meta.content.replace(/\s/g, '')), c => c.charCodeAt(0)));
  } else {
    const raw = await github(deps, config, path, {headers: {'Accept': 'application/vnd.github.raw'}});
    if (!raw.ok) fail(502, 'upstream', `GitHub 讀取失敗 (HTTP ${raw.status})`);
    text = await raw.text();
  }
  return {content: JSON.parse(text), sha: meta.sha};
}

// ---------- routes ----------
async function sessionFrom(request, config, nowS) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/);
  if (!match) return null;
  const session = await verifyToken(config.sessionSecret, match[1], 'session', nowS);
  if (!session) return null;
  // Re-check the allowlist on every request: a removed editor loses access before the session expires.
  const role = roleFor(config, session.email);
  return role ? {...session, role} : null;
}
const safeReturn = (config, url) => {
  if (typeof url !== 'string' || url.length > 300) return null;
  return config.returnTargets.find(target => url === target) || null;
};

async function login(url, config, nowS) {
  if (!authReady(config)) fail(503, 'auth_not_configured', '登入服務尚未設定');
  const returnTo = safeReturn(config, url.searchParams.get('return_to'));
  const challenge = url.searchParams.get('challenge') || '';
  if (!returnTo) fail(400, 'bad_return', '不允許的返回網址');
  if (!/^[\w-]{43}$/.test(challenge)) fail(400, 'bad_challenge', '缺少驗證參數');
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const state = await signToken(config.sessionSecret, {purpose: 'state', returnTo, challenge, nonce, exp: nowS + STATE_TTL_S});
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({client_id: config.googleClientId, redirect_uri: `${config.publicUrl}/api/auth/callback`, response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account'}).toString();
  return redirect(google.toString());
}

async function callback(url, config, deps, nowS) {
  if (!authReady(config)) fail(503, 'auth_not_configured', '登入服務尚未設定');
  const state = await verifyToken(config.sessionSecret, url.searchParams.get('state'), 'state', nowS);
  if (!state || !safeReturn(config, state.returnTo)) fail(400, 'bad_state', '登入流程已過期，請重新登入');
  const back = (params) => redirect(`${state.returnTo}#${new URLSearchParams(params).toString()}`);
  const code = url.searchParams.get('code');
  if (!code) return back({auth_error: 'cancelled'});
  const tokenRes = await deps.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({code, client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: `${config.publicUrl}/api/auth/callback`, grant_type: 'authorization_code'}).toString()
  });
  if (!tokenRes.ok) return back({auth_error: 'provider'});
  const tokens = await tokenRes.json();
  // The ID token came straight from Google's token endpoint over TLS, so its signature need not be re-checked
  // (OpenID Connect Core 3.1.3.7); its claims still are.
  let claims;
  try { claims = JSON.parse(fromB64url(String(tokens.id_token).split('.')[1])); } catch { return back({auth_error: 'provider'}); }
  const validIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!validIssuer || claims.aud !== config.googleClientId || !(claims.exp > nowS) || claims.nonce !== state.nonce) return back({auth_error: 'provider'});
  if (claims.email_verified !== true || !claims.email) return back({auth_error: 'unverified'});
  const role = roleFor(config, claims.email);
  if (!role) return back({auth_error: 'not_allowed'});
  const handoff = await signToken(config.sessionSecret, {purpose: 'handoff', challenge: state.challenge, email: String(claims.email).toLowerCase(), name: String(claims.name || claims.email).slice(0, 60), jti: b64url(crypto.getRandomValues(new Uint8Array(12))), exp: nowS + HANDOFF_TTL_S});
  return back({auth_code: handoff});
}

async function exchange(request, config, nowS, cors) {
  if (!authReady(config)) fail(503, 'auth_not_configured', '登入服務尚未設定');
  const body = await readJsonBody(request);
  const handoff = await verifyToken(config.sessionSecret, body && body.code, 'handoff', nowS);
  // PKCE-style binding: only the device that started the login (and holds the verifier) can redeem the code.
  if (!handoff || typeof body.verifier !== 'string' || await sha256(body.verifier) !== handoff.challenge) fail(401, 'bad_code', '登入碼無效或已過期');
  const role = roleFor(config, handoff.email);
  if (!role) fail(403, 'not_allowed', '此帳號沒有編輯權限');
  const exp = nowS + SESSION_TTL_S;
  const token = await signToken(config.sessionSecret, {purpose: 'session', email: handoff.email, name: handoff.name, exp});
  return json({token, expiresAt: exp * 1000, user: {email: handoff.email, name: handoff.name, role}}, 200, cors);
}

async function writeData(request, file, config, deps, session, cors) {
  if (!session) fail(401, 'unauthenticated', '請先登入編輯帳號');
  if (!WRITE_ROLES[file].includes(session.role)) fail(403, 'forbidden', '此帳號沒有修改這份資料的權限');
  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object') fail(400, 'bad_json', 'JSON 格式錯誤');
  validateData(file, body.content);
  if (body.sha !== undefined && body.sha !== null && !/^[0-9a-f]{40}$/.test(String(body.sha))) fail(400, 'bad_sha', '版本格式錯誤');
  const summary = String(body.message || 'update').replace(/[\r\n]+/g, ' ').slice(0, 120);
  const putBody = {message: `${summary} [via app: ${session.name} (${session.role})]`, content: utf8ToBase64(JSON.stringify(body.content, null, 2)), branch: config.branch};
  if (body.sha) putBody.sha = body.sha;
  const res = await github(deps, config, `contents/data/${file}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(putBody)});
  // 409 (stale sha) and 422 (sha missing for an existing file) both mean another device wrote first: re-read and merge.
  if (res.status === 409 || res.status === 422) fail(409, 'conflict', '雲端資料已被其他裝置更新，請重新讀取後合併');
  if (!res.ok) fail(502, 'upstream', `GitHub 寫入失敗 (HTTP ${res.status})`);
  const out = await res.json();
  const sha = out && out.content && out.content.sha;
  if (!sha) fail(502, 'upstream', 'GitHub 回應不完整，寫入狀態未知，請重新整理確認');
  return json({content: {sha}}, 200, cors);
}

export async function handle(request, env, deps = {}) {
  const config = readConfig(env);
  const d = {fetch: deps.fetch || fetch, now: deps.now || (() => Date.now())};
  const nowS = Math.floor(d.now() / 1000);
  const cors = corsHeaders(config, request);
  try {
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...baseHeaders, ...cors}});
    if (route === '/api/health' && request.method === 'GET') {
      return json({ok: true, auth: authReady(config), writes: writeReady(config), branch: config.branch}, 200, cors);
    }
    if (route === '/api/auth/login' && request.method === 'GET') return await login(url, config, nowS);
    if (route === '/api/auth/callback' && request.method === 'GET') return await callback(url, config, d, nowS);
    if (route === '/api/auth/exchange' && request.method === 'POST') return await exchange(request, config, nowS, cors);
    if (route === '/api/me' && request.method === 'GET') {
      const session = authReady(config) ? await sessionFrom(request, config, nowS) : null;
      if (!session) fail(401, 'unauthenticated', '尚未登入');
      return json({user: {email: session.email, name: session.name, role: session.role}, expiresAt: session.exp * 1000}, 200, cors);
    }
    const dataMatch = route.match(/^\/api\/data\/([a-z]+\.json)$/);
    if (dataMatch) {
      const file = dataMatch[1];
      if (!DATA_FILES[file]) fail(404, 'not_found', '無此資料');
      assertSafeTarget(config);
      if (!config.githubToken) fail(503, 'writes_not_configured', '雲端資料服務尚未設定');
      if (request.method === 'GET') return json(await readFile(d, config, file), 200, cors);
      if (request.method === 'PUT') {
        if (!writeReady(config)) fail(503, 'writes_not_configured', '雲端寫入尚未設定');
        const session = await sessionFrom(request, config, nowS);
        return await writeData(request, file, config, d, session, cors);
      }
      fail(405, 'method', '不支援此操作');
    }
    fail(404, 'not_found', '找不到此功能');
  } catch (error) {
    if (error instanceof ApiError) return json({error: error.code, message: error.message}, error.status, cors);
    // Never echo internal details (they could include upstream responses); log only the error class.
    console.error('[cloud-api] unexpected', error && error.name);
    return json({error: 'internal', message: '伺服器處理失敗'}, 500, cors);
  }
}
