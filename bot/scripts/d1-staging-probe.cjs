// Isolated remote Staging DB probe. No LINE requests; cleans only its own UUID-tagged rows.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');process.chdir(root);
const {config,error}=require('typescript').parseConfigFileTextToJson('bot/wrangler.jsonc',fs.readFileSync('bot/wrangler.jsonc','utf8'));
assert.equal(error,undefined);
const db=config.env.staging.d1_databases[0];
assert.equal(db.binding,'DB');assert.equal(db.database_name,'tk-aero-line-bot-staging');
assert.notEqual(db.database_id,config.d1_databases[0].database_id);
assert.match(db.database_id,/^[0-9a-f-]{36}$/i);
const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const id='__deployment_probe_'+randomUUID(),quote=s=>"'"+s.replaceAll("'","''")+"'",q=quote(id);
const run=sql=>{const p=spawnSync(process.execPath,[cli,'d1','execute','DB','--remote','--config','bot/wrangler.jsonc','--env','staging','--json','--command',sql],{cwd:root,encoding:'utf8'});if(p.status!==0)throw Error('Staging D1 probe failed; '+(p.stderr||p.stdout).slice(-1000));return JSON.parse(p.stdout);};
const pick=results=>results.flatMap(r=>r.results||[]);
try{
  run(`INSERT INTO bot_members VALUES(${q},'probe-a','probe-player-a-${id}','部署測試甲','player',1); INSERT INTO bot_members VALUES(${q},'probe-b','probe-player-b-${id}','部署測試乙','player',1); INSERT INTO bot_matches VALUES(${q},${q},9999999999999,9999999999990,9999999999900,'隔離探測球場','隔離探測對手','部署探測，非正式比賽','probe-a',0); INSERT INTO bot_attendance VALUES(${q},'probe-a','yes',1,'probe-event-a',1); INSERT INTO bot_attendance VALUES(${q},'probe-b','no',1,'probe-event-b',1); INSERT INTO bot_events VALUES(${q},${q},'done',1); INSERT OR IGNORE INTO bot_events VALUES(${q},${q},'done',1);`);
  run(`INSERT INTO bot_attendance VALUES(${q},'probe-a','maybe',2,'probe-event-new',1) ON CONFLICT(match_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,version=bot_attendance.version+1 WHERE excluded.updated_at>bot_attendance.updated_at; INSERT INTO bot_attendance VALUES(${q},'probe-a','yes',1,'probe-event-old',1) ON CONFLICT(match_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,version=bot_attendance.version+1 WHERE excluded.updated_at>bot_attendance.updated_at;`);
  const rows=pick(run(`SELECT user_id,status,version FROM bot_attendance WHERE match_id=${q} ORDER BY user_id`));
  assert.deepEqual(rows,[{user_id:'probe-a',status:'maybe',version:2},{user_id:'probe-b',status:'no',version:1}]);
  const events=pick(run(`SELECT count(*) AS n FROM bot_events WHERE id=${q}`));assert.equal(events[0].n,1);
  const members=pick(run(`SELECT count(*) AS n FROM bot_members WHERE group_id=${q}`));assert.equal(members[0].n,2);
  const result={ok:true,database:'tk-aero-line-bot-staging',binding:'DB',scope:'remote D1 SQL only; not a real LINE or Worker webhook test',bindingsPersisted:2,attendancePersisted:2,newerStatusPreserved:true,eventDeduplicated:true,lineRequests:0};
  fs.mkdirSync('.local',{recursive:true});fs.writeFileSync('.local/line-staging-d1-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{run(`DELETE FROM bot_attendance WHERE match_id=${q}; DELETE FROM bot_events WHERE id=${q}; DELETE FROM bot_matches WHERE id=${q}; DELETE FROM bot_members WHERE group_id=${q};`);}
