/**
 * Inline script that applies the correct theme classes to <html> before
 * React hydrates, preventing any flash of incorrect theme.
 *
 * Runs synchronously in <head>, before the browser paints.
 * Reads theme preferences from cookies, falls back to defaults.
 *
 * IMPORTANT: This script must produce the same result as ThemeProvider's
 * initial state to avoid hydration mismatches.
 */
export function getThemeScript(): string {
  // Minified for performance - this runs synchronously and blocks parsing.
  // Logic:
  //   1. Read theme/colorMode from cookies (or use defaults: btc/system)
  //   2. Detect system color scheme via matchMedia
  //   3. Compute effectiveColorMode (resolve 'system' to actual light/dark)
  //   4. Apply theme + effectiveColorMode classes to <html>
  return `(function(){try{var d=document.documentElement,c=document.cookie;function g(n){var m=c.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?m[1]:null}var t=g('theme')||'btc';var cm=g('color-mode')||'system';var sm=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var em=cm==='system'?sm:cm;d.classList.remove('usd','btc','light','dark');d.classList.add(t,em)}catch(e){}})()`;
}
