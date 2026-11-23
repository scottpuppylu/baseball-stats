// review-v2/review-v2.js — 新版覆盤（WO-05）的入口，最後載入。只在旗標開時、scorebook-v2.js 之後載入。
//
// 模組：review-cache.js（摘要快取）→ review-core.js（首屏：場次、hero、分段，註冊到外殼）→ 本檔。
// review-detail.js（打席詳情、3D 看這一球）與 review-edit.js（逐筆編輯、6 秒復原）由 review-core.js 在首屏畫完後閒置時載入。
// 本檔只做保底：review-core.js 沒載到時，覆盤頁顯示說明，請使用者按「回到舊版」。不寫資料、不連網。
(function () {
  'use strict';
  if (!window.uiV2 || window.reviewV2) return;
  window.uiV2.register('review', body => {
    body.innerHTML = '<h3>新版比賽覆盤</h3><p><span class="v2-nb">新版覆盤沒有載入完成，</span><span class="v2-nb">請重新整理頁面，</span>'
      + '<span class="v2-nb">或按下面的「回到舊版」。</span></p>';
  });
})();
