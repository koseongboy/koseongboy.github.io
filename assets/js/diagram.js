/* 상세 페이지의 Mermaid 다이어그램 렌더링. 라이트/다크 모드가 바뀌면 다시 그림 */
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';

const nodes = [...document.querySelectorAll('pre.mermaid')];
nodes.forEach((el) => { el.dataset.src = el.textContent; });

function isDark() {
  return window.siteTheme ? window.siteTheme.current() === 'dark'
    : document.documentElement.getAttribute('data-theme') === 'dark';
}

async function render() {
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark() ? 'dark' : 'neutral',
    fontFamily: "'Noto Sans KR', sans-serif",
    sequence: { useMaxWidth: true },
  });
  nodes.forEach((el) => {
    el.removeAttribute('data-processed');
    el.textContent = el.dataset.src;
  });
  try { await mermaid.run({ nodes }); } catch (e) { console.error(e); }
}

render();
document.addEventListener('themechange', render);
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
}
