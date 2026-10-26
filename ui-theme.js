// ui-theme.js — touch feedback and chart typography for the "Flight" visual system (ui-theme.css).
// Presentation only: never changes data, handlers or what a button does. Safe to remove with the stylesheet.
(function () {
  'use strict';
  const root = document.documentElement;
  if (!root.classList.contains('ui-flight')) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Everything a finger can press: buttons, links styled as buttons, clickable cards and rows, chips, summaries, selects.
  const PRESSABLE = 'button, [role="button"], a.inline-flex, label.cursor-pointer, [onclick], .cursor-pointer, summary, select, [data-player], [data-game], [data-health-name], tr[onclick]';

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
  // The cloud status, version and builder credit live in the tools panel (ui-app.js).

  // ---------- Motion: pages, panels, dialogs, drawers and selected states ----------
  // Web Animations only: nothing is left in the DOM or in inline styles afterwards. Page content fades in from a soft
  // blur (opacity/filter do not move layout, so taps and measurements land where the user sees them).
  const EASE = 'cubic-bezier(.2, .8, .2, 1)';
  const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';
  const motionOk = () => !reduceMotion.matches && document.visibilityState === 'visible';
  const play = (el, frames, options) => { try { el.animate(frames, {fill: 'none', ...options}); } catch (e) { /* not supported */ } };
  function revealPage(panel) {
    play(panel, [{opacity: 0, transform: 'translateY(10px)'}, {opacity: 1, transform: 'none'}], {duration: 380, easing: EASE});
    // The page's own sections follow one after another, like an Apple app settling in.
    [...panel.children].filter(el => el.offsetHeight > 0).slice(0, 8).forEach((child, i) => {
      play(child, [{opacity: 0}, {opacity: 1}], {duration: 420, delay: 50 + i * 45, easing: EASE, fill: 'backwards'});
    });
  }
  function revealBlock(el) { play(el, [{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 300, easing: EASE}); }
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

  // ---------- Refraction for every glass surface (Chromium) ----------
  // Liquid glass: the whole surface is a lens (a gentle bulge, strongest bend at the rim) and what lies behind is set out of
  // focus like a shallow depth of field, instead of frosted. Each glass element
  // gets a displacement map shaped like a lens for its own size and corner radius (strongest at the rim, flat in the
  // middle), used as an SVG filter in its backdrop-filter, so content passing underneath is bent live at the edges with
  // a slight colour fringe (red/green/blue displaced by different amounts). Maps are cached by size, built when an
  // element appears or resizes, and set as an inline style, so nothing else in the page changes. Safari and Firefox do
  // not render SVG backdrop filters; they keep the clear glass from ui-theme.css (a touch of blur only). Off for
  // "increase contrast" and "reduce motion" users. ui-app.js registers the pieces it creates via window.flRefract().
  const chromium = Boolean(navigator.userAgentData && navigator.userAgentData.brands && navigator.userAgentData.brands.some(b => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand)));
  const contrastQuery = window.matchMedia('(prefers-contrast: more)');
  const NS = 'http://www.w3.org/2000/svg';
  let lensSvg = null;
  const lensCache = new Map(); // key -> Promise<filter id>
  const lensEnabled = () => chromium && !contrastQuery.matches && !reduceMotion.matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)'); // content-panel lenses: mouse devices only
  const channel = k => [0, 1, 2].map(row => [0, 1, 2, 3, 4].map(col => (row === k && col === k ? 1 : 0)).join(' ')).join(' ') + ' 0 0 0 1 0';
  function lensMap(w, h, r, bezel) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + .5 - cx, py = y + .5 - cy;
        const qx = Math.abs(px) - (cx - r), qy = Math.abs(py) - (cy - r);
        let dist, nx = 0, ny = 0;
        if (qx > 0 && qy > 0) { const len = Math.hypot(qx, qy) || 1; dist = r - len; nx = Math.sign(px) * qx / len; ny = Math.sign(py) * qy / len; }
        else if (qx > qy) { dist = cx - Math.abs(px); nx = Math.sign(px); }
        else { dist = cy - Math.abs(py); ny = Math.sign(py); }
        const t = Math.max(0, Math.min(1, 1 - dist / bezel));
        const m = t * t * (3 - 2 * t); // smooth rim curve
        // The whole surface is curved, not only the rim: a gentle magnifying bulge (sample toward the centre, more so
        // further out), with the rim bending hardest.
        const u = px / cx, v = py / cy, bulge = .32 * Math.min(1, Math.hypot(u, v));
        const dx = Math.max(-1, Math.min(1, u * bulge + nx * m)), dy = Math.max(-1, Math.min(1, v * bulge + ny * m));
        const i = (y * w + x) * 4;
        img.data[i] = 128 - dx * 127;
        img.data[i + 1] = 128 - dy * 127;
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  function lensFilter(w, h, r, bezel, defocus) {
    const key = `${w}x${h}r${r}b${bezel}d${defocus}`;
    if (!lensCache.has(key)) {
      lensCache.set(key, lensMap(w, h, r, bezel).then(blob => {
        if (!blob) return '';
        if (!lensSvg) {
          lensSvg = document.createElementNS(NS, 'svg');
          lensSvg.setAttribute('aria-hidden', 'true');
          lensSvg.setAttribute('width', '0');
          lensSvg.setAttribute('height', '0');
          lensSvg.setAttribute('style', 'position:absolute');
          document.body.append(lensSvg);
        }
        const id = `flLens${lensCache.size}_${w}x${h}`;
        const filter = document.createElementNS(NS, 'filter');
        filter.id = id;
        for (const [a, v] of [['filterUnits', 'userSpaceOnUse'], ['color-interpolation-filters', 'sRGB'], ['x', '0'], ['y', '0'], ['width', w], ['height', h]]) filter.setAttribute(a, String(v));
        // Depth of field rather than frost: a clean defocus that keeps colour and contrast (no milky haze).
        const scale = Math.round(Math.min(44, Math.max(bezel * 1.2, Math.min(w, h) * .2)));
        filter.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="${defocus}" result="s"/>`
          + `<feImage href="${URL.createObjectURL(blob)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>`
          + ['r', 'g', 'b'].map((c, k) => `<feDisplacementMap in="s" in2="m" scale="${scale + k * 2}" xChannelSelector="R" yChannelSelector="G" result="d${c}"/><feColorMatrix in="d${c}" type="matrix" values="${channel(k)}" result="${c}"/>`).join('')
          + '<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>';
        lensSvg.append(filter);
        return id;
      }));
    }
    return lensCache.get(key);
  }
  const tracked = new Map(); // element -> last size key
  const clearLens = el => { el.style.removeProperty('backdrop-filter'); el.style.removeProperty('-webkit-backdrop-filter'); el.classList.remove('fl-lens-on'); };
  async function applyLens(el) {
    if (!lensEnabled()) { clearLens(el); tracked.set(el, ''); return; }
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (w < 24 || h < 24) return; // hidden or tiny: wait for the next resize
    // Content panels only refract on pages with a space scene (CSS sets --fl-lens-gate there); very large panels keep
    // the depth-of-field glass without a lens, so scrolling stays smooth on phones.
    const gated = el.dataset.flGated !== undefined;
    if (gated && (!finePointer.matches || getComputedStyle(el).getPropertyValue('--fl-lens-gate').trim() !== '1' || w * h > 650000 || h > 1500)) {
      clearLens(el); tracked.set(el, ''); return;
    }
    const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2);
    const bezel = Math.round(Math.max(8, Math.min(18, Math.min(w, h) * .32)));
    const defocus = parseFloat(getComputedStyle(el).getPropertyValue('--fl-lens-defocus')) || 3;
    const key = `${w}x${h}r${Math.round(radius)}b${bezel}d${defocus}`;
    if (tracked.get(el) === key) return;
    tracked.set(el, key);
    const id = await lensFilter(w, h, Math.round(radius), bezel, defocus);
    if (!id || tracked.get(el) !== key) return;
    // Each surface can dim what lies behind it (no blur): --fl-lens-tone in ui-theme.css.
    const tone = getComputedStyle(el).getPropertyValue('--fl-lens-tone').trim() || 'saturate(165%) brightness(.94)';
    const value = `url(#${id}) ${tone}`;
    el.style.setProperty('backdrop-filter', value, 'important');
    el.style.setProperty('-webkit-backdrop-filter', value, 'important');
    el.classList.add('fl-lens-on');
  }
  let lensObserver = null;
  const queued = new Set();
  window.flRefract = (el, gated = false) => {
    if (!el || tracked.has(el) || !chromium) return;
    if (gated) el.dataset.flGated = '';
    tracked.set(el, '');
    if (!lensObserver) {
      lensObserver = new ResizeObserver(entries => {
        entries.forEach(e => queued.add(e.target));
        requestAnimationFrame(() => { queued.forEach(applyLens); queued.clear(); });
      });
    }
    lensObserver.observe(el);
  };
  if (chromium) {
    root.classList.add('fl-refract');
    ['.ui-mobile-nav', '#mainNavigation', '#appHeader', '.fl-subnav', '.ui-section-bar'].forEach(sel => window.flRefract(document.querySelector(sel)));
    [contrastQuery, reduceMotion].forEach(q => q.addEventListener('change', () => { tracked.forEach((v, el) => { if (!el.isConnected) { tracked.delete(el); return; } tracked.set(el, 'stale'); applyLens(el); }); }));
  }

  // Charts follow the same type and quiet grid.
  if (window.Chart && Chart.defaults) {
    const css = getComputedStyle(root);
    Chart.defaults.font.family = css.getPropertyValue('--fl-font').trim().replace(/\s+/g, ' ') || Chart.defaults.font.family;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css.getPropertyValue('--fl-ink-2').trim() || '#b4bcc8';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
    // Shorter chart animations on touch devices keep page switches smooth on phones.
    if (window.matchMedia('(pointer: coarse)').matches && Chart.defaults.animation) Chart.defaults.animation.duration = 420;
    if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
      Object.assign(Chart.defaults.plugins.tooltip, {backgroundColor: 'rgba(22, 25, 31, 0.94)', borderColor: 'rgba(255, 255, 255, 0.14)', borderWidth: 1, padding: 10, cornerRadius: 12, titleColor: '#e8ebf0', bodyColor: '#d2d8e0'});
    }
  }
})();
