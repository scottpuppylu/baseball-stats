// review-v2/review-cache.js — 新版覆盤的摘要快取（WO-05 B5）。只在旗標開時載入，不改 local-cache.js。
//
// 存什麼：首屏要用的摘要（hero、line score、MVP、關鍵時刻、比分走勢、打者表、投手表），不存原始打席。
// 鍵：比賽 id＋資料版本。比賽資料沒有「修改時間」欄位（A9 不准加），所以版本用
//   「打席數.守備事件數.內容雜湊」代替；內容雜湊是整場比賽 JSON 的 FNV-1a 32 位元。內容一改，鍵就跟著變，舊摘要自然讀不到。
// 作廢：編輯、復原、日誌登入／撤銷、刪除比賽後呼叫 drop(id)，把這場所有版本從記憶體與 IndexedDB 一起清掉。
// 儲存：記憶體 Map（同步讀，首屏用）＋ IndexedDB rebas_review_v2／summaries（重新整理後還在）。IndexedDB 不能用時只用記憶體。
(function () {
  'use strict';
  const DB = 'rebas_review_v2', STORE = 'summaries', MAX = 60;
  const mem = new Map(); // key → summary
  const stats = {hits: 0, misses: 0, puts: 0, drops: 0, idb: false};
  let dbp = null;

  // FNV-1a 32 位元：一場比賽幾十 KB，一次約 1 ms。
  function fnv(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  function counts(game) {
    let pas = 0, defs = 0;
    for (const inn of (game && game.innings) || []) { pas += (inn.plateAppearances || []).length; defs += (inn.defensiveEvents || []).length; }
    return {pas, defs};
  }
  function version(game) {
    const c = counts(game);
    return `${c.pas}.${c.defs}.${fnv(JSON.stringify(game))}`;
  }
  const keyOf = game => `${game.id}|${version(game)}`;
  const idOfKey = key => key.slice(0, key.indexOf('|'));

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(resolve => {
      try {
        if (!window.indexedDB) { resolve(null); return; }
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => { stats.idb = true; resolve(req.result); };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (error) { resolve(null); }
    });
    return dbp;
  }
  async function tx(mode, run) {
    const db = await open();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const t = db.transaction(STORE, mode);
        const out = run(t.objectStore(STORE));
        t.oncomplete = () => resolve(out && 'result' in out ? out.result : true);
        t.onerror = () => resolve(null);
        t.onabort = () => resolve(null);
      } catch (error) { resolve(null); }
    });
  }
  // 開頁後把 IndexedDB 裡的摘要讀進記憶體（非同步，不擋首屏）。
  const ready = (async () => {
    const db = await open();
    if (!db) return;
    await new Promise(resolve => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) { resolve(); return; }
          if (!mem.has(cur.key)) mem.set(cur.key, cur.value);
          cur.continue();
        };
        req.onerror = () => resolve();
      } catch (error) { resolve(); }
    });
  })();

  function get(game) {
    if (!game) return null;
    const hit = mem.get(keyOf(game));
    if (hit) stats.hits++; else stats.misses++;
    return hit || null;
  }
  function put(game, summary) {
    if (!game || !summary) return;
    const key = keyOf(game), id = String(game.id);
    // 同一場只留最新版本。
    for (const k of [...mem.keys()]) if (idOfKey(k) === id && k !== key) mem.delete(k);
    mem.set(key, summary);
    while (mem.size > MAX) mem.delete(mem.keys().next().value);
    stats.puts++;
    tx('readwrite', store => {
      const req = store.openCursor();
      req.onsuccess = () => { const cur = req.result; if (!cur) return; if (idOfKey(cur.key) === id && cur.key !== key) cur.delete(); cur.continue(); };
      store.put(summary, key);
    });
  }
  function drop(id) {
    const want = String(id);
    for (const k of [...mem.keys()]) if (idOfKey(k) === want) mem.delete(k);
    stats.drops++;
    return tx('readwrite', store => {
      const req = store.openCursor();
      req.onsuccess = () => { const cur = req.result; if (!cur) return; if (idOfKey(cur.key) === want) cur.delete(); cur.continue(); };
    });
  }
  const keys = () => [...mem.keys()];

  window.reviewV2Cache = {version, keyOf, fnv, get, put, drop, keys, stats, ready};
})();
