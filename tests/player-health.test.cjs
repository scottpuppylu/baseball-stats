const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const H = require('../player-health.js');
const profiles = {R:{bats:'R'},L:{bats:'L'},S:{bats:'S'}};
test('left/right boundary rules, missing coordinates and unknown sides',() => {
  for (const [name,expected] of [['R',['pull','cent','cent','oppo']],['L',['oppo','cent','cent','pull']]]) {
    assert.deepEqual([.399,.4,.6,.601].map(x=>H.direction({batterName:name,x},profiles)),expected);
  }
  for (const x of [undefined,null,NaN,-1,1.1,'0.2']) assert.equal(H.direction({batterName:'R',x},profiles),null);
  for (const name of ['unknown','S']) assert.equal(H.direction({batterName:name,x:.2},profiles),null);
  assert.equal(H.direction({batterName:'S',battingSide:'L',x:.9},profiles),'pull');
  assert.equal(H.direction({batterName:'R',battingSide:'L',x:.2},profiles),'oppo','actual PA side overrides habit');
});
test('mixed-handed team shares a valid direction denominator and keeps physical field sides',() => {
  const pts=[{batterName:'R',x:.2},{batterName:'L',x:.8},{batterName:'S',x:.8},{batterName:'R',x:.5},{batterName:'L',x:null}];
  const before=JSON.stringify(pts),s=H.summarize(pts,profiles);
  assert.deepEqual(s,{pull:2,cent:1,oppo:0,known:3,unknown:2,left:1,center:1,right:2});
  assert.match(H.fieldAdvice(H.summarize([{batterName:'L',x:.8}],profiles)),/向右/);
  assert.match(H.tendencyText(H.summarize(pts,{})),/尚未設定/);
  assert.equal(JSON.stringify(pts),before,'coordinates remain untouched');
});
test('blank profiles stay optional; units and real calendar dates are validated',() => {
  assert.deepEqual(H.normalize(),{heightCm:null,weightKg:null,bats:'U',throws:'U',birthDate:''});
  assert.equal(H.normalize({heightCm:'180.1',weightKg:'72.5',birthDate:'2004-02-29',bats:'L'}).weightKg,72.5);
  for (const raw of [{heightCm:-1},{weightKg:'NaN'},{birthDate:'2003-02-29'},{birthDate:'2999-01-01'},{bats:'X'}]) assert.throws(()=>H.normalize(raw));
  assert.equal(H.age('2004-10-21','2026-10-20'),21);
  assert.equal(H.age('2004-10-20','2026-10-20'),22);
  assert.equal(H.zodiac('2004-01-19'),'摩羯座'); assert.equal(H.zodiac('2004-01-20'),'水瓶座');
  assert.equal(H.zodiac('2004-12-22'),'摩羯座'); assert.equal(H.zodiac('2004-02-29'),'雙魚座');
});
test('health save failures keep recoverable drafts; retry uses existing cloud merge writer',async () => {
  const cache=new Map(), writes=[]; let fail=true, cloud={Other:{bats:'R'}};
  const context={PlayerHealth:H,Event:class{},window:{dispatchEvent(){}},localStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},
    fetchGitHubContent:async()=>({content:cloud,sha:'v1'}),rememberCloudBase(){},setStatusBadge(){},syncAllGamesToTeamLogs(){},renderAll(){},
    commitJsonFile:async(file,data)=>{writes.push(file); if(fail) throw new Error('offline');return {data:{...cloud,...data},sha:'v2'};}};
  vm.createContext(context); vm.runInContext(fs.readFileSync(require.resolve('../player-health-store.js'),'utf8'),context);
  const S=context.window.PlayerHealthStore; await S.load();
  await assert.rejects(S.save('New',{bats:'L',heightCm:180}),/offline/);
  assert.equal(S.data().New.bats,'L'); assert.equal(S.status().pending,1);
  cloud={Other:{bats:'R'},Remote:{bats:'S'}}; await S.load();
  assert.equal(S.data().New.bats,'L','reload preserves pending local edit');
  fail=false; await S.sync();
  assert.equal(S.status().pending,0); assert.equal(S.data().Remote.bats,'S');
  assert.equal(cache.has('rebas_player_health_pending'),false);
  assert.deepEqual(writes,['data/health.json','data/health.json']);
});
test('a missing new cloud file is optional and never creates a file during load',async () => {
  let writes=0;
  const c={PlayerHealth:H,Event:class{},window:{dispatchEvent(){}},localStorage:{getItem:()=>null},
    fetchGitHubContent:async()=>{throw Object.assign(new Error('missing'),{status:404});},rememberCloudBase(){},commitJsonFile:()=>writes++};
  vm.createContext(c);vm.runInContext(fs.readFileSync(require.resolve('../player-health-store.js'),'utf8'),c);
  assert.equal(await c.window.PlayerHealthStore.load(),'missing');assert.equal(writes,0);
});
