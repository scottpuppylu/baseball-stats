// Safari before 16.4 (iOS 16.3 and older) cannot parse a regex lookbehind at all: one `(?<=` or `(?<!` in a script
// stops the whole file from running (ui-comfort.js then gives no tab bar, drawer or titles). The site's scripts must
// not use it, and the splits that replaced it must give exactly what the lookbehind gave.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// The one-line helper `const <name> = ...;` from a site script, as a function.
const helper = (file, name) => {
  const line = read(file).split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith(`const ${name} = `));
  assert.ok(line, `${file} defines ${name} on one line`);
  return (0, eval)(line.slice(`const ${name} = `.length).replace(/;$/, ''));
};

test('V-15: no site script uses a regex lookbehind', () => {
  const files = fs.readdirSync(root).filter(f => /\.(js|html)$/.test(f));
  assert.ok(files.includes('ui-comfort.js') && files.includes('team-insights.js') && files.includes('index.html'));
  const found = files.flatMap(f => read(f).split(/\r?\n/).flatMap((l, i) => (/\(\?<[=!]/.test(l) ? [`${f}:${i + 1}`] : [])));
  assert.deepEqual(found, []);
});

// Random strings over the characters that matter to the splits, plus the captions the splits were written for.
const ALPHABET = ['中', '文', '、', '・', '；', '，', '：', '|', '｜', ' ', ' ', 'A', 'b', 'Z', '1', '.', '+', '（', '\n'];
function samples(fixed) {
  let seed = 15;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const out = [...fixed];
  for (let i = 0; i < 5000; i++) out.push(Array.from({length: rand(14)}, () => ALPHABET[rand(ALPHABET.length)]).join(''));
  return out;
}

test('V-15: ui-comfort phraseParts splits a caption exactly as the old lookbehind split did', () => {
  const phraseParts = helper('ui-comfort.js', 'phraseParts');
  const old = text => text.split(/(?<=[・；，：、|｜])|(?<=[一-鿿]) (?=[A-Za-z])/).filter(Boolean);
  const fixed = ['', 'a', '推薦打線 10.84 分・約 3.7 局', '依打擊側判定拉／推；球場落點保持原方向', '加權創造 wRC+', '加權得分創造 wRC+',
    '中 A 中 B', '中  A', 'A 中 B', '、 A', 'x｜y|z', '中 ・A', '中 中 A', '打擊、守備、跑壘', '、、', '安打率，長打率：OPS'];
  for (const text of samples(fixed)) assert.deepEqual(phraseParts(text), old(text), JSON.stringify(text));
});

test('V-15: team-insights splitAfterComma wraps a line exactly as the old lookbehind split did', () => {
  const splitAfterComma = helper('team-insights.js', 'splitAfterComma');
  const old = line => line.split(/(?<=、)/);
  const fixed = ['', 'a', 'a、', '、a', 'a、、b', '王小明、李大華、陳一二', '、', '、、'];
  for (const line of samples(fixed)) assert.deepEqual(splitAfterComma(line), old(line), JSON.stringify(line));
});
