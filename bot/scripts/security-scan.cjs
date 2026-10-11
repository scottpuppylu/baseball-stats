// Current source only; report file paths, never matched credential values.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');process.chdir(root);
const files=new Set(cp.execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n'));
function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name);if(d.isDirectory())walk(f);else files.add(f.replaceAll('\\','/'));}}
walk('bot');files.add('.env.example');
const findings=[];let checked=0;
for(const f of files){if(!fs.existsSync(f)||!/\.(html|js|cjs|mjs|ts|json|jsonc|yml|md)$/.test(f))continue;checked++;const s=fs.readFileSync(f,'utf8');if(/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s))findings.push(f);}
const result={checked,credentialPatternFindings:findings,scope:'current tracked source and bot files; historical commits and deployed website excluded',historicalTokenRevocation:'owner action required'};
fs.mkdirSync('.local',{recursive:true});fs.writeFileSync('.local/line-security-scan.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(findings.length)process.exitCode=1;
