// WO-06 R2 新版場記「記分畫面」美術跟網站一致（只改外觀，流程、資料、按鍵種類與數量不變）：
//   A3/AC-3 記分板兩隊上下排、膠囊全文；壓力狀態（兩位數比分＋「待上傳 99」＋最長姓名）下記分盤每顆鍵位置和平常一樣（0 px），4 種尺寸。
//   A5 記分盤固定位置：安打 → 其他上壘 → 出局；鍵高 ≥60、間距 7–8、圓角 12；A2 鍵帽、標籤、本場成績、球場、名單列是深色實底。
//   A4 打者卡兩行；A6 球場一直在、有左中右外野字；A7 sheet 頂部圓角 24、名單列 52–56 高、目前打者藍框。
//   AC-5 結果標籤、本場成績標籤、記分盤字（實底上）與閃色（亮底黑字）對比 ≥7:1，用實際合成後的顏色算。
//   A9 轉場加固：同一節點不同時動畫 transform 與 backdrop-filter、沒有 will-change、模糊只在 .v2-veil（有 -webkit-、不用變數）；
//      全螢幕時底下網站 inert，離開後還原、焦點回入口；轉場中轉向立即結束；捲走設定卡後離開改原地淡出。
// 用法：node tests/ui-v2-art.cjs（自己起隔離預覽，port 54516）；GitHub 用預覽的假 API，不寫 data/*.json。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const hashes = () => Object.fromEntries(fs.readdirSync(path.join(root, 'data')).map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', f))).digest('hex')]));

function startPreview(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'ui-preview-server.cjs')], {cwd: root, env: {...process.env, UI_PREVIEW_PORT: String(port)}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    const timer = setTimeout(() => reject(new Error('preview startup timed out')), 15000);
    child.once('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(child); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited ${code}`)); });
  });
}
const SIZES = [['phone-390', 390, 844], ['tablet-portrait', 820, 1180], ['tablet-landscape', 1180, 820], ['desktop-1440', 1440, 900]];
const PAD_ORDER = ['1H', '2H', '3H', 'HR', 'BB', 'GO', 'FO', 'LO', 'K', 'E', 'DP', 'FC', 'SF', '界外K', 'RO'];
const LONG_NAME = '司馬歐陽長名字測試員';

