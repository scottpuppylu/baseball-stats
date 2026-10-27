(function(root) {
  'use strict';
  function render() {
    const count=root.SyncDrafts?.status().pending || 0;
    document.documentElement.classList.toggle('ui-sync-pending',count>0);
    let bar=document.getElementById('uiSyncDraftWarning');
    if(!count){bar?.remove();return;}
    if(!bar){
      bar=document.createElement('div');bar.id='uiSyncDraftWarning';
      bar.className='ui-app-bar ui-app-bar-warn ui-sync-drafts';bar.setAttribute('role','status');
      const message=document.createElement('span');bar.appendChild(message);
      const retry=document.createElement('button');retry.type='button';retry.textContent='重試同步';
      retry.onclick=async()=>{retry.disabled=true;try{await root.retryPendingSync();}finally{retry.disabled=false;}};
      const backup=document.createElement('button');backup.type='button';backup.textContent='匯出備份';
      backup.onclick=()=>document.getElementById('downloadBackupBtn')?.click();
      bar.append(retry,backup);
      const header=document.getElementById('appHeader');
      if(header)header.after(bar);else document.body.prepend(bar);
    }
    bar.querySelector('span').textContent=`${count} 筆修改尚未同步；此裝置保留待同步草稿。`;
  }
  root.addEventListener('syncdrafts:status',render);
  Promise.resolve(root.SyncDrafts?.ready).then(render);
})(window);
