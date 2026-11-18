/* 라이트 / 다크 모드 전환. 선택은 브라우저에 기억 (없으면 시스템 설정을 따름) */
(function () {
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function current() {
    var t = root.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return media && media.matches ? 'dark' : 'light';
  }
  function apply(t) {
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) {}
    document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.theme-toggle');
    if (!btn) return;
    apply(current() === 'dark' ? 'light' : 'dark');
  });
  window.siteTheme = { current: current };
})();
