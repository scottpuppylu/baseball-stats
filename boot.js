// First script on the page: hides the half-built layout until the app shell (ui-app.js) has arranged it, so a reload
// never flashes the old page. A splash (ui-theme.css) shows meanwhile; a timer guarantees the page always appears.
document.documentElement.classList.add('fl-booting');
setTimeout(() => document.documentElement.classList.remove('fl-booting'), 6000);
