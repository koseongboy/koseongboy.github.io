/*
 * docs/ 미리보기 — 자소서 등 docs 폴더의 .txt / .md 를 편집 서버에서 읽기 전용으로 보여 줍니다.
 *
 *   /__docs/            파일 목록 (글자 수 포함)
 *   /__docs/view?f=...  한 파일 보기 (파일이 바뀌면 자동 갱신)
 *
 * docs/ 는 gitignore 대상(공개 저장소에 올라가지 않음)이며, 이 페이지도 편집 서버
 * (이 PC · 내 Tailscale 기기)에서만 열립니다. 수정 기능은 없습니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const EXT = new Set(['.txt', '.md']);
const clients = new Set();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = (res, status, body, type) => {
  res.writeHead(status, { 'Content-Type': type || 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};
/** 자소서 글자 수 기준: 앞뒤 공백 제거, 줄바꿈은 \n 하나로, 공백 포함 */
const countChars = (text) => [...text.replace(/\r/g, '').trim()].length;

/** docs 안의 상대 경로 → 실제 경로. 밖이거나 txt/md 가 아니면 null */
function resolveDoc(rel) {
  if (!rel) return null;
  const abs = path.resolve(DOCS, String(rel));
  const r = path.relative(DOCS, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  if (!EXT.has(path.extname(abs).toLowerCase())) return null;
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

function listDocs() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (EXT.has(path.extname(ent.name).toLowerCase())) {
        const st = fs.statSync(abs);
        out.push({ rel: path.relative(DOCS, abs).split(path.sep).join('/'), chars: countChars(fs.readFileSync(abs, 'utf8')), mtime: st.mtimeMs });
      }
    }
  };
  if (fs.existsSync(DOCS)) walk(DOCS);
  return out.sort((a, b) => a.rel.localeCompare(b.rel, 'ko'));
}

const STYLE = `
:root { --bg:#fbfaf7; --fg:#1d1d1f; --muted:#6b6b70; --line:#e2e0da; --accent:#1f3fd1; --code:#f1efe9; }
@media (prefers-color-scheme: dark) { :root { --bg:#111214; --fg:#ececee; --muted:#9a9aa2; --line:#2c2d31; --accent:#8ea2ff; --code:#1b1c20; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.75 "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; word-break: keep-all; overflow-wrap: anywhere; }
header { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--bg); font-size: 14px; }
header a { color: var(--accent); text-decoration: none; }
header .path { font-weight: 700; }
header .meta { color: var(--muted); }
.live { margin-left: auto; color: var(--muted); }
.live.on { color: #1a8f4c; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 80px; }
.txt { white-space: pre-wrap; margin: 0; font: inherit; }
.flash { animation: flash 1.2s ease-out; }
@keyframes flash { from { background: rgba(255, 214, 10, .35); } to { background: transparent; } }
h1, h2, h3, h4 { line-height: 1.35; margin: 1.6em 0 .6em; }
h1 { font-size: 26px; } h2 { font-size: 21px; border-bottom: 1px solid var(--line); padding-bottom: 4px; } h3 { font-size: 18px; }
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; font-size: 14px; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
code { background: var(--code); padding: 1px 5px; border-radius: 4px; font-size: .9em; }
pre.code { background: var(--code); padding: 12px; overflow-x: auto; font-size: 14px; line-height: 1.5; white-space: pre; }
blockquote { margin: 1em 0; padding: 2px 14px; border-left: 3px solid var(--line); color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
sub { color: var(--muted); }
ul.files { list-style: none; padding: 0; margin: 0; }
ul.files li { display: flex; gap: 12px; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); }
ul.files a { color: var(--fg); text-decoration: none; }
ul.files a:hover { color: var(--accent); }
ul.files .n { color: var(--muted); font-size: 14px; white-space: nowrap; }
.dir { margin: 28px 0 4px; font-size: 13px; letter-spacing: .08em; color: var(--muted); }
`;

