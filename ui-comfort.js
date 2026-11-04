/* This layer never writes game data, calls cloud APIs, or replaces business handlers. */
(() => {
  'use strict';
  const navigation = document.getElementById('mainNavigation');
  const workspace = document.getElementById('appWorkspace');
  const currentPanel = () => workspace.querySelector('[id^="panel"]:not(.hidden)') || workspace;
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
    Home: ['主頁', '球隊近況與常用功能。'],
    Changelog: ['版本紀錄', '每個版本更新了什麼。'],
    Overview: ['全隊總覽', '全隊成績、比賽日誌與補登成績。'],
    Profile: ['球員檔案', '個人指標、逐場成績、擊球分布與診斷。'],
    Leaderboard: ['排行榜', '選擇指標與打席門檻，比較隊內表現。'],
    Analytics: ['數據分析', '象限圖、自訂圖表、全隊逐場近況與擊球落點。'],
    Compare: ['雙人比較', '兩位球員並列比較指標、逐場近況與擊球方向。'],
    Lineup: ['打線安排', '確認出席與守位，推薦或自訂完整打線。'],
    Scorebook: ['比賽場記', '即時記分、換人換投、賽事覆盤與落點分析。'],
    Games: ['賽事分析', '一場比賽發生的所有事：關鍵時刻、比分走勢、逐局經過、打者與投手表現。'],
    Pitching: ['投手分析', '查看投球事件、出局結構與隊內投手指標。'],
    Records: ['生涯紀錄', '生涯排行、單場與連續紀錄、里程碑與趣味紀錄。'],
    Glossary: ['指標說明', '查閱各項數據的定義、公式與判讀方式。'],
    Health: ['球員健康資料', '記錄基本資料與左右打，依打擊側校正拉打／推打判定。']
  };
  const heading = document.createElement('div');
  heading.className = 'ui-page-heading';
  heading.innerHTML = '<div><h1 id="uiPageTitle"></h1><p id="uiPageDescription"></p></div>';
  workspace.prepend(heading);
  const bottom = document.createElement('nav');
  bottom.className = 'ui-mobile-nav';
  bottom.setAttribute('aria-label', '手機常用功能');
  // ---------- Site map ----------
  // Five places on the phone tab bar; each group's pages switch with a segmented control under the page title.
  // 參考 (glossary, version history) lives in 「更多」, which also lists every page. Buttons keep their own handlers.
  const NAV_GROUPS = [
    ['', ['Home']],
    ['球隊數據', ['Overview', 'Analytics', 'Pitching', 'Records']],
    ['球員', ['Profile', 'Leaderboard', 'Compare', 'Health']],
    ['比賽', ['Lineup', 'Scorebook', 'Games']],
    ['參考', ['Glossary', 'Changelog']]
  ];
  const SUB_LABELS = {Overview: '總覽', Analytics: '分析', Pitching: '投手', Records: '紀錄', Profile: '檔案', Leaderboard: '排行', Compare: '比較',
    Health: '健康', Lineup: '打線', Scorebook: '場記', Games: '賽事分析', Glossary: '指標說明', Changelog: '版本紀錄'};
  const groupOf = key => NAV_GROUPS.find(([, keys]) => keys.includes(key)) || NAV_GROUPS[0];
  const ICON = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const TABS = [
    {group: '', label: '主頁', tone: 'home', icon: ICON('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>')},
    {group: '球隊數據', label: '數據', tone: 'data', icon: ICON('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')},
    {group: '球員', label: '球員', tone: 'player', icon: ICON('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>')},
    {group: '比賽', label: '比賽', tone: 'game', icon: ICON('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>')}
  ];
  // Each group reopens where it was last left, like an app's tabs.
  const lastInGroup = {};
  // A finger tap paints its new selected state first and switches the page on the next frame, so the press is answered
  // at once (mouse and programmatic navigation stay synchronous).
  let lastPointer = 'mouse';
  document.addEventListener('pointerdown', event => { lastPointer = event.pointerType; }, {capture: true, passive: true});
  const afterPaint = fn => requestAnimationFrame(() => setTimeout(fn, 0));
  const soon = fn => (lastPointer === 'touch' || lastPointer === 'pen' ? afterPaint(fn) : fn());
  // Only these class changes matter to the layout passes; press feedback and lens bookkeeping do not.
  const TRANSIENT = new Set(['ui-pressed', 'fl-lens-on', 'ui-open', 'is-visible', 'is-docked']); // ui-tab-hidden is not: a shown section needs its tables measured
  const meaningful = records => records.some(r => {
    if (r.type !== 'attributes' || r.attributeName !== 'class') return true;
    const before = new Set((r.oldValue || '').split(/\s+/).filter(Boolean)), after = new Set(String(r.target.className?.baseVal ?? r.target.className ?? '').split(/\s+/).filter(Boolean));
    for (const c of before) if (!after.has(c) && !TRANSIENT.has(c)) return true;
    for (const c of after) if (!before.has(c) && !TRANSIENT.has(c)) return true;
    return false;
  });
  const openPage = key => { const button = document.getElementById(`btnTab${key}`); if (button) button.click(); };
  for (const tab of TABS) {
    const keys = NAV_GROUPS.find(([label]) => label === tab.group)[1];
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.group = tab.group || 'Home';
    button.dataset.page = keys[0];
    button.dataset.tone = tab.tone;
    button.innerHTML = `${tab.icon}<span>${tab.label}</span>`;
    button.addEventListener('click', () => {
      const target = lastInGroup[tab.group] || keys[0];
      if (document.body.dataset.page === target) return;
      bottom.querySelectorAll('[data-group], #uiMoreNavigation').forEach(b => { if (b === button) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      placeTabThumb();
      soon(() => openPage(target));
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
    const key = active?.id.replace('btnTab', '') || 'Home';
    if (lastPage && lastPage !== key) { if (window.scrollY > 0) window.scrollTo({top: 0, behavior: 'instant'}); detail?.remove(); }
    lastPage = key;
    const [title, description] = pages[key] || pages.Home;
    const [groupLabel, groupKeys] = groupOf(key);
    lastInGroup[groupLabel] = key;
    document.body.dataset.page = key;
    renderSubnav(groupLabel, groupKeys, key);
    toolbar.querySelector('.ui-current-page').textContent = title;
    document.getElementById('uiPageTitle').textContent = title;
    document.getElementById('uiPageDescription').textContent = description;
    navigation.querySelectorAll('button').forEach(button => {
      if (button === active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    bottom.querySelectorAll('[data-group]').forEach(button => {
      if (button.dataset.group === (groupLabel || 'Home')) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (groupLabel === '參考') more.setAttribute('aria-current', 'page');
    else more.removeAttribute('aria-current');
    bottom.dispatchEvent(new Event('fl-tab-change'));
  }
  // Segmented control for the pages of the current group (hidden on Home and for one-page groups).
  const subnav = document.createElement('nav');
  subnav.className = 'fl-subnav';
  subnav.setAttribute('aria-label', '本區頁面');
  heading.after(subnav);
  function renderSubnav(groupLabel, keys, current) {
    const shown = keys.filter(k => document.getElementById(`btnTab${k}`));
    subnav.hidden = !groupLabel || shown.length < 2;
    const signature = `${groupLabel}|${shown.join(',')}`;
    if (subnav.dataset.signature !== signature) {
      subnav.dataset.signature = signature;
      subnav.innerHTML = '<span class="fl-subnav-thumb" aria-hidden="true"></span>' + shown.map(k => `<button type="button" data-sub="${k}">${SUB_LABELS[k] || pages[k][0]}</button>`).join('');
    }
    subnav.querySelectorAll('[data-sub]').forEach(b => {
      if (b.dataset.sub === current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    requestAnimationFrame(() => moveThumb(subnav, subnav.querySelector('[aria-current="page"]')));
  }
  subnav.addEventListener('click', event => {
    const b = event.target.closest('[data-sub]');
    if (!b || b.getAttribute('aria-current') === 'page') return;
    subnav.querySelectorAll('[data-sub]').forEach(x => { if (x === b) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
    moveThumb(subnav, b);
    soon(() => openPage(b.dataset.sub));
  });
  // A glass "thumb" glides to the selected item (the segmented control and the tab bar share it).
  const thumbAt = new WeakMap(); // container -> the item its thumb already sits on (re-measured only when that changes or on resize)
  function moveThumb(container, target, force = false) {
    const thumb = container.querySelector(':scope > .fl-subnav-thumb, :scope > .fl-tab-thumb');
    if (!thumb) return;
    if (!force && target && thumbAt.get(container) === target && target.isConnected) return;
    thumbAt.set(container, target);
    if (!target || !target.offsetWidth) { thumb.style.opacity = '0'; thumbAt.delete(container); return; }
    thumb.style.opacity = '1';
    thumb.style.width = `${target.offsetWidth}px`;
    thumb.style.height = `${target.offsetHeight}px`;
    thumb.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
  }
  const tabThumb = document.createElement('span');
  tabThumb.className = 'fl-tab-thumb';
  tabThumb.setAttribute('aria-hidden', 'true');
  bottom.prepend(tabThumb);
  const placeTabThumb = () => moveThumb(bottom, bottom.querySelector('button[aria-current="page"]'));
  bottom.addEventListener('fl-tab-change', () => requestAnimationFrame(placeTabThumb));
  const refitThumbs = () => { moveThumb(bottom, bottom.querySelector('button[aria-current="page"]'), true); moveThumb(subnav, subnav.querySelector('[aria-current="page"]'), true); };
  window.addEventListener('resize', refitThumbs);
  document.fonts?.ready.then(refitThumbs); // web fonts change the item widths
  window.uiNavigation = {groups: NAV_GROUPS, labels: SUB_LABELS, openPage};
  new MutationObserver(records => { if (meaningful(records)) updateNavigation(); }).observe(navigation, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  // Drawer and sidebar page buttons: a finger tap marks the page, paints, then switches.
  document.addEventListener('click', event => {
    const b = event.target.closest?.('#mainNavigation [id^="btnTab"]');
    if (!b || !event.isTrusted || (lastPointer !== 'touch' && lastPointer !== 'pen') || b.classList.contains('tab-active')) return;
    event.stopPropagation();
    navigation.querySelectorAll('[id^="btnTab"]').forEach(x => { if (x === b) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
    afterPaint(() => b.click());
  }, true);

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
  function updateTableHints() { readTableHints()(); }
  function readTableHints() {
    const panel = currentPanel(), marks = [];
    scrollAreas.forEach(area => {
      if (!area.isConnected) { scrollAreas.delete(area); return; }
      if (!panel.contains(area)) return; // hidden pages are measured when shown
      marks.push([area.previousElementSibling, area.clientWidth > 0 && area.scrollWidth > area.clientWidth + 2]);
    });
    return () => marks.forEach(([hint, on]) => hint?.classList.toggle('is-overflowing', on)); // all reads first, then the writes: one layout
  }
  // measure = false: only the DOM work (before the first paint of a page, when a layout read would hold that paint back).
  function enhanceTables(measure = true) {
    applyColumns();
    currentPanel().querySelectorAll('table').forEach(table => {
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
    if (measure) updateTableHints();
  }
  // Containers the stylesheet styles by what they hold get a class instead of a CSS :has() rule: a broad :has()
  // made every style recalculation of the page two to four times slower on phones.
  const EYEBROW = 'span.rounded-full.font-mono.font-bold.text-xs[class*="px-2.5"][class*="-500/"]';
  // An action group is one row of equal tiles when its longest label fits a tile on one line; otherwise two columns (a
  // lone last tile spans both). Decided from the label lengths and the screen width, no layout read.
  function fitActions(group) {
    const buttons = [...group.children].filter(el => el.tagName === 'BUTTON' && !el.matches('[onclick^="undoGameFromTeamLogs"], [onclick="syncReviewGameToTeamLogs()"]'));
    if (!buttons.length) return;
    const longest = Math.max(...buttons.map(b => [...b.textContent.replace(/\s+/g, '')].length));
    const avail = Math.min(window.innerWidth, 1240) - (window.innerWidth >= 1280 ? 340 : 48);
    const per = (avail - (buttons.length - 1) * 8) / buttons.length - 22;
    const cols = group.classList.contains('ui-review-bar') && buttons.length > 3 && window.innerWidth < 768 ? 2 : longest * 13.5 <= per ? buttons.length : 2;
    if (group.dataset.cols !== String(cols)) group.dataset.cols = String(cols);
  }
  window.addEventListener('resize', () => workspace.querySelectorAll('.fl-actions, .fl-action-grid, .ui-review-bar').forEach(fitActions));
  const CHIP = 'main .justify-between > div > button.text-xs.py-1';
  const within = (root, selector) => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  const ACTION_GROUPS = '.fl-actions, .fl-action-grid, .ui-review-bar';
  // 球員檔案 cards whose number line (span.text-slate-200) sits in a div beside a badge (ui-theme.css stacks them).
  const PROFILE_STACK = '#panelProfile div.justify-between > div > span.text-slate-200';
  // A holder class goes when what it marks is removed, so it always means what the old :has() rule meant.
  const HOLDERS = [['ui-note-holder', ':scope > .ui-note'], ['ui-seg-holder', ':scope > .ui-seg'], ['ui-profile-stack', ':scope > div > span.text-slate-200']];
  const recheckHolder = el => HOLDERS.forEach(([cls, inside]) => { if (el.classList.contains(cls) && !el.querySelector(inside)) el.classList.remove(cls); });
  const fitAllActions = () => workspace.querySelectorAll(ACTION_GROUPS).forEach(fitActions);
  const NOTE_HOST = 'main :is(span, div, b, button, label, h3, h4)';
  function markNote(el) {
    const hasNote = el.querySelector(':scope > .ui-note');
    if (hasNote) el.classList.add('ui-note-holder');
    if (hasNote || el.classList.contains('ui-note') || el.closest('td, th, select, option, .fl-actions, .fl-action-grid, .ui-review-bar')) return;
    const nodes = [...el.childNodes];
    const last = nodes.filter(n => n.nodeType !== 3 || n.nodeValue.trim()).pop();
    // The note may already be its own element (「無 DH 制 <span>(10 棒・全打全守)</span>」): mark it as the note.
    if (last && last.nodeType === 1 && nodes.length > 1 && /^[（(][^()（）]{1,26}[)）]$/.test(last.textContent.trim()) && !last.children.length) { last.classList.add('ui-note'); el.classList.add('ui-note-holder'); return; }
    if (!last || last.nodeType !== 3 || el.textContent.trim().length > 40) return;
    // 「<b>廖仲毅</b> (全方位廣角型)」: the note follows an element.
    const alone = last.nodeValue.match(/^\s*([（(][^()（）]{1,26}[)）])\s*$/);
    if (alone && last.previousSibling) {
      const note = document.createElement('span');
      note.className = 'ui-note';
      note.textContent = last.nodeValue;
      last.replaceWith(note);
      el.classList.add('ui-note-holder');
      return;
    }
    const m = last.nodeValue.match(/^([\s\S]*?\S)\s*([（(][^()（）]{1,26}[)）])\s*$/);
    if (!m || !/[\u4e00-\u9fff0-9%]/.test(m[1]) || /^[\s(（]*[A-Za-z]/.test(m[2].slice(1))) return; // English glosses: .ui-en
    const note = document.createElement('span');
    note.className = 'ui-note';
    note.textContent = m[2];
    last.nodeValue = last.nodeValue.slice(0, last.nodeValue.length - last.nodeValue.trimEnd().length) ? m[1] : m[1];
    last.after(note);
    el.classList.add('ui-note-holder');
  }
  function markHolders(root = workspace, fit = true) { // only the new content: this runs on every change while the page renders
    within(root, EYEBROW).forEach(span => span.parentElement?.classList.add('ui-has-eyebrow'));
    within(root, CHIP).forEach(b => b.parentElement.parentElement.classList.add('ui-has-chips'));
    document.getElementById('compareSpraySvgA')?.closest('.grid > div')?.parentElement.classList.add('ui-has-spray-pair');
    within(root, PROFILE_STACK).forEach(span => span.parentElement.parentElement.classList.add('ui-profile-stack'));
    // Grid cells holding a headline number size it to their own width (container query in ui-theme.css), so a big number
    // never overflows a narrow column.
    within(root, 'main section span.font-mono.font-black.block').forEach(num => {
      const cell = num.parentElement;
      if (cell && cell.parentElement && cell.parentElement.classList.contains('grid')) cell.classList.add('ui-num-cell');
    });
    // 場記覆盤與編輯: its row of status and actions is laid out as one tidy bar (ui-theme.css).
    within(root, 'button[onclick="deleteReviewGame()"]').forEach(b => b.parentElement?.classList.add('ui-review-bar'));
    // Groups of action buttons become one row of equal action tiles (ui-theme.css), never a ragged wrap.
    within(root, '[data-ga="replay"], [data-ga="download-image"], [data-ga="share-video"]').forEach(b => b.parentElement?.classList.add('fl-action-grid'));
    if (fit) fitAllActions();
    // A note in parentheses at the end of a short label or button (「本隊安打率 14%（不含全壘打）」, 「無 DH 制 (10 棒・全打全守)」,
    // 「廖仲毅 (全方位廣角型)」) becomes a second, smaller line of its own, instead of the whole label breaking
    // wherever the width runs out. The text itself is unchanged.
    within(root, NOTE_HOST).forEach(markNote);
    // A short caption made of phrases (「推薦打線 10.84 分・約 3.7 局」, 「依打擊側判定拉／推；球場落點保持原方向」, 「加權創造
    // wRC+」) keeps each phrase whole: when it does not fit on one line it breaks only between phrases, never inside one.
    // Re-checked each time the text is replaced (some captions are rewritten in place).
    // Marks each break with , then splits there: Safari before 16.4 cannot parse a lookbehind, and one would stop
    // this whole file from running.
    const phraseParts = text => text.replace(/[・；，：、|｜]/g, '$&\uE000').replace(/([\u4e00-\u9fff]) (?=[A-Za-z])/g, '$1\uE000').split('\uE000').filter(Boolean);
    within(root, 'main :is(span, p, div, .ui-note)').forEach(el => {
      if (el.children.length || el.closest('td, th, button, select, option, .ui-seg') || el.matches('.font-bold, .font-semibold, .font-black')) return;
      const text = el.textContent.trim();
      if (text.length < 8 || text.length > 28 || /[（(。]/.test(text)) return; // glosses are handled above; sentences flow as prose
      // after a separator, or at the space between Chinese and a metric's code
      const parts = phraseParts(text);
      if (parts.length < 2) return;
      el.textContent = '';
      el.classList.add('ui-seg-holder');
      parts.forEach((part, i) => {
        const seg = document.createElement('span');
        seg.className = 'ui-seg';
        seg.textContent = part;
        if (i && /[\u4e00-\u9fff]$/.test(parts[i - 1]) && /^[A-Za-z]/.test(part)) el.append(' ');
        el.append(seg);
      });
    });
    // 「打線賽制：」 and the like: a label that introduces a row of buttons sits above them on phones.
    within(root, 'main :is(span, label)').forEach(el => {
      const text = el.textContent.trim();
      if (text.length > 14 || !/[：:]$/.test(text) || el.parentElement?.children.length < 2) return;
      el.parentElement.classList.add('ui-label-row');
    });
    // 生涯紀錄: record card grids (an odd last card spans the row on phones, see ui-theme.css).
    within(root, '[data-record-card]').forEach(card => card.parentElement?.classList.add('ui-record-grid'));
    // An English gloss in parentheses after a Chinese title (「攻擊指數 (Production)」) is set apart, so phones can drop it
    // instead of breaking the title over two lines.
    within(root, 'main section :is(h2, h3, h4, span.font-semibold, span.font-bold, span.font-black)').forEach(el => {
      if (el.dataset.uiGloss || el.textContent.length > 48) return;
      el.dataset.uiGloss = '';
      for (const node of el.childNodes) {
        if (node.nodeType !== 3) continue;
        const m = node.nodeValue.match(/^([\s\S]*?[\u4e00-\u9fff][\s\S]*?)(\s*[（(][A-Za-z][A-Za-z0-9 .&:+\-\/,'×%]*[)）])(\s*)$/);
        if (!m) continue;
        const gloss = document.createElement('span');
        gloss.className = 'ui-en';
        gloss.textContent = m[2];
        node.nodeValue = m[1];
        node.after(gloss);
        if (m[3]) gloss.after(document.createTextNode(m[3]));
        // The gloss is now a parenthesised last child, which the note step treats as the title's note (second line).
        // The old full rescan reached it on the next change; content is marked once now, so do it here.
        if (el.matches(NOTE_HOST)) markNote(el);
        break;
      }
    });
    // A chart that is not already inside a data card gets one (ui-theme.css: content groups sit on a material).
    within(root, 'main section canvas').forEach(canvas => {
      const box = canvas.parentElement;
      if (box && box.tagName === 'DIV' && !box.closest('[class*="slate-9"], [class*="slate-8"], [class*="gray-9"]')) box.classList.add('ui-chart-card'); // dark-filled boxes are cards already
    });
  }
  let scheduled = false;
  new MutationObserver(records => {
    // At once (writes only): the layout must be right the moment new content lands.
    // One pass per batch: each new subtree once (a node inside another new node is covered by it), instead of a sweep
    // of the whole page for every added node.
    const roots = new Set();
    records.forEach(r => {
      if (r.removedNodes.length) { recheckHolder(r.target); if (r.target.parentElement) recheckHolder(r.target.parentElement); }
      r.addedNodes.forEach(node => { const el = node.nodeType === 1 ? node : node.parentElement; if (el) roots.add(el); });
    });
    const marked = [];
    roots.forEach(el => {
      for (let up = el.parentElement; up; up = up.parentElement) if (roots.has(up)) return;
      if (!workspace.contains(el)) return;
      markHolders(el, false);
      marked.push(el);
    });
    // A group's columns depend only on its own buttons and the screen width (resize refits them all), so only the
    // groups inside the new content, or holding it, are fitted.
    const groups = new Set();
    marked.forEach(el => {
      within(el, ACTION_GROUPS).forEach(g => groups.add(g));
      const holder = el.closest(ACTION_GROUPS);
      if (holder) groups.add(holder);
    });
    groups.forEach(fitActions);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhanceTables(false); }); // measured after the paint (queueComfort)
  }).observe(workspace, { childList: true, subtree: true });
  markHolders();
  // Hidden pages are handled when they are shown (their tables have no size until then).
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
  const phoneQuery = window.matchMedia('(max-width: 767.98px)');
  const phone = () => phoneQuery.matches; // a media query: unlike innerWidth, it never forces a layout
  const sectionBar = document.createElement('nav');
  sectionBar.className = 'ui-section-bar';
  sectionBar.setAttribute('aria-label', '本頁段落');
  subnav.after(sectionBar); // page switcher first, then this page's section chips
  let sectionTargets = [];
  let sectionJump = 0; // the latest chip jump; touching or scrolling by hand cancels its final correction
  ['touchstart', 'wheel'].forEach(type => window.addEventListener(type, () => { sectionJump++; }, {passive: true}));
  const visible = el => el.getClientRects().length > 0 && !el.closest('.hidden');
  // Short chip names for the long section titles (matched by a distinctive part of the title).
  const SHORT_LABELS = [
    ['基礎數據與打擊三圍', '基礎與三圍'], ['綜合產值（進階', '綜合產值'], ['紀律、擊球品質與方向', '紀律與擊球'], ['慢壘規則與本站模型', '規則與模型'], ['投手指標（慢速壘球', '投手指標'],
    ['生涯紀錄與趣味', '生涯紀錄'], ['生涯排行榜', '生涯排行'], ['單場紀錄', '單場紀錄'], ['連續紀錄', '連續紀錄'], ['趣味紀錄與里程碑', '趣味紀錄'],
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
  // ---------- Phones and tablets: a long page shows one section at a time ----------
  // The chip row becomes the page's tabs (tap one, or swipe the page sideways); the other sections wait, hidden, with
  // everything in them. The desktop keeps the long page with jump chips. Each page reopens on the section left last.
  // 比賽場記 stays one page (the scorer must see everything). Code that scrolls to something inside a waiting section
  // (search, links) brings that section forward first. Off in the isolated test preview unless ?tabs.
  const tabQuery = window.matchMedia('(max-width: 1279.98px)');
  const appConfig = window.BASEBALL_APP_CONFIG || {};
  let tabMode = false, activeTab = 0;
  const tabMemory = {}; // page -> label of the section last shown
  const pageKey = () => document.body.dataset.page || '';
  function tabsWanted() {
    return appConfig.sectionTabs !== false && tabQuery.matches && pageKey() !== 'Scorebook'
      && sectionTargets.length >= 2 && sectionTargets.every(t => t.tagName === 'SECTION');
  }
  function showTab(index, how = '') {
    const chips = [...sectionBar.querySelectorAll('button')];
    const dir = index > activeTab ? 1 : -1;
    activeTab = Math.max(0, Math.min(sectionTargets.length - 1, index));
    tabMemory[pageKey()] = chips[activeTab]?.textContent;
    sectionTargets.forEach((section, i) => {
      const hide = i !== activeTab;
      if (section.classList.contains('ui-tab-hidden') !== hide) section.classList.toggle('ui-tab-hidden', hide);
    });
    chips.forEach((chip, i) => {
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(i === activeTab));
      if (i === activeTab) chip.setAttribute('aria-current', 'true'); else chip.removeAttribute('aria-current');
    });
    const chip = chips[activeTab];
    if (chip) sectionBar.scrollTo({left: chip.offsetLeft - (sectionBar.clientWidth - chip.offsetWidth) / 2, behavior: how ? 'smooth' : 'auto'});
    if (!how) return;
    // Back to where the section starts (just under the docked bars), and the new section slides in from its side.
    const target = sectionTargets[activeTab];
    const top = target.getBoundingClientRect().top + window.scrollY - (stickyBottom() + 12);
    if (window.scrollY > top) window.scrollTo({top, behavior: 'instant'});
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && how === 'swipe') {
      target.animate([{opacity: 0, transform: `translate3d(${dir * 60}px, 0, 0)`}, {opacity: 1, transform: 'none'}], {duration: 420, easing: 'cubic-bezier(.16, 1, .3, 1)'});
    }
  }
  function applyTabs() {
    const want = tabsWanted();
    if (!want) {
      if (tabMode) {
        sectionTargets.forEach(section => section.classList.remove('ui-tab-hidden'));
        workspace.querySelectorAll('.ui-tab-hidden').forEach(el => el.classList.remove('ui-tab-hidden'));
        sectionBar.querySelectorAll('button').forEach(chip => { chip.removeAttribute('role'); chip.removeAttribute('aria-selected'); });
        sectionBar.removeAttribute('role');
        document.body.classList.remove('ui-tabbed');
      }
      tabMode = false;
      return;
    }
    tabMode = true;
    sectionBar.setAttribute('role', 'tablist');
    document.body.classList.add('ui-tabbed');
    const labels = [...sectionBar.querySelectorAll('button')].map(chip => chip.textContent);
    const remembered = labels.indexOf(tabMemory[pageKey()]);
    activeTab = remembered >= 0 ? remembered : 0;
    showTab(activeTab);
  }
  tabQuery.addEventListener('change', () => { if (sectionTargets.length) applyTabs(); });
  // Swiping the page sideways moves to the next or previous section (not on tables, charts, fields or the player card,
  // which have their own sideways gestures).
  let swipe = null;
  workspace.addEventListener('touchstart', event => {
    swipe = null;
    if (!tabMode || event.touches.length !== 1) return;
    if (event.target.closest('.ui-table-scroll, .overflow-x-auto, canvas, input, select, textarea, #panelProfile > section:first-of-type, .ga-picker, .fl-subnav, .ui-section-bar')) return;
    const chart = event.target.closest('svg'); // a chart drawn in SVG (spray charts) has its own gestures; an icon does not
    if (chart && chart.getBoundingClientRect().width > 120) return;
    swipe = {x: event.touches[0].clientX, y: event.touches[0].clientY, t: performance.now()};
  }, {passive: true});
  workspace.addEventListener('touchend', event => {
    if (!swipe || !tabMode) return;
    const t = event.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    const quick = performance.now() - swipe.t < 650;
    swipe = null;
    if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
    const next = activeTab + (dx < 0 ? 1 : -1);
    if (next >= 0 && next < sectionTargets.length) showTab(next, 'swipe');
  }, {passive: true});
  // Anything that scrolls to something inside a waiting section brings that section forward first.
  const nativeIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...args) {
    if (tabMode) {
      const index = sectionTargets.findIndex(section => section.contains(this));
      if (index >= 0 && index !== activeTab) showTab(index);
    }
    return nativeIntoView.apply(this, args);
  };
  function buildSections() {
    const panel = workspace.querySelector('[id^="panel"]:not(.hidden)');
    // A section waiting behind a tab (phones, tablets) still counts: hidden by us, not gone.
    const waiting = s => s.classList.contains('ui-tab-hidden') && sectionTargets.includes(s);
    const found = panel ? [...panel.querySelectorAll('section')].filter(s => (waiting(s) || (visible(s) && s.offsetHeight > 120)) && !s.parentElement.closest('section')) : [];
    let items = found.map(section => ({section, label: sectionLabel(section)})).filter(item => item.label);
    // A page that is one long section (the glossary) jumps between its own sub-headings instead.
    if (items.length < 2 && found.length === 1) items = [...found[0].querySelectorAll('h3')].filter(visible).map(h => ({section: h, label: sectionLabel(h)})).filter(item => item.label);
    const key = items.map(item => item.label).join('|');
    if (sectionBar.dataset.key === key && sectionTargets.length === items.length &&
        sectionTargets.every((section, index) => section.isConnected && section === items[index].section)) { if (tabMode !== tabsWanted()) applyTabs(); return; }
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
        if (tabMode) { showTab(index, 'tap'); return; }
        // Land just below the sticky chip row.
        const target = sectionTargets[index];
        if (!target?.isConnected) return;
        const destination = () => target.getBoundingClientRect().top + window.scrollY - (stickyBottom() + 12);
        window.scrollTo({top: destination(), behavior: 'smooth'});
        // Sections not yet shown may be skipped by content-visibility (Chromium) with an estimated height, so the first
        // landing can be a little off: once the scroll ends, settle on the real position (unless the user took over).
        const jump = ++sectionJump;
        const settle = () => {
          window.removeEventListener('scrollend', settle);
          if (jump !== sectionJump || !target.isConnected) return;
          const top = destination();
          if (Math.abs(window.scrollY - top) > 2) window.scrollTo({top, behavior: 'instant'});
        };
        window.addEventListener('scrollend', settle);
        setTimeout(settle, 1500); // browsers without scrollend (they do not skip sections either)
      });
      sectionBar.append(chip);
    });
    applyTabs();
    markSection();
  }
  // The chip row docks under the app's top bar, so landing positions count both.
  const stickyBottom = () => (parseFloat(getComputedStyle(sectionBar).top) || 0) + sectionBar.offsetHeight;
  function markSection() {
    if (sectionBar.hidden || !sectionTargets.length || tabMode) return;
    let current = 0;
    // At the very bottom the last sections can never reach the top, so pick the last one on screen.
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    const line = atBottom ? window.innerHeight * 0.7 : stickyBottom() + 28;
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
  let scrollQueued = false, lastScrollY = 0, dockTop = null;
  window.addEventListener('resize', () => { dockTop = null; });
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
      // Docked under the top bar (ui-theme.css gives it glass only then). Layout is clean here: the read costs nothing.
      if (!sectionBar.hidden) {
        if (dockTop === null) dockTop = parseFloat(getComputedStyle(sectionBar).top) || 0;
        const docked = y > 0 && sectionBar.getBoundingClientRect().top <= dockTop + 1;
        if (sectionBar.classList.contains('is-docked') !== docked) sectionBar.classList.toggle('is-docked', docked);
      }
      markSection();
    });
  }, {passive: true});

  // Wide tables keep the player column in view while scrolling sideways (single-row headers only,
  // so grouped headers never get a mismatched sticky cell). A narrow first column (slot / rank) also
  // keeps the next column, which is then the name.
  function readStickyColumns() {
    const writes = [];
    currentPanel().querySelectorAll('.ui-table-scroll table').forEach(table => {
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
      writes.push(() => {
        if (table.classList.contains('ui-sticky-cols') !== one) table.classList.toggle('ui-sticky-cols', one);
        if (table.classList.contains('ui-sticky-two') !== two) table.classList.toggle('ui-sticky-two', two);
        if (two) table.style.setProperty('--ui-sticky-left', `${Math.round(left)}px`);
      });
    });
    return () => writes.forEach(write => write()); // every table read first: one layout for the whole page
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
  // ---------- Navigation groups: the sidebar, drawer and 「更多」 sheet list every page under NAV_GROUPS ----------
  function arrangeNav() {
    const want = [];
    for (const [label, keys] of NAV_GROUPS) {
      let head = label ? navigation.querySelector(`.ui-nav-group[data-group="${label}"]`) : null;
      if (label && !head) {
        head = document.createElement('div');
        head.className = 'ui-nav-group';
        head.dataset.group = label;
        head.setAttribute('aria-hidden', 'true');
        head.textContent = label;
      }
      want.push(...[head, ...keys.map(key => document.getElementById(`btnTab${key}`))].filter(Boolean));
    }
    const current = [...navigation.children].filter(el => want.includes(el));
    if (current.length === want.length && current.every((el, i) => el === want[i])) return;
    want.forEach(el => navigation.append(el)); // the drawer's close button stays first
  }
  new MutationObserver(arrangeNav).observe(navigation, {childList: true}); // the records page adds its button later
  arrangeNav();

  // The lineup page gets its own way into the defensive rankings it is built on (the header button stays too).
  const lineupFirst = document.querySelector('#panelLineup > section');
  if (lineupFirst && typeof window.openDefenseModal === 'function' && !document.getElementById('uiLineupDefense')) {
    const shortcut = document.createElement('button');
    shortcut.type = 'button';
    shortcut.id = 'uiLineupDefense';
    shortcut.className = 'ui-lineup-defense';
    shortcut.textContent = '🛡️ 守位設定（推薦打線依據）';
    shortcut.addEventListener('click', () => window.openDefenseModal());
    lineupFirst.querySelector('h3')?.closest('div.flex, div')?.parentElement?.append(shortcut);
  }

  // ---------- Phone tables: no sideways scrolling ----------
  // A wide table keeps its name column(s) plus the most useful columns that fit the screen; tapping a row
  // opens the rest underneath as label–value pairs. Tables with one or two rows become a full card instead.
  // Tables with form fields (editing) or merged body cells keep sideways scrolling.
  const KEY_COLUMNS = ['當前排行指標', '出賽率', '出賽／總場數', '近況 OPS', '差距', '狀態', '安打-打數', '單場 OPS', 'OPS', 'wRC+', '打擊率', 'AVG',
    '領先優勢', '安打', '打數', '累計 OPS', '比分', '打席', '全壘打', '保送', '三振', 'sFIP', '局數 (IP)'];
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
  // Group header rows (one cell across the table) separate sections; they are not data rows.
  const bodyRows = table => [...(table.tBodies[0]?.rows || [])].filter(row => !row.classList.contains('ui-row-detail') && !row.classList.contains('ui-group-row'));
  // Runs in phases across all the page's tables (read all, then write all), so a page with many tables costs a few
  // layouts instead of a few per table.
  function foldTables() {
    const jobs = [];
    currentPanel().querySelectorAll('.ui-table-scroll table').forEach(table => {
      const area = table.closest('.ui-table-scroll');
      const rows = bodyRows(table);
      const labels = headerLabels(table);
      const areaWidth = area.clientWidth; // the container's width does not depend on the classes set below
      const signature = `${phone()}|${areaWidth}|${rows.length}|${rows[0]?.textContent.length || 0}|${labels.join('|')}`;
      // Same table and still laid out: a re-render that rebuilt the rows (same size, new cells) must be redone.
      const intact = (!table.classList.contains('ui-fold-table') || rows.every(row => row.querySelector('.ui-col-folded'))) &&
        (!table.classList.contains('ui-card-table') || rows.every(row => row.cells.length === 1 || row.cells[0].dataset.label !== undefined));
      if (table.dataset.uiFoldSig === signature && intact) return;
      const hint = area.previousElementSibling?.classList.contains('ui-table-hint') ? area.previousElementSibling : null;
      jobs.push({table, area, rows, labels, areaWidth, signature, hint});
    });
    if (!jobs.length) return;
    jobs.forEach(({table, signature, hint}) => {
      table.dataset.uiFoldSig = signature;
      table.querySelectorAll('.ui-col-folded').forEach(cell => cell.classList.remove('ui-col-folded'));
      table.querySelectorAll('.ui-row-detail').forEach(row => row.remove());
      table.classList.remove('ui-fold-table', 'ui-card-table', 'ui-wrap-table');
      if (hint) hint.textContent = '左右滑動查看完整欄位';
    });
    jobs.forEach(job => { job.overflow = job.area.scrollWidth > job.area.clientWidth + 4; });
    const asCards = ({table, rows, labels}) => {
      // One or two rows (a single pitcher, a summary): every value as a labelled card.
      table.classList.add('ui-card-table');
      rows.forEach(row => [...row.cells].forEach((cell, i) => { cell.dataset.label = labels[i]; }));
    };
    const wrapTry = [], measure = [];
    const next = job => (job.rows.length <= 2 ? asCards(job) : measure.push(job));
    jobs.forEach(job => {
      const {table, rows, labels} = job;
      // An empty table (a single message row) needs no wide header on a phone.
      if (phone() && rows.length && rows.every(row => row.cells.length === 1 && row.cells[0].colSpan > 1)) { table.classList.add('ui-card-table'); return; }
      // The overview summary has its own column picker (重點表現／全部欄位…), which already fits a phone.
      const usable = phone() && !table.closest('#viewSummary') && labels.length >= 3 && table.tHead.rows.length === 1 && rows.length > 0 &&
        !table.querySelector('input, select, textarea') && rows.every(row => row.cells.length === labels.length) && job.overflow;
      if (!usable) return;
      // Small tables first try to fit by letting text wrap; nothing is folded if that works.
      if (labels.length <= 5) wrapTry.push(job); else next(job);
    });
    wrapTry.forEach(({table}) => table.classList.add('ui-wrap-table'));
    wrapTry.forEach(job => { job.fits = job.area.scrollWidth <= job.area.clientWidth + 2; });
    wrapTry.forEach(job => { if (!job.fits) { job.table.classList.remove('ui-wrap-table'); next(job); } });
    if (!measure.length) return;
    // Column width = its data, but never so narrow that a short header (「全壘打」) breaks into one character per line.
    const headerRoom = label => Math.min(64, label.length * 12 + 16);
    measure.forEach(({table}) => table.classList.add('ui-measure')); // natural column widths, without the table's desktop min-width
    measure.forEach(job => { job.widths = job.labels.map((label, i) => Math.max(headerRoom(label), ...job.rows.map(row => row.cells[i].getBoundingClientRect().width))); });
    measure.forEach(({table}) => table.classList.remove('ui-measure'));
    measure.forEach(({table, rows, labels, widths, areaWidth, hint}) => {
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
      const BOX = ['打數', '安打', '得分', '三振', '保送'];
      labels.map((label, i) => ({i, rank: boxScore && BOX.includes(label) ? -0.5 + BOX.indexOf(label) / 10 : keyRank(label)})).filter(c => !keep.has(c.i)).sort((a, b) => a.rank - b.rank || a.i - b.i)
        .forEach(c => { if (used + widths[c.i] <= areaWidth - 18) { keep.add(c.i); used += widths[c.i]; } });
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
    const row = event.target.closest('table.ui-fold-table tbody tr:not(.ui-row-detail):not(.ui-group-row)');
    if (!row || event.target.closest('button, a, select, input')) return;
    const table = row.closest('table');
    const tappedCell = event.target.closest('td');
    const nameIndex = Number(table.dataset.uiNameCol) - 1;
    // 姓名維持原本的球員跳轉／投手選取；其他欄位在捕捉階段攔下列的 onclick。
    if (tappedCell && tappedCell.cellIndex === nameIndex && row.onclick) return;
    event.stopPropagation();
    const next = row.nextElementSibling;
    if (next && next.classList.contains('ui-row-detail')) { next.remove(); row.classList.remove('ui-row-open'); return; }
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
    if (row.onclick) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'mt-2 min-h-[36px] px-3 py-2 rounded-lg bg-sky-950 border border-sky-700 text-sky-300 text-xs';
      open.textContent = table.closest('#panelPitching') ? '查看投手分析' : '查看球員檔案';
      open.addEventListener('click', e => row.onclick.call(row, e));
      cell.append(open);
      if (table.closest('#panelPitching')) {
        const profile = open.cloneNode(true);
        profile.textContent = '查看球員檔案';
        profile.addEventListener('click', () => {
          const name = row.cells[nameIndex]?.querySelector('span:last-child')?.textContent || row.cells[nameIndex]?.textContent;
          selectedPlayerName = String(name || '').replace(/^\s*#\S+\s*/, '').trim();
          switchMainTab('tabProfile');
          renderPlayerProfile(getAnalysisAgg());
        });
        cell.append(profile);
      }
    }
    detail.append(cell);
    row.after(detail);
    row.classList.add('ui-row-open');
  }, true);

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
    if (dateToggle.closest('#flTopbar')) return; // the app top bar (ui-app.js) owns it now
    if (phone() && toolRow && dateToggle.parentElement !== toolRow) toolRow.append(dateToggle);
    else if (!phone() && dateToggle.parentElement !== dateHome) dateHome.insertBefore(dateToggle, dateNext);
  }

  let comfortQueued = false;
  const queueComfort = () => {
    if (comfortQueued) return;
    comfortQueued = true;
    // After the frame has painted: layout is then clean, so these reads cost nothing extra (the page is still fading in).
    requestAnimationFrame(() => setTimeout(() => {
      comfortQueued = false;
      enhanceTables(false); densify(); foldTables();
      const sticky = readStickyColumns(), hints = readTableHints(); // one layout for both
      sticky(); hints();
      buildSections();
    }, 0));
  };
  window.addEventListener('resize', placeDateToggle);
  placeDateToggle();
  new MutationObserver(records => { if (meaningful(records)) queueComfort(); }).observe(workspace, {childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class']});
  window.addEventListener('resize', queueComfort);

  updateNavigation();
  enhanceTables(false); // measured by queueComfort once the page has painted (the start-up splash still covers it now)
  queueComfort();
})();
