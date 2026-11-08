// local-cache.js in a sandbox with a controllable clock and a fake IndexedDB, for the start-up paths a real browser
// rarely shows (an iPhone answering indexedDB.open late, or never).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'local-cache.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

// openAfter: ms until indexedDB.open answers (Infinity = never); fail: answer with an error instead.
function load({storage = {}, stored = {}, openAfter = 0, fail = false, noIndexedDB = false}) {
  const timers = [];
  let now = 0;
  const clock = {
    setTimeout(fn, ms = 0) { const t = {at: now + ms, fn}; timers.push(t); return t; },
    clearTimeout(t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await settle();
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        const t = timers.shift();
        now = t.at;
        t.fn();
      }
      now = end;
      await settle();
    }
  };
  const ls = new Map(Object.entries(storage));
  const quota = {full: false}; // full: every localStorage write throws, as Safari does when the quota is used up
  const localStorage = {getItem: k => (ls.has(k) ? ls.get(k) : null), removeItem: k => ls.delete(k),
    setItem: (k, v) => { if (quota.full) throw Object.assign(new Error('full'), {name: 'QuotaExceededError'}); ls.set(k, String(v)); }};
  const data = new Map(Object.entries(stored));
  const db = {
    closed: false,
    close() { this.closed = true; },
    transaction() {
      const tx = {objectStore: () => store};
      const store = {
        get(key) { const r = {}; queueMicrotask(() => r.onsuccess?.({target: {result: data.get(key)}})); return r; },
        put(value, key) { data.set(key, value); },
        delete(key) { data.delete(key); }
      };
      Promise.resolve().then(() => Promise.resolve()).then(() => tx.oncomplete?.()); // after the gets answer
      return tx;
    }
  };
  const indexedDB = {
    open() {
      const request = {};
      if (fail) clock.setTimeout(() => request.onerror?.(), openAfter);
      else if (openAfter !== Infinity) clock.setTimeout(() => { request.result = db; request.onsuccess?.(); }, openAfter);
      return request;
    }
  };
  const root = {localStorage, dispatchEvent() {}, CustomEvent: class {}, navigator: {}};
  if (!noIndexedDB) root.indexedDB = indexedDB;
  const ctx = vm.createContext({window: root, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, console});
  vm.runInContext(source, ctx);
  return {cache: root.LocalCache, ls, data, db, clock, quota};
}

test('V-07: localStorage full and no IndexedDB: the old mirror stays, so a reload still has the last saved copy', async () => {
  for (const options of [{noIndexedDB: true}, {fail: true}]) {
    const {cache, ls, clock, quota} = load({storage: {rebas_logs: '[old]'}, ...options});
    await clock.advance(100);
    quota.full = true;
    assert.equal(cache.set('rebas_logs', '[new]'), false, 'the new value could not be saved');
    assert.equal(ls.get('rebas_logs'), '[old]', 'the last durable copy is not deleted');
    assert.equal(cache.status().failed, true, 'the page is told the write is not saved');
  }
});

test('V-07: localStorage full before IndexedDB answered: the old mirror goes only once IndexedDB takes over', async () => {
  const failed = load({storage: {rebas_logs: '[old]'}, fail: true, openAfter: 1000});
  failed.quota.full = true;
  failed.cache.set('rebas_logs', '[new]');
  await failed.clock.advance(2000);
  assert.equal(failed.ls.get('rebas_logs'), '[old]', 'IndexedDB failed: the old mirror is still the only durable copy');

  const works = load({storage: {rebas_logs: '[old]'}, openAfter: 1000});
  works.quota.full = true;
  works.cache.set('rebas_logs', '[new]');
  await works.clock.advance(2000);
  assert.equal(works.data.get('rebas_logs'), '[new]', 'IndexedDB holds the new value');
  assert.equal(works.ls.has('rebas_logs'), false, 'the outdated mirror is not read at the next start');
});

test('localStorage full with IndexedDB working: the outdated mirror goes and IndexedDB keeps the value (unchanged)', async () => {
  const {cache, ls, data, clock, quota} = load({storage: {rebas_logs: '[old]'}});
  await clock.advance(100);
  quota.full = true;
  cache.set('rebas_logs', '[new]');
  await clock.advance(100);
  assert.equal(ls.has('rebas_logs'), false);
  assert.equal(data.get('rebas_logs'), '[new]');
});

test('V-01: an IndexedDB-only device whose IndexedDB answers late keeps the flag and loads the stored copy', async () => {
  const draft = '{"logs":[{"id":"draft"}]}';
  const {cache, ls, db, clock} = load({storage: {rebas_cache_idb_only: '1'}, stored: {rebas_pending_sync: draft, rebas_all_games: '[1]'}, openAfter: 3000});
  let result = null;
  cache.ready.then(r => { result = r; });
  await clock.advance(3000);
  assert.ok(result, 'ready resolves once IndexedDB answers');
  assert.equal(result.indexedDB, true, 'the late connection is used, not dropped');
  assert.equal(result.changed, true);
  assert.equal(db.closed, false);
  assert.equal(cache.get('rebas_pending_sync'), draft, 'the unsent drafts are loaded');
  assert.equal(ls.get('rebas_cache_idb_only'), '1', 'the device stays IndexedDB-only');
});

test('V-01: an IndexedDB-only device whose IndexedDB never answers keeps the flag; writes are reported unsaved, not mirrored', async () => {
  const {cache, ls, clock} = load({storage: {rebas_cache_idb_only: '1'}, stored: {rebas_pending_sync: 'older drafts'}, openAfter: Infinity});
  let result = null;
  cache.ready.then(r => { result = r; });
  await clock.advance(60000);
  assert.ok(result, 'the page is not left waiting forever');
  assert.equal(result.indexedDB, false);
  assert.equal(ls.get('rebas_cache_idb_only'), '1', 'a slow start is not a missing IndexedDB: the next start uses it again');
  assert.equal(cache.set('rebas_pending_sync', 'new drafts'), false);
  assert.equal(ls.has('rebas_pending_sync'), false, 'no mirror that the next start would take as newer than IndexedDB');
  assert.equal(cache.status().failed, true, 'the page is told the write is not saved on this device');
});

test('an IndexedDB-only device whose IndexedDB is gone falls back to localStorage (unchanged)', async () => {
  for (const options of [{fail: true}, {noIndexedDB: true}]) {
    const {cache, ls, clock} = load({storage: {rebas_cache_idb_only: '1'}, ...options});
    let result = null;
    cache.ready.then(r => { result = r; });
    await clock.advance(100);
    assert.ok(result);
    assert.equal(result.indexedDB, false);
    assert.equal(ls.has('rebas_cache_idb_only'), false);
    assert.equal(cache.set('rebas_logs', '[]'), true, 'localStorage keeps the value again');
  }
});

test('a device with a localStorage mirror still starts from it when IndexedDB is slow (unchanged)', async () => {
  const {cache, clock} = load({storage: {rebas_logs: '[7]'}, openAfter: Infinity});
  let result = null;
  cache.ready.then(r => { result = r; });
  await clock.advance(1500);
  assert.ok(result, 'ready after the short wait');
  assert.equal(result.indexedDB, false);
  assert.equal(cache.get('rebas_logs'), '[7]');
});
