// Local QA only: route all GitHub traffic into memory and run the real secure API (cloud-api/lib/core.mjs) against it.
// No requests or writes are sent to GitHub; no data/*.json files are modified.
// The data comes from the frozen copy in tests/fixtures/data, so tests do not drift when the team's real data changes.
// Like the real repository, the cloud has two branches: `data` (where the site reads and writes) and `main` (the site code
// plus the data as it was before the 2026/10/11 move; pages opened before the move may still write there).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures', 'data');
const port = Number(process.env.UI_PREVIEW_PORT || 54321);
// Like GitHub: every version of a file has its own sha (also usable as a blob id), and an upload must name the version it replaces.
const shaOf = data => crypto.createHash('sha1').update(data).digest('hex');
const branches = {data: new Map(), main: new Map()};
const blobs = new Map();
const put = (branch, file, data) => { branches[branch].set(file, data); blobs.set(shaOf(data), data); };
for (const name of ['logs', 'games', 'avatars', 'tags', 'defense', 'guests']) {
  const filename = path.join(fixtures, `${name}.json`);
  if (!fs.existsSync(filename)) continue;
  put('data', `data/${name}.json`, fs.readFileSync(filename));
  put('main', `data/${name}.json`, fs.readFileSync(filename));
}
// The marker the site keeps on the data branch: the main-branch versions already merged in (here: the starting copies).
put('data', 'data/legacy-main.json', Buffer.from(JSON.stringify(Object.fromEntries([...branches.main].map(([file, data]) => [file, shaOf(data)])), null, 2)));

const injection = () => `<script>
window.BASEBALL_APP_CONFIG = {apiBase: location.origin + '/__cloud'};
if (!new URLSearchParams(location.search).has('signedOut')) localStorage.setItem('rebas_cloud_session', ${JSON.stringify(JSON.stringify(previewSession))});
else localStorage.removeItem('rebas_cloud_session');
window.__previewWrites = [];
window.__previewFailWrites = false;
window.__previewErrors = [];
window.addEventListener('DOMContentLoaded', () => {
  document.title = '【隔離預覽】' + document.title;
  const notice = document.createElement('div');
  notice.textContent = '隔離測試預覽 · 操作不會寫入正式資料';
  notice.style.cssText = 'font-size:12px;color:#fbbf24;padding:6px 10px;border:1px solid #664b20;border-radius:8px;margin-bottom:16px;';
  document.getElementById('appWorkspace')?.prepend(notice);
});
window.addEventListener('error', e => window.__previewErrors.push(e.message));
const previewFetch = window.fetch.bind(window);
window.fetch = (input, options = {}) => {
  const url = String(input);
  // Secure-API data calls travel as /__mock-api/data/<file>?api=1, so tests that intercept a file's cloud traffic by that
  // address (failures, races) apply to them too; the preview server answers them with the real API code.
  const apiData = url.match(/\\/__cloud\\/api\\/data\\/([a-z]+\\.json)$/);
  if (apiData) {
    if (options.method === 'PUT') {
      window.__previewWrites.push('data/' + apiData[1]);
      if (window.__previewFailWrites) return Promise.resolve(new Response('{}', {status: 500}));
    }
    return previewFetch('/__mock-api/data/' + apiData[1] + '?ref=data&api=1', options);
  }
  if (/^https:\\/\\/(api\\.github\\.com|raw\\.githubusercontent\\.com)\\//.test(url)) {
    const parsed = new URL(url);
    let file, ref = parsed.searchParams.get('ref') || 'data', accept = (options.headers && (options.headers.Accept || options.headers.accept)) || '';
    if (parsed.hostname === 'raw.githubusercontent.com') {
      const parts = parsed.pathname.split('/'); // /owner/repo/branch/path...
      ref = parts[3]; file = parts.slice(4).join('/'); accept = 'application/vnd.github.raw';
    } else if (parsed.pathname.includes('/git/blobs/')) {
      file = '__blob/' + parsed.pathname.split('/git/blobs/')[1];
    } else {
      file = parsed.pathname.split('/contents/')[1];
    }
    if (options.method === 'PUT') {
      window.__previewWrites.push(file);
      if (window.__previewFailWrites) return Promise.resolve(new Response('{}', {status: 500}));
    }
    return previewFetch('/__mock-api/' + file + '?ref=' + encodeURIComponent(ref), {...options, headers: {'Content-Type': 'application/json', 'X-Mock-Accept': accept}});
  }
  return previewFetch(input, options);
};
</script>`;
// Answers like GitHub's contents API. file: 'data/x.json', a folder, or '__blob/<sha>'.
function mockGitHub(method, file, refParam, body, accept) {
  if (file.startsWith('__blob/')) {
    const data = blobs.get(file.slice('__blob/'.length));
    return data ? {status: 200, body: {encoding: 'base64', content: data.toString('base64')}} : {status: 404, body: {}};
  }
  const ref = (body && body.branch) || refParam || 'data';
  const store = branches[ref];
  if (!store) return {status: 404, body: {message: 'No commit found for the ref'}};
  // A folder: the listing GitHub gives (name, path, sha per file).
  if (method !== 'PUT' && !file.endsWith('.json')) {
    const entries = [...store].filter(([name]) => name.startsWith(file + '/')).map(([name, data]) => ({type: 'file', name: path.basename(name), path: name, sha: shaOf(data)}));
    return entries.length ? {status: 200, body: entries} : {status: 404, body: {}};
  }
  if (!store.has(file) && method !== 'PUT') return {status: 404, body: {}};
  if (method === 'PUT') {
    // 422: the file exists but no sha was sent; 409: the sha is an older version (another device wrote in between).
    if (store.has(file) && !body.sha) return {status: 422, body: {message: 'sha was not supplied'}};
    if (store.has(file) && body.sha !== shaOf(store.get(file))) return {status: 409, body: {message: 'is at a newer version'}};
    put(ref, file, Buffer.from(body.content, 'base64'));
    commits.push({branch: ref, file, message: body.message});
  }
  const data = store.get(file);
  // Like GitHub: the raw media type returns the file itself; JSON carries base64 content only up to 1 MB.
  if (method !== 'PUT' && /vnd\.github\.raw/.test(accept)) return {status: 200, raw: data};
  const large = data.length > (Number(process.env.UI_PREVIEW_INLINE_LIMIT) || 1024 * 1024);
  return {status: 200, body: method === 'PUT' ? {content: {sha: shaOf(data)}} : {sha: shaOf(data), encoding: large ? 'none' : 'base64', content: large ? '' : data.toString('base64')}};
}
const commits = [];

