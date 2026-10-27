const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const file='data/games.json';
function fixture(disk=new Map()) {
  let failure=false;
  const memory=new Map(disk);
  const root={LocalCache:{register:async()=>{},get:key=>memory.get(key)||null,
    set(key,value){memory.set(key,value);if(!failure)disk.set(key,value);},
    async whenPersisted(){if(failure)throw Error('disk full');}},
    CustomEvent:class{},dispatchEvent(){}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sync-drafts.js'),'utf8'),{window:root,console});
  return {drafts:root.SyncDrafts,disk,setFailure:value=>{failure=value;}};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('overlay preserves unrelated duplicate IDs, order and malformed input validation',async()=>{
  const f=fixture();await f.drafts.ready;
  const rows=[{id:'old',v:1},{id:'old',v:2},{id:'a',v:0}];
  assert.deepEqual(plain(f.drafts.overlay(file,rows)),rows);
  await f.drafts.stage(file,[...rows.slice(0,2),{id:'a',v:9}],rows);
  assert.deepEqual(plain(f.drafts.overlay(file,rows)),[...rows.slice(0,2),{id:'a',v:9}]);
  assert.deepEqual(plain(f.drafts.overlay(file,{invalid:true})),{invalid:true});
});
test('pending additions, edits and tombstones survive reload and overlay stale cloud',async()=>{
  const f=fixture();await f.drafts.ready;
  await f.drafts.stage(file,[{id:'a',score:12},{id:'new'}],[{id:'a',score:0},{id:'deleted'}]);
  const reopened=fixture(f.disk);await reopened.drafts.ready;
  assert.deepEqual(plain(reopened.drafts.overlay(file,[{id:'a',score:0},{id:'deleted'},{id:'other'}])),[{id:'new'},{id:'a',score:12},{id:'other'}]);
  assert.equal(reopened.drafts.status().pending,3);
});
test('an older upload acknowledgement keeps edits made while it was in flight',async()=>{
  const f=fixture();await f.drafts.ready;
  const sent=await f.drafts.stage(file,[{id:'a',score:1}],[{id:'a',score:0}]);
  await f.drafts.stage(file,[{id:'a',score:2}],[{id:'a',score:0}]);
  await f.drafts.acknowledge(sent);
  assert.equal(f.drafts.status().pending,1);
  assert.equal(f.drafts.overlay(file,[{id:'a',score:1}])[0].score,2);
});
test('failed persistence is reported and retains the new intent in memory for backup',async()=>{
  const f=fixture();await f.drafts.ready;f.setFailure(true);
  await assert.rejects(f.drafts.stage(file,[{id:'a'}],[]),/disk full/);
  assert.equal(f.drafts.status().pending,1);
  f.setFailure(false);const ticket=await f.drafts.stage(file,[{id:'a'}],[]);
  await f.drafts.acknowledge(ticket);assert.equal(f.drafts.status().pending,0);
});
test('stage snapshots mutable input and reverts cancel only the intended record',async()=>{
  const f=fixture();await f.drafts.ready;
  const rows=[{id:'a',score:1}];const pending=f.drafts.stage(file,rows,[]);rows[0].score=9;
  await pending;assert.equal(f.drafts.overlay(file,[])[0].score,1);
  await f.drafts.stage(file,[],[]);assert.equal(f.drafts.status().pending,1,'unknown existing addition is not silently erased');
  await f.drafts.stage(file,[{id:'a',score:0}],[{id:'a',score:0}]);
  assert.equal(f.drafts.status().pending,0);
});
