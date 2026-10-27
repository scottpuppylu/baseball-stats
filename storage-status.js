// A visible local-save warning and the existing full backup action, available from every page.
(function() {
  'use strict';
  const cache = window.LocalCache;
  if (!cache) return;
  function render() {
    const state = cache.status();
    let bar = document.getElementById('uiStorageWarning');
    document.documentElement.classList.toggle('ui-storage-failed', state.failed);
    if (!state.failed && !state.quotaHigh) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'uiStorageWarning';
      bar.className = 'ui-app-bar ui-app-bar-warn ui-storage-warning';
      bar.setAttribute('role', 'alert');
      const text = document.createElement('span'); text.dataset.storageMessage = '';
      const backup = document.createElement('button');
      backup.type = 'button'; backup.textContent = '下載完整備份';
      backup.onclick = () => document.getElementById('downloadBackupBtn')?.click();
      const retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = '重試本機保存'; retry.dataset.storageRetry = '';
      retry.onclick = async () => {
        retry.disabled = true;
        try { await cache.retry(); } catch (_) { /* the warning remains until a durable save succeeds */ }
        finally { render(); }
      };
      bar.append(text, backup, retry); document.body.append(bar);
    }
    bar.querySelector('[data-storage-message]').textContent = state.failed
      ? '本機儲存未完成：資料目前可能只在此頁，請保留頁面並下載完整備份。系統會自動重試。'
      : '這台裝置的儲存用量已超過 80%，建議下載完整備份並釋放空間。';
    const retry = bar.querySelector('[data-storage-retry]');
    retry.hidden = !state.failed; retry.disabled = false;
  }
  window.addEventListener('localcache:error', render);
  window.addEventListener('localcache:status', render);
  cache.ready.then(render);
})();
