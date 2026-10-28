// Local copy of the large cloud files (games, logs, avatars) without localStorage's ~2.6M-character limit on iPhone.
// IndexedDB holds every value. localStorage keeps a mirror while it fits, so the page's synchronous startup render
// works exactly as before; when a value no longer fits, the page re-renders from IndexedDB a few milliseconds after
// opening. Values are the same JSON strings the page always stored.
//
// A save counts as done only when it is durable: written to localStorage, or confirmed by a completed IndexedDB
// transaction. A failed IndexedDB write keeps the newest value queued, retries, and reports the failure
// (`localcache:status` event, status()), so the page can warn and offer a backup instead of losing data silently.
(function(root) {
  'use strict';
  const KEYS = ['rebas_all_games', 'rebas_logs', 'rebas_player_avatars', 'rebas_pending_sync']; // the last: unsent edits (index.html)
  const IDB_ONLY = 'rebas_cache_idb_only'; // set once this device outgrew localStorage
  const DB_NAME = 'rebas-cache', STORE = 'kv', OPEN_TIMEOUT_MS = 1500;
  const RETRY_MS = [2000, 5000, 15000, 30000];
  const big = key => KEYS.includes(key);
  const mem = new Map();
  const ls = {
    get(key) { try { return root.localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { root.localStorage.setItem(key, value); return true; } catch (_) { return false; } },
    remove(key) { try { root.localStorage.removeItem(key); } catch (_) { /* storage unavailable */ } }
  };
  // Once a value outgrows localStorage, this device keeps all three large values in IndexedDB only, so the space stays
  // free for small keys such as the live game and the mirrors do not keep refilling it.
  let idbOnly = ls.get(IDB_ONLY) === '1';
  let switchToIdbOnly = false; // requested by a full localStorage; done once IndexedDB has confirmed every value
  // A mirror present at startup means the synchronous startup code read complete data, so its writes are real.
  // Without one, startup writes are derived from missing data and must not overwrite what IndexedDB holds.
  const hadMirror = new Set(idbOnly ? [] : KEYS.filter(key => ls.get(key) !== null));
  const queue = new Map();    // key -> value waiting for IndexedDB, or null to delete
  const inMirror = new Set(); // keys whose newest value is in the localStorage mirror
  const acked = new Set();    // keys whose newest value IndexedDB has confirmed
  const waiters = new Map();  // key -> resolve functions of whenPersisted()
  let db = null, hydrated = false, flushTimer = null, retryTimer = null, attempts = 0;
  let errored = false, lastError = '';
  const isDurable = key => inMirror.has(key) || acked.has(key);
  // Failed = a write went wrong and some newest value is still only in memory (a reload would lose it).
  const isFailed = () => errored && KEYS.some(key => mem.has(key) && !isDurable(key));

  function notify() {
    try { root.dispatchEvent(new root.CustomEvent('localcache:status', {detail: status()})); } catch (_) { /* no DOM */ }
  }
  function settle(key, ok) {
    const list = waiters.get(key);
    if (!list) return;
    waiters.delete(key);
    list.forEach(resolve => resolve(ok));
  }
  function markAcked(key) {
    acked.add(key);
    settle(key, true);
  }

  function flush() {
    flushTimer = null;
    if (!db || !queue.size) return;
    const writes = [...queue];
    queue.clear();
    const restore = error => {
      // Put back what failed unless a newer value was queued meanwhile, then retry later.
      for (const [key, value] of writes) if (!queue.has(key)) queue.set(key, value);
      errored = true;
      lastError = String(error && (error.name || error.message) || error || 'IndexedDB write failed');
      writes.forEach(([key]) => { if (!isDurable(key)) settle(key, false); });
      console.warn('[local-cache] IndexedDB write failed', error);
      scheduleRetry();
      notify();
    };
    try {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
      for (const [key, value] of writes) value === null ? store.delete(key) : store.put(value, key);
      tx.oncomplete = () => {
        for (const [key] of writes) if (!queue.has(key)) markAcked(key);
        if (!queue.size) {
          attempts = 0;
          errored = false;
          lastError = '';
          if (switchToIdbOnly) finishIdbOnlySwitch();
        }
        notify();
      };
      tx.onerror = tx.onabort = () => restore(tx.error);
    } catch (error) { restore(error); }
  }
  function scheduleRetry() {
    if (retryTimer) return;
    const delay = RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)];
    attempts++;
    retryTimer = setTimeout(() => { retryTimer = null; flush(); }, delay);
  }
  function persist(key, value) {
    queue.set(key, value);
    if (db && !flushTimer && !retryTimer) flushTimer = setTimeout(flush, 0);
  }
  // Writes the localStorage mirror. Returns true when that alone made the value durable.
  function mirror(key, value) {
    if (idbOnly) return false;
    if (ls.set(key, value)) return true;
    // Full. The old mirror is now outdated and must not be read at the next start, so it goes; the other mirrors stay
    // until IndexedDB has confirmed every value (only then does the device switch to IndexedDB-only).
    ls.remove(key);
    if (db) switchToIdbOnly = true;
    return false;
  }
  function finishIdbOnlySwitch() {
    switchToIdbOnly = false;
    idbOnly = true;
    inMirror.clear(); // every value is confirmed in IndexedDB at this point
    for (const k of KEYS) ls.remove(k);
    ls.set(IDB_ONLY, '1');
  }

  function get(key) {
    if (!big(key)) return ls.get(key);
    if (mem.has(key)) return mem.get(key);
    return hydrated || idbOnly ? null : ls.get(key);
  }
  // Returns true when the value is already durable; false when it is only in memory so far (IndexedDB pending or
  // failed). Use whenPersisted(key) to wait for the outcome.
  function set(key, value) {
    value = String(value);
    if (!big(key)) return ls.set(key, value);
    mem.set(key, value);
    acked.delete(key);
    if (!hydrated && !hadMirror.has(key)) return false; // startup value built without the cached data; hydration replaces it
    const mirrored = mirror(key, value);
    if (mirrored) { inMirror.add(key); settle(key, true); } else inMirror.delete(key);
    if (db || !hydrated) persist(key, value); // before hydration, ready() decides whether IndexedDB needs it
    else if (!mirrored) { errored = true; lastError = 'QuotaExceededError'; settle(key, false); } // no IndexedDB and no room
    notify();
    return mirrored;
  }
  function remove(key) {
    if (!big(key)) return ls.remove(key);
    mem.delete(key);
    inMirror.delete(key);
    acked.delete(key);
    ls.remove(key);
    persist(key, null);
  }
  function whenPersisted(key) {
    if (!big(key) || !mem.has(key) || isDurable(key)) return Promise.resolve(true);
    return new Promise(resolve => {
      if (!waiters.has(key)) waiters.set(key, []);
      waiters.get(key).push(resolve);
    });
  }
  function status() {
    return {failed: isFailed(), lastError, pending: queue.size, indexedDB: !!db, idbOnly};
  }
  // Manual retry (the warning's button): write any value that is only in memory to localStorage if there is room again
  // (also when IndexedDB is unavailable), and flush IndexedDB now instead of waiting for the next backoff step.
  function retry() {
    if (!idbOnly) {
      for (const key of KEYS) {
        if (mem.has(key) && !isDurable(key) && ls.set(key, mem.get(key))) { inMirror.add(key); settle(key, true); }
      }
    }
    if (!isFailed()) { errored = false; lastError = ''; }
    clearTimeout(retryTimer);
    retryTimer = null;
    flush();
    notify();
  }

  function open() {
    return new Promise(resolve => {
      let done = false;
      const finish = value => { if (!done) { done = true; resolve(value); } };
      setTimeout(() => finish(null), OPEN_TIMEOUT_MS); // some iOS versions never answer indexedDB.open
      try {
        const request = root.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => { if (done) request.result.close(); else finish(request.result); };
        request.onerror = request.onblocked = () => finish(null);
      } catch (_) { finish(null); }
    });
  }
  function readAll(database) {
    return new Promise(resolve => {
      const out = {};
      try {
        const tx = database.transaction(STORE, 'readonly'), store = tx.objectStore(STORE);
        for (const key of KEYS) store.get(key).onsuccess = event => { if (typeof event.target.result === 'string') out[key] = event.target.result; };
        tx.oncomplete = () => resolve(out);
        tx.onerror = tx.onabort = () => resolve(out);
      } catch (_) { resolve(out); }
    });
  }

  // Resolves with {changed}: true when IndexedDB supplied data the synchronous startup could not read.
  const ready = (async () => {
    const database = await open();
    const stored = database ? await readAll(database) : {};
    let changed = false;
    for (const key of KEYS) {
      if (hadMirror.has(key)) {
        // localStorage is written first, so its mirror is the newest copy; keep any value written since startup.
        const value = mem.has(key) ? mem.get(key) : ls.get(key);
        if (value !== null) {
          mem.set(key, value);
          if (!idbOnly && ls.get(key) === value) inMirror.add(key);
          if (stored[key] !== value) queue.set(key, value); else acked.add(key);
        }
      } else if (stored[key] !== undefined) {
        mem.set(key, stored[key]);
        acked.add(key);
        changed = true;
      } else mem.delete(key);
    }
    if (idbOnly && database) for (const key of KEYS) ls.remove(key); // leftovers, e.g. from an older cached version
    if (idbOnly && !database) { idbOnly = false; ls.remove(IDB_ONLY); } // IndexedDB gone: fall back to localStorage
    db = database;
    hydrated = true;
    if (db) flush();
    else queue.clear(); // without IndexedDB the localStorage mirror is the only copy, as before
    // Ask the browser not to evict this site's storage under pressure (no prompt in Chrome; ignored elsewhere).
    try { root.navigator?.storage?.persist?.(); } catch (_) { /* unsupported */ }
    notify();
    return {changed, indexedDB: !!db};
  })();

  root.LocalCache = {KEYS, get, set, remove, ready, whenPersisted, status, retry, isHydrated: () => hydrated};
})(typeof window !== 'undefined' ? window : globalThis);
