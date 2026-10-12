// npm run build:web — copies exactly the files the website serves into www/ for the Android app (Capacitor webDir).
// The app runs these local files (it is not a shell around the GitHub Pages address). Team data is not bundled:
// like the website, the app reads the latest data from the cloud and falls back to its own on-phone copy offline.
// Fails if a file is missing, if anything outside the list sneaks in, or if a credential pattern shows up.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
const FILES = [
  'index.html', 'manifest.webmanifest',
  'app-config.js', 'cloud-sync.js', 'pwa.js', 'app-native.js',
  'ui-comfort.css', 'ui-comfort.js', 'team-insights.js', 'team-records.js',
  'lineup-model.js', 'lineup-recommender.js', 'player-diagnostics.js'
];
const DIRS = ['vendor', 'assets'];
const SECRET = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|GITHUB_DATA_TOKEN|GOOGLE_CLIENT_SECRET|SESSION_SECRET|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
const copied = [];
const copy = rel => {
  const from = path.join(root, rel), to = path.join(out, rel);
  if (!fs.existsSync(from)) throw new Error(`build:web missing ${rel}`);
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.copyFileSync(from, to);
  copied.push(rel);
};
for (const file of FILES) copy(file);
for (const dir of DIRS) {
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(root, rel), {withFileTypes: true})) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (!entry.name.endsWith('.md')) copy(child);
    }
  };
  walk(dir);
}
// The app (only) loads Capacitor's browser runtime first, so app-native.js / cloud-sync.js can reach the native plugins.
fs.copyFileSync(path.join(root, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'), path.join(out, 'capacitor.js'));
copied.push('capacitor.js');
const indexFile = path.join(out, 'index.html');
const page = fs.readFileSync(indexFile, 'utf8');
const anchor = '<script src="app-config.js';
if (page.split(anchor).length !== 2) throw new Error('build:web: cannot find where to load capacitor.js');
fs.writeFileSync(indexFile, page.replace(anchor, `<script src="capacitor.js"></script>
  ${anchor}`));
for (const rel of copied) {
  if (!/\.(html|js|css|json|webmanifest|svg)$/.test(rel)) continue;
  if (SECRET.test(fs.readFileSync(path.join(out, rel), 'utf8'))) throw new Error(`build:web refused: credential-like text in ${rel}`);
}
const manifest = {
  builtAt: new Date().toISOString(),
  files: Object.fromEntries(copied.map(rel => [rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(out, rel))).digest('hex').slice(0, 16)]))
};
fs.writeFileSync(path.join(out, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`build:web → www/ (${copied.length} files, no team data, no credentials)`);
