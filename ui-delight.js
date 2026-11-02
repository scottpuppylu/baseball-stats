// ui-delight.js — small moments of delight on top of the app shell (ui-app.js), plus a few flow shortcuts.
// Effects are written for this site (ideas from reactbits.dev: Blur Text, Count Up, Shiny Text, Star Border, Spotlight
// Card, Magnet, Galaxy/Particles, Scroll Reveal), in plain JS + CSS so they cost almost nothing on phones:
//   Home      twinkling star field with shooting stars behind the hero, the team name settling in from a blur, numbers
//             counting up, an orbiting light around the main button, bands revealed on scroll, a spotlight on cards.
//   Clawd     a little orange pixel creature (an homage to Claude's mascot) in the team's blue AE cap that lives in the
//             site: it peeks out from behind the liquid glass, sneaks behind the tab bar, dashes past the screen, and
//             hides when startled. It never talks. Never on 比賽場記: scoring needs full attention.
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

  // ---------- Numbers count up (Count Up). The final text is restored exactly at the end. ----------
  function countUp(el, delay) {
    const final = el.textContent;
    const m = final.match(/(\d*)\.(\d+)|\d+/);
    if (!m || reduce.matches) return;
    const token = m[0], target = parseFloat(token.startsWith('.') ? `0${token}` : token);
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = (token.split('.')[1] || '').length, bareDot = token.startsWith('.');
    const fmt = v => { let s = v.toFixed(decimals); if (bareDot) s = s.replace(/^0(?=\.)/, ''); return final.slice(0, m.index) + s + final.slice(m.index + token.length); };
    const t0 = performance.now() + delay, dur = 1100;
    const step = now => {
      if (!el.isConnected) return;
      const k = Math.max(0, Math.min(1, (now - t0) / dur));
      el.textContent = k >= 1 ? final : fmt(target * OUT_EXPO(k));
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = fmt(0);
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
    const card = event.target.closest && event.target.closest('.fl-card, .fl-tile');
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
  window.siteHooks.after('switchMainTab', 'ui-delight', tabId => {
    if (tabId === 'tabHome') requestAnimationFrame(() => enhanceHome(true));
    else if (stars) stars.stop();
  });
  window.siteHooks.after('renderAll', 'ui-delight', () => { if (page() === 'Home') requestAnimationFrame(() => enhanceHome(false)); });
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
      items.push({kind: '頁面', label: titleOf(key), hint: group || '主頁', keywords: `${titleOf(key)} ${nav.labels?.[key] || ''} ${group}`, run: () => nav.openPage(key)});
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
    playerSelect.after(wrap);
    wrap.addEventListener('click', event => { const b = event.target.closest('[data-step]'); if (b) stepPlayer(Number(b.dataset.step)); });
    // A horizontal swipe on the profile's first card (the photo and basic numbers), not on charts or tables.
    let sx = 0, sy = 0, st = 0, tracking = false;
    document.addEventListener('touchstart', event => {
      const card = event.target.closest && event.target.closest('#panelProfile > section:first-of-type');
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
  // Clawd: a little orange pixel creature that lives in the site (an homage to Claude's mascot), usually wearing the
  // team's blue AE cap. It does not talk. Now and then it peeks out from behind a liquid-glass surface (glass is its
  // cover: behind it, Clawd shows blurred and bent), looks around, and ducks back; or it dashes past the screen.
  // Tap it (or bring the mouse close) and it startles and hides. Never on 比賽場記, never while a panel or dialog is
  // open, never with "reduce motion". Off in the isolated test preview unless ?clawd. Between visits it is not in the page.
  // =====================================================================================================
  if (config.easterEgg === false || reduce.matches) return;
  const SIZE = 3; // CSS px per pixel of the 22×18 sprite
  const W = 22 * SIZE, H = 18 * SIZE;
  const px = (x, y, w, h, fill, cls = '') => `<rect${cls ? ` class="${cls}"` : ''} x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  const ORANGE = '#D97757', LIGHT = '#E89A7E', SHADE = '#B85E40', LEG = '#C9694B', EYE = '#16171a', CAP = '#2a5fc4', CAP_DARK = '#1b4291', CAP_LIGHT = '#4a7fe0';
  function sprite(cap) {
    const parts = [];
    // Body, arms, eyes (the eyes slide with --fl-look to follow the pointer), legs.
    parts.push(`<g class="cl-body">${px(3, 7, 16, 7, ORANGE)}${cap ? '' : px(3, 7, 16, 1, LIGHT)}${px(3, 13, 16, 1, SHADE)}`
      + `${px(1, 9, 2, 3, ORANGE, 'cl-arm cl-arm-l')}${px(19, 9, 2, 3, ORANGE, 'cl-arm cl-arm-r')}`
      + `<g class="cl-eyes">${px(7, 9, 1, 2, EYE)}${px(14, 9, 1, 2, EYE)}</g></g>`);
    parts.push([4, 7, 14, 17].map((x, i) => px(x, 14, 1, 3, LEG, `cl-leg cl-leg-${i % 2 ? 'b' : 'a'}`)).join(''));
    if (cap) {
      // The team cap: blue crown, darker brim, white "AE" on the front panel.
      parts.push(`<g class="cl-cap">${px(6, 1, 10, 1, CAP)}${px(5, 2, 12, 4, CAP)}${px(6, 2, 10, 1, CAP_LIGHT)}${px(3, 6, 16, 1, CAP_DARK)}`
        + [[8, 2], [7, 3], [9, 3], [7, 4], [8, 4], [9, 4], [7, 5], [9, 5]].map(([x, y]) => px(x, y, 1, 1, '#ffffff')).join('')
        + [[12, 2], [13, 2], [14, 2], [12, 3], [12, 4], [13, 4], [12, 5], [13, 5], [14, 5]].map(([x, y]) => px(x, y, 1, 1, '#ffffff')).join('') + '</g>');
    }
    return `<svg viewBox="0 0 22 18" width="${W}" height="${H}" shape-rendering="crispEdges" aria-hidden="true">${parts.join('')}</svg>`;
  }
  let clawd = null, busyClawd = false, timer = 0, mood = null;
  const blocked = () => page() === 'Scorebook' || document.visibilityState !== 'visible' || palette
    || document.body.classList.contains('ui-nav-open') || document.body.classList.contains('fl-tools-open')
    || document.querySelector('[id$="Modal"]:not(.hidden), #uiFormDialog, #insightImageModal, .fl-point-chip');
  const visibleRect = el => (el && el.getClientRects().length ? el.getBoundingClientRect() : null);
  const rand = (a, b) => a + Math.random() * (b - a);
  // Where Clawd can appear on this screen right now: behind which glass, and how.
  function scenes() {
    const list = [];
    const bar = visibleRect(document.querySelector('.ui-mobile-nav'));
    const header = visibleRect(document.getElementById('appHeader'));
    const side = visibleRect(document.getElementById('mainNavigation'));
    if (bar && bar.top > window.innerHeight / 2 && bar.height >= H) { list.push(['bar-peek', 4], ['bar-sneak', 2]); }
    if (header && header.bottom > 20 && header.bottom < window.innerHeight / 3) list.push(['header-hang', 2]);
    if (side && side.left < 40 && side.height > 300 && side.width < 400) list.push(['side-peek', 3]);
    list.push(['dash', 2], ['flyby', 1]);
    return list;
  }
  function pick() {
    const list = scenes(), total = list.reduce((n, [, w]) => n + w, 0);
    let r = Math.random() * total;
    for (const [name, w] of list) { if ((r -= w) <= 0) return name; }
    return list[0][0];
  }
  function spawn(z, cap = Math.random() < .75) {
    clawd = document.createElement('button');
    clawd.type = 'button';
    clawd.id = 'flClawd';
    clawd.tabIndex = -1;
    clawd.setAttribute('aria-label', '小彩蛋：戴著 AE 球帽的橘色小生物');
    clawd.innerHTML = sprite(cap);
    clawd.style.zIndex = String(z);
    document.body.append(clawd);
    clawd.addEventListener('click', event => { event.stopPropagation(); startle(); });
    return clawd;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const anim = (frames, options, el = clawd) => { const a = el && play(el, frames, {fill: 'forwards', ...options}); return a ? a.finished.catch(() => {}) : Promise.resolve(); };
  const look = dir => clawd && clawd.style.setProperty('--fl-look', String(dir));
  // The eyes follow the mouse; a mouse that comes too close scares Clawd away.
  function watch(el) {
    if (!fine.matches) return () => {};
    const onMove = event => {
      if (!clawd) return;
      const r = clawd.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const flipped = clawd.dataset.flip === '1';
      const dx = event.clientX - cx;
      look(Math.abs(dx) < 30 ? 0 : (dx > 0) !== flipped ? 1 : -1);
      if (Math.hypot(dx, event.clientY - cy) < 70) startle();
    };
    document.addEventListener('pointermove', onMove, {passive: true});
    return () => document.removeEventListener('pointermove', onMove);
  }
  async function lookAround(ms) {
    const end = performance.now() + ms;
    while (clawd && mood === 'peek' && performance.now() < end) {
      if (!fine.matches) look([-1, 0, 1, 0][Math.floor(Math.random() * 4)]);
      await wait(rand(500, 900));
    }
    look(0);
  }
  let hide = null; // the current scene's way back behind its glass
  async function appear(kind) {
    if (busyClawd || blocked()) return false;
    busyClawd = true;
    try {
      const vw = window.innerWidth, vh = window.innerHeight;
      if (kind === 'bar-peek' || kind === 'bar-sneak') {
        const bar = visibleRect(document.querySelector('.ui-mobile-nav'));
        if (!bar) return false;
        spawn(74); // just below the tab bar (z 75): the bar's glass covers it
        const top = bar.top + (bar.height - H) / 2 + 2;
        if (kind === 'bar-sneak') {
          // Walking along behind the glass: seen blurred and bent, never in front of the buttons.
          const ltr = Math.random() < .5;
          clawd.style.top = `${top}px`;
          clawd.dataset.flip = ltr ? '1' : '';
          clawd.classList.add('is-walking');
          await anim([{left: `${ltr ? bar.left - W : bar.right}px`}, {left: `${ltr ? bar.right : bar.left - W}px`}], {duration: rand(2200, 3200), easing: 'linear'});
          return true;
        }
        const left = rand(bar.left + 12, bar.right - W - 12);
        Object.assign(clawd.style, {left: `${left}px`, top: `${top}px`});
        mood = 'peek';
        hide = () => anim([{translate: '0 -34px'}, {translate: '0 0'}], {duration: 260, easing: 'cubic-bezier(.5, 0, .75, 0)'});
        const stopWatch = watch();
        await anim([{translate: '0 0'}, {translate: '0 -34px'}], {duration: 520, easing: SPRING});
        await lookAround(rand(1800, 3200));
        stopWatch();
        if (mood === 'peek') { mood = null; await hide(); }
        return true;
      }
      if (kind === 'header-hang') {
        const header = visibleRect(document.getElementById('appHeader'));
        if (!header) return false;
        spawn(69, false); // under the top bar (z 70); hanging upside down, a cap would fall off
        clawd.classList.add('is-upside');
        const left = rand(Math.max(header.left + 80, 12), Math.max(header.left + 90, header.right - W - 120));
        Object.assign(clawd.style, {left: `${left}px`, top: `${header.bottom - H}px`});
        mood = 'peek';
        hide = () => anim([{translate: '0 40px'}, {translate: '0 0'}], {duration: 260, easing: 'cubic-bezier(.5, 0, .75, 0)'});
        const stopWatch = watch();
        await anim([{translate: '0 0'}, {translate: '0 48px', offset: .7}, {translate: '0 40px'}], {duration: 700, easing: EASE});
        await lookAround(rand(1600, 2800));
        stopWatch();
        if (mood === 'peek') { mood = null; await hide(); }
        return true;
      }
      if (kind === 'side-peek') {
        const side = visibleRect(document.getElementById('mainNavigation'));
        if (!side) return false;
        spawn(59); // under the sidebar (z 60)
        clawd.classList.add('is-sideways');
        const top = rand(side.top + side.height * .3, side.bottom - H - 60);
        Object.assign(clawd.style, {left: `${side.right - W - 6}px`, top: `${top}px`});
        mood = 'peek';
        hide = () => anim([{translate: '50px 0'}, {translate: '0 0'}], {duration: 260, easing: 'cubic-bezier(.5, 0, .75, 0)'});
        const stopWatch = watch();
        await anim([{translate: '0 0'}, {translate: '50px 0'}], {duration: 560, easing: SPRING});
        await lookAround(rand(1800, 3200));
        stopWatch();
        if (mood === 'peek') { mood = null; await hide(); }
        return true;
      }
      if (kind === 'dash' || kind === 'flyby') {
        // Straight past the screen, in front of everything: a quick dash, or a big blurry one right past the "camera".
        const near = kind === 'flyby';
        spawn(near ? 98 : 90);
        clawd.classList.add('is-walking', 'is-passing');
        if (near) clawd.classList.add('is-near');
        const ltr = Math.random() < .5;
        clawd.dataset.flip = ltr ? '1' : '';
        const y = near ? vh - H * 2.4 : rand(vh * .35, vh * .72);
        clawd.style.top = `${y}px`;
        const span = near ? W * 3 : W;
        await anim([{left: `${ltr ? -span : vw + span}px`}, {left: `${ltr ? vw + span : -span}px`}], {duration: near ? rand(900, 1200) : rand(1500, 2200), easing: near ? 'cubic-bezier(.4, 0, .6, 1)' : 'linear'});
        return true;
      }
      return false;
    } finally {
      mood = null; hide = null;
      clawd?.remove(); clawd = null;
      busyClawd = false;
    }
  }
  // Startled: a jump with a few sparks, then straight back behind its glass (or off screen).
  function startle() {
    if (!clawd || mood !== 'peek') return;
    mood = 'startled';
    const back = hide;
    sparksAt(clawd);
    play(clawd.querySelector('svg'), [{translate: '0 0'}, {translate: '0 -12px', offset: .45}, {translate: '0 0'}], {duration: 360, easing: 'cubic-bezier(.3, .7, .4, 1)'});
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* not allowed */ } }
    setTimeout(() => { if (back) back(); }, 300);
  }
  function sparksAt(el) {
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('i');
      s.className = 'fl-clawd-spark';
      s.style.left = `${r.left + r.width / 2}px`;
      s.style.top = `${r.top + r.height / 2}px`;
      document.body.append(s);
      const a = (Math.PI * 2 * i) / 8 + Math.random() * .4, d = 24 + Math.random() * 20;
      const fx = play(s, [{transform: 'translate(-50%, -50%) scale(1)', opacity: 1}, {transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.2)`, opacity: 0}], {duration: 520, easing: EASE});
      if (fx) fx.finished.then(() => s.remove(), () => s.remove()); else s.remove();
    }
  }
  function schedule(first) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!blocked()) await appear(pick());
      schedule(false);
    }, first ? rand(9000, 16000) : rand(22000, 55000));
  }
  // Leaving for 比賽場記 (or opening a panel) sends it away at once.
  new MutationObserver(() => { if (clawd && blocked()) { mood = null; clawd.remove(); clawd = null; } }).observe(document.body, {attributes: true, attributeFilter: ['data-page', 'class']});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(false); });
  window.flClawd = {appear, scenes: () => scenes().map(([name]) => name), startle};
  schedule(true);
})();
