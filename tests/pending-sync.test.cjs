// Unsent-change drafts (index.html「待同步草稿」): what is recorded before an upload, what a success clears, and what is
// put back on top of a loaded copy. Runs the page's own code in a sandbox with in-memory storage.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
const block = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a !== -1 && b !== -1, start);
  return source.slice(a, b);
};

function page(cloud) {
  const store = new Map(), events = [];
  const ctx = {
    GAMES_FILE_PATH: 'data/games.json', DATA_FILE_PATH: 'data/logs.json', GUESTS_FILE_PATH: 'data/guests.json',
    localCache: {get: key => store.get(key) ?? null, set: (key, value) => { store.set(key, value); return true; }},
    window: {dispatchEvent: event => events.push(event.detail.count)},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    JSON, Object, Array, Map, Set, String, Date, Math,
    store, events
  };
  vm.createContext(ctx);
  vm.runInContext(block('const cloudBase = {};', '    // Arrays merge item by item'), ctx);
  vm.runInContext(block('    const PENDING_KEY = ', '    // 「重新同步」'), ctx);
  if (cloud) vm.runInContext(`rememberCloudBase('data/games.json', 'sha1', ${JSON.stringify(cloud)})`, ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const cloud = [{id: 'a', score: 0}, {id: 'b', score: 1}, {id: 'c', score: 2}];

test('records changed, added and deleted items relative to the cloud copy, and nothing unchanged', () => {
  const ctx = page(cloud);
  run(ctx, `stagePendingChanges('data/games.json', [{id: 'new', score: 5}, {id: 'a', score: 12}, {id: 'b', score: 1}])`);
  const ops = JSON.parse(ctx.store.get('rebas_pending_sync'))['data/games.json'];
  assert.deepEqual(Object.keys(ops).sort(), ['a', 'c', 'new']);
  assert.equal(ops.a.op, 'put');
  assert.equal(ops.a.value.score, 12);
  assert.equal(ops.c.op, 'delete');
  assert.equal(run(ctx, 'pendingSyncCount()'), 3);
});

test('a reload puts the unsent edit back on top of an older cloud copy', () => {
  const ctx = page(cloud);
  run(ctx, `stagePendingChanges('data/games.json', [{id: 'a', score: 12}, {id: 'b', score: 1}, {id: 'c', score: 2}])`);
  // Same device storage, a fresh page: the drafts are read from storage.
  const fresh = page(cloud);
  fresh.store.set('rebas_pending_sync', ctx.store.get('rebas_pending_sync'));
  const shown = run(fresh, `applyPendingChanges('data/games.json', ${JSON.stringify(cloud)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(shown)), [{id: 'a', score: 12}, {id: 'b', score: 1}, {id: 'c', score: 2}]);
});

test('deleted items stay deleted and added items come first', () => {
  const ctx = page(cloud);
  run(ctx, `stagePendingChanges('data/games.json', [{id: 'new', score: 5}, {id: 'a', score: 0}, {id: 'b', score: 1}])`);
  const shown = run(ctx, `applyPendingChanges('data/games.json', ${JSON.stringify(cloud)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(shown)).map(g => g.id), ['new', 'a', 'b']);
});

test('a successful upload clears only the versions it sent; a later edit stays pending', () => {
  const ctx = page(cloud);
  run(ctx, `globalThis.ticket = stagePendingChanges('data/games.json', [{id: 'a', score: 12}, {id: 'b', score: 1}, {id: 'c', score: 2}])`);
  // Edited again while the first upload was in flight.
  run(ctx, `stagePendingChanges('data/games.json', [{id: 'a', score: 13}, {id: 'b', score: 1}, {id: 'c', score: 2}])`);
  run(ctx, 'settlePendingChanges(ticket)');
  const ops = JSON.parse(ctx.store.get('rebas_pending_sync'))['data/games.json'];
  assert.equal(ops.a.value.score, 13, 'the newer edit is kept for the next upload');
  // The next upload sends it and clears it.
  run(ctx, `globalThis.ticket2 = stagePendingChanges('data/games.json', [{id: 'a', score: 13}, {id: 'b', score: 1}, {id: 'c', score: 2}])`);
  run(ctx, 'settlePendingChanges(ticket2)');
  assert.equal(run(ctx, 'pendingSyncCount()'), 0);
  assert.equal(ctx.events.at(-1), 0, 'the notice is told the count');
});

test('without a known cloud copy nothing counts as deleted', () => {
  const ctx = page(null);
  run(ctx, `stagePendingChanges('data/games.json', [{id: 'a', score: 12}])`);
  const ops = JSON.parse(ctx.store.get('rebas_pending_sync'))['data/games.json'];
  assert.deepEqual(Object.keys(ops), ['a']);
});

test('reverting to the cloud version clears the draft; object files are not tracked', () => {
  const ctx = page(cloud);
  run(ctx, `stagePendingChanges('data/games.json', [{id: 'a', score: 12}, {id: 'b', score: 1}, {id: 'c', score: 2}])`);
  run(ctx, `stagePendingChanges('data/games.json', ${JSON.stringify(cloud)})`);
  assert.equal(run(ctx, 'pendingSyncCount()'), 0);
  assert.equal(run(ctx, `stagePendingChanges('data/avatars.json', {x: 1})`), null);
});
