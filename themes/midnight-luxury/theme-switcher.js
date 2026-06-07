/* Minimal theme switcher for multiple optional themes
   - Loads CSS dynamically when theme is active
   - Exposes setActiveTheme(theme) to change theme and persist to localStorage
   - Applies attribute on <body> for scoped selectors
*/
(function(){
  const THEME_KEY = 'activeTheme';
  const THEME_MAP = {
    'midnight-luxury': 'themes/midnight-luxury/theme.css',
    'light-motion-sneaker-luxe': 'themes/light-motion-sneaker-luxe/theme.css'
  };
  const DEFAULT_THEME = 'classic';
  let linkEl = null;
  let currentTheme = DEFAULT_THEME;

  function getThemeCssPath(theme){
    return THEME_MAP[theme] || null;
  }

  function loadThemeCss(theme){
    if (linkEl) return;
    const path = getThemeCssPath(theme);
    if (!path) return;
    linkEl = document.createElement('link');
    linkEl.rel = 'stylesheet';
    linkEl.href = path;
    linkEl.dataset.theme = theme;
    document.head.appendChild(linkEl);
  }

  function unloadThemeCss(){
    if (!linkEl) return;
    try { linkEl.parentNode.removeChild(linkEl); } catch(e){}
    linkEl = null;
  }

  function applyTheme(theme){
    if (!document.body) return;
    const cssPath = getThemeCssPath(theme);
    if (cssPath){
      document.body.setAttribute('data-theme', theme);
      currentTheme = theme;
      unloadThemeCss();
      loadThemeCss(theme);
    } else {
      document.body.removeAttribute('data-theme');
      currentTheme = DEFAULT_THEME;
      unloadThemeCss();
    }
  }

  function setActiveTheme(theme, opts){
    try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
    applyTheme(theme);
    if (opts && opts.reload) window.location.reload();
  }

  window.setActiveTheme = setActiveTheme;

  document.addEventListener('DOMContentLoaded', function(){
    const stored = (localStorage.getItem(THEME_KEY) || '').trim();
    const theme = stored || DEFAULT_THEME;
    applyTheme(theme);

    const sel = document.getElementById('st-theme-select');
    if (sel){
      sel.value = theme;
      sel.addEventListener('change', function(e){ setActiveTheme(e.target.value, { reload:true }); });
    }
  });
})();
