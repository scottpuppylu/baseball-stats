// WebKit reports a page script whose load a reload cancels as a page error (WO-05B7R1, moved here in WO-05B7R2):
// NetworkError "Load failed" with no stack. Seen for lineup-model.js, which the lineup recommender's background worker
// imports a moment after each data load, so a reload can land while that import is in flight (2e494ba and later).
// Right before it comes either
//   (a) the log "Cannot load http://127.0.0.1:<port>/<file>.js?… due to access control checks.", or
//   (b) a failed request for that .js file with errorText "Load request cancelled".
// Only that error is ignored: WebKit only, name NetworkError, message exactly "Load failed", no stack, and (a) or (b)
// from this preview, for a .js file, within 200 ms before it. Each one ignored is printed with its signal. Anything else
// (a page Error, a NetworkError with a stack, one without (a) or (b)) still reaches the test's errors.

// Each returns the .js file of a cancel signal from `origin`, else null.
const cancelLog = (origin, text) => {
  const match = /^Cannot load (https?:\/\/[^/\s]+)\/([^?\s]+\.js)(?:\?\S*)? due to access control checks\.$/.exec(text);
  return match && match[1] === origin ? match[2] : null;
};
const cancelRequest = (origin, address, errorText) => {
  const where = new URL(address);
  return where.origin === origin && where.pathname.endsWith('.js') && errorText === 'Load request cancelled' ? where.pathname.slice(1) : null;
};
const ignoreCancelledScript = (engine, e, last, now) => engine === 'webkit' && e.name === 'NetworkError' && e.message === 'Load failed'
  && !e.stack && Boolean(last) && now - last.at >= 0 && now - last.at <= 200;

// Watches `page` for (a) and (b); returns e => true when this page error is a cancelled script load to ignore.
// `engine` is Playwright's browser type name ('webkit', 'chromium'); `url` is the preview the page loads.
function watchCancelledScripts(page, engine, url, print = console.log) {
  const origin = new URL(url).origin;
  let last = null;
  page.on('console', message => { const file = cancelLog(origin, message.text()); if (file) last = {file, at: Date.now(), via: 'a console'}; });
  page.on('requestfailed', request => { const file = cancelRequest(origin, request.url(), request.failure()?.errorText); if (file) last = {file, at: Date.now(), via: 'b requestfailed'}; });
  return e => {
    const now = Date.now();
    if (!ignoreCancelledScript(engine, e, last, now)) return false;
    print(`webkit: ignored cancelled script load ${last.file} (${last.via}, ${now - last.at} ms before the error)`);
    last = null;
    return true;
  };
}

module.exports = {cancelLog, cancelRequest, ignoreCancelledScript, watchCancelledScripts};
