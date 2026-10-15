// Read-only release audit. Report booleans/hashes only; never print a credential or a credential-bearing diff.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const main = git('show', '40f2c23:index.html').replace(/\r\n/g, '\n');
const html = read('index.html');
const declaration = /const GITHUB_TOKEN = [^;\r\n]*;/g;
const accepted = main.match(declaration), current = html.match(declaration);
const unchanged = accepted?.length === 1 && current?.length === 1 && accepted[0] === current[0];
const script = page => page.match(/<script>\s*([\s\S]*?)<\/script>/)[1].trim();
const guards = new Set([
  "if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Object.assign(new Error('目前離線，資料已保存在本機，恢復連線後請再同步'), {offline: true});",
  "if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('目前離線，資料已保存在本機，恢復連線後請再同步');",
  "if (!GITHUB_TOKEN) throw new Error('離線版本未保留憑證，請連線後重新開啟網站；本機資料仍保留');"
]);
const withoutGuards = script(html).split('\n').filter(line => !guards.has(line.trim())).join('\n');
const modules = ['lineup-model.js', 'lineup-recommender.js', 'player-diagnostics.js', 'team-insights.js', 'team-records.js'];
const sameModules = modules.every(file => read(file).trim() === git('show', `40f2c23:${file}`).replace(/\r\n/g, '\n').trim());
const encoded = main.match(/const GITHUB_TOKEN = (\[[\d,\s]+\])/);
if (!encoded) throw new Error('Accepted baseline declaration not recognized');
const token = JSON.parse(encoded[1]).map(c => String.fromCharCode(c)).join('');
const copies = [];
const files = new Set([...git('ls-files', '-z').split('\0'), ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')]);
for (const file of [...files].filter(Boolean)) {
  if (file === 'index.html' || !fs.existsSync(path.join(root, file))) continue;
  const bytes = fs.readFileSync(path.join(root, file));
  if (bytes.includes(Buffer.from(token)) || bytes.includes(Buffer.from(token, 'utf16le')) || bytes.includes(Buffer.from(encoded[1]))) copies.push(file);
}
const report = {
  at: new Date().toISOString(), head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
  existingCredentialUnchanged: unchanged, acceptedRisk: 'RISK_ACCEPTED',
  inlineBusinessIdenticalExceptOfflineGuards: withoutGuards === script(main), formulaModulesUnchanged: sameModules,
  additionalCredentialCopies: copies, formalDataDiff: git('diff', '--name-only', '40f2c23', '--', 'data'),
  remoteRefs: git('ls-remote', 'origin', 'refs/heads/main', 'refs/heads/data'),
  pageSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'index.html'))).digest('hex')
};
report.passed = unchanged && report.inlineBusinessIdenticalExceptOfflineGuards && sameModules && !copies.length && !report.formalDataDiff;
const out = process.env.PWA_AUDIT_OUTPUT;
if (out) { fs.mkdirSync(path.dirname(out), {recursive: true}); fs.writeFileSync(out, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
