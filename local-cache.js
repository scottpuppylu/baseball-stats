// Local copy of the large cloud files (games, logs, avatars) without localStorage's ~2.6M-character limit on iPhone.
// IndexedDB holds every value. localStorage keeps a mirror while it fits, so the page's synchronous startup render
// works exactly as before; when a value no longer fits, its mirror is dropped and the page re-renders from IndexedDB
// a few milliseconds after opening. Values are the same JSON strings the page always stored.
(function(root) {
  'use strict';
  const KEYS = ['rebas_all_games', 'rebas_logs', 'rebas_player_avatars'];
  const IDB_ONLY = 'rebas_cache_idb_only'; // set once this device outgrew localStorage
  const DB_NAME = 'rebas-cache', STORE = 'kv', OPEN_TIMEOUT_MS = 1500;
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
  // A mirror present at startup means the synchronous startup code read complete data, so its writes are real.
  // Without one, startup writes are derived from missing data and must not overwrite what IndexedDB holds.
  const hadMirror = new Set(idbOnly ? [] : KEYS.filter(key => ls.get(key) !== null));
  const queue = new Map(); // key -> value, or null to delete
  let db = null, hydrated = false, flushTimer = null;

  function flush() {
    flushTimer = null;
    if (!db || !queue.size) return;
    const writes = [...queue]; queue.clear();
    try {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
      for (const [key, value] of writes) value === null ? store.delete(key) : store.put(value, key);
      tx.onerror = tx.onabort = () => console.warn('[local-cache] IndexedDB write failed', tx.error);
    } catch (error) { console.warn('[local-cache] IndexedDB write failed', error); }
  }
  function persist(key, value) {
    queue.set(key, value);
    if (db && !flushTimer) flushTimer = setTimeout(flush, 0);
  }
  function mirror(key, value) {
    if (idbOnly || ls.set(key, value)) return;
    if (!db) { ls.remove(key); return; } // no IndexedDB: same as before, this value simply is not cached
    idbOnly = true;
    for (const k of KEYS) ls.remove(k);
    ls.set(IDB_ONLY, '1');
  }

  function get(key) {
    if (!big(key)) return ls.get(key);
    if (mem.has(key)) return mem.get(key);
    return hydrated || idbOnly ? null : ls.get(key);
  }
  function set(key, value) {
    value = String(value);
    if (!big(key)) return ls.set(key, value);
    mem.set(key, value);
    if (!hydrated && !hadMirror.has(key)) return true; // startup value built without the cached data; hydration replaces it
    mirror(key, value);
    persist(key, value);
    return true;
  }
  function remove(key) {
    if (!big(key)) return ls.remove(key);
    mem.delete(key);
    ls.remove(key);
    persist(key, null);
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
        if (value !== null) { mem.set(key, value); if (stored[key] !== value) queue.set(key, value); }
      } else if (stored[key] !== undefined) {
        mem.set(key, stored[key]);
        changed = true;
      } else mem.delete(key);
    }
    if (idbOnly && database) for (const key of KEYS) ls.remove(key); // leftovers, e.g. from an older cached version
    if (idbOnly && !database) { idbOnly = false; ls.remove(IDB_ONLY); } // IndexedDB gone: fall back to localStorage
    db = database;
    hydrated = true;
    if (db) flush(); else queue.clear(); // without IndexedDB the localStorage mirror is the only copy, as before
    return {changed, indexedDB: !!db};
  })();

  root.LocalCache = {KEYS, get, set, remove, ready, isHydrated: () => hydrated};
})(typeof window !== 'undefined' ? window : globalThis);
