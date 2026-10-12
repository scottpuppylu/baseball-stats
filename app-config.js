// Public runtime settings for the website, PWA and Android app. Nothing secret belongs here.
// apiBase: the secure data API (cloud-api/ deployed on Vercel), e.g. 'https://baseball-stats-api.vercel.app'.
//   Empty = the API is not set up yet: everyone can read the public statistics, and cloud writes report clearly that
//   they are not enabled (local copies are kept). See docs/MOBILE_APP.md → 安全寫入 API.
// serviceWorker: false removes the PWA offline cache from every visitor on their next visit (rollback switch).
window.BASEBALL_APP_CONFIG = Object.assign({
  apiBase: '',
  serviceWorker: true
}, window.BASEBALL_APP_CONFIG || {});
