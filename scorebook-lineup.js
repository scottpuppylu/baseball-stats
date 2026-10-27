// Scorebook lineup UI. Names remain in lineup[] for existing statistics consumers;
// position snapshots and changes are additive and never rewrite completed plays.
let setupLineupPositions = [];
let substituteTarget = null;

function lineupText(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

function normalizeLineupPositions(names, positions, hasDh) {
  const allowed = POSITIONS.map(p => p.key).concat(hasDh ? ['DH'] : []);
  const used = new Set();
  return names.map((_, i) => {
    const pos = positions?.[i];
    if (!allowed.includes(pos) || used.has(pos)) return '';
    used.add(pos);
    return pos;
  });
}

function suggestSetupPositions() {
  const assigned = matchPositionsForLineup(setupLineupList.map(name => ({name})), isDhEnabled,
    isDhEnabled ? setupLineupList[(customDhSlot || 4) - 1] : null);
  setupLineupPositions = setupLineupList.map(name => assigned[name]?.posKey || '');
}

function prepareSetupPositions() {
  if (!setupLineupPositions.length) suggestSetupPositions();
  setupLineupPositions = normalizeLineupPositions(setupLineupList, setupLineupPositions, isDhEnabled);
  const missing = POSITIONS.map(p => p.key).concat(isDhEnabled ? ['DH'] : []).filter(p => !setupLineupPositions.includes(p));
  setupLineupPositions = setupLineupPositions.map(p => p || missing.shift() || '');
}

function swapLineupPosition(positions, index, position) {
  const other = position ? positions.indexOf(position) : -1;
  if (other >= 0 && other !== index) positions[other] = positions[index] || '';
  positions[index] = position;
}

function lineupPositionSelect(index, position, live, hasDh) {
  const short = {P:'投手', C:'捕手', '1B':'一壘', '2B':'二壘', '3B':'三壘', SS:'游擊', LF:'左外', SF:'自由', RC:'右中', RF:'右外', DH:'指打'};
  return `<select class="lineup-position" aria-label="第 ${index + 1} 棒守位" onchange="${live ? 'changeLiveLineupPosition' : 'changeSetupLineupPosition'}(${index}, this.value)">
    <option value="">未指定</option>${POSITIONS.concat(hasDh ? [{key:'DH', label:'指定打擊 (DH)'}] : []).map(p =>
      `<option value="${p.key}" ${p.key === position ? 'selected' : ''}>${p.key} ${short[p.key]}</option>`).join('')}</select>`;
}

function changeSetupLineupPosition(index, position) {
  if (!Number.isInteger(index) || index < 0 || index >= setupLineupList.length) return;
  if (position && !POSITIONS.some(p => p.key === position) && !(isDhEnabled && position === 'DH')) return;
  swapLineupPosition(setupLineupPositions, index, position);
  // Render without re-suggesting deliberately unassigned positions.
  renderSetupLineupGrid(false);
}

function lineupFieldMarkup(names, positions, externalPitcher = '') {
  const points = {LF:[76,149], SF:[150,82], RC:[250,82], RF:[324,149], SS:[142,210], '2B':[258,210], '3B':[76,280], '1B':[324,280], P:[200,284], C:[200,371]};
  return `<svg viewBox="0 0 400 410" role="img" aria-label="即時球場守位圖" class="lineup-field">${FIELD_BASE_SVG}
    ${POSITIONS.map(({key}) => {
      const idx = positions.indexOf(key);
      const name = key === 'P' && externalPitcher ? externalPitcher : idx >= 0 ? names[idx] : '';
      const [x,y] = points[key];
      const label = name ? `${idx >= 0 && !(key === 'P' && externalPitcher) ? `${idx + 1}棒 ` : ''}${name}` : '未指定';
      const heading = `${key}${idx >= 0 && !(key === 'P' && externalPitcher) ? ` · ${idx + 1}棒` : ''}`;
      const displayName = name || '未指定';
      return `<g data-position="${key}" transform="translate(${x},${y})"><title>${key} ${lineupText(label)}</title>
        <rect x="-44" y="-25" width="88" height="47" rx="9" fill="#0f172a" stroke="${name ? '#34d399' : '#64748b'}" stroke-width="1.5"/>
        <text y="-8" text-anchor="middle" fill="#6ee7b7" font-size="12" font-weight="800">${heading}</text>
        <text y="12" text-anchor="middle" fill="#f8fafc" font-size="17" textLength="${Math.min(80, Math.max(24, displayName.length * 17))}" lengthAdjust="spacingAndGlyphs">${lineupText(displayName)}</text></g>`;
    }).join('')}</svg>${positions.includes('DH') ? `<p class="lineup-field-note">DH · 第 ${positions.indexOf('DH') + 1} 棒 ${lineupText(names[positions.indexOf('DH')])}（不列入場上守位）</p>` : ''}`;
}

function renderSetupField() {
  const field = document.getElementById('setupLineupField');
  if (field) field.innerHTML = lineupFieldMarkup(setupLineupList, setupLineupPositions);
}

function getGameLineupPositions() {
  // Rendering old records is read-only: migrate only on an explicit edit.
  const positions = Array.isArray(activeGame.lineupPositions) ? activeGame.lineupPositions :
    activeGame.lineup.map((name, i) => name === activeGame.pitcherName ? 'P' :
      activeGame.hasDh && i + 1 === activeGame.dhSlot ? 'DH' : '');
  return normalizeLineupPositions(activeGame.lineup, positions, activeGame.hasDh);
}

function ensureGameLineupPositions() {
  if (typeof window !== 'undefined' && window.__gameFinalizing) return;
  if (activeGame) activeGame.lineupPositions = getGameLineupPositions();
}

function gameDefenseSnapshot() {
  ensureGameLineupPositions();
  return {lineup: [...activeGame.lineup], positions: [...activeGame.lineupPositions], pitcherName: activeGame.pitcherName || null};
}

function saveLineupDefenseChange(before, reason) {
  if (typeof window !== 'undefined' && window.__gameFinalizing) return;
  activeGame.dhSlot = activeGame.hasDh && activeGame.lineupPositions.includes('DH') ? activeGame.lineupPositions.indexOf('DH') + 1 : null;
  const after = gameDefenseSnapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    activeGame.positionChanges = activeGame.positionChanges || [];
    activeGame.positionChanges.push({inning:activeGame.currentInning, half:activeGame.currentHalf, timestamp:Date.now(), reason, before, after});
  }
}

