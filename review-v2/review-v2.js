// review-v2/review-v2.js — 新版覆盤（WO-05）。只在旗標開時、scorebook-v2.js 之後載入。
// B1 是空殼：只讀已記錄的比賽數量顯示狀態，不寫資料、不呼叫共用模組（game-analysis.js 等）。
// hero、分段與 <300 ms 架構在 B5 做；逐筆編輯與跳 3D 在 B6 做。
(function () {
  'use strict';
  if (!window.uiV2) return;
  window.uiV2.register('review', body => {
    const games = typeof allGames !== 'undefined' && Array.isArray(allGames) ? allGames : [];
    body.innerHTML = '<h3>新版比賽覆盤</h3><p><span class="v2-nb">比賽摘要、比分走勢、</span><span class="v2-nb">逐局經過與逐筆編輯</span><span class="v2-nb">會在之後的階段放進這裡。</span>'
      + '<span class="v2-nb">現在要看覆盤，</span><span class="v2-nb">請按下面的「回到舊版」。</span></p>'
      + `<p class="v2-status" data-v2-status>${games.length ? `目前共有 ${games.length} 場已記錄的比賽。` : '還沒有已記錄的比賽。'}</p>`;
  });
})();
