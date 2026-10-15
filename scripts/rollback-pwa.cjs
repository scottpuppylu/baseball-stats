// Roll back the PWA cache layer with a public setting only. Never copy or modify index.html or the credential.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const BASE = '40f2c23cf086c7af2e4fc0ee222d6fe7b8ae6633';
function rollbackConfig() {
  const config = fs.readFileSync(path.join(root, 'app-config.js'), 'utf8');
  if ((config.match(/^\s*serviceWorker: (true|false)\s*$/gm) || []).length !== 1) throw new Error('Unexpected rollback setting; no files changed');
  return config.replace(/^(\s*serviceWorker:) (true|false)/m, '$1 false');
}
module.exports = {rollbackConfig, BASE};
if (require.main === module) {
  const config = rollbackConfig();
  if (process.argv.includes('--apply')) {
    fs.writeFileSync(path.join(root, 'app-config.js'), config);
    console.log('PWA cache rollback prepared in app-config.js. Run tests, commit, PR and CI before deployment. index.html and data/ were not touched.');
  } else console.log(JSON.stringify({businessBaseline: BASE, touchesCredential: false, touchesData: false, mode: 'check-only', preview: '/baseball-stats/?rollback'}));
}