function alignLineupPitcher(name) {
  if (typeof window !== 'undefined' && window.__gameFinalizing) return;
  ensureGameLineupPositions();
  const index = activeGame.lineup.indexOf(name);
  if (index >= 0) swapLineupPosition(activeGame.lineupPositions, index, 'P');
  else activeGame.lineupPositions = activeGame.lineupPositions.map(p => p === 'P' ? '' : p);
  activeGame.pitcherName = name || null;
}

function changeLiveLineupPosition(index, position) {
  if (typeof window !== 'undefined' && window.__gameFinalizing) return;
  if (!activeGame || !Number.isInteger(index) || index < 0 || index >= activeGame.lineup.length) return;
  if (position && !POSITIONS.some(p => p.key === position) && !(activeGame.hasDh && position === 'DH')) return;
  const before = gameDefenseSnapshot();
  swapLineupPosition(activeGame.lineupPositions, index, position);
  const pitcherIndex = activeGame.lineupPositions.indexOf('P');
  activeGame.pitcherName = pitcherIndex >= 0 ? activeGame.lineup[pitcherIndex] :
    activeGame.lineup.includes(activeGame.pitcherName) ? null : activeGame.pitcherName;
  saveLineupDefenseChange(before, '守位調整');
  localStorage.setItem('rebas_active_game', JSON.stringify(activeGame));
  renderLiveScorer();
}

function renderLiveLineupCard() {
  const container = document.getElementById('liveLineupRows');
  if (!container || !activeGame) return;
  const disclosure = document.getElementById('liveLineupCard');
  if (!disclosure.dataset.disclosureReady) {
    // This is a display preference, never part of a scorebook or its cloud data.
    try { disclosure.open = sessionStorage.getItem('rebas_live_lineup_expanded') === 'true'; } catch (_) { /* use collapsed default */ }
    disclosure.addEventListener('toggle', () => {
      try { sessionStorage.setItem('rebas_live_lineup_expanded', String(disclosure.open)); } catch (_) { /* optional UI preference */ }
      if (disclosure.open) renderLiveLineupCard();
    });
    disclosure.dataset.disclosureReady = 'true';
  }
  const positions = getGameLineupPositions();
  const batting = isInningOurBat(activeGame.ourRole, activeGame.currentHalf) && activeGame.currentOuts < 3;
  const idx = activeGame.currentBatterIdx;
  const previousScroll = container.scrollTop;
  const changedBatter = container.dataset.batter !== `${activeGame.id}:${idx}`;
  document.getElementById('liveLineupStatus').textContent = `${batting ? '正在打擊' : '下次打擊'}：第 ${idx + 1} 棒 ${activeGame.lineup[idx] || ''}`;
  container.innerHTML = activeGame.lineup.map((name, i) => {
    const current = idx === i;
    const original = activeGame.startingLineup?.[i];
    return `<div class="lineup-row live-lineup-row ${current ? 'lineup-current' : ''}" data-slot="${i + 1}" ${current ? 'aria-current="true"' : ''}>
      <div class="lineup-order"><strong>${i + 1}</strong><span>棒</span></div>
      ${renderAvatarElement(name, 'lineup-avatar')}
      <div class="lineup-player"><strong>${lineupText(name)}</strong><small>#${lineupText(NAME_TO_JERSEY[name] ?? '—')} ${current ? (batting ? ' · 正在打擊' : ' · 下次打擊') : ''}</small>
      ${original && original !== name ? `<small>先發：${lineupText(original)}</small>` : ''}</div>
      ${lineupPositionSelect(i, positions[i], true, activeGame.hasDh)}
      <button type="button" class="lineup-substitute" aria-label="第 ${i + 1} 棒代打換人" onclick="openSubstituteModal(${i})">代打／換人</button>
    </div>`;
  }).join('');
  container.scrollTop = previousScroll;
  if (changedBatter && container.clientHeight > 0) {
    const row = container.querySelector('.lineup-current');
    if (row) container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - 3;
  }
  if (container.clientHeight > 0) container.dataset.batter = `${activeGame.id}:${idx}`;
  else delete container.dataset.batter;
  const external = activeGame.pitcherName && !activeGame.lineup.includes(activeGame.pitcherName) ? activeGame.pitcherName : '';
  document.getElementById('liveLineupField').innerHTML = lineupFieldMarkup(activeGame.lineup, positions, external);
}
