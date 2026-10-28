// page-rendering.js — renders only what changed, and builds charts when they come into view.
// Presentation only: it never reads or writes team data or storage.
//   run(key, signature, render)  skips a page render when neither the data revision nor the page's own state changed
//   chart(previous, canvas, config, assign)  reuses a Chart.js instance, or defers its creation until it is on screen
//   defer(element, render)  same deferral for a non-chart block
//   withDeferredCharts(draw)  charts created inside draw() are deferred (page renders use this; other callers are not)
//   cachedPanel(panel, active, render)  keeps a module page's markup aside while hidden and restores it if still current
(function(root) {
  'use strict';
  let revision = 0;          // bumped whenever team data or filters change
  let dataSignature = null;  // last data signature seen by syncData()
  let deferring = false;     // true while a page render runs inside withDeferredCharts()
  let pumping = null;        // the running chart queue, if any
  const pages = new Map();   // page key -> "revision|signature" of its last render
  const panels = new WeakMap();
  const pending = new Map(); // canvas or element -> deferred job
  const work = [];           // deferred jobs that are on screen, in order
  const stats = {pageBuilds: 0, chartCreates: 0, chartUpdates: 0};

  // Avatars are large data URLs: track them with a small revision instead of including them in a signature.
  const avatars = new Map();
  let avatarRevision = 0;
  function avatarVersion(values) {
    let changed = avatars.size !== Object.keys(values).length;
    for (const [key, value] of Object.entries(values)) {
      if (avatars.get(key) !== value) { avatars.set(key, value); changed = true; }
    }
    for (const key of avatars.keys()) {
      if (!Object.hasOwn(values, key)) { avatars.delete(key); changed = true; }
    }
    if (changed) avatarRevision++;
    return avatarRevision;
  }

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const yieldToBrowser = () => root.scheduler?.yield?.() || new Promise(resolve => setTimeout(resolve, 0));
  const scrolling = () => document.documentElement.hasAttribute('data-fl-scrolling');

  function invalidate() {
    revision++;
    for (const job of pending.values()) cancel(job);
    work.length = 0;
  }
  function syncData(signature) {
    if (signature === dataSignature) return;
    dataSignature = signature;
    invalidate();
  }

  function run(key, signature, render) {
    const read = typeof signature === 'function' ? signature : () => signature;
    if (pages.get(key) === `${revision}|${read()}`) return false;
    render();
    pages.set(key, `${revision}|${read()}`); // read again: rendering may settle the page's own state (e.g. a default selection)
    stats.pageBuilds++;
    return true;
  }

  function withDeferredCharts(draw) {
    const outer = deferring;
    deferring = true;
    try { return draw(); } finally { deferring = outer; }
  }

  function cachedPanel(panel, active, render) {
    const entry = panels.get(panel);
    if (!active) {
      if (!panel.firstChild) return;
      const kept = entry || {revision: -1, fragment: document.createDocumentFragment()};
      while (panel.firstChild) kept.fragment.appendChild(panel.firstChild);
      panels.set(panel, kept);
      return;
    }
    if (entry && entry.revision === revision) {
      if (entry.fragment.firstChild) panel.appendChild(entry.fragment);
      return;
    }
    panel.replaceChildren();
    render(panel);
    stats.pageBuilds++;
    panels.set(panel, {revision, fragment: document.createDocumentFragment()});
  }

  function cancel(job) {
    job.cancelled = true;
    job.observer?.disconnect();
    job.cleanup?.();
    if (pending.get(job.target) === job) pending.delete(job.target);
  }

  // Same canvas and chart type: update in place (no destroy/create, no layout read). Otherwise a new chart.
  function create(previous, canvas, config) {
    if (previous && previous.canvas === canvas && previous.config.type === config.type) {
      previous.stop();
      previous.setActiveElements([]);
      previous.tooltip?.setActiveElements([], {x: 0, y: 0});
      previous.data = config.data;
      previous.options = config.options || {};
      previous.update('none');
      stats.chartUpdates++;
      return previous;
    }
    previous?.destroy();
    stats.chartCreates++;
    return new Chart(canvas, config);
  }

  // Deferred jobs run one per frame, never while the page is scrolling, and only while their page is shown.
  function pump() {
    if (pumping) return;
    pumping = (async () => {
      while (work.length) {
        await nextFrame();
        await yieldToBrowser();
        if (scrolling()) { await new Promise(resolve => setTimeout(resolve, 32)); continue; }
        const job = work.shift();
        if (job.cancelled) continue;
        if (!job.target.isConnected) { cancel(job); continue; }
        if (job.target.closest('[id^="panel"]')?.classList.contains('hidden')) {
          job.queued = false;
          job.observer?.observe(job.target); // back to waiting until the page is shown again
          continue;
        }
        cancel(job);
        job.draw();
      }
    })().catch(error => console.error('[page-rendering]', error)).finally(() => {
      pumping = null;
      if (work.length) pump();
    });
  }

  function schedule(target, job) {
    if (pending.has(target)) cancel(pending.get(target));
    Object.assign(job, {target, cancelled: false, queued: false});
    pending.set(target, job);
    job.observer = new IntersectionObserver(entries => {
      if (job.cancelled || job.queued || !entries.some(entry => entry.isIntersecting)) return;
      job.queued = true;
      job.observer.disconnect();
      work.push(job);
      pump();
    }, {rootMargin: '240px'});
    job.observer.observe(target);
  }

  function chart(previous, target, config, assign) {
    const canvas = typeof target === 'string' ? document.getElementById(target) : target?.canvas || target;
    if (!canvas) return null;
    if (pending.has(canvas)) cancel(pending.get(canvas));
    // The frame (CSS .ui-chart-frame) gives the chart its size, so Chart.js never has to measure the page.
    config.options = {...config.options, maintainAspectRatio: false};
    if (root.matchMedia('(pointer: coarse)').matches) config.options.animation = false;
    canvas.parentElement?.classList.add('ui-chart-frame');
    canvas.closest('section')?.classList.add('ui-render-section');
    if (!deferring || !root.IntersectionObserver) return create(previous, canvas, config);

    if (previous && (previous.canvas !== canvas || previous.config.type !== config.type)) { previous.destroy(); previous = null; }
    canvas.setAttribute('aria-busy', 'true');
    canvas.parentElement?.classList.add('ui-chart-pending');
    schedule(canvas, {
      draw: () => assign(create(previous, canvas, config)),
      cleanup: () => { canvas.removeAttribute('aria-busy'); canvas.parentElement?.classList.remove('ui-chart-pending'); }
    });
    return previous;
  }

  function defer(element, render) {
    if (!element || !deferring || !root.IntersectionObserver) { render(); return; }
    element.closest('section')?.classList.add('ui-render-section');
    schedule(element, {draw: render});
  }

  // Resolves once every on-screen deferred job has run (tests and measurements wait on this).
  async function settled() {
    await nextFrame();
    await nextFrame();
    while (pumping) await pumping;
  }

  root.PageRendering = {invalidate, syncData, avatarVersion, run, withDeferredCharts, cachedPanel, chart, defer, stats, settled,
    revision: () => revision};
})(window);
