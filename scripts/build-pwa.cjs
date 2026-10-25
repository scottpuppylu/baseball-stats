// Deterministic release builder: change the original HTML in place; never create a second credential file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const extras = ['vendor/fonts/tk-sans-400.woff2', 'vendor/fonts/tk-sans-500.woff2', 'vendor/fonts/tk-sans-700.woff2', 'vendor/fonts/inter-latin-400.woff2', 'vendor/fonts/inter-latin-500.woff2', 'vendor/fonts/inter-latin-600.woff2', 'vendor/fonts/inter-latin-700.woff2', 'assets/logo-128.webp', 'assets/logo-256.webp', 'assets/logo-512.webp', 'assets/bg-orbit.webp', 'assets/bg-orbit-portrait.webp', 'assets/bg-profile.webp', 'assets/bg-profile-portrait.webp', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/maskable-192.png', 'assets/icons/maskable-512.png'];
function build(read) {
  let html = read('index.html').toString().replace(/\r\n/g, '\n');
  html = html.replace(/\s*<meta name="baseball-release" content="[^"]+">/g, '');
  const worker = read('sw.js').toString().replace(/\r\n/g, '\n').replace(/const RELEASE = .*; \/\/ generated-release/, 'const RELEASE = null; // generated-release');
  const files = new Map();
  html = html.replace(/(<(?:script|link)\b[^>]*(?:src|href)=")([^"?#]+)(?:\?[^"#]*)?("[^>]*>)/g, (all, before, file, after) => {
    if (/^(?:https?:|\/\/|data:)/.test(file)) throw new Error('External program dependency');
    const bytes = read(file); files.set(file, bytes);
    return before + file + '?v=' + digest(bytes).slice(0, 20) + after;
  });
  for (const file of extras) files.set(file, read(file));
  const version = digest(html + worker + [...files].map(([file, bytes]) => file + digest(bytes)).join('\n')).slice(0, 24);
  html = html.replace('<head>', `<head>\n  <meta name="baseball-release" content="${version}">`);
  files.set('index.html', Buffer.from(html));
  const entries = [...files].map(([file, bytes]) => ({file, sha256: digest(bytes), url: file === 'index.html' ? file : file + '?v=' + digest(bytes).slice(0, 20)}));
  const release = {version, files: entries};
  files.set('sw.js', Buffer.from(worker.replace('const RELEASE = null; // generated-release', 'const RELEASE = ' + JSON.stringify(release) + '; // generated-release')));
  return {version, files, release};
}
module.exports = {build, digest};
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const result = build(file => fs.readFileSync(path.join(root, file)));
  for (const file of ['index.html', 'sw.js']) fs.writeFileSync(path.join(root, file), result.files.get(file));
  const stageAt = process.argv.indexOf('--stage');
  if (stageAt !== -1) {
    const stage = path.resolve(process.argv[stageAt + 1]);
    if (stage === root || stage.startsWith(root + path.sep)) throw new Error('Stage must be outside source checkout');
    fs.mkdirSync(stage, {recursive: true});
    for (const file of result.files.keys()) {
      fs.mkdirSync(path.dirname(path.join(stage, file)), {recursive: true});
      fs.renameSync(path.join(root, file), path.join(stage, file));
    }
    // Preserve the site's existing last-resort public JSON fallback, but never put it in the SW shell cache.
    fs.renameSync(path.join(root, 'data'), path.join(stage, 'data'));
    fs.writeFileSync(path.join(stage, '.nojekyll'), '');
  }
  console.log(JSON.stringify({version: result.version, publicFiles: result.files.size, credentialFiles: 1}));
}
