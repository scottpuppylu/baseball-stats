const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

// Digests from 903cf977 before the UI edit: protect the entire business script
// and every existing inline event handler, rather than sample calculations.
test('business script outside the authorized spray archive and Taiwan date changes remains byte-identical to the approved baseline', () => {
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]
    .replace('    // Archived estimated coordinates remain stored; fielding locations and stats stay intact.\n    function isSprayChartArchived(game) {\n      return game?.sprayChartArchive?.excluded === true;\n    }\n\n', '')
    .replace(/^ +if \(isSprayChartArchived\((?:g|game)\)\) return;\n/gm, '')
    .replace('!isSprayChartArchived(game) && pa.x', 'pa.x')
    .replace("${isSprayChartArchived(game) ? '推估座標已封存，不納入噴流圖；守位與成績保留' : `共 ${sprayPointsHtml.length} 顆擊球`}", '共 ${sprayPointsHtml.length} 顆擊球')
    .replace("    // Default dates follow Taiwan time; toISOString() is UTC and lags a day before 08:00.\n    function getTaipeiDateString() {\n      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());\n    }\n\n", '')
    .replace('_${getTaipeiDateString()}.csv', '_${new Date().toISOString().slice(0,10)}.csv')
    .replaceAll('getTaipeiDateString()', 'new Date().toISOString().slice(0, 10)');
  assert.equal(hash(script), '6fb7e6ffe46cd4c480889a2a0d88025f0f32810dd4226a31b5b5ad157f5832a8');
});
test('all original inline action handlers remain identical and in order', () => {
  const handlers = [...html.matchAll(/\bon(?:click|change|submit|input|mouseover|mouseout|mouseenter|mouseleave)\s*=\s*"([^"]*)"/g)].map(x => x[0]).join('\n');
  assert.equal(hash(handlers), '6fcf56a7dd0885fc827fa02aca175a1d16d1af0503b8a5616a50a4e59fdefb23');
});
test('all nine page panels and their original controls remain present', () => {
  for (const name of ['Overview','Profile','Leaderboard','Analytics','Compare','Lineup','Scorebook','Pitching','Glossary']) {
    assert.ok(html.includes(`id="panel${name}"`));
    assert.ok(html.includes(`id="btnTab${name}"`));
  }
  for (const id of ['filterStartDate','filterEndDate','addLogForm','setupLineupGrid','interactiveFieldSvg','trajectoryButtonGroup','rbiButtonGroup','runsScoredButtonGroup','defenseModal','guestModal','substituteModal','pitcherChangeModal','cropModal','gameReviewDetailContainer']) assert.ok(html.includes(`id="${id}"`), id);
});
test('all 282 original static and template DOM identifiers remain intact', () => {
  const added = new Set(['appHeader','mainNavigation','appWorkspace']);
  const ids = [...html.matchAll(/\bid="([^"]*)"/g)].map(match=>match[1]).filter(id=>!added.has(id));
  assert.equal(ids.length,282);
  assert.equal(hash(ids.join('\n')), 'e255c808cc91b83a7b850fe954e4fd5c7073db4286b42db1699d70c4b1da237d');
});
test('presentation script parses and does not directly access persistent data or network', () => {
  const script = fs.readFileSync(path.join(root, 'ui-comfort.js'), 'utf8');
  new vm.Script(script);
  assert.doesNotMatch(script, /\b(?:fetch|localStorage|allLogs|allGames|activeGame|GITHUB_TOKEN)\b/);
});
