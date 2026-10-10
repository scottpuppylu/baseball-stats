// Local QA only: redact the credential and route all GitHub traffic into memory.
// No requests or writes are sent to GitHub; no data/*.json files are modified.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.UI_PREVIEW_PORT || 54321);
const stored = new Map();
for (const name of ['logs', 'games', 'avatars', 'tags', 'defense', 'guests']) {
  const filename = path.join(root, 'data', `${name}.json`);
  stored.set(`data/${name}.json`, fs.existsSync(filename) ? fs.readFileSync(filename) : Buffer.from('[]'));
}
const injection = `<script>
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
    const file = url.includes('/contents/') ? url.split('/contents/')[1].split('?')[0] : url.split('/main/')[1]?.split('?')[0];
    if (options.method === 'PUT') {
      window.__previewWrites.push(file);
      if (window.__previewFailWrites) return Promise.resolve(new Response('{}', {status: 500}));
    }
    const accept = (options.headers && (options.headers.Accept || options.headers.accept)) || '';
    return previewFetch('/__mock-api/' + file, {...options, headers: {'Content-Type': 'application/json', 'X-Mock-Accept': accept}});
  }
  return previewFetch(input, options);
};
</script>`;
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
    if (pathname.startsWith('/__mock-api/')) {
      const file = pathname.slice('/__mock-api/'.length);
      if (!stored.has(file)) { res.writeHead(404).end('{}'); return; }
      if (req.method === 'PUT') {
        let body = '';
        for await (const chunk of req) body += chunk;
        stored.set(file, Buffer.from(JSON.parse(body).content, 'base64'));
      }
      res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      const data = stored.get(file);
      // Like GitHub: the raw media type returns the file itself; JSON carries base64 content only up to 1 MB.
      if (req.method !== 'PUT' && /vnd\.github\.raw/.test(req.headers['x-mock-accept'] || '')) { res.end(data); return; }
      const large = data.length > (Number(process.env.UI_PREVIEW_INLINE_LIMIT) || 1024 * 1024);
      res.end(JSON.stringify(req.method === 'PUT' ? {content:{sha:'isolated-preview-sha'}} : {sha: 'isolated-preview-sha', encoding: large ? 'none' : 'base64', content: large ? '' : data.toString('base64')}));
      return;
    }
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
      res.writeHead(404).end('Not found'); return;
    }
    let content = fs.readFileSync(filename);
    if (filename.endsWith('index.html')) {
      content = Buffer.from(content.toString().replace(/const GITHUB_TOKEN =[^\r\n]+/, "const GITHUB_TOKEN = 'isolated-preview';").replace('<head>', '<head>' + injection));
    }
    const mime = {'.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp'};
    res.writeHead(200, {'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    res.end(content);
  } catch { res.writeHead(500).end('Preview error'); }
}).listen(port, '127.0.0.1', () => console.log(`Isolated UI preview: http://127.0.0.1:${port}`));
