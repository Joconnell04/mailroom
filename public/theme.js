// Runs before first paint so the page never flashes the wrong theme.
try {
  var p = JSON.parse(localStorage.getItem('mailroom.prefs') || '{}');
  if (p.theme === 'light' || p.theme === 'dark') document.documentElement.dataset.theme = p.theme;
} catch (e) {}
