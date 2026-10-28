// ui-app.js — app shell: the home page (the landing page), the 版本紀錄 page, the team logo as a home button,
// back-button navigation between pages, and touch-friendly chart points. Presentation only: it reads the site's
// statistics through the same functions the pages use and never writes data or replaces a handler.
(function () {
  'use strict';
  const nav = document.getElementById('mainNavigation');
  const main = document.querySelector('#appWorkspace main');
  if (!nav || !main || !window.siteHooks || typeof window.switchMainTab !== 'function') return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  // The classes the site's own switch gives its buttons (team-records.js uses the same pair).
  const ACTIVE = 'tab-active text-xs px-3 py-1.5 rounded-lg border font-bold transition flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0';
  const INACTIVE = 'text-slate-400 hover:text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-transparent font-medium transition flex items-center gap-1.5 whitespace-nowrap shrink-0';

  // A page this layer owns: its own button and panel. The site's switch hides every page for an id it does not know;
  // the hook then shows this one. Hidden, a page keeps no markup (the page HTML has a size budget), and re-renders when shown.
  function addPage(key, label, icon, render) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `btnTab${key}`;
    button.className = INACTIVE;
    button.innerHTML = `${icon}<span>${label}</span>`;
    button.addEventListener('click', () => switchMainTab(`tab${key}`));
    nav.append(button); // ui-comfort.js puts it in its group
    const panel = document.createElement('div');
    panel.id = `panel${key}`;
    panel.className = 'hidden space-y-6';
    main.append(panel);
    window.siteHooks.after('switchMainTab', 'ui-app', tabId => {
      const on = tabId === `tab${key}`;
      panel.classList.toggle('hidden', !on);
      button.className = on ? ACTIVE : INACTIVE;
      window.PageRendering.cachedPanel(panel, on, render);
    });
    window.siteHooks.after('renderAll', 'ui-app', () => { if (!panel.classList.contains('hidden')) window.PageRendering.cachedPanel(panel, true, render); });
    return {button, panel};
  }
  const svg = path => `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

  // ---------- Home ----------
  const fmt3 = v => (Number.isFinite(v) ? v.toFixed(3).replace(/^0(?=\.)/, '') : '—');
  function dateRangeText() {
    const start = document.getElementById('filterStartDate')?.value, end = document.getElementById('filterEndDate')?.value;
    return start || end ? `${start || '不限'} ～ ${end || '不限'}` : '全部日期';
  }
  const shortDate = d => esc(String(d || '').slice(5).replace('-', '/'));
  function gameCard(game) {
    const pa = (game.innings || []).reduce((n, inn) => n + (inn.plateAppearances || []).length, 0);
    const recorded = typeof isGameScoreRecorded === 'function' ? isGameScoreRecorded(game) : !!game.finalScore;
    const us = game.finalScore?.us ?? 0, opp = game.finalScore?.opp ?? 0;
    const result = !recorded ? '<span class="fl-tag">未記比分</span>'
      : `<span class="fl-score ${us > opp ? 'is-win' : us < opp ? 'is-loss' : ''}">${us}<i>:</i>${opp}</span>`;
    return `<button type="button" class="fl-card" data-game="${esc(game.id)}"><span class="fl-card-date">${shortDate(game.date)}</span>
      <span class="fl-card-title">vs ${esc(game.opponent || '對手')}</span>${result}<span class="fl-card-meta">${pa} 打席・查看覆盤 ›</span></button>`;
  }
  function leaderCard(label, player, value) {
    if (!player) return `<div class="fl-card is-empty"><span class="fl-card-date">${label}</span><span class="fl-card-meta">尚無符合條件的球員</span></div>`;
    const jersey = typeof NAME_TO_JERSEY !== 'undefined' && NAME_TO_JERSEY[player.name] != null ? `#${NAME_TO_JERSEY[player.name]} ` : '';
    const avatar = typeof renderAvatarElement === 'function' ? renderAvatarElement(player.name, 'fl-card-avatar text-2xl') : '';
    return `<button type="button" class="fl-card fl-leader" data-player="${esc(player.name)}">${avatar}<span class="fl-card-date">${label}</span>
      <span class="fl-card-value">${esc(value)}</span><span class="fl-card-meta">${esc(jersey + player.name)}・個人檔案 ›</span></button>`;
  }
  const TILES = {
    '球隊數據': ['TEAM DATA', 'data', '全隊成績、象限分析、投手指標與生涯紀錄。'],
    '球員': ['PLAYERS', 'player', '個人能力檔案、排行榜、雙人比較與健康資料。'],
    '比賽': ['GAME DAY', 'game', '出席與打線推薦、即時場記與賽事覆盤。'],
    '參考': ['REFERENCE', 'home', '每項指標的定義與公式，以及版本更新紀錄。']
  };
  function renderHome(panel) {
    let agg = null;
    try { agg = getAnalysisAgg(); } catch (error) { agg = null; }
    const players = agg ? agg.players : [];
    const minPa = typeof rateQualifyingPa === 'function' ? rateQualifyingPa(players) : 0;
    const qualified = players.filter(p => p.pa >= minPa);
    const top = (list, key) => [...list].sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
    const games = [...(window.allGames || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const live = window.activeGame && window.activeGame.status !== 'finished';
    const latest = games[0];
    const version = (window.CHANGELOG && window.CHANGELOG[0]) || null;
    const telemetry = agg ? [
      ['AVG', '打擊率', fmt3(agg.teamAvg)], ['OBP', '上壘率', fmt3(agg.teamObp)], ['OPS', '攻擊指數', fmt3(agg.teamOps)], ['PA', '打席', String(agg.totalPa)]
    ] : [];
    const groups = (window.uiNavigation?.groups || []).filter(([label]) => label);
    const avg = top(qualified, 'avg'), hr = top(players, 'hr'), wrc = top(qualified, 'wrc_plus');
    panel.innerHTML = `<div class="fl-home">
      <div class="fl-hero">
        <div class="fl-hero-inner">
          <p class="fl-eyebrow">TKU AEROSPACE · SOFTBALL</p>
          <h1 class="fl-hero-title">淡江航太系壘</h1>
          <p class="fl-hero-sub">${games.length ? `已記錄 ${games.length} 場比賽${latest ? `，最近一場 ${shortDate(latest.date)} 對 ${esc(latest.opponent || '對手')}` : ''}。` : '從第一場比賽開始記錄。'}</p>
          <div class="fl-hero-cta">
            <button type="button" class="fl-cta" data-go="Scorebook">${live ? '繼續進行中的比賽' : '開始比賽場記'}</button>
            <button type="button" class="fl-more-link" data-go="Lineup">安排今日打線 ›</button>
          </div>
        </div>
        ${telemetry.length ? `<dl class="fl-telemetry" aria-label="全隊成績（${esc(dateRangeText())}）">${telemetry.map(([en, zh, v]) => `<div><dt><span>${en}</span>${zh}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      </div>
      <div class="fl-band">
        <div class="fl-band-head"><h2>近期比賽</h2><p>每一場的逐打席紀錄、比分與擊球落點。</p><button type="button" class="fl-more-link" data-go="Scorebook" data-sub="review">查看全部賽事 ›</button></div>
        <div class="fl-rail">${games.slice(0, 6).map(gameCard).join('') || '<p class="fl-empty">還沒有比賽紀錄，從「比賽場記」開始第一場。</p>'}</div>
      </div>
      <div class="fl-band">
        <div class="fl-band-head"><h2>區間焦點</h2><p>${esc(dateRangeText())}・打擊率與 wRC+ 需滿 ${minPa} 打席。</p><button type="button" class="fl-more-link" data-go="Leaderboard">完整排行榜 ›</button></div>
        <div class="fl-rail fl-rail-3">
          ${leaderCard('打擊王', avg, avg ? fmt3(avg.avg) : '')}
          ${leaderCard('全壘打王', hr, hr ? `${hr.hr} 支` : '')}
          ${leaderCard('進攻破壞王', wrc, wrc ? `wRC+ ${wrc.wrc_plus.toFixed(0)}` : '')}
        </div>
      </div>
      <div class="fl-band">
        <div class="fl-band-head"><h2>所有功能</h2></div>
        <div class="fl-tiles">${groups.map(([label, keys]) => {
          const [eyebrow, tone, text] = TILES[label] || ['', 'home', ''];
          const links = keys.filter(k => document.getElementById(`btnTab${k}`));
          return `<div class="fl-tile" data-tone="${tone}"><p class="fl-eyebrow">${eyebrow}</p><h3>${esc(label)}</h3><p>${text}</p>
            <div class="fl-tile-links">${links.map(k => `<button type="button" class="fl-chip" data-go="${k}">${esc(window.uiNavigation.labels[k] || k)}</button>`).join('')}</div></div>`;
        }).join('')}</div>
      </div>
      <div class="fl-home-foot">
        ${version ? `<button type="button" class="fl-more-link" data-go="Changelog">目前版本 ${esc(version.v)}・看看更新了什麼 ›</button>` : ''}
        <p>淡江航太系壘・系統建構：盧宣嘉</p>
      </div>
    </div>`;
  }
  const home = addPage('Home', '主頁', svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'), renderHome);
  home.panel.addEventListener('click', event => {
    const target = event.target.closest('[data-go], [data-game], [data-player]');
    if (!target) return;
    if (target.dataset.player) { selectedPlayerName = target.dataset.player; switchMainTab('tabProfile'); return; }
    if (target.dataset.game) {
      switchMainTab('tabScorebook');
      if (typeof switchScorebookSubTab === 'function') switchScorebookSubTab('review');
      if (typeof renderSelectedGameReview === 'function') renderSelectedGameReview(target.dataset.game);
      return;
    }
    window.uiNavigation.openPage(target.dataset.go);
    if (target.dataset.sub && typeof switchScorebookSubTab === 'function') switchScorebookSubTab(target.dataset.sub);
  });

  // ---------- 版本紀錄 ----------
  addPage('Changelog', '版本紀錄', svg('<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>'), panel => {
    if (panel.querySelector('[data-changelog-list]')) return;
    panel.innerHTML = `<div class="fl-panel"><p class="fl-panel-note">共 ${(window.CHANGELOG || []).length} 個版本，最新在最上面；點版本號展開或收起。</p><div data-changelog-list></div></div>`;
    if (typeof window.renderChangelog === 'function') window.renderChangelog(panel.querySelector('[data-changelog-list]'));
  });

  // ---------- Top bar: one slim glass bar; every tool lives in one panel ----------
  // The old two-row header (date inputs, four action buttons, status, version) becomes a single bar:
  //   phone   logo · page title (appears once the large title scrolls away) · cloud light · tools
  //   tablet  ☰ pages · logo · title · date · cloud light · tools
  //   desktop page title · date · cloud light · tools (the sidebar carries the logo and pages)
  // The existing controls are moved into the tools panel, so their IDs and handlers are unchanged.
  const goHome = () => switchMainTab('tabHome');
  const header = document.getElementById('appHeader');
  const dateControls = document.getElementById('uiDateControls');
  const dateToggle = document.getElementById('uiDateToggle');
  const drawerToggle = document.getElementById('uiDrawerToggle');
  const statusBadge = document.getElementById('syncStatusBadge');
  const statusLight = header && header.querySelector('button[onclick="showCloudStatusToast()"]');
  const brandRow = header && header.querySelector('.ui-header-brand');
  if (header && dateControls && dateToggle && statusBadge) {
    const oldRows = [...header.children];
    const actionRow = statusBadge.parentElement;
    const version = brandRow && [...brandRow.children].find(el => /^v\d{6}\.\d{4}/.test(el.textContent.trim()));
    const credit = brandRow && [...brandRow.children].find(el => el.textContent.trim().startsWith('系統建構'));
    const bar = document.createElement('div');
    bar.id = 'flTopbar';
    bar.innerHTML = '<button type="button" class="fl-top-logo" aria-label="回到主頁"><img src="assets/logo-128.webp" alt="" width="34" height="34"></button>'
      + '<span class="fl-top-title" aria-hidden="true"></span><span class="fl-top-space"></span>'
      + '<button type="button" id="flToolsButton" class="fl-top-icon" aria-controls="flTools" aria-expanded="false" aria-label="工具與篩選">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>';
    const logoButton = bar.querySelector('.fl-top-logo');
    const toolsButton = bar.querySelector('#flToolsButton');
    if (drawerToggle) bar.prepend(drawerToggle);
    toolsButton.before(dateToggle);
    if (statusLight) { statusLight.classList.add('fl-status-light'); toolsButton.before(statusLight); }
    logoButton.addEventListener('click', goHome);
    const tools = document.createElement('div');
    tools.id = 'flTools';
    tools.setAttribute('role', 'dialog');
    tools.setAttribute('aria-label', '工具與篩選');
    tools.innerHTML = '<div class="fl-tools-head"><h2>工具與篩選</h2><button type="button" class="fl-tools-done">完成</button></div>'
      + '<div class="fl-tools-group" data-k="date"><h3>日期範圍</h3></div><div class="fl-tools-group" data-k="actions"><h3>操作</h3><div class="fl-tools-actions"></div></div>'
      + '<div class="fl-tools-group" data-k="status"><h3>雲端與版本</h3><div class="fl-tools-status"></div></div>';
    tools.querySelector('[data-k="date"]').append(dateControls);
    tools.querySelector('.fl-tools-actions').append(...[...actionRow.children].filter(el => el !== statusBadge));
    tools.querySelector('.fl-tools-status').append(...[statusBadge, version, credit].filter(Boolean));
    header.prepend(bar);
    // At page level, not inside the bar: a glass element inside another glass element only sees its parent behind it.
    document.body.append(tools);
    if (window.flRefract) window.flRefract(tools); // refraction lens (ui-theme.js)
    oldRows.forEach(row => row.classList.add('fl-old-header'));
    const backdrop = document.createElement('div');
    backdrop.className = 'fl-tools-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.append(backdrop);
    // ui-comfort.js already keeps the open/closed state on <body> (ui-date-collapsed) for the date toggle; the panel
    // follows the same state, so the date chip, the tools button, 「完成」 and the backdrop all agree.
    const isOpen = () => !document.body.classList.contains('ui-date-collapsed');
    const setOpen = open => { if (open !== isOpen()) dateToggle.click(); };
    const sync = () => {
      if (isOpen()) tools.style.top = `${Math.round(header.getBoundingClientRect().bottom) + 8}px`;
      toolsButton.setAttribute('aria-expanded', String(isOpen()));
      document.body.classList.toggle('fl-tools-open', isOpen());
    };
    new MutationObserver(sync).observe(document.body, {attributes: true, attributeFilter: ['class']});
    toolsButton.addEventListener('click', () => setOpen(!isOpen()));
    tools.querySelector('.fl-tools-done').addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && isOpen()) setOpen(false); });
    window.siteHooks.after('switchMainTab', 'ui-app-tools', () => setOpen(false));
    sync();
    // Large title, iOS style: the bar shows the page title only after the page's own big title has scrolled away.
    const title = bar.querySelector('.fl-top-title');
    const pageTitle = document.getElementById('uiPageTitle');
    const heading = document.querySelector('.ui-page-heading');
    // Only write when the text changes: scroll handlers call this, and any DOM change costs work on phones.
    const copyTitle = () => { const text = document.body.dataset.page === 'Home' ? '淡江航太系壘' : (pageTitle ? pageTitle.textContent : ''); if (title.textContent !== text) title.textContent = text; };
    if (pageTitle) new MutationObserver(copyTitle).observe(pageTitle, {childList: true, characterData: true, subtree: true});
    copyTitle();
    let headingVisible = true;
    if (heading && 'IntersectionObserver' in window) {
      new IntersectionObserver(entries => { headingVisible = entries[0].isIntersecting; markBar(); }, {rootMargin: '-60px 0px 0px 0px'}).observe(heading);
    }
    // On Home the bar floats clear over the hero and turns to glass once the page scrolls.
    const markBar = () => {
      const home = document.body.dataset.page === 'Home';
      header.classList.toggle('fl-bar-clear', home && window.scrollY < 24);
      header.classList.toggle('fl-title-on', home ? window.scrollY > window.innerHeight * 0.5 : !headingVisible);
      copyTitle();
    };
    let barQueued = false;
    window.addEventListener('scroll', () => { if (barQueued) return; barQueued = true; requestAnimationFrame(() => { barQueued = false; markBar(); }); }, {passive: true});
    new MutationObserver(markBar).observe(document.body, {attributes: true, attributeFilter: ['data-page']});
    markBar();
  }
  // Desktop sidebar: the logo and team name at the top are a home button too.
  const brand = document.createElement('button');
  brand.type = 'button';
  brand.className = 'fl-side-brand';
  brand.setAttribute('aria-label', '淡江航太系壘・回到主頁');
  brand.innerHTML = '<img src="assets/logo-256.webp" alt="" width="68" height="68"><span>淡江航太系壘</span>';
  brand.addEventListener('click', goHome);
  nav.prepend(brand);

  // ---------- Back button / swipe back moves between pages, like an app ----------
  let restoring = false;
  try { history.replaceState({...(history.state || {}), flTab: 'tabHome'}, ''); } catch (error) { /* sandboxed */ }
  window.siteHooks.after('switchMainTab', 'ui-app', tabId => {
    if (restoring || !tabId) return;
    // Recorded after the new page has painted: pushState talks to the browser process and would delay the switch.
    requestAnimationFrame(() => setTimeout(() => {
      try { if ((history.state || {}).flTab !== tabId) history.pushState({flTab: tabId}, ''); } catch (error) { /* sandboxed */ }
    }, 0));
  });
  window.addEventListener('popstate', event => {
    const tab = event.state && event.state.flTab;
    if (!tab) return;
    restoring = true;
    try { switchMainTab(tab); } finally { restoring = false; }
  });

  // ---------- Chart points on touch screens: the first tap shows the point, a second action opens the player ----------
  // With a mouse, hovering shows the tooltip and a click opens the player (unchanged). On touch there is no hover, so a
  // tap used to jump straight to the profile; now it shows the tooltip and a small card with an explicit button.
  let pointer = 'mouse';
  document.addEventListener('pointerdown', event => { pointer = event.pointerType || 'mouse'; }, {capture: true, passive: true});
  let chip = null, chipY = 0, chipChart = null;
  function hideChip() {
    if (chip) { chip.remove(); chip = null; }
    if (chipChart) { try { chipChart.setActiveElements([]); chipChart.tooltip?.setActiveElements([], {x: 0, y: 0}); chipChart.update('none'); } catch (error) { /* chart was replaced */ } chipChart = null; }
  }
  function showChip(x, y, title, open) {
    hideChip();
    chipY = window.scrollY;
    chip = document.createElement('div');
    chip.className = 'fl-point-chip';
    chip.setAttribute('role', 'dialog');
    chip.setAttribute('aria-label', title);
    chip.innerHTML = `<span>${esc(title)}</span><button type="button" class="fl-point-open">查看檔案 ›</button><button type="button" class="fl-point-close" aria-label="關閉">×</button>`;
    document.body.append(chip);
    if (window.flRefract) window.flRefract(chip);
    chip.querySelector('.fl-point-open').addEventListener('click', () => { hideChip(); open(); });
    chip.querySelector('.fl-point-close').addEventListener('click', hideChip);
    const w = chip.offsetWidth, h = chip.offsetHeight;
    const left = Math.max(10, Math.min(window.innerWidth - w - 10, x - w / 2));
    const top = y - h - 18 > 70 ? y - h - 18 : y + 18;
    chip.style.left = `${left}px`;
    chip.style.top = `${Math.min(window.innerHeight - h - 10, top)}px`;
  }
  window.addEventListener('scroll', () => { if (chip && Math.abs(window.scrollY - chipY) > 40) hideChip(); }, {passive: true}); // a real scroll, not the nudge of opening
  window.siteHooks.after('switchMainTab', 'ui-app-chip', hideChip);
  document.addEventListener('pointerdown', event => { if (chip && !chip.contains(event.target) && !(event.target instanceof HTMLCanvasElement)) hideChip(); }, {passive: true});
  if (window.Chart && typeof Chart.register === 'function') {
    Chart.register({
      id: 'flTouchPreview',
      beforeEvent(chart, args) {
        const event = args.event;
        // While a touch preview is open, the browser's follow-up mouse events must not move or clear the pinned tooltip.
        if (chip && chipChart === chart && pointer !== 'mouse' && (event.type === 'mousemove' || event.type === 'mouseout')) return false;
        if (event.type !== 'click' || pointer === 'mouse' || typeof chart.options.onClick !== 'function') return;
        const elements = chart.getElementsAtEventForMode(event, 'nearest', {intersect: true}, false);
        if (!elements.length) { hideChip(); return; }
        const datum = chart.data.datasets[elements[0].datasetIndex]?.data?.[elements[0].index];
        if (!datum || !datum.name) return; // not a player point: the chart's own handler decides
        // Order matters: update first (it recomputes the tooltip), then pin the tooltip to the point and redraw.
        chart.setActiveElements(elements);
        chart.update('none');
        chart.tooltip?.setActiveElements(elements, {x: elements[0].element.x, y: elements[0].element.y});
        chart.draw();
        const rect = chart.canvas.getBoundingClientRect();
        const jersey = typeof NAME_TO_JERSEY !== 'undefined' && NAME_TO_JERSEY[datum.name] != null ? `#${NAME_TO_JERSEY[datum.name]} ` : '';
        showChip(rect.left + elements[0].element.x, rect.top + elements[0].element.y, jersey + datum.name, () => chart.options.onClick(event, elements, chart));
        chipChart = chart;
        return false; // keep the tap from opening the profile directly
      }
    });
  }
  // Spray-chart dots: on touch, a tap fills the chart's detail line the way hovering does with a mouse.
  document.addEventListener('click', event => {
    if (pointer === 'mouse') return;
    const dot = event.target.closest && event.target.closest('svg circle[onmouseenter]');
    if (dot) dot.dispatchEvent(new MouseEvent('mouseenter'));
  });

  // Content panels on scene pages refract the scene (ui-theme.js lenses). Summary cards are re-rendered, so re-register.
  const registerPanels = () => {
    if (!window.flRefract) return;
    window.flReleaseDetached?.();
    document.querySelectorAll('main section:not(.grid), main section.grid > div, #teamSummaryCards > div').forEach(el => {
      if (!el.parentElement.closest('main section:not(.grid)')) window.flRefract(el, true);
    });
  };
  window.siteHooks.after('switchMainTab', 'ui-app-lens', () => requestAnimationFrame(registerPanels));
  window.siteHooks.after('renderAll', 'ui-app-lens', () => requestAnimationFrame(registerPanels));
  registerPanels();

  // The app opens on the home page.
  window.PageRendering?.invalidate(); // all page extensions have registered their render hooks
  switchMainTab('tabHome');
  // Reveal the page now that the shell is arranged (boot.js hid it to avoid a flash of the old layout).
  requestAnimationFrame(() => document.documentElement.classList.remove('fl-booting'));
})();
