// Synchronous head script applies the persisted theme before styles paint.
(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const mode = document.querySelector('meta[name="plotforge-mode"]')?.content;
  const themeKey = mode === 'development' ? 'plotforge-development-theme' : 'plotforge-production-theme';
  let preference = 'system';
  try { preference = localStorage.getItem(themeKey) || 'system'; } catch {}
  const valid = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
  function apply() {
    preference = valid(preference);
    document.documentElement.dataset.theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
    for (const input of document.querySelectorAll('[name="appearance"]')) input.checked = input.value === preference;
  }
  window.plotForgeTheme = { get: () => preference, set(value) {
    try { localStorage.setItem(themeKey, valid(value)); } catch {} preference = valid(value); apply();
  } };
  media.addEventListener('change', apply);
  window.addEventListener('storage', event => { if (event.key === themeKey) { preference = valid(event.newValue); apply(); } });
  document.addEventListener('DOMContentLoaded', apply); apply();
})();
