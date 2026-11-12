// WO-03 B8: local-cache.js reads each large localStorage mirror once while the page starts (getItem copies the whole
// string), and still takes another tab's newer value.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'local-cache.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function load(storage, stored = {}) {
  const ls = new Map(Object.entries(storage));
  const reads = new Map();
  const localStorage = {
    getItem: k => { reads.set(k, (reads.get(k) || 0) + 1); return ls.has(k) ? ls.get(k) : null; },
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: k => ls.delete(k)
  };
  const data = new Map(Object.entries(stored));
  const db = {
    close() {},
    transaction() {
      const store = {
        get(key) { const r = {}; queueMicrotask(() => r.onsuccess?.({target: {result: data.get(key)}})); return r; },
        put(value, key) { data.set(key, value); },
        delete(key) { data.delete(key); }
      };
      const tx = {objectStore: () => store};
      Promise.resolve().then(() => Promise.resolve()).then(() => tx.oncomplete?.());
      return tx;
    }
  };
  const listeners = {};
  const root = {
    localStorage, navigator: {}, CustomEvent: class {}, dispatchEvent() {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
    indexedDB: {open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request; }}
  };
  // Timers never fire: these tests only look at reads during start-up and hydration.
  const ctx = vm.createContext({window: root, setTimeout: () => 0, clearTimeout: () => {}, console});
  vm.runInContext(source, ctx);
  return {cache: root.LocalCache, ls, reads, listeners};
}

test('each large mirror is read from localStorage once through start-up and hydration', async () => {
  const big = '[' + '1,'.repeat(1000) + '1]';
  const {cache, reads} = load({rebas_logs: big, rebas_all_games: '[]'}, {rebas_logs: big});
  assert.equal(cache.get('rebas_logs'), big, 'start-up render reads the mirror');
  assert.equal(cache.get('rebas_logs'), big, 'and again');
  await cache.ready;
  assert.equal(cache.get('rebas_logs'), big, 'after hydration the value comes from memory');
  assert.equal(reads.get('rebas_logs'), 1, 'one getItem for the large value');
  assert.equal(reads.get('rebas_all_games'), 1);
});

test('another tab writing a mirror before hydration: the newer value is used, not the start-up copy', async () => {
  const {cache, ls, listeners} = load({rebas_logs: '[1]'});
  assert.equal(cache.get('rebas_logs'), '[1]');
  ls.set('rebas_logs', '[1,2]');
  listeners.storage({key: 'rebas_logs'});
  assert.equal(cache.get('rebas_logs'), '[1,2]');
  await cache.ready;
  assert.equal(cache.get('rebas_logs'), '[1,2]');
});

test('this tab writing before hydration keeps its own value through hydration', async () => {
  const {cache, ls} = load({rebas_logs: '[1]'}, {rebas_logs: '[1]'});
  assert.equal(cache.set('rebas_logs', '[1,3]'), true, 'mirrored, so durable');
  assert.equal(cache.get('rebas_logs'), '[1,3]');
  await cache.ready;
  assert.equal(cache.get('rebas_logs'), '[1,3]');
  assert.equal(ls.get('rebas_logs'), '[1,3]');
  assert.equal(cache.status().failed, false);
});
