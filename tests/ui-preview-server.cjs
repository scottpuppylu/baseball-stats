// Local QA only: redact the credential and route all GitHub traffic into memory.
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

const injection = `<script>
window.BASEBALL_APP_CONFIG = {serviceWorker: new URLSearchParams(location.search).has('pwa')};
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
const json = (res, status, body) => res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}).end(JSON.stringify(body));
let swBump = 0;
const previewServer = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://localhost:${port}`);
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\/baseball-stats(?=\/)/, '');
    if (pathname === '/__preview/bump-sw') { swBump++; return json(res, 200, {swBump}); }
    if (pathname.startsWith('/__mock-api/')) {
      const file = pathname.slice('/__mock-api/'.length);
      if (file.startsWith('__blob/')) {
        const data = blobs.get(file.slice('__blob/'.length));
        return data ? json(res, 200, {encoding: 'base64', content: data.toString('base64')}) : json(res, 404, {});
      }
      let body = null;
      if (req.method === 'PUT') {
        let text = '';
        for await (const chunk of req) text += chunk;
        body = JSON.parse(text);
      }
      const ref = (body && body.branch) || parsed.searchParams.get('ref') || 'data';
      const store = branches[ref];
      if (!store) return json(res, 404, {message: 'No commit found for the ref'});
      // A folder: the listing GitHub gives (name, path, sha per file).
      if (req.method !== 'PUT' && !file.endsWith('.json')) {
        const entries = [...store].filter(([name]) => name.startsWith(file + '/')).map(([name, data]) => ({type: 'file', name: path.basename(name), path: name, sha: shaOf(data)}));
        return entries.length ? json(res, 200, entries) : json(res, 404, {});
      }
      if (!store.has(file) && req.method !== 'PUT') return json(res, 404, {});
      if (req.method === 'PUT') {
        // 422: the file exists but no sha was sent; 409: the sha is an older version (another device wrote in between).
        if (store.has(file) && !body.sha) return json(res, 422, {message: 'sha was not supplied'});
        if (store.has(file) && body.sha !== shaOf(store.get(file))) return json(res, 409, {message: 'is at a newer version'});
        put(ref, file, Buffer.from(body.content, 'base64'));
      }
      const data = store.get(file);
      // Like GitHub: the raw media type returns the file itself; JSON carries base64 content only up to 1 MB.
      if (req.method !== 'PUT' && /vnd\.github\.raw/.test(req.headers['x-mock-accept'] || '')) {
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}).end(data);
        return;
      }
      const large = data.length > (Number(process.env.UI_PREVIEW_INLINE_LIMIT) || 1024 * 1024);
      return json(res, 200, req.method === 'PUT' ? {content: {sha: shaOf(data)}} : {sha: shaOf(data), encoding: large ? 'none' : 'base64', content: large ? '' : data.toString('base64')});
    }
    // The site's own data/ folder (the last fallback) is the frozen fixture copy as well.
    const filename = pathname.startsWith('/data/') ? path.join(fixtures, path.basename(pathname)) : path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!(filename.startsWith(root + path.sep)) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
      res.writeHead(404).end('Not found'); return;
    }
    let content = fs.readFileSync(filename);
    if (filename.endsWith('sw.js') && swBump) content = Buffer.from(content.toString().replace(/const VERSION = '([^']+)'/, (m, v) => `const VERSION = '${v}-preview${swBump}'`));
    if (filename.endsWith('index.html')) {
      const html = content.toString();
      if ((html.match(/const GITHUB_TOKEN =[^\r\n]+/g) || []).length !== 1) throw new Error('Preview credential redaction failed');
      content = Buffer.from(html.replace(/const GITHUB_TOKEN =[^\r\n]+/, "const GITHUB_TOKEN = 'isolated-preview';").replace('<head>', '<head>' + injection));
    }
    const mime = {'.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.webmanifest':'application/manifest+json'};
    res.writeHead(200, {'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    res.end(content);
  } catch (error) {
    console.error('[preview request]', error.name, error.code || 'no-code');
    res.writeHead(500).end('Preview error');
  }
});
previewServer.on('error', error => { console.error('[preview listen]', error.code); process.exitCode = 1; });
previewServer.listen(port, '127.0.0.1', () => {
  console.log(`Isolated UI preview: http://127.0.0.1:${port}`);
  if (process.send) process.send({type: 'ready', port: previewServer.address().port});
});
