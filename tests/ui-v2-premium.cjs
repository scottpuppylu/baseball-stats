// WO-09（PO-48）新版場記一般模式「鏡片玻璃」：照 ART_GAP R1～R10 檢查一般模式外觀；高對比模式完全不動。
//   靜態：WO-09 區塊每條規則都限 .v2-live:not(.hc)（或 .tone-* 變數），沒有 backdrop-filter、:has()、will-change。
//   R1 背景是總覽場景（bg-overview）；R2 比分板／打者卡／本半局／球場是半透明材質、圓角 22；R4 數字用 --fl-font 700；
//   PO-49 一般模式球場彩色（外野草地暗綠、內野整片紅土暗土色），落點與標落點 ≥4.5:1；
//   R5 本場成績是膠囊；R7 結果鍵是鍵帽（雙層漸層、彩虹邊遮罩、上緣高光＋落影），圓角維持 12；R8 球場線 1.5、內野 1.75；
//   R9 sheet 有把手（36×5）、列是材質卡、送出鍵是白色膠囊（D3）。
//   AC-3 對比用實際畫面像素算：截圖兩次（字顯示／字透明），字心像素對它底下最不利的底色（最差 2% 分位，排除星點這種孤立亮點）；球場線整組一起量（線與草地外框重疊）；字 ≥4.5:1，球場線與沒亮的出局燈 ≥3:1。
//   AC-6 按下回饋：一般模式按下當下就有 brightness(1.18)＋scale(.97)（截圖像素有變），排版 0 px 變動；放開 80 ms 回彈、單調不跳。
//   AC-7 字型：結果鍵英文數字 Serif Flight 700、中文落到黑體（TK Gothic 排在明體前面），小字 500；字型檔已載入。
//   高對比：背景無圖、鍵實底 #000、沒有彩虹邊（::before 不存在）。
// 用法：node tests/ui-v2-premium.cjs（自己起隔離預覽，port 54518）；GitHub 用預覽的假 API，不寫 data/*.json。
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
const splitSel = x => { const o = []; let d = 0, c = ''; for (const ch of x) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { o.push(c.trim()); c = ''; } else c += ch; } o.push(c.trim()); return o; };

