// ui-delight.js — small moments of delight on top of the app shell (ui-app.js), plus a few flow shortcuts.
// Effects are written for this site (ideas from reactbits.dev: Blur Text, Count Up, Shiny Text, Star Border, Spotlight
// Card, Magnet, Galaxy/Particles, Scroll Reveal, Animated Content), in plain JS + CSS so they cost almost nothing on phones:
//   Home      twinkling star field with shooting stars behind the hero, the team name settling in from a blur, numbers
//             counting up, an orbiting light around the main button, bands revealed on scroll, a spotlight on cards.
//   Clawd     a little orange pixel creature (an homage to Claude's mascot) that lives in the site, in a different
//             outfit and mood each visit (most often the team's blue AE cap): it peeks out from behind the liquid glass,
//             floats down on a balloon, hops and dashes past, rides a rocket, naps; it can be tapped, petted, dragged and
//             thrown. It never talks. Never on 比賽場記: scoring needs full attention.
//   Pages     every page's title settles from a blur and its sections fade in as they scroll into view; the space scene
//             behind each page drifts toward the planet as the page scrolls (ui-theme.css, scroll-driven, no script).
//   Feel      the glass answers the finger: a light follows it on the phone tab bar (slide along the bar to pick a tab),
//             the glass thumbs stretch like liquid as they glide, home and overview cards tilt toward the mouse.
//   Flow      search for any page / player / game (⌘K, Ctrl+K or "/" and the 🔍 button); previous/next player on 球員檔案
//             (buttons, swipe, ← →); pull down to refresh in the installed app.
// Presentation and navigation only: reads the site's data through the same functions the pages use, never writes data.
// Everything respects "reduce motion" (no movement) and stops when the page is hidden.
(function () {
  'use strict';
  const root = document.documentElement;
  if (!root.classList.contains('ui-flight') || !window.siteHooks || typeof window.switchMainTab !== 'function') return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const config = window.BASEBALL_APP_CONFIG || {};
  const page = () => document.body.dataset.page || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const play = (el, frames, options) => { try { return el.animate(frames, options); } catch (e) { return null; } };
  const EASE = 'cubic-bezier(.2, .8, .2, 1)';
  const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
  const OUT_EXPO = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  const testLayout = () => root.classList.contains('fl-full-layout');

  // =====================================================================================================
  // Home
  // =====================================================================================================

  // ---------- Star field (Galaxy / Particles): a canvas behind the hero, ~30 fps, only while the hero is on screen ----------
  let stars = null;
  function starField(hero) {
    if (stars && stars.hero === hero && hero.contains(stars.canvas)) return;
    if (stars) stars.stop();
    const canvas = document.createElement('canvas');
    canvas.className = 'fl-stars';
    canvas.setAttribute('aria-hidden', 'true');
    hero.prepend(canvas);
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1, list = [], shooting = null, nextShot = 0, raf = 0, last = 0, onScreen = true, px = 0, py = 0, tx = 0, ty = 0;
    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = hero.clientWidth; h = hero.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const count = Math.round(Math.min(220, (w * h) / 5200));
      list = Array.from({length: count}, () => ({x: Math.random(), y: Math.random() * .78, r: .35 + Math.random() * Math.random() * 1.25,
        a: .25 + Math.random() * .6, s: .6 + Math.random() * 1.8, p: Math.random() * Math.PI * 2, d: .15 + Math.random() * .85,
        tint: Math.random() < .14 ? (Math.random() < .5 ? '196,214,255' : '255,226,196') : '255,255,255'}));
      draw(performance.now());
    };
    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      px += (tx - px) * .06; py += (ty - py) * .06;
      const still = reduce.matches;
      for (const s of list) {
        const twinkle = still ? 1 : .55 + .45 * Math.sin(now / 1000 * s.s + s.p);
        const x = s.x * w + px * s.d * 14, y = s.y * h + py * s.d * 10; // nearer stars drift more with the mouse (parallax)
        ctx.globalAlpha = s.a * twinkle;
        ctx.fillStyle = `rgb(${s.tint})`;
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.fill();
        if (s.r > 1.15 && twinkle > .9) { // a soft cross glint on the brightest stars
          ctx.globalAlpha = (twinkle - .9) * 3 * s.a;
          ctx.fillRect(x - s.r * 3, y - .25, s.r * 6, .5); ctx.fillRect(x - .25, y - s.r * 3, .5, s.r * 6);
        }
      }
      if (!still) {
        if (!shooting && now > nextShot) {
          const fromLeft = Math.random() < .5;
          shooting = {t0: now, x: (fromLeft ? .1 : .55) + Math.random() * .35, y: .04 + Math.random() * .3, dx: fromLeft ? 1 : -1, len: 90 + Math.random() * 80};
          nextShot = now + 5200 + Math.random() * 7000;
        }
        if (shooting) {
          const k = (now - shooting.t0) / 950;
          if (k >= 1) shooting = null;
          else {
            const travel = OUT_EXPO(k) * w * .32;
            const hx = shooting.x * w + shooting.dx * travel, hy = shooting.y * h + travel * .42;
            const tx2 = hx - shooting.dx * shooting.len, ty2 = hy - shooting.len * .42;
            const grad = ctx.createLinearGradient(hx, hy, tx2, ty2);
            const alpha = Math.sin(Math.PI * k) * .9;
            grad.addColorStop(0, `rgba(255,255,255,${alpha})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.globalAlpha = 1; ctx.strokeStyle = grad; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx2, ty2); ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }
    const loop = now => {
      raf = 0;
      if (!running()) return;
      if (now - last > 33) { last = now; draw(now); }
      raf = requestAnimationFrame(loop);
    };
    const running = () => onScreen && !reduce.matches && document.visibilityState === 'visible' && page() === 'Home' && canvas.isConnected;
    const kick = () => { if (!raf && running()) raf = requestAnimationFrame(loop); };
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(e => { onScreen = e[0].isIntersecting; kick(); }) : null;
    io?.observe(hero);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => resize()) : null;
    ro?.observe(hero);
    const move = event => { const r = hero.getBoundingClientRect(); tx = (event.clientX - r.left) / r.width - .5; ty = (event.clientY - r.top) / r.height - .5; };
    if (fine.matches) hero.addEventListener('pointermove', move, {passive: true});
    document.addEventListener('visibilitychange', kick);
    resize();
    kick();
    stars = {hero, canvas, kick, stop() { cancelAnimationFrame(raf); io?.disconnect(); ro?.disconnect(); document.removeEventListener('visibilitychange', kick); canvas.remove(); stars = null; }};
  }

  // ---------- The team name settles in from a blur (Blur Text) ----------
  function blurTitle(title, animate) {
    if (!title || title.dataset.flSplit) return;
    const text = title.textContent;
    title.dataset.flSplit = '1';
    title.setAttribute('aria-label', text);
    title.innerHTML = [...text].map(c => `<span class="fl-ch" aria-hidden="true">${esc(c)}</span>`).join('');
    if (!animate || reduce.matches) return;
    title.querySelectorAll('.fl-ch').forEach((ch, i) => play(ch, [
      {opacity: 0, filter: 'blur(14px)', transform: 'translateY(22px) scale(1.06)'},
      {opacity: .7, filter: 'blur(3px)', transform: 'translateY(-3px)', offset: .6},
      {opacity: 1, filter: 'blur(0)', transform: 'none'}
    ], {duration: 900, delay: 120 + i * 85, easing: EASE, fill: 'backwards'}));
  }

  // ---------- Numbers count up (Count Up). The final text is restored exactly at the end; if the page redraws the number
  // meanwhile, the count stops and leaves the new text alone. ----------
  function countUp(el, delay, dur = 1100) {
    const final = el.textContent;
    const m = final.match(/(\d*)\.(\d+)|\d+/);
    if (!m || reduce.matches) return;
    const token = m[0], target = parseFloat(token.startsWith('.') ? `0${token}` : token);
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = (token.split('.')[1] || '').length, bareDot = token.startsWith('.');
    const fmt = v => { let s = v.toFixed(decimals); if (bareDot) s = s.replace(/^0(?=\.)/, ''); return final.slice(0, m.index) + s + final.slice(m.index + token.length); };
    const t0 = performance.now() + delay;
    let written;
    const step = now => {
      if (!el.isConnected || el.textContent !== written) return;
      const k = Math.max(0, Math.min(1, (now - t0) / dur));
      el.textContent = written = k >= 1 ? final : fmt(target * OUT_EXPO(k));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = written = fmt(0);
    requestAnimationFrame(step);
  }

  // ---------- Bands appear as they scroll into view (Scroll Reveal) ----------
  let reveal = null;
  function revealBands(panel) {
    if (reduce.matches || testLayout() || !('IntersectionObserver' in window)) return;
    reveal?.disconnect();
    reveal = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      reveal.unobserve(e.target);
      const items = [e.target.querySelector('.fl-band-head'), ...e.target.querySelectorAll('.fl-card, .fl-tile')].filter(Boolean).slice(0, 8);
      items.forEach((el, i) => play(el, [{opacity: 0, transform: 'translateY(28px)'}, {opacity: 1, transform: 'none'}], {duration: 720, delay: i * 70, easing: EASE, fill: 'backwards'}));
    }), {rootMargin: '0px 0px -12% 0px'});
    panel.querySelectorAll('.fl-band').forEach(band => reveal.observe(band));
  }

  // ---------- Spotlight that follows the mouse on cards (Spotlight Card) and a magnetic main button (Magnet) ----------
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || reduce.matches) return;
    const card = event.target.closest && event.target.closest('.fl-card, .fl-tile, #teamSummaryCards > div, .ga-stat, .ga-batter, .ga-moment, main section [class*="slate-9"]:not(table *), main section [class*="slate-8"]:not(table *)');
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--fl-mx', `${event.clientX - r.left}px`);
      card.style.setProperty('--fl-my', `${event.clientY - r.top}px`);
    }
  }, {passive: true});
  function magnet(cta) {
    if (!cta || cta.dataset.flMagnet || !fine.matches) return;
    cta.dataset.flMagnet = '1';
    const zone = cta.parentElement;
    zone.addEventListener('pointermove', event => {
      if (reduce.matches) return;
      const r = cta.getBoundingClientRect();
      const dx = event.clientX - (r.left + r.width / 2), dy = event.clientY - (r.top + r.height / 2);
      const near = Math.hypot(dx, dy) < 160;
      cta.style.translate = near ? `${(dx * .14).toFixed(1)}px ${(dy * .2).toFixed(1)}px` : '';
    }, {passive: true});
    zone.addEventListener('pointerleave', () => { cta.style.translate = ''; });
  }

  function enhanceHome(animate) {
    const panel = document.getElementById('panelHome');
    if (!panel || panel.classList.contains('hidden')) return;
    const hero = panel.querySelector('.fl-hero');
    if (!hero) return;
    if (!testLayout()) starField(hero);
    blurTitle(hero.querySelector('.fl-hero-title'), animate);
    hero.querySelector('.fl-cta')?.classList.add('fl-star-border');
    hero.querySelector('.fl-eyebrow')?.classList.add('fl-shiny');
    magnet(hero.querySelector('.fl-cta'));
    if (animate && !testLayout()) {
      panel.querySelectorAll('.fl-telemetry dd').forEach((dd, i) => countUp(dd, 380 + i * 90));
      revealBands(panel);
    }
  }
  // ---------- Every other page, like Apple's pages: as you scroll, the things on the page come in one after another, each
  // kind its own way (React Bits: Animated Content, Fade Content, Animated List, Scroll Float):
  //   cards rise; wide cards tilt up from the page; charts zoom out of the dark; a two-column grid slides in from both
  //   sides; a table rises and its rows slide in; section titles float up.
  // Smooth on phones: things below the screen are hidden in advance (nothing that is already showing ever blinks out and
  // back), each moving element gets its own compositor layer only while it moves, and only transform and opacity change
  // (no text is rewritten: counting numbers read oddly in Chinese). The sections themselves stay put, so section jumps
  // land exactly. Off with "reduce motion", during 比賽場記, and in the isolated test preview unless ?motion. ----------
  const motion = config.motion !== false;
  let sectionReveal = null;
  const ENTER = {
    rise: ['translate3d(0, 64px, 0) scale(.92)', 1000],
    tilt: ['perspective(1100px) translate3d(0, 70px, 0) rotateX(24deg) scale(.94)', 1150],
    zoom: ['scale(.78)', 1100],
    left: ['translate3d(-56px, 36px, 0) rotate(-2deg)', 1000],
    right: ['translate3d(56px, 36px, 0) rotate(2deg)', 1000],
    row: ['translate3d(-44px, 0, 0)', 760],
    title: ['translate3d(0, 34px, 0)', 900]
  };
  const SMOOTH = 'cubic-bezier(.16, 1, .3, 1)';
  // Which entrance an element gets.
  function kindOf(el, index, siblings) {
    if (el.matches('h2, h3') || el.querySelector(':scope > h2, :scope > h3, :scope > div > h2')) return 'title';
    if (el.querySelector('canvas, svg[viewBox]') && !el.querySelector('table')) return 'zoom';
    if (siblings === 2 || (siblings > 2 && siblings <= 4)) return index % 2 ? 'right' : 'left';
    if (el.offsetWidth > window.innerWidth * .7 && el.offsetHeight > 160) return 'tilt';
    return 'rise';
  }
  // Hidden in advance, below the screen: the pre-state is the first frame of its entrance.
  const prepared = new Set();
  function release() { // shows everything still waiting (re-render, page change, printing): nothing stays hidden
    prepared.forEach(el => { if (el.dataset.flEnter) { delete el.dataset.flEnter; el.style.opacity = ''; el.style.transform = ''; el.style.transformOrigin = ''; } });
    prepared.clear();
  }
  window.addEventListener('beforeprint', release);
  function prepare(el, kind) {
    prepared.add(el);
    el.dataset.flEnter = kind;
    el.style.opacity = '0';
    el.style.transform = ENTER[kind][0];
    el.style.transformOrigin = kind === 'tilt' ? '50% 100%' : kind === 'zoom' ? '50% 50%' : '';
  }
  function enter(el, delay) {
    const kind = el.dataset.flEnter;
    if (!kind) return;
    delete el.dataset.flEnter;
    prepared.delete(el);
    const [from, duration] = ENTER[kind];
    el.style.willChange = 'transform, opacity'; // its own layer while it moves: the compositor runs it, scrolling never waits
    const run = play(el, [{opacity: 0, transform: from}, {opacity: 1, transform: 'none'}], {duration, delay, easing: SMOOTH, fill: 'both'});
    el.style.opacity = ''; el.style.transform = ''; el.style.transformOrigin = '';
    const done = () => { el.style.willChange = ''; run?.cancel(); };
    if (run) run.finished.then(done, done); else done();
  }
  // The pieces of a section, in reading order: its title block, then its cards (a grid's cards one by one) and tables.
  function piecesOf(section) {
    const out = [];
    for (const child of section.children) {
      if (child.hidden || child.classList.contains('hidden')) continue;
      if (child.classList.contains('grid') && child.children.length <= 12) out.push(...[...child.children].map((el, i, all) => [el, kindOf(el, i, all.length)]));
      else out.push([child, kindOf(child, 0, 1)]);
      if (out.length >= 14) break;
    }
    return out;
  }
  function revealSections() {
    sectionReveal?.disconnect();
    sectionReveal = null;
    release();
    const key = page();
    if (!motion || reduce.matches || testLayout() || !('IntersectionObserver' in window) || key === 'Home' || key === 'Scorebook') return;
    const panel = document.getElementById(`panel${key}`);
    if (!panel) return;
    const title = document.getElementById('uiPageTitle');
    if (title) play(title, [{opacity: 0, transform: 'translate3d(0, 22px, 0)'}, {opacity: 1, transform: 'none'}], {duration: 800, easing: SMOOTH});
    const pending = new Map(); // section -> its pieces, hidden until it comes into view
    let first = true;
    sectionReveal = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const section = e.target;
        if (first) { // the first report: what is below the screen is hidden now, before anyone can see it
          if (!e.isIntersecting) {
            const pieces = piecesOf(section);
            pieces.forEach(([el, kind]) => prepare(el, kind));
            section.querySelectorAll('.ui-table-scroll tbody tr:nth-child(-n+10)').forEach(row => prepare(row, 'row'));
            pending.set(section, pieces);
          } else sectionReveal.unobserve(section);
          return;
        }
        if (!e.isIntersecting || !pending.has(section)) return;
        const pieces = pending.get(section);
        pending.delete(section);
        sectionReveal.unobserve(section);
        pieces.forEach(([el], i) => enter(el, i * 85));
        section.querySelectorAll('.ui-table-scroll tbody tr[data-fl-enter]').forEach((row, i) => enter(row, 260 + i * 55));
      });
      first = false;
    }, {rootMargin: '0px 0px 4% 0px'});
    panel.querySelectorAll(':scope > section, :scope > div > section').forEach(section => sectionReveal.observe(section));
  }
  window.siteHooks.after('switchMainTab', 'ui-delight', tabId => {
    if (tabId === 'tabHome') requestAnimationFrame(() => enhanceHome(true));
    else if (stars) stars.stop();
    requestAnimationFrame(() => revealSections());
  });
  window.siteHooks.after('renderAll', 'ui-delight', () => {
    if (page() === 'Home') requestAnimationFrame(() => enhanceHome(false));
    else requestAnimationFrame(() => revealSections());
  });
  if (page() === 'Home') requestAnimationFrame(() => enhanceHome(true));

  // =====================================================================================================
  // Flow: search, previous/next player, pull to refresh
  // =====================================================================================================

  // ---------- Search: any page, player or game (⌘K / Ctrl+K / "/" or the 🔍 button) ----------
  const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  function searchItems() {
    const items = [];
    const nav = window.uiNavigation;
    const titleOf = key => document.getElementById(`btnTab${key}`)?.querySelector('span:last-child')?.textContent?.trim() || nav?.labels?.[key] || key;
    (nav?.groups || []).forEach(([group, keys]) => keys.forEach(key => {
      if (!document.getElementById(`btnTab${key}`)) return;
      // The group's shown name, plus its old names (數據／健康／賽事分析 stay findable: WO-03 B2).
      const name = nav.groupName ? nav.groupName(group) : group;
      items.push({kind: '頁面', label: titleOf(key), hint: name || '主頁', keywords: `${titleOf(key)} ${nav.labels?.[key] || ''} ${name} ${group} ${nav.aliases?.[key] || ''}`, run: () => nav.openPage(key)});
    }));
    let names = [];
    try { names = typeof getAllAvailablePlayerNames === 'function' ? getAllAvailablePlayerNames().teamNames : []; } catch (e) { names = []; }
    names.forEach(name => {
      const jersey = typeof NAME_TO_JERSEY !== 'undefined' && NAME_TO_JERSEY[name] != null ? NAME_TO_JERSEY[name] : '';
      items.push({kind: '球員', label: `${jersey !== '' ? `#${jersey} ` : ''}${name}`, hint: '個人檔案', keywords: `${name} ${jersey} #${jersey}`, run: () => openPlayer(name)});
    });
    [...(window.allGames || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 40).forEach(game => {
      items.push({kind: '比賽', label: `${String(game.date || '').slice(5).replace('-', '/')} vs ${game.opponent || '對手'}`, hint: game.tag || '賽事覆盤',
        keywords: `${game.date} ${game.opponent} ${game.tag || ''}`, run: () => openGame(game.id)});
    });
    return items;
  }
  function openPlayer(name) {
    selectedPlayerName = name; // the profile page reads this global (ui-app.js does the same from the home leaders)
    switchMainTab('tabProfile');
    const select = document.getElementById('playerSelect');
    if (select && select.value !== name && [...select.options].some(o => o.value === name)) { select.value = name; select.dispatchEvent(new Event('change')); }
  }
  function openGame(id) {
    switchMainTab('tabScorebook');
    if (typeof switchScorebookSubTab === 'function') switchScorebookSubTab('review');
    if (typeof renderSelectedGameReview === 'function') renderSelectedGameReview(id);
  }
  let palette = null;
  function openSearch() {
    if (palette) { palette.querySelector('input').focus(); return; }
    const items = searchItems();
    palette = document.createElement('div');
    palette.id = 'flSearch';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', '搜尋頁面、球員與比賽');
    palette.innerHTML = '<div class="fl-search-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
      + '<input type="search" placeholder="搜尋頁面、球員、比賽…" aria-label="搜尋" autocomplete="off" enterkeyhint="go"><button type="button" class="fl-search-close" aria-label="關閉">取消</button></div>'
      + '<div class="fl-search-list" role="listbox"></div><p class="fl-search-hint">↑↓ 選擇・Enter 開啟・Esc 關閉</p>';
    const backdrop = document.createElement('div');
    backdrop.className = 'fl-search-backdrop';
    document.body.append(backdrop, palette);
    if (window.flRefract) window.flRefract(palette);
    const input = palette.querySelector('input'), list = palette.querySelector('.fl-search-list');
    let shown = [], active = 0;
    const score = (item, q) => {
      if (!q) return item.kind === '頁面' ? 1 : 0;
      const hay = `${item.label} ${item.keywords}`.toLowerCase();
      if (item.label.toLowerCase().startsWith(q)) return 3;
      if (hay.includes(q)) return 2;
      return [...q].every(c => hay.includes(c)) ? 1 : 0; // every character present: forgiving for 中文 partial names
    };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = items.map(item => [item, score(item, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([item]) => item);
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((item, i) => `<button type="button" role="option" class="fl-search-item${i === active ? ' is-active' : ''}" data-i="${i}" aria-selected="${i === active}">`
        + `<span class="fl-search-kind" data-kind="${esc(item.kind)}">${esc(item.kind)}</span><span class="fl-search-label">${esc(item.label)}</span><span class="fl-search-sub">${esc(item.hint)}</span></button>`).join('')
        : '<p class="fl-search-empty">找不到符合的項目</p>';
    };
    const choose = i => { const item = shown[i]; if (!item) return; closeSearch(); item.run(); };
    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
        render();
        list.querySelector('.is-active')?.scrollIntoView({block: 'nearest'});
      } else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
    });
    list.addEventListener('click', event => { const b = event.target.closest('[data-i]'); if (b) choose(Number(b.dataset.i)); });
    palette.querySelector('.fl-search-close').addEventListener('click', closeSearch);
    backdrop.addEventListener('click', closeSearch);
    render();
    input.focus({preventScroll: true}); // at once, so typing right after the tap lands in the box
    if (!reduce.matches) {
      play(backdrop, [{opacity: 0}, {opacity: 1}], {duration: 200, easing: EASE});
      play(palette, [{opacity: 0, transform: 'translateY(-14px) scale(.97)'}, {opacity: 1, transform: 'none'}], {duration: 380, easing: SPRING});
    }
  }
  function closeSearch() {
    if (!palette) return;
    const p = palette, b = document.querySelector('.fl-search-backdrop');
    palette = null;
    p.remove(); b?.remove();
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && palette) { event.preventDefault(); closeSearch(); return; }
    const combo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
    if (combo || (event.key === '/' && !typing(document.activeElement) && page() !== 'Scorebook')) {
      if (document.querySelector('[id$="Modal"]:not(.hidden), #uiFormDialog')) return;
      event.preventDefault();
      openSearch();
    }
  });
  const toolsButton = document.getElementById('flToolsButton');
  if (toolsButton) {
    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.id = 'flSearchButton';
    searchButton.className = 'fl-top-icon';
    searchButton.setAttribute('aria-label', '搜尋頁面、球員與比賽');
    searchButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg>';
    searchButton.addEventListener('click', openSearch);
    toolsButton.before(searchButton);
  }
  window.siteHooks.after('switchMainTab', 'ui-delight-search', () => closeSearch());

  // ---------- 球員檔案: previous / next player (buttons, swipe on the player card, ← → keys) ----------
  const playerSelect = document.getElementById('playerSelect');
  function stepPlayer(dir) {
    if (!playerSelect) return;
    const options = [...playerSelect.options].filter(o => o.value && !o.disabled);
    if (options.length < 2) return;
    const i = options.findIndex(o => o.value === playerSelect.value);
    const next = options[(i + dir + options.length) % options.length];
    playerSelect.value = next.value;
    playerSelect.dispatchEvent(new Event('change'));
    const card = document.getElementById('panelProfile')?.querySelector('section');
    if (card && !reduce.matches) play(card, [{opacity: .35, transform: `translateX(${dir * 26}px)`}, {opacity: 1, transform: 'none'}], {duration: 380, easing: EASE});
  }
  if (playerSelect) {
    const wrap = document.createElement('span');
    wrap.className = 'fl-step';
    wrap.innerHTML = '<button type="button" data-step="-1" aria-label="上一位球員">‹</button><button type="button" data-step="1" aria-label="下一位球員">›</button>';
    // 球員檔案的身分頭部（index.html #profileIdentity）：‹ › 在姓名兩側（ui-theme.css 排位置），點姓名開選手清單。
    // 手機與平板時它就是整頁的頁首，標 fl-player-row / fl-player-top（桌機是左欄常駐卡，不標）。
    const identity = document.getElementById('profileIdentity');
    const pick = document.getElementById('playerPick');
    if (pick) pick.append(wrap); else playerSelect.after(wrap);
    const compact = window.matchMedia('(max-width: 1279.98px)');
    const markIdentity = () => {
      if (!identity) return;
      identity.classList.toggle('fl-player-row', compact.matches);
      identity.classList.toggle('fl-player-top', compact.matches);
    };
    compact.addEventListener('change', markIdentity);
    markIdentity();
    wrap.addEventListener('click', event => { const b = event.target.closest('[data-step]'); if (b) stepPlayer(Number(b.dataset.step)); });
    // 往下捲過身分頭部後，頂端出現 56 px 精簡列（小頭像、姓名、背號、‹ ›）。用 IntersectionObserver 判斷，不綁 scroll。
    if (identity && 'IntersectionObserver' in window) {
      const bar = document.createElement('div');
      bar.className = 'pf-compact';
      bar.inert = true;
      bar.innerHTML = '<button type="button" class="pf-compact-who" aria-label="回到球員資料"><span class="pf-compact-avatar"></span><span class="pf-compact-name"></span><span class="pf-compact-no"></span></button>'
        + '<span class="pf-compact-step"><button type="button" data-pf-step="-1" aria-label="上一位球員">‹</button><button type="button" data-pf-step="1" aria-label="下一位球員">›</button></span>';
      document.body.append(bar);
      const badge = document.getElementById('playerSelectAvatarBadge'); // the small photo populatePlayerSelect keeps current
      if (badge) { badge.hidden = false; bar.querySelector('.pf-compact-avatar').append(badge); }
      // A hidden bar never decodes its photo, so the first frame it showed paid for it (22 ms at CPU 4x). Decode each
      // new photo ahead of time instead.
      const warm = () => badge?.querySelectorAll('img').forEach(img => { img.decode?.().catch(() => {}); });
      if (badge) { warm(); new MutationObserver(warm).observe(badge, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']}); }
      const sync = () => {
        bar.querySelector('.pf-compact-name').textContent = document.getElementById('playerPickName')?.textContent || '';
        bar.querySelector('.pf-compact-no').textContent = document.getElementById('playerPickJersey')?.textContent || '';
      };
      let shown = false;
      const show = on => {
        if (on === shown) return;
        shown = on;
        if (on) sync();
        bar.inert = !on;
        // Marker classes on the two elements that change, not on body: a body class re-styled the whole long page
        // (one 40 ms frame at the moment the bar appeared, CPU 4x).
        bar.classList.toggle('is-on', on);
        document.querySelector('.ui-section-bar')?.classList.toggle('pf-under-compact', on);
      };
      // Shown only once the head has gone up under the top bar (a hidden page reports a zero box: never shown).
      new IntersectionObserver(([entry]) => {
        const box = entry.boundingClientRect;
        show(!entry.isIntersecting && box.height > 0 && box.bottom <= (entry.rootBounds ? entry.rootBounds.top : 0) + 1);
      }, {rootMargin: '-64px 0px 0px 0px'}).observe(identity);
      playerSelect.addEventListener('change', () => { if (shown) requestAnimationFrame(sync); });
      bar.addEventListener('click', event => {
        const step = event.target.closest('[data-pf-step]');
        if (step) { stepPlayer(Number(step.dataset.pfStep)); return; }
        if (event.target.closest('.pf-compact-who')) window.scrollTo({top: Math.max(0, identity.getBoundingClientRect().top + window.scrollY - 72), behavior: reduce.matches ? 'auto' : 'smooth'});
      });
    }
    // A horizontal swipe on the profile's first card (the photo and basic numbers), not on charts or tables.
    let sx = 0, sy = 0, st = 0, tracking = false;
    document.addEventListener('touchstart', event => {
      const card = event.target.closest && event.target.closest('#panelProfile > section:first-of-type, #profileIdentity');
      tracking = Boolean(card) && !event.target.closest('select, input, canvas, .overflow-x-auto, .ui-table-scroll');
      if (tracking) { sx = event.touches[0].clientX; sy = event.touches[0].clientY; st = performance.now(); }
    }, {passive: true});
    document.addEventListener('touchend', event => {
      if (!tracking) return;
      tracking = false;
      const t = event.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && performance.now() - st < 600) stepPlayer(dx < 0 ? 1 : -1);
    }, {passive: true});
    document.addEventListener('keydown', event => {
      if (page() !== 'Profile' || typing(document.activeElement) || palette || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); stepPlayer(event.key === 'ArrowRight' ? 1 : -1); }
    });
  }

  // ---------- 全隊總覽 toolbar: the two views become one segmented control, the actions one quiet row (ui-theme.css) ----------
  document.getElementById('tabSummaryBtn')?.parentElement.classList.add('fl-seg');
  document.getElementById('tabSummaryBtn')?.parentElement.parentElement.classList.add('fl-seg-row'); // the control on top, the actions under it
  document.getElementById('toggleAddLogBtn')?.parentElement.classList.add('fl-actions');
  // 比賽場記: the review and the spray chart moved out (賽事分析; 數據分析 → 全隊落點 has the same spray chart with more
  // filters), so its sub-page switch is gone and 場記 is the live scorer only. The lineup loaders: a quiet row of actions.
  document.getElementById('btnScoreSubLive')?.parentElement.classList.add('fl-sb-switch');
  document.querySelector('button[onclick^="loadLineupIntoGameSetup"]')?.parentElement.classList.add('fl-actions');

  // ---------- Pull down to refresh (installed app on touch screens; browsers already have their own) ----------
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone && window.matchMedia('(pointer: coarse)').matches && typeof window.manualRefresh === 'function') {
    const pull = document.createElement('div');
    pull.id = 'flPull';
    pull.setAttribute('aria-hidden', 'true');
    pull.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v13M6 12l6 6 6-6"/></svg>';
    document.body.append(pull);
    let y0 = 0, dy = 0, active = false, busy = false;
    const blocked = () => busy || page() === 'Scorebook' || document.body.classList.contains('ui-nav-open') || document.body.classList.contains('fl-tools-open') || palette;
    document.addEventListener('touchstart', event => {
      active = window.scrollY <= 0 && !blocked() && event.touches.length === 1;
      y0 = event.touches[0].clientY; dy = 0;
    }, {passive: true});
    document.addEventListener('touchmove', event => {
      if (!active) return;
      dy = Math.max(0, event.touches[0].clientY - y0);
      if (window.scrollY > 0) { active = false; dy = 0; }
      const pullY = Math.min(110, dy * .5);
      pull.style.transform = `translate(-50%, ${pullY - 60}px) rotate(${Math.min(180, dy * 1.4)}deg)`;
      pull.style.opacity = String(Math.min(1, dy / 90));
      pull.classList.toggle('is-ready', dy > 140);
    }, {passive: true});
    document.addEventListener('touchend', () => {
      if (!active) return;
      active = false;
      if (dy <= 140) { pull.style.opacity = '0'; pull.style.transform = 'translate(-50%, -60px)'; pull.classList.remove('is-ready'); return; }
      busy = true;
      pull.classList.add('is-busy');
      pull.style.transform = 'translate(-50%, 18px)';
      const badge = document.getElementById('syncStatusBadge');
      const before = badge ? badge.textContent : '';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true; busy = false;
        pull.classList.remove('is-busy', 'is-ready');
        pull.style.opacity = '0'; pull.style.transform = 'translate(-50%, -60px)';
        if (typeof window.showToast === 'function') window.showToast(badge && /失敗|錯誤/.test(badge.textContent) ? badge.textContent : '已更新到最新資料');
      };
      if (badge) { const mo = new MutationObserver(() => { if (badge.textContent !== before && !/中\.{0,3}$/.test(badge.textContent)) { mo.disconnect(); setTimeout(finish, 300); } }); mo.observe(badge, {childList: true, characterData: true, subtree: true}); setTimeout(() => { mo.disconnect(); finish(); }, 6000); }
      else setTimeout(finish, 1500);
      window.manualRefresh();
    }, {passive: true});
  }

  // =====================================================================================================
  // Feel: the glass answers the finger (ideas from reactbits.dev: Gooey Nav, Elastic Slider, Tilted Card)
  // =====================================================================================================

  // ---------- The glass thumbs stretch like liquid as they glide to a new item ----------
  const stretch = thumb => {
    if (!thumb || reduce.matches) return;
    play(thumb, [{scale: '1 1'}, {scale: '1.14 .9', offset: .3}, {scale: '.97 1.03', offset: .65}, {scale: '1 1'}], {duration: 520, easing: 'ease-out'});
  };
  const thumbWatch = new MutationObserver(records => {
    // Only a real move (its position changed), not the first placement; one stretch per thumb per batch.
    new Set(records.filter(r => r.target.matches('.fl-tab-thumb, .fl-subnav-thumb') && /translate/.test(r.oldValue || '') && r.target.style.transform && !r.oldValue.includes(r.target.style.transform)).map(r => r.target)).forEach(stretch);
  });
  document.querySelectorAll('.ui-mobile-nav, .fl-subnav').forEach(el => thumbWatch.observe(el, {subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['style']}));

  // ---------- Phone tab bar: a light follows the finger on the glass; slide along the bar to pick a tab ----------
  const tabBar = document.querySelector('.ui-mobile-nav');
  if (tabBar) {
    const glow = document.createElement('span');
    glow.className = 'fl-tab-glow';
    glow.setAttribute('aria-hidden', 'true');
    tabBar.prepend(glow);
    const thumb = () => tabBar.querySelector(':scope > .fl-tab-thumb');
    const buttonAt = x => [...tabBar.querySelectorAll(':scope > button')].find(b => { const r = b.getBoundingClientRect(); return x >= r.left && x <= r.right; });
    let track = null, swallowClick = 0;
    const light = x => { glow.style.translate = `${(x - track.left).toFixed(1)}px 0`; };
    tabBar.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      const r = tabBar.getBoundingClientRect();
      const t = thumb();
      track = {id: event.pointerId, left: r.left, x0: event.clientX, start: buttonAt(event.clientX), over: null, scrub: false, saved: t ? [t.style.transform, t.style.width, t.style.height, t.style.opacity] : null};
      light(event.clientX);
      glow.classList.add('is-on');
    }, {passive: true});
    tabBar.addEventListener('pointermove', event => {
      if (!track || event.pointerId !== track.id) return;
      light(event.clientX);
      if (!track.scrub && Math.abs(event.clientX - track.x0) > 14) track.scrub = true;
      if (!track.scrub) return;
      const b = buttonAt(event.clientX), t = thumb();
      if (!b || b === track.over) return;
      track.over = b;
      if (t) { t.style.opacity = '1'; t.style.width = `${b.offsetWidth}px`; t.style.height = `${b.offsetHeight}px`; t.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`; }
      if (navigator.vibrate) { try { navigator.vibrate(4); } catch (e) { /* not allowed */ } }
    }, {passive: true});
    const end = event => {
      if (!track || event.pointerId !== track.id) return;
      const done = track;
      track = null;
      glow.classList.remove('is-on');
      if (!done.scrub) return; // an ordinary tap: the button's own click does the rest
      swallowClick = performance.now() + 500; // the browser's own click for this gesture lands on the wrong item (or none)
      const t = thumb();
      if (event.type === 'pointerup' && done.over) {
        if (done.over.getAttribute('aria-current') === 'page' && t && done.saved) [t.style.transform, t.style.width, t.style.height, t.style.opacity] = done.saved;
        else { swallowClick = -swallowClick; done.over.click(); swallowClick = -swallowClick; }
      } else if (t && done.saved) [t.style.transform, t.style.width, t.style.height, t.style.opacity] = done.saved;
    };
    tabBar.addEventListener('pointerup', end, {passive: true});
    tabBar.addEventListener('pointercancel', end, {passive: true});
    tabBar.addEventListener('click', event => {
      if (swallowClick > 0 && performance.now() < swallowClick && event.isTrusted) { event.stopPropagation(); event.preventDefault(); }
    }, true);
  }

  // ---------- Click Spark: eight short sparks fly out where a button is pressed. Small elements outside the page, moved by
  // the compositor (a busy page cannot stall them), removed when done. Not during 比賽場記. ----------
  if (motion) {
    document.addEventListener('pointerdown', event => {
      if (reduce.matches || page() === 'Scorebook' || event.button > 0) return;
      const target = event.target.closest?.('button, [role="button"], a, summary, select, .fl-card, [onclick]');
      if (!target || target.closest('#flClawd')) return;
      const nav = target.closest('.ui-mobile-nav, #mainNavigation, .fl-subnav');
      const turn = Math.random() * 45;
      for (let i = 0; i < 8; i++) {
        const s = document.createElement('i');
        s.className = 'fl-click-spark';
        if (nav) s.classList.add('is-nav');
        s.style.left = `${event.clientX}px`; s.style.top = `${event.clientY}px`;
        document.body.append(s);
        const a = turn + i * 45;
        const run = play(s, [
          {transform: `translate(-50%, -50%) rotate(${a}deg) translateY(-8px) scaleY(1)`, opacity: 1},
          {transform: `translate(-50%, -50%) rotate(${a}deg) translateY(-30px) scaleY(.15)`, opacity: 0}
        ], {duration: 460, easing: 'cubic-bezier(.2, .8, .3, 1)'});
        if (run) run.finished.then(() => s.remove(), () => s.remove()); else s.remove();
      }
    }, {passive: true, capture: true});
  }

  // ---------- Home cards tilt toward the mouse (desktop) ----------
  if (fine.matches) {
    let tilted = null;
    const untilt = () => { if (!tilted) return; tilted.classList.remove('fl-tilting'); tilted.style.transform = ''; tilted = null; };
    document.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || reduce.matches) return;
      const card = event.target.closest?.('#panelHome .fl-card, #teamSummaryCards > div');
      if (card !== tilted) untilt();
      if (!card) return;
      tilted = card;
      card.classList.add('fl-tilting');
      const r = card.getBoundingClientRect(), x = (event.clientX - r.left) / r.width - .5, y = (event.clientY - r.top) / r.height - .5;
      card.style.transform = `perspective(900px) translateY(-3px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg)`;
    }, {passive: true});
    document.addEventListener('pointerleave', untilt);
  }

  // =====================================================================================================
  // Clawd: a little orange pixel creature that lives in the site (an homage to Claude's mascot). It never talks.
  // Each visit it wears something different (most often the team's blue AE cap) and arrives with its own face.
  // Now and then it peeks out from behind a liquid-glass surface (glass is its cover: behind it, Clawd shows blurred
  // and bent), floats down on a balloon, hops or dashes past, rides a rocket, or naps when nobody is touching the page.
  // Play with it: tap (it bounces, spins, then celebrates), double-tap (new outfit), press and hold (petting: hearts),
  // drag and throw it (it bounces off the edges and gets dizzy), tap the team logo three times to call it, or shake
  // the phone. A mouse that rushes at it scares it away. Never on 比賽場記, never while a panel or dialog is open,
  // never with "reduce motion". Off in the isolated test preview unless ?clawd. Between visits it is not in the page.
  // =====================================================================================================
  if (config.easterEgg === false || reduce.matches) return;
  const W = 72, H = 60; // CSS px; the sprite is pixel art on a 36 × 30 grid (2 px per pixel); hats and props reach outside it
  const rand = (a, b) => a + Math.random() * (b - a);
  const any = list => list[Math.floor(Math.random() * list.length)];
  const weighted = table => { const entries = Object.entries(table), total = entries.reduce((n, [, w]) => n + w, 0); let r = Math.random() * total; for (const [k, w] of entries) { if ((r -= w) <= 0) return k; } return entries[0][0]; };
  // Pixel art from rows of characters, one character per pixel (a palette key; space = empty). Runs of one colour merge.
  function art(x0, y0, rows, pal) {
    let out = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        let n = 1;
        while (row[x + n] === row[x]) n++;
        if (pal[row[x]]) out += `<rect x="${x0 + x}" y="${y0 + y}" width="${n}" height="1" fill="${pal[row[x]]}"/>`;
        x += n;
      }
    });
    return out;
  }
  const dots = (list, fill) => list.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`).join('');

  // ---------- The body: Clawd's original shape and orange, with light from the top left ----------
  const SKIN = {l: '#E89A7E', h: '#F5C4AE', o: '#D97757', s: '#B85E40', d: '#96472F'};
  const BODY = art(6, 10, [
    ' llllllllllllllllllllll ',
    'llhhhoooooooooooooooooos',
    'llhoooooooooooooooooooos',
    ...Array(9).fill(`l${'o'.repeat(22)}s`),
    'ssssssssssssssssssssssss',
    ' dddddddddddddddddddddd '
  ], SKIN);
  const ARM_L = art(3, 14, [' ll', 'loo', 'loo', 'soo', ' ss'], SKIN);
  const ARM_R = art(30, 14, ['ll ', 'oos', 'oos', 'oss', 'ss '], SKIN);
  const LEG = x => art(x, 24, ['os', 'os', 'ss', 'dd'], SKIN);

  // ---------- Faces: pixel eyes (left eye centred on x 12, the right one mirrored on x 24) ----------
  const EYES = {
    open: {cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]}, // the classic tall eyes
    happy: {cells: [[1, 0], [2, 0], [0, 1], [3, 1]]}, // ∩ arches
    wide: {cells: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]], glint: [[2, 0]]},
    closed: {cells: [[0, 0], [1, 0], [2, 0], [3, 0]]},
    squint: {cells: [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]], mirror: true}, // > <
    dizzy: {cells: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]]},
    heart: {cells: [[1, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [2, 3]], fill: '#ff4f86'},
    star: {cells: [[1, 0], [0, 1], [2, 1], [1, 2]], glint: [[1, 1]], fill: '#ffcf33', glintFill: '#fff6c8'}
  };
  const FACES = [...Object.keys(EYES), 'wink'];
  const ARRIVE = ['open', 'open', 'open', 'happy', 'happy', 'wink', 'wide']; // the face it shows up with
  const IDLE = ['open', 'happy', 'open', 'wink'];
  function eye(kind, right) {
    const e = EYES[kind], all = [...e.cells, ...(e.glint || [])];
    const w = Math.max(...all.map(c => c[0])) + 1, h = Math.max(...all.map(c => c[1])) + 1;
    const left = Math.round(12 - w / 2), ox = right ? 36 - left - w : left, oy = Math.round(16 - h / 2);
    const at = ([x, y]) => [ox + (right && e.mirror ? w - 1 - x : x), oy + y];
    return dots(e.cells.map(at), e.fill || '#17181b') + (e.glint ? dots(e.glint.map(at), e.glintFill || '#ffffff') : '');
  }
  const eyes = face => (face === 'wink' ? eye('happy', false) + eye('open', true) : eye(face, false) + eye(face, true));
  const BLUSH = art(8, 19, ['ppp'], {p: 'rgba(255, 128, 168, .75)'}) + art(25, 19, ['ppp'], {p: 'rgba(255, 128, 168, .75)'});

  // ---------- Outfits, all pixel art (weights: how often it arrives in each) ----------
  // Weights out of 100: the team AE cap (alone, with a bat or with a glove) is 2 in 5.
  const OUTFITS = {cap: 26, slugger: 7, fielder: 7, bare: 12, wizard: 10, cowboy: 10, shades: 11, goggles: 10, astronaut: 7};
  const CAP_PAL = {N: '#163a85', L: '#4a7fe0', B: '#2a5fc4', D: '#1b4291'};
  const cap = () => `<g class="cl-cap">${art(7, 2, [
    '          NN',
    '      LLLLLLLLLL',
    '    LLBBBBBBBBBBBB',
    ...Array(5).fill('   LBBBBBBBBBBBBBBD'),
    'DDDDDDDDDDDDDDDDDDDDDD',
    ' NNNNNNNNNNNNNNNNNNNN'
  ], CAP_PAL)}<g class="cl-ae">${art(14, 4, [' W  WWW', 'W W W  ', 'WWW WW ', 'W W W  ', 'W W WWW'], {W: '#ffffff'})}</g></g>`;
  const WEAR = {
    cap, slugger: cap, fielder: cap, bare: () => '',
    wizard: () => `<g class="cl-wiz">${art(6, -7, [
      '               BB', '              BBB', '             BBBB', '            BYBBB', '           BBBBBB', '          BBBBBYB',
      '         LBBBBBBBB', '         LBBYBBBBB', '        LBBBBBBBBBB', '        LBBBBBBYBBB', '       LBBYBBBBBBBBB', '       LBBBBBBBBBBBB',
      '      LBBBBBBBBBBBBBB', '      LBBBBBYBBBBBBBB', '      DDDDDDDDDDDDDDD', '  LLLLLLLLLLLLLLLLLLLLL', ' BBBBBBBBBBBBBBBBBBBBBBB', '  DDDDDDDDDDDDDDDDDDDDD'
    ], {B: '#2f5fd0', L: '#5b8cf0', D: '#1d3f9a', Y: '#ffd84a'})}</g>`,
    cowboy: () => `<g class="cl-cowboy">${art(4, 3, [
      '          HHH  HHH', '         HHHHHHHHHH', '         HhHHHHHHHH', '         HHHHHHHHHH', '         KKKKKKKKKK',
      'BB       HHHHHHHHHH        BB', ' BBBBBBBBBBBBBBBBBBBBBBBBBB', '   bbbbbbbbbbbbbbbbbbbbbb'
    ], {H: '#9b6a3f', h: '#bd8f60', K: '#5a371b', B: '#8b5a32', b: '#5e3a1d'})}</g>`,
    shades: () => `<g class="cl-shades">${art(8, 14, [
      'KKKKKKKKKKKKKKKKKKKK', ' KwKKKKK    KwKKKKK', ' KKKKKKK    KKKKKKK', '  KKKKK      KKKKK', '   KKK        KKK'
    ], {K: '#0d0e10', w: 'rgba(255, 255, 255, .6)'})}</g>`,
    goggles: () => `<g class="cl-goggles">${art(5, 9, [
      '    KKKKKKK    KKKKKKK', '    KwGGGGK    KwGGGGK', 'SSSSKGGGGGKSSSSKGGGGGKSSSS', '    KgggggK    KgggggK', '    KKKKKKK    KKKKKKK'
    ], {K: '#1c1e22', G: '#c7d1da', g: '#8d98a5', w: '#ffffff', S: '#2a2d33'})}</g>`,
    astronaut: () => {
      // A glass bubble around the whole creature: a pixel ring, faint glass, a highlight up on the left.
      let ring = '', glass = '', shine = '';
      for (let y = 1; y <= 33; y++) for (let x = 1; x <= 35; x++) {
        const d = Math.hypot(x + .5 - 18, y + .5 - 17.5), a = Math.atan2(y + .5 - 17.5, x + .5 - 18);
        if (d >= 15 && d < 16.1) ring += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        else if (d >= 12.6 && d < 13.6 && a > -2.6 && a < -1.75) shine += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        else if (d < 15) glass += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
      return `<g class="cl-helmet"><g fill="rgba(170, 210, 255, .1)">${glass}</g><g fill="rgba(255, 255, 255, .75)">${shine}</g><g fill="#dfe8f6">${ring}</g></g>`;
    },
    party: () => `<g class="cl-party">${art(13, 0, ['    YY', '    YY', '    OO', '   OOOO', '   BBBB', '  OOOOOO', '  OOOOOO', ' BBBBBBBB', ' OOOOOOOO', 'OOOOOOOOOO'],
      {O: '#ff8a3d', B: '#2a5fc4', Y: '#ffd23f'})}</g>`,
    nightcap: () => `<g class="cl-night">${art(6, 5, [
      '    NNNNNNNNN', '  NNNNNNNNNNNNN', ' NNNNNNNNNNNNNNNNN', ' NNNNNNNNNNNNNNNNNNNN', 'WWWWWWWWWWWWWWWWWWWNNN', 'WWWWWWWWWWWWWWWWWWW NNN',
      '                     NN', '                    PPP', '                    PPP'
    ], {N: '#7186c4', W: '#eef1f8', P: '#ffffff'})}</g>`
  };
  const HELD = {
    slugger: () => `<g class="cl-bat">${dots([[30, 18], [31, 17], [31, 16]], '#3b2a1d')}${dots([[32, 15], [32, 14], [33, 13], [33, 12], [33, 11], [34, 10], [34, 9], [35, 8], [35, 7], [36, 6], [36, 5], [36, 4]], '#d8a766')}`
      + `${dots([[33, 10], [34, 8], [35, 6], [35, 5], [35, 4], [36, 3]], '#f1d29f')}${dots([[34, 11], [35, 9], [36, 7], [37, 5], [37, 4]], '#b8854a')}</g>`,
    fielder: () => `<g class="cl-glove">${art(-2, 11, [' BB BB', 'BBBBBBB', 'BBBWWWBB', 'BWWrWWBB', 'BWWWWWBB', 'BBWWWBBB', ' BBBBBB', '  BbbB'],
      {B: '#a0612d', b: '#5b3417', W: '#f4f1ea', r: '#d2452d'})}</g>`,
    wizard: () => `<g class="cl-wand">${dots([[33, 8], [33, 9], [32, 10], [32, 11], [32, 12], [31, 13], [31, 14]], '#8a5a2b')}`
      + `<g class="cl-wand-star">${art(31, 3, ['  Y', ' YYY', 'YYwYY', ' YYY', ' Y Y'], {Y: '#ffd23f', w: '#fff7c2'})}</g></g>`,
    goggles: () => `<g class="cl-flask">${art(-1, 8, ['  NN', '  pp', '  pp', ' pppp', 'pppppp', 'pbbbbp', 'pbWbbp', 'pppppp'],
      {N: '#8a5a2b', p: 'rgba(200, 235, 255, .7)', b: '#3fb4ff', W: '#ffffff'})}<rect class="cl-bubble" x="2" y="12" width="1" height="1" fill="#e6f7ff"/></g>`
  };
  const PROPS = {
    balloon: `<g class="cl-balloon">${art(15, -15, ['  BBB', ' BLBBB', 'BLLBBBB', 'BLBBBBB', 'BBBBBBB', 'BBBBBBD', ' BBBBD', '  BDD', '   D'],
      {B: '#2a5fc4', L: '#7fb0ff', D: '#1b4291'})}<rect x="18" y="-6" width="1" height="16" fill="rgba(255, 255, 255, .7)"/></g>`,
    rocket: (() => {
      const r = [];
      r.push(art(-4, 27, ['  YFF', 'YYYFF'], {Y: '#ffe08a', F: '#ff9a3c'}).replace(/<rect/g, '<rect class="cl-flame"'));
      r.push(art(1, 25, ['GGG', ' GGG'], {G: '#aab6c6'}), art(1, 31, [' GGG', 'GGG'], {G: '#aab6c6'}));
      r.push(art(1, 27, [`${'W'.repeat(33)}RR`, `${'W'.repeat(9)}BB${'W'.repeat(14)}ww${'W'.repeat(6)}RRR`, `${'W'.repeat(9)}BB${'W'.repeat(14)}ww${'W'.repeat(6)}RRR`, `${'g'.repeat(33)}RR`],
        {W: '#eef2f7', g: '#c6cfdb', B: '#2a5fc4', w: '#7fb6ff', R: '#e2563b'}));
      return `<g class="cl-rocket">${r.join('')}</g>`;
    })()
  };
  function sprite(outfit, face) {
    return `<svg viewBox="0 0 36 30" width="${W}" height="${H}" shape-rendering="crispEdges" aria-hidden="true"><g class="cl-rig">`
      + '<g class="cl-back"></g>'
      + `<g class="cl-arm cl-arm-l">${ARM_L}</g><g class="cl-arm cl-arm-r">${ARM_R}</g>`
      + [8, 13, 21, 26].map((x, i) => `<g class="cl-leg cl-leg-${i % 2 ? 'b' : 'a'}">${LEG(x)}</g>`).join('')
      + `<g class="cl-body">${BODY}</g>`
      + `<g class="cl-face"><g class="cl-eyes">${eyes(face)}</g><g class="cl-blush">${BLUSH}</g></g>`
      + `<g class="cl-wear">${WEAR[outfit]()}</g><g class="cl-held">${(HELD[outfit] || (() => ''))()}</g></g></svg>`;
  }

  // ---------- State: one Clawd at a time; the newest flow (a scene, or the player's hands) owns it ----------
  let C = null, busy = false, owner = 0, timer = 0, lastSeen = 0;
  const own = () => ++owner;
  const mine = t => Boolean(C) && owner === t;
  const blocked = () => page() === 'Scorebook' || document.visibilityState !== 'visible' || palette
    || document.body.classList.contains('ui-nav-open') || document.body.classList.contains('fl-tools-open')
    || document.querySelector('[id$="Modal"]:not(.hidden), #uiFormDialog, #insightImageModal, .fl-point-chip');
  const visibleRect = el => (el && el.getClientRects().length ? el.getBoundingClientRect() : null);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const anim = (frames, options, el = C && C.el) => { const a = el && play(el, frames, {fill: 'forwards', ...options}); return a ? a.finished.catch(() => {}) : Promise.resolve(); };
  const rigAnim = (frames, options) => anim(frames, options, C && C.rig);
  const scripted = a => !(window.CSSAnimation && a instanceof CSSAnimation) && !(window.CSSTransition && a instanceof CSSTransition);
  const buzz = pattern => { if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* not allowed */ } } };
  function setFace(face) {
    if (!C || C.face === face) return;
    C.face = face;
    C.el.dataset.face = face;
    C.el.querySelector('.cl-eyes').innerHTML = eyes(face);
  }
  function setOutfit(outfit) {
    if (!C) return;
    C.outfit = outfit;
    C.el.dataset.outfit = outfit;
    C.el.querySelector('.cl-wear').innerHTML = WEAR[outfit]();
    C.el.querySelector('.cl-held').innerHTML = (HELD[outfit] || (() => ''))();
  }
  const setProp = name => { if (C) C.el.querySelector('.cl-back').innerHTML = PROPS[name] || ''; };
  const look = dir => C && C.el.style.setProperty('--fl-look', String(dir));
  function spawn(z, {outfit = weighted(OUTFITS), face = any(ARRIVE)} = {}) {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = 'flClawd';
    el.tabIndex = -1;
    el.setAttribute('aria-label', '小彩蛋：橘色像素小生物（可以點、長按、拖曳）');
    el.innerHTML = sprite(outfit, face);
    el.style.zIndex = String(z);
    el.dataset.outfit = outfit;
    el.dataset.face = face;
    document.body.append(el);
    C = {el, rig: el.querySelector('.cl-rig'), outfit, face, mood: 'scene', hide: null, until: 0, x: 0, y: 0, taps: [], stop: null};
    el.addEventListener('pointerdown', grabStart);
    el.addEventListener('click', event => { event.stopPropagation(); if (event.detail === 0 || !C?.pressHandled) tapped(); if (C) C.pressHandled = false; });
    el.addEventListener('contextmenu', event => event.preventDefault());
    return el;
  }
  function vanish() {
    owner++;
    if (C) { C.stop?.(); clearInterval(C.petTimer); clearTimeout(C.faceTimer); C.el.remove(); }
    C = null; busy = false; lastSeen = performance.now();
  }
  // Stops scripted motion where it is; from then on the creature is placed by `translate` alone.
  function freeze() {
    const r = C.el.getBoundingClientRect();
    C.el.getAnimations().forEach(a => a.cancel());
    C.rig.getAnimations().filter(scripted).forEach(a => a.cancel()); // finished bounces would otherwise hold the rig's pose
    C.el.classList.remove('is-upside', 'is-sideways', 'is-sideways-r', 'is-passing', 'is-walking', 'is-near', 'is-sleeping');
    setProp('');
    C.x = r.left; C.y = r.top;
    Object.assign(C.el.style, {left: '0px', top: '0px', translate: `${C.x}px ${C.y}px`});
  }
  const place = () => { C.el.style.translate = `${C.x.toFixed(1)}px ${C.y.toFixed(1)}px`; };
  // Off the nearest side, walking (or running).
  async function leave(t, fast = false) {
    if (!mine(t)) return;
    C.mood = 'leaving';
    const right = C.x + W / 2 > window.innerWidth / 2;
    C.el.dataset.flip = right ? '1' : '';
    C.el.classList.add('is-walking');
    const to = right ? window.innerWidth + 20 : -W - 20;
    await anim([{translate: `${C.x}px ${C.y}px`}, {translate: `${to}px ${C.y}px`}], {duration: Math.abs(to - C.x) * (fast ? 2.2 : 4.5) + 200, easing: 'cubic-bezier(.4, 0, .9, .6)'});
    if (mine(t)) vanish();
  }
  // Waits while it is being looked at; every touch keeps it around a little longer. Faces and glances change meanwhile.
  async function linger(t, ms, {glance = true, wave = false} = {}) {
    C.until = performance.now() + ms;
    while (mine(t) && C.mood === 'peek' && performance.now() < C.until) {
      if (glance && !fine.matches) look(any([-1, 0, 1, 0]));
      if (!C.busyFace && Math.random() < .22) setFace(any(IDLE));
      if (wave && Math.random() < .18) { C.el.classList.add('is-waving'); await wait(900); if (C) C.el.classList.remove('is-waving'); }
      await wait(rand(480, 880));
    }
    if (C) look(0);
    return mine(t) && C.mood === 'peek';
  }

  // ---------- Scenes ----------
  // Where Clawd can appear on this screen right now: behind which glass, and how (weights).
  function scenes() {
    const list = [];
    const bar = visibleRect(document.querySelector('.ui-mobile-nav'));
    const header = visibleRect(document.getElementById('appHeader'));
    const side = visibleRect(document.getElementById('mainNavigation'));
    if (bar && bar.top > window.innerHeight / 2 && bar.height >= 44) list.push(['bar-peek', 5], ['bar-sneak', 2]);
    if (header && header.bottom > 20 && header.bottom < window.innerHeight / 3) list.push(['header-hang', 2], ['drop', 2]);
    if (side && side.left < 40 && side.height > 300 && side.width < 400) list.push(['side-peek', 4]);
    list.push(['edge-peek', 2], ['hop', 2], ['dash', 2], ['flyby', 1], ['rocket', .6], ['sleep', .8]);
    return list;
  }
  const pick = () => weighted(Object.fromEntries(scenes()));
  // A peek: rise from behind a cover, look around (touches keep it there), duck back.
  async function peek(t, out, back, ms, opts) {
    C.mood = 'peek';
    C.hide = () => anim([{translate: out}, {translate: back}], {duration: 260, easing: 'cubic-bezier(.5, 0, .75, 0)'});
    const stopWatch = watch(t);
    await anim([{translate: back}, {translate: out}], {duration: 560, easing: SPRING});
    const stay = mine(t) && await linger(t, ms, opts);
    stopWatch();
    if (stay) { C.mood = 'hiding'; await C.hide(); }
  }
  const SCENES = {
    async 'bar-peek'(t, opts) {
      const bar = visibleRect(document.querySelector('.ui-mobile-nav'));
      if (!bar) return false;
      spawn(74, opts); // just below the tab bar (z 75): the bar's glass covers it
      Object.assign(C.el.style, {left: `${rand(bar.left + 12, bar.right - W - 12)}px`, top: `${bar.top + (bar.height - H) / 2 + 4}px`});
      await peek(t, '0 -40px', '0 0', rand(2200, 3800), {wave: true});
    },
    async 'bar-sneak'(t, opts) {
      const bar = visibleRect(document.querySelector('.ui-mobile-nav'));
      if (!bar) return false;
      spawn(74, opts); // walking along behind the glass: seen blurred and bent, never in front of the buttons
      const ltr = Math.random() < .5;
      C.el.style.top = `${bar.top + (bar.height - H) / 2 + 2}px`;
      C.el.dataset.flip = ltr ? '1' : '';
      C.el.classList.add('is-walking');
      C.mood = 'moving';
      await anim([{left: `${ltr ? bar.left - W : bar.right}px`}, {left: `${ltr ? bar.right : bar.left - W}px`}], {duration: rand(2400, 3400), easing: 'linear'});
    },
    async 'header-hang'(t, opts) {
      const header = visibleRect(document.getElementById('appHeader'));
      if (!header) return false;
      spawn(69, {...opts, outfit: opts.outfit || any(['bare', 'shades', 'goggles'])}); // under the top bar (z 70); upside down a hat would fall off
      C.el.classList.add('is-upside');
      Object.assign(C.el.style, {left: `${rand(Math.max(header.left + 80, 12), Math.max(header.left + 90, header.right - W - 120))}px`, top: `${header.bottom - H}px`});
      await peek(t, '0 44px', '0 0', rand(1800, 3000));
    },
    async 'side-peek'(t, opts) {
      const side = visibleRect(document.getElementById('mainNavigation'));
      if (!side) return false;
      spawn(59, opts); // under the sidebar (z 60)
      C.el.classList.add('is-sideways');
      Object.assign(C.el.style, {left: `${side.right - W - 6}px`, top: `${rand(side.top + side.height * .3, side.bottom - H - 60)}px`});
      await peek(t, '52px 0', '0 0', rand(2000, 3400));
    },
    async 'edge-peek'(t, opts) {
      // The screen's own edge is the cover: it leans in sideways, looks, and slips back.
      spawn(90, opts);
      const left = Math.random() < .5;
      C.el.classList.add(left ? 'is-sideways' : 'is-sideways-r');
      Object.assign(C.el.style, {left: `${left ? -W + 6 : window.innerWidth - 6}px`, top: `${rand(window.innerHeight * .3, window.innerHeight * .62)}px`});
      await peek(t, `${left ? 42 : -42}px 0`, '0 0', rand(1800, 3000));
    },
    async drop(t, opts) {
      // Floats down from under the top bar on a team-blue balloon, looks around, and drifts back up.
      const header = visibleRect(document.getElementById('appHeader'));
      if (!header) return false;
      spawn(69, opts);
      setProp('balloon');
      Object.assign(C.el.style, {left: `${rand(16, window.innerWidth - W - 16)}px`, top: `${header.bottom - H - 40}px`});
      C.mood = 'peek';
      C.hide = () => anim([{translate: '0 150px'}, {translate: '0 0'}], {duration: 700, easing: 'cubic-bezier(.5, 0, .7, .4)'});
      const sway = rigAnim([{transform: 'rotate(-5deg)'}, {transform: 'rotate(5deg)'}], {duration: 1400, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out'});
      const stopWatch = watch(t);
      await anim([{translate: '0 0'}, {translate: '0 162px', offset: .8}, {translate: '0 150px'}], {duration: 1700, easing: EASE});
      const stay = mine(t) && await linger(t, rand(2000, 3200));
      stopWatch();
      if (stay) { C.mood = 'hiding'; await C.hide(); }
      void sway;
    },
    async hop(t, opts) {
      // Bounces across the lower part of the screen (it can be caught).
      spawn(90, opts);
      const ltr = Math.random() < .5, vw = window.innerWidth;
      C.el.dataset.flip = ltr ? '1' : '';
      const y = rand(window.innerHeight * .5, window.innerHeight * .68);
      C.el.style.top = `${y}px`;
      const n = Math.max(4, Math.round(vw / 120)), frames = [];
      for (let i = 0; i <= n; i++) {
        const x = ltr ? -W + (vw + W) * (i / n) : vw - (vw + W) * (i / n);
        frames.push({left: `${x}px`, translate: '0 0', offset: i / n});
        if (i < n) frames.push({left: `${ltr ? x + (vw + W) / n / 2 : x - (vw + W) / n / 2}px`, translate: '0 -46px', offset: (i + .5) / n, easing: 'cubic-bezier(.2, .6, .4, 1)'});
      }
      frames.forEach(f => { if (f.easing === undefined) f.easing = 'cubic-bezier(.6, 0, .8, .4)'; });
      C.mood = 'moving';
      await anim(frames, {duration: n * 430, easing: 'linear'});
    },
    async dash(t, opts) { await pass(t, opts, false); },
    async flyby(t, opts) { await pass(t, opts, true); },
    async rocket(t, opts) {
      // Rides a little rocket across the top of the screen, helmet on (a nod to the site's space theme).
      spawn(90, {face: 'star', ...opts, outfit: opts.outfit || 'astronaut'});
      setProp('rocket');
      C.el.classList.add('is-passing');
      const ltr = Math.random() < .5, vw = window.innerWidth, y = rand(window.innerHeight * .16, window.innerHeight * .34);
      C.el.dataset.flip = ltr ? '' : '1';
      C.el.style.top = `${y}px`;
      const a = ltr ? -W * 1.6 : vw + W * .6, b = ltr ? vw + W * .6 : -W * 1.6;
      await anim([{left: `${a}px`, translate: '0 30px'}, {left: `${(a + b) / 2}px`, translate: '0 -20px'}, {left: `${b}px`, translate: '0 -60px'}], {duration: rand(2200, 2800), easing: 'cubic-bezier(.45, 0, .55, 1)'});
    },
    async sleep(t, opts) {
      // Dozes on the tab bar's glass (phones) or at the bottom edge of the screen; a touch wakes it with a start.
      const bar = visibleRect(document.querySelector('.ui-mobile-nav'));
      spawn(bar ? 76 : 90, {...opts, outfit: 'nightcap', face: 'closed'});
      C.el.classList.add('is-sleeping');
      const x = rand(window.innerWidth * .55, window.innerWidth - W - 14);
      const y = bar ? bar.top - H + 6 : window.innerHeight - H * .62;
      Object.assign(C.el.style, {left: `${x}px`, top: `${y}px`});
      C.mood = 'sleep';
      await anim([{opacity: 0, translate: '0 16px'}, {opacity: 1, translate: '0 0'}], {duration: 600, easing: EASE});
      const end = performance.now() + rand(6500, 9500);
      while (mine(t) && C.mood === 'sleep' && performance.now() < end) { fx('z', C.el, 1); await wait(1100); }
      if (!mine(t) || C.mood !== 'sleep') return;
      C.el.classList.remove('is-sleeping');
      setFace('open');
      await rigAnim([{transform: 'none'}, {transform: 'scale(1.06, .92)'}, {transform: 'none'}], {duration: 500, easing: EASE});
      await wait(400);
      if (!mine(t)) return;
      const r = C.el.getBoundingClientRect();
      C.el.getAnimations().forEach(a => a.cancel());
      Object.assign(C.el.style, {left: '0px', top: '0px'});
      C.x = r.left; C.y = r.top; place();
      await leave(t);
    }
  };
  // Straight past the screen: a quick dash (it can be caught), or a big blurry one right past the "camera".
  async function pass(t, opts, near) {
    spawn(near ? 98 : 90, opts);
    C.el.classList.add('is-walking');
    if (near) C.el.classList.add('is-near', 'is-passing');
    const ltr = Math.random() < .5, vw = window.innerWidth, vh = window.innerHeight;
    C.el.dataset.flip = ltr ? '1' : '';
    C.el.style.top = `${near ? vh - H * 2.2 : rand(vh * .35, vh * .7)}px`;
    const span = near ? W * 3 : W;
    C.mood = 'moving';
    await anim([{left: `${ltr ? -span : vw + span}px`}, {left: `${ltr ? vw + span : -span}px`}], {duration: near ? rand(900, 1200) : rand(1500, 2200), easing: near ? 'cubic-bezier(.4, 0, .6, 1)' : 'linear'});
  }
  async function appear(kind = pick(), opts = {}) {
    if (busy || blocked() || !SCENES[kind]) return false;
    busy = true;
    const t = own();
    let result = true;
    try { result = (await SCENES[kind](t, opts)) !== false; }
    catch (error) { result = false; }
    finally { if (mine(t) || (owner === t && !C)) vanish(); }
    return result;
  }

  // ---------- Playing with it ----------
  // The mouse: eyes follow it; one that rushes at the creature scares it away, a slow one is watched with big eyes.
  function watch(t) {
    if (!fine.matches) return () => {};
    let lx = 0, ly = 0, lt = 0;
    const onMove = event => {
      if (!mine(t) || C.mood !== 'peek') return;
      const now = performance.now(), speed = lt ? Math.hypot(event.clientX - lx, event.clientY - ly) / Math.max(1, now - lt) : 0;
      lx = event.clientX; ly = event.clientY; lt = now;
      const r = C.el.getBoundingClientRect(), dx = event.clientX - (r.left + r.width / 2), d = Math.hypot(dx, event.clientY - (r.top + r.height / 2));
      look(Math.abs(dx) < 30 ? 0 : (dx > 0) !== (C.el.dataset.flip === '1') ? 1 : -1);
      if (d < 90 && speed > 1.3) startle();
      else if (d < 150 && !C.busyFace) { setFace('wide'); C.until = Math.max(C.until, now + 900); }
    };
    document.addEventListener('pointermove', onMove, {passive: true});
    return () => document.removeEventListener('pointermove', onMove);
  }
  // Startled (a mouse rushing in): a jump, a few sparks, straight back behind its glass.
  function startle() {
    if (!C || C.mood !== 'peek') return;
    C.mood = 'startled';
    const t = own(), back = C.hide; // its own flow now: the scene must not remove it before it has ducked back
    setFace('squint');
    fx('spark', C.el, 8);
    play(C.rig, [{transform: 'none'}, {transform: 'translateY(-8px)', offset: .45}, {transform: 'none'}], {duration: 360, easing: 'cubic-bezier(.3, .7, .4, 1)'});
    buzz(8);
    setTimeout(async () => { if (mine(t) && back) { await back(); if (mine(t)) vanish(); } }, 300);
  }
  // Taps: a bounce, then a spin, then hearts, and at the fourth a little celebration. Two quick taps: a new outfit.
  function tapped() {
    if (!C) return;
    const now = performance.now();
    if (C.mood === 'sleep') { wake(); return; }
    if (C.mood === 'moving') { caught(); return; }
    if (C.mood !== 'peek') return;
    C.taps = C.taps.filter(x => now - x < 1600);
    const quick = C.taps.length && now - C.taps[C.taps.length - 1] < 320;
    C.taps.push(now);
    C.until = Math.max(C.until, now + 2400);
    buzz(6);
    if (quick) { restyle(); return; }
    const n = C.taps.length;
    C.busyFace = true;
    if (n >= 4) { celebrate(); return; }
    if (n === 1) { setFace('wide'); fx('spark', C.el, 8); rigAnim([{transform: 'none'}, {transform: 'scale(1.12, .84)', offset: .25}, {transform: 'translateY(-10px) scale(.94, 1.08)', offset: .6}, {transform: 'none'}], {duration: 520, easing: EASE}); }
    if (n === 2) { setFace('happy'); fx('star', C.el, 6); rigAnim([{transform: 'rotate(0)'}, {transform: 'rotate(360deg)'}], {duration: 600, easing: SPRING}); }
    if (n === 3) { setFace('heart'); C.el.classList.add('is-blush'); fx('heart', C.el, 5); rigAnim([{transform: 'none'}, {transform: 'scale(1.08)'}, {transform: 'none'}], {duration: 420, easing: SPRING}); }
    clearTimeout(C.faceTimer);
    C.faceTimer = setTimeout(() => { if (C) { C.busyFace = false; C.el.classList.remove('is-blush'); setFace(any(IDLE)); } }, 1500);
  }
  function restyle() {
    const now = C.outfit, next = any(Object.keys(OUTFITS).filter(k => k !== now));
    fx('poof', C.el, 7);
    rigAnim([{transform: 'scale(1)'}, {transform: 'scale(.6, 1.2)', offset: .35}, {transform: 'scale(1)'}], {duration: 420, easing: SPRING});
    setTimeout(() => { if (C) { setOutfit(next); setFace('happy'); } }, 140);
  }
  async function celebrate() {
    const t = own();
    C.mood = 'party';
    setOutfit('party');
    setFace('star');
    fx('confetti', C.el, 22);
    buzz([10, 40, 10]);
    await rigAnim([{transform: 'none'}, {transform: 'translateY(-18px) rotate(-8deg)', offset: .3}, {transform: 'none', offset: .55}, {transform: 'translateY(-12px) rotate(8deg)', offset: .8}, {transform: 'none'}], {duration: 1100, easing: EASE});
    if (!mine(t)) return;
    await wait(500);
    if (!mine(t)) return;
    freeze();
    await leave(t, true);
  }
  // Caught while dashing or hopping: it trips, looks dizzy, gets up and runs off.
  async function caught() {
    const t = own();
    freeze();
    C.mood = 'react';
    setFace('dizzy');
    fx('star', C.el, 6);
    buzz(12);
    await rigAnim([{transform: 'none'}, {transform: 'rotate(-90deg) translateY(4px)', offset: .3}, {transform: 'rotate(-90deg) translateY(4px)', offset: .75}, {transform: 'none'}], {duration: 1300, easing: EASE});
    if (!mine(t)) return;
    setFace('happy');
    await leave(t, true);
  }
  async function wake() {
    const t = own();
    C.mood = 'react';
    C.el.classList.remove('is-sleeping');
    setFace('wide');
    fx('spark', C.el, 8);
    buzz(10);
    await rigAnim([{transform: 'none'}, {transform: 'translateY(-16px)', offset: .4}, {transform: 'none'}], {duration: 460, easing: 'cubic-bezier(.3, .7, .4, 1)'});
    if (!mine(t)) return;
    freeze();
    setFace('squint');
    await leave(t, true);
  }
  // Press and hold: petting. Happy face, blush, hearts.
  function pet() {
    if (!C || !['peek', 'sleep'].includes(C.mood)) return false;
    C.petting = true;
    C.busyFace = true;
    setFace('happy');
    C.el.classList.add('is-blush', 'is-petted');
    buzz(15);
    fx('heart', C.el, 2);
    C.petTimer = setInterval(() => { if (C?.petting) { fx('heart', C.el, 1); C.until = Math.max(C.until, performance.now() + 1800); } }, 380);
    return true;
  }
  function endPet() {
    if (!C) return;
    clearInterval(C.petTimer);
    C.petting = false;
    C.el.classList.remove('is-petted');
    C.until = performance.now() + 1600;
    setTimeout(() => { if (C) { C.busyFace = false; C.el.classList.remove('is-blush'); } }, 1200);
    if (C.mood === 'sleep') wake();
  }
  // Grab and drag (any pointer); let go with a flick to throw it.
  function grabStart(event) {
    if (!C || event.button > 0 || ['flying', 'leaving', 'startled', 'hiding'].includes(C.mood)) return;
    if (event.pointerType === 'mouse') event.preventDefault(); // no text selection while dragging
    const el = C.el, sx = event.clientX, sy = event.clientY;
    let held = false, petted = false, samples = [];
    try { el.setPointerCapture(event.pointerId); } catch (e) { /* synthetic */ }
    const press = setTimeout(() => { petted = pet(); }, 430);
    const move = ev => {
      if (!C) return;
      if (!held && !petted && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 9) { clearTimeout(press); held = grab(sx, sy); } // anchored where it was pressed
      if (!held) return;
      C.x = ev.clientX - C.gx; C.y = ev.clientY - C.gy;
      place();
      samples.push([ev.clientX, ev.clientY, performance.now()]);
      samples = samples.slice(-6);
      const [a, b] = [samples[0], samples[samples.length - 1]], vx = b && a && b[2] > a[2] ? (b[0] - a[0]) / (b[2] - a[2]) : 0;
      C.rig.style.transform = `rotate(${Math.max(-28, Math.min(28, -vx * 14)).toFixed(1)}deg)`; // swings with the motion
    };
    const up = ev => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      clearTimeout(press);
      if (!C) return;
      C.pressHandled = true; // the click that follows is not a tap
      if (held) { const a = samples[0], b = samples[samples.length - 1]; const dt = a && b ? Math.max(16, b[2] - a[2]) : 16; fling(a && b ? (b[0] - a[0]) / dt : 0, a && b ? (b[1] - a[1]) / dt : 0); }
      else if (petted) endPet();
      else if (ev.type === 'pointerup') tapped();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  function grab(px, py) {
    own();
    freeze();
    C.mood = 'held';
    C.gx = px - C.x; C.gy = py - C.y;
    C.el.style.zIndex = '97';
    C.el.classList.add('is-held');
    C.busyFace = true;
    setFace('wide');
    clearTimeout(C.faceTimer);
    C.faceTimer = setTimeout(() => { if (C?.mood === 'held') setFace(any(['happy', 'star', 'open'])); }, 700);
    buzz(8);
    return true;
  }
  // Thrown: falls with gravity, bounces off the screen edges and lands on the tab bar's glass (or the bottom).
  function fling(vx, vy) {
    const t = owner;
    C.mood = 'flying';
    C.el.classList.remove('is-held');
    vx = Math.max(-3, Math.min(3, vx)); vy = Math.max(-3, Math.min(3, vy));
    const strong = Math.hypot(vx, vy) > 1.2;
    if (strong) setFace('wide');
    const bar = visibleRect(document.querySelector('.ui-mobile-nav'));
    const floor = (bar && bar.top > window.innerHeight / 2 ? bar.top : window.innerHeight) - H + 4;
    let spin = 0, last = performance.now(), bounces = 0, raf = 0;
    const step = now => {
      if (!mine(t)) return;
      const dt = Math.min(32, now - last); last = now;
      vy += .0032 * dt;
      C.x += vx * dt; C.y += vy * dt;
      spin += vx * dt * .5;
      if (C.x < 0) { C.x = 0; vx = Math.abs(vx) * .55; bounces++; }
      if (C.x > window.innerWidth - W) { C.x = window.innerWidth - W; vx = -Math.abs(vx) * .55; bounces++; }
      if (C.y < 0) { C.y = 0; vy = Math.abs(vy) * .4; }
      if (C.y >= floor) {
        C.y = floor;
        if (Math.abs(vy) > .35) { vy = -Math.abs(vy) * .42; vx *= .7; bounces++; buzz(5); }
        else { vy = 0; vx *= .82; }
      }
      place();
      C.rig.style.transform = `rotate(${(spin % 360).toFixed(1)}deg)`;
      if (C.y >= floor && vy === 0 && Math.abs(vx) < .05) { landed(t, bounces > 0 || strong); return; }
      raf = requestAnimationFrame(step);
    };
    C.stop = () => cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }
  async function landed(t, rough) {
    C.stop = null;
    const turn = ((parseFloat(C.rig.style.transform.replace(/[^\d.-]/g, '')) || 0) % 360 + 360) % 360;
    C.rig.style.transform = '';
    await rigAnim([{transform: `rotate(${turn > 180 ? turn - 360 : turn}deg)`}, {transform: 'none'}], {duration: 320, easing: SPRING, fill: 'none'});
    if (!mine(t)) return;
    C.mood = 'react';
    if (rough) {
      setFace('dizzy');
      fx('star', C.el, 5);
      await rigAnim([{transform: 'rotate(0)'}, {transform: 'rotate(-7deg)'}, {transform: 'rotate(7deg)'}, {transform: 'rotate(-5deg)'}, {transform: 'rotate(0)'}], {duration: 1100, easing: 'ease-in-out', fill: 'none'});
      if (!mine(t)) return;
    }
    setFace('happy');
    await wait(300);
    if (mine(t)) await leave(t);
  }

  // ---------- Little effects (hearts, sparks, stars, confetti, poofs, Zzz): outside the page, gone when done ----------
  const PIXEL = {
    heart: ['0 0 5 4', 'M1 0h1v1H1zM3 0h1v1H3zM0 1h5v1H0zM1 2h3v1H1zM2 3h1v1H2z', '#ff5d8f'],
    star: ['0 0 3 3', 'M1 0h1v1H1zM0 1h3v1H0zM1 2h1v1H1z', '#ffd23f'],
    z: ['0 0 4 4', 'M0 0h4v1H0zM2 1h1v1H2zM1 2h1v1H1zM0 3h4v1H0z', '#cfe0ff']
  };
  function fx(kind, el, n) {
    if (!el?.isConnected) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * .35;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = kind === 'spark' ? 'fl-clawd-spark' : `fl-clawd-fx fl-clawd-${kind}`;
      p.setAttribute('aria-hidden', 'true');
      if (PIXEL[kind]) { const [box, d, fill] = PIXEL[kind]; p.innerHTML = `<svg viewBox="${box}" shape-rendering="crispEdges"><path d="${d}" fill="${fill}"/></svg>`; }
      if (kind === 'confetti') p.style.background = any(['#ff8a3d', '#2a5fc4', '#ffd23f', '#f4f6fb', '#ff5d8f']);
      p.style.left = `${cx}px`; p.style.top = `${cy}px`;
      document.body.append(p);
      const a = (Math.PI * 2 * i) / n + Math.random() * .5;
      let frames, duration;
      if (kind === 'heart' || kind === 'z') {
        const dx = kind === 'z' ? 18 + Math.random() * 12 : rand(-22, 22), dy = -(46 + Math.random() * 30);
        frames = [{transform: 'translate(-50%, -50%) scale(.4)', opacity: 0}, {transform: `translate(calc(-50% + ${dx * .3}px), calc(-50% + ${dy * .3}px)) scale(1)`, opacity: 1, offset: .25}, {transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.9)`, opacity: 0}];
        duration = kind === 'z' ? 1600 : 1100;
      } else if (kind === 'confetti') {
        const dx = Math.cos(a) * rand(30, 90), up = -rand(60, 130), spin = rand(-540, 540);
        frames = [{transform: 'translate(-50%, -50%) rotate(0)', opacity: 1}, {transform: `translate(calc(-50% + ${dx * .7}px), calc(-50% + ${up}px)) rotate(${spin / 2}deg)`, opacity: 1, offset: .4}, {transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${up + 160}px)) rotate(${spin}deg)`, opacity: 0}];
        duration = rand(1100, 1500);
      } else if (kind === 'poof') {
        const d = rand(18, 30);
        frames = [{transform: 'translate(-50%, -50%) scale(.4)', opacity: .9}, {transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(1.5)`, opacity: 0}];
        duration = 520;
      } else {
        const d = 26 + Math.random() * 22;
        frames = [{transform: 'translate(-50%, -50%) scale(1)', opacity: 1}, {transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.25)`, opacity: 0}];
        duration = 560;
      }
      const run = play(p, frames, {duration, delay: kind === 'heart' && n > 1 ? i * 90 : 0, easing: EASE, fill: 'backwards'});
      if (run) run.finished.then(() => p.remove(), () => p.remove()); else p.remove();
    }
  }

  // ---------- When it comes out ----------
  let quiet = false; // flClawd.quiet(): no visits of its own (tests drive it by hand); gestures still call it
  function schedule(first) {
    clearTimeout(timer);
    if (quiet) return;
    timer = setTimeout(async () => {
      if (!blocked()) await appear(pick());
      schedule(false);
    }, first ? rand(5000, 10000) : rand(14000, 32000));
  }
  // Leaving for 比賽場記 (or opening a panel) sends it away at once.
  new MutationObserver(() => { if (C && blocked()) vanish(); }).observe(document.body, {attributes: true, attributeFilter: ['data-page', 'class']});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(false); });
  // Nobody touching the page for a while: it comes out for a nap.
  let lastInput = performance.now(), napped = false;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(type => document.addEventListener(type, () => { lastInput = performance.now(); napped = false; }, {passive: true, capture: true}));
  window.addEventListener('scroll', () => { lastInput = performance.now(); napped = false; }, {passive: true});
  setInterval(() => { if (!quiet && !napped && !busy && performance.now() - lastInput > 30000 && document.visibilityState === 'visible' && !blocked()) { napped = true; appear('sleep'); } }, 5000);
  // The team logo, tapped three times quickly, calls it out.
  let logoTaps = [];
  document.addEventListener('click', event => {
    if (!event.target.closest?.('.fl-top-logo, .fl-side-brand')) return;
    const now = performance.now();
    logoTaps = [...logoTaps.filter(x => now - x < 1400), now];
    if (logoTaps.length < 3) return;
    logoTaps = [];
    if (C) { if (C.mood === 'peek') tapped(); return; }
    setTimeout(() => appear(any(scenes().filter(([k]) => ['bar-peek', 'side-peek', 'drop', 'header-hang', 'hop', 'rocket'].includes(k)).map(([k]) => k).concat('hop')), {face: 'star'}), 350);
  }, true);
  // Shaking the phone (Android; iPhones ask for permission, so not there): dizzy if it is out, otherwise it drops in.
  if ('DeviceMotionEvent' in window && typeof DeviceMotionEvent.requestPermission !== 'function' && window.matchMedia('(pointer: coarse)').matches) {
    let jolts = [];
    window.addEventListener('devicemotion', event => {
      const a = event.acceleration;
      if (!a || Math.hypot(a.x || 0, a.y || 0, a.z || 0) < 18) return;
      const now = performance.now();
      jolts = [...jolts.filter(x => now - x < 700), now];
      if (jolts.length < 3) return;
      jolts = [];
      if (C && C.mood === 'peek') { C.busyFace = true; setFace('dizzy'); fx('star', C.el, 5); C.until = performance.now() + 1500; setTimeout(() => { if (C) C.busyFace = false; }, 1400); }
      else if (!C) appear(scenes().some(([k]) => k === 'drop') ? 'drop' : 'hop');
    }, {passive: true});
  }
  window.flClawd = {
    appear: (kind, opts) => appear(kind, opts || {}),
    scenes: () => scenes().map(([name]) => name),
    outfits: () => [...Object.keys(OUTFITS), 'party', 'nightcap'],
    faces: () => FACES.slice(),
    quiet() { quiet = true; clearTimeout(timer); if (C) vanish(); },
    startle
  };
  schedule(true);
})();
