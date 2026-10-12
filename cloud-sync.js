// Cloud data adapter shared by the website, the installed PWA and the Android app.
// Reads: the secure API when configured (it returns the version sha the multi-device merge needs), otherwise the
// public GitHub copy, exactly as before. Writes: only through the secure API with a signed, per-person session.
// No GitHub credential exists anywhere in the browser or the APK; the API holds it server side.
(function () {
  'use strict';
  const config = window.BASEBALL_APP_CONFIG || {};
  const apiBase = String(config.apiBase || '').replace(/\/+$/, '');
  const SESSION_KEY = 'rebas_cloud_session';
  const PKCE_KEY = 'rebas_cloud_login';
  const APP_RETURN_URL = 'io.github.scottpuppylu.baseballstats://auth';
  const FILE_RE = /^data\/(logs|games|avatars|tags|defense|guests)\.json$/;

  const isNativeApp = () => Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ } }
  };
  const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sha256 = async text => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));

  function session() {
    const s = store.get(SESSION_KEY);
    if (!s || !s.token || !(s.expiresAt > Date.now() + 30000)) return null;
    return s;
  }
  function webReturnUrl() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => { try { fn(state()); } catch (e) { /* listener error */ } });
  function state() {
    const s = session();
    return {enabled: Boolean(apiBase), signedIn: Boolean(s), user: s ? s.user : null, native: isNativeApp(), online: navigator.onLine !== false};
  }

  async function timed(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, {...options, signal: controller.signal, cache: 'no-store'}); }
    finally { clearTimeout(timer); }
  }

  // ---------- data ----------
  async function readFile(filePath, timeoutMs) {
    if (navigator.onLine === false && FILE_RE.test(filePath)) {
      // Said plainly instead of a raw network error; loading falls back to this device's copy.
      throw Object.assign(new Error('目前離線，資料已保存在本機，恢復連線後請再同步'), {offline: true});
    }
    if (!apiBase || !FILE_RE.test(filePath)) return null; // caller uses the public GitHub copy
    const res = await timed(`${apiBase}/api/data/${filePath.slice(5)}`, {headers: {Accept: 'application/json'}}, timeoutMs);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    return {content: body.content, sha: body.sha};
  }

  // Returns the fetch Response (the caller handles 409 by re-reading and merging). Throws with a clear Chinese message
  // when writing is impossible, so the page keeps its local copy and reports the upload as not done.
  async function writeFile(filePath, data, sha, message, timeoutMs) {
    if (!FILE_RE.test(filePath)) throw new Error('不允許寫入此檔案');
    if (!apiBase) throw new Error('雲端寫入尚未啟用（安全後端未設定）；資料已保存在本機');
    if (navigator.onLine === false) throw new Error('目前離線，資料已保存在本機，恢復連線後請再同步');
    const s = session();
    if (!s) { highlightLogin(); throw new Error('請先按右上角「登入編輯」；資料已保存在本機'); }
    let res;
    try {
      res = await timed(`${apiBase}/api/data/${filePath.slice(5)}`, {
        method: 'PUT',
        headers: {'Authorization': `Bearer ${s.token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({content: data, sha: sha || null, message})
      }, timeoutMs);
    } catch (e) {
      // Unknown outcome is reported as a failure; the page keeps its local copy and the next upload re-reads and merges.
      if (e && e.name === 'AbortError') throw new Error(`網路逾時（${Math.round(timeoutMs / 1000)} 秒），請稍後重試`);
      throw new Error('網路連線失敗，資料已保存在本機，請稍後重試');
    }
    if (res.status === 401) { store.remove(SESSION_KEY); notify(); highlightLogin(); }
    return res;
  }

  // ---------- sign in ----------
  async function login() {
    if (!apiBase) { window.showToast && showToast('安全後端尚未設定，暫時無法登入編輯', 'error'); return; }
    if (navigator.onLine === false) { window.showToast && showToast('目前離線，無法登入', 'error'); return; }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const returnTo = isNativeApp() ? APP_RETURN_URL : webReturnUrl();
    store.set(PKCE_KEY, {verifier, returnTo, at: Date.now()});
    const url = `${apiBase}/api/auth/login?${new URLSearchParams({return_to: returnTo, challenge: await sha256(verifier)})}`;
    if (isNativeApp()) {
      // System browser (Custom Tab): Google does not allow sign-in inside an embedded WebView.
      await window.Capacitor.registerPlugin('Browser').open({url});
    } else {
      location.assign(url);
    }
  }
  function logout() {
    store.remove(SESSION_KEY);
    notify();
    window.showToast && showToast('已登出編輯帳號；可繼續瀏覽數據');
  }
  async function completeLogin(fragment) {
    const params = new URLSearchParams(fragment.replace(/^#/, ''));
    const code = params.get('auth_code'), error = params.get('auth_error');
    if (!code && !error) return false;
    const pending = store.get(PKCE_KEY);
    store.remove(PKCE_KEY);
    const say = (text, type) => { const show = () => window.showToast ? showToast(text, type) : null; document.readyState === 'complete' ? show() : window.addEventListener('load', () => setTimeout(show, 300)); };
    if (error) {
      say({not_allowed: '此 Google 帳號沒有編輯權限，請聯絡管理員', unverified: 'Google 帳號 Email 未驗證', cancelled: '已取消登入'}[error] || '登入失敗，請重試', 'error');
      return true;
    }
    if (!pending || Date.now() - pending.at > 10 * 60 * 1000) { say('登入已逾時，請重新登入', 'error'); return true; }
    try {
      const res = await timed(`${apiBase}/api/auth/exchange`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code, verifier: pending.verifier})}, 15000);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      store.set(SESSION_KEY, {token: body.token, expiresAt: body.expiresAt, user: body.user});
      notify();
      say(`已登入：${body.user.name}（${body.user.role === 'admin' ? '管理員' : '編輯者'}）`);
    } catch (e) {
      say(`登入失敗：${e.message}`, 'error');
    }
    return true;
  }

  // ---------- header control ----------
  let button;
  function highlightLogin() {
    if (!button) return;
    button.classList.add('ui-cloud-auth-attention');
    setTimeout(() => button && button.classList.remove('ui-cloud-auth-attention'), 2400);
  }
  function render() {
    if (!button) return;
    const s = state();
    button.hidden = !s.enabled;
    button.dataset.state = s.signedIn ? 'in' : 'out';
    // Phones and tablets show only the icon (the header row is tight); desktops show the name or the action.
    const short = document.createElement('span'), long = document.createElement('span');
    short.className = 'lg:hidden';
    long.className = 'hidden lg:inline';
    short.textContent = s.signedIn ? '✓' : '🔐';
    long.textContent = s.signedIn ? `✓ ${s.user.name}` : '🔐 登入編輯';
    button.replaceChildren(short, long);
    button.setAttribute('aria-label', s.signedIn ? `已登入：${s.user.name}` : '登入編輯');
    button.title = s.signedIn ? `已登入（${s.user.role === 'admin' ? '管理員' : '編輯者'}）· 點擊登出` : '以 Google 帳號登入後才能寫入雲端';
  }
  function mountButton() {
    const badge = document.getElementById('syncStatusBadge');
    if (!badge || document.getElementById('uiCloudAuthBtn')) return;
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'uiCloudAuthBtn';
    button.className = 'ui-cloud-auth bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 text-[11px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg transition font-medium whitespace-nowrap';
    button.addEventListener('click', () => {
      if (session()) { if (confirm('要登出編輯帳號嗎？（本機資料不受影響）')) logout(); }
      else login();
    });
    badge.insertAdjacentElement('afterend', button);
    render();
  }
  listeners.add(render);

  // Android app: the login comes back through the app link.
  if (isNativeApp()) {
    try {
      window.Capacitor.registerPlugin('App').addListener('appUrlOpen', async event => {
        if (!String(event.url || '').startsWith(APP_RETURN_URL)) return;
        try { await window.Capacitor.registerPlugin('Browser').close(); } catch (e) { /* already closed */ }
        await completeLogin(String(event.url).split('#')[1] || '');
      });
    } catch (e) { /* plugin unavailable */ }
  }
  // Website / PWA: the login comes back as a URL fragment (never sent to any server); remove it at once.
  if (/[#&](auth_code|auth_error)=/.test(location.hash)) {
    const fragment = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    completeLogin(fragment);
  }
  window.addEventListener('storage', event => { if (event.key === SESSION_KEY) notify(); });
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton); else mountButton();

  window.cloudApi = Object.freeze({enabled: Boolean(apiBase), readFile, writeFile, login, logout, state, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); }});
})();
