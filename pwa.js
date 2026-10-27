// Website/PWA: offline/online notice, opt-in updates and installation. No native app or login dependency.
(function () {
  'use strict';
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  document.documentElement.classList.toggle('ui-standalone', standalone());

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
  // Offline, the page shows this device's data. The offline HTML cache deliberately contains no credential.
  let connectionRecovered = false;
  function showConnection(event) {
    if (event && event.type === 'online') connectionRecovered = true;
    if (event && event.type === 'offline') connectionRecovered = false;
    // Network failure can serve the offline shell even while the browser still reports onLine=true.
    if (navigator.onLine === false || (window.BASEBALL_OFFLINE_SHELL && !connectionRecovered)) {
      const el = bar('uiOfflineBar', '<span>⚠️ 離線中：顯示本機暫存資料，可能不是最新；雲端同步暫停（新紀錄先存在這台裝置）。</span><button type="button" data-act="retry">重新整理數據</button>', 'warn');
      el.querySelector('[data-act="retry"]').addEventListener('click', () => location.reload());
    } else if (document.getElementById('uiOfflineBar')) {
      const el = bar('uiOfflineBar', '<span>✓ 已恢復連線。</span><button type="button" data-act="refresh">重新整理數據</button>', 'ok');
      el.querySelector('[data-act="refresh"]').addEventListener('click', () => {
        if (window.BASEBALL_OFFLINE_SHELL) location.reload();
        else { bar('uiOfflineBar', null); if (typeof window.manualRefresh === 'function') window.manualRefresh(); }
      });
      // Keep the reconnect action available when a credential-free offline shell needs a fresh online page.
      if (!window.BASEBALL_OFFLINE_SHELL) setTimeout(() => { if (navigator.onLine !== false) bar('uiOfflineBar', null); }, 12000);
    }
  }
  window.addEventListener('online', showConnection);
  window.addEventListener('offline', showConnection);

  // ---------- service worker (website / PWA only) ----------
  let updateAccepted = false;
  let dirty = false;
  let pendingWrites = 0;
  let waitingWorker = null;
  let deferredUntil = 0;
  document.addEventListener('input', event => { if (event.isTrusted && event.target.matches('input, textarea, select, [contenteditable]')) dirty = true; }, true);
  document.addEventListener('change', event => { if (event.isTrusted && event.target.matches('input, textarea, select')) dirty = true; }, true);
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const method = String(options?.method || input?.method || 'GET').toUpperCase();
    const write = !['GET', 'HEAD'].includes(method);
    if (write) pendingWrites++;
    try { return await originalFetch(input, options); } finally { if (write) pendingWrites--; }
  };
  function updateBlockReason() {
    try {
      const game = JSON.parse(localStorage.getItem('rebas_active_game') || 'null');
      if ((typeof activeGame !== 'undefined' && activeGame) || (game && game.status !== 'completed')) return '比賽場記進行中；請完成或結束場記後再更新。本機紀錄會保留。';
      localStorage.setItem('rebas_pwa_storage_probe', '1');
      localStorage.removeItem('rebas_pwa_storage_probe');
    } catch (_) { return '本機儲存無法確認，請先匯出備份；本次不重新整理。'; }
    const localState = window.LocalCache?.status();
    if (localState?.failed || localState?.pending) return '本機儲存尚未完成，請先匯出備份並重試保存。';
    if (window.SyncDrafts?.status().pending) return '尚有待同步草稿，請先同步或匯出備份；本次不重新整理。';
    if (pendingWrites) return '資料仍在儲存或同步，請稍後再試。';
    if (document.querySelector('[id$="Modal"]:not(.hidden):not([hidden])')) return '請先完成並關閉目前的編輯視窗。';
    if (dirty) return '尚有編輯操作；請完成儲存，再確認更新。';
    return '';
  }
  function blockedUpdate(reason) {
    const el = bar('uiUpdateBar', '<span></span><button type="button" data-act="retry">重新檢查</button><button type="button" data-act="saved">已完成並儲存編輯</button><button type="button" data-act="later">稍後</button>', 'warn');
    el.querySelector('span').textContent = reason;
    el.querySelector('[data-act="retry"]').onclick = () => offerUpdate(waitingWorker);
    el.querySelector('[data-act="saved"]').onclick = () => { dirty = false; offerUpdate(waitingWorker); };
    el.querySelector('[data-act="later"]').onclick = () => { deferredUntil = Date.now() + 300000; bar('uiUpdateBar', null); };
  }
  window.BASEBALL_PWA_STATUS = () => ({version: document.querySelector('meta[name="baseball-release"]')?.content || 'legacy', updateBlocked: updateBlockReason(), pendingWrites});
  function offerUpdate(worker) {
    if (!worker) return;
    waitingWorker = worker;
    const el = bar('uiUpdateBar', '<span>🔄 新版本已完整下載。儲存目前操作後可更新；也可稍後再更新。</span><button type="button" data-act="update">立即更新</button><button type="button" data-act="later" aria-label="稍後">稍後</button>', 'info');
    el.querySelector('[data-act="later"]').addEventListener('click', () => { deferredUntil = Date.now() + 300000; bar('uiUpdateBar', null); });
    el.querySelector('[data-act="update"]').addEventListener('click', () => {
      const reason = updateBlockReason();
      if (reason) return blockedUpdate(reason);
      updateAccepted = true;
      worker.postMessage({type: 'ACTIVATE_RELEASE'});
    });
  }
  async function registerWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    // Kill switch (app-config.js serviceWorker: false): removes the worker and its cache from every visitor on next load.
    if ((window.BASEBALL_APP_CONFIG || {}).serviceWorker === false) {
      const scope = new URL('./', location.href).href;
      for (const registration of await navigator.serviceWorker.getRegistrations()) if (registration.scope === scope) await registration.unregister();
      if (window.caches) for (const key of await caches.keys()) if (key.startsWith('tkaero-shell-')) await caches.delete(key);
      window.BASEBALL_PWA_DISABLED = true;
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('sw.js', {scope: './', updateViaCache: 'none'});
      const watch = worker => worker && worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) { bar('uiUpdateErrorBar', null); offerUpdate(worker); }
        if (worker.state === 'redundant') {
          const el = bar('uiUpdateErrorBar', '<span>更新未完整下載或驗證失敗，已保留原版本與本機資料。</span><button type="button">重試檢查</button>', 'warn');
          el.querySelector('button').onclick = () => { bar('uiUpdateErrorBar', null); registration.update().catch(() => {}); };
        }
      });
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => watch(registration.installing));
      let reloading = false;
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'CHECK_UPDATE_SAFETY') event.ports[0]?.postMessage({safe: !updateBlockReason()});
        if (event.data?.type === 'RELEASE_BLOCKED') { updateAccepted = false; blockedUpdate('另一個分頁仍在編輯、場記或沒有回應。請先儲存並關閉其他分頁，再重試。'); }
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Only after the person accepted an update; the very first install takes over without reloading the page.
        if (reloading || !updateAccepted) return;
        if (updateBlockReason()) { updateAccepted = false; blockedUpdate('更新已就緒，但目前仍有操作；保留此頁，儲存後重開即可使用新版。'); return; }
        reloading = true;
        location.reload();
      });
      let lastCheck = 0;
      const check = () => {
        if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
        if (registration.waiting && Date.now() >= deferredUntil) offerUpdate(registration.waiting);
        if (Date.now() - lastCheck < 15000) return;
        lastCheck = Date.now(); registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', check);
      window.addEventListener('pageshow', check);
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
      setInterval(check, 60000);
      check();
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

  const start = () => {
    showConnection(); registerWorker();
    // Safari does not emit beforeinstallprompt. Keep its instructions reachable without login or configuration.
    const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
    if (apple && !standalone()) {
      const link = document.createElement('a'); link.href = 'docs/PWA_GUIDE.md';
      link.textContent = 'Apple 安裝方式'; link.className = 'ui-apple-install';
      link.onclick = event => {
        event.preventDefault();
        const el = bar('uiInstallBar', '<span>iPhone／iPad：Safari「分享」→「加入主畫面」。Mac（macOS 14+）：Safari「檔案」→「加入 Dock」。一般網站也可完整使用。主畫面與 Safari 的本機資料可能分開；未同步場記請回原開啟方式繼續。</span><button type="button" data-act="close">關閉</button>', 'info');
        el.querySelector('button').onclick = () => bar('uiInstallBar', null);
      };
      document.getElementById('appWorkspace')?.prepend(link);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
