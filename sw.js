// Filled automatically from file contents by scripts/build-pwa.cjs. No credential is embedded here.
const RELEASE = null; // generated-release
const VERSION = RELEASE && RELEASE.version;
const CACHE = `tkaero-shell-${VERSION}`;
let disabled = false;
const scope = () => new URL(self.registration.scope);
const absolute = file => new URL(file, scope()).href;
const declaration = /const GITHUB_TOKEN = [^;\r\n]*;/g;
async function offlinePage(response) {
  const html = await response.text();
  if ((html.match(declaration) || []).length !== 1) throw new Error('Unrecognized offline shell; refused to cache');
  return new Response(html.replace(declaration, "const GITHUB_TOKEN = ''; window.BASEBALL_OFFLINE_SHELL = true;"), {
    headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}
  });
}
async function verified(response, hash) {
  if (!response.ok || response.type === 'opaque') throw new Error('Release resource unavailable');
  const bytes = await response.clone().arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== hash) throw new Error('Release resource integrity mismatch');
  return response;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!RELEASE) throw new Error('Release must be built before deployment');
    try {
      const cache = await caches.open(CACHE);
      for (const entry of RELEASE.files) {
        const response = await verified(await fetch(absolute(entry.url), {cache: 'no-store'}), entry.sha256);
        await cache.put(absolute(entry.url), entry.file === 'index.html' ? await offlinePage(response) : response);
      }
      await cache.put(absolute('__complete'), new Response(VERSION));
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (!key.startsWith('tkaero-shell-') || key === CACHE) continue;
      const complete = await (await caches.open(key)).match(absolute('__complete'));
      // Another installer can be downloading while this waiting release is accepted. Do not erase its staging cache.
      if (complete || !/^tkaero-shell-[a-f0-9]{24}$/.test(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
// Legacy clients lack the operation guard: close/reopen them after saving; never honor unguarded SKIP_WAITING.
self.addEventListener('message', event => {
  if (event.data?.type !== 'ACTIVATE_RELEASE' || !event.source) return;
  event.waitUntil((async () => {
    const clients = (await self.clients.matchAll({type: 'window', includeUncontrolled: true})).filter(client => client.url.startsWith(scope().href));
    const states = await Promise.all(clients.map(client => new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 3000);
      channel.port1.onmessage = answer => { clearTimeout(timer); channel.port1.close(); resolve(answer.data?.safe === true); };
      client.postMessage({type: 'CHECK_UPDATE_SAFETY'}, [channel.port2]);
    })));
    if (states.length && states.every(Boolean)) {
      event.source.postMessage({type: 'RELEASE_ACTIVATING'});
      await self.skipWaiting();
    } else event.source.postMessage({type: 'RELEASE_BLOCKED'});
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !RELEASE) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scope().pathname)) return;
  const file = url.pathname.slice(scope().pathname.length);
  if (file.startsWith('data/') || file.startsWith('api/') || url.searchParams.has('auth_code')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const config = await fetch(absolute('app-config.js'), {cache: 'no-store'});
        if (config.ok && /^\s*serviceWorker:\s*false\b/m.test(await config.text())) {
          disabled = true;
          await (await caches.open(CACHE)).put(absolute('__pwa_disabled'), new Response('1'));
          return fetch(request, {cache: 'no-store'});
        }
      } catch (_) { /* keep installed snapshot */ }
      const cached = await (await caches.open(CACHE)).match(absolute('index.html'));
      if (!cached) return new Response('離線版本不完整，請連線後重新開啟。', {status: 503});
      // Restore only the original public declaration, in memory. Never cache the live page or credential.
      // HTML/JS/CSS always come from this worker's complete verified snapshot, even during a new deployment.
      try {
        const live = await fetch(absolute('index.html'), {cache: 'no-store'});
        if (!live.ok) throw new Error('offline');
        const matches = (await live.text()).match(declaration);
        if (matches?.length !== 1) throw new Error('Unrecognized live page');
        const html = (await cached.text()).replace("const GITHUB_TOKEN = ''; window.BASEBALL_OFFLINE_SHELL = true;", () => matches[0]);
        return new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
      } catch (_) { return cached; }
    })());
    return;
  }
  const entry = RELEASE.files.find(entry => entry.file === file && entry.file !== 'index.html');
  if (!entry) return;
  event.respondWith((async () => {
    // A deployed kill switch must also bypass old resource hashes, including after worker process eviction.
    if (disabled || await (await caches.open(CACHE)).match(absolute('__pwa_disabled'))) return fetch(request, {cache: 'no-store'});
    // Fail closed rather than silently substituting new JS for a still-open old document.
    if (url.searchParams.has('v') && url.searchParams.get('v') !== new URL(entry.url, scope()).searchParams.get('v')) return new Response('此分頁版本已更新，請儲存後重新開啟。', {status: 409});
    return await (await caches.open(CACHE)).match(absolute(entry.url)) || new Response('程式快取不完整，請連線後重開。', {status: 503});
  })());
});
