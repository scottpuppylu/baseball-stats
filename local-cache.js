// Synchronous reads and confirmed local persistence. No cloud requests or team-data conversions.
(function(root) {
  'use strict';
  const KEYS = ['rebas_all_games', 'rebas_logs', 'rebas_player_avatars'];
  const IDB_ONLY = 'rebas_cache_idb_only';
  const DB_NAME = 'rebas-cache', STORE = 'kv', OPEN_TIMEOUT_MS = 1500;
  const mem = new Map(), queue = new Map(), revisions = new Map(), confirmed = new Map();
  const waiters = new Map(), failed = new Set(), idbConfirmed = new Map();
  const ls = {
    get(key) { try { return root.localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { root.localStorage.setItem(key, value); return true; } catch (_) { return false; } },
    remove(key) { try { root.localStorage.removeItem(key); return true; } catch (_) { return false; } }
  };
  let idbOnly = ls.get(IDB_ONLY) === '1';
  const hadMirror = new Set(idbOnly ? [] : KEYS.filter(key => ls.get(key) !== null));
  let db = null, hydrated = false, timer = null, flushing = false, retries = 0;
  let switchWanted = false, lastError = '', quotaHigh = false;
  const big = key => KEYS.includes(key);
  const revision = key => revisions.get(key) || 0;
  const saved = key => (confirmed.get(key) ?? -1) >= revision(key);
  function status() {
    return {pending: KEYS.filter(key => revisions.has(key) && !saved(key)).length,
      failed: failed.size > 0, lastError, quotaHigh, indexedDB: !!db};
  }
  function notify(error = false) {
    if (!root.dispatchEvent || !root.CustomEvent) return;
    root.dispatchEvent(new root.CustomEvent(error ? 'localcache:error' : 'localcache:status', {detail: status()}));
  }
  function settle(key, at, error) {
    const list = waiters.get(key) || [];
    waiters.set(key, list.filter(waiter => {
      if (waiter.at > at) return true;
      if (error) waiter.reject(error); else waiter.resolve();
      return false;
    }));
  }
  function acknowledge(key, at) {
    confirmed.set(key, Math.max(confirmed.get(key) ?? -1, at));
    settle(key, at);
    if (saved(key)) failed.delete(key);
  }
  function schedule(delay = 0) {
    if (!hydrated || timer !== null || flushing || !queue.size) return;
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }
  function enqueue(key, value, at = revision(key)) {
    const current = queue.get(key);
    if (!current || current.at <= at) queue.set(key, {value, at});
  }
  function fail(writes, error) {
    lastError = error?.message || '本機資料尚未保存';
    for (const [key, entry] of writes) {
      enqueue(key, entry.value, entry.at); // a newer queued edit always wins
      if (!saved(key)) {
        failed.add(key);
        settle(key, entry.at, new Error('本機儲存未完成，請保留此頁並下載完整備份'));
      }
    }
    notify(failed.size > 0);
  }
  function write(database, entries) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = database.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        const store = tx.objectStore(STORE);
        for (const [key, entry] of entries) entry.value === null ? store.delete(key) : store.put(entry.value, key);
      } catch (error) { try { tx?.abort(); } catch (_) {} reject(error); }
    });
  }
  async function flush() {
    if (flushing || !queue.size || !hydrated) return;
    flushing = true;
    const writes = [...queue]; queue.clear();
    try {
      if (!db) db = await open();
      if (!db) throw new Error('IndexedDB unavailable');
      await write(db, writes);
      for (const [key, entry] of writes) { idbConfirmed.set(key, entry.at); acknowledge(key, entry.at); }
      // Evict mirrors only after every current value has a confirmed IndexedDB copy.
      if (switchWanted && KEYS.every(key => !mem.has(key) || idbConfirmed.get(key) === revision(key))) {
        idbOnly = true;
        for (const key of KEYS) ls.remove(key);
        ls.set(IDB_ONLY, '1');
        switchWanted = false;
      }
      retries = 0;
      if (!failed.size) lastError = '';
      notify();
    } catch (error) {
      fail(writes, error);
      retries++;
    } finally {
      flushing = false;
      schedule(retries ? Math.min(30000, 250 * 2 ** Math.min(retries - 1, 7)) : 0);
    }
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
    const at = revision(key) + 1; revisions.set(key, at);
    // Startup derived from absent mirrors must never replace the unread IndexedDB snapshot.
    if (!hydrated && !hadMirror.has(key)) return false;
    const mirrored = !idbOnly && ls.set(key, value);
    if (mirrored) acknowledge(key, at);
    enqueue(key, value, at);
    if (!mirrored && !idbOnly) {
      switchWanted = true;
      for (const k of KEYS) if (mem.has(k)) enqueue(k, mem.get(k));
    }
    schedule(); notify();
    return mirrored;
  }
  function remove(key) {
    if (!big(key)) return ls.remove(key);
    mem.delete(key);
    revisions.set(key, revision(key) + 1);
    ls.remove(key);
    enqueue(key, null);
    schedule(); notify();
    return false; // deletion must reach IndexedDB too, or its old copy could reappear
  }
  async function whenPersisted(key, retrying = false) {
    await ready;
    const keys = key ? [key] : KEYS.filter(k => revisions.has(k));
    await Promise.all(keys.map(k => {
      if (!big(k) || saved(k) || !revisions.has(k)) return Promise.resolve();
      if (failed.has(k) && !retrying) return Promise.reject(new Error('本機儲存未完成，請保留此頁並下載完整備份'));
      return new Promise((resolve, reject) => {
        const list = waiters.get(k) || [];
        list.push({at: revision(k), resolve, reject}); waiters.set(k, list);
        schedule();
      });
    }));
  }
  function retry() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    retries = 0;
    schedule();
    return whenPersisted(undefined, true);
  }
  function register(key) {
    if (big(key)) return ready;
    KEYS.push(key);
    if (!idbOnly && ls.get(key) !== null) hadMirror.add(key);
    // A following script may arrive after IDB hydration; load that key without replacing new edits.
    return ready.then(async () => {
      if (mem.has(key) || revisions.has(key)) return;
      const mirror = !idbOnly ? ls.get(key) : null;
      const stored = db ? (await readAll(db))[key] : undefined;
      if (revisions.has(key)) return;
      const value = mirror !== null ? mirror : stored;
      if (typeof value === 'string') {
        mem.set(key, value); revisions.set(key, 0); acknowledge(key, 0);
        if (stored === value) idbConfirmed.set(key, 0); else { enqueue(key, value); schedule(); }
      }
    });
  }
  function open() {
    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
      const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
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
        for (const key of KEYS) store.get(key).onsuccess = event => {
          if (typeof event.target.result === 'string') out[key] = event.target.result;
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = tx.onabort = () => resolve(out);
      } catch (_) { resolve(out); }
    });
  }
  const ready = (async () => {
    const database = await open(), stored = database ? await readAll(database) : {};
    let changed = false;
    for (const key of KEYS) {
      if (hadMirror.has(key)) {
        const value = mem.has(key) ? mem.get(key) : ls.get(key);
        if (value !== null) {
          mem.set(key, value); acknowledge(key, revision(key));
          if (stored[key] !== value) enqueue(key, value); else idbConfirmed.set(key, revision(key));
        }
      } else if (stored[key] !== undefined) {
        mem.set(key, stored[key]); revisions.set(key, 0); idbConfirmed.set(key, 0); acknowledge(key, 0); changed = true;
      } else { mem.delete(key); revisions.delete(key); }
    }
    if (idbOnly && !database) { idbOnly = false; ls.remove(IDB_ONLY); }
    db = database; hydrated = true;
    if (queue.size) schedule();
    notify();
    return {changed, indexedDB: !!db};
  })();
  root.LocalCache = {KEYS, get, set, remove, ready, whenPersisted, status, retry, register,
    isHydrated: () => hydrated};
  // Storage durability is best effort; availability and success are reported separately above.
  ready.then(async () => {
    try {
      await root.navigator?.storage?.persist?.();
      const estimate = await root.navigator?.storage?.estimate?.();
      quotaHigh = !!(estimate?.quota && estimate.usage / estimate.quota >= .8);
      if (quotaHigh) notify();
    } catch (_) { /* optional browser API */ }
  });
})(typeof window !== 'undefined' ? window : globalThis);
