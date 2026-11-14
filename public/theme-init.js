// Applies the saved light/dark theme before first paint (no dark flash in light mode).
// Kept as a separate file (not inline) so the app works under a strict
// Content-Security-Policy of `script-src 'self'`.
try {
  var s = JSON.parse(localStorage.getItem('opengalaxy:settings:v1') || '{}');
  var t = s.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
} catch (e) {}