// The secure API runs with throwaway preview settings; its server-side GitHub calls stay in memory.
const apiCore = import('../cloud-api/lib/core.mjs');
const apiEnv = {
  SESSION_SECRET: 'isolated-preview-session-secret-not-used-anywhere-else', GITHUB_DATA_TOKEN: 'isolated-preview',
  GOOGLE_CLIENT_ID: 'isolated-preview', GOOGLE_CLIENT_SECRET: 'isolated-preview', API_PUBLIC_URL: `http://127.0.0.1:${port}/__cloud`,
  ADMIN_EMAILS: 'admin@preview.test', EDITOR_EMAILS: 'editor@preview.test'
};
let previewSession = null;
const sessionReady = apiCore.then(async core => {
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  previewSession = {token: await core.signToken(apiEnv.SESSION_SECRET, {purpose: 'session', email: 'admin@preview.test', name: '預覽管理員', exp}), expiresAt: exp * 1000, user: {email: 'admin@preview.test', name: '預覽管理員', role: 'admin'}};
});
async function apiGitHubFetch(url, init = {}) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'api.github.com') throw new Error('preview: unexpected upstream ' + parsed.hostname);
  const file = decodeURIComponent(parsed.pathname.split('/contents/')[1]);
  const accept = (init.headers && init.headers.Accept) || '';
  const out = mockGitHub(init.method || 'GET', file, parsed.searchParams.get('ref'), init.body ? JSON.parse(init.body) : null, accept);
  return new Response(out.raw || JSON.stringify(out.body), {status: out.status, headers: {'Content-Type': 'application/json'}});
}
async function forwardToApi(req, res, apiPath) {
  const core = await apiCore;
  let text = '';
  for await (const chunk of req) text += chunk;
  const request = new Request(`http://127.0.0.1:${port}${apiPath}`, {method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : text});
  const response = await core.handle(request, apiEnv, {fetch: apiGitHubFetch});
  res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
}
const json = (res, status, body) => res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}).end(JSON.stringify(body));
http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://localhost:${port}`);
    const pathname = decodeURIComponent(parsed.pathname);
    if (pathname.startsWith('/__mock-api/data/') && parsed.searchParams.get('api') === '1') return forwardToApi(req, res, `/api/data/${pathname.slice('/__mock-api/data/'.length)}`);
    if (pathname.startsWith('/__mock-api/')) {
      let body = null;
      if (req.method === 'PUT') {
        let text = '';
        for await (const chunk of req) text += chunk;
        body = JSON.parse(text);
      }
      const out = mockGitHub(req.method, pathname.slice('/__mock-api/'.length), parsed.searchParams.get('ref'), body, req.headers['x-mock-accept'] || '');
      res.writeHead(out.status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}).end(out.raw || JSON.stringify(out.body));
      return;
    }
    if (pathname === '/__preview/commits') return json(res, 200, commits);
    // The real secure API, with its GitHub calls answered by the in-memory branches above.
    if (pathname.startsWith('/__cloud/api/')) return forwardToApi(req, res, req.url.slice('/__cloud'.length));
    // The site's own data/ folder (the last fallback) is the frozen fixture copy as well.
    const filename = pathname.startsWith('/data/') ? path.join(fixtures, path.basename(pathname)) : path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!(filename.startsWith(root + path.sep)) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
      res.writeHead(404).end('Not found'); return;
    }
    let content = fs.readFileSync(filename);
    if (filename.endsWith('index.html')) {
      await sessionReady;
      content = Buffer.from(content.toString().replace('<head>', '<head>' + injection()));
    }
    const mime = {'.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp'};
    res.writeHead(200, {'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    res.end(content);
  } catch { res.writeHead(500).end('Preview error'); }
}).listen(port, '127.0.0.1', () => console.log(`Isolated UI preview: http://127.0.0.1:${port}`));