(async () => {
  const diskBefore = hashes();
  const css = fs.readFileSync(path.join(root, 'ui-v2.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'scorebook-v2.js'), 'utf8');
  const passed = [];
  // ---------- A9 靜態：沒有 will-change；模糊只在 .v2-veil，有 -webkit-、半徑不用變數 ----------
  {
    for (const [f, s] of [['ui-v2.css', css], ['scorebook-v2.js', js]]) {
      assert.doesNotMatch(s, /:has\(/, `${f}: no :has()`);
      assert.doesNotMatch(s, /will-change/i, `${f}: no will-change`);
    }
    assert.doesNotMatch(js, /backdropFilter|backdrop-filter/, 'scorebook-v2.js never animates or sets backdrop-filter');
    const blurRules = css.split('}').filter(r => /(^|[^-])backdrop-filter:\s*blur/.test(r));
    assert.equal(blurRules.length, 1, 'exactly one blur layer in the scorebook (.v2-veil)');
    assert.match(blurRules[0], /\.v2-veil\s*\{/, 'the blur layer is .v2-veil');
    assert.match(blurRules[0], /-webkit-backdrop-filter:\s*blur\(\d+px\)/, '.v2-veil writes -webkit-backdrop-filter');
    assert.doesNotMatch(blurRules[0], /blur\(var\(/, 'blur radius is a literal, not a CSS variable');
    passed.push('A9 沒有 will-change；模糊只有 .v2-veil 一層（-webkit- 前綴、半徑寫死、JS 不動 backdrop-filter）；沒有 :has()');
  }

  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { preview = await startPreview(54516); url = 'http://127.0.0.1:54516'; }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  let externalGitHub = 0;
  const open = async (w, h) => {
    const context = await browser.newContext({viewport: {width: w, height: h}, isMobile: w < 768, hasTouch: w < 1200});
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(`${w}x${h}: ${error.message}`));
    await page.goto(url + '/?ui=v2');
    await page.waitForFunction(() => window.teamRecords && window.uiV2 && window.uiV2.live && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
    await page.evaluate(() => switchMainTab('tabScorebook'));
    await page.waitForFunction(() => document.body.classList.contains('v2-setup-on') && document.querySelector('.v2l-setup .v2u-start'));
    await fill(page);
    await page.evaluate(() => { window.__inertBase = [...document.body.children].filter(e => e.inert).length; });
    return {context, page};
  };
  // 開賽設定填好：打線用目前打線頁那份（第一次）或上一場的打線（清除後再開）。
  const fill = page => page.evaluate(() => {
    if (typeof renderSetupLineupGrid === 'function') renderSetupLineupGrid();
    const s = window.uiV2.live.state.setup;
    s.dh = !!isDhEnabled; const n = s.dh ? 11 : 10;
    const prev = window.__artLineup;
    s.lineup = (prev ? prev.lineup : setupLineupList).slice(0, n); s.pos = (prev ? prev.pos : setupLineupPositions).slice(0, n); s.touched = true;
    window.__artLineup = {lineup: s.lineup.slice(), pos: s.pos.slice()};
    window.uiV2.live.render();
    const el = document.querySelector('.v2l-setup [data-su="opponent"]'); el.value = '美術測試'; el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  const tap = (page, sel) => page.evaluate(sel => { window.uiV2.live.state.busyUntil = 0; const b = document.querySelector(sel); if (!b) throw new Error('missing ' + sel); b.click(); }, sel);
  const startGame = async page => {
    await page.evaluate(() => document.querySelector('.v2l-setup [data-act="su-start"]').focus());
    await tap(page, '.v2l-setup [data-act="su-start"]');
    await page.waitForFunction(() => document.body.classList.contains('v2-live-on') && !document.querySelector('.v2-live').getAnimations().length);
  };
  const recordPa = async (page, code) => {
    await tap(page, `.v2-live [data-act="off"][data-code="${code}"]`);
    if (await page.$('.v2l-sheet [data-v2-field]')) await page.evaluate(() => { const svg = document.querySelector('.v2l-sheet [data-v2-field]'); const r = svg.getBoundingClientRect(); svg.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: r.left + r.width * .62, clientY: r.top + r.height * .35})); });
    if (await page.$('.v2l-sheet [data-act="pa-submit"]')) await tap(page, '.v2l-sheet [data-act="pa-submit"]');
  };
  const keyRects = page => page.evaluate(() => [...document.querySelectorAll('.v2-live .v2l-padwrap button')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.code || b.dataset.act, Math.round(r.left * 100) / 100, Math.round(r.top * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100]; }));

  try {
    const contrastLog = {};
    for (const [name, w, h] of SIZES) {
      const {context, page} = await open(w, h);
      await startGame(page);
      // 幾個打席：本場成績標籤、本半局清單、球場落點都有東西（保送、一安、三振；不到三出局）。
      await recordPa(page, 'BB');
      await recordPa(page, '1H');
      await recordPa(page, 'K');
      await page.evaluate(() => { const g = activeGame; g.currentBatterIdx = 0; window.uiV2.live.render(); });
      await page.waitForTimeout(450);
      // ---------- A3／A4／A5／A6 結構與外觀 ----------
      const lookOf = () => page.evaluate(() => {
        const live = document.querySelector('.v2-live');
        const cs = el => getComputedStyle(el);
        const keys = [...live.querySelectorAll('.v2l-pad [data-act="off"]')];
        const rects = keys.map(k => k.getBoundingClientRect());
        const teams = [...live.querySelectorAll('.v2l-score .v2l-team')].map(t => t.getBoundingClientRect());
        const scores = [...live.querySelectorAll('.v2l-score b')].map(b => b.getBoundingClientRect());
        const cap = live.querySelector('.v2l-cap');
        const field = live.querySelector('.v2l-field');
        const fr = field.getBoundingClientRect();
        return {
          order: keys.map(k => k.dataset.code),
          tones: keys.map(k => [...k.classList].find(c => c.startsWith('tone-'))),
          minH: Math.min(...rects.map(r => r.height)),
          gap: Math.round(rects[1].left - rects[0].right),
          radius: cs(keys[0]).borderTopLeftRadius,
          keyBg: cs(keys[0]).backgroundColor,
          stacked: teams.length === 2 && teams[0].bottom <= teams[1].top + 1,
          baseline: scores.map((s, i) => Math.abs(s.bottom - teams[i].bottom) < 12),
          scoreRight: scores.length === 2 && Math.abs(scores[0].right - scores[1].right) < 1,
          capFull: cap.scrollWidth <= cap.clientWidth + 1 && cs(cap).textOverflow !== 'ellipsis',
          card: !!live.querySelector('.v2l-card .v2l-card-l1 .v2l-card-name') && !!live.querySelector('.v2l-card .v2l-card-l2 .v2l-stats'),
          stats: [...live.querySelectorAll('.v2l-card .v2l-stat')].map(s => ({bg: cs(s).backgroundColor, tone: [...s.classList].find(c => c.startsWith('tone-'))})),
          tagBg: [...live.querySelectorAll('.v2l-recent .v2l-tag')].map(t => cs(t).backgroundColor),
          field: {h: fr.height, bg: cs(field).backgroundColor, dirs: [...field.querySelectorAll('.v2f-dir')].map(t => t.textContent)},
          liveBlur: [...live.querySelectorAll('*')].filter(e => !['none', ''].includes(cs(e).backdropFilter || 'none')).length,
          overflowX: document.documentElement.scrollWidth > innerWidth || live.scrollWidth > live.clientWidth + 1
        };
      });
      const look = await lookOf();
      assert.deepEqual(look.order, ['1H', '2H', '3H', 'HR', 'BB', 'GO', 'FO', 'LO', 'K', 'E', 'DP', 'FC', 'SF', '界外K', 'RO'], `${name}: pad slots fixed, hits → other on-base → outs`);
      for (const [i, code] of look.order.entries()) if (['GO', 'FO', 'LO', 'K', 'DP', 'FC', 'SF', '界外K', 'RO'].includes(code)) assert.equal(look.tones[i], 'tone-out', `${name}: ${code} is in the red (out) family`);
      assert.ok(look.minH >= 60, `${name}: keys ≥60 px tall (${look.minH})`);
      assert.ok(look.gap >= 7 && look.gap <= 8, `${name}: key gap 7–8 px (${look.gap})`);
      assert.equal(look.radius, '12px', `${name}: key radius 12`);
      assert.deepEqual([look.stacked, look.baseline, look.scoreRight], [true, [true, true], true], `${name}: two teams stacked, name and score on one line, scores right-aligned`);
      assert.equal(look.capFull, true, `${name}: sync capsule shows its full text`);
      assert.equal(look.card, true, `${name}: batter card has two lines (name / this game's stats)`);
      assert.ok(look.stats.length >= 1, `${name}: this-game stat tag shown`);
      assert.ok(look.field.h >= 60, `${name}: spray field visible (${Math.round(look.field.h)} px)`);
      assert.deepEqual(look.field.dirs, ['左外野', '中外野', '右外野'], `${name}: outfield direction labels`);
      assert.equal(look.liveBlur, 0, `${name}: no backdrop blur inside the live screen`);
      assert.equal(look.overflowX, false, `${name}: no horizontal overflow`);

      // ---------- AC-3 壓力狀態下記分盤鍵位不動 ----------
      const normal = await keyRects(page);
      await page.evaluate(longName => {
        const g = activeGame;
        const keep = {score: g.finalScore, opp: g.opponent, name: g.lineup[g.currentBatterIdx]};
        window.__artKeep = keep;
        g.finalScore = {us: 12, opp: 15};
        g.opponent = '超長名字的對手球隊聯隊';
        g.lineup[g.currentBatterIdx] = longName;
        window.uiV2.live.render();
        const cap = document.querySelector('.v2-live .v2l-cap');
        const walk = document.createTreeWalker(cap, NodeFilter.SHOW_TEXT); let txt = null;
        for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.textContent.trim()) txt = n;
        if (!txt) txt = cap.appendChild(document.createTextNode(''));
        cap.className = cap.className.replace(/\bv2c-\w+/g, '') + ' v2c-pend';
        txt.textContent = '待上傳 99';
      }, LONG_NAME);
      await page.waitForTimeout(50);
      const stressed = await keyRects(page);
      const stress = await page.evaluate(() => {
        const live = document.querySelector('.v2-live');
        const cap = live.querySelector('.v2l-cap');
        return {cap: cap.textContent.trim(), capFull: cap.scrollWidth <= cap.clientWidth + 1, scores: [...live.querySelectorAll('.v2l-score b')].map(b => [b.textContent, b.scrollWidth <= b.clientWidth + 1]),
          overflowX: document.documentElement.scrollWidth > innerWidth || live.scrollWidth > live.clientWidth + 1, name: live.querySelector('.v2l-card-name').textContent};
      });
      assert.equal(stress.name, LONG_NAME, `${name}: longest name rendered`);
      assert.deepEqual([stress.cap, stress.capFull], ['待上傳 99', true], `${name}: capsule shows 待上傳 99 in full`);
      assert.deepEqual(stress.scores, [['12', true], ['15', true]], `${name}: two-digit scores fit`);
      assert.equal(stress.overflowX, false, `${name}: no overflow under stress`);
      assert.deepEqual(stressed, normal, `${name}: every pad key at the same position (0 px) with two-digit scores, 待上傳 99 and the longest name`);
      await page.evaluate(() => { const g = activeGame; const k = window.__artKeep; g.finalScore = k.score; g.opponent = k.opp; g.lineup[g.currentBatterIdx] = k.name; window.uiV2.live.render(); });

      // ---------- A7 名單 sheet ----------
      await tap(page, '.v2-live [data-act="menu"]');
      await tap(page, '.v2l-sheet [data-act="sub"]');
      const sheet = await page.evaluate(() => {
        const s = document.querySelector('.v2-live .v2l-sheet');
        const items = [...s.querySelectorAll('.v2s-item')];
        const on = s.querySelector('.v2s-item.on');
        return {radius: getComputedStyle(s).borderTopLeftRadius, h: items.map(i => Math.round(i.getBoundingClientRect().height)), bg: [...new Set(items.map(i => getComputedStyle(i).backgroundColor))],
          on: on && getComputedStyle(on).borderTopColor, onIdx: items.indexOf(on), cur: activeGame.currentBatterIdx};
      });
      assert.equal(sheet.radius, '24px', `${name}: sheet top radius 24`);
      for (const hh of sheet.h) assert.ok(hh >= 52 && hh <= 56, `${name}: roster row 52–56 px (${hh})`);
      assert.deepEqual([sheet.onIdx, sheet.on], [sheet.cur, 'rgb(124, 192, 255)'], `${name}: current batter has a blue border`);
      await tap(page, '.v2l-sheet [data-act="close"]');

      // ---------- 高對比模式（WO-09 起，實底與 ≥7:1 只在高對比模式檢查（高對比本來就是 #000）；一般模式由 ui-v2-premium.cjs 依 R4～R9 檢查） ----------
      await page.waitForFunction(() => !window.uiV2.live.state.sheet);
      await tap(page, '.v2-live [data-act="menu"]');
      await tap(page, '.v2l-sheet [data-act="hc"]');
      if (await page.$('.v2l-sheet [data-act="close"]')) await tap(page, '.v2l-sheet [data-act="close"]');
      await page.waitForFunction(() => document.querySelector('.v2-live').classList.contains('hc') && !window.uiV2.live.state.sheet);
      await page.waitForTimeout(450);
      const hcLook = await lookOf();
      assert.equal(hcLook.keyBg, 'rgb(0, 0, 0)', `${name}: high contrast: keys are solid #000`);
      assert.ok(hcLook.stats.length >= 1, `${name}: high contrast: this-game stat tag shown`);
      for (const s of hcLook.stats) assert.equal(s.bg, 'rgb(0, 0, 0)', `${name}: high contrast: stat tag solid fill`);
      for (const bg of hcLook.tagBg) assert.equal(bg, 'rgb(0, 0, 0)', `${name}: high contrast: result tag solid fill`);
      assert.equal(hcLook.field.bg, 'rgb(0, 0, 0)', `${name}: high contrast: field solid black`);
      assert.equal(hcLook.radius, '12px', `${name}: high contrast: key radius 12`);
      // ---------- AC-5 對比（實際合成色） ----------
      const con = await page.evaluate(() => {
        const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
        const lum = ([r, g, b]) => { const c = [r, g, b].map(v => v / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
        // 元素實際底色：往上把半透明底色一層層疊到不透明為止（最底是頁面底色）。
        const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; } let base = [10, 11, 14]; for (const c of stack.reverse()) base = over(c, base); return base; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const measure = el => { const fg = parse(getComputedStyle(el).color); return Math.round(ratio(over(fg, bgOf(el)), bgOf(el)) * 100) / 100; };
        const out = {};
        for (const el of document.querySelectorAll('.v2-live .v2l-recent .v2l-tag, .v2-live .v2l-card .v2l-stat, .v2-live .v2l-pad [data-act="off"] b')) {
          const key = (el.classList.contains('v2l-tag') ? 'tag ' : el.classList.contains('v2l-stat') ? 'stat ' : 'key ') + ([...(el.closest('[class*="tone-"]') || el).classList].find(c => c.startsWith('tone-')) || '');
          out[key] = Math.min(out[key] ?? 99, measure(el));
        }
        // 閃色：記分板整塊變語意色、字變 --v2-dark（同 V2 規則；只量，不觸發）。
        const dark = [11, 13, 16, 1];
        for (const t of ['out', 'hit', 'on', 'run', 'white']) {
          const probe = document.createElement('i'); probe.style.color = `var(--v2-${t})`; document.querySelector('.v2-live').appendChild(probe);
          out['flash ' + t] = Math.round(ratio(parse(getComputedStyle(probe).color), dark) * 100) / 100; probe.remove();
        }
        return out;
      });
      for (const [k, r] of Object.entries(con)) assert.ok(r >= 7, `${name}: high contrast: ${k} contrast ${r}:1 ≥ 7:1`);
      for (const tone of ['tone-out', 'tone-hit', 'tone-on']) assert.ok(con['key ' + tone] && con['tag ' + tone], `${name}: high contrast: measured keys and tags in ${tone}`);
      contrastLog[name] = con;

      await tap(page, '.v2-live [data-act="menu"]');
      await tap(page, '.v2l-sheet [data-act="sub"]');
      const hcSheet = await page.evaluate(() => [...new Set([...document.querySelectorAll('.v2-live .v2l-sheet .v2s-item')].map(i => getComputedStyle(i).backgroundColor))]);
      assert.deepEqual(hcSheet, ['rgb(0, 0, 0)'], `${name}: high contrast: roster rows solid black`);
      await tap(page, '.v2l-sheet [data-act="close"]');

      // ---------- A9 全螢幕時底下 inert；離開後還原 ----------
      const inert = await page.evaluate(() => ({main: !!document.querySelector('main')?.closest('[inert]'), live: document.querySelector('.v2-live').inert}));
      assert.deepEqual(inert, {main: true, live: false}, `${name}: the site under the full-screen scorebook is inert`);
      await context.close();
    }
    passed.push('A3–A7 4 尺寸：記分盤固定位置（安打→上壘→出局、出局全紅）、鍵高 ≥60、間距 7–8、圓角 12、實底（WO-09 起只檢查高對比模式，實底 #000）；兩隊上下排比分右齊；膠囊全文；打者卡兩行＋本場成績實底標籤；球場在、左中右外野；名單 sheet 圓角 24、列高 52–56、目前打者藍框、列實底 #000（只檢查高對比模式）；記分畫面內 0 個 backdrop blur');
    passed.push('AC-3 兩位數比分＋「待上傳 99」＋最長姓名：4 尺寸記分盤每顆鍵位置 0 px 差、膠囊與比分不截斷、無溢出');
    const flat = Object.values(contrastLog).flatMap(c => Object.values(c));
    passed.push(`AC-5 結果標籤、本場成績、記分盤字、閃色對比最低 ${Math.min(...flat)}:1（高對比模式，全部 ≥7:1，合成後實際顏色；一般模式見 ui-v2-premium）`);
    fs.writeFileSync(path.join(process.env.UI_QA_OUTPUT || require('node:os').tmpdir(), 'ui-v2-art-contrast.json'), JSON.stringify(contrastLog, null, 2));

    // ---------- A9 轉場：轉向立即結束；離開還原 inert 與焦點；捲走設定卡後原地淡出 ----------
    {
      const {context, page} = await open(390, 844);
      // 轉場中改尺寸：動畫立即結束。
      const rot = await page.evaluate(() => new Promise(resolve => {
        window.uiV2.live.state.busyUntil = 0;
        document.querySelector('.v2l-setup [data-act="su-start"]').click();
        const anim = document.querySelector('.v2-live').getAnimations().find(a => a.id === 'v2-enter');
        window.dispatchEvent(new Event('resize'));
        const state = anim && anim.playState;
        requestAnimationFrame(() => resolve({had: !!anim, state, left: document.querySelector('.v2-live').getAnimations().length}));
      }));
      assert.deepEqual(rot, {had: true, state: 'finished', left: 0}, 'resize/rotation during the transition finishes it at once');
      await page.waitForFunction(() => document.body.classList.contains('v2-live-on'));
      await page.waitForTimeout(100);
      // 清除此場 → 回開賽設定：底下 inert 還原、焦點回開始鍵、從設定卡收回。
      await tap(page, '.v2-live [data-act="menu"]');
      await tap(page, '.v2l-sheet [data-act="clear"]');
      const back = await page.evaluate(() => new Promise(resolve => {
        window.uiV2.live.state.busyUntil = 0;
        document.querySelector('.v2l-sheet [data-act="clear-yes"]').click();
        const t0 = performance.now();
        const wait = () => {
          const anim = document.querySelector('.v2-live').getAnimations().find(a => a.id === 'v2-exit');
          if (!anim && performance.now() - t0 < 1500) { requestAnimationFrame(wait); return; }
          const props = anim ? Object.keys(anim.effect.getKeyframes()[0]).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).sort() : [];
          (anim ? anim.finished : Promise.resolve()).then(() => requestAnimationFrame(() => resolve({props, inert: [...document.body.children].filter(e => e.inert && !e.classList.contains('v2-ghost')).length - window.__inertBase,
            focus: document.activeElement && (document.activeElement.dataset.act || document.activeElement.tagName), setup: document.body.classList.contains('v2-setup-on')})));
        };
        wait();
      }));
      assert.deepEqual(back, {props: ['clipPath', 'opacity'], inert: 0, focus: 'su-start', setup: true}, 'leaving back to setup: shrinks into the setup card, page no longer inert, focus back on the start button');
      // 捲到設定卡看不見再開始、離開：原地淡出（不飛到畫面外）。
      await fill(page);
      await startGame(page);
      const away = await page.evaluate(() => new Promise(resolve => {
        // 記分中把頁面捲到底（設定卡在畫面外），模擬「捲動後才離開」。
        document.body.style.minHeight = '6000px'; window.scrollTo(0, 5000);
        window.uiV2.live.state.busyUntil = 0;
        document.querySelector('.v2-live [data-act="menu"]').click();
        window.uiV2.live.state.busyUntil = 0;
        document.querySelector('.v2l-sheet [data-act="clear"]').click();
        window.uiV2.live.state.busyUntil = 0;
        // 離開時會捲回按開始時的位置：這裡把記錄的位置改到很下面，讓卡片確定不在畫面裡。
        window.uiV2.live.state.entryScroll = 5000;
        document.querySelector('.v2l-sheet [data-act="clear-yes"]').click();
        const t0 = performance.now();
        const wait = () => {
          const anim = document.querySelector('.v2-live').getAnimations().find(a => a.id === 'v2-exit');
          if (!anim && performance.now() - t0 < 1500) { requestAnimationFrame(wait); return; }
          const r = document.querySelector('.v2l-setup').getBoundingClientRect();
          resolve({props: anim ? Object.keys(anim.effect.getKeyframes()[0]).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).sort() : [], cardTop: Math.round(r.top), vh: innerHeight});
        };
        wait();
      }));
      assert.ok(away.cardTop > away.vh || away.cardTop + 100 < 0, `the setup card is off screen for this case (${JSON.stringify(away)})`);
      assert.deepEqual(away.props, ['opacity'], 'exit with the setup card scrolled away fades in place');
      await page.evaluate(() => { document.body.style.minHeight = ''; });
      await context.close();
      passed.push(`A9 轉場中轉向立即結束；離開回開賽設定從卡片收回、底下網站不再 inert、焦點回開始鍵；設定卡捲走時原地淡出（${away.props.join('+')}）`);
    }

    assert.deepEqual(errors, [], 'no page errors');
    assert.equal(externalGitHub, 0, 'no request reached GitHub');
    assert.deepEqual(hashes(), diskBefore, 'data/*.json untouched');
    for (const line of passed) console.log(`PASS ${line}`);
    console.log(`ui-v2-art: ${passed.length} checks passed`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
