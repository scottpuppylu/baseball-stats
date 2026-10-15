// Public website/PWA settings. No backend, login configuration or credentials belong in this file.
// serviceWorker: false removes the PWA offline cache from every visitor on their next visit (rollback switch).
window.BASEBALL_APP_CONFIG = Object.assign({
  serviceWorker: true
}, window.BASEBALL_APP_CONFIG || {});
