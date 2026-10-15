// PWA shell only. Never cache GitHub/data/API responses or a copy of the accepted legacy credential.
const VERSION = '20261016-pwa1';
const CACHE = `tkaero-shell-${VERSION}`;
// Exactly the URLs index.html loads (with their ?v= versions); tests/pwa.test.cjs keeps this list in step with the page.
const SHELL = [
  'manifest.webmanifest',
  'vendor/tailwindcss-play-3.4.17.js',
  'vendor/chart.umd-4.5.1.min.js',
  'app-config.js?v=20261016-pwa1',
  'pwa.js?v=20261016-pwa1',
  'ui-comfort.css?v=20261016-pwa1',
  'ui-comfort.js?v=20261011-audit2',
  'team-insights.js?v=20261011-audit2',
  'lineup-model.js?v=20261010-pa3',
  'lineup-recommender.js?v=20261011-auditfixes',
  'player-diagnostics.js?v=20261010-diag3',
  'team-records.js?v=20261011-audit2',
  'assets/favicon-32.png',
  'assets/apple-touch-icon.png',
  'assets/logo-128.webp',
  'assets/logo-256.webp',
  'assets/logo-512.webp',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-192.png',
  'assets/icons/maskable-512.png'
];
// Fail closed if the credential declaration ever changes: do not persist an unrecognized HTML response.
// This removes the value completely; it does not claim the publicly served legacy credential is secret.
async function offlinePage(response) {
  const html = await response.text();
  const declaration = /const GITHUB_TOKEN = [^;\r\n]*;/g;
  if ((html.match(declaration) || []).length !== 1) throw new Error('Unrecognized offline shell; refused to cache');
  const sanitized = html.replace(declaration, "const GITHUB_TOKEN = ''; window.BASEBALL_OFFLINE_SHELL = true;");
  const headers = new Headers({'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
  return new Response(sanitized, {status: 200, headers});
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const page = await fetch(new URL('index.html', self.registration.scope), {cache: 'no-store'});
      if (!page.ok) throw new Error('Offline shell unavailable');
      const sanitized = await offlinePage(page);
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map(url => new Request(new URL(url, self.registration.scope), {cache: 'reload'})));
      await cache.put('index.html', sanitized);
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
  // Wait for the page to accept the update (pwa.js asks first), so a running scorebook is never swapped mid-entry.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('tkaero-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // GitHub: never intercepted or cached
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (path.startsWith('data/') || path.startsWith('api/') || url.searchParams.has('auth_code')) return;

  if (request.mode === 'navigate') {
    // Newest page when online; the cached page when offline (it shows its own offline notice and cached data).
    event.respondWith((async () => {
      try {
        // Keep the cached HTML paired with this worker's pre-cached assets. Never copy live HTML into CacheStorage.
        return await fetch(request);
      } catch (error) {
        const cached = await caches.match('index.html', {cacheName: CACHE});
        return cached || new Response('<!doctype html><meta charset="utf-8"><title>離線</title><body style="background:#070a12;color:#e2e8f0;font-family:sans-serif;padding:24px">目前離線，且尚未儲存可離線開啟的版本。請連線後再開啟。</body>', {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
      }
    })());
    return;
  }

  if (!SHELL.includes(path + url.search)) return;
  // Program files carry their version in the name or ?v=, so the exact URL in the cache is always the right copy.
  event.respondWith((async () => {
    const cached = await caches.match(request, {cacheName: CACHE});
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