(async () => {
  const diskBefore = hashes();
  const passed = [];
  // ---------- 靜態 ----------
  {
    const css = fs.readFileSync(path.join(root, 'ui-v2.css'), 'utf8');
    const at = css.indexOf('/* ===================== WO-09');
    assert.ok(at > 0, 'WO-09 block present in ui-v2.css');
    const block = css.slice(at).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(block, /backdrop-filter|:has\(|will-change/, 'WO-09 block: no backdrop-filter, :has(), will-change');
    let n = 0;
    for (const m of block.matchAll(/([^{}]+)\{/g)) {
      const sel = m[1].trim();
      if (sel.startsWith('@')) continue;
      for (const p of splitSel(sel)) { n++; assert.ok(/^\.v2-live(\.[\w-]+)*:not\(\.hc\)/.test(p) || /^\.tone-[\w-]+$/.test(p), `WO-09 rule limited to normal mode: ${p}`); }
    }
    passed.push(`靜態：WO-09 區塊 ${n} 個選擇器全部限 .v2-live:not(.hc)（或 .tone-* 變數）；沒有 backdrop-filter、:has()、will-change`);
  }

  let preview = null;
  let url = process.env.UI_PREVIEW_URL;
  if (!url) { preview = await startPreview(54518); url = 'http://127.0.0.1:54518'; }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const errors = [];
  let externalGitHub = 0;
  const tap = (page, sel) => page.evaluate(sel => { window.uiV2.live.state.busyUntil = 0; const b = document.querySelector(sel); if (!b) throw new Error('missing ' + sel); b.click(); }, sel);
  const clickField = (page, [x, y]) => page.evaluate(([x, y]) => { const svg = document.querySelector('.v2l-sheet [data-v2-field]'); const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); svg.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: p.x, clientY: p.y})); }, [x, y]);
  // The board's result flash is held by a 300 ms timer, not a CSS animation (scorebook-v2.js flash()), so wait for it explicitly too.
  const settle = page => page.waitForFunction(() => !document.querySelector('.v2-live').getAnimations({subtree: true}).filter(a => a.playState === 'running').length
    && !document.querySelector('.v2-live .v2-flash, .v2-live .v2-fade, .v2-live [data-flash]')).then(() => page.waitForTimeout(150));
  const closeSheet = async page => { await tap(page, '.v2l-sheet [data-act="close"]'); await page.waitForFunction(() => !window.uiV2.live.state.sheet); await settle(page); };

  // 像素對比：同一塊截兩張（原樣／目標變透明），差異像素就是字（或線）；
  // 前景＝差異最大的那 10% 像素平均（字心），底色＝差異像素位置在「透明」那張上、和前景對比最差的一點。
  const pixelContrast = async (page, handle, mode) => {
    const box = await handle.boundingBox();
    if (!box || box.width < 1 || box.height < 1) return null;
    const vp = page.viewportSize();
    const x = Math.max(0, Math.floor(box.x) - 2), y = Math.max(0, Math.floor(box.y) - 2);
    const clip = {x, y, width: Math.min(vp.width, Math.ceil(box.x + box.width) + 2) - x, height: Math.min(vp.height, Math.ceil(box.y + box.height) + 2) - y};
    if (clip.width < 2 || clip.height < 2) return null;
    // 球場線：線和草地／內野外框疊在同一位置，所以整個球場的線一起量（兩張都先藏字和落點）。
    if (mode === 'lines') await handle.evaluate(el => { const st = document.createElement('style'); st.id = 'wo9-lines'; st.textContent = '.wo9-lines :is(text, .v2f-dot, .v2f-mark) { visibility: hidden !important; } .wo9-lines.wo9-nostroke * { stroke: transparent !important; }'; document.head.appendChild(st); el.classList.add('wo9-lines'); });
    const a = (await page.screenshot({clip})).toString('base64');
    const saved = await handle.evaluate((el, mode) => {
      const keep = el.getAttribute('style');
      if (mode === 'text') {
        const gradientText = getComputedStyle(el).webkitBackgroundClip === 'text' || getComputedStyle(el).backgroundClip === 'text';
        el.style.setProperty('color', 'transparent', 'important');
        el.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
        el.style.setProperty('fill', 'transparent', 'important');
        el.style.setProperty('text-shadow', 'none', 'important');
        if (gradientText) el.style.setProperty('background-image', 'none', 'important');
      } else if (mode === 'lines') el.classList.add('wo9-nostroke');
      else el.style.setProperty('visibility', 'hidden', 'important');
      return keep;
    }, mode);
    const b = (await page.screenshot({clip})).toString('base64');
    await handle.evaluate((el, keep) => { if (keep === null) el.removeAttribute('style'); else el.setAttribute('style', keep); el.classList.remove('wo9-lines', 'wo9-nostroke'); document.getElementById('wo9-lines')?.remove(); }, saved);
    return page.evaluate(async ([a, b, mode]) => {
      let W = 0; // 截圖實際寬度（px），算 at 座標用；不假設 DPR
      const load = async s => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()); W = bmp.width; const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return x.getImageData(0, 0, bmp.width, bmp.height).data; };
      const [A, B] = [await load(a), await load(b)];
      const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const lum = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      const ratio = (p, q) => (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05);
      const diff = [];
      for (let i = 0; i < A.length; i += 4) { const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); if (d > 24) diff.push([i, ratio(lum(A, i), lum(B, i))]); }
      if (diff.length < 3) return null;
      diff.sort((p, q) => q[1] - p[1]);
      const core = diff.slice(0, Math.max(1, Math.ceil(diff.length * 0.1)));
      const fg = [0, 0, 0]; for (const [i] of core) { fg[0] += A[i]; fg[1] += A[i + 1]; fg[2] += A[i + 2]; }
      const F = Uint8ClampedArray.from(fg.map(v => Math.round(v / core.length)).concat(255));
      const lf = lum(F, 0);
      // 只算「畫上目標後往前景色靠近」的像素：目標蓋到的底，畫上去一定更接近前景。
      // 字旁邊的其他線（例如全壘打牆）在兩張截圖之間可能重新點陣化、邊緣差一點；那些像素不是字的底，不算（WO-09R2 第 2 輪）。
      const toward = diff.filter(([i]) => Math.abs(lum(A, i) - lf) < Math.abs(lum(B, i) - lf));
      const per = (toward.length ? toward : diff).map(([i]) => [ratio(lf, lum(B, i)), i]).sort((p, q) => p[0] - q[0]);
      // 底色取最差 2% 分位：排除背景星點那種 1～2 px 的孤立亮點；最差單點也記下來。
      const [worst, wi] = per[Math.floor(per.length * 0.02)];
      return {ratio: Math.round(worst * 100) / 100, minPx: Math.round(per[0][0] * 100) / 100, fg: [...F.slice(0, 3)], bg: [B[wi], B[wi + 1], B[wi + 2]], px: diff.length, used: per.length, at: [(wi / 4) % W, Math.floor(wi / 4 / W)]};
    }, [a, b, mode]).then(r => r && Object.assign(r, {shots: [a, b]}));
  };
  // 一個範圍內每種「葉節點文字」各量一個（同 class＋同色調只量第一個）。
  const textTargets = (page, scope) => page.evaluateHandle(scope => {
    const seen = new Set(); const out = [];
    for (const el of document.querySelectorAll(scope + ' *')) {
      if (!el.textContent.trim() || [...el.children].some(c => c.textContent.trim())) continue;
      if (['SCRIPT', 'STYLE', 'title'].includes(el.tagName)) continue;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || +cs.opacity === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      if (el.closest('[hidden], [aria-hidden="true"]:not(.v2l-field)')) continue;
      // 被捲動容器裁掉（畫面上看不到）的不量：整個字框要在每一層會裁切的祖先裡面。
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p); if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
        const q = p.getBoundingClientRect(); if (r.top < q.top - 1 || r.bottom > q.bottom + 1 || r.left < q.left - 1 || r.right > q.right + 1) { clipped = true; break; }
      }
      if (clipped) continue;
      const tone = [...(el.closest('[class*="tone-"]') || el).classList].find(c => c.startsWith('tone-')) || '';
      const sig = (el.className?.baseVal ?? el.className) + '|' + (el.parentElement.className?.baseVal ?? el.parentElement.className) + '|' + tone + '|' + el.tagName;
      if (seen.has(sig)) continue; seen.add(sig); out.push(el);
    }
    return out;
  }, scope);
  const measureAll = async (page, scope, mode, min, label, log, fails) => {
    const arr = mode === 'text' ? await textTargets(page, scope) : await page.evaluateHandle(scope => [...document.querySelectorAll(scope)], scope);
    const n = await arr.evaluate(a => a.length);
    let measured = 0;
    for (let i = 0; i < n; i++) {
      const h = await arr.evaluateHandle((a, i) => a[i], i);
      const name = await h.evaluate(el => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).trim().replace(/\s+/g, '.')} 「${el.textContent.trim().slice(0, 8)}」`);
      let r = await pixelContrast(page, h, mode);
      if (!r) continue;
      measured++;
      // 第一次量到不足時，同一個字重拍 A/B 再量一次（最多一次；門檻不變，第二次也不足就失敗）：
      // CI 上兩張截圖之間字旁的邊線偶爾重新點陣化，會把底色混進前景（WO-05B7R1）。兩次的值都記下來。
      let first = null;
      if (r.ratio < min) {
        const again = await pixelContrast(page, h, mode);
        first = {ratio: r.ratio, minPx: r.minPx, fg: r.fg, bg: r.bg, at: r.at};
        retries.push(`${label} ${name}: ${r.ratio}:1 -> ${again ? again.ratio + ':1' : 'not measurable'}`);
        console.log(`contrast retry ${retries.at(-1)}`);
        if (again) r = again;
      }
      const [shotA, shotB] = r.shots; delete r.shots;
      log.push({where: label, name, ...r, min, ...(first ? {first} : {})});
      // 失敗時把兩張截圖存到 UI_QA_OUTPUT（CI 會上傳成 ui-qa artifact），下次能直接看是量到哪一點。
      if (r.ratio < min) { const k = `ui-v2-premium-contrast-fail-${fails.length + 1}`; const dir = process.env.UI_QA_OUTPUT || require('node:os').tmpdir(); fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, k + '-A.png'), Buffer.from(shotA, 'base64')); fs.writeFileSync(path.join(dir, k + '-B.png'), Buffer.from(shotB, 'base64')); }
      if (r.ratio < min) fails.push(`${label} ${name}: ${r.ratio}:1 < ${min}:1 (fg ${r.fg} bg ${r.bg} at ${r.at})${first ? `; first try ${first.ratio}:1 (fg ${first.fg} bg ${first.bg} at ${first.at})` : ''}`);
    }
    return measured;
  };

  const contrastLog = [];
  const retries = [];
  try {
    for (const [name, w, h] of SIZES) {
      const context = await browser.newContext({viewport: {width: w, height: h}, isMobile: w < 768, hasTouch: w < 1200, deviceScaleFactor: 2, reducedMotion: 'no-preference'});
      await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => { externalGitHub++; return route.abort(); });
      const page = await context.newPage();
      page.on('dialog', dialog => dialog.accept());
      page.on('pageerror', error => errors.push(`${w}x${h}: ${error.message}`));
      await page.goto(url + '/?ui=v2');
      await page.waitForFunction(() => window.teamRecords && window.uiV2 && window.uiV2.live && !document.getElementById('syncStatusBadge').textContent.includes('連線同步中'));
      await page.evaluate(() => switchMainTab('tabScorebook'));
      await page.waitForFunction(() => document.body.classList.contains('v2-setup-on') && document.querySelector('.v2l-setup .v2u-start'));
      await page.evaluate(() => {
        if (typeof renderSetupLineupGrid === 'function') renderSetupLineupGrid();
        const s = window.uiV2.live.state.setup; s.dh = !!isDhEnabled; const n = s.dh ? 11 : 10;
        s.lineup = setupLineupList.slice(0, n); s.pos = setupLineupPositions.slice(0, n); s.touched = true; window.uiV2.live.render();
        const el = document.querySelector('.v2l-setup [data-su="opponent"]'); el.value = '質感測試'; el.dispatchEvent(new Event('input', {bubbles: true}));
      });
      await tap(page, '.v2l-setup [data-act="su-start"]');
      await page.waitForFunction(() => document.body.classList.contains('v2-live-on'));
      // 落點：一安落外野草地、滾地落內野紅土（PO-49 彩色球場上的落點也要量對比）。
      for (const [code, spot] of [['BB'], ['1H', [262, 120]], ['GO', [278, 242]], ['K']]) {
        await tap(page, `.v2-live [data-act="off"][data-code="${code}"]`);
        if (spot && await page.$('.v2l-sheet [data-v2-field]')) await clickField(page, spot);
        if (await page.$('.v2l-sheet [data-act="pa-submit"]')) await tap(page, '.v2l-sheet [data-act="pa-submit"]');
      }
      await page.evaluate(() => { const g = activeGame; g.currentBatterIdx = 0; window.uiV2.live.render(); window.uiV2.live.state.busyUntil = 0; document.querySelector('.v2l-snack')?.setAttribute('hidden', ''); });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      assert.equal(await page.evaluate(() => document.querySelector('.v2-live').classList.contains('hc')), false, `${name}: starts in normal mode`);

      // ---------- R1～R8 外觀（computed） ----------
      const look = await page.evaluate(() => {
        const live = document.querySelector('.v2-live');
        const cs = (el, p) => getComputedStyle(el, p);
        const key = live.querySelector('.v2l-pad [data-act="off"][data-code="GO"]');
        const before = cs(key, '::before');
        const mat = ['.v2l-board', '.v2l-card', '.v2l-recent', '.v2l-field'].map(s => { const e = live.querySelector(s); return [s, cs(e).backgroundImage.includes('rgba(28, 32, 40, 0.7)'), cs(e).borderTopLeftRadius, {bg: cs(e).backgroundImage.slice(0, 160), cls: e.className, flash: e.dataset.flash || ''}]; });
        const fams = cs(key.querySelector('b')).fontFamily;
        return {
          bg: cs(live).backgroundImage,
          mat,
          us: [cs(live.querySelector('[data-v2-us]')).fontFamily.includes('Serif Flight'), cs(live.querySelector('[data-v2-us]')).fontWeight],
          stat: [...live.querySelectorAll('.v2l-card .v2l-stat')].map(s => cs(s).borderTopLeftRadius),
          key: {radius: cs(key).borderTopLeftRadius, layers: (cs(key).backgroundImage.match(/linear-gradient/g) || []).length, inset: cs(key).boxShadow.includes('inset'),
            drop: /rgba\(0, 0, 0, 0\.9\) 0px 12px 26px -14px/.test(cs(key).boxShadow), rim: before.content !== 'none' && (before.webkitMaskComposite || before.maskComposite || '') !== '' && before.backgroundImage.includes('linear-gradient')},
          font: {first: fams.split(',')[0].replace(/"/g, '').trim(), gothicBeforeMincho: fams.indexOf('TK Gothic') >= 0 && (fams.indexOf('Mincho') < 0 || fams.indexOf('TK Gothic') < fams.indexOf('Mincho')), weight: cs(key.querySelector('b')).fontWeight, small: cs(key.querySelector('small')).fontWeight,
            loaded: ['Serif Flight', 'TK Gothic'].map(f => [...document.fonts].some(ff => ff.family.replace(/"/g, '') === f && ff.status === 'loaded')),
            check: [document.fonts.check('700 22px "Serif Flight"', '1H'), document.fonts.check('700 22px "TK Gothic"', '滾地')]},
          colors: ['.v2f-grass', '.v2f-dirt', '.v2f-diamond'].map(c => cs(live.querySelector('.v2l-field ' + c)).fill),
          dots: live.querySelectorAll('.v2l-field .v2f-dot').length,
          line: cs(live.querySelector('.v2l-field .v2f-line')).strokeWidth,
          diamond: cs(live.querySelector('.v2l-field .v2f-diamond')).strokeWidth,
          // 內野整片紅土：菱形四角內縮一點、投手丘、壘間中點都要落在紅土區內
          dirtCovers: (() => { const dirt = live.querySelector('.v2l-field .v2f-dirt'), svg = dirt.ownerSVGElement;
            return [[200, 365], [278, 287.5], [200, 210], [122, 287.5], [200, 287.5], [241, 246], [159, 246], [241, 329], [159, 329]].every(([x, y]) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return dirt.isPointInFill(p); }); })()
        };
      });
      assert.match(look.bg, /bg-overview/, `${name}: R1 background is the Overview scene`);
      for (const [s, glass, radius, seen] of look.mat) assert.deepEqual([glass, radius], [true, '22px'], `${name}: R2 ${s} translucent material, radius 22 — actual ${JSON.stringify([glass, radius, seen])}`);
      assert.deepEqual(look.us, [true, '700'], `${name}: R4 score in Serif Flight 700`);
      assert.ok(look.stat.length >= 1 && look.stat.every(r => r === '999px'), `${name}: R5 stat chips are capsules`);
      assert.deepEqual(look.key, {radius: '12px', layers: 2, inset: true, drop: true, rim: true}, `${name}: R7 keycap (two-layer face, rim mask, top highlight + drop shadow), radius stays 12`);
      assert.deepEqual(look.font, {first: 'Serif Flight', gothicBeforeMincho: true, weight: '700', small: '500', loaded: [true, true], check: [true, true]}, `${name}: AC-7 key fonts (D4) — actual ${JSON.stringify(look.font)}`);
      assert.deepEqual([look.line, look.diamond], ['1.5px', '1.75px'], `${name}: R8 field lines 1.5 / infield 1.75`);
      // PO-49（REVISION 4）：外野草地綠；內野整片紅土（菱形不填色，壘間與投手丘都是土），都壓暗。
      const rgb = c => c.match(/[\d.]+/g).map(Number);
      const [grass, dirt] = look.colors.slice(0, 2).map(rgb);
      assert.ok(grass[1] > grass[0] + 15 && grass[1] > grass[2] + 10 && grass[1] < 110, `${name}: PO-49 outfield grass is dark green (${look.colors[0]})`);
      assert.ok(look.colors[2] === 'none' && look.dirtCovers, `${name}: PO-49 whole infield is clay — diamond unfilled (${look.colors[2]}), clay covers bases, mound and basepaths`);
      assert.ok(dirt[0] > dirt[1] + 15 && dirt[1] > dirt[2] && dirt[0] < 130, `${name}: PO-49 infield dirt is dark clay (${look.colors[1]})`);
      assert.ok(look.dots >= 2, `${name}: spray dots on the field (${look.dots})`);

      // ---------- AC-6 按下回饋 ----------
      const keySel = '.v2-live .v2l-pad [data-act="off"][data-code="GO"]';
      const key = await page.$(keySel);
      const kb = await key.boundingBox();
      const shotKey = async () => (await page.screenshot({clip: {x: kb.x, y: kb.y, width: kb.width, height: kb.height}})).toString('base64');
      const idle = await shotKey();
      const layoutOf = () => page.evaluate(() => [...document.querySelectorAll('.v2-live .v2l-padwrap button')].map(b => [b.offsetLeft, b.offsetTop, b.offsetWidth, b.offsetHeight, getComputedStyle(b).borderTopWidth]));
      const layout0 = await layoutOf();
      const down = await page.evaluate(sel => {
        window.uiV2.live.state.busyUntil = 0;
        const k = document.querySelector(sel);
        const t0 = performance.now();
        k.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'touch'}));
        const s = getComputedStyle(k);
        return {down: k.classList.contains('v2-down'), transform: s.transform, filter: s.filter, transition: s.transitionDuration, ms: Math.round(performance.now() - t0)};
      }, keySel);
      const t1 = Date.now();
      const pressed = await shotKey();
      const shotMs = Date.now() - t1;
      const layout1 = await layoutOf();
      const changed = await page.evaluate(async ([a, b]) => {
        const load = async s => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return x.getImageData(0, 0, bmp.width, bmp.height).data; };
        const [A, B] = [await load(a), await load(b)]; let n = 0;
        for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 12) n++;
        return n / (A.length / 4);
      }, [idle, pressed]);
      assert.deepEqual([down.down, down.transform, down.filter, down.transition], [true, 'matrix(0.97, 0, 0, 0.97, 0, 0)', 'brightness(1.18)', '0s'], `${name}: AC-6 press: brightness(1.18) + scale(.97) at once, no transition in`);
      assert.ok(changed > 0.2, `${name}: AC-6 pressed key visibly different on screen (${Math.round(changed * 100)}% px; screenshot ${shotMs} ms after pointerdown)`);
      assert.deepEqual(layout1, layout0, `${name}: AC-6 press changes no layout (offset boxes and border widths, all pad keys)`);
      const release = await page.evaluate(sel => new Promise(resolve => {
        const k = document.querySelector(sel);
        k.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0, pointerType: 'touch'}));
        const dur = getComputedStyle(k).transitionDuration;
        const t0 = performance.now(); const samples = [];
        const step = () => {
          const m = getComputedStyle(k).transform; const sc = m === 'none' ? 1 : +m.slice(7).split(',')[0];
          samples.push([Math.round(performance.now() - t0), sc]);
          if (performance.now() - t0 < 200) requestAnimationFrame(step); else resolve({dur, samples, up: !k.classList.contains('v2-down')});
        };
        requestAnimationFrame(step);
      }), keySel);
      const sc = release.samples.map(s => s[1]);
      assert.equal(release.up, true, `${name}: released on pointerup`);
      assert.ok(release.dur.split(',').every(d => d.trim() === '0.08s'), `${name}: AC-6 release springs back over 80 ms (${release.dur})`);
      assert.ok(sc.every((v, i) => i === 0 || v >= sc[i - 1] - 1e-6), `${name}: AC-6 release is monotone, no jump back (${JSON.stringify(release.samples)})`);
      assert.equal(sc[sc.length - 1], 1, `${name}: AC-6 back to scale 1 within 200 ms`);
      const lastStep = Math.max(...sc.slice(1).map((v, i) => v - sc[i]));
      assert.ok(lastStep <= 0.03 + 1e-6, `${name}: AC-6 no single-frame jump larger than the whole travel (${lastStep})`);
      await settle(page);

      // ---------- AC-3 像素對比：主畫面 ----------
      const fails = [];
      const log = [];
      let m = 0;
      m += await measureAll(page, '.v2-live .v2l-head', 'text', 4.5, `${name} 頂列`, log, fails);
      m += await measureAll(page, '.v2-live .v2l-board', 'text', 4.5, `${name} 比分板`, log, fails);
      m += await measureAll(page, '.v2-live .v2l-card', 'text', 4.5, `${name} 打者卡`, log, fails);
      m += await measureAll(page, '.v2-live .v2l-recent', 'text', 4.5, `${name} 本半局`, log, fails);
      m += await measureAll(page, '.v2-live .v2l-order', 'text', 4.5, `${name} 打序`, log, fails);
      m += await measureAll(page, '.v2-live .v2l-field', 'text', 4.5, `${name} 球場字`, log, fails);
      m += await measureAll(page, '.v2-live .v2l-pad', 'text', 4.5, `${name} 結果鍵`, log, fails);
      const lines = await measureAll(page, '.v2-live .v2l-field svg', 'lines', 3, `${name} 球場線`, log, fails);
      const dots = await measureAll(page, '.v2-live .v2l-field .v2f-dot', 'hide', 4.5, `${name} 落點`, log, fails);
      await page.evaluate(() => { const g = activeGame; g.currentOuts = 0; window.uiV2.live.render(); });
      await settle(page);
      const lights = await measureAll(page, '.v2-live .v2l-out:not(.on)', 'hide', 3, `${name} 出局燈（沒亮）`, log, fails);
      assert.ok(lines >= 1 && lights >= 3 && dots >= 2, `${name}: measured field lines (${lines}) and unlit out lights (${lights})`);
      // ---------- R9 sheet ＋ 像素對比 ----------
      await tap(page, '.v2-live .v2l-card'); await settle(page);
      const sheet = await page.evaluate(() => {
        const s = document.querySelector('.v2-live .v2l-sheet'); const a = getComputedStyle(s, '::after');
        const rows = [...s.querySelectorAll('.v2s-lrow, .v2s-item')];
        return {grab: [a.width, a.height], rows: rows.length, glass: rows.every(r => getComputedStyle(r).backgroundImage.includes('linear-gradient')), radius: getComputedStyle(s).borderTopLeftRadius};
      });
      assert.deepEqual(sheet, {grab: ['36px', '5px'], rows: sheet.rows, glass: true, radius: '24px'}, `${name}: R9 lineup sheet grabber 36×5, rows are material cards, top radius 24`);
      assert.ok(sheet.rows >= 9, `${name}: lineup rows listed (${sheet.rows})`);
      m += await measureAll(page, '.v2-live .v2l-sheet', 'text', 4.5, `${name} 打序 sheet`, log, fails);
      await closeSheet(page);
      await tap(page, '.v2-live [data-act="off"][data-code="1H"]'); await settle(page);
      // 標落點（點下去的十字落點）：外野草地、壘間紅土（投手丘旁）、內野紅土弧各量一次。
      let marks = 0;
      for (const spot of [[200, 120], [205, 300], [278, 242]]) {
        await clickField(page, spot);
        await page.waitForTimeout(50);
        marks += await measureAll(page, '.v2-live .v2l-sheet .v2f-mark', 'hide', 4.5, `${name} 標落點 ${spot}`, log, fails);
      }
      assert.equal(marks, 3, `${name}: measured the pick mark on grass, mid-infield clay and dirt arc`);
      const cta = await page.evaluate(() => { const b = document.querySelector('.v2l-sheet [data-act="pa-submit"]'); const s = getComputedStyle(b); return {white: s.backgroundImage.includes('rgb(255, 255, 255)'), radius: s.borderTopLeftRadius, ink: s.color}; });
      assert.deepEqual([cta.white, cta.radius], [true, '999px'], `${name}: R9/D3 submit is a white capsule`);
      m += await measureAll(page, '.v2-live .v2l-sheet', 'text', 4.5, `${name} 打席 sheet`, log, fails);
      await closeSheet(page);
      await tap(page, '.v2-live [data-act="menu"]'); await settle(page);
      m += await measureAll(page, '.v2-live .v2l-sheet', 'text', 4.5, `${name} 選單 sheet`, log, fails);
      assert.deepEqual(fails, [], `${name}: AC-3 rendered-pixel contrast`);
      assert.ok(m >= 30, `${name}: measured ${m} text items`);
      contrastLog.push(...log);

      // ---------- 高對比：沒有 WO-09 外觀 ----------
      await tap(page, '.v2l-sheet [data-act="hc"]');
      await closeSheet(page);
      const hc = await page.evaluate(() => {
        const live = document.querySelector('.v2-live'); const key = live.querySelector('.v2l-pad [data-act="off"]');
        return {hc: live.classList.contains('hc'), bg: getComputedStyle(live).backgroundImage, key: getComputedStyle(key).backgroundColor, keyImg: getComputedStyle(key).backgroundImage, rim: [getComputedStyle(key, '::before').backgroundImage, getComputedStyle(key, '::before').height], radius: getComputedStyle(key).borderTopLeftRadius};
      });
      assert.deepEqual(hc, {hc: true, bg: 'none', key: 'rgb(0, 0, 0)', keyImg: 'none', rim: ['none', '2px'], radius: '12px'}, `${name}: high contrast keeps its own look (no scene, solid #000 keys, ::before is still the 2px tone bar, no rim)`);
      await context.close();
    }
    const texts = contrastLog.filter(c => c.min === 4.5 && !/落點/.test(c.where)), nonText = contrastLog.filter(c => c.min === 3);
    const spots = contrastLog.filter(c => /落點/.test(c.where));
    passed.push(`PO-49 彩色球場 4 尺寸：外野草地暗綠、內野整片紅土暗土色；落點與標落點 ${spots.length} 項最低 ${Math.min(...spots.map(c => c.ratio))}:1（≥4.5）`);
    passed.push('R1～R9 4 尺寸：總覽場景背景、半透明材質圓角 22、Serif Flight 700 數字、成績膠囊、鍵帽（雙層、彩虹邊、高光＋落影、圓角 12）、球場線 1.5／1.75、sheet 把手與材質列、白色送出膠囊');
    passed.push(`AC-3 實際像素對比 4 尺寸：字 ${texts.length} 項最低 ${Math.min(...texts.map(c => c.ratio))}:1（≥4.5）；球場線＋沒亮出局燈 ${nonText.length} 項最低 ${Math.min(...nonText.map(c => c.ratio))}:1（≥3）`);
    passed.push('AC-6 按下當下 brightness(1.18)＋scale(.97)、截圖可見、排版 0 變動；放開 80 ms 單調回彈');
    passed.push('AC-7 結果鍵 Serif Flight 700（中文落 TK Gothic 黑體）、小字 500，字型已載入');
    passed.push('高對比 4 尺寸：無場景、鍵實底 #000、無彩虹邊、圓角 12');
    fs.writeFileSync(path.join(process.env.UI_QA_OUTPUT || require('node:os').tmpdir(), 'ui-v2-premium-contrast.json'), JSON.stringify(contrastLog, null, 1));
    assert.deepEqual(errors, [], 'no page errors');
    assert.equal(externalGitHub, 0, 'no request reached GitHub');
    assert.deepEqual(hashes(), diskBefore, 'data/*.json untouched');
    for (const p of passed) console.log('PASS ' + p);
    console.log(`ui-v2-premium: ${passed.length} checks passed (contrast retries ${retries.length})`);
  } finally {
    await browser.close();
    if (preview) preview.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
