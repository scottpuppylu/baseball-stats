const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = () => fs.readFileSync(path.join(__dirname, '../local-cache.js'), 'utf8');
const tick = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));

function fixture(existing = {}) {
  const local = existing.local || new Map(), disk = existing.disk || new Map();
  const flags = {quota:false, failIDB:false, hold:false}, timers = new Set(), held = [], events = [];
  const later = (fn, ms = 0) => {const t = setTimeout(() => {timers.delete(t); fn();}, ms); timers.add(t); return t;};
  const database = {
    createObjectStore() {}, close() {},
    transaction(_name, mode) {
      let aborted = false;
      const staged = new Map();
      const tx = {error:null, abort(){aborted=true; later(() => tx.onabort?.());}, objectStore:() => ({
        get(key) { const request = {}; later(() => request.onsuccess?.({target:{result:disk.get(key)}})); return request; },
        put(value,key) {if(flags.failIDB) throw new Error('isolated IndexedDB failure'); staged.set(key,value);},
        delete(key) {if(flags.failIDB) throw new Error('isolated IndexedDB failure'); staged.set(key,null);}
      })};
      const finish = () => {if(aborted)return; for(const [key,value] of staged)value===null?disk.delete(key):disk.set(key,value);tx.oncomplete?.();};
      later(() => {if(mode==='readwrite'&&flags.hold)held.push(finish);else finish();}, 4);
      return tx;
    }
  };
  const root = {localStorage:{getItem:key=>local.get(key)??null,
    setItem(key,value){if(flags.quota&&key!=='rebas_cache_idb_only')throw new Error('isolated localStorage full');local.set(key,String(value));},
    removeItem:key=>local.delete(key)},
    indexedDB:{open(){const request={};later(()=>{request.result=database;request.onsuccess?.();});return request;}},
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},
    dispatchEvent:event=>events.push(event)};
  vm.runInNewContext(source(), {window:root, setTimeout:later, clearTimeout:t=>{clearTimeout(t);timers.delete(t);}, console});
  return {cache:root.LocalCache,local,disk,flags,events,
    release(){flags.hold=false;held.splice(0).forEach(f=>f());},
    close(){for(const timer of timers)clearTimeout(timer);}};
}
test('quota failure keeps old mirrors, reports failure, then retries the newest value durably',async()=>{
  const local=new Map([['rebas_all_games','old'],['rebas_logs','logs'],['rebas_player_avatars','avatars']]);
  const disk=new Map(local),f=fixture({local,disk});
  try {
    await f.cache.ready;f.flags.quota=true;f.flags.failIDB=true;
    assert.equal(f.cache.set('rebas_all_games','new'),false,'memory alone is not a successful save');
    await assert.rejects(f.cache.whenPersisted('rebas_all_games'),/儲存未完成/);
    assert.equal(local.get('rebas_all_games'),'old','old mirror survives the failed IDB transaction');
    assert.equal(local.get('rebas_logs'),'logs');assert.equal(local.has('rebas_cache_idb_only'),false);
    assert.equal(f.cache.status().failed,true);assert.ok(f.events.some(e=>e.type==='localcache:error'));
    f.cache.set('rebas_all_games','newest');f.flags.failIDB=false;
    await f.cache.retry();await tick();
    assert.equal(disk.get('rebas_all_games'),'newest');assert.equal(local.get('rebas_cache_idb_only'),'1');
    assert.equal(local.has('rebas_all_games'),false);assert.equal(f.cache.status().failed,false);
    const reopened=fixture({local,disk});
    try{await reopened.cache.ready;assert.equal(reopened.cache.get('rebas_all_games'),'newest');}finally{reopened.close();}
  }finally{f.close();}
});
test('an in-flight older transaction cannot acknowledge or evict a newer edit',async()=>{
  const f=fixture({local:new Map([['rebas_all_games','old']]),disk:new Map([['rebas_all_games','old']])});
  try{
    await f.cache.ready;f.flags.quota=true;f.flags.hold=true;
    f.cache.set('rebas_all_games','first');await tick();
    f.cache.set('rebas_all_games','second');let done=false;
    const persisted=f.cache.whenPersisted('rebas_all_games').then(()=>{done=true;});
    assert.equal(done,false);assert.equal(f.local.get('rebas_all_games'),'old');
    f.release();await persisted;await tick();
    assert.equal(f.disk.get('rebas_all_games'),'second');assert.equal(f.cache.status().pending,0);
  }finally{f.close();}
});
test('a confirmed localStorage fallback remains a durable save if IndexedDB fails',async()=>{
  const f=fixture();try{
    await f.cache.ready;f.flags.failIDB=true;
    assert.equal(f.cache.set('rebas_all_games','fallback'),true);
    await f.cache.whenPersisted('rebas_all_games');await tick();
    assert.equal(f.local.get('rebas_all_games'),'fallback');assert.equal(f.cache.status().failed,false);
  }finally{f.close();}
});
test('deleting a large cache waits for the IndexedDB delete and survives reopen',async()=>{
  const local=new Map([['rebas_all_games','old']]),disk=new Map(local),f=fixture({local,disk});
  try{
    await f.cache.ready;f.cache.remove('rebas_all_games');await f.cache.whenPersisted('rebas_all_games');
    assert.equal(disk.has('rebas_all_games'),false);
    const reopened=fixture({local,disk});try{await reopened.cache.ready;assert.equal(reopened.cache.get('rebas_all_games'),null);}finally{reopened.close();}
  }finally{f.close();}
});
test('startup derived writes cannot overwrite a larger IndexedDB-only snapshot',async()=>{
  const f=fixture({local:new Map([['rebas_cache_idb_only','1']]),disk:new Map([['rebas_all_games','real']])});
  try{
    assert.equal(f.cache.set('rebas_all_games','startup-empty'),false);
    await f.cache.ready;await tick();assert.equal(f.cache.get('rebas_all_games'),'real');assert.equal(f.disk.get('rebas_all_games'),'real');
  }finally{f.close();}
});

test('a draft key registered after hydration reloads its IndexedDB-only value',async()=>{
  const f=fixture({local:new Map([['rebas_cache_idb_only','1']]),disk:new Map([['rebas_sync_pending','drafts']])});
  try{
    await f.cache.ready;await f.cache.register('rebas_sync_pending');
    assert.equal(f.cache.get('rebas_sync_pending'),'drafts');
    f.cache.set('rebas_sync_pending','new drafts');await f.cache.whenPersisted('rebas_sync_pending');
    assert.equal(f.disk.get('rebas_sync_pending'),'new drafts');
  }finally{f.close();}
});
