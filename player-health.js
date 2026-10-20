// Shared, pure profile validation and batting-side direction rules.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlayerHealth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const BATS = {U:'未設定', R:'右打', L:'左打', S:'左右開弓'};
  function today() { return new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Taipei'}); }
  function validBirthDate(value, now = today()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value && value >= '1900-01-01' && value <= now;
  }
  function normalize(profile = {}, now = today()) {
    function measurement(key, label, min, max) {
      const raw = profile[key];
      if (raw === '' || raw === null || raw === undefined) return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}須介於 ${min}–${max}`);
      return Math.round(n * 10) / 10;
    }
    const birthDate = profile.birthDate || '';
    if (birthDate && !validBirthDate(birthDate, now)) throw new Error('請輸入有效出生日期，且不可晚於今天');
    if (profile.bats && !Object.hasOwn(BATS, profile.bats)) throw new Error('打擊慣用側無效');
    if (profile.throws && !['U','R','L','B'].includes(profile.throws)) throw new Error('傳球慣用手無效');
    return {heightCm:measurement('heightCm','身高（cm）',50,250), weightKg:measurement('weightKg','體重（kg）',10,300),
      bats:profile.bats || 'U', throws:profile.throws || 'U', birthDate};
  }
  function zodiac(date) {
    if (!validBirthDate(date)) return '';
    const n = Number(date.slice(5,7)) * 100 + Number(date.slice(8));
    return [[120,'摩羯座'],[219,'水瓶座'],[321,'雙魚座'],[420,'牡羊座'],[521,'金牛座'],[622,'雙子座'],
      [723,'巨蟹座'],[823,'獅子座'],[923,'處女座'],[1024,'天秤座'],[1123,'天蠍座'],[1222,'射手座'],[1232,'摩羯座']].find(([end]) => n < end)[1];
  }
  function age(date, now = today()) {
    if (!validBirthDate(date, now)) return null;
    return Number(now.slice(0,4)) - Number(date.slice(0,4)) - (now.slice(5) < date.slice(5) ? 1 : 0);
  }
  function battingSide(play, profiles = {}) {
    if (['R','L'].includes(play.battingSide)) return play.battingSide;
    const side = profiles[play.batterName]?.bats;
    return ['R','L'].includes(side) ? side : null;
  }
  function fieldSide(x) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) return null;
    return x < .4 ? 'left' : x <= .6 ? 'center' : 'right';
  }
  function direction(play, profiles) {
    const field = fieldSide(play.x), side = battingSide(play, profiles);
    if (!field || !side) return null;
    if (field === 'center') return 'cent';
    return (field === 'left') === (side === 'R') ? 'pull' : 'oppo';
  }
  function summarize(points, profiles) {
    const out = {pull:0,cent:0,oppo:0,known:0,unknown:0,left:0,center:0,right:0};
    points.forEach(play => {
      const field = fieldSide(play.x); if (field) out[field]++;
      const d = direction(play,profiles);
      if (d) { out[d]++; out.known++; } else out.unknown++;
    });
    return out;
  }
  function sampleText(s) { return `方向已判定 ${s.known} 球／待補打擊側或落點 ${s.unknown} 球；拉／中／推比例只計已判定樣本。`; }
  function tendencyText(s) {
    if (!s.known && !s.unknown) return '尚無擊球落點。';
    if (!s.known) return '尚未設定打擊側，暫不判定拉打／推打；請至「球員健康資料」補填，左右開弓者須補記各打席實際側。';
    return s.pull / s.known > .55 ? '拉打比例較高，可增加中線與反方向練習。守備站位請依實際左／右落點判斷。'
      : s.oppo / s.known > .38 ? '反方向比例較高；拉／推已依各打席打擊側判定。' : '拉／中／推分布較均衡；仍應搭配實際落點與樣本數判讀。';
  }
  function fieldAdvice(s) {
    const n = s.left+s.center+s.right;
    if (!n) return '尚無有效球場落點，維持標準守備。';
    const prefix = `實際落點：左 ${s.left}／中 ${s.center}／右 ${s.right} 球。`;
    return prefix + (s.left/n > .55 ? '落點偏左，守備可向左側調整。' : s.right/n > .55 ? '落點偏右，守備可向右側調整。' : '落點未集中於單一側，維持均衡覆蓋。');
  }
  return {BATS,today,validBirthDate,normalize,zodiac,age,battingSide,fieldSide,direction,summarize,sampleText,tendencyText,fieldAdvice};
});
