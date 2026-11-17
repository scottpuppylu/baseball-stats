// scorebook-v2.js — 新版場記與覆盤（WO-05）的外殼與實況頁。
// 只在旗標開時載入（localStorage.rebas_ui_v2 = '1' 或網址 ?ui=v2；判斷在 index.html 結尾）。旗標關時這個檔案不會載入，
// 舊版場記與覆盤一行都不受影響。
// 規則（WO-05 §D）：新舊版讀寫同一份 rebas_active_game／rebas_all_games／rebas_pending_sync，經同一組現有函式；
// 不轉格式、不搬資料。B1 只有外殼：不寫任何資料，只讀目前的比賽來顯示狀態。
(function () {
  'use strict';
  const main = document.querySelector('#appWorkspace main');
  if (!main || !window.siteHooks || typeof window.switchMainTab !== 'function') return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // 兩個頁面：實況（場記頁 panelScorebook 的位置）與覆盤（覆盤頁 panelGames 的位置）。
  const VIEWS = {
    live: {page: 'Scorebook', tab: 'tabScorebook', label: '實況'},
    review: {page: 'Games', tab: 'tabGames', label: '覆盤'}
  };
  const renderers = {};
  const shells = {};

  function shellMarkup(view) {
    const seg = Object.entries(VIEWS).map(([key, v]) =>
      `<button type="button" data-v2-go="${key}"${key === view ? ' aria-current="page"' : ''}>${v.label}</button>`).join('');
    return `<div class="v2-head"><h2 class="v2-title">${view === 'live' ? '場記' : '覆盤'}<span class="v2-badge">新版試用</span></h2>`
      + `<nav class="v2-seg" aria-label="新版場記與覆盤">${seg}</nav></div>`
      + '<div class="v2-body" data-v2-body></div>'
      + '<div class="v2-foot"><p>新版還在建置中。<span class="v2-nb">資料和舊版是同一份，</span><span class="v2-nb">隨時可以切回舊版。</span></p>'
      + '<button type="button" class="v2-back" data-v2-off>回到舊版</button></div>';
  }

  function mount(view) {
    if (shells[view]) return shells[view];
    // div，不用 section：全站 `main section` 的樣式（ui-theme.css）會蓋掉外殼與徽章的顏色。
    const shell = document.createElement('div');
    shell.className = 'v2-shell';
    shell.setAttribute('role', 'region');
    shell.dataset.v2View = view;
    shell.setAttribute('aria-label', `新版${VIEWS[view].label}`);
    shell.innerHTML = shellMarkup(view);
    main.append(shell);
    shells[view] = shell;
    return shell;
  }

  function render(view) {
    const shell = mount(view);
    const body = shell.querySelector('[data-v2-body]');
    const draw = renderers[view];
    if (draw) { try { draw(body); } catch (error) { console.error('[ui-v2]', view, error); } }
  }

  main.addEventListener('click', event => {
    const go = event.target.closest('.v2-shell [data-v2-go]');
    if (go) { const v = VIEWS[go.dataset.v2Go]; if (v && document.body.dataset.page !== v.page) switchMainTab(v.tab); return; }
    if (event.target.closest('.v2-shell [data-v2-off]') && window.uiV2Flag) window.uiV2Flag.set(false);
  });

  // 實況頁（B1 空殼）：只顯示目前有沒有進行中的比賽；記分盤、打席 sheet 在 B2 做。
  renderers.live = body => {
    const game = typeof activeGame !== 'undefined' ? activeGame : null;
    const status = game && game.opponent
      ? `目前有進行中的比賽：淡江航太系壘 vs ${esc(game.opponent)}（第 ${esc(game.currentInning)} 局）。`
      : '目前沒有進行中的比賽。';
    body.innerHTML = '<h3>新版實況記分</h3><p><span class="v2-nb">記分盤、打席紀錄、</span><span class="v2-nb">換投與換人</span><span class="v2-nb">會在下一階段放進這裡。</span>'
      + '<span class="v2-nb">現在要記錄比賽，</span><span class="v2-nb">請按下面的「回到舊版」。</span></p>'
      + `<p class="v2-status" data-v2-status>${status}</p>`;
  };

  window.uiV2 = {
    VIEWS,
    register(view, draw) { renderers[view] = draw; if (shells[view] && document.body.dataset.page === VIEWS[view].page) render(view); },
    render
  };

  document.body.classList.add('ui-v2');
  const showFor = () => {
    const view = Object.keys(VIEWS).find(key => VIEWS[key].page === document.body.dataset.page);
    if (view) render(view);
  };
  // ui-comfort.js 換頁後才寫 body[data-page]（MutationObserver，非同步），所以跟著這個屬性走，不掛 switchMainTab。
  new MutationObserver(showFor).observe(document.body, {attributes: true, attributeFilter: ['data-page']});
  window.siteHooks.after('renderAll', 'ui-v2', showFor);
  showFor();
})();
