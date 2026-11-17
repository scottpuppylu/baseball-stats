// scorebook-v2-haptics.js — 新版場記的觸覺回饋（WO-05 B2，PO-40／B_PHASE_ORDERS §0b）。
// 只在旗標開時載入，只服務 v2 場記；不碰比賽資料。
//
// 六種回饋（震動節奏是 Android navigator.vibrate 的毫秒參數；不套 1.75×，因為是訊號長度不是動畫）：
//   select ① 選取（按下會開 sheet 的結果鍵）      10
//   record ② 一般記錄成功                          40
//   out    ③ 出局記錄成功                          [40, 70, 40]
//   inning ④ 三出局、換局、直接換局                [40, 70, 40, 70, 40]
//   undo   ⑤ 復原                                  120
//   error  ⑥ 無效／錯誤                            [20, 40, 20, 40, 20]
//
// iPhone 沒有 navigator.vibrate。唯一的做法是把透明的 <label>＋<input type="checkbox" switch> 疊在按鈕上，
// 讓使用者真正的手指點在 switch 上（系統給一下輕觸），再把點擊轉給下面的按鈕。只能輕觸一下、不分種類、不保證有效，
// 要實機驗證（AC-FB-3）；沒驗證前畫面只寫「iPhone 只有輕觸一下，不分種類」。
(function () {
  'use strict';
  const KEY = 'rebas_ui_v2_haptics'; // '0' = 關；沒有值 = 開（預設開）
  const PATTERNS = Object.freeze({
    select: 10,
    record: 40,
    out: Object.freeze([40, 70, 40]),
    inning: Object.freeze([40, 70, 40, 70, 40]),
    undo: 120,
    error: Object.freeze([20, 40, 20, 40, 20])
  });
  const nav = window.navigator;
  const hasVibrate = typeof nav.vibrate === 'function';
  const isIOS = /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const switchProbe = document.createElement('input');
  switchProbe.type = 'checkbox';
  switchProbe.setAttribute('switch', '');
  // Safari 17.4 起認得 switch 屬性（反映成 .switch 屬性）；舊版就當作不支援。
  const iosSwitch = !hasVibrate && isIOS && 'switch' in switchProbe;
  const mode = hasVibrate ? 'vibrate' : iosSwitch ? 'ios-switch' : 'none';

  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== '0'; } catch (error) { /* 私密模式：預設開 */ }

  function fire(kind) {
    const pattern = PATTERNS[kind];
    if (pattern === undefined || !enabled || mode !== 'vibrate') return false;
    try { return nav.vibrate(Array.isArray(pattern) ? pattern.slice() : pattern); } catch (error) { return false; }
  }

  function setEnabled(next) {
    enabled = !!next;
    try { if (enabled) localStorage.removeItem(KEY); else localStorage.setItem(KEY, '0'); } catch (error) { /* 只在本次有效 */ }
    document.querySelectorAll('[data-v2-hap-overlay]').forEach(el => { el.hidden = !enabled; });
    return enabled;
  }

  // 說明文字：放在 ⋯ 選單的開關旁邊。
  function note() {
    if (mode === 'none') return '此裝置不支援震動';
    if (mode === 'ios-switch') return 'iPhone 只有輕觸一下，不分種類';
    return '';
  }

  // iPhone 疊層：只在 ios-switch 模式加。overlay 是按鈕的兄弟元素（按鈕裡面不能放互動元素），
  // aria-hidden＋tabindex=-1，讓 VoiceOver 和鍵盤只看到真正的按鈕。停用的按鈕不加（避免「震了但沒記」）。
  // 疊層對齊按鈕：用 offset 座標（不看 transform），父元素若是 static 就設成 relative。
  function place(label, button) {
    const parent = button.offsetParent;
    if (parent && parent !== label.offsetParent) return;
    label.style.left = `${button.offsetLeft}px`;
    label.style.top = `${button.offsetTop}px`;
    label.style.width = `${button.offsetWidth}px`;
    label.style.height = `${button.offsetHeight}px`;
  }
  function attach(root) {
    if (mode !== 'ios-switch' || !root) return;
    root.querySelectorAll('[data-v2-hap]').forEach(button => {
      const next = button.nextElementSibling;
      if (next && next.hasAttribute('data-v2-hap-overlay')) return;
      // 停用（disabled 或 aria-disabled）的按鈕不加：iPhone 會輕觸一下，但其實沒有記到。
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      const holder = button.parentElement;
      if (holder && getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
      const label = document.createElement('label');
      label.setAttribute('data-v2-hap-overlay', '');
      label.setAttribute('aria-hidden', 'true');
      label.className = 'v2-hap';
      label.hidden = !enabled;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.append(input);
      label.addEventListener('click', event => {
        if (event.target !== input) return; // label 的合成點擊也會到 input，只轉一次
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
        button.click();
      });
      // 手指按在疊層上，按鈕本身收不到 pointerdown；轉一次給按鈕，V1 按下回饋才會出現。
      label.addEventListener('pointerdown', event => {
        button.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, button: event.button, pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY}));
      });
      button.after(label);
      requestAnimationFrame(() => place(label, button));
    });
  }

  window.uiV2Haptics = {
    KEY,
    PATTERNS,
    mode,
    fire,
    attach,
    note,
    get enabled() { return enabled; },
    setEnabled
  };
})();
