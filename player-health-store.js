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
  // cloudKnown: this page has read (or written) the cloud file, so the shared writer has a merge base for it.
  let profiles = read(CACHE), drafts = read(DRAFTS), ready = false, busy = false, cloudKnown = false, syncing = null;
  // Statistics read a profile for every plate appearance; keep one merged snapshot instead of rebuilding it per call.
  let merged = {...profiles,...drafts};
  function set(nextProfiles, nextDrafts) { profiles = nextProfiles; drafts = nextDrafts; merged = {...profiles,...drafts}; }
  const data = () => merged;
  function notify() { window.dispatchEvent(new Event('player-health-status')); }
  async function load() {
    if (syncing) await syncing.catch(() => {}); // a save in progress finishes first, then the cloud is read again
    ready = false; notify();
    let source;
    try {
      const result = await fetchGitHubContent(FILE);
      if (!result.content || typeof result.content !== 'object' || Array.isArray(result.content)) throw new Error('Invalid health data');
      set(clean(result.content), drafts);
      rememberCloudBase(FILE,result.sha,result.content);
      cloudKnown = true;
      source = 'cloud';
      localStorage.setItem(CACHE,JSON.stringify(profiles));
    } catch (error) {
      if (error.status === 404) { set({}, drafts); rememberCloudBase(FILE,null,{}); cloudKnown = true; source = 'missing'; }
      else source = Object.keys(merged).length ? 'cache' : 'failed';
    }
    ready = true; notify(); return source;
  }
  async function upload() {
    // Without a known cloud base every uploaded key counts as edited here, so a stale cache would overwrite
    // other devices' newer profiles. In that case upload only the players edited on this device.
    const result = await commitJsonFile(FILE,cloudKnown ? merged : drafts,'update: sync player health profiles');
    cloudKnown = true;
    // Keep drafts if local persistence fails, so a refresh can never lose an unsynced edit.
    localStorage.setItem(CACHE,JSON.stringify(clean(result.data)));
    localStorage.removeItem(DRAFTS);
    set(clean(result.data), {});
  }
  async function sync() {
    if (!ready || busy) throw new Error('資料仍在載入或儲存，請稍後再試');
    if (!Object.keys(drafts).length) return true;
    busy = true; notify();
    syncing = upload();
    try {
      await syncing;
      setStatusBadge('[連線正常] 球員健康資料已同步','success');
      return true;
    } catch (error) {
      setStatusBadge('[尚未同步] 球員健康資料保留在本機','warning');
      throw error;
    } finally { busy = false; syncing = null; syncAllGamesToTeamLogs(); renderAll(); notify(); }
  }
  async function save(name, raw) {
    if (!ready || busy) throw new Error('資料仍在載入或儲存，請稍後再試');
    const profile = PlayerHealth.normalize(raw);
    const next = {...drafts,[name]:profile};
    localStorage.setItem(DRAFTS,JSON.stringify(next)); // persist before changing the displayed statistics
    set(profiles, next);
    return sync();
  }
  window.PlayerHealthStore = {data,load,save,sync,status:() => ({ready,busy,pending:Object.keys(drafts).length})};
})();
