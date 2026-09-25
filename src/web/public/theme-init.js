// Applies the stored theme before the first paint, so a dark choice never
// flashes light while React loads. Keep in step with src/web/theme.ts
// (THEME_KEY, parseTheme, applyTheme); a test runs both and compares them.
//
// It must stay a plain, blocking <script src> in <head>: not type="module",
// not async, not defer, or the flash comes back. It is external rather than
// inline so a Content-Security-Policy of script-src 'self' allows it with no
// hash to keep in sync.
(function () {
  try {
    var theme = window.localStorage.getItem("planning-poker:theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.colorScheme = theme;
    }
  } catch {
    // Storage is unavailable in some privacy modes: the system theme applies.
  }
})();
