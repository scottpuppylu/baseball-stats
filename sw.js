// Service worker for the installed website (PWA). Not used inside the Android app (pwa.js skips it there).
// Caches only this site's own versioned program files so the app opens offline. It never touches team data, sign-in or
// cloud traffic: every cross-origin request (GitHub, the secure API, Google) and data/*.json pass straight to the network.
const VERSION = '20261013-app1';
const CACHE = `tkaero-shell-${VERSION}`;
// Exactly the URLs index.html loads (with their ?v= versions); tests/pwa.test.cjs keeps this list in step with the page.
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'vendor/tailwindcss-play-3.4.17.js',
  'vendor/chart.umd-4.5.1.min.js',
  'app-config.js?v=20261013-app1',
  'cloud-sync.js?v=20261013-app1',
  'pwa.js?v=20261013-app1',
  'app-native.js?v=20261013-app1',
  'ui-comfort.css?v=20261013-app1',
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
const STATIC_EXT = /\.(?:js|css|png|webp|jpg|svg|woff2?|webmanifest)$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, {cache: 'reload'})))));
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
  if (url.origin !== self.location.origin) return; // GitHub, the secure API, Google sign-in: never cached
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (path.startsWith('data/') || path.startsWith('api/') || url.searchParams.has('auth_code')) return;

  if (request.mode === 'navigate') {
    // Newest page when online; the cached page when offline (it shows its own offline notice and cached data).
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok && (path === '' || path === 'index.html')) {
          const cache = await caches.open(CACHE);
          await cache.put('index.html', fresh.clone());
        }
        return fresh;
      } catch (error) {
        const cached = await caches.match('index.html', {cacheName: CACHE});
        return cached || new Response('<!doctype html><meta charset="utf-8"><title>離線</title><body style="background:#070a12;color:#e2e8f0;font-family:sans-serif;padding:24px">目前離線，且尚未儲存可離線開啟的版本。請連線後再開啟。</body>', {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
      }
    })());
    return;
  }

  if (!STATIC_EXT.test(url.pathname)) return;
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
