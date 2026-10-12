// Installed-app behaviour shared by the website, PWA and Android app: offline/online notice, PWA update prompt and
// install chip. The service worker is registered only for the website/PWA, never inside the Android app (its files are
// already on the phone, and a worker there would only get in the way of app updates).
(function () {
  'use strict';
  const isNativeApp = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  const standalone = () => isNativeApp || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  document.documentElement.classList.toggle('ui-standalone', standalone());
  if (isNativeApp) document.documentElement.classList.add('ui-native-app');

  function bar(id, html, tone) {
    let el = document.getElementById(id);
    if (!html) { if (el) el.remove(); return null; }
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.className = `ui-app-bar ui-app-bar-${tone}`;
    el.innerHTML = html;
    return el;
  }

  // ---------- offline notice ----------
  // Offline, the page shows the copy stored on this device; it says so, and cloud uploads report failure (cloud-sync.js).
  function showConnection() {
    if (navigator.onLine === false) {
      bar('uiOfflineBar', '<span>⚠️ 離線中：顯示本機暫存資料，可能不是最新；雲端同步暫停（新紀錄先存在這台裝置）。</span>', 'warn');
    } else if (document.getElementById('uiOfflineBar')) {
      const el = bar('uiOfflineBar', '<span>✓ 已恢復連線。</span><button type="button" data-act="refresh">重新整理數據</button>', 'ok');
      el.querySelector('[data-act="refresh"]').addEventListener('click', () => { bar('uiOfflineBar', null); if (typeof window.manualRefresh === 'function') window.manualRefresh(); });
      setTimeout(() => { if (navigator.onLine !== false) bar('uiOfflineBar', null); }, 12000);
    }
  }
  window.addEventListener('online', showConnection);
  window.addEventListener('offline', showConnection);

  // ---------- service worker (website / PWA only) ----------
  let updateAccepted = false;
  function offerUpdate(worker) {
    const el = bar('uiUpdateBar', '<span>🔄 有新版本可用。</span><button type="button" data-act="update">立即更新</button><button type="button" data-act="later" aria-label="稍後">稍後</button>', 'info');
    el.querySelector('[data-act="later"]').addEventListener('click', () => bar('uiUpdateBar', null));
    el.querySelector('[data-act="update"]').addEventListener('click', () => {
      // A game in progress is kept in this device's storage and restored after the reload.
      updateAccepted = true;
      worker.postMessage({type: 'SKIP_WAITING'});
    });
  }
  async function registerWorker() {
    if (isNativeApp || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    // Kill switch (app-config.js serviceWorker: false): removes the worker and its cache from every visitor on next load.
    if ((window.BASEBALL_APP_CONFIG || {}).serviceWorker === false) {
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      if (window.caches) for (const key of await caches.keys()) if (key.startsWith('tkaero-shell-')) await caches.delete(key);
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('sw.js', {scope: './'});
      const watch = worker => worker && worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => watch(registration.installing));
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Only after the person accepted an update; the very first install takes over without reloading the page.
        if (reloading || !updateAccepted) return;
        reloading = true;
        location.reload();
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}); });
      window.__pwaRegistration = registration;
    } catch (error) {
      console.warn('[pwa] service worker not registered', error && error.message);
    }
  }

  // ---------- install chip (Android Chrome / desktop) ----------
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installEvent = event;
    let dismissed = false;
    try { dismissed = localStorage.getItem('rebas_install_dismissed') === '1'; } catch (e) { /* storage unavailable */ }
    if (dismissed || standalone()) return;
    const el = bar('uiInstallBar', '<span>📲 可把「航太系壘」安裝到主畫面，像 App 一樣開啟。</span><button type="button" data-act="install">安裝</button><button type="button" data-act="close" aria-label="不要再顯示">✕</button>', 'info');
    el.querySelector('[data-act="install"]').addEventListener('click', async () => {
      bar('uiInstallBar', null);
      if (!installEvent) return;
      installEvent.prompt();
      await installEvent.userChoice.catch(() => null);
      installEvent = null;
    });
    el.querySelector('[data-act="close"]').addEventListener('click', () => {
      bar('uiInstallBar', null);
      try { localStorage.setItem('rebas_install_dismissed', '1'); } catch (e) { /* storage unavailable */ }
    });
  });
  window.addEventListener('appinstalled', () => bar('uiInstallBar', null));

  const start = () => { showConnection(); registerWorker(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
