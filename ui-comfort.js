/* This layer never writes game data, calls cloud APIs, or replaces business handlers. */
(() => {
  'use strict';
  const navigation = document.getElementById('mainNavigation');
  const workspace = document.getElementById('appWorkspace');
  if (!navigation || !workspace) return;
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
    Overview: ['全隊總覽', '掌握全隊表現、查看日誌與補登成績。'],
    Profile: ['球員檔案', '從個人指標、擊球分布與診斷了解球員。'],
    Leaderboard: ['數據排行榜', '選擇指標與打席門檻，比較隊內表現。'],
    Analytics: ['數據分析', '透過象限、自訂圖表與落點探索球隊數據。'],
    Compare: ['雙人比較', '並列比較完整指標、能力與擊球方向。'],
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
  const shortcuts = { Overview: '總覽', Profile: '球員', Lineup: '排棒', Scorebook: '場記' };
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
    if (restoreFocus) more.focus();
  }
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
      const items = [...navigation.querySelectorAll('button'), more];
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
  updateNavigation();
  enhanceTables();
})();
