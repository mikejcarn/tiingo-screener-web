// Shared light/dark theme toggle.
// Call initTheme() once per page. The anti-flash <script> in each <head>
// applies the saved class before first paint; this module just wires the button.

const LS_KEY = 'theme';
let _onChangeCallbacks = [];

export function isDark() {
  return !document.documentElement.classList.contains('light');
}

// Read a CSS variable from :root (for passing chart colors to lightweight-charts)
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function onThemeChange(cb) {
  _onChangeCallbacks.push(cb);
}

function _apply(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  try { localStorage.setItem(LS_KEY, theme); } catch {}
  document.querySelectorAll('.btn-theme-toggle').forEach(btn => {
    btn.textContent = theme === 'light' ? '☽' : '☀';
    btn.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  });
  _onChangeCallbacks.forEach(cb => cb(theme));
}

export function initTheme() {
  const saved = (() => { try { return localStorage.getItem(LS_KEY); } catch { return null; } })();
  const theme = saved || 'dark';
  // Sync body class (anti-flash script may already have done this, but re-apply to be safe)
  _apply(theme);

  document.querySelectorAll('.btn-theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => _apply(isDark() ? 'light' : 'dark'));
  });
}
