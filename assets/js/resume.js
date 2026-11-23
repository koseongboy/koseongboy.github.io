/* 포트폴리오 이력 접기 / 펼치기. 항상 접힌 상태로 시작 (?resume=open 링크로 펼친 상태로 열 수 있음) */
(function () {
  var root = document.documentElement;
  function sync() {
    var closed = root.getAttribute('data-resume') === 'closed';
    document.querySelectorAll('.resume-toggle').forEach(function (b) { b.setAttribute('aria-expanded', closed ? 'false' : 'true'); });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.resume-toggle');
    if (!btn) return;
    var closed = root.getAttribute('data-resume') !== 'closed';
    if (closed) root.setAttribute('data-resume', 'closed'); else root.removeAttribute('data-resume');
    sync();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