/* 브라우저 쪽: 작은 마크다운 변환 + 실시간 갱신 */
const CLIENT = `
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = (s) => esc(s)
  .replace(/&lt;(\\/?)(sub|sup|br)&gt;/g, '<$1$2>')
  .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
  .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\\*([^*\\s][^*]*)\\*/g, '$1<em>$2</em>')
  .replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
function md(src) {
  const L = src.replace(/\\r/g, '').split('\\n'); const out = []; let i = 0;
  const cells = (l) => l.trim().replace(/^\\||\\|$/g, '').split(/(?<!\\\\)\\|/).map((c) => c.trim());
  while (i < L.length) {
    const l = L[i];
    if (/^\`\`\`/.test(l)) { const b = []; i++; while (i < L.length && !/^\`\`\`/.test(L[i])) b.push(L[i++]); i++; out.push('<pre class="code">' + esc(b.join('\\n')) + '</pre>'); continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\\s+(.*)$/))) { out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
    if (/^\\s*(---|\\*\\*\\*)\\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\\s*\\|/.test(l) && i + 1 < L.length && /^\\s*\\|?\\s*:?-{2,}/.test(L[i + 1])) {
      const head = cells(l); i += 2; const rows = [];
      while (i < L.length && /^\\s*\\|/.test(L[i])) rows.push(cells(L[i++]));
      out.push('<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^>\\s?/.test(l)) { const b = []; while (i < L.length && /^>\\s?/.test(L[i])) b.push(L[i++].replace(/^>\\s?/, '')); out.push('<blockquote>' + md(b.join('\\n')) + '</blockquote>'); continue; }
    if (/^\\s*([-*]|\\d+\\.)\\s+/.test(l)) {
      const ordered = /^\\s*\\d+\\./.test(l); const items = [];
      while (i < L.length && /^\\s*([-*]|\\d+\\.)\\s+/.test(L[i])) items.push(L[i++].replace(/^\\s*([-*]|\\d+\\.)\\s+/, ''));
      out.push((ordered ? '<ol>' : '<ul>') + items.map((t) => '<li>' + inline(t) + '</li>').join('') + (ordered ? '</ol>' : '</ul>'));
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < L.length && L[i].trim() && !/^(#{1,6}\\s|\\s*\\||>|\\s*([-*]|\\d+\\.)\\s|\`\`\`|\\s*---\\s*$)/.test(L[i])) p.push(L[i++]);
    if (!p.length) p.push(L[i++]);
    out.push('<p>' + p.map(inline).join('<br>') + '</p>');
  }
  return out.join('\\n');
}
const FILE = document.body.dataset.file;
const box = document.getElementById('doc');
const metaEl = document.getElementById('meta');
function render(text) {
  if (FILE.toLowerCase().endsWith('.md')) box.innerHTML = md(text);
  else { box.textContent = text; }
}
async function refresh(flash) {
  const r = await fetch('/__docs/raw?f=' + encodeURIComponent(FILE), { cache: 'no-store' });
  if (!r.ok) { metaEl.textContent = '파일을 읽지 못했어요 (삭제 · 이름 변경?)'; return; }
  const j = await r.json(); const y = scrollY;
  render(j.text); metaEl.textContent = j.chars + '자 (공백 포함) · ' + new Date(j.mtime).toLocaleTimeString('ko-KR') + ' 수정';
  scrollTo(0, y);
  if (flash) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
}
refresh(false);
const live = document.getElementById('live');
const es = new EventSource('/__docs/events');
es.onopen = () => { live.textContent = '● 실시간 반영'; live.classList.add('on'); };
es.onerror = () => { live.textContent = '○ 연결 끊김'; live.classList.remove('on'); };
es.addEventListener('change', (e) => { try { if (JSON.parse(e.data).includes(FILE)) refresh(true); } catch {} });
`;

const LIST_CLIENT = `
const es = new EventSource('/__docs/events');
let t; es.addEventListener('change', () => { clearTimeout(t); t = setTimeout(() => location.reload(), 300); });
`;

function page(title, header, body, script, file) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body${file ? ` data-file="${esc(file)}"` : ''}><header>${header}</header><main>${body}</main><script>${script}</script></body></html>`;
}

function listPage() {
  const docs = listDocs();
  let html = '', dir = null;
  for (const d of docs) {
    const i = d.rel.lastIndexOf('/');
    const dname = i < 0 ? '' : d.rel.slice(0, i);
    if (dname !== dir) { if (dir !== null) html += '</ul>'; html += `<p class="dir">${esc(dname || 'docs')}</p><ul class="files">`; dir = dname; }
    html += `<li><a href="/__docs/view?f=${encodeURIComponent(d.rel)}">${esc(d.rel.slice(i + 1))}</a><span class="n">${d.chars}자</span></li>`;
  }
  if (dir !== null) html += '</ul>';
  if (!docs.length) html = '<p>docs 폴더에 txt / md 파일이 없어요.</p>';
  return page('docs 미리보기', '<span class="path">docs 미리보기</span><a href="/">← 사이트로</a><span class="live on">파일이 생기거나 지워지면 자동 갱신</span>', html, LIST_CLIENT);
}

function viewPage(rel) {
  const crumbs = `<a href="/__docs/">← 목록</a><span class="path">${esc(rel)}</span><span class="meta" id="meta"></span><span class="live" id="live">○ 연결 중</span>`;
  const isTxt = rel.toLowerCase().endsWith('.txt');
  return page(path.basename(rel) + ' · docs', crumbs, isTxt ? '<pre class="txt" id="doc"></pre>' : '<article id="doc"></article>', CLIENT, rel);
}

/** /__docs/ 요청 처리. 처리했으면 true */
function handle(req, res, url) {
  if (!url.pathname.startsWith('/__docs')) return false;
  if (req.method !== 'GET') { send(res, 405, 'Method Not Allowed', 'text/plain'); return true; }
  if (url.pathname === '/__docs' || url.pathname === '/__docs/') { send(res, 200, listPage()); return true; }
  if (url.pathname === '/__docs/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return true;
  }
  const rel = url.searchParams.get('f');
  const abs = resolveDoc(rel);
  if (!abs) { send(res, 404, '파일을 찾을 수 없어요', 'text/plain; charset=utf-8'); return true; }
  const relNorm = path.relative(DOCS, abs).split(path.sep).join('/');
  if (url.pathname === '/__docs/view') { send(res, 200, viewPage(relNorm)); return true; }
  if (url.pathname === '/__docs/raw') {
    const text = fs.readFileSync(abs, 'utf8');
    send(res, 200, JSON.stringify({ text, chars: countChars(text), mtime: fs.statSync(abs).mtimeMs }), 'application/json; charset=utf-8');
    return true;
  }
  send(res, 404, 'not found', 'text/plain');
  return true;
}

let pending = new Set();
let timer = null;
function startWatcher() {
  if (!fs.existsSync(DOCS)) return;
  try {
    fs.watch(DOCS, { recursive: true }, (_e, filename) => {
      if (!filename || !EXT.has(path.extname(filename).toLowerCase())) return;
      pending.add(filename.split(path.sep).join('/'));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const data = JSON.stringify([...pending]);
        pending = new Set();
        for (const c of clients) c.write(`event: change\ndata: ${data}\n\n`);
      }, 150);
    });
  } catch (err) {
    console.warn('  (docs 변경 감지를 켤 수 없어요: ' + err.message + ')');
  }
}

module.exports = { handle, startWatcher };
