// Exercise the existing production formula functions, with synthetic games only.
// These are audit assertions about current behavior; formulas are not changed here.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const M = require('../lineup-model.js');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
const extract = name => {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0,name);
  const end = html.indexOf('\n    }',start);
  assert.ok(end > start,name);
  return html.slice(start,end+6);
};
function sample(result, trajectory = 'grounder') {
  const play = (name,r,t='grounder') => ({batterName:name,result:r,trajectory:t,x:0.3,slot:name==='A'?1:2,outsAdded:['GO','FO','K'].includes(r)?1:0});
  const game = {id:'qa_error',date:'2026-10-19',lineup:['A','B'],innings:[{plateAppearances:[
    play('A',result,trajectory),play('A','1H'),play('A','BB','none'),play('A','K','none'),
    play('B','1H'),play('B','2H','line'),play('B','FO','fly'),play('B','GO')
  ]}]};
  const c = vm.createContext({PlayerHealth:require('../player-health.js'),PlayerHealthStore:{data:()=>({A:{bats:'R'},B:{bats:'R'}})},allGames:[game],NAME_TO_JERSEY:{A:1,B:2},isGuestPlayerName:()=>false,isSimulatedGame:()=>false,
    isRunnerOutPlay:p=>['RUNNER_OUT','OUT'].includes(p.result)||p.isRunnerOut===true,
    getGameAllBatters:g=>g.lineup,XSTAT_DEFAULTS:{line:{hit:.68,tb:.95},grounder:{hit:.28,tb:.30},fly:{hit:.38,tb:.75},popup:{hit:.02,tb:.02}}});
  for (const name of ['buildGameLogs','getBattedBallRates','getAggregatedStats']) vm.runInContext(extract(name),c);
  const logs = c.buildGameLogs(game), agg = c.getAggregatedStats(logs);
  return JSON.parse(JSON.stringify({logs,agg,rates:c.getBattedBallRates()}));
}
test('E adds PA/AB/BIP without a hit, walk or separately aggregated ROE count', () => {
  const p = sample('E').logs[0];
  assert.equal(p.pa,4); assert.equal(p.ab,3); assert.equal(p.h,1); assert.equal(p.bb,1); assert.equal(p.k,1);
  assert.equal(p.bip,2); assert.equal(p.gb,2); assert.equal(p.pull,2);
  assert.equal(Object.hasOwn(p,'e'),false); assert.equal(Object.hasOwn(p,'roe'),false);
});
test('an E and a GO of the same trajectory are identical in every aggregated advanced metric', () => {
  assert.deepEqual(sample('E'),sample('GO'));
});
test('E is a zero-hit / zero-base sample in team batted-ball calibration', () => {
  const e = sample('E'), hit = sample('1H');
  assert.equal(e.rates.grounder.n,4);
  assert.equal(e.rates.grounder.hit,(2+10*.28)/14);
  assert.equal(e.rates.grounder.tb,(2+10*.30)/14);
  assert.ok(hit.rates.grounder.hit > e.rates.grounder.hit);
  assert.ok(hit.agg.players[1].xba > e.agg.players[1].xba,'calibration affects other hitters too');
});
test('the batting-order model has no error-on-base event and treats E like the same batted out', () => {
  assert.equal(M.EVENTS.includes('e'),false); assert.equal(M.EVENTS.includes('roe'),false);
  const e = sample('E').agg.players, go = sample('GO').agg.players;
  assert.deepEqual(M.batterModel(e[0],M.teamRates(e)),M.batterModel(go[0],M.teamRates(go)));
  assert.ok(M.batterModel(e[0],M.teamRates(e)).probs.go>0);
});
test('zero-hit E is still contact, and the RC outs proxy counts it as an out', () => {
  const p=sample('E').agg.players[0];
  assert.equal(p.contact_pct,2/3); assert.equal(p.outs,2); // AB 3 - H 1; one was E, no real out.
  assert.equal(p.obp,2/4); assert.equal(p.babip,1/2);
  assert.equal(p.sdi,(1-2)/4); assert.equal(p.bb_k_ratio,1);
});
test('xwOBA retains actual extra-base-hit inputs, so it is not entirely fielding independent', () => {
  const e=sample('E','line').agg.players[0], extra=sample('2H','line').agg.players[0];
  assert.ok(extra.xwoba > e.xwoba);
  assert.equal(e.xwoba,(.69 + .89*Math.max(0,e.xba*e.t_ab))/e.t_pa);
});
module.exports = {sample};
