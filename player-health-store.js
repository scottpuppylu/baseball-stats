// Uses the site's existing data-branch writer and conflict retry. No profile is created until the scorer saves it.
(function() {
  const FILE = 'data/health.json', CACHE = 'rebas_player_health', DRAFTS = 'rebas_player_health_pending';
  function clean(value) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [name, profile] of Object.entries(value)) {
      if (!profile || typeof profile !== 'object') continue;
      try { Object.defineProperty(out,name,{value:PlayerHealth.normalize(profile),enumerable:true,configurable:true,writable:true}); } catch (_) { /* invalid saved entry */ }
    }
    return out;
  }
  function read(key) { try { return clean(JSON.parse(localStorage.getItem(key))); } catch (_) { return {}; } }
  let profiles = read(CACHE), drafts = read(DRAFTS), ready = false, busy = false;
  const data = () => ({...profiles,...drafts});
  function notify() { window.dispatchEvent(new Event('player-health-status')); }
  async function load() {
    if (busy) return 'cache';
    ready = false; notify();
    let source;
    try {
      const result = await fetchGitHubContent(FILE);
      if (!result.content || typeof result.content !== 'object' || Array.isArray(result.content)) throw new Error('Invalid health data');
      profiles = clean(result.content);
      rememberCloudBase(FILE,result.sha,result.content);
      source = 'cloud';
      localStorage.setItem(CACHE,JSON.stringify(profiles));
    } catch (error) {
      if (error.status === 404) { profiles = {}; rememberCloudBase(FILE,null,{}); source = 'missing'; }
      else source = Object.keys(data()).length ? 'cache' : 'failed';
    }
    ready = true; notify(); return source;
  }
  async function sync() {
    if (!ready || busy) throw new Error('資料仍在載入或儲存，請稍後再試');
    if (!Object.keys(drafts).length) return true;
    busy = true; notify();
    try {
      const result = await commitJsonFile(FILE,data(),'update: sync player health profiles');
      profiles = clean(result.data);
      // Keep drafts if local persistence fails, so a refresh can never lose an unsynced edit.
      localStorage.setItem(CACHE,JSON.stringify(profiles));
      localStorage.removeItem(DRAFTS);
      drafts = {};
      setStatusBadge('[連線正常] 球員健康資料已同步','success');
      return true;
    } catch (error) {
      setStatusBadge('[尚未同步] 球員健康資料保留在本機','warning');
      throw error;
    } finally { busy = false; syncAllGamesToTeamLogs(); renderAll(); notify(); }
  }
  async function save(name, raw) {
    if (!ready || busy) throw new Error('資料仍在載入或儲存，請稍後再試');
    const profile = PlayerHealth.normalize(raw);
    const next = {...drafts,[name]:profile};
    localStorage.setItem(DRAFTS,JSON.stringify(next)); // persist before changing the displayed statistics
    drafts = next;
    return sync();
  }
  window.PlayerHealthStore = {data,load,save,sync,status:() => ({ready,busy,pending:Object.keys(drafts).length})};
})();
