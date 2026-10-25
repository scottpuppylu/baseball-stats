// ui-theme.js — touch feedback and chart typography for the "Flight" visual system (ui-theme.css).
// Presentation only: never changes data, handlers or what a button does. Safe to remove with the stylesheet.
(function () {
  'use strict';
  const root = document.documentElement;
  if (!root.classList.contains('ui-flight')) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PRESSABLE = 'button, [role="button"], a.inline-flex, label.cursor-pointer';

  // Light-catch ripple from the touch point. One shared overlay (#flRipple) is placed over the pressed control and
  // animated with Web Animations only, so a press changes nothing in the page afterwards (no classes, styles or nodes).
  const overlay = document.createElement('div');
  overlay.id = 'flRipple';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.append(overlay);
  function ripple(el, event) {
    if (reduceMotion.matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 18) return;
    const x = (event.clientX || rect.left + rect.width / 2) - rect.left;
    const y = (event.clientY || rect.top + rect.height / 2) - rect.top;
    const r = Math.ceil(Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)));
    const box = {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: getComputedStyle(el).borderRadius};
    try {
      overlay.getAnimations({subtree: true}).forEach(a => a.cancel());
      overlay.animate([{...box, opacity: 1}, {...box, opacity: 1, offset: .3}, {...box, opacity: 0}], {duration: 600, easing: 'cubic-bezier(.2, .8, .2, 1)'});
      overlay.animate([{backgroundSize: '8px 8px', backgroundPosition: `${x - 4}px ${y - 4}px`}, {backgroundSize: `${2 * r}px ${2 * r}px`, backgroundPosition: `${x - r}px ${y - r}px`}],
        {duration: 600, easing: 'cubic-bezier(.2, .8, .2, 1)', pseudoElement: '::after'});
    } catch (e) { /* older engines: the press compression still gives feedback */ }
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

  // ---------- Layout placement (moves existing elements; every ID and handler stays with its element) ----------
  // The navigation leaves the header so both can be glass: a backdrop-filter on the header would otherwise become the
  // containing block of the fixed sidebar/drawer inside it.
  const nav = document.getElementById('mainNavigation');
  const header = document.getElementById('appHeader');
  if (nav && header && header.contains(nav)) header.after(nav);
  // Wide screens: the sidebar footer carries the version and builder credit; narrow screens: back in the header brand.
  const brand = document.querySelector('.ui-header-brand');
  if (nav && brand) {
    const foot = document.createElement('div');
    foot.className = 'fl-side-foot';
    nav.append(foot);
    // The cloud status joins them, which also keeps the command bar on one line at laptop widths.
    const moving = [document.getElementById('syncStatusBadge'), ...[...brand.children].filter(el => /^v\d{6}\.\d{4}/.test(el.textContent.trim()) || el.textContent.trim().startsWith('系統建構'))].filter(Boolean);
    const homes = moving.map(el => [el, el.parentElement, el.nextElementSibling]);
    const wide = window.matchMedia('(min-width: 1280px) and (hover: hover) and (pointer: fine)'); // same query as the sidebar layout in ui-theme.css
    const place = () => {
      for (const [el, parent, next] of homes) {
        if (wide.matches) { if (el.parentElement !== foot) foot.append(el); }
        else if (el.parentElement !== parent) { if (next && next.parentElement === parent) parent.insertBefore(el, next); else parent.append(el); }
      }
    };
    place();
    wide.addEventListener('change', place);
  }

  // ---------- Motion: pages, panels, dialogs, drawers and selected states ----------
  // Web Animations only: nothing is left in the DOM or in inline styles afterwards. Page content fades in from a soft
  // blur (opacity/filter do not move layout, so taps and measurements land where the user sees them).
  const EASE = 'cubic-bezier(.2, .8, .2, 1)';
  const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
  const motionOk = () => !reduceMotion.matches && document.visibilityState === 'visible';
  const play = (el, frames, options) => { try { el.animate(frames, {fill: 'none', ...options}); } catch (e) { /* not supported */ } };
  function revealPage(panel) {
    play(panel, [{opacity: 0, filter: 'blur(8px)'}, {opacity: 1, filter: 'blur(0)'}], {duration: 380, easing: EASE});
    // The page's own sections follow one after another, like an Apple app settling in.
    [...panel.children].filter(el => el.offsetHeight > 0).slice(0, 8).forEach((child, i) => {
      play(child, [{opacity: 0}, {opacity: 1}], {duration: 420, delay: 50 + i * 45, easing: EASE, fill: 'backwards'});
    });
  }
  function revealBlock(el) { play(el, [{opacity: 0, filter: 'blur(5px)'}, {opacity: 1, filter: 'blur(0)'}], {duration: 300, easing: EASE}); }
  function revealDialog(dialog) {
    const card = dialog.firstElementChild || dialog;
    play(dialog, [{opacity: 0}, {opacity: 1}], {duration: 220, easing: EASE});
    play(card, [{opacity: 0, transform: 'scale(.94) translateY(12px)'}, {opacity: 1, transform: 'none'}], {duration: 460, easing: SPRING});
  }
  function pop(el) { play(el, [{transform: 'scale(.9)'}, {transform: 'scale(1.03)', offset: .55}, {transform: 'scale(1)'}], {duration: 420, easing: SPRING}); }
  const hasClass = (value, name) => new RegExp(`(^|\\s)${name}(\\s|$)`).test(value || '');
  new MutationObserver(records => {
    if (!motionOk()) return;
    for (const r of records) {
      const el = r.target;
      if (!(el instanceof HTMLElement)) continue;
      if (r.attributeName === 'aria-current') { if (el.getAttribute('aria-current') && el.closest('.ui-mobile-nav, .ui-section-bar')) pop(el); continue; }
      const now = typeof el.className === 'string' ? el.className : '';
      if (hasClass(now, 'tab-active') && !hasClass(r.oldValue, 'tab-active')) { pop(el); continue; }
      if (!hasClass(r.oldValue, 'hidden') || hasClass(now, 'hidden')) continue;
      if (/^panel/.test(el.id)) revealPage(el);
      else if (/Modal$/.test(el.id) || el.matches('.fixed.inset-0')) revealDialog(el);
      else if (el.offsetHeight > 40 && el.closest('#appWorkspace')) revealBlock(el);
    }
  }).observe(document.body, {subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'aria-current']});
  // Dialogs created on demand (form dialog, post-game image, detail sheets).
  new MutationObserver(records => {
    if (!motionOk()) return;
    for (const r of records) for (const node of r.addedNodes) {
      if (node instanceof HTMLElement && (node.id === 'uiFormDialog' || node.id === 'insightImageModal' || node.matches('.fixed.inset-0'))) revealDialog(node);
    }
  }).observe(document.body, {childList: true});
  // Drawer / "更多" sheet slide in with a spring; the desktop sidebar never animates.
  if (nav) {
    let wasOpen = false;
    new MutationObserver(() => {
      const open = document.body.classList.contains('ui-nav-open');
      if (open === wasOpen) return;
      wasOpen = open;
      if (!open || !motionOk() || window.matchMedia('(min-width: 1280px) and (hover: hover) and (pointer: fine)').matches) return;
      const phone = window.innerWidth < 768;
      play(nav, [{opacity: 0, transform: phone ? 'translateY(40px)' : 'translateX(-28px)'}, {opacity: 1, transform: 'none'}], {duration: 460, easing: SPRING});
      [...nav.querySelectorAll(':scope > button')].forEach((b, i) => play(b, [{opacity: 0}, {opacity: 1}], {duration: 300, delay: 60 + i * 22, easing: EASE, fill: 'backwards'}));
    }).observe(document.body, {attributes: true, attributeFilter: ['class']});
  }

  // Charts follow the same type and quiet grid.
  if (window.Chart && Chart.defaults) {
    const css = getComputedStyle(root);
    Chart.defaults.font.family = css.getPropertyValue('--fl-font').trim().replace(/\s+/g, ' ') || Chart.defaults.font.family;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css.getPropertyValue('--fl-ink-2').trim() || '#b4bcc8';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
    if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
      Object.assign(Chart.defaults.plugins.tooltip, {backgroundColor: 'rgba(22, 25, 31, 0.94)', borderColor: 'rgba(255, 255, 255, 0.14)', borderWidth: 1, padding: 10, cornerRadius: 12, titleColor: '#e8ebf0', bodyColor: '#d2d8e0'});
    }
  }
})();
