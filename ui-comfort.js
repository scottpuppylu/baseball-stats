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
  let comfortQueued = false;
  const queueComfort = () => {
    if (comfortQueued) return;
    comfortQueued = true;
    requestAnimationFrame(() => { comfortQueued = false; buildSections(); stickyColumns(); });
  };
  new MutationObserver(queueComfort).observe(workspace, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
  window.addEventListener('resize', queueComfort);

  updateNavigation();
  enhanceTables();
  queueComfort();
})();
