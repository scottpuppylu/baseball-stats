// Durable, per-record upload intents. Acknowledgements may clear only the exact intent they sent.
(function(root) {
  'use strict';
  const KEY = 'rebas_sync_pending';
  const FILES = {'data/games.json':'rebas_all_games','data/logs.json':'rebas_logs'};
  const cache = root.LocalCache;
  let state = {version:1,files:{}}, serial = Promise.resolve();
  const baselines = new Map(), epochs = new Map();
  const advance = file => epochs.set(file,(epochs.get(file)||0)+1);
  const copy = value => JSON.parse(JSON.stringify(value));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const records = rows => new Map((Array.isArray(rows)?rows:[]).filter(row=>row&&row.id!=null).map(row=>[String(row.id),row]));
  function clean(raw) {
    const out = {version:1,files:{}};
    for (const file of Object.keys(FILES)) {
      const entries = [];
      for (const [id,op] of Object.entries(raw?.files?.[file] || {})) {
        if (!op || typeof op.token !== 'string' || !['put','delete'].includes(op.op)) continue;
        if (op.op === 'put' && (!op.value || String(op.value.id) !== id)) continue;
        entries.push([id,copy(op)]);
      }
      if (entries.length) out.files[file] = Object.fromEntries(entries);
    }
    return out;
  }
  function notify() {
    root.dispatchEvent?.(new root.CustomEvent('syncdrafts:status',{detail:status()}));
  }
  const ready = Promise.resolve(cache.register(KEY)).then(() => {
    try { state = clean(JSON.parse(cache.get(KEY))); } catch (_) { /* absent or malformed drafts */ }
    for (const [file,key] of Object.entries(FILES)) {
      try { baselines.set(file,JSON.parse(cache.get(key)) || []); } catch (_) { baselines.set(file,[]); }
    }
    notify();
  });
  function status() {
    return {pending:Object.values(state.files).reduce((n,ops)=>n+Object.keys(ops).length,0),
      files:Object.keys(state.files).filter(file=>Object.keys(state.files[file]).length)};
  }
  function enqueue(fn) {
    const next = serial.then(fn,fn);
    serial = next.catch(()=>{});
    return next;
  }
  async function persist() {
    cache.set(KEY,JSON.stringify(state));
    await cache.whenPersisted(KEY);
    notify();
  }
  function token() {
    return root.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  }
  async function stage(file, rows, base) {
    if (!FILES[file]) return null;
    advance(file);
    const desired = copy(rows), known = base == null ? null : copy(base);
    await ready;
    return enqueue(async () => {
      const before = records(known ?? baselines.get(file)), local = records(desired);
      const ops = new Map(Object.entries(state.files[file] || {}));
      for (const id of new Set([...before.keys(),...local.keys()])) {
        const a = before.get(id), b = local.get(id);
        const previous = ops.get(id);
        if (equal(a,b)) {
          // A fallback snapshot may already contain a pending edit; equality cannot acknowledge it.
          if (known !== null && !(previous?.op === 'put' && equal(previous.value,b))) ops.delete(id);
          continue;
        }
        if (b === undefined && known === null) continue; // no UI baseline: unseen rows were never deleted here
        const next = b === undefined ? {op:'delete'} : {op:'put',value:b};
        if (previous?.op === next.op && (next.op === 'delete' || equal(previous.value,next.value))) continue;
        ops.set(id,{...next,at:Date.now(),token:token()});
      }
      if (ops.size) state.files[file] = Object.fromEntries(ops); else delete state.files[file];
      const ticket = {file,ops:copy(state.files[file] || {})};
      await persist();
      return ticket;
    });
  }
  function overlay(file, rows, ticket) {
    if (!FILES[file] || !Array.isArray(rows)) return rows;
    const ops = ticket ? ticket.ops : state.files[file] || {};
    if (!Object.keys(ops).length) return rows;
    const existing = new Set(rows.filter(row=>row&&row.id!=null).map(row=>String(row.id)));
    const result = rows.flatMap(row=>{
      const op = row?.id!=null ? ops[String(row.id)] : null;
      return op?.op === 'delete' ? [] : [op?.op === 'put' ? copy(op.value) : row];
    });
    const additions = [];
    for (const [id,op] of Object.entries(ops)) {
      if (op.op === 'put' && !existing.has(id)) additions.push(copy(op.value));
    }
    return [...additions,...result];
  }
  async function acknowledge(ticket) {
    if (!ticket) return;
    await ready;
    return enqueue(async () => {
      advance(ticket.file);
      const file = ticket.file, current = state.files[file];
      if (!current) return;
      for (const [id,op] of Object.entries(ticket.ops)) if (current[id]?.token === op.token) delete current[id];
      if (!Object.keys(current).length) delete state.files[file];
      await persist();
    });
  }
  function observe(file, rows) { if (FILES[file]) baselines.set(file,copy(rows)); }
  root.SyncDrafts = {ready,stage,overlay,acknowledge,observe,status,
    epoch:file=>epochs.get(file)||0,
    snapshot:()=>copy(state),has:file=>!!Object.keys(state.files[file] || {}).length};
})(typeof window !== 'undefined' ? window : globalThis);
