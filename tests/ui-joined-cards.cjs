// Isolated preview only: no page paints a background behind a row of separate cards (they would read as one joined bar).
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const url = process.env.UI_PREVIEW_URL || 'http://127.0.0.1:54321';
const problems = [];
(async () => {
  const b = await chromium.launch({channel: 'chrome'});
  for (const [w, h] of [[390, 844], [820, 1180], [1440, 900]]) {
    const c = await b.newContext({viewport: {width: w, height: h}, hasTouch: w < 1024, isMobile: w < 768});
    const p = await c.newPage();
    await p.goto(url);
    await p.waitForFunction(() => window.teamRecords && !syncStatusBadge.textContent.includes('連線同步中'));
    for (const page of ['Home','Overview','Analytics','Pitching','Records','Profile','Leaderboard','Compare','Health','Lineup','Scorebook','Glossary','Changelog']) {
      await p.evaluate(pg => uiNavigation.openPage(pg), page);
      await p.waitForTimeout(700);
      const found = await p.evaluate(() => {
        const painted = el => { const s = getComputedStyle(el); return s.backgroundImage !== 'none' || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'); };
        const card = el => { const s = getComputedStyle(el); return painted(el) && parseFloat(s.borderTopLeftRadius) >= 8 && el.offsetWidth > 60 && el.offsetHeight > 40; };
        const out = [];
        document.querySelectorAll('main *').forEach(el => {
          if (!el.offsetParent || !painted(el) || el.matches('button, input, select, table, tr, td, th, canvas, svg *')) return;
          const kids = [...el.children].filter(k => k.offsetParent && k.offsetHeight > 0);
          if (kids.length < 2 || !kids.every(card)) return;
          const s = getComputedStyle(el);
          const pad = Math.max(parseFloat(s.paddingTop), parseFloat(s.paddingLeft));
          if (pad <= 6) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ').slice(0, 4).join('.')} kids=${kids.length} pad=${pad}`);
        });
        return out;
      });
      if (found.length) problems.push(`${w} ${page}: ${found.join('; ')}`);
    }
    await c.close();
  }
  await b.close();
  assert.deepEqual(problems, [], 'cards joined into one bar');
  console.log(JSON.stringify({passed: true, pages: 13, sizes: [390, 820, 1440]}));
})().catch(e => { console.error(e); process.exitCode = 1; });
