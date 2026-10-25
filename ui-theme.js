// ui-theme.js — touch feedback and chart typography for the "Flight" visual system (ui-theme.css).
// Presentation only: never changes data, handlers or what a button does. Safe to remove with the stylesheet.
(function () {
  'use strict';
  const root = document.documentElement;
  if (!root.classList.contains('ui-flight')) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PRESSABLE = 'button, [role="button"], a.inline-flex, label.cursor-pointer';

  // Light-catch ripple from the touch point, clipped to the control's own shape.
  function ripple(el, event) {
    if (reduceMotion.matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 18) return;
    // Leaves nothing behind: the layer and any inline position are removed when the last ripple ends.
    if (getComputedStyle(el).position === 'static') { el.style.position = 'relative'; el.dataset.uiPressPos = '1'; }
    let layer = el.querySelector(':scope > .ui-press-layer');
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'ui-press-layer';
      layer.setAttribute('aria-hidden', 'true');
      el.appendChild(layer);
    }
    const dot = document.createElement('span');
    dot.className = 'ui-press-ripple';
    const x = (event.clientX || rect.left + rect.width / 2) - rect.left;
    const y = (event.clientY || rect.top + rect.height / 2) - rect.top;
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.setProperty('--fl-ripple-scale', String(Math.ceil(Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) / 6)));
    layer.appendChild(dot);
    dot.addEventListener('animationend', () => {
      dot.remove();
      if (layer.childElementCount) return;
      layer.remove();
      if (el.dataset.uiPressPos) { el.style.removeProperty('position'); if (!el.getAttribute('style')) el.removeAttribute('style'); delete el.dataset.uiPressPos; }
    }, {once: true});
  }

  document.addEventListener('pointerdown', event => {
    if (event.button > 0) return;
    const el = event.target.closest && event.target.closest(PRESSABLE);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    el.classList.add('ui-pressed');
    ripple(el, event);
    // A short tick where the browser supports it (Android). iOS Safari ignores vibrate.
    if (event.pointerType === 'touch' && navigator.vibrate && !reduceMotion.matches) { try { navigator.vibrate(6); } catch (e) { /* not allowed */ } }
  }, {passive: true});
  const release = () => document.querySelectorAll('.ui-pressed').forEach(el => el.classList.remove('ui-pressed'));
  ['pointerup', 'pointercancel', 'dragstart'].forEach(type => document.addEventListener(type, release, {passive: true}));
  window.addEventListener('blur', release);
  // Keyboard presses get the same compression.
  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches && event.target.matches(PRESSABLE)) event.target.classList.add('ui-pressed');
  });
  document.addEventListener('keyup', release);

  // Charts follow the same type and quiet grid.
  if (window.Chart && Chart.defaults) {
    const css = getComputedStyle(root);
    Chart.defaults.font.family = css.getPropertyValue('--fl-font').trim() || Chart.defaults.font.family;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css.getPropertyValue('--fl-ink-2').trim() || '#b4bcc8';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
    if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
      Object.assign(Chart.defaults.plugins.tooltip, {backgroundColor: 'rgba(22, 25, 31, 0.94)', borderColor: 'rgba(255, 255, 255, 0.14)', borderWidth: 1, padding: 10, cornerRadius: 12, titleColor: '#e8ebf0', bodyColor: '#d2d8e0'});
    }
  }
})();
