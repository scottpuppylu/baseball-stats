/* This layer never writes game data, calls cloud APIs, or replaces business handlers. */
(() => {
  'use strict';
  const navigation = document.getElementById('mainNavigation');
  const workspace = document.getElementById('appWorkspace');
  if (!navigation || !workspace) return;
  const toolbar = document.createElement('div');
  toolbar.className = 'ui-compact-toolbar';
  toolbar.innerHTML = '<button type="button" id="uiDrawerToggle" aria-controls="mainNavigation" aria-expanded="false">☰ 分頁</button><span class="ui-current-page"></span>';
  const headerTools = document.querySelector('#appHeader > div > div:first-child');
  headerTools.firstElementChild.classList.add('ui-header-brand');
  headerTools.prepend(toolbar);
  const drawerToggle = document.getElementById('uiDrawerToggle');
  headerTools.id = 'uiHeaderTools';
  const syncBadge = document.getElementById('syncStatusBadge');
  syncBadge.setAttribute('role', 'button');
  syncBadge.setAttribute('tabindex', '0');
  syncBadge.setAttribute('title', '點擊檢視雲端同步狀態');
  syncBadge.addEventListener('click', () => window.showCloudStatusToast());
  syncBadge.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      window.showCloudStatusToast();
    }
  });
  const drawerClose = document.createElement('button');
  drawerClose.type = 'button';
  drawerClose.className = 'ui-drawer-close';
  drawerClose.textContent = '✕ 收起分頁';
  navigation.prepend(drawerClose);
  const dateControls = document.getElementById('filterStartDate').parentElement;
  dateControls.classList.add('ui-date-controls');
  dateControls.id = 'uiDateControls';
  const dateToggle = document.createElement('button');
  dateToggle.type = 'button';
  dateToggle.className = 'ui-date-toggle';
  dateToggle.id = 'uiDateToggle';
  dateToggle.setAttribute('aria-controls', dateControls.id);
  dateToggle.setAttribute('aria-expanded', 'false');
  dateControls.before(dateToggle);
  document.body.classList.add('ui-date-collapsed');
  function updateDateLabel() {
    const start = document.getElementById('filterStartDate').value;
    const end = document.getElementById('filterEndDate').value;
    const label = start || end ? `${start || '不限起日'} ～ ${end || '不限迄日'}` : '全部日期';
    dateToggle.textContent = `日期篩選 · ${label}　${document.body.classList.contains('ui-date-collapsed') ? '⌄' : '⌃'}`;
  }
  dateToggle.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('ui-date-collapsed');
    dateToggle.setAttribute('aria-expanded', String(!collapsed));
    updateDateLabel();
  });
  dateControls.addEventListener('change', updateDateLabel);
  dateControls.addEventListener('click', () => queueMicrotask(updateDateLabel));
  updateDateLabel();
  const pages = {
    Overview: ['全隊總覽', '全隊成績、比賽日誌與補登成績。'],
    Profile: ['球員檔案', '個人指標、逐場成績、擊球分布與診斷。'],
    Leaderboard: ['排行榜', '選擇指標與打席門檻，比較隊內表現。'],
    Analytics: ['數據分析', '象限圖、自訂圖表、全隊逐場近況與擊球落點。'],
    Compare: ['雙人比較', '兩位球員並列比較指標、逐場近況與擊球方向。'],
    Lineup: ['打線安排', '確認出席與守位，推薦或自訂完整打線。'],
    Scorebook: ['比賽場記', '即時記分、換人換投、賽事覆盤與落點分析。'],
    Pitching: ['投手分析', '查看投球事件、出局結構與隊內投手指標。'],
    Glossary: ['指標說明', '查閱各項數據的定義、公式與判讀方式。']
  };
  const heading = document.createElement('div');
  heading.className = 'ui-page-heading';
  heading.innerHTML = '<div><h1 id="uiPageTitle"></h1><p id="uiPageDescription"></p></div>';
  workspace.prepend(heading);
  const bottom = document.createElement('nav');
  bottom.className = 'ui-mobile-nav';
  bottom.setAttribute('aria-label', '手機常用功能');
  const shortcuts = { Overview: '總覽', Profile: '球員', Lineup: '打線', Scorebook: '場記' };
  for (const [key, label] of Object.entries(shortcuts)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.page = key;
    const icon = document.getElementById(`btnTab${key}`).querySelector('svg').cloneNode(true);
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    const text = document.createElement('span');
    text.textContent = label;
    button.append(text);
    button.addEventListener('click', () => {
      document.getElementById(`btnTab${key}`).click();
    });
    bottom.append(button);
  }
  const more = document.createElement('button');
  more.type = 'button';
  more.id = 'uiMoreNavigation';
  more.setAttribute('aria-controls', navigation.id);
  more.setAttribute('aria-expanded', 'false');
  more.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>更多</span>';
  bottom.append(more);
  const backdrop = document.createElement('div');
  backdrop.className = 'ui-nav-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.append(backdrop, bottom);
  function closeNavigation(restoreFocus = false) {
    document.body.classList.remove('ui-nav-open');
    more.setAttribute('aria-expanded', 'false');
    drawerToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (window.innerWidth < 768 ? more : drawerToggle).focus();
  }
  drawerToggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('ui-nav-open');
    drawerToggle.setAttribute('aria-expanded', String(open));
    if (open) navigation.querySelector('.tab-active')?.focus();
  });
  drawerClose.addEventListener('click', () => closeNavigation(true));
  more.addEventListener('click', () => {
    const open = document.body.classList.toggle('ui-nav-open');
    more.setAttribute('aria-expanded', String(open));
    if (open) navigation.querySelector('.tab-active')?.focus();
  });
  backdrop.addEventListener('click', () => closeNavigation(true));
  navigation.addEventListener('click', event => {
    if (event.target.closest('button')) {
      closeNavigation();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('ui-nav-open')) closeNavigation(true);
    if (event.key === 'Tab' && document.body.classList.contains('ui-nav-open')) {
      const items = [...navigation.querySelectorAll('button'), window.innerWidth < 768 ? more : drawerToggle].filter(button => button.getClientRects().length);
      const index = items.indexOf(document.activeElement);
      const next = (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      event.preventDefault();
      items[next].focus();
    }
  });
  let lastPage;
  function updateNavigation() {
    const active = navigation.querySelector('.tab-active');
    const key = active?.id.replace('btnTab', '') || 'Overview';
    if (lastPage && lastPage !== key) { window.scrollTo({top: 0, behavior: 'instant'}); detail?.remove(); }
    lastPage = key;
    const [title, description] = pages[key] || pages.Overview;
    toolbar.querySelector('.ui-current-page').textContent = title;
    document.getElementById('uiPageTitle').textContent = title;
    document.getElementById('uiPageDescription').textContent = description;
    navigation.querySelectorAll('button').forEach(button => {
      if (button === active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    bottom.querySelectorAll('[data-page]').forEach(button => {
      if (button.dataset.page === key) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (!Object.hasOwn(shortcuts, key)) more.setAttribute('aria-current', 'page');
    else more.removeAttribute('aria-current');
    more.lastElementChild.textContent = Object.hasOwn(shortcuts, key) ? '更多' : title;
  }
  new MutationObserver(updateNavigation).observe(navigation, { subtree: true, attributes: true, attributeFilter: ['class'] });

  const scrollAreas = new Set();
  const summary = document.getElementById('viewSummary');
  const columnToolbar = document.createElement('div');
  columnToolbar.className = 'ui-column-toolbar';
  columnToolbar.innerHTML = '<label for="uiSummaryColumns">顯示指標</label><select id="uiSummaryColumns"><option value="core">重點表現</option><option value="traditional">傳統成績</option><option value="discipline">紀律與擊球</option><option value="advanced">進階指標</option><option value="all">全部欄位</option></select>';
  summary.before(columnToolbar);
  new MutationObserver(() => { columnToolbar.hidden = summary.classList.contains('hidden'); }).observe(summary, { attributes: true, attributeFilter: ['class'] });
  const columnSelect = document.getElementById('uiSummaryColumns');
  const columnGroups = {
    core: [0, 1, 11, 14, 17],
    traditional: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    discipline: [0, 1, 8, 9, 10, 12, 18, 19, 22],
    advanced: [0, 1, 14, 15, 16, 17, 18, 19, 20, 21, 22]
  };
  let customColumns = false;
  columnSelect.value = window.innerWidth < 768 ? 'core' : 'all';
  function applyColumns() {
    summary.dataset.uiColumns = columnSelect.value;
    const visible = columnGroups[columnSelect.value];
    summary.querySelectorAll('tr').forEach(row => {
      [...row.children].forEach((cell, index) => cell.classList.toggle('ui-column-hidden', Boolean(visible && !visible.includes(index))));
    });
  }
  columnSelect.addEventListener('change', () => { customColumns = true; applyColumns(); updateTableHints(); });
  function updateTableHints() {
    scrollAreas.forEach(area => {
      if (!area.isConnected) { scrollAreas.delete(area); return; }
      area.previousElementSibling?.classList.toggle('is-overflowing', area.clientWidth > 0 && area.scrollWidth > area.clientWidth + 2);
    });
  }
  function enhanceTables() {
    applyColumns();
    document.querySelectorAll('table').forEach(table => {
      const area = table.closest('.overflow-x-auto');
      if (!area || area.classList.contains('ui-table-scroll')) return;
      area.classList.add('ui-table-scroll');
      area.tabIndex = 0;
      area.setAttribute('role', 'region');
      area.setAttribute('aria-label', '完整數據表，可左右捲動查看所有欄位');
      const hint = document.createElement('p');
      hint.className = 'ui-table-hint';
      hint.textContent = '左右滑動查看完整欄位';
      area.before(hint);
      scrollAreas.add(area);
    });
    updateTableHints();
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhanceTables(); });
  }).observe(workspace, { childList: true, subtree: true });
  window.addEventListener('resize', () => {
    if (!customColumns) { columnSelect.value = window.innerWidth < 768 ? 'core' : 'all'; applyColumns(); }
    updateTableHints();
    if (window.innerWidth >= 768) closeNavigation();
  });
  // SVG title tooltips are otherwise difficult to discover on touch screens.
  let detail;
  document.addEventListener('click', event => {
    const point = event.target.closest?.('svg circle');
    const title = point?.querySelector('title');
    if (!title || !title.textContent.trim()) return;
    detail?.remove();
    detail = document.createElement('div');
    detail.className = 'ui-touch-detail';
    detail.setAttribute('role', 'status');
    const content = document.createElement('span');
    content.textContent = title.textContent;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '關閉落點詳情');
    close.addEventListener('click', () => detail.remove());
    detail.append(content, close);
    document.body.append(detail);
  });
  navigation.addEventListener('click', () => detail?.remove());
  function watchToastContainer(container) {
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-relevant', 'additions');
    new MutationObserver(() => requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; })).observe(container, {childList: true});
  }
  const existingToasts = document.getElementById('globalToastContainer');
  if (existingToasts) watchToastContainer(existingToasts);
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.id === 'globalToastContainer') watchToastContainer(node);
    }));
  }).observe(document.body, {childList: true});
  // ---------- Phone comfort: section jump bar, back-to-top, sticky name column ----------
  const phone = () => window.innerWidth < 768;
  const sectionBar = document.createElement('nav');
  sectionBar.className = 'ui-section-bar';
  sectionBar.setAttribute('aria-label', '本頁段落');
  heading.after(sectionBar);
  let sectionTargets = [];
  const visible = el => el.getClientRects().length > 0 && !el.closest('.hidden');
  // Short chip names for the long section titles (matched by a distinctive part of the title).
  const SHORT_LABELS = [
    ['逐場成績與近況對決', '逐場對決'], ['逐場成績與近況', '逐場近況'], ['深度能力檔案', '能力檔案'], ['擊球落點噴流', '擊球落點'],
    ['擊球型態與預期', '擊球型態'], ['弱點診斷', '弱點診斷'], ['多維象限', '象限與圖表'], ['運氣回歸', '運氣回歸'],
    ['空間擊球噴流', '全隊落點'], ['雙人選手數據對決', '指標對決'], ['雙雄球場擊球噴流', '落點對照'], ['指定打擊', '賽制 DH'],
    ['出席陣容', '出席名單'], ['最佳棒次推薦', '推薦打線'], ['自訂棒次', '自訂打線'], ['投手進階分析', '投手總覽'],
    ['數據排行總表', '投手排行'], ['實戰作戰與技術方針', '投手方針'], ['出賽率', '出賽率'], ['排行榜', '排行榜'],
    ['專屬特化規程', '慢壘特有'], ['進階賽伯計量高階', '進階指標'], ['傳統打擊三圍', '傳統成績'], ['擊球掌握度、控制紀律', '擊球與紀律'], ['投手賽伯計量進階指標', '投手指標']
  ];
  const shortLabel = text => (SHORT_LABELS.find(([match]) => text.includes(match)) || [])[1];
  const sectionLabel = section => {
    // The overview's results block has tab buttons instead of a heading.
    if (section.querySelector('#tabSummaryBtn')) return '成績與日誌';
    const h = section.matches('h2, h3, h4') ? section : section.querySelector('h2, h3');
    if (!h) return '';
    const short = shortLabel(h.textContent);
    if (short) return short;
    // Drop parenthetical English / notes so a chip stays short: 「Statcast 擊球品質與運氣回歸矩陣 (xBA vs. 實際 AVG)」→ the Chinese part.
    let text = h.textContent.replace(/\s+/g, ' ').replace(/[（(][^）)]*[）)]/g, '').replace(/^[一二三四五六七八九十]+、/, '').trim();
    text = text.replace(/^[A-Za-z0-9 .&:+\-/]+(?=[一-鿿])/, '').trim() || text;
    return text.length > 11 ? `${text.slice(0, 10)}…` : text;
  };
  function buildSections() {
    const panel = workspace.querySelector('[id^="panel"]:not(.hidden)');
    const found = panel ? [...panel.querySelectorAll('section')].filter(s => visible(s) && s.offsetHeight > 120 && !s.parentElement.closest('section')) : [];
    let items = found.map(section => ({section, label: sectionLabel(section)})).filter(item => item.label);
    // A page that is one long section (the glossary) jumps between its own sub-headings instead.
    if (items.length < 2 && found.length === 1) items = [...found[0].querySelectorAll('h3')].filter(visible).map(h => ({section: h, label: sectionLabel(h)})).filter(item => item.label);
    const key = items.map(item => item.label).join('|');
    if (sectionBar.dataset.key === key) return;
    sectionBar.dataset.key = key;
    sectionTargets = items.map(item => item.section);
    sectionBar.hidden = items.length < 2;
    sectionBar.innerHTML = '';
    items.forEach((item, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = item.label;
      chip.dataset.index = index;
      chip.addEventListener('click', () => {
        // Land just below the sticky chip row.
        const top = item.section.getBoundingClientRect().top + window.scrollY - (sectionBar.offsetHeight + 12);
        window.scrollTo({top, behavior: 'smooth'});
      });
      sectionBar.append(chip);
    });
    markSection();
  }
  function markSection() {
    if (sectionBar.hidden || !sectionTargets.length) return;
    let current = 0;
    // At the very bottom the last sections can never reach the top, so pick the last one on screen.
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    const line = atBottom ? window.innerHeight * 0.7 : sectionBar.offsetHeight + 40;
    sectionTargets.forEach((section, index) => { if (section.getBoundingClientRect().top < line) current = index; });
    sectionBar.querySelectorAll('button').forEach(chip => {
      const on = Number(chip.dataset.index) === current;
      if (on && chip.getAttribute('aria-current') !== 'true') {
        chip.setAttribute('aria-current', 'true');
        // Scroll only the chip row; scrollIntoView would also move the page.
        sectionBar.scrollTo({left: chip.offsetLeft - (sectionBar.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth'});
      } else if (!on) chip.removeAttribute('aria-current');
    });
  }
  const backTop = document.createElement('button');
  backTop.type = 'button';
  backTop.className = 'ui-back-top';
  backTop.setAttribute('aria-label', '回到頁面頂端');
  backTop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  backTop.addEventListener('click', () => window.scrollTo({top: 0, behavior: 'smooth'}));
  document.body.append(backTop);
  let scrollQueued = false, lastScrollY = 0;
  window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      // Only while scrolling back up (when someone is looking for the top), so it never sits on content being read.
      const y = window.scrollY;
      const up = y < lastScrollY - 4, down = y > lastScrollY + 4;
      if (up || down) lastScrollY = y;
      if (up) backTop.classList.toggle('is-visible', phone() && y > window.innerHeight * 1.2);
      if (down || y <= window.innerHeight * 1.2) backTop.classList.remove('is-visible');
      markSection();
    });
  }, {passive: true});

  // Wide tables keep the player column in view while scrolling sideways (single-row headers only,
  // so grouped headers never get a mismatched sticky cell). A narrow first column (slot / rank) also
  // keeps the next column, which is then the name.
  function stickyColumns() {
    document.querySelectorAll('.ui-table-scroll table').forEach(table => {
      const area = table.closest('.ui-table-scroll');
      const multiRowHead = table.tHead && table.tHead.rows.length > 1;
      const firstRow = table.rows[0];
      let one = false, two = false, left = 0;
      if (phone() && !multiRowHead && firstRow && firstRow.cells.length > 1 && area.scrollWidth > area.clientWidth + 2) {
        left = firstRow.cells[0].getBoundingClientRect().width;
        two = left > 0 && left < 64 && firstRow.cells.length > 3;
        // Pinning is only worth it while the pinned part leaves room for the data (at most about half).
        const pinned = left + (two ? firstRow.cells[1].getBoundingClientRect().width : 0);
        one = pinned <= area.clientWidth * 0.52;
        two = one && two;
      }
      // Decide first, then write once: class changes re-run this observer.
      if (table.classList.contains('ui-sticky-cols') !== one) table.classList.toggle('ui-sticky-cols', one);
      if (table.classList.contains('ui-sticky-two') !== two) table.classList.toggle('ui-sticky-two', two);
      if (two) table.style.setProperty('--ui-sticky-left', `${Math.round(left)}px`);
    });
  }
  // ---------- Phone density: fold long text, drop decorative labels ----------
  // Section descriptions and glossary explanations fold to a couple of lines; a tap opens them.
  // Elements are marked once (data-ui-density), so re-runs only touch new content.
  const toggleOpen = event => {
    const el = event.currentTarget;
    if (event.target.closest('button, a, select, input, label, summary') && event.target.closest('button, a, select, input, label, summary') !== el) return;
    el.classList.toggle('ui-open');
    el.setAttribute('aria-expanded', String(el.classList.contains('ui-open')));
  };
  const foldable = el => {
    el.classList.add('ui-fold');
    el.setAttribute('aria-expanded', 'false');
    el.addEventListener('click', toggleOpen);
  };
  function densify() {
    const main = workspace.querySelector('main');
    if (!main || !phone()) return;
    // Uppercase English badge pills (「SCOUTING & TACTICAL ADVISORY」…) repeat the Chinese title next to them.
    main.querySelectorAll('span.rounded-full:not([data-ui-density])').forEach(span => {
      span.dataset.uiDensity = '';
      if (/^[A-Z0-9 &:+\-./()·]{4,}$/.test(span.textContent.trim()) && span.closest('section') && span.parentElement.querySelector('h2, h3')) span.classList.add('ui-deco');
    });
    // The grey description under a section title.
    main.querySelectorAll('p.text-xs.text-slate-400:not([data-ui-density])').forEach(p => {
      p.dataset.uiDensity = '';
      const block = p.parentElement;
      if (block && !p.closest('details') && block.querySelector(':scope > div h2, :scope > div h3, :scope > h2, :scope > h3') && p.textContent.trim().length > 26) foldable(p);
    });
    // Long bullet lists (the lineup model notes) fold to a few lines.
    main.querySelectorAll('ul.list-disc:not([data-ui-density])').forEach(ul => {
      ul.dataset.uiDensity = '';
      if (ul.children.length >= 4 && !ul.closest('details')) foldable(ul); // inside <details> it is already folded
    });
    // Glossary cards: title and formula stay, the explanation folds.
    document.querySelectorAll('#panelGlossary .grid > div:not([data-ui-density])').forEach(card => {
      card.dataset.uiDensity = '';
      if (card.querySelectorAll('p').length >= 2) foldable(card);
    });
  }
  // ---------- Phone tables: no sideways scrolling ----------
  // A wide table keeps its name column(s) plus the most useful columns that fit the screen; tapping a row
  // opens the rest underneath as label–value pairs. Tables with one or two rows become a full card instead.
  // Tables with form fields (editing) or merged body cells keep sideways scrolling.
  const KEY_COLUMNS = ['當前排行指標', '出賽率', '出賽／總場數', '近況 OPS', '差距', '狀態', '安打-打數', '單場 OPS', 'OPS', 'wRC+', '打擊率', 'AVG',
    '領先優勢', '安打', '打點', '打數', '累計 OPS', '比分', '打席', '全壘打', '保送', '三振', 'sFIP', '局數 (IP)'];
  const keyRank = label => {
    // A column headed by a player (「#30 洪銘駿」, the two sides of a comparison) is what the table is about.
    if (/^#\d+\s/.test(label)) return -1;
    const exact = KEY_COLUMNS.indexOf(label);
    if (exact !== -1) return exact;
    const partial = KEY_COLUMNS.findIndex(key => label.includes(key));
    return partial === -1 ? 100 : partial + 50;
  };
  const headerLabels = table => {
    const row = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    return row ? [...row.cells].map(cell => cell.textContent.replace(/\s+/g, ' ').trim()) : [];
  };
  const bodyRows = table => [...(table.tBodies[0]?.rows || [])].filter(row => !row.classList.contains('ui-row-detail'));
  function foldTables() {
    document.querySelectorAll('.ui-table-scroll table').forEach(table => {
      const area = table.closest('.ui-table-scroll');
      const rows = bodyRows(table);
      const labels = headerLabels(table);
      const signature = `${phone()}|${area.clientWidth}|${rows.length}|${rows[0]?.textContent.length || 0}|${labels.join('|')}`;
      // Same table and still laid out: a re-render that rebuilt the rows (same size, new cells) must be redone.
      const intact = (!table.classList.contains('ui-fold-table') || rows.every(row => row.querySelector('.ui-col-folded'))) &&
        (!table.classList.contains('ui-card-table') || rows.every(row => row.cells.length === 1 || row.cells[0].dataset.label !== undefined));
      if (table.dataset.uiFoldSig === signature && intact) return;
      table.dataset.uiFoldSig = signature;
      table.querySelectorAll('.ui-col-folded').forEach(cell => cell.classList.remove('ui-col-folded'));
      table.querySelectorAll('.ui-row-detail').forEach(row => row.remove());
      table.classList.remove('ui-fold-table', 'ui-card-table', 'ui-wrap-table');
      // The overview summary has its own column picker (重點表現／全部欄位…), which already fits a phone.
      const usable = phone() && !table.closest('#viewSummary') && labels.length >= 3 && table.tHead.rows.length === 1 && rows.length > 0 &&
        !table.querySelector('input, select, textarea') && rows.every(row => row.cells.length === labels.length) && area.scrollWidth > area.clientWidth + 4;
      const hint = area.previousElementSibling?.classList.contains('ui-table-hint') ? area.previousElementSibling : null;
      if (hint) hint.textContent = '左右滑動查看完整欄位';
      // An empty table (a single message row) needs no wide header on a phone.
      if (phone() && rows.length && rows.every(row => row.cells.length === 1 && row.cells[0].colSpan > 1)) { table.classList.add('ui-card-table'); return; }
      if (!usable) return;
      // Small tables first try to fit by letting text wrap; nothing is folded if that works.
      if (labels.length <= 5) {
        table.classList.add('ui-wrap-table');
        if (area.scrollWidth <= area.clientWidth + 2) return;
        table.classList.remove('ui-wrap-table');
      }
      if (rows.length <= 2) {
        // One or two rows (a single pitcher, a summary): every value as a labelled card.
        table.classList.add('ui-card-table');
        rows.forEach(row => [...row.cells].forEach((cell, i) => { cell.dataset.label = labels[i]; }));
        return;
      }
      table.classList.add('ui-measure'); // natural column widths, without the table's desktop min-width
      // Column width = its data, but never so narrow that a short header (「全壘打」) breaks into one character per line.
      const headerRoom = label => Math.min(64, label.length * 12 + 16);
      const widths = labels.map((label, i) => Math.max(headerRoom(label), ...rows.map(row => row.cells[i].getBoundingClientRect().width)));
      table.classList.remove('ui-measure');
      // A slot / rank first column always brings the name next to it; the name column wraps at about 120px.
      const slotFirst = widths[0] < 72 || /^(棒次|名次|#|排名)$/.test(labels[0]);
      const identity = slotFirst && labels.length > 3 ? [0, 1] : [0];
      const NAME_MAX = 150;
      // Only a real name column wraps (a player with avatar, or the metric names of a comparison); dates do not.
      const last = identity[identity.length - 1];
      const nameCol = /^(選手|球員|隊員|打者|評比指標)$/.test(labels[last]) || rows.some(row => row.cells[last].querySelector('img, .rounded-full'));
      let used = identity.reduce((sum, i) => sum + (i === last && nameCol ? Math.min(widths[i], NAME_MAX) : widths[i]), 0);
      const keep = new Set(identity);
      // A single game's box score reads as at-bats, hits and RBI rather than rates.
      const boxScore = labels.includes('打席歷程') && labels.includes('打數');
      const BOX = ['打數', '安打', '打點', '得分', '三振', '保送'];
      labels.map((label, i) => ({i, rank: boxScore && BOX.includes(label) ? -0.5 + BOX.indexOf(label) / 10 : keyRank(label)})).filter(c => !keep.has(c.i)).sort((a, b) => a.rank - b.rank || a.i - b.i)
        .forEach(c => { if (used + widths[c.i] <= area.clientWidth - 18) { keep.add(c.i); used += widths[c.i]; } });
      if (keep.size === labels.length) { table.classList.add('ui-wrap-table'); return; } // everything fits once the desktop min-width goes
      table.classList.add('ui-fold-table');
      table.style.setProperty('--ui-name-max', `${NAME_MAX}px`);
      if (nameCol) table.dataset.uiNameCol = String(last + 1); else delete table.dataset.uiNameCol;
      [table.tHead.rows[0], ...rows].forEach(row => [...row.cells].forEach((cell, i) => cell.classList.toggle('ui-col-folded', !keep.has(i))));
      if (hint) hint.textContent = `點一列查看其他 ${labels.length - keep.size} 項數據`;
    });
  }
  // Tapping a folded row shows its hidden columns right below it.
  workspace.addEventListener('click', event => {
    const row = event.target.closest('table.ui-fold-table tbody tr:not(.ui-row-detail)');
    if (!row || event.target.closest('button, a, select, input')) return;
    const next = row.nextElementSibling;
    if (next && next.classList.contains('ui-row-detail')) { next.remove(); row.classList.remove('ui-row-open'); return; }
    const table = row.closest('table');
    const labels = headerLabels(table);
    const detail = document.createElement('tr');
    detail.className = 'ui-row-detail';
    const cell = document.createElement('td');
    cell.colSpan = labels.length;
    const grid = document.createElement('div');
    grid.className = 'ui-detail-grid';
    [...row.cells].forEach((source, i) => {
      if (!source.classList.contains('ui-col-folded')) return;
      const item = document.createElement('div');
      if (source.textContent.trim().length > 18) item.className = 'ui-detail-wide';
      const label = document.createElement('span');
      label.textContent = labels[i];
      const value = document.createElement('b');
      value.innerHTML = source.innerHTML; // the site's own cell markup (colours, badges)
      item.append(label, value);
      grid.append(item);
    });
    cell.append(grid);
    detail.append(cell);
    row.after(detail);
    row.classList.add('ui-row-open');
  });

  // On phones the sync text gives way to the status dot (which opens the same message); the dot takes its colour,
  // so a failed upload still shows red at a glance.
  const statusDot = document.querySelector('.ui-header-brand button[onclick="showCloudStatusToast()"] span');
  const paintDot = () => { if (statusDot) statusDot.style.background = getComputedStyle(syncBadge).color; };
  new MutationObserver(paintDot).observe(syncBadge, {attributes: true, attributeFilter: ['class']});
  paintDot();
  // On phones the date toggle joins the tool row instead of taking a header row of its own.
  const toolRow = document.querySelector('#uiHeaderTools > div:last-child');
  const dateHome = dateToggle.parentElement, dateNext = dateToggle.nextSibling;
  function placeDateToggle() {
    if (phone() && toolRow && dateToggle.parentElement !== toolRow) toolRow.append(dateToggle);
    else if (!phone() && dateToggle.parentElement !== dateHome) dateHome.insertBefore(dateToggle, dateNext);
  }

  let comfortQueued = false;
  const queueComfort = () => {
    if (comfortQueued) return;
    comfortQueued = true;
    requestAnimationFrame(() => { comfortQueued = false; densify(); buildSections(); foldTables(); stickyColumns(); });
  };
  window.addEventListener('resize', placeDateToggle);
  placeDateToggle();
  new MutationObserver(queueComfort).observe(workspace, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
  window.addEventListener('resize', queueComfort);

  updateNavigation();
  enhanceTables();
  queueComfort();
})();
