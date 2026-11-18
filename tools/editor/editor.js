/*
 * 포트폴리오 로컬 편집기 (tools/editor/server.js 가 페이지에 주입)
 *  - 보기 모드: 링크가 평소처럼 동작, 파일이 바뀌면 화면에 실시간 반영
 *  - 편집 모드:
 *  - 이미지 / 이미지 자리  클릭 → 파일 선택 → 교체
 *  - 텍스트                클릭 → 그 자리에서 바로 수정
 *  - 링크·버튼             클릭 → 문구 / URL 수정 창
 *  - Ctrl+S 또는 [저장]    → 원본 .html 파일에 저장
 */
(function () {
  'use strict';

  const ROOT_EL = document.documentElement;
  const PLACEHOLDER_SEL = '.quest-thumb-placeholder, .detail-cover-placeholder';
  const PLACEHOLDER_TO_IMG = { 'quest-thumb-placeholder': 'quest-thumb', 'detail-cover-placeholder': 'detail-cover' };
  const PAGE = location.pathname === '/' ? '/index.html' : location.pathname;
  const DEPTH = PAGE.split('/').length - 2;            // /index.html → 0, /projects/x.html → 1
  const PREFIX = '../'.repeat(DEPTH);

  let dirty = false;
  let editingEl = null;
  let editingBefore = '';
  let editingBeforeState = null;

  // 보기(view) / 편집(edit) 모드 — 마지막으로 쓴 모드를 기억 (기본: 보기)
  const MODE_KEY = 'portfolio-editor-mode';
  const CLIENT_ID = Math.random().toString(36).slice(2);
  let mode = 'view';
  try { if (localStorage.getItem(MODE_KEY) === 'edit') mode = 'edit'; } catch {}
  if (['post', 'project'].includes(document.body.getAttribute('data-page'))) mode = 'view';   // 글·프로젝트 상세 페이지는 보기 전용 (전용 편집기에서 수정)
  const isEdit = () => mode === 'edit';

  /* ---------------- 공통 ---------------- */
  const isEditorUi = (el) => !!(el && el.closest && el.closest('[data-editor]'));
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) el.append(c);
    return el;
  };

  function setDirty(v) {
    dirty = v;
    status.textContent = v ? '저장 안 된 변경사항 있음' : '변경사항 없음';
    status.classList.toggle('ed-status-dirty', v);
    saveBtn.disabled = !v;
  }

  /* ---------------- 되돌리기 / 다시 실행 ----------------
   * 변경 하나 = 기록 하나.
   *  - state:   요소의 내용·속성을 before/after 로 저장 (텍스트, 링크, 이미지 교체)
   *  - replace: 요소 자체를 다른 요소로 바꾼 경우 (빈 이미지 자리 → 이미지)   */
  const undoStack = [];
  const redoStack = [];
  let opSeq = 0;
  let savedOpId = 0;            // 마지막 저장 시점의 기록 id (0 = 처음 상태)

  const SKIP_ATTRS = new Set(['contenteditable', 'spellcheck']);
  function captureState(el) {
    const attrs = [];
    for (const a of el.attributes) {
      if (SKIP_ATTRS.has(a.name)) continue;
      if (a.name === 'class') {
        const v = a.value.split(/\s+/).filter((c) => c && !c.startsWith('ed-')).join(' ');
        if (v) attrs.push(['class', v]);
      } else attrs.push([a.name, a.value]);
    }
    return { html: el.innerHTML, attrs };
  }
  function applyState(el, st) {
    for (const a of [...el.attributes]) el.removeAttribute(a.name);
    for (const [k, v] of st.attrs) el.setAttribute(k, v);
    if (el.innerHTML !== st.html) el.innerHTML = st.html;
  }
  const sameState = (a, b) => a.html === b.html && JSON.stringify(a.attrs) === JSON.stringify(b.attrs);

  function record(op) {
    op.id = ++opSeq;
    undoStack.push(op);
    redoStack.length = 0;
    refreshHistory();
  }
  function applyOp(op, dir) {
    if (op.type === 'state') applyState(op.el, dir === 'undo' ? op.before : op.after);
    else if (op.type === 'replace') {
      const [from, to] = dir === 'undo' ? [op.newNode, op.oldNode] : [op.oldNode, op.newNode];
      if (from.isConnected) from.replaceWith(to);
    }
  }
  function undo() {
    finishText(true);
    closePopover();
    const op = undoStack.pop();
    if (!op) return;
    applyOp(op, 'undo');
    redoStack.push(op);
    refreshHistory();
    toast('되돌렸어요 ↶');
  }
  function redo() {
    finishText(true);
    closePopover();
    const op = redoStack.pop();
    if (!op) return;
    applyOp(op, 'redo');
    undoStack.push(op);
    refreshHistory();
    toast('다시 실행했어요 ↷');
  }
  function refreshHistory() {
    const top = undoStack.length ? undoStack[undoStack.length - 1].id : 0;
    setDirty(top !== savedOpId);
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  let toastTimer;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('ed-toast-error', !!isError);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), isError ? 5000 : 2200);
  }

  /* ---------------- 툴바 ---------------- */
  const status = h('span', { class: 'ed-status' }, '변경사항 없음');
  const saveBtn = h('button', { type: 'button', class: 'ed-btn ed-btn-primary', onclick: save }, '저장 (Ctrl+S)');
  const undoBtn = h('button', { type: 'button', class: 'ed-btn', title: '되돌리기 (Ctrl+Z)', onclick: () => undo() }, '↶ 되돌리기');
  const redoBtn = h('button', { type: 'button', class: 'ed-btn', title: '다시 실행 (Ctrl+Y)', onclick: () => redo() }, '↷ 다시 실행');
  const pageSelect = h('select', { class: 'ed-select', 'aria-label': '페이지 이동' });
  pageSelect.addEventListener('change', () => { location.href = pageSelect.value; });
  const viewBtn = h('button', { type: 'button', class: 'ed-seg', onclick: () => setMode('view') }, '👁 보기');
  const editBtn = h('button', { type: 'button', class: 'ed-seg', onclick: () => setMode('edit') }, '✎ 편집');
  const liveEl = h('span', { class: 'ed-live', title: '파일이 바뀌면 화면에 바로 반영돼요' }, '연결 중…');
  // 블로그 글 페이지는 글쓰기 에디터에서만 수정 (원본 .md 와 어긋나지 않게)
  const PAGE_KIND = document.body.getAttribute('data-page');
  const IS_PROJECT = PAGE_KIND === 'project';
  const IS_POST = PAGE_KIND === 'post' || IS_PROJECT;   // 보기 전용 페이지
  const POST_SLUG = document.body.getAttribute('data-slug') || '';
  const IN_PORTFOLIO = location.pathname.startsWith('/portfolio/');
  const writeLink = IS_PROJECT
    ? h('a', { class: 'ed-btn ed-btn-link', href: '/__editor/project?slug=' + encodeURIComponent(POST_SLUG) }, '✎ 이 프로젝트 수정')
    : IN_PORTFOLIO
    ? h('a', { class: 'ed-btn ed-btn-link', href: '/__editor/project' }, '🗂 프로젝트 추가·수정')
    : IS_POST
    ? h('a', { class: 'ed-btn ed-btn-link', href: '/__editor/write?slug=' + encodeURIComponent(POST_SLUG) }, '✎ 이 글 수정')
    : h('a', { class: 'ed-btn ed-btn-link', href: '/__editor/write' }, '✍ 새 글 쓰기');
  if (IS_POST) editBtn.hidden = true;
  const publishBtn = h('button', { type: 'button', class: 'ed-btn ed-btn-git', title: '바뀐 파일을 GitHub에 올려 사이트에 반영', onclick: () => openPublish() }, '⇪ 커밋 & 푸시');
  const toolbar = h('div', { class: 'ed-toolbar', 'data-editor': '', role: 'toolbar', 'aria-label': '편집기' },
    h('div', { class: 'ed-segmented', role: 'group', 'aria-label': '모드' }, viewBtn, editBtn),
    pageSelect,
    liveEl,
    writeLink,
    publishBtn,
    h('span', { class: 'ed-edit-only' },
      status,
      undoBtn,
      redoBtn,
      h('button', { type: 'button', class: 'ed-btn', onclick: () => helpEl.hidden = !helpEl.hidden }, '도움말'),
      saveBtn,
    ),
  );
  const helpEl = h('div', { class: 'ed-help', 'data-editor': '', hidden: '' },
    h('p', {}, h('b', {}, '이미지'), ' 이미지나 빈 이미지 자리를 클릭하면 파일을 고를 수 있어요.'),
    h('p', {}, h('b', {}, '텍스트'), ' 글자를 클릭하면 바로 수정돼요. Enter 또는 바깥 클릭으로 완료, Esc로 취소.'),
    h('p', {}, h('b', {}, '링크·버튼'), ' 클릭하면 문구와 연결 주소를 바꾸는 창이 떠요.'),
    h('p', {}, h('b', {}, '되돌리기'), ' Ctrl+Z (글자 입력 중에는 입력 내용부터 되돌려요). 다시 실행은 Ctrl+Y 또는 Ctrl+Shift+Z.'),
    h('p', {}, h('b', {}, '저장'), ' Ctrl+S. 저장 전에 새로고침하면 변경 내용이 사라져요. 저장 후에도 페이지를 새로고침하기 전까지는 되돌릴 수 있어요.'),
  );
  const toastEl = h('div', { class: 'ed-toast', 'data-editor': '', role: 'status', hidden: '' });
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', 'data-editor': '', hidden: '' });
  document.body.append(toolbar, helpEl, toastEl, fileInput);
  refreshHistory();

  /* ---------------- 커밋 & 푸시 ---------------- */
  let publishEl = null;
  function closePublish() { if (publishEl) { publishEl.remove(); publishEl = null; publishBtn.focus(); } }
  async function openPublish() {
    if (publishEl) return closePublish();
    if (dirty) { toast('저장 안 된 수정이 있어요. 먼저 저장(Ctrl+S)해 주세요.', true); return; }
    let data;
    try {
      const res = await fetch('/__editor/git/status');
      data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
    } catch (err) { toast('Git 상태를 읽지 못했어요: ' + err.message, true); return; }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    const msgInput = h('input', { class: 'ed-input', type: 'text', id: 'ed-commit-msg', value: '사이트 내용 수정 (' + stamp + ')' });
    const list = h('div', { class: 'ed-git-list' });
    const boxes = [];
    for (const f of data.files) {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = f.suggested;
      cb.dataset.path = f.path;
      boxes.push(cb);
      list.append(h('label', { class: 'ed-git-item' }, cb,
        h('span', { class: 'ed-git-kind ed-git-' + (f.kind === '새 파일' ? 'new' : f.kind === '삭제' ? 'del' : 'mod') }, f.kind),
        h('span', { class: 'ed-git-path' }, f.path, f.note ? h('small', {}, f.note) : '')));
    }
    const goBtn = h('button', { type: 'button', class: 'ed-btn ed-btn-primary' }, '커밋하고 푸시');
    const actions = h('div', { class: 'ed-actions' }, h('button', { type: 'button', class: 'ed-btn', onclick: closePublish }, '취소'), goBtn);
    publishEl = h('div', { class: 'ed-publish', 'data-editor': '', role: 'dialog', 'aria-label': '커밋 & 푸시' },
      h('strong', { class: 'ed-publish-title' }, '커밋 & 푸시 (' + data.branch + ')'));
    if (!data.files.length) {
      publishEl.append(h('p', { class: 'ed-note' }, '바뀐 파일이 없어요. 이미 모두 올라가 있어요.'), h('div', { class: 'ed-actions' }, h('button', { type: 'button', class: 'ed-btn', onclick: closePublish }, '닫기')));
    } else {
      publishEl.append(
        h('label', { class: 'ed-label', for: 'ed-commit-msg' }, '커밋 메시지'), msgInput,
        h('span', { class: 'ed-label' }, '올릴 파일 (' + data.files.length + '개)'), list,
        h('p', { class: 'ed-note' }, '푸시하면 1~2분 뒤 koseongboy.github.io 에 반영돼요.'), actions);
    }
    publishEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePublish(); } });
    publishEl.style.bottom = (toolbar.offsetHeight + 28) + 'px';   // 툴바가 두 줄이어도 가리지 않게
    document.body.append(publishEl);
    (data.files.length ? msgInput : publishEl.querySelector('button')).focus();

    goBtn.addEventListener('click', async () => {
      const files = boxes.filter((b) => b.checked).map((b) => b.dataset.path);
      if (!files.length) { toast('올릴 파일을 하나 이상 골라 주세요', true); return; }
      goBtn.disabled = true; goBtn.textContent = '올리는 중…';
      try {
        const res = await fetch('/__editor/git/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, message: msgInput.value }) });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || res.statusText);
        closePublish();
        toast('푸시 완료 (' + out.commit + ') — 1~2분 뒤 사이트에 반영돼요');
      } catch (err) {
        toast(err.message, true);
        goBtn.disabled = false; goBtn.textContent = '커밋하고 푸시';
      }
    });
  }

  /* ---------------- 모드 전환 ---------------- */
  function setMode(next) {
    if (next === mode) return;
    if (next === 'view') {
      finishText(true);
      closePopover();
      if (hovered) { hovered.classList.remove('ed-hover-text', 'ed-hover-image', 'ed-hover-link'); hovered = null; }
      helpEl.hidden = true;
    }
    mode = next;
    if (!IS_POST) try { localStorage.setItem(MODE_KEY, mode); } catch {}
    applyModeClasses();
    toast(isEdit() ? '편집 모드: 클릭해서 수정하세요' : '보기 모드: 링크가 평소처럼 동작해요');
  }
  function applyModeClasses() {
    ROOT_EL.classList.toggle('ed-on', isEdit());
    ROOT_EL.classList.toggle('ed-mode-view', !isEdit());
    ROOT_EL.classList.toggle('ed-mode-edit', isEdit());
    viewBtn.setAttribute('aria-pressed', String(!isEdit()));
    editBtn.setAttribute('aria-pressed', String(isEdit()));
  }
  applyModeClasses();

  /* ---------------- 실시간 반영 (파일이 바뀌면 화면 갱신) ---------------- */
  const SCROLL_KEY = 'portfolio-editor-scroll:' + PAGE;
  function reloadKeepingScroll() {
    try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch {}
    location.reload();
  }
  (function restoreScroll() {
    let y = null;
    try { y = sessionStorage.getItem(SCROLL_KEY); sessionStorage.removeItem(SCROLL_KEY); } catch {}
    if (y === null) return;
    const go = () => window.scrollTo(0, Number(y));
    go();
    window.addEventListener('load', go, { once: true });
  })();
  const originalHref = new Map();   // CSS 교체 전 원래 href (저장할 때 원래 값으로 되돌림)
  function swapStylesheets() {
    document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
      if (new URL(link.href, location.href).origin !== location.origin) return;
      if (!originalHref.has(link)) originalHref.set(link, link.getAttribute('href'));
      link.setAttribute('href', originalHref.get(link) + '?v=' + Date.now());
    });
  }
  let pendingReloadToast = false;
  function onFilesChanged(files) {
    const mine = files.filter((f) => f.by !== CLIENT_ID).map((f) => f.path);
    if (!mine.length) return;
    const cssOnly = mine.every((p) => p.endsWith('.css'));
    const affectsPage = mine.some((p) => p === PAGE || !p.endsWith('.html'));
    if (cssOnly) { swapStylesheets(); return; }
    if (!affectsPage) return;
    if (dirty) {
      if (pendingReloadToast) return;
      pendingReloadToast = true;
      toastEl.textContent = '';
      toastEl.append('파일이 바뀌었어요. 저장 안 한 수정이 있어서 자동 새로고침을 멈췄어요. ',
        h('button', { type: 'button', class: 'ed-btn', onclick: () => { dirty = false; reloadKeepingScroll(); } }, '수정 버리고 새로고침'));
      toastEl.classList.add('ed-toast-error');
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      return;
    }
    reloadKeepingScroll();
  }
  (function connectLive() {
    if (!window.EventSource) { liveEl.textContent = '실시간 반영 불가'; return; }
    const es = new EventSource('/__editor/events');
    es.addEventListener('open', () => { liveEl.textContent = '● 실시간 반영'; liveEl.classList.add('ed-live-on'); });
    es.addEventListener('error', () => { liveEl.textContent = '○ 서버 연결 끊김'; liveEl.classList.remove('ed-live-on'); });
    es.addEventListener('change', (e) => { try { onFilesChanged(JSON.parse(e.data)); } catch {} });
  })();

  fetch('/__editor/pages').then((r) => r.json()).then((pages) => {
    for (const p of pages) {
      const opt = h('option', { value: p.path }, p.title.replace(/\s*\|\s*고성현.*$/, '') + '  (' + p.path + ')');
      if (p.path === PAGE) opt.selected = true;
      pageSelect.append(opt);
    }
  }).catch(() => {});

  /* ---------------- 대상 판별 ---------------- */
  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }
  function findTextTarget(el) {
    while (el && el !== document.body && el.nodeType === 1) {
      if (['MAIN', 'SECTION', 'ARTICLE', 'HEADER', 'NAV', 'FOOTER'].includes(el.tagName)) return null;
      if (hasOwnText(el)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function classify(target) {
    if (!target || isEditorUi(target) || !document.body.contains(target)) return null;
    if (target.closest('main, header, footer') === null) return null;
    if (target.closest('[data-generated]')) return null;   // 글 목록 등 자동 생성 영역 (글쓰기로 관리)
    if (target.tagName === 'IMG') return { kind: 'image', el: target };
    const ph = target.closest(PLACEHOLDER_SEL);
    if (ph) return { kind: 'image', el: ph };
    const a = target.closest('a');
    if (a && !(editingEl && editingEl.contains(target))) return { kind: 'link', el: a };
    const t = findTextTarget(target);
    if (t) return { kind: 'text', el: t };
    return null;
  }

  /* ---------------- 호버 표시 ---------------- */
  let hovered = null;
  document.addEventListener('mouseover', (e) => {
    if (!isEdit()) return;
    const c = classify(e.target);
    const el = c && c.el;
    if (hovered === el) return;
    if (hovered) hovered.classList.remove('ed-hover-text', 'ed-hover-image', 'ed-hover-link');
    hovered = el;
    if (el && el !== editingEl) el.classList.add('ed-hover-' + c.kind);
  });

  /* ---------------- 클릭 분기 ---------------- */
  document.addEventListener('click', (e) => {
    if (!isEdit() || isEditorUi(e.target)) return;   // 보기 모드에서는 링크가 평소처럼 동작
    const c = classify(e.target);
    // 편집 모드에서는 링크 이동을 모두 막습니다
    if (e.target.closest && e.target.closest('a')) e.preventDefault();
    if (!c) return;
    if (c.kind === 'text' && c.el === editingEl) return;
    e.preventDefault();
    if (c.kind === 'image') pickImage(c.el);
    else if (c.kind === 'link') openLinkPopover(c.el);
    else startText(c.el, e);
  }, true);

  // 폼 제출, 드래그로 링크 열기 등 방지
  document.addEventListener('submit', (e) => { if (isEdit()) e.preventDefault(); }, true);
  document.addEventListener('dragstart', (e) => { if (isEdit() && !isEditorUi(e.target)) e.preventDefault(); }, true);

  /* ---------------- 텍스트 편집 ---------------- */
  function startText(el, evt) {
    finishText(true);
    closePopover();
    editingEl = el;
    editingBefore = el.innerHTML;
    editingBeforeState = captureState(el);
    el.classList.remove('ed-hover-text');
    el.classList.add('ed-editing');
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
    el.spellcheck = false;
    el.focus();
    // 클릭한 위치에 커서 놓기
    const sel = window.getSelection();
    let range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(evt.clientX, evt.clientY);
    else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(evt.clientX, evt.clientY);
      if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
    }
    if (range && el.contains(range.startContainer)) { sel.removeAllRanges(); sel.addRange(range); }
    el.addEventListener('keydown', onTextKey);
    el.addEventListener('blur', onTextBlur);
  }
  function onTextKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishText(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finishText(false); }
  }
  function onTextBlur() { finishText(true); }
  function finishText(keep) {
    const el = editingEl;
    if (!el) return;
    editingEl = null;
    el.removeEventListener('keydown', onTextKey);
    el.removeEventListener('blur', onTextBlur);
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    el.classList.remove('ed-editing');
    if (!keep) { el.innerHTML = editingBefore; return; }
    // 붙여넣기 등으로 생긴 <br>/<div> 정리
    el.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
    if (el.innerHTML !== editingBefore) record({ type: 'state', el, before: editingBeforeState, after: captureState(el) });
  }

  /* ---------------- 링크 편집 ---------------- */
  let popover = null;
  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
    document.querySelectorAll('.ed-link-active').forEach((x) => x.classList.remove('ed-link-active'));
  }
  function openLinkPopover(a) {
    finishText(true);
    closePopover();
    a.classList.remove('ed-hover-link');
    a.classList.add('ed-link-active');
    const textOnly = a.children.length === 0;

    const textInput = h('input', { type: 'text', class: 'ed-input', id: 'ed-link-text' });
    textInput.value = a.textContent.trim();
    const urlInput = h('input', { type: 'text', class: 'ed-input', id: 'ed-link-url', placeholder: 'https://...' });
    urlInput.value = a.getAttribute('href') || '';
    const newTab = h('input', { type: 'checkbox', id: 'ed-link-newtab' });
    newTab.checked = a.getAttribute('target') === '_blank';

    const apply = () => {
      const before = captureState(a);
      const url = urlInput.value.trim();
      if (url !== (a.getAttribute('href') || '')) a.setAttribute('href', url);
      if (textOnly && textInput.value.trim() && textInput.value.trim() !== a.textContent.trim()) a.textContent = textInput.value.trim();
      const wasNew = a.getAttribute('target') === '_blank';
      if (newTab.checked !== wasNew) {
        if (newTab.checked) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
        else { a.removeAttribute('target'); a.removeAttribute('rel'); }
      }
      const after = captureState(a);
      if (!sameState(before, after)) record({ type: 'state', el: a, before, after });
      closePopover();
    };

    const rows = [];
    if (textOnly) rows.push(h('label', { class: 'ed-label', for: 'ed-link-text' }, '문구'), textInput);
    else rows.push(h('p', { class: 'ed-note' }, '이 링크는 안쪽에 여러 글자 묶음이 있어요. 문구는 아래 [문구 직접 수정]으로 바꿀 수 있어요.'));
    rows.push(h('label', { class: 'ed-label', for: 'ed-link-url' }, '연결 주소 (URL)'), urlInput);
    rows.push(h('label', { class: 'ed-check' }, newTab, ' 새 탭에서 열기'));

    const actions = h('div', { class: 'ed-actions' });
    if (!textOnly) actions.append(h('button', { type: 'button', class: 'ed-btn', onclick: () => { apply(); editLinkInner(a); } }, '문구 직접 수정'));
    if (/^https?:|^mailto:/.test(urlInput.value)) actions.append(h('button', { type: 'button', class: 'ed-btn', onclick: () => window.open(urlInput.value, '_blank', 'noopener') }, '열어보기 ↗'));
    actions.append(
      h('button', { type: 'button', class: 'ed-btn', onclick: closePopover }, '취소'),
      h('button', { type: 'button', class: 'ed-btn ed-btn-primary', onclick: apply }, '적용'),
    );

    popover = h('div', { class: 'ed-popover', 'data-editor': '', role: 'dialog', 'aria-label': '링크 수정' }, ...rows, actions);
    popover.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); apply(); }
      if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
    });
    document.body.append(popover);
    const r = a.getBoundingClientRect();
    const pw = popover.offsetWidth;
    const left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - pw - 8));
    let top = window.scrollY + r.bottom + 8;
    if (r.bottom + popover.offsetHeight + 80 > window.innerHeight) top = window.scrollY + r.top - popover.offsetHeight - 8;
    popover.style.left = left + 'px';
    popover.style.top = Math.max(window.scrollY + 8, top) + 'px';
    (textOnly ? textInput : urlInput).focus();
    (textOnly ? textInput : urlInput).select();
  }
  function editLinkInner(a) {
    // 여러 조각으로 된 링크(예: 카드 제목)는 링크 전체를 텍스트 편집 상태로
    const r = a.getBoundingClientRect();
    startText(a, { clientX: r.right - 2, clientY: r.top + r.height / 2 });
  }
  document.addEventListener('mousedown', (e) => {
    if (popover && !popover.contains(e.target) && !e.target.closest('.ed-link-active')) closePopover();
  });

  /* ---------------- 이미지 교체 ---------------- */
  let imageTarget = null;
  function pickImage(el) {
    finishText(true);
    closePopover();
    imageTarget = el;
    fileInput.value = '';
    fileInput.click();
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    const target = imageTarget;
    imageTarget = null;
    if (!file || !target) return;
    toast('이미지 올리는 중…');
    try {
      const res = await fetch('/__editor/upload?name=' + encodeURIComponent(file.name) + '&clientId=' + CLIENT_ID, { method: 'POST', body: file });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '업로드 실패');
      const src = PREFIX + json.path;
      // 크기를 먼저 알아낸 뒤 한 번에 바꿔야 되돌리기 기록이 정확해요
      const size = await new Promise((resolve, reject) => {
        const probe = new Image();
        probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
        probe.onerror = () => reject(new Error('이미지를 읽을 수 없어요'));
        probe.src = src;
      });
      if (target.tagName === 'IMG') {
        const before = captureState(target);
        target.setAttribute('src', src);
        target.setAttribute('width', size.w);
        target.setAttribute('height', size.h);
        record({ type: 'state', el: target, before, after: captureState(target) });
      } else {
        const cls = Object.keys(PLACEHOLDER_TO_IMG).find((k) => target.classList.contains(k));
        const card = target.closest('article, main');
        const heading = card && card.querySelector('h1, h3');
        const img = document.createElement('img');
        img.className = PLACEHOLDER_TO_IMG[cls];
        img.setAttribute('src', src);
        img.alt = (heading ? heading.textContent.trim() : '프로젝트') + ' 스크린샷';
        if (cls === 'quest-thumb-placeholder') img.setAttribute('loading', 'lazy');
        img.setAttribute('width', size.w);
        img.setAttribute('height', size.h);
        target.classList.remove('ed-hover-image');
        target.replaceWith(img);
        record({ type: 'replace', oldNode: target, newNode: img });
      }
      toast('이미지를 바꿨어요: ' + json.path + '  (저장해야 반영돼요)');
    } catch (err) {
      toast('이미지를 넣지 못했어요: ' + err.message, true);
    }
  });

  /* ---------------- 저장 ---------------- */
  function serialize() {
    const clone = ROOT_EL.cloneNode(true);
    clone.querySelectorAll('[data-editor]').forEach((n) => n.remove());
    clone.removeAttribute('data-theme');   // 다크/라이트 선택은 방문자 브라우저 상태 — 파일에 저장하지 않음
    clone.querySelectorAll('link[rel="stylesheet"][href*="?v="]').forEach((l) => l.setAttribute('href', l.getAttribute('href').replace(/\?v=\d+$/, '')));
    clone.querySelectorAll('[contenteditable], [spellcheck]').forEach((n) => { n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck'); });
    const all = [clone, ...clone.querySelectorAll('[class]')];
    for (const n of all) {
      if (!n.classList) continue;
      [...n.classList].filter((c) => c.startsWith('ed-')).forEach((c) => n.classList.remove(c));
      if (n.getAttribute('class') === '') n.removeAttribute('class');
    }
    const html = clone.outerHTML
      .replace(/^(<html[^>]*>)\s*<head>/, '$1\n<head>')
      .replace(/\n*<\/body>\s*<\/html>$/, '\n</body>\n</html>');
    return '<!doctype html>\n' + html + '\n';
  }
  async function save() {
    finishText(true);
    closePopover();
    if (!dirty) return;
    saveBtn.disabled = true;
    try {
      const res = await fetch('/__editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: PAGE, html: serialize(), clientId: CLIENT_ID }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '저장 실패');
      savedOpId = undoStack.length ? undoStack[undoStack.length - 1].id : 0;
      refreshHistory();
      toast('저장했어요 ✓  ' + PAGE.slice(1));
    } catch (err) {
      saveBtn.disabled = false;
      toast('저장하지 못했어요: ' + err.message, true);
    }
  }
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 's') { e.preventDefault(); save(); return; }
    if (!isEdit()) return;
    // 글자 입력 중이거나 링크 창 입력칸에서는 브라우저 기본 되돌리기(입력 내용)를 사용
    const typing = editingEl || (e.target && e.target.closest && e.target.closest('.ed-popover'));
    if (typing) return;
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
})();
