(function() {
  const panel = document.getElementById('panelHealth');
  let selected = '', dirty = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const zodiacIcons = {'牡羊座':'♈','金牛座':'♉','雙子座':'♊','巨蟹座':'♋','獅子座':'♌','處女座':'♍','天秤座':'♎','天蠍座':'♏','射手座':'♐','摩羯座':'♑','水瓶座':'♒','雙魚座':'♓'};
  function birthdayInfo(profile = {}) {
    const age = PlayerHealth.age(profile.birthDate || '');
    const sign = PlayerHealth.zodiac(profile.birthDate || '');
    return {age:age === null ? '年齡未填寫' : `${age} 歲`, sign:sign ? `${zodiacIcons[sign]} ${sign}` : '星座未填寫'};
  }
  const inputClass = 'w-full min-w-0 bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm';
  panel.innerHTML = `<section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
    <h2 class="text-xl text-white font-black">球員健康資料</h2>
    <p class="text-sm text-slate-400">記錄身高、體重、生日與慣用側。目前僅打擊側用於拉／推判定；其餘資料不納入能力、健康或戰術評分。</p>
    <p class="text-xs text-amber-300">資料沿用公開雲端同步，所有填寫內容皆可被公開讀取。各欄位可留空。</p>
    <label class="block text-sm text-slate-300">球員<select data-health-player class="${inputClass} mt-1"></select></label>
    <div data-health-identity class="flex items-center gap-3 text-white font-bold"></div>
    <form data-health-form class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block text-sm text-slate-300">身高（cm）<input name="heightCm" type="number" min="50" max="250" step="0.1" inputmode="decimal" class="${inputClass} mt-1" placeholder="未填寫"></label>
        <label class="block text-sm text-slate-300">體重（kg）<input name="weightKg" type="number" min="10" max="300" step="0.1" inputmode="decimal" class="${inputClass} mt-1" placeholder="未填寫"></label>
        <label class="block text-sm text-slate-300">打擊慣用側<select name="bats" class="${inputClass} mt-1">${Object.entries(PlayerHealth.BATS).map(([v,t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        <label class="block text-sm text-slate-300">傳球慣用手<select name="throws" class="${inputClass} mt-1"><option value="U">未設定</option><option value="R">右手</option><option value="L">左手</option><option value="B">雙手</option></select></label>
        <label class="block text-sm text-slate-300">出生年月日<input name="birthDate" type="date" min="1900-01-01" max="${PlayerHealth.today()}" class="${inputClass} mt-1"></label>
        <div class="text-sm text-slate-300 self-end pb-2" data-health-birthday></div>
      </div>
      <p class="text-xs text-slate-400">未記錄打席側別的舊紀錄，依目前固定左／右打設定重算；左右開弓者請在場記或歷史編輯中指定每個打席的實際側。落點本身不鏡射。</p>
      <div class="flex flex-wrap gap-2"><button type="submit" class="bg-sky-600 text-white font-bold px-4 py-2 rounded-lg text-sm">儲存並同步</button><button type="button" data-health-reset class="bg-slate-800 text-slate-200 px-4 py-2 rounded-lg text-sm">還原未儲存輸入</button><button type="button" data-health-retry class="bg-amber-700 text-white px-4 py-2 rounded-lg text-sm hidden">重試待同步資料</button></div>
      <p data-health-status role="status" aria-live="polite" class="text-sm text-amber-300"></p>
    </form>
  </section><section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-3"><h3 class="font-bold text-slate-100">名冊打擊側</h3><p class="text-xs text-slate-400">點選球員即可編輯，不受統計日期篩選影響。</p><div data-health-roster class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"></div></section>`;
  const form = panel.querySelector('form'), picker = panel.querySelector('[data-health-player]');
  const status = panel.querySelector('[data-health-status]');
  function state() {
    const s = PlayerHealthStore.status();
    panel.querySelectorAll('input,select,button').forEach(el => {el.disabled = !s.ready || s.busy;});
    form.querySelector('button[type="submit"]').disabled = !s.ready || s.busy;
    panel.querySelector('[data-health-retry]').classList.toggle('hidden',!s.pending);
    panel.querySelector('[data-health-retry]').disabled = !s.ready || s.busy;
    status.textContent = !s.ready ? '正在讀取雲端資料…' : s.busy ? '正在同步…' : s.pending ? `有 ${s.pending} 位球員的資料只保存在本機，請重試同步。` : dirty ? '有尚未儲存的輸入。' : '可編輯後儲存；空白欄位不會推估。';
  }
  function birth() {
    const date = form.elements.birthDate.value;
    const info = birthdayInfo({birthDate:date});
    panel.querySelector('[data-health-birthday]').textContent = PlayerHealth.validBirthDate(date) ? `${info.age} · ${info.sign}（一般日期區間，僅供趣味註記）` : '年齡與星座：未填寫';
  }
  function fill() {
    const p = PlayerHealthStore.data()[selected] || PlayerHealth.normalize();
    for (const key of ['heightCm','weightKg','bats','throws','birthDate']) form.elements[key].value = p[key] ?? '';
    panel.querySelector('[data-health-identity]').innerHTML = renderAvatarElement(selected,'health-player-avatar text-3xl') + `<span>${esc(selected)}</span>`;
    birth();
  }
  function render() {
    const roster = getAllAvailablePlayerNames();
    const names = [...new Set([...roster.teamNames,...roster.guestNames])];
    if (!names.includes(selected)) selected = names[0] || '';
    picker.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}${roster.guestNames.includes(n) ? '（支援）' : ''}</option>`).join('');
    picker.value = selected;
    if (!dirty) fill();
    const profiles = PlayerHealthStore.data();
    panel.querySelector('[data-health-roster]').innerHTML = names.map(n => {
      const profile = profiles[n] || {};
      const info = birthdayInfo(profile);
      const height = profile.heightCm == null ? '身高未填寫' : `身高 ${profile.heightCm} cm`;
      const weight = profile.weightKg == null ? '體重未填寫' : `體重 ${profile.weightKg} kg`;
      return `<button type="button" data-health-name="${esc(n)}" class="health-roster-card rounded-lg border border-slate-700 p-3 text-sm text-left">
        ${renderAvatarElement(n,'health-player-avatar text-3xl')}
        <span class="health-roster-details">
          <span class="text-slate-100 font-bold block break-words">${esc(n)}</span>
          <span data-roster-birthday class="health-roster-facts text-xs text-slate-400"><span>${info.age}</span><span>${info.sign}</span></span>
          <span data-roster-measurements class="health-roster-facts text-xs text-slate-300"><span>${height}</span><span>${weight}</span></span>
          <span data-roster-bats class="text-sky-300 block mt-1">打擊慣用手：${PlayerHealth.BATS[profile.bats || 'U']}</span>
        </span>
      </button>`;
    }).join('');
    state();
  }
  function choose(name) {
    if (dirty && name !== selected) { picker.value = selected; showToast('請先儲存或還原目前輸入，再切換球員','warning'); return; }
    selected = name; picker.value = name; fill(); state();
  }
  picker.addEventListener('change',() => choose(picker.value));
  panel.addEventListener('click',e => { const b=e.target.closest('[data-health-name]'); if (b) choose(b.dataset.healthName); });
  form.addEventListener('input',() => {dirty=true; birth(); state();});
  form.addEventListener('change',() => {dirty=true; birth(); state();});
  panel.querySelector('[data-health-reset]').addEventListener('click',() => {dirty=false; fill(); state();});
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    try {
      const raw = Object.fromEntries(new FormData(form));
      await PlayerHealthStore.save(selected,raw);
      dirty=false; render(); showToast('球員健康資料已同步');
    } catch (error) { state(); status.textContent += ` ${error.message}`; showToast(`儲存未完成：${error.message}`,'error'); }
  });
  panel.querySelector('[data-health-retry]').addEventListener('click',async () => {
    try { await PlayerHealthStore.sync(); render(); showToast('待同步資料已上傳'); }
    catch(error) {state(); status.textContent += ` ${error.message}`;}
  });
  document.addEventListener('change',event => {
    if (!event.target.matches('[data-live-batting-side]') || !activeGame) return;
    currentPlayInput.battingSide = event.target.value;
    currentPlayInput.battingSideBatter = activeGame.lineup[activeGame.currentBatterIdx];
  });
  document.getElementById('btnTabHealth').addEventListener('click',() => switchMainTab('tabHealth'));
  function renderProfileHealth(agg) {
    const player = agg.players.find(p => p.name === selectedPlayerName);
    const column = document.querySelector('#playerProfileBio .flex-1.min-w-0.space-y-2');
    if (!player || !column) return;
    const profile = PlayerHealthStore.data()[player.name] || {};
    const info = birthdayInfo(profile);
    const block = document.createElement('div');
    block.dataset.profileHealth = '';
    block.className = 'flex flex-wrap items-center gap-1.5 text-xs text-slate-300';
    const values = [profile.heightCm == null ? '身高未填寫' : `身高 ${profile.heightCm} cm`, profile.weightKg == null ? '體重未填寫' : `體重 ${profile.weightKg} kg`, info.age, info.sign];
    block.innerHTML = values.map(value => `<span class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">${esc(value)}</span>`).join('');
    column.querySelector('[data-profile-health]')?.remove();
    column.append(block);
  }
  siteHooks.after('renderPlayerProfile','player-health',renderProfileHealth);
  siteHooks.after('switchMainTab','player-health',tab => {if(tab==='tabHealth') render();});
  siteHooks.after('renderAll','player-health',() => {if(!panel.classList.contains('hidden')) render();});
  window.addEventListener('player-health-status',state);
  render();
  renderProfileHealth(getAnalysisAgg());
})();
