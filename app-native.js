// Android app only (Capacitor). Does nothing on the website or PWA.
// - System back button: closes the top dialog or drawer first, then returns to the previous page, and never quits in a
//   way that loses a game in progress (the game is already kept in this phone's storage; back at the start only
//   sends the app to the background).
// - Files: CSV / JSON backups and post-game images are saved through the Android share sheet (save to Files, Drive,
//   LINE …), because an Android WebView cannot download blob: links. Photo picking for avatars already works through
//   Capacitor's file chooser.
// - Version: shows the installed app version beside the site version.
(function () {
  'use strict';
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
  const App = cap.registerPlugin('App');
  const Filesystem = cap.registerPlugin('Filesystem');
  const Share = cap.registerPlugin('Share');
  const toast = (text, type) => { if (typeof window.showToast === 'function') window.showToast(text, type); };

  // ---------- back button ----------
  const MODALS = ['cropModal', 'pitcherChangeModal', 'substituteModal', 'guestModal', 'defenseModal'];
  function topOverlay() {
    if (document.body.classList.contains('ui-nav-open')) return 'drawer';
    for (const id of ['uiFormDialog', 'insightImageModal']) if (document.getElementById(id)) return id;
    for (const id of MODALS) { const el = document.getElementById(id); if (el && !el.classList.contains('hidden')) return id; }
    // Any other full-screen dialog the pages add later (fixed, covering the screen, shown).
    const generic = [...document.querySelectorAll('.fixed.inset-0')].reverse().find(el => !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none' && el.offsetWidth > 0);
    return generic || null;
  }
  function closeTop() {
    const before = topOverlay();
    if (!before) return false;
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    if (topOverlay() !== before) return true;
    // No Escape handler: use the dialog's own close button.
    const root = typeof before === 'string' ? (before === 'drawer' ? null : document.getElementById(before)) : before;
    const close = root && root.querySelector('[aria-label="關閉"], [data-insight="close"], button[onclick*="close" i], button[onclick*="cancel" i]');
    if (close) { close.click(); return true; }
    return false;
  }

  const tabHistory = [];
  function trackTabs() {
    const original = window.switchMainTab;
    if (typeof original !== 'function' || original.__appTracked) return;
    const tracked = function (tab, ...rest) {
      const current = document.querySelector('[id^="panel"]:not(.hidden)');
      const from = current ? `tab${current.id.slice(5)}` : null;
      if (!tracked.__goingBack && from && from !== tab) tabHistory.push(from);
      if (tabHistory.length > 30) tabHistory.shift();
      return original.call(this, tab, ...rest);
    };
    tracked.__appTracked = true;
    window.switchMainTab = tracked;
  }
  function goBackTab() {
    const tab = tabHistory.pop();
    if (!tab || typeof window.switchMainTab !== 'function') return false;
    window.switchMainTab.__goingBack = true;
    try { window.switchMainTab(tab); } finally { window.switchMainTab.__goingBack = false; }
    return true;
  }

  App.addListener('backButton', () => {
    if (closeTop()) return;
    if (goBackTab()) return;
    let inGame = false;
    try { inGame = Boolean(JSON.parse(localStorage.getItem('rebas_active_game'))); } catch (e) { /* unreadable */ }
    if (inGame) toast('比賽記錄中：已保存在這台手機，回到 App 會接著記錄');
    App.minimizeApp();
  });

  // ---------- files: save / share ----------
  const safeName = name => String(name || 'export').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  async function blobToBase64(blob) {
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  async function saveAndShare(blob, filename, title) {
    const name = safeName(filename);
    const written = await Filesystem.writeFile({path: `exports/${Date.now()}_${name}`, data: await blobToBase64(blob), directory: 'CACHE', recursive: true});
    await Share.share({title: title || name, files: [written.uri], dialogTitle: '儲存或分享檔案'});
  }
  window.appSaveFile = saveAndShare;

  // Programmatic <a download> clicks (CSV, full backup, post-game image) become a native save/share.
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || '';
    if (this.hasAttribute('download') && /^(blob:|data:)/.test(href)) {
      const filename = this.getAttribute('download') || 'export';
      fetch(href).then(r => r.blob()).then(blob => saveAndShare(blob, filename)).catch(error => {
        if (!/cancel/i.test(String(error && error.message))) toast(`檔案儲存失敗：${error && error.message ? error.message : error}`, 'error');
      });
      return;
    }
    return nativeClick.call(this);
  };
  // Links tapped by the user (same rule).
  document.addEventListener('click', event => {
    const a = event.target.closest && event.target.closest('a[download]');
    if (!a || !/^(blob:|data:)/.test(a.href)) return;
    event.preventDefault();
    a.click();
  }, true);

  // Web Share with files (post-game image → LINE) through the native share sheet.
  navigator.canShare = data => Boolean(data && (data.files || data.text || data.url || data.title));
  navigator.share = async data => {
    const files = Array.from((data && data.files) || []);
    if (!files.length) return Share.share({title: data.title, text: data.text, url: data.url, dialogTitle: '分享'});
    const uris = [];
    for (const file of files) {
      const written = await Filesystem.writeFile({path: `exports/${Date.now()}_${safeName(file.name)}`, data: await blobToBase64(file), directory: 'CACHE', recursive: true});
      uris.push(written.uri);
    }
    return Share.share({title: data.title, text: data.text, files: uris, dialogTitle: '分享'});
  };

  // ---------- connection ----------
  // Android WebView does not update navigator.onLine by itself; mirror the phone's real connection so the offline
  // notice (pwa.js) and the upload guard (cloud-sync.js) behave exactly as on the website.
  const Network = cap.registerPlugin('Network');
  let connected = true;
  try { Object.defineProperty(Navigator.prototype, 'onLine', {configurable: true, get: () => connected}); } catch (e) { /* keep the browser value */ }
  const applyStatus = status => {
    const now = Boolean(status && status.connected);
    if (now === connected) return;
    connected = now;
    window.dispatchEvent(new Event(now ? 'online' : 'offline'));
  };
  Network.getStatus().then(applyStatus).catch(() => {});
  Network.addListener('networkStatusChange', applyStatus);

  // ---------- version ----------
  async function showVersion() {
    try {
      const info = await App.getInfo();
      const badge = [...document.querySelectorAll('#appHeader span')].find(el => /^v\d{6}\.\d{4}$/.test(el.textContent.trim()));
      if (badge) { badge.title = `Android App ${info.version} (${info.build})`; badge.textContent = `${badge.textContent.trim()} · App ${info.version}`; }
    } catch (e) { /* not critical */ }
  }

  const start = () => { trackTabs(); showVersion(); };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
